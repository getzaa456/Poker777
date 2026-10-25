// Stepped load test against the infra/terraform-test stack, with CloudWatch graphs and numbers saved
// for every step.
//
//   node aws-test.mjs --steps 200,400,600,800,1000 --minutes 5 --per-room 8 --browse-rps 1 --out ../../docs/loadtest/Test2-Poker777
//
// Per step: run loadtest.mjs (--reuse-only: saved bot accounts only, never registers or logs in), sample
// the backend process half-way through (SSM), wait for CloudWatch to catch up, then save
//   *.png          graphs for the step window (GetMetricWidgetImage)
//   timeseries.csv every CloudWatch metric, minute by minute
//   bots.log / bots-timeline.csv   what the bots saw every 10 s
//   backend-sample.txt             memory / CPU of the Node process
//   metrics.json / summary.md      the step's numbers
// Plus a step0-baseline (5 idle minutes before the test), the database tables before/after, whole-test
// graphs with step markers, and results.csv with one row per step. While it runs: asg-timeline.csv (instance count
// every 30 s) and players-per-instance.csv (connections on each backend every minute, also graph 16).
//
// Other modes: --check true (permissions), --regraph true (redraw after late data points arrive),
// --seat-parallel 6 (fill 6 rooms at once), --observe-after 20 (keep recording instances/players 20 min after the
// last step, to catch the scale-in), --refill-bots 1000 (test stack only: reset every bot_ wallet), --seed-bots 2000 (test stack only: add bot accounts
// straight in the database, seconds instead of hours — skips /auth/register, so it says nothing about sign-up speed), --resume true (same --steps/--out:
// keep the finished steps of an interrupted run and redo only the rest).
//
// AWS keys come from infra/terraform-test/lab.auto.tfvars (or the default AWS credential chain);
// resource names come from that folder's terraform.tfstate.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CloudWatchClient, GetMetricDataCommand, GetMetricWidgetImageCommand, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';
import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1] === undefined || all[index + 1].startsWith('--') ? 'true' : all[index + 1]]); // a bare flag (even the last one) means true
  return pairs;
}, []));
const STEPS = String(args.steps || '10,25,50,100,150').split(',').map(Number);
const MINUTES = Number(args.minutes || 5);
const SETTLE_S = Number(args.settle || 180); // CloudWatch needs a couple of minutes to publish
const PER_ROOM = String(args['per-room'] || 6);
const BROWSE_RPS = String(args['browse-rps'] || 0);
const SEAT_PARALLEL = String(args['seat-parallel'] || 1);
const OBSERVE_AFTER_MIN = Number(args['observe-after'] || 0); // keep watching instances / players after the last step (scale-in)
const OUT = path.resolve(args.out || path.join(here, '../../docs/loadtest/Test1-Poker777'));
const TF_DIR = path.join(here, '../../infra/terraform-test');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => console.log(`[${new Date().toLocaleTimeString()}]`, ...parts);
const thai = (date) => new Date(date).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

// ---------- what to measure (names from terraform state) ----------
const state = JSON.parse(fs.readFileSync(path.join(TF_DIR, 'terraform.tfstate'), 'utf8'));
const attrs = (type, name) => state.resources.filter((r) => r.type === type && r.name === name).flatMap((r) => r.instances.map((i) => i.attributes));
const one = (type, name) => attrs(type, name)[0];
const R = {
  region: one('aws_lb', 'public').arn.split(':')[3],
  dns: one('aws_lb', 'public').dns_name,
  pubAlb: one('aws_lb', 'public').arn_suffix,
  intAlb: one('aws_lb', 'internal').arn_suffix,
  asgBack: one('aws_autoscaling_group', 'backend').name,
  asgFront: one('aws_autoscaling_group', 'frontend').name,
  writer: one('aws_db_instance', 'writer').identifier,
  readers: ['reader_1', 'reader_2', 'reader_3'].flatMap((name) => attrs('aws_db_instance', name)).map((a) => a.identifier),
  redis: [...one('aws_elasticache_replication_group', 'redis').member_clusters].sort(),
};
R.dbs = [R.writer, ...R.readers];
const BASE = `http://${R.dns}`;
const short = (id) => id.replace('poker777-prod-', '');

function credentials() {
  try {
    const text = fs.readFileSync(path.join(TF_DIR, 'lab.auto.tfvars'), 'utf8');
    const get = (key) => (text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || '';
    const accessKeyId = get('aws_access_key');
    if (accessKeyId) return { accessKeyId, secretAccessKey: get('aws_secret_key'), sessionToken: get('aws_session_token') || undefined };
  } catch { /* fall back to the default chain */ }
  return undefined;
}
const aws = { region: R.region, credentials: credentials() };
const cw = new CloudWatchClient(aws);
const ssm = new SSMClient(aws);
const asg = new AutoScalingClient(aws);

// ---------- graphs ----------
const ALB = 'AWS/ApplicationELB';
const perDb = (metric, stat, extra = {}) => R.dbs.map((id) => ['AWS/RDS', metric, 'DBInstanceIdentifier', id, { stat, label: short(id), ...extra }]);
const GRAPHS = [
  ['01-alb-response-time', 'Public ALB response time (s) — REST requests, time inside AWS', [
    [ALB, 'TargetResponseTime', 'LoadBalancer', R.pubAlb, { stat: 'p50', label: 'p50' }],
    ['...', { stat: 'p95', label: 'p95' }], ['...', { stat: 'p99', label: 'p99' }],
    [ALB, 'TargetResponseTime', 'LoadBalancer', R.intAlb, { stat: 'p95', label: 'internal ALB p95' }]]],
  ['02-alb-requests-errors', 'Requests and errors per minute', [
    [ALB, 'RequestCount', 'LoadBalancer', R.pubAlb, { stat: 'Sum', label: 'requests' }],
    ['.', 'HTTPCode_Target_5XX_Count', '.', '.', { stat: 'Sum', label: '5xx backend', yAxis: 'right' }],
    ['.', 'HTTPCode_ELB_5XX_Count', '.', '.', { stat: 'Sum', label: '5xx ALB', yAxis: 'right' }],
    ['.', 'HTTPCode_Target_4XX_Count', '.', '.', { stat: 'Sum', label: '4xx (incl. 429 rate limit)', yAxis: 'right' }]]],
  ['03-alb-connections', 'Connections: open (1 WebSocket = 1 player) and new per minute', [
    [ALB, 'ActiveConnectionCount', 'LoadBalancer', R.pubAlb, { stat: 'Sum', label: 'public ALB open' }],
    ['.', '.', '.', R.intAlb, { stat: 'Sum', label: 'internal ALB open' }],
    ['.', 'NewConnectionCount', '.', R.pubAlb, { stat: 'Sum', label: 'public ALB new', yAxis: 'right' }]]],
  ['04-ec2-cpu', 'EC2 CPU % (t3.micro has 2 vCPU: Node.js uses one, so 50 % = that core is full)', [
    ['AWS/EC2', 'CPUUtilization', 'AutoScalingGroupName', R.asgBack, { stat: 'Average', label: 'backend avg' }],
    ['...', { stat: 'Maximum', label: 'backend max' }],
    ['...', R.asgFront, { stat: 'Average', label: 'frontend avg' }]]],
  ['05-ec2-network', 'Backend network (bytes/min)', [
    ['AWS/EC2', 'NetworkIn', 'AutoScalingGroupName', R.asgBack, { stat: 'Sum', label: 'in' }],
    ['.', 'NetworkOut', '.', '.', { stat: 'Sum', label: 'out' }]]],
  ['06-rds-cpu', 'RDS CPU % (all instances)', perDb('CPUUtilization', 'Average')],
  ['07-rds-connections', 'RDS connections', perDb('DatabaseConnections', 'Maximum')],
  ['08-rds-writer-disk', 'RDS writer: write IOPS and write latency', [
    ['AWS/RDS', 'WriteIOPS', 'DBInstanceIdentifier', R.writer, { stat: 'Average', label: 'write IOPS' }],
    ['.', 'WriteLatency', '.', '.', { stat: 'Average', label: 'write latency (s)', yAxis: 'right' }]]],
  ['09-rds-replica-lag', 'Read replica lag (s)', R.readers.map((id) => ['AWS/RDS', 'ReplicaLag', 'DBInstanceIdentifier', id, { stat: 'Maximum', label: short(id) }])],
  ['10-rds-read-traffic', 'RDS reads: read IOPS per instance (replicas serve room list / history)', perDb('ReadIOPS', 'Average')],
  ['11-rds-memory', 'RDS free memory (bytes)', perDb('FreeableMemory', 'Minimum')],
  ['12-redis-cpu-connections', 'Redis: CPU % and connections', [
    ...R.redis.map((id) => ['AWS/ElastiCache', 'EngineCPUUtilization', 'CacheClusterId', id, { stat: 'Average', label: `${id} CPU` }]),
    ...R.redis.map((id) => ['AWS/ElastiCache', 'CurrConnections', 'CacheClusterId', id, { stat: 'Maximum', label: `${id} conn`, yAxis: 'right' }])]],
  ['13-redis-memory-network', 'Redis: memory used and network out', [
    ...R.redis.map((id) => ['AWS/ElastiCache', 'BytesUsedForCache', 'CacheClusterId', id, { stat: 'Maximum', label: `${id} memory` }]),
    ...R.redis.map((id) => ['AWS/ElastiCache', 'NetworkBytesOut', 'CacheClusterId', id, { stat: 'Sum', label: `${id} net out`, yAxis: 'right' }])]],
  ['14-asg-instances', 'Auto Scaling: instances (desired / in service / starting)', [
    ['AWS/AutoScaling', 'GroupDesiredCapacity', 'AutoScalingGroupName', R.asgBack, { stat: 'Maximum', label: 'backend desired' }],
    ['.', 'GroupInServiceInstances', '.', '.', { stat: 'Maximum', label: 'backend in service' }],
    ['.', 'GroupPendingInstances', '.', '.', { stat: 'Maximum', label: 'backend starting' }],
    ['.', 'GroupInServiceInstances', '.', R.asgFront, { stat: 'Maximum', label: 'frontend in service' }]]],
];

// Backend instances seen during the test (Auto Scaling adds/removes them) — for the per-instance CPU graph.
const BACKEND_IDS = new Set();
const PLAYERS_NS = 'Poker777/LoadTest';
let playersMetric = false; // set once player counts reach CloudWatch (graph 16)
const perInstanceGraph = () => (BACKEND_IDS.size ? [
  ['15-backend-cpu-per-instance', 'Backend CPU % per instance (50 % = one core full)',
    [...BACKEND_IDS].map((id) => ['AWS/EC2', 'CPUUtilization', 'InstanceId', id, { stat: 'Average', label: id }])],
  ...(playersMetric ? [['16-players-per-instance', 'Player connections per backend instance (WebSockets on :4000)',
    [...BACKEND_IDS].map((id) => [PLAYERS_NS, 'PlayerConnections', 'InstanceId', id, { stat: 'Maximum', label: id }])]] : []),
] : []);

async function saveGraph(dir, file, title, metrics, start, end, annotations) {
  const widget = {
    title, metrics, view: 'timeSeries', stacked: false, period: 60, width: 1000, height: 420,
    start: start.toISOString(), end: end.toISOString(), timezone: '+0700', legend: { position: 'bottom' },
    ...(annotations ? { annotations: { vertical: annotations } } : {}),
  };
  try {
    const out = await cw.send(new GetMetricWidgetImageCommand({ MetricWidget: JSON.stringify(widget), OutputFormat: 'png' }));
    fs.writeFileSync(path.join(dir, `${file}.png`), out.MetricWidgetImage);
  } catch (error) {
    log(`  graph ${file} failed: ${error.name}: ${error.message}`);
  }
}

async function saveGraphs(dir, label, start, end, annotations) {
  for (const [file, title, metrics] of [...GRAPHS, ...perInstanceGraph()]) await saveGraph(dir, file, `${title} — ${label}`, metrics, start, end, annotations);
}

// ---------- numbers ----------
const q = (id, namespace, metric, dims, stat) => ({ Id: id, MetricStat: { Metric: { Namespace: namespace, MetricName: metric, Dimensions: Object.entries(dims).map(([Name, Value]) => ({ Name, Value })) }, Period: 60, Stat: stat } });
const QUERIES = [
  q('alb_p50', ALB, 'TargetResponseTime', { LoadBalancer: R.pubAlb }, 'p50'),
  q('alb_p95', ALB, 'TargetResponseTime', { LoadBalancer: R.pubAlb }, 'p95'),
  q('alb_p99', ALB, 'TargetResponseTime', { LoadBalancer: R.pubAlb }, 'p99'),
  q('int_p95', ALB, 'TargetResponseTime', { LoadBalancer: R.intAlb }, 'p95'),
  q('requests', ALB, 'RequestCount', { LoadBalancer: R.pubAlb }, 'Sum'),
  q('t5xx', ALB, 'HTTPCode_Target_5XX_Count', { LoadBalancer: R.pubAlb }, 'Sum'),
  q('e5xx', ALB, 'HTTPCode_ELB_5XX_Count', { LoadBalancer: R.pubAlb }, 'Sum'),
  q('t4xx', ALB, 'HTTPCode_Target_4XX_Count', { LoadBalancer: R.pubAlb }, 'Sum'),
  q('conns', ALB, 'ActiveConnectionCount', { LoadBalancer: R.pubAlb }, 'Sum'),
  q('newconns', ALB, 'NewConnectionCount', { LoadBalancer: R.pubAlb }, 'Sum'),
  q('lcu', ALB, 'ConsumedLCUs', { LoadBalancer: R.pubAlb }, 'Sum'),
  q('back_cpu_avg', 'AWS/EC2', 'CPUUtilization', { AutoScalingGroupName: R.asgBack }, 'Average'),
  q('back_cpu_max', 'AWS/EC2', 'CPUUtilization', { AutoScalingGroupName: R.asgBack }, 'Maximum'),
  q('front_cpu_avg', 'AWS/EC2', 'CPUUtilization', { AutoScalingGroupName: R.asgFront }, 'Average'),
  q('back_net_in', 'AWS/EC2', 'NetworkIn', { AutoScalingGroupName: R.asgBack }, 'Sum'),
  q('back_net_out', 'AWS/EC2', 'NetworkOut', { AutoScalingGroupName: R.asgBack }, 'Sum'),
  ...R.dbs.flatMap((id, i) => [
    q(`db${i}_cpu`, 'AWS/RDS', 'CPUUtilization', { DBInstanceIdentifier: id }, 'Average'),
    q(`db${i}_conn`, 'AWS/RDS', 'DatabaseConnections', { DBInstanceIdentifier: id }, 'Maximum'),
    q(`db${i}_riops`, 'AWS/RDS', 'ReadIOPS', { DBInstanceIdentifier: id }, 'Average'),
    q(`db${i}_mem`, 'AWS/RDS', 'FreeableMemory', { DBInstanceIdentifier: id }, 'Minimum'),
  ]),
  q('db0_wiops', 'AWS/RDS', 'WriteIOPS', { DBInstanceIdentifier: R.writer }, 'Average'),
  q('db0_wlat', 'AWS/RDS', 'WriteLatency', { DBInstanceIdentifier: R.writer }, 'Average'),
  ...R.readers.map((id, i) => q(`lag${i + 1}`, 'AWS/RDS', 'ReplicaLag', { DBInstanceIdentifier: id }, 'Maximum')),
  ...R.redis.flatMap((id, i) => [
    q(`redis${i}_cpu`, 'AWS/ElastiCache', 'EngineCPUUtilization', { CacheClusterId: id }, 'Average'),
    q(`redis${i}_mem`, 'AWS/ElastiCache', 'BytesUsedForCache', { CacheClusterId: id }, 'Maximum'),
    q(`redis${i}_net`, 'AWS/ElastiCache', 'NetworkBytesOut', { CacheClusterId: id }, 'Sum'),
    q(`redis${i}_conn`, 'AWS/ElastiCache', 'CurrConnections', { CacheClusterId: id }, 'Maximum'),
  ]),
];

// Returns the step's numbers and writes timeseries.csv (one row per minute, one column per metric).
async function stepNumbers(start, end, dir) {
  const out = await cw.send(new GetMetricDataCommand({ MetricDataQueries: QUERIES, StartTime: start, EndTime: end }));
  const series = Object.fromEntries(out.MetricDataResults.map((r) => [r.Id, (r.Timestamps || []).map((t, i) => [new Date(t).getTime(), r.Values[i]])]));
  if (dir) {
    const times = [...new Set(Object.values(series).flatMap((rows) => rows.map(([t]) => t)))].sort();
    const ids = QUERIES.map((x) => x.Id);
    const lookup = Object.fromEntries(ids.map((id) => [id, new Map(series[id] || [])]));
    const lines = [['time_th', ...ids].join(',')];
    for (const t of times) lines.push([thai(t), ...ids.map((id) => lookup[id].get(t) ?? '')].join(','));
    fs.writeFileSync(path.join(dir, 'timeseries.csv'), lines.join('\n'));
  }
  const vals = (id) => (series[id] || []).map(([, v]) => v);
  const max = (id) => (vals(id).length ? Math.max(...vals(id)) : null);
  const sum = (id) => vals(id).reduce((a, b) => a + b, 0);
  const avg = (id) => (vals(id).length ? sum(id) / vals(id).length : null);
  const ms = (x) => (x === null ? null : x * 1000);
  const mb = (x) => (x === null ? null : x / 1048576);
  const requests = sum('requests');
  const minutes = Math.max(1, (end - start) / 60000);
  return {
    minutes_measured: +minutes.toFixed(1),
    alb_p50_ms: ms(max('alb_p50')), alb_p95_ms: ms(max('alb_p95')), alb_p99_ms: ms(max('alb_p99')), internal_alb_p95_ms: ms(max('int_p95')),
    requests, requests_per_min: requests / minutes, http_5xx: sum('t5xx') + sum('e5xx'), http_4xx: sum('t4xx'),
    error_rate_5xx_pct: requests ? ((sum('t5xx') + sum('e5xx')) / requests) * 100 : 0,
    alb_connections_max: max('conns'), alb_new_connections: sum('newconns'), alb_lcu: sum('lcu'),
    backend_cpu_avg_pct: avg('back_cpu_avg'), backend_cpu_max_pct: max('back_cpu_max'), frontend_cpu_avg_pct: avg('front_cpu_avg'),
    backend_net_in_mb: mb(sum('back_net_in')), backend_net_out_mb: mb(sum('back_net_out')),
    rds: Object.fromEntries(R.dbs.map((id, i) => [short(id), {
      cpu_avg_pct: avg(`db${i}_cpu`), cpu_max_pct: max(`db${i}_cpu`), connections_max: max(`db${i}_conn`),
      read_iops_avg: avg(`db${i}_riops`), free_memory_min_mb: vals(`db${i}_mem`).length ? mb(Math.min(...vals(`db${i}_mem`))) : null,
    }])),
    rds_write_iops_avg: avg('db0_wiops'), rds_write_latency_ms: ms(avg('db0_wlat')),
    replica_lag_max_s: Math.max(...R.readers.map((_, i) => max(`lag${i + 1}`) ?? 0)),
    redis: Object.fromEntries(R.redis.map((id, i) => [id, {
      cpu_avg_pct: avg(`redis${i}_cpu`), cpu_max_pct: max(`redis${i}_cpu`), memory_max_mb: mb(max(`redis${i}_mem`)),
      net_out_mb: mb(sum(`redis${i}_net`)), connections_max: max(`redis${i}_conn`),
    }])),
  };
}

// ---------- backend instance (SSM Run Command) ----------
async function backendInstance() {
  const group = (await asg.send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [R.asgBack] }))).AutoScalingGroups[0];
  return group.Instances.find((i) => i.LifecycleState === 'InService')?.InstanceId;
}

async function runOnBackend(script, { raw = false, instanceId: wanted } = {}) {
  try {
    const instanceId = wanted || await backendInstance();
    const sent = await ssm.send(new SendCommandCommand({ InstanceIds: [instanceId], DocumentName: 'AWS-RunShellScript', Parameters: { commands: [script] } }));
    for (let i = 0; i < 30; i += 1) {
      await sleep(3000);
      const r = await ssm.send(new GetCommandInvocationCommand({ CommandId: sent.Command.CommandId, InstanceId: instanceId })).catch(() => null);
      if (r && ['Success', 'Failed', 'TimedOut', 'Cancelled'].includes(r.Status)) {
        if (raw) return r.StandardOutputContent || '';
        const line = (r.StandardOutputContent || '').split('\n').find((l) => l.startsWith('DBJSON'));
        if (line) return JSON.parse(line.slice(6));
        log(`  backend command: ${r.Status} ${r.StandardErrorContent || ''}`.trim());
        return null;
      }
    }
  } catch (error) {
    log(`  backend command failed: ${error.name}: ${error.message}`);
  }
  return null;
}

const DB_SCRIPT = `cd /opt/poker777/backend && node --env-file=/etc/poker777/backend.env -e 'import("./src/config/db.js").then(async ({ pool }) => { for (const t of ["users","wallets","transactions","hand_results","tables"]) await pool.query("ANALYZE TABLE " + t); const [r] = await pool.query("SELECT table_name AS t, table_rows AS rows_, avg_row_length AS avg, data_length AS data, index_length AS idx FROM information_schema.tables WHERE table_schema = DATABASE()"); const [[c]] = await pool.query("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM hand_results) AS hand_results, (SELECT COUNT(*) FROM transactions) AS transactions"); console.log("DBJSON" + JSON.stringify({ tables: r, counts: c })); process.exit(0); })' 2>/dev/null | grep DBJSON`;

async function measureDb(label) {
  const result = await runOnBackend(DB_SCRIPT);
  return result ? { label, at: new Date().toISOString(), ...result } : null;
}

// Memory / CPU of the backend's Node process and the machine, half-way through a step.
async function sampleBackend(instanceId) {
  const text = await runOnBackend('date; uptime; free -m; echo; ps -o pid,rss,vsz,pcpu,etime,nlwp,cmd -C node; echo; ss -s | head -3', { raw: true, instanceId });
  const rss = text && text.match(/^\s*\d+\s+(\d+)\s+\d+\s+([\d.]+)\s+\S+\s+\d+\s+\/usr\/bin\/node src\/server\.js/m);
  const memLine = text && text.match(/^Mem:\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\s+\d+\s+(\d+)/m);
  return {
    instance: instanceId || null,
    text: text || '(sample failed)',
    node_rss_mb: rss ? +(Number(rss[1]) / 1024).toFixed(1) : null,
    node_cpu_pct_lifetime: rss ? Number(rss[2]) : null,
    machine_mem_total_mb: memLine ? Number(memLine[1]) : null,
    machine_mem_used_mb: memLine ? Number(memLine[2]) : null,
    machine_mem_available_mb: memLine ? Number(memLine[4]) : null,
  };
}

async function sampleAllBackends() {
  const group = (await asg.send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [R.asgBack] }))).AutoScalingGroups[0];
  const ids = group.Instances.filter((i) => i.LifecycleState === 'InService').map((i) => i.InstanceId);
  const samples = [];
  for (const id of ids) samples.push(await sampleBackend(id));
  return samples;
}

// Every 30 s: backend group size and instances -> asg-timeline.csv (shows when Auto Scaling adds/removes instances).
const ASG_TIMELINE = [];
async function pollAsg() {
  try {
    const groups = (await asg.send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [R.asgBack, R.asgFront] }))).AutoScalingGroups;
    const back = groups.find((g) => g.AutoScalingGroupName === R.asgBack);
    const front = groups.find((g) => g.AutoScalingGroupName === R.asgFront);
    back.Instances.forEach((i) => BACKEND_IDS.add(i.InstanceId));
    const count = (g, state) => g.Instances.filter((i) => i.LifecycleState.startsWith(state)).length;
    ASG_TIMELINE.push({ at: Date.now(), time_th: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }), backend_desired: back.DesiredCapacity,
      backend_in_service: count(back, 'InService'), backend_pending: count(back, 'Pending'), backend_terminating: count(back, 'Terminating'),
      frontend_in_service: count(front, 'InService'), backend_instances: back.Instances.map((i) => `${i.InstanceId}:${i.LifecycleState}`).join(' ') });
  } catch (error) { log(`  ASG poll failed: ${error.message}`); }
}
function writeAsgTimeline() {
  if (!ASG_TIMELINE.length) return;
  const cols = Object.keys(ASG_TIMELINE[0]);
  fs.writeFileSync(path.join(OUT, 'asg-timeline.csv'), [cols.join(','), ...ASG_TIMELINE.map((r) => cols.map((c) => r[c]).join(','))].join('\n'));
}

// Every minute: established connections on the backend port of each instance (≈ players: one WebSocket each, plus a
// handful of ALB health-check / REST keep-alive connections) -> players-per-instance.csv and a custom CloudWatch metric.
const PLAYER_COUNTS = [];
const COUNT_SCRIPT = "ss -Htn state established '( sport = :4000 )' | wc -l";
let counting = false;
async function countPlayers() {
  if (counting) return;
  counting = true;
  try {
    const group = (await asg.send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [R.asgBack] }))).AutoScalingGroups[0];
    const ids = group.Instances.filter((i) => i.LifecycleState === 'InService').map((i) => i.InstanceId);
    const at = Date.now();
    const counts = (await Promise.all(ids.map(async (id) => {
      const out = String(await runOnBackend(COUNT_SCRIPT, { raw: true, instanceId: id }) ?? '').trim();
      return /^\d+$/.test(out) ? [id, Number(out)] : null;
    }))).filter(Boolean);
    if (!counts.length) return;
    PLAYER_COUNTS.push({ at, time_th: thai(at), counts: Object.fromEntries(counts) });
    await cw.send(new PutMetricDataCommand({ Namespace: PLAYERS_NS, MetricData: counts.map(([id, n]) => ({
      MetricName: 'PlayerConnections', Dimensions: [{ Name: 'InstanceId', Value: id }], Value: n, Unit: 'Count', Timestamp: new Date(at) })) }));
    playersMetric = true;
  } catch (error) {
    log(`  player count failed: ${error.name}: ${error.message}`);
  } finally {
    counting = false;
  }
}
function writePlayerCounts() {
  if (!PLAYER_COUNTS.length) return;
  const ids = [...new Set(PLAYER_COUNTS.flatMap((r) => Object.keys(r.counts)))];
  fs.writeFileSync(path.join(OUT, 'players-per-instance.csv'), [['time_th', ...ids, 'total'].join(','),
    ...PLAYER_COUNTS.map((r) => [r.time_th, ...ids.map((id) => r.counts[id] ?? ''), Object.values(r.counts).reduce((a, b) => a + b, 0)].join(','))].join('\n'));
}

// Test stack only: give every bot_ account the same wallet so bots that lost their chips can sit again.
// The script is base64-encoded so no shell/JS quoting can break the SQL.
async function refillBots(amount) {
  const js = `import("./src/config/db.js").then(async ({ pool }) => {
    const [r] = await pool.query("UPDATE wallets w JOIN users u ON u.id = w.user_id SET w.balance = ? WHERE u.username LIKE 'bot\\\\_%'", [${amount}]);
    console.log("DBJSON" + JSON.stringify({ updated: r.affectedRows, balance: ${amount} }));
    process.exit(0);
  });`;
  const b64 = Buffer.from(js).toString('base64');
  return runOnBackend(`cd /opt/poker777/backend && echo ${b64} | base64 -d > ./refill-tmp.mjs && node --env-file=/etc/poker777/backend.env ./refill-tmp.mjs; rm -f ./refill-tmp.mjs`);
}

// Test stack only: create bot accounts straight in the database instead of through /auth/register (10 a minute per IP).
// Runs on a backend instance in batches: one bcrypt hash per batch, users + wallets + the same welcome-bonus ledger row
// that registering writes, and tokens signed there with the stack's own JWT secret (it never leaves the instance).
// Output is gzipped because SSM returns at most 24,000 characters of stdout.
const SEED_BATCH = 250; // ~17 KB of gzipped output per batch
async function seedBatch(names, password) {
  const js = `import("./src/config/db.js").then(async ({ pool }) => {
    const { env } = await import("./src/config/env.js");
    const { jwt } = await import("./src/middleware/auth.js");
    const bcrypt = (await import("bcryptjs")).default;
    const zlib = await import("node:zlib");
    const names = ${JSON.stringify(names)};
    const hash = await bcrypt.hash(${JSON.stringify(password)}, 10);
    const bonus = env.economy.welcomeBonus;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("INSERT INTO users (username, email, password_hash) VALUES ?", [names.map((n) => [n, n + "@bots.poker777.test", hash])]);
      const [rows] = await conn.query("SELECT id, username FROM users WHERE username IN (?)", [names]);
      await conn.query("INSERT INTO wallets (user_id, balance) VALUES ?", [rows.map((r) => [r.id, bonus])]);
      await conn.query("INSERT INTO transactions (user_id, type, amount, balance_after, ref_id) VALUES ?", [rows.map((r) => [r.id, "BONUS", bonus, bonus, "register:" + r.id])]);
      await conn.commit();
      const out = rows.map((r) => ({ id: String(r.id), username: r.username,
        token: jwt.sign({ sub: String(r.id), username: r.username }, env.jwt.secret, { expiresIn: env.jwt.expiresIn, issuer: env.jwt.issuer }) }));
      console.log("DBJSON" + JSON.stringify({ gz: zlib.gzipSync(JSON.stringify(out)).toString("base64") }));
    } catch (error) {
      await conn.rollback();
      console.log("DBJSON" + JSON.stringify({ error: error.message }));
    } finally { conn.release(); }
    process.exit(0);
  });`;
  const b64 = Buffer.from(js).toString('base64');
  const result = await runOnBackend(`cd /opt/poker777/backend && echo ${b64} | base64 -d > ./seed-tmp.mjs && node --env-file=/etc/poker777/backend.env ./seed-tmp.mjs; rm -f ./seed-tmp.mjs`);
  if (!result || result.error) throw new Error(result?.error || 'no output from the backend');
  return JSON.parse(zlib.gunzipSync(Buffer.from(result.gz, 'base64')).toString());
}

async function seedBots(count) {
  const storePath = path.join(here, '.bots.json');
  const store = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, 'utf8')) : {};
  store[BASE] ||= [];
  const tag = Math.random().toString(36).slice(2, 6);
  const password = `bot-pass-${Math.random().toString(36).slice(2, 12)}`;
  for (let done = 0; done < count; done += SEED_BATCH) {
    const names = Array.from({ length: Math.min(SEED_BATCH, count - done) }, (_, i) => `bot_s${tag}${String(done + i).padStart(5, '0')}`);
    const made = await seedBatch(names, password);
    store[BASE].push(...made.map((a) => ({ username: a.username, password, id: a.id, token: a.token, tokenAt: Date.now() })));
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2)); // after every batch: a failure later keeps what was made
    log(`  seeded ${done + made.length}/${count} (total bot accounts ${store[BASE].length})`);
  }
}

// ---------- bots ----------
const BOT_LINE = /\[([^\]]+)\] seated=(\d+)\/(\d+) actions=(\d+) hands=(\d+) latency p50=(\d+)ms p95=(\d+)ms(?: p99=(\d+)ms)? max=(\d+)ms(?: browse n=(\d+) p50=(\d+)ms p95=(\d+)ms limited=(\d+) failed=(\d+))? disconnects=(\d+) errors=(.*)$/;
function parseBotLine(line) {
  const m = line && line.match(BOT_LINE);
  if (!m) return null;
  const n = (i) => (m[i] === undefined ? null : Number(m[i]));
  return {
    at: m[1], seated: n(2), wanted: n(3), actions: n(4), hands: n(5), p50_ms: n(6), p95_ms: n(7), p99_ms: n(8), max_ms: n(9),
    browse_requests: n(10), browse_p50_ms: n(11), browse_p95_ms: n(12), browse_limited: n(13), browse_failed: n(14),
    disconnects: n(15), errors: m[16],
  };
}

function runBots(bots, dir) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(path.join(dir, 'bots.log'));
    const child = spawn(process.execPath, [path.join(here, 'loadtest.mjs'), '--base', BASE, '--bots', String(bots), '--minutes', String(MINUTES),
      '--per-room', PER_ROOM, '--browse-rps', BROWSE_RPS, '--seat-parallel', SEAT_PARALLEL, '--reuse-only'], { cwd: here });
    const timeline = [];
    let playStart = null; // the first stats line comes 10 s after every bot is seated
    let sample = null;
    const onData = (chunk) => {
      process.stdout.write(chunk);
      out.write(chunk);
      for (const line of String(chunk).split('\n')) {
        const parsed = parseBotLine(line.trim());
        if (!parsed) continue;
        timeline.push(parsed);
        if (!playStart) {
          playStart = new Date(Date.now() - 10_000);
          // half-way through the timed part
          sample = sleep(Math.max(30_000, (MINUTES * 60_000) / 2)).then(sampleAllBackends);
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', async (code) => {
      out.end();
      const cols = ['at', 'seated', 'actions', 'hands', 'p50_ms', 'p95_ms', 'p99_ms', 'max_ms', 'browse_requests', 'browse_p50_ms', 'browse_p95_ms', 'browse_limited', 'browse_failed', 'disconnects'];
      fs.writeFileSync(path.join(dir, 'bots-timeline.csv'), [cols.join(','), ...timeline.map((t) => cols.map((c) => t[c] ?? '').join(','))].join('\n'));
      resolve({ code, last: timeline.at(-1) || null, playStart, sample: sample ? await sample : null });
    });
  });
}

// ---------- reporting ----------
const fmt = (x, digits = 1) => (x === null || x === undefined || Number.isNaN(x) ? '–' : Number(x).toFixed(digits));

function stepSummary(step) {
  const b = step.botResult || {};
  const c = step.cloudwatch;
  const s = step.backendSample || {};
  return [
    `# Step ${step.step}: ${step.bots} bots (${MINUTES} min)`, '',
    `เวลา (ไทย): เริ่ม ${thai(step.start)} • บอทนั่งครบ ${thai(step.playStart)} • จบ ${thai(step.end)} — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (${c.minutes_measured} นาที)`, '',
    '## ผู้เล่น (ฝั่งบอท)', '', '| | |', '|---|---|',
    `| นั่งได้ | ${b.seated ?? '–'} / ${step.bots} |`,
    `| มือที่เล่น / การกระทำ | ${b.hands ?? '–'} / ${b.actions ?? '–'} |`,
    `| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | ${b.p50_ms ?? '–'} / ${b.p95_ms ?? '–'} / ${b.p99_ms ?? '–'} / ${b.max_ms ?? '–'} ms |`,
    `| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | ${b.browse_requests ?? '–'} / ${b.browse_p50_ms ?? '–'} / ${b.browse_p95_ms ?? '–'} ms / ${b.browse_limited ?? '–'} / ${b.browse_failed ?? '–'} |`,
    `| หลุดการเชื่อมต่อ | ${b.disconnects ?? '–'} |`, '',
    '## Load balancer', '', '| | |', '|---|---|',
    `| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | ${fmt(c.alb_p50_ms)} / ${fmt(c.alb_p95_ms)} / ${fmt(c.alb_p99_ms)} ms • internal ALB p95 ${fmt(c.internal_alb_p95_ms)} ms |`,
    `| Requests (ต่อนาที) / 5xx / 4xx | ${c.requests} (${fmt(c.requests_per_min)}) / ${c.http_5xx} / ${c.http_4xx} |`,
    `| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | ${fmt(c.alb_connections_max, 0)} / ${fmt(c.alb_new_connections, 0)} |`,
    `| ALB LCU (หน่วยคิดเงิน) | ${fmt(c.alb_lcu, 3)} |`, '',
    '## EC2', '', '| | |', '|---|---|',
    `| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | ${fmt(c.backend_cpu_avg_pct)} / ${fmt(c.backend_cpu_max_pct)} % |`,
    `| Frontend CPU เฉลี่ย | ${fmt(c.frontend_cpu_avg_pct)} % |`,
    `| Backend network in / out | ${fmt(c.backend_net_in_mb)} / ${fmt(c.backend_net_out_mb)} MB |`,
    ...(step.backendSamples?.length ? step.backendSamples : [s]).map((x) => `| ${x.instance ? `${x.instance}: ` : ''}Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก ${fmt(x.machine_mem_total_mb, 0)} MB) กลางขั้น | ${fmt(x.node_rss_mb)} / ${fmt(x.machine_mem_used_mb, 0)} / ${fmt(x.machine_mem_available_mb, 0)} MB |`),
    `| Backend instances ระหว่างขั้น | ${step.instances ? `${step.instances.min}–${step.instances.max} เครื่อง` : '–'} |`,
    `| ผู้เล่น (การเชื่อมต่อ :4000) ต่อเครื่อง ตอนท้ายขั้น | ${step.players ? Object.entries(step.players).map(([id, n]) => `${id} ${n}`).join(' • ') : '–'} |`, '',
    '## RDS', '', '| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |', '|---|---|---|---|---|',
    ...Object.entries(c.rds).map(([id, d]) => `| ${id} | ${fmt(d.cpu_avg_pct)} / ${fmt(d.cpu_max_pct)} % | ${fmt(d.connections_max, 0)} | ${fmt(d.read_iops_avg, 2)} | ${fmt(d.free_memory_min_mb, 0)} MB |`),
    '', `Writer: write IOPS ${fmt(c.rds_write_iops_avg)} • write latency ${fmt(c.rds_write_latency_ms, 2)} ms • replica lag สูงสุด ${fmt(c.replica_lag_max_s, 0)} s`, '',
    '## Redis', '', '| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |', '|---|---|---|---|---|',
    ...Object.entries(c.redis).map(([id, d]) => `| ${id} | ${fmt(d.cpu_avg_pct, 2)} / ${fmt(d.cpu_max_pct, 2)} % | ${fmt(d.memory_max_mb)} MB | ${fmt(d.net_out_mb)} MB | ${fmt(d.connections_max, 0)} |`),
    '', `Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): \`${b.errors ?? '–'}\``, '',
    'ไฟล์: ' + GRAPHS.map(([file]) => `[${file}](${file}.png)`).join(' • ') + ' • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)',
  ].join('\n');
}

function resultsCsv(summary) {
  const cols = ['step', 'bots', 'seated', 'start_th', 'play_start_th', 'end_th', 'hands', 'actions', 'bot_p50_ms', 'bot_p95_ms', 'bot_p99_ms', 'bot_max_ms', 'disconnects',
    'browse_requests', 'browse_p95_ms', 'alb_p50_ms', 'alb_p95_ms', 'alb_p99_ms', 'http_5xx', 'http_4xx', 'alb_conn_max', 'backend_cpu_avg', 'backend_cpu_max', 'node_rss_mb',
    'backend_net_out_mb', 'writer_cpu_avg', 'writer_cpu_max', 'readers_cpu_max', 'writer_conn_max', 'readers_read_iops', 'write_iops', 'write_latency_ms', 'replica_lag_max_s',
    'redis_cpu_max', 'redis_mem_mb'];
  const rows = summary.steps.map((s) => {
    const b = s.botResult || {};
    const c = s.cloudwatch;
    const readers = Object.entries(c.rds).filter(([id]) => id !== short(R.writer)).map(([, d]) => d);
    const redis = Object.values(c.redis);
    return [s.step, s.bots, b.seated, thai(s.start), thai(s.playStart), thai(s.end), b.hands, b.actions, b.p50_ms, b.p95_ms, b.p99_ms, b.max_ms, b.disconnects,
      b.browse_requests, b.browse_p95_ms, fmt(c.alb_p50_ms), fmt(c.alb_p95_ms), fmt(c.alb_p99_ms), c.http_5xx, c.http_4xx, fmt(c.alb_connections_max, 0),
      fmt(c.backend_cpu_avg_pct), fmt(c.backend_cpu_max_pct), fmt(s.backendSample?.node_rss_mb), fmt(c.backend_net_out_mb),
      fmt(c.rds[short(R.writer)].cpu_avg_pct), fmt(c.rds[short(R.writer)].cpu_max_pct), fmt(Math.max(...readers.map((d) => d.cpu_max_pct ?? 0))),
      fmt(c.rds[short(R.writer)].connections_max, 0), fmt(readers.reduce((a, d) => a + (d.read_iops_avg || 0), 0), 2), fmt(c.rds_write_iops_avg), fmt(c.rds_write_latency_ms, 2),
      fmt(c.replica_lag_max_s, 0), fmt(Math.max(...redis.map((d) => d.cpu_max_pct ?? 0)), 2), fmt(Math.max(...redis.map((d) => d.memory_max_mb ?? 0)))];
  });
  return [cols.join(','), ...rows.map((r) => r.map((v) => v ?? '').join(','))].join('\n');
}

// ---------- modes ----------
if (args['refill-bots']) {
  const amount = Math.max(100, Math.floor(Number(args['refill-bots']) || 1000));
  log('refill bot wallets:', JSON.stringify(await refillBots(amount)));
  process.exit(0);
}

if (args['seed-bots']) {
  const count = Math.floor(Number(args['seed-bots']));
  if (!(count > 0 && count <= 20000)) { log('--seed-bots needs a number of accounts to add (1-20000)'); process.exit(1); }
  log(`seeding ${count} bot accounts straight into the test database (${BASE})`);
  await seedBots(count);
  process.exit(0);
}

if (args.check === 'true') {
  const dir = path.join(OUT, '_check');
  fs.mkdirSync(dir, { recursive: true });
  await saveGraph(dir, GRAPHS[0][0], GRAPHS[0][1], GRAPHS[0][2], new Date(Date.now() - 1_800_000), new Date());
  log('graph saved:', fs.existsSync(path.join(dir, `${GRAPHS[0][0]}.png`)));
  log('db:', JSON.stringify(await measureDb('check')));
  log('backend samples:', JSON.stringify((await sampleAllBackends()).map((x) => ({ ...x, text: undefined }))));
  await pollAsg();
  log('asg:', JSON.stringify(ASG_TIMELINE.at(-1)));
  process.exit(0);
}

if (args.regraph === 'true') {
  // Redraw every step from summary.json once CloudWatch has the late data points.
  const saved = JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8'));
  (saved.instances || []).forEach((id) => BACKEND_IDS.add(id));
  playersMetric = Boolean(saved.playersMetric);
  for (const s of saved.steps) {
    const dir = path.join(OUT, `step${s.step}-${s.bots}bots`);
    const from = s.playStart ? new Date(s.playStart) : new Date(new Date(s.start).getTime() + 60_000);
    await saveGraphs(dir, `${s.bots} bots`, new Date(new Date(s.start).getTime() - 120_000), new Date(new Date(s.end).getTime() + 120_000));
    s.cloudwatch = await stepNumbers(from, new Date(s.end), dir);
    fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(s, null, 2));
    if (s.playStart) fs.writeFileSync(path.join(dir, 'summary.md'), stepSummary(s));
    log(`step ${s.step} redrawn`);
  }
  if (saved.baseline) {
    const dir = path.join(OUT, 'step0-baseline');
    fs.mkdirSync(dir, { recursive: true });
    saved.baseline.cloudwatch = await stepNumbers(new Date(saved.baseline.start), new Date(saved.baseline.end), dir);
    await saveGraphs(dir, 'baseline (no players)', new Date(saved.baseline.start), new Date(saved.baseline.end));
  }
  const marks = saved.steps.map((s) => ({ value: s.start, label: `${s.bots} bots` }));
  const from = new Date(new Date(saved.steps[0].start).getTime() - 360_000);
  const to = new Date(Math.max(new Date(saved.steps.at(-1).end).getTime() + 180_000, new Date(saved.observedUntil || 0).getTime()));
  fs.mkdirSync(path.join(OUT, 'overall'), { recursive: true });
  await saveGraphs(path.join(OUT, 'overall'), 'whole test', from, to, marks);
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(saved, null, 2));
  if (saved.steps.every((s) => s.playStart)) fs.writeFileSync(path.join(OUT, 'results.csv'), resultsCsv(saved));
  log('all graphs redrawn');
  process.exit(0);
}

// ---------- run ----------
fs.mkdirSync(OUT, { recursive: true });
log(`Poker777 stepped load test → ${BASE}`);
log(`steps ${STEPS.join(' → ')} bots, ${MINUTES} min each, ${PER_ROOM} per table, browse ${BROWSE_RPS}/s — results in ${OUT}`);
// --resume: keep the baseline and the steps that finished (bots seated) from an interrupted run, redo the rest.
const RESUME = args.resume === 'true' && fs.existsSync(path.join(OUT, 'summary.json'));
const summary = RESUME
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8'))
  : { base: BASE, region: R.region, resources: R, minutesPerStep: MINUTES, perRoom: Number(PER_ROOM), browseRps: Number(BROWSE_RPS), startedAt: new Date().toISOString(), db: [], steps: [] };
if (RESUME) {
  summary.steps = summary.steps.filter((s) => s.botResult?.seated === s.bots && STEPS[s.step - 1] === s.bots);
  summary.db = summary.db.filter((d) => d.label !== 'after');
  for (const s of summary.steps) for (const x of s.backendSamples || []) BACKEND_IDS.add(x.instance);
  const csv = fs.existsSync(path.join(OUT, 'asg-timeline.csv')) ? fs.readFileSync(path.join(OUT, 'asg-timeline.csv'), 'utf8').trim().split('\n') : [];
  const cols = csv.length ? csv[0].split(',') : [];
  for (const line of csv.slice(1)) {
    const v = line.split(',');
    ASG_TIMELINE.push(Object.fromEntries(cols.map((c, i) => [c, i === cols.length - 1 ? v.slice(i).join(',') : (c === 'time_th' ? v[i] : Number(v[i]))])));
  }
  log(`resume: keeping steps ${summary.steps.map((s) => s.bots).join(', ') || 'none'}`);
}

await pollAsg();
const asgPoller = setInterval(() => void pollAsg().then(writeAsgTimeline), 30_000);
const playerPoller = setInterval(() => void countPlayers().then(writePlayerCounts), 60_000);

// Baseline: the 5 minutes before the test, nobody playing.
if (!RESUME) {
  const dir = path.join(OUT, 'step0-baseline');
  fs.mkdirSync(dir, { recursive: true });
  const end = new Date(Date.now() - 60_000);
  const start = new Date(end.getTime() - 300_000);
  summary.baseline = { start: start.toISOString(), end: end.toISOString(), cloudwatch: await stepNumbers(start, end, dir) };
  const samples = await sampleAllBackends();
  const sample = samples[0] || { text: '(no instance)' };
  summary.baseline.backendSample = { ...sample, text: undefined };
  summary.baseline.backendSamples = samples.map((x) => ({ ...x, text: undefined }));
  fs.writeFileSync(path.join(dir, 'backend-sample.txt'), samples.map((x) => `### ${x.instance}\n${x.text}`).join('\n\n'));
  await saveGraphs(dir, 'baseline (no players)', start, end);
  log(`  baseline: backend CPU avg ${fmt(summary.baseline.cloudwatch.backend_cpu_avg_pct)}%, Node RSS ${fmt(sample.node_rss_mb)} MB`);
}

const db0 = RESUME ? null : await measureDb('before');
if (db0) { summary.db.push(db0); log('  DB before:', JSON.stringify(db0.counts)); }

for (const [index, bots] of STEPS.entries()) {
  if (summary.steps.some((s) => s.step === index + 1)) continue; // kept by --resume
  const dir = path.join(OUT, `step${index + 1}-${bots}bots`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  log(`=== step ${index + 1}/${STEPS.length}: ${bots} bots for ${MINUTES} min ===`);
  const start = new Date();
  const result = await runBots(bots, dir);
  const end = new Date();
  const playStart = result.playStart || new Date(start.getTime() + 60_000);
  const samples = result.sample || [];
  if (samples.length) fs.writeFileSync(path.join(dir, 'backend-sample.txt'), samples.map((x) => `### ${x.instance}\n${x.text}`).join('\n\n'));
  const inStep = ASG_TIMELINE.filter((r) => r.at >= start.getTime() && r.at <= end.getTime());
  log(`  bots done; waiting ${SETTLE_S}s for CloudWatch…`);
  await sleep(SETTLE_S * 1000);
  const numbers = await stepNumbers(playStart, end, dir);
  await saveGraphs(dir, `${bots} bots`, new Date(start.getTime() - 120_000), new Date(end.getTime() + 120_000));
  const step = {
    step: index + 1, bots, start: start.toISOString(), playStart: playStart.toISOString(), end: end.toISOString(),
    botResult: result.last, backendSample: samples[0] ? { ...samples[0], text: undefined } : null,
    backendSamples: samples.map((x) => ({ ...x, text: undefined })),
    instances: inStep.length ? { min: Math.min(...inStep.map((r) => r.backend_in_service)), max: Math.max(...inStep.map((r) => r.backend_in_service)) } : null,
    players: PLAYER_COUNTS.filter((r) => r.at >= playStart.getTime() && r.at <= end.getTime()).at(-1)?.counts || null,
    cloudwatch: numbers,
  };
  summary.steps.push(step);
  fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(step, null, 2));
  fs.writeFileSync(path.join(dir, 'summary.md'), stepSummary(step));
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'results.csv'), resultsCsv(summary));
  const b = step.botResult || {};
  log(`  step ${index + 1} saved: seated ${b.seated}/${bots}, bot p95 ${b.p95_ms}ms, ALB p95 ${fmt(numbers.alb_p95_ms)}ms, backend CPU max ${fmt(numbers.backend_cpu_max_pct)}%, `
    + `Node RSS ${fmt(step.backendSample?.node_rss_mb)} MB, writer CPU max ${fmt(numbers.rds[short(R.writer)].cpu_max_pct)}%`);
}

if (OBSERVE_AFTER_MIN > 0) {
  log(`  watching Auto Scaling for ${OBSERVE_AFTER_MIN} more min (no players) to record the scale-in…`);
  await sleep(OBSERVE_AFTER_MIN * 60_000);
  summary.observedUntil = new Date().toISOString();
}

const db1 = await measureDb('after');
if (db1) { summary.db.push(db1); log('  DB after:', JSON.stringify(db1.counts)); }
summary.finishedAt = new Date().toISOString();
clearInterval(asgPoller);
clearInterval(playerPoller);
writePlayerCounts();
summary.playersMetric = playersMetric;
await pollAsg();
writeAsgTimeline();
summary.instances = [...BACKEND_IDS];

const overall = path.join(OUT, 'overall');
fs.mkdirSync(overall, { recursive: true });
const marks = summary.steps.map((s) => ({ value: s.start, label: `${s.bots} bots` }));
await saveGraphs(overall, 'whole test', new Date(new Date(summary.steps[0].start).getTime() - 360_000), new Date(Math.max(new Date(summary.steps.at(-1).end).getTime() + 180_000, new Date(summary.observedUntil || 0).getTime())), marks);
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
log(`done. ${summary.steps.length} steps saved in ${OUT}`);
