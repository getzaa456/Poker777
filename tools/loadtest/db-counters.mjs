// Count queries on every RDS instance (writer + read replicas) — proves the replicas really serve reads.
// Runs `SHOW GLOBAL STATUS` on each host from the backend instance through SSM (the DBs are private).
//
//   node db-counters.mjs --label before --out ../../docs/loadtest/Test2-Poker777
//
// Appends one entry to <out>/db-counters.json. Compare two entries: Com_select grows on whichever
// instance answered SELECTs in between.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';
import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1] === undefined || all[index + 1].startsWith('--') ? 'true' : all[index + 1]]);
  return pairs;
}, []));
const OUT = path.resolve(args.out || path.join(here, '../../docs/loadtest/Test2-Poker777'));
const TF_DIR = path.join(here, '../../infra/terraform-test');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const text = fs.readFileSync(path.join(TF_DIR, 'lab.auto.tfvars'), 'utf8');
const get = (key) => (text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || '';
const aws = { region: 'us-east-1', credentials: get('aws_access_key') ? { accessKeyId: get('aws_access_key'), secretAccessKey: get('aws_secret_key'), sessionToken: get('aws_session_token') } : undefined };

// Runs inside /opt/poker777/backend with the backend's env: one connection per host, same credentials.
const js = `import mysql from "mysql2/promise";
import fs from "node:fs";
const hosts = [process.env.DB_HOST, ...(process.env.DB_READ_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean)];
const out = {};
for (const host of hosts) {
  try {
    const conn = await mysql.createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME, ssl: process.env.DB_SSL_CA ? { ca: fs.readFileSync(process.env.DB_SSL_CA) } : undefined });
    const [rows] = await conn.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Questions','Com_select','Com_insert','Com_update','Threads_connected','Uptime')");
    const entry = Object.fromEntries(rows.map((r) => [r.Variable_name, Number(r.Value)]));
    // SELECTs sent by the app's own user (not RDS monitoring), when performance_schema is on.
    const [[ps]] = await conn.query("SELECT @@performance_schema AS on_");
    entry.performance_schema = Number(ps.on_);
    if (entry.performance_schema) {
      const [[mine]] = await conn.query("SELECT COALESCE(SUM(COUNT_STAR), 0) AS n FROM performance_schema.events_statements_summary_by_user_by_event_name WHERE USER = ? AND EVENT_NAME = 'statement/sql/select'", [process.env.DB_USER]);
      entry.app_user_selects = Number(mine.n);
    }
    out[host.split(".")[0]] = entry;
    await conn.end();
  } catch (error) { out[host.split(".")[0]] = { error: error.message }; }
}
console.log("DBJSON" + JSON.stringify(out));
process.exit(0);`;

const group = (await new AutoScalingClient(aws).send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: ['poker777-prod-backend'] }))).AutoScalingGroups[0];
const instanceId = group.Instances.find((i) => i.LifecycleState === 'InService').InstanceId;
const ssm = new SSMClient(aws);
const b64 = Buffer.from(js).toString('base64');
const sent = await ssm.send(new SendCommandCommand({ InstanceIds: [instanceId], DocumentName: 'AWS-RunShellScript', Parameters: { commands: [
  `cd /opt/poker777/backend && echo ${b64} | base64 -d > ./db-counters-tmp.mjs && node --env-file=/etc/poker777/backend.env ./db-counters-tmp.mjs; rm -f ./db-counters-tmp.mjs`,
] } }));
let result = null;
for (let i = 0; i < 30 && !result; i += 1) {
  await sleep(3000);
  const r = await ssm.send(new GetCommandInvocationCommand({ CommandId: sent.Command.CommandId, InstanceId: instanceId })).catch(() => null);
  if (r && ['Success', 'Failed', 'TimedOut', 'Cancelled'].includes(r.Status)) {
    const line = (r.StandardOutputContent || '').split('\n').find((l) => l.startsWith('DBJSON'));
    result = line ? JSON.parse(line.slice(6)) : { error: `${r.Status} ${r.StandardErrorContent || ''}` };
  }
}
const file = path.join(OUT, 'db-counters.json');
const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
all.push({ label: args.label || 'snapshot', at: new Date().toISOString(), counters: result });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(file, JSON.stringify(all, null, 2));
console.log(JSON.stringify(all.at(-1), null, 1));
