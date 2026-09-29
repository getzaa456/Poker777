# Poker777 AWS Deployment (Terraform)

This runbook describes a production-oriented deployment with EC2 Auto Scaling Groups (ASGs), two Application Load Balancers (ALBs), ElastiCache, and RDS for MySQL. Terraform provisions the infrastructure; the ASGs run the existing Dockerized services.

## Target topology and important decisions

- The internet-facing ALB serves HTTPS and sends website requests to the frontend ASG on port `3000`.
- Frontend instances run Nginx. Nginx serves the static app and proxies API paths and `/ws` to the internal ALB. The browser therefore uses one public origin; it never connects directly to the private backend or Redis.
- The internal ALB is private and sends HTTP/WebSocket requests to the backend ASG on port `4000`.
- Backend instances live in private subnets. The requested frontend instances can live in public subnets, but their security group must allow inbound application traffic only from the internet-facing ALB. Prefer disabling SSH and using Systems Manager Session Manager. Public-subnet instances need controlled egress (public IPv4 plus a restrictive security group, or a revised private-subnet design).
- RDS instances and ElastiCache live in private subnets, with security-group ingress only from the backend security group.
- Use at least two Availability Zones for ALBs and ASGs. Create private database/cache subnet groups spanning those AZs.

### RDS: four-instance topology is not automatic failover

The requested layout is one MySQL writer plus three asynchronous, read-only RDS read replicas distributed across two AZs. A read replica can lag and is not a synchronous standby. Promotion/failover and changing the writer endpoint must be handled explicitly unless a separate HA configuration is enabled. Enabling Multi-AZ for the writer adds a managed standby that is not a readable replica and is in addition to the four requested database instances.

The current application has one MySQL pool (`DB_HOST`) and sends all queries, including writes and transactions, to that host. It does not use read replicas. Initially point `DB_HOST` to the writer endpoint; provision replicas only if needed, and do not expect them to increase application read capacity until read/write routing is implemented and tested. Route wallet, authentication, table mutations, transactions, and read-after-write requests to the writer. Only explicitly safe, read-only queries should use a reader endpoint. Run schema migrations once against the writer, never against each replica.

## 1. Prepare the AWS account

1. Use the Learner Lab account and configure its temporary AWS credentials. This lab permits only `us-east-1` and `us-west-2`; Terraform input validation enforces that restriction. Install AWS CLI, Terraform, and Docker.
2. Use a domain registered outside Learner Lab; the lab does not allow domain registration. Create/validate an ACM certificate in the ALB region for the public site hostname (for example `poker.example.com`). If the frontend and API use separate public hostnames, validate both; this topology uses one hostname.
3. Create an S3 bucket for Terraform state with versioning and server-side encryption. Configure state locking using an S3 lockfile supported by your Terraform version or a DynamoDB lock table. Restrict access to the state: Terraform state can contain sensitive values.
4. Set AWS Budgets and CloudWatch alarms. RDS, NAT Gateways, ALBs, and replicas have ongoing costs; four RDS instances plus a Multi-AZ writer standby are a substantial database footprint.

### Create the required AWS prerequisites

Create these resources in the same AWS account. Use the region you intend to deploy into for ACM, Secrets Manager, and the Terraform state bucket. Never paste access keys or secret values into this guide or commit them to Git.

#### 1. Create the Terraform state bucket

Terraform needs its S3 state bucket before `terraform init` can succeed.

1. In the AWS Console, open **S3** and choose **Create bucket**.
2. Choose a globally unique bucket name, select your deployment region, keep **Block all public access** enabled, and create the bucket.
3. Open the bucket's **Properties**, enable **Bucket Versioning**, and enable default server-side encryption. Keep the bucket private.
4. Copy the bucket name into `bucket` in your local `infra/terraform/backend.hcl`. This project uses S3 native lockfiles (`use_lockfile = true`), so a separate DynamoDB lock table is not required.

#### 2. Create or connect a domain to Route 53

Route 53 DNS hosting does not automatically give you a domain name. Use a domain you already own, register one through Route 53 Domains if available for your account/TLD, or buy one from another registrar.

1. In the AWS Console, open **Route 53 > Hosted zones > Create hosted zone**.
2. Enter the root domain you own, such as `example.com`, choose **Public hosted zone**, and create it.
3. Open the hosted zone and copy its **Hosted zone ID**. Its NS record lists four Route 53 nameservers.
4. If the domain was registered outside Route 53, open your registrar's nameserver/DNS settings and replace the current authoritative nameservers with those four Route 53 nameservers. Do not change the nameserver record inside Route 53. Delegation can take time to propagate; wait until Route 53 is authoritative before relying on DNS validation.
5. Choose the exact website hostname, for example `poker.example.com`. Set `site_domain` to that hostname and `route53_zone_id` to the hosted zone ID in your local `infra/terraform/prod.tfvars`. Terraform will create the hostname's ALIAS record to the public ALB after deployment.

#### 3. Request and validate an ACM certificate

The certificate must be in the same AWS region as the internet-facing ALB, not in `us-east-1` unless that is also your deployment region.

1. Switch the AWS Console to your deployment region and open **Certificate Manager (ACM)**.
2. Choose **Request a certificate > Request a public certificate**.
3. Enter the exact hostname from `site_domain` (for example `poker.example.com`), choose **DNS validation**, and request it.
4. Open the new certificate and choose **Create records in Route 53** if offered. Select the public hosted zone created above. If ACM cannot create the record automatically, copy the CNAME name and value into that hosted zone manually.
5. Wait for the certificate status to become **Issued**. Copy its ARN into `acm_certificate_arn` in `prod.tfvars`.

#### 4. Create the backend runtime secret

1. In the deployment region, open **Secrets Manager > Store a new secret**. Choose **Other type of secret** and enter a JSON key/value secret. Use this shape, replacing every example value with a strong unique value:

```json
{
	"DB_USER": "poker_app",
	"DB_PASSWORD": "GENERATE_A_LONG_RANDOM_PASSWORD",
	"JWT_SECRET": "GENERATE_AT_LEAST_32_RANDOM_CHARACTERS",
	"INTERNAL_API_KEY": "GENERATE_A_LONG_RANDOM_KEY"
}
```

Do not use the literal example strings. You may add `REDIS_PASSWORD` only if you configure an ElastiCache AUTH token. The `DB_USER` and `DB_PASSWORD` values must match the application database user you create in the RDS database after Terraform provisions it; do not put the RDS master password in this application secret.

2. Name the secret clearly, such as `poker777/prod/backend`, and create it. Copy its full ARN into `backend_secret_arn` in `prod.tfvars`.
3. Terraform grants the backend EC2 role access to this secret. Keep secret contents out of `prod.tfvars`, `backend.hcl`, user data, and source control.

After the first Terraform apply, use the RDS-managed master secret ARN from `terraform output -raw rds_master_secret_arn` with a controlled database client that has private VPC access to create `poker_app` and grant only the required database permissions. Keep RDS private; do not temporarily make it publicly accessible. Then run the migration as described in the deployment steps.

#### 5. Check the Terraform values before planning

In your local, git-ignored `infra/terraform/prod.tfvars`, verify these values point to the resources you just created:

```hcl
site_domain         = "poker.example.com"
route53_zone_id     = "Z0123456789EXAMPLE"
acm_certificate_arn = "arn:aws:acm:REGION:ACCOUNT_ID:certificate/CERTIFICATE_ID"
backend_secret_arn  = "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:SECRET_NAME"
```

These are examples only. Replace them with the real hostname, hosted zone ID, certificate ARN, and secret ARN from your AWS account. Review the remaining values in your local `prod.tfvars` and replace any placeholders there as well.

## 2. Make the application production-ready

Make these changes before baking or building deployment images. Keep local Docker Compose behavior documented separately.

### Frontend API and WebSocket origin

In `frontend/src/lib/api.js`, change the fallback to the page origin so an empty `VITE_API_BASE` is same-origin:

```js
const configuredBase = (import.meta.env.VITE_API_BASE || '').trim();
export const API_BASE = (configuredBase || window.location.origin).replace(/\/$/, '');
```

The WebSocket code already derives `ws://` or `wss://` from `API_BASE`. Build production frontend assets with `VITE_API_BASE` empty (or remove the Docker build arg); do not set it to the private ALB hostname. The public ALB terminates HTTPS, and Nginx proxies `/ws` to the internal ALB.

### Frontend Nginx proxy

Update `frontend/nginx.conf` so Nginx serves static content and forwards application requests to the internal ALB. Add `/health`, `/auth/`, `/users/`, `/wallet/`, `/tables/`, `/internal/`, and `/ws` proxy routes before the existing static catch-all. Preserve the request path, set `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers, and for `/ws` set the `Upgrade` and `Connection: upgrade` headers plus a long `proxy_read_timeout` (for example 3600 seconds). Replace the current `COPY nginx.conf /etc/nginx/conf.d/default.conf` in `frontend/Dockerfile` with a copy to `/etc/nginx/templates/default.conf.template`; the official Nginx image entrypoint then renders it at container startup. Set `NGINX_ENVSUBST_FILTER=^(BACKEND_INTERNAL_DNS|NGINX_RESOLVER)$` so only the two deployment variables are substituted and Nginx variables such as `$host` are left intact. Set both values at runtime: AWS uses the internal ALB DNS name and VPC resolver `169.254.169.253`; local Compose uses `backend:4000` and `127.0.0.11`:

```nginx
resolver 169.254.169.253 valid=30s;
set $backend_origin http://${BACKEND_INTERNAL_DNS};

location /ws {
	proxy_pass $backend_origin;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
	proxy_read_timeout 3600s;
}

location ~ ^/(health|auth|users|wallet|tables|internal)(/|$) {
	proxy_pass $backend_origin;
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
}
```

Keep the existing static `location /` after these proxy locations. Include these locations inside the existing `server` block. Set `BACKEND_INTERNAL_DNS` to the internal ALB DNS name without a scheme or path.

Use a deployment-time Nginx template/environment substitution for the internal ALB DNS name, not a browser-visible URL. Ensure Nginx refreshes DNS resolution or is safely reloaded when the ALB address changes; ALB DNS names can resolve to changing IP addresses. The frontend instance security group needs egress to the internal ALB listener, and the internal ALB security group should accept that listener only from the frontend instance security group.

### Backend Redis configuration

The current Redis client hardcodes port `6379` and has TLS commented out. Update `backend/src/config/redisClient.js` to use the parsed config and enable TLS when ElastiCache in-transit encryption is enabled. The client setup should be equivalent to:

```js
import { env } from './env.js';

const config = {
	host: env.redis.host,
	port: env.redis.port,
	password: env.redis.password || undefined,
	lazyConnect: process.env.REDIS_DISABLED === '1',
	...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
};
```

Apply the same config to state, publisher, and subscriber clients. Test ElastiCache TLS connectivity from a backend instance before scaling out. The current code uses the regular `ioredis` client, not `ioredis.Cluster`; configure ElastiCache cluster mode disabled unless the application is changed to use a cluster-aware client and its failover/slot behavior is tested.

Set a Redis replication group with Multi-AZ/failover enabled and encryption in transit and at rest. This application stores live table state, locks, and Pub/Sub events in Redis, so Redis availability and persistence/backup policy are gameplay correctness decisions, not just cache tuning. Verify that the selected ElastiCache engine/version supports the required Redis commands and client behavior.

### Backend database TLS and read routing

For production, configure the MySQL driver to verify TLS using the AWS RDS CA bundle. Add a CA file path setting (for example `DB_SSL_CA`) and pass the CA to the mysql2 pool's `ssl` option. Fetch and install the current AWS RDS CA bundle in the backend image; do not disable certificate verification.

Read replica support is an application change, not a Terraform switch. If required, add separate writer and reader pools/endpoints, classify queries explicitly, and ensure transactions always use the writer connection. Keep migrations and all mutations on the writer. Add tests for read-after-write consistency and replica lag/failover before routing production reads. Until that work is done, use only `DB_HOST` for the primary.

### Health checks and runtime

Use `/health` for ALB target checks on the backend. It currently confirms that the HTTP process responds, not that MySQL/Redis are healthy; add a separate readiness check before making the ALB health check depend on those services. Run database migrations as a one-off deployment task against the writer before rolling out backend instances. Do not run migrations independently on every ASG boot. Never use `npm run migrate:fresh` in production.

## 3. Create the Terraform project

The repository includes a parameterized Terraform root in `infra/terraform/`. It creates the VPC/subnets/NAT gateways, security groups, two ALBs, ECR repositories, EC2 launch templates/ASGs and scaling policies, one RDS MySQL writer plus three read replicas, an ElastiCache Redis replication group, and the Route 53 alias. It uses existing EC2 instance profiles supplied as variables; it does not create or edit IAM roles, policies, or instance profiles. Create the encrypted/versioned state bucket and DNS/ACM prerequisites before applying it.

Create these resources (names are illustrative):

- VPC with DNS hostnames/support, two or three AZs, public subnets for internet-facing ALB and requested frontend ASG, and private subnets for internal ALB, backend ASG, RDS, and ElastiCache. Production should use one NAT Gateway per AZ for resilience; the Learner Lab-oriented default uses one shared NAT Gateway to reduce cost, which is a single-AZ egress dependency.
- Security groups with narrow source references: public ALB accepts `443` from the Internet (and optionally `80` only to redirect to HTTPS); frontend instances accept `3000` only from the public ALB SG; internal ALB accepts its listener only from the frontend SG; backend instances accept `4000` only from the internal ALB SG; RDS accepts `3306` only from backend SG; Redis accepts its configured TLS port only from backend SG. Do not expose database/cache ports or instance SSH to `0.0.0.0/0`.
- Internet-facing ALB with HTTPS listener and ACM certificate, HTTP-to-HTTPS redirect, frontend target group on `3000`, and health check `/` (or a dedicated frontend health path). Internal ALB with private subnets, backend target group on `4000`, health check `/health`, and WebSocket idle timeout long enough for game sessions. ALB HTTP listeners support WebSocket upgrades; no sticky sessions are required because shared game state/pub-sub uses Redis.
- Launch templates and ASGs for frontend and backend across their designated subnets, with min/desired/max capacity, health checks, instance refresh, and CloudWatch scaling policies. The launch templates require existing instance profile names; production should use separate least-privilege profiles. Prefer immutable image releases and deploy by updating launch-template version, then perform a rolling instance refresh.
- RDS subnet group and MySQL writer in private DB subnets. For the requested four DBs, declare one writer and three `aws_db_instance` read replicas with distinct AZ placement where supported. Enable backups, encryption, deletion protection, performance/slow-query insights as appropriate, and parameter groups. Consider Multi-AZ on the writer separately and budget for its additional standby. Terraform provider limitations or AWS engine/AZ constraints may prevent placing replicas exactly where specified; confirm instance class/engine availability in both AZs.
- ElastiCache subnet group and Redis OSS/Valkey replication group in private cache subnets with Multi-AZ automatic failover, encryption, auth token where supported, backups, and a parameter group compatible with the app.
- Route 53 alias from the public hostname to the public ALB. Do not publish the internal ALB, RDS, or cache endpoints in public DNS.
- Secrets Manager secrets for `DB_PASSWORD`, `JWT_SECRET`, and `INTERNAL_API_KEY`. The existing backend instance profile must allow `secretsmanager:GetSecretValue` for this secret, as well as ECR image pulls and CloudWatch log writes. Keep secret values out of Terraform variables, `.tfvars`, user data, AMIs, and Git. Terraform-managed secret values can still end up in state.
- CloudWatch alarms for ALB 5xx responses, RDS writer CPU/connections, each replica's lag, and ElastiCache CPU/memory/connections. An SNS topic is created for notifications; set `alert_email` to an operations address and confirm the subscription email after apply.

### Learner Lab IAM setup

1. This Learner Lab provides the EC2 instance profile `LabInstanceProfile`, attached to role `LabRole`. A role name and its instance profile name are not interchangeable. Both profile inputs in the local lab `prod.tfvars` are set to `LabInstanceProfile`.
2. The lab supplies one shared profile, so frontend instances receive the same role permissions as backend instances, potentially including access to the backend secret. This is less isolated than production; use separate least-privilege profiles in an unrestricted account.
3. The selected profile must already allow the relevant runtime actions: ECR image download, `secretsmanager:GetSecretValue` for the backend secret, and CloudWatch log stream/event writes. SSM access is needed only if you plan to manage instances through Systems Manager. You cannot add these permissions yourself in a restricted lab; use only the profile the lab provides.
4. The lab's Terraform identity must also be allowed to pass the selected role to EC2 (`iam:PassRole`) and create the required EC2 launch templates/Auto Scaling groups. If AWS returns `AccessDenied` for `iam:PassRole`, or refuses the provided profile, there is no Terraform-only workaround. Ask the lab administrator which instance profile/services are permitted, or use an AWS account where you can create and pass dedicated least-privilege profiles.

Using a pre-existing profile avoids Terraform IAM role/policy/profile creation calls; it does not bypass the lab's restrictions on EC2, networking, RDS, ElastiCache, ECR, Route 53, ACM, Secrets Manager, or other services.

### Learner Lab service and budget limits

- Use only `us-east-1` or `us-west-2`. The configuration defaults to `t3.small` EC2 instances and validates the combined ASG maximum against the lab's nine-concurrently-running-EC2 limit; include any other EC2 instances in the account when choosing the limits.
- Learner Lab RDS supports burstable classes through medium, gp2 storage up to 100 GB, and does not support Enhanced Monitoring. Terraform uses `db.t4g.medium`, gp2, caps autoscaling storage at 100 GB, and disables Performance Insights. Confirm the MySQL engine version and instance class are available in your selected region.
- The requested topology still creates four RDS instances (one writer and three replicas), plus ElastiCache, two ALBs, and a NAT Gateway. This can use the lab budget quickly. Stop or remove resources when finished and monitor the lab budget. The single NAT default costs less than one per AZ but is not highly available.
- The lab gives the user ECR push access and `LabRole` read access for EC2 image pulls. Build and push images using the lab's AWS credentials; EC2 instances pull them using `LabInstanceProfile`.
- The lab cannot register domains. You must own the domain elsewhere. Verify that the lab permits Route 53 hosted-zone and ACM certificate actions before applying.

Use Terraform outputs for non-secret values needed by deployment, such as VPC ID, target-group/ASG names, public ALB DNS name, RDS writer endpoint, read replica endpoints, and ElastiCache primary endpoint. Mark secrets sensitive and avoid outputting them.

## 4. Configure and apply Terraform

1. Copy `infra/terraform/backend.hcl.example` to `infra/terraform/backend.hcl` and fill in the already-created encrypted/versioned S3 bucket, key, and region. Optional `access_key`, `secret_key`, and `token` fields are shown commented out; these authenticate the S3 backend only. The AWS provider that creates resources separately uses the standard AWS credential chain, so provide provider credentials through environment variables or the local AWS credentials file. Prefer SSO or temporary credentials. If you put static credentials in `backend.hcl`, keep that git-ignored file local and never commit it. Terraform may persist backend config in `.terraform` metadata or saved plans, so protect/delete those files. The backend uses native S3 state locking (`use_lockfile`).
2. Edit your local, git-ignored `infra/terraform/prod.tfvars`. Replace every placeholder, including account-specific ARNs, domain, AZs, CIDRs, image tags, and a MySQL engine version supported in the selected region. Choose a compatible `db_parameter_group_family`; replace `alert_email` or set it to `null` if email alerts are not wanted. Keep secrets out of the file. Set both ASG desired capacities and minimums to `0` for the initial infrastructure apply. Use two AZs so the writer plus three reader placement pattern gives two RDS instances in each AZ.
3. Create a Secrets Manager JSON secret and set its ARN as `backend_secret_arn`. Its JSON keys must be `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, and `INTERNAL_API_KEY`; include `REDIS_PASSWORD` only when using an ElastiCache AUTH token. The existing backend instance profile must permit reading this secret. Keep the Redis AUTH token out of tfvars; if passing `redis_auth_token` to Terraform, remember it is retained in Terraform state.
4. Review the plan and confirm the writer plus three read replicas, AZ placement, subnet CIDRs, ingress rules, encryption, deletion protection, zero initial ASG capacity, and expected monthly costs. The default `db_writer_multi_az = false` keeps the database at four RDS instances; enabling it adds a managed standby.

```powershell
cd infra/terraform
terraform fmt -recursive
terraform init -backend-config="backend.hcl"
terraform validate
terraform plan -var-file="prod.tfvars" -out="prod.tfplan"
terraform apply "prod.tfplan"
```

Protect the plan file and delete it after the deployment; plans may contain sensitive data. For later changes, review a fresh plan before applying. Do not use `terraform destroy` as an application rollback strategy.

## 5. Build and publish application images

1. Read the two ECR repository URLs from Terraform and log in. Choose immutable tags matching the `release-` lifecycle policy prefix:

```powershell
$BackendRepo = terraform output -raw backend_ecr_repository_url
$FrontendRepo = terraform output -raw frontend_ecr_repository_url
$ImageTag = "release-2026-09-28"
$Registry = $BackendRepo.Split('/')[0]
aws ecr get-login-password --region "us-east-1" | docker login --username AWS --password-stdin $Registry
docker build -t "$($BackendRepo):$ImageTag" ../../backend
docker push "$($BackendRepo):$ImageTag"
docker build --build-arg VITE_API_BASE="" -t "$($FrontendRepo):$ImageTag" ../../frontend
docker push "$($FrontendRepo):$ImageTag"
```

Run those commands from `infra/terraform`; use your actual AWS region and set the same image tags in `prod.tfvars`.
2. The initial Terraform apply creates the ASGs with zero instances so they cannot try to pull images before ECR is populated. After pushing both images, set `backend_min_size=2` and `backend_desired_capacity=2`, then apply. This keeps one backend in each AZ and lets CPU target tracking scale from a live baseline. The frontend can remain at zero until the backend and schema are ready.
3. Instance user data installs Docker, authenticates to ECR using the instance role, pulls the pinned image, and starts it with restart-on-failure. Backend instances fetch their JSON runtime secret from Secrets Manager. No secret is embedded in Terraform user data or AMIs.
4. Frontend instances receive the internal ALB DNS name for Nginx proxying. Backend instances receive the RDS writer and ElastiCache primary endpoints. Docker logs are sent to CloudWatch Logs. In a Learner Lab, the supplied profile may be shared by frontend and backend; in a normal production account, use separate roles so only the backend can read the app secret.

## 6. Production environment values

The root `.env` and `.env.example` are for local Compose, not for EC2 production. Do not copy them onto instances unchanged. Inject these values into backend containers from Secrets Manager/instance bootstrap; non-secret values can come from deployment configuration:

```dotenv
NODE_ENV=production
PORT=4000
CORS_ALLOWED_ORIGINS=https://poker.example.com

DB_HOST=<RDS-writer-endpoint-without-port>
DB_PORT=3306
DB_USER=<least-privilege-application-user>
DB_PASSWORD=<Secrets-Manager>
DB_NAME=poker777
DB_CONNECTION_LIMIT=10
DB_SSL_CA=/etc/ssl/certs/aws-rds-global-bundle.pem

REDIS_HOST=<ElastiCache-primary-endpoint-without-port>
REDIS_PORT=6379
REDIS_TLS=true
REDIS_PASSWORD=<Secrets-Manager-if-auth-token-enabled>
REDIS_KEY_PREFIX=poker:

TRUST_PROXY_HOPS=3
JWT_SECRET=<random-secret-at-least-32-characters-from-Secrets-Manager>
JWT_EXPIRES_IN=24h
JWT_ISSUER=poker777
WELCOME_BONUS=1000
TOPUP_MIN=1
TOPUP_MAX=100000
INTERNAL_API_KEY=<Secrets-Manager>
```

Use the actual ElastiCache port if it differs from `6379`; omit `REDIS_PASSWORD` when no auth token is configured. `TRUST_PROXY_HOPS=3` matches the public ALB, frontend Nginx, and internal ALB chain. The API/auth rate limits use Redis so they are shared by every backend ASG instance. All backend instances must use the same JWT secret, issuer, Redis endpoint, prefix, database writer, and application database credentials. Give each backend a unique `INSTANCE_ID` for log correlation if the app is updated to consume it. `VITE_API_BASE` is a frontend build-time value: leave it empty with the same-origin code change; it is not a runtime backend secret. Do not include MySQL container variables (`MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, etc.) in production app settings; RDS is managed separately.

Create a dedicated least-privilege MySQL user for the application and a separate migration identity if possible. The migration identity needs DDL permissions on the application database; the runtime user should not. Rotate secrets through Secrets Manager and roll instances when credentials change.

## 7. Deploy in order

1. Create the backend Secrets Manager JSON secret and fill `prod.tfvars`, then apply Terraform with both ASGs at zero. Wait until RDS and Redis report available. Retrieve the RDS master-secret ARN from `terraform output -raw rds_master_secret_arn`; use a controlled administrative client with VPC access and that RDS-managed secret to create the application database account using the credentials stored in the backend secret.
2. Build and push the immutable backend/frontend images as described above. Set `backend_min_size=2` and `backend_desired_capacity=2`, then apply. Keep the frontend ASG at zero while applying the schema.
3. Run `npm run migrate` exactly once from a controlled deployment runner that can reach the RDS writer, using the migration-capable database identity and the backend image. Verify the tables exist. Never run `migrate:fresh` in production or run migrations on every ASG boot.
4. Set `frontend_min_size=2` and `frontend_desired_capacity=2`, then apply. This keeps one frontend in each AZ and lets CPU target tracking scale from a live baseline. Wait for both target groups to report healthy; test backend `/health` through the internal ALB from within the VPC and inspect CloudWatch logs for database/Redis connectivity.
5. Verify the Route 53 alias and HTTPS certificate. Confirm the browser loads over HTTPS, API calls use the same origin, and the WebSocket URL is `wss://<public-host>/ws`.
6. Exercise registration/login, wallet reads/writes, table creation/join, multi-instance WebSocket play, reconnects, and rolling instance refresh. Confirm a client connected to one backend receives room events published by another backend.
7. Configure alarms for ALB 5xx/target health/latency, ASG capacity, EC2 CPU/memory, RDS CPU/storage/connections/replica lag/failover, ElastiCache failover/memory/connections, and application errors. Test backups and document writer promotion, endpoint/secret rotation, and rollback procedures.

## 8. Local development remains Compose-based

Local development still uses the root `.env` and:

```powershell
docker compose up -d --build
```

The local `DB_HOST=mysql`, `REDIS_HOST=redis`, and `VITE_API_BASE=http://localhost:4000` values are Compose service names/local URLs. They must not be reused for AWS. Inspect with `docker compose ps` and `docker compose logs -f`; stop with `docker compose down`.
