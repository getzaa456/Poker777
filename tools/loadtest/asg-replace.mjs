// Rolling replacement for the test stack — Learner Lab denies autoscaling:StartInstanceRefresh, so do it by hand:
// terminate one instance that runs an old launch template version (the group keeps its size and boots a
// replacement from the latest version, which clones the branch again), wait until the replacement is
// healthy in the target group, then the next one. Frontend and backend groups run side by side.
//   node asg-replace.mjs                 # both groups
//   node asg-replace.mjs --only backend
//   node asg-replace.mjs --only backend --retire   # new instances already running: drop the old ones, shrink the group
//   node asg-replace.mjs --all-at-once             # idle stack: replace everything at once (~10 min, site down meanwhile)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, TerminateInstanceInAutoScalingGroupCommand } from '@aws-sdk/client-auto-scaling';
import { ElasticLoadBalancingV2Client, DescribeTargetHealthCommand } from '@aws-sdk/client-elastic-load-balancing-v2';

const here = path.dirname(fileURLToPath(import.meta.url));
const text = fs.readFileSync(path.join(here, '../../infra/terraform-test/lab.auto.tfvars'), 'utf8');
const get = (key) => (text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || '';
const aws = { region: 'us-east-1', credentials: get('aws_access_key') ? { accessKeyId: get('aws_access_key'), secretAccessKey: get('aws_secret_key'), sessionToken: get('aws_session_token') } : undefined };
const asg = new AutoScalingClient(aws);
const elb = new ElasticLoadBalancingV2Client(aws);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
const MAX_WAIT_MS = 25 * 60_000; // first boot: dnf + Node + npm ci (+ vite build) ≈ 6-10 min

async function group(name) {
  return (await asg.send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [name] }))).AutoScalingGroups[0];
}
async function healthy(g) {
  const states = (await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: g.TargetGroupARNs[0] }))).TargetHealthDescriptions;
  return new Map(states.map((s) => [s.Target.Id, s.TargetHealth.State]));
}

async function replace(name) {
  const tag = name.replace('poker777-prod-', '');
  for (;;) {
    const g = await group(name);
    const latest = String(g.LaunchTemplate?.Version);
    const old = g.Instances.filter((i) => String(i.LaunchTemplate?.Version) !== latest);
    if (!old.length) { console.log(`${now()} ${tag}: every instance runs launch template v${latest} — done`); return true; }
    const victim = old[0];
    console.log(`${now()} ${tag}: replacing ${victim.InstanceId} (v${victim.LaunchTemplate?.Version} → v${latest}), ${old.length} old left`);
    await asg.send(new TerminateInstanceInAutoScalingGroupCommand({ InstanceId: victim.InstanceId, ShouldDecrementDesiredCapacity: false }));
    const started = Date.now();
    let seen = '';
    for (;;) {
      await sleep(20_000);
      const now2 = await group(name);
      const health = await healthy(now2);
      const fresh = now2.Instances.filter((i) => String(i.LaunchTemplate?.Version) === latest && i.InstanceId !== victim.InstanceId);
      const status = fresh.map((i) => `${i.InstanceId}:${i.LifecycleState}/${health.get(i.InstanceId) || 'not registered'}`).join(' ');
      if (status !== seen) { console.log(`${now()} ${tag}:   ${status || 'waiting for the replacement to launch'}`); seen = status; }
      // done when the old one is gone and the group is back to full size with every instance in service and healthy
      const victimGone = !now2.Instances.some((i) => i.InstanceId === victim.InstanceId);
      const allReady = now2.Instances.length >= now2.DesiredCapacity
        && now2.Instances.every((i) => i.LifecycleState === 'InService' && health.get(i.InstanceId) === 'healthy');
      if (victimGone && allReady && fresh.length) break;
      if (Date.now() - started > MAX_WAIT_MS) { console.log(`${now()} ${tag}: replacement not healthy after 25 min — stopping (check /var/log/poker777-user-data.log)`); return false; }
    }
  }
}

// --retire: the group already has enough new instances (e.g. Auto Scaling just added them) — terminate the old
// ones and shrink the group instead of booting replacements. Only when the new ones alone cover the minimum.
async function retire(name) {
  const tag = name.replace('poker777-prod-', '');
  const g = await group(name);
  const latest = String(g.LaunchTemplate?.Version);
  const health = await healthy(g);
  const fresh = g.Instances.filter((i) => String(i.LaunchTemplate?.Version) === latest && i.LifecycleState === 'InService' && health.get(i.InstanceId) === 'healthy');
  const old = g.Instances.filter((i) => String(i.LaunchTemplate?.Version) !== latest);
  if (!old.length) { console.log(`${now()} ${tag}: no old instances`); return true; }
  if (fresh.length < g.MinSize) { console.log(`${now()} ${tag}: only ${fresh.length} healthy new instances (min ${g.MinSize}) — use the normal mode instead`); return false; }
  for (const i of old) {
    await asg.send(new TerminateInstanceInAutoScalingGroupCommand({ InstanceId: i.InstanceId, ShouldDecrementDesiredCapacity: true }));
    console.log(`${now()} ${tag}: terminated ${i.InstanceId} (v${i.LaunchTemplate?.Version}), group shrinks by one`);
  }
  return true;
}

// --all-at-once: nobody is using the test stack — terminate every old instance together (the site is down until
// the replacements boot, ~10 min) and shrink the group back to its minimum. Much faster than one by one.
async function allAtOnce(name) {
  const tag = name.replace('poker777-prod-', '');
  const g = await group(name);
  const latest = String(g.LaunchTemplate?.Version);
  const old = g.Instances.filter((i) => String(i.LaunchTemplate?.Version) !== latest);
  let size = g.DesiredCapacity;
  for (const i of old) {
    const shrink = size > g.MinSize;
    await asg.send(new TerminateInstanceInAutoScalingGroupCommand({ InstanceId: i.InstanceId, ShouldDecrementDesiredCapacity: shrink }));
    if (shrink) size -= 1;
    console.log(`${now()} ${tag}: terminated ${i.InstanceId}${shrink ? ' (group shrinks)' : ' (will be replaced)'}`);
  }
  const started = Date.now();
  let seen = '';
  for (;;) {
    await sleep(20_000);
    const g2 = await group(name);
    const health = await healthy(g2);
    const status = g2.Instances.map((i) => `${i.InstanceId}:v${i.LaunchTemplate?.Version}:${i.LifecycleState}/${health.get(i.InstanceId) || '-'}`).join(' ');
    if (status !== seen) { console.log(`${now()} ${tag}:   ${status}`); seen = status; }
    const fresh = g2.Instances.filter((i) => String(i.LaunchTemplate?.Version) === latest && i.LifecycleState === 'InService' && health.get(i.InstanceId) === 'healthy');
    if (fresh.length >= g2.DesiredCapacity && g2.Instances.length === g2.DesiredCapacity) { console.log(`${now()} ${tag}: ${fresh.length} new instances healthy — done`); return true; }
    if (Date.now() - started > MAX_WAIT_MS) { console.log(`${now()} ${tag}: not healthy after 25 min — check /var/log/poker777-user-data.log`); return false; }
  }
}

const names = ['poker777-prod-frontend', 'poker777-prod-backend'].filter((n) => !only || n.endsWith(only));
const mode = process.argv.includes('--retire') ? retire : process.argv.includes('--all-at-once') ? allAtOnce : replace;
const results = await Promise.all(names.map(mode));
process.exit(results.every(Boolean) ? 0 : 1);
