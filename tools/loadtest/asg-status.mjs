// Read-only: show the backend/frontend Auto Scaling Groups — size, instances, scaling policies, recent activity.
//   node asg-status.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, DescribePoliciesCommand, DescribeScalingActivitiesCommand } from '@aws-sdk/client-auto-scaling';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { ElasticLoadBalancingV2Client, DescribeTargetHealthCommand, DescribeTargetGroupsCommand } from '@aws-sdk/client-elastic-load-balancing-v2';

const here = path.dirname(fileURLToPath(import.meta.url));
const text = fs.readFileSync(path.join(here, '../../infra/terraform-test/lab.auto.tfvars'), 'utf8');
const get = (key) => (text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || '';
const aws = { region: 'us-east-1', credentials: get('aws_access_key') ? { accessKeyId: get('aws_access_key'), secretAccessKey: get('aws_secret_key'), sessionToken: get('aws_session_token') } : undefined };
const asg = new AutoScalingClient(aws);
const ec2 = new EC2Client(aws);
const elb = new ElasticLoadBalancingV2Client(aws);
const th = (d) => (d ? new Date(d).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) : '–');

for (const name of ['poker777-prod-backend', 'poker777-prod-frontend']) {
  const g = (await asg.send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [name] }))).AutoScalingGroups[0];
  if (!g) { console.log(`${name}: not found`); continue; }
  console.log(`\n=== ${name}: min ${g.MinSize} / desired ${g.DesiredCapacity} / max ${g.MaxSize} • launch template ${g.LaunchTemplate?.LaunchTemplateName ?? g.MixedInstancesPolicy?.LaunchTemplate?.LaunchTemplateSpecification?.LaunchTemplateName} v${g.LaunchTemplate?.Version ?? '?'} • health ${g.HealthCheckType} grace ${g.HealthCheckGracePeriod}s`);
  const ids = g.Instances.map((i) => i.InstanceId);
  const details = ids.length ? (await ec2.send(new DescribeInstancesCommand({ InstanceIds: ids }))).Reservations.flatMap((r) => r.Instances) : [];
  for (const i of g.Instances) {
    const d = details.find((x) => x.InstanceId === i.InstanceId);
    console.log(`  ${i.InstanceId}  ${i.LifecycleState}/${i.HealthStatus}  AZ ${i.AvailabilityZone}  launched ${th(d?.LaunchTime)}  monitoring ${d?.Monitoring?.State}`);
  }
  for (const arn of g.TargetGroupARNs) {
    const tg = (await elb.send(new DescribeTargetGroupsCommand({ TargetGroupArns: [arn] }))).TargetGroups[0];
    const health = (await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: arn }))).TargetHealthDescriptions;
    console.log(`  target group ${tg.TargetGroupName}: ${health.map((h) => `${h.Target.Id}=${h.TargetHealth.State}${h.TargetHealth.Reason ? `(${h.TargetHealth.Reason})` : ''}`).join(', ') || 'no targets'}`);
  }
  const policies = (await asg.send(new DescribePoliciesCommand({ AutoScalingGroupName: name }))).ScalingPolicies;
  if (!policies.length) console.log('  scaling policies: none');
  for (const p of policies) {
    const t = p.TargetTrackingConfiguration;
    console.log(`  policy "${p.PolicyName}": ${p.PolicyType}${t ? ` • ${t.PredefinedMetricSpecification?.PredefinedMetricType ?? 'custom'} target ${t.TargetValue} • scale-in ${t.DisableScaleIn ? 'disabled' : 'enabled'}` : ''} • warmup ${p.EstimatedInstanceWarmup ?? '–'}s • enabled ${p.Enabled}`);
    for (const a of p.Alarms || []) console.log(`    alarm ${a.AlarmName}`);
  }
  const acts = (await asg.send(new DescribeScalingActivitiesCommand({ AutoScalingGroupName: name, MaxRecords: 6 }))).Activities;
  for (const a of acts) console.log(`  [${th(a.StartTime)}] ${a.StatusCode}: ${a.Description}${a.Cause ? `\n      cause: ${a.Cause.slice(0, 220)}` : ''}`);
}
