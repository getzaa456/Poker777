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

1. Choose an AWS region and create a dedicated deployment account or role. Install AWS CLI, Terraform, and Docker; configure AWS CLI credentials with least privilege.
2. Register a domain and create/validate an ACM certificate in the ALB region for the public site hostname (for example `poker.example.com`). If the frontend and API use separate public hostnames, validate both; this topology uses one hostname.
3. Create an S3 bucket for Terraform state with versioning and server-side encryption. Configure state locking using an S3 lockfile supported by your Terraform version or a DynamoDB lock table. Restrict access to the state: Terraform state can contain sensitive values.
4. Set AWS Budgets and CloudWatch alarms. RDS, NAT Gateways, ALBs, and replicas have ongoing costs; four RDS instances plus a Multi-AZ writer standby are a substantial database footprint.

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

Update `frontend/nginx.conf` so Nginx serves static content and forwards application requests to the internal ALB. Add `/health`, `/auth/`, `/users/`, `/wallet/`, `/tables/`, `/internal/`, and `/ws` proxy routes before the existing static catch-all. Preserve the request path, set `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers, and for `/ws` set the `Upgrade` and `Connection: upgrade` headers plus a long `proxy_read_timeout` (for example 3600 seconds). Replace the current `COPY nginx.conf /etc/nginx/conf.d/default.conf` in `frontend/Dockerfile` with a copy to `/etc/nginx/templates/default.conf.template`; the official Nginx image entrypoint then renders it at container startup. Set `NGINX_ENVSUBST_FILTER=BACKEND_INTERNAL_DNS` on the frontend container so Nginx variables such as `$host` are not accidentally substituted:

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
	proxy_set_header X-Forwarded-Proto $scheme;
	proxy_read_timeout 3600s;
}

location ~ ^/(health|auth|users|wallet|tables|internal)(/|$) {
	proxy_pass $backend_origin;
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header X-Forwarded-Proto $scheme;
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

Add a separate `infra/terraform/` directory (or a dedicated infrastructure repository). Use remote state configured in step 1 and pin Terraform/provider versions. Keep modules small enough to review: `network`, `security`, `database`, `cache`, `load_balancers`, `compute`, and `dns`.

Create these resources (names are illustrative):

- VPC with DNS hostnames/support, two or three AZs, public subnets for internet-facing ALB and requested frontend ASG, and private subnets for internal ALB, backend ASG, RDS, and ElastiCache. Public routes go to an Internet Gateway; private egress uses one NAT Gateway per AZ for production resilience, or VPC endpoints where supported.
- Security groups with narrow source references: public ALB accepts `443` from the Internet (and optionally `80` only to redirect to HTTPS); frontend instances accept `3000` only from the public ALB SG; internal ALB accepts its listener only from the frontend SG; backend instances accept `4000` only from the internal ALB SG; RDS accepts `3306` only from backend SG; Redis accepts its configured TLS port only from backend SG. Do not expose database/cache ports or instance SSH to `0.0.0.0/0`.
- Internet-facing ALB with HTTPS listener and ACM certificate, HTTP-to-HTTPS redirect, frontend target group on `3000`, and health check `/` (or a dedicated frontend health path). Internal ALB with private subnets, backend target group on `4000`, health check `/health`, and WebSocket idle timeout long enough for game sessions. ALB HTTP listeners support WebSocket upgrades; no sticky sessions are required because shared game state/pub-sub uses Redis.
- Launch templates and ASGs for frontend and backend across their designated subnets, with min/desired/max capacity, health checks, instance refresh, and CloudWatch scaling policies. Use instance profiles instead of static AWS credentials. Prefer immutable image releases and deploy by updating launch-template version, then perform a rolling instance refresh.
- RDS subnet group and MySQL writer in private DB subnets. For the requested four DBs, declare one writer and three `aws_db_instance` read replicas with distinct AZ placement where supported. Enable backups, encryption, deletion protection, performance/slow-query insights as appropriate, and parameter groups. Consider Multi-AZ on the writer separately and budget for its additional standby. Terraform provider limitations or AWS engine/AZ constraints may prevent placing replicas exactly where specified; confirm instance class/engine availability in both AZs.
- ElastiCache subnet group and Redis OSS/Valkey replication group in private cache subnets with Multi-AZ automatic failover, encryption, auth token where supported, backups, and a parameter group compatible with the app.
- Route 53 alias from the public hostname to the public ALB. Do not publish the internal ALB, RDS, or cache endpoints in public DNS.
- Secrets Manager secrets for `DB_PASSWORD`, `JWT_SECRET`, and `INTERNAL_API_KEY`, with a least-privilege instance role allowing only the required secret reads. Keep secret values out of Terraform variables, `.tfvars`, user data, AMIs, and Git. Terraform-managed secret values can still end up in state.

Use Terraform outputs for non-secret values needed by deployment, such as VPC ID, target-group/ASG names, public ALB DNS name, RDS writer endpoint, read replica endpoints, and ElastiCache primary endpoint. Mark secrets sensitive and avoid outputting them.

## 4. Configure and apply Terraform

1. Create `infra/terraform/backend.tf` for the encrypted/versioned remote state and lock configuration, `versions.tf` with pinned provider requirements, `variables.tf`, and environment-specific `dev.tfvars`/`prod.tfvars` containing only non-secret values.
2. Define `terraform.tfvars` values such as region, project/environment name, domain, AZs, subnet CIDRs, instance types, ASG min/desired/max, RDS engine/class/storage, Redis node type, and backup retention. Do not put passwords or tokens in these files.
3. Review the plan and confirm that the RDS writer/replica count, AZ placement, subnets, ingress rules, encryption, deletion protection, and expected monthly costs are correct.

```powershell
cd infra/terraform
terraform fmt -recursive
terraform init
terraform validate
terraform plan -var-file="prod.tfvars" -out="prod.tfplan"
terraform apply "prod.tfplan"
```

Protect the plan file and delete it after the deployment; plans may contain sensitive data. For later changes, review a fresh plan before applying. Do not use `terraform destroy` as an application rollback strategy.

## 5. Build and publish application images

1. Build the backend image and frontend image from the repository using the production Dockerfiles. For the frontend, build with empty `VITE_API_BASE` after applying the same-origin change. Publish immutable, versioned tags to private ECR repositories.
2. Store image tags in Terraform variables or deployment configuration. Do not use the mutable `latest` tag for an ASG rollout.
3. Configure instance bootstrap/user data to install Docker, authenticate to ECR using the instance role, pull the pinned image, retrieve runtime secrets from Secrets Manager, and start the container with restart-on-failure. Do not embed secret values in user data; user data is inspectable from the instance.
4. Configure frontend instances with the internal ALB DNS name for Nginx proxying. Configure backend instances with the RDS writer endpoint and ElastiCache primary/configuration endpoint. Ensure logs go to CloudWatch Logs and the instance role is scoped to those log groups, ECR images, and required secrets.

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
REDIS_KEY_PREFIX=poker:

JWT_SECRET=<random-secret-at-least-32-characters-from-Secrets-Manager>
JWT_EXPIRES_IN=24h
JWT_ISSUER=poker777
WELCOME_BONUS=1000
TOPUP_MIN=1
TOPUP_MAX=100000
INTERNAL_API_KEY=<Secrets-Manager>
```

Use the actual ElastiCache port if it differs from `6379`. All backend instances must use the same JWT secret, issuer, Redis endpoint, prefix, database writer, and application database credentials. Give each backend a unique `INSTANCE_ID` for log correlation if the app is updated to consume it. `VITE_API_BASE` is a frontend build-time value: leave it empty with the same-origin code change; it is not a runtime backend secret. Do not include MySQL container variables (`MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, etc.) in production app settings; RDS is managed separately.

Create a dedicated least-privilege MySQL user for the application and a separate migration identity if possible. The migration identity needs DDL permissions on the application database; the runtime user should not. Rotate secrets through Secrets Manager and roll instances when credentials change.

## 7. Deploy in order

1. Apply network, security groups, ALBs, RDS writer, and ElastiCache. Wait until RDS and Redis report available and confirm private DNS/network access from a test EC2 instance in the backend subnets.
2. Create the application database/user and store credentials in Secrets Manager. Run `npm run migrate` once from a controlled deployment runner that can reach the writer. Verify tables exist. Never run `--fresh` against production.
3. Deploy backend ASG instances and wait for the internal target group to become healthy. Test `/health` through the internal ALB from a frontend subnet and verify database/Redis connections from logs/metrics.
4. Deploy frontend ASG instances with Nginx configured for the internal ALB. Add frontend targets to the public ALB and wait for healthy targets.
5. Attach/verify the Route 53 alias and HTTPS certificate. Confirm the browser loads the site over HTTPS, API calls use the same origin, and the WebSocket URL is `wss://<public-host>/ws`.
6. Exercise registration/login, wallet reads/writes, table creation/join, multi-instance WebSocket play, reconnects, and rolling instance refresh. Confirm a client connected to one backend receives room events published by another backend.
7. Configure alarms for ALB 5xx/target health/latency, ASG capacity, EC2 CPU/memory, RDS CPU/storage/connections/replica lag/failover, ElastiCache failover/memory/connections, and application errors. Test backups and document writer promotion, endpoint/secret rotation, and rollback procedures.

## 8. Local development remains Compose-based

Local development still uses the root `.env` and:

```powershell
docker compose up -d --build
```

The local `DB_HOST=mysql`, `REDIS_HOST=redis`, and `VITE_API_BASE=http://localhost:4000` values are Compose service names/local URLs. They must not be reused for AWS. Inspect with `docker compose ps` and `docker compose logs -f`; stop with `docker compose down`.
