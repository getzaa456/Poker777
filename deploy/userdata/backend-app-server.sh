#!/bin/bash
# =============================================================================
# Poker777 — EC2 User Data: App Server (Backend, private subnet)
# OS: Amazon Linux 2023 | Needs outbound internet via NAT Gateway (GitHub, npm, nodejs.org)
# Target group: HTTP 4000, health check path /health
# Log of this script: /var/log/poker777-userdata.log
# =============================================================================
set -euxo pipefail
exec > >(tee -a /var/log/poker777-userdata.log) 2>&1
export HOME=/root

# ---------------- แก้ค่าตรงนี้ก่อนใช้ ----------------
REPO_URL="https://github.com/getzaa456/Poker777.git"
BRANCH="AlmostDone"
APP_DIR="/opt/poker777"

SITE_ORIGINS="https://japansg.me,https://poker777-prod-public-18512699.us-east-1.elb.amazonaws.com"

DB_HOST="REPLACE-rds-writer-endpoint.xxxxxx.us-east-1.rds.amazonaws.com"
DB_USER="REPLACE-db-user"
DB_PASSWORD="REPLACE-db-password"
DB_NAME="poker777"                 # ต้องมี database ชื่อนี้ใน RDS แล้ว (Initial database name)

REDIS_HOST="REPLACE-elasticache-primary-endpoint.xxxxxx.use1.cache.amazonaws.com"
REDIS_TLS="true"                   # true ถ้า ElastiCache เปิด Encryption in transit, ไม่งั้น false

JWT_SECRET="REPLACE-random-string-at-least-32-chars"   # ทุก App Server ต้องใช้ค่าเดียวกัน
INTERNAL_API_KEY="REPLACE-random-string"
# ------------------------------------------------------

# 1) Packages + Node.js 22 (official build from nodejs.org)
dnf install -y git xz
NODE_TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64.tar.xz/{print $2}')
curl -fsSL "https://nodejs.org/dist/latest-v22.x/${NODE_TARBALL}" | tar -xJ -C /usr/local --strip-components=1
node -v

# 2) Code
rm -rf "$APP_DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
cd "$APP_DIR/backend"
npm ci --omit=dev

# 3) RDS TLS certificate bundle (required when NODE_ENV=production)
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o /etc/ssl/certs/aws-rds-global-bundle.pem

# 4) .env (read by dotenv from the backend folder)
INSTANCE_ID=$(TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60') \
  && curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id || hostname)

cat > "$APP_DIR/backend/.env" <<EOF
NODE_ENV=production
PORT=4000
TRUST_PROXY_HOPS=3
INSTANCE_ID=${INSTANCE_ID}

CORS_ALLOWED_ORIGINS=${SITE_ORIGINS}

DB_HOST=${DB_HOST}
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
DB_CONNECTION_LIMIT=10
DB_SSL_CA=/etc/ssl/certs/aws-rds-global-bundle.pem

REDIS_HOST=${REDIS_HOST}
REDIS_PORT=6379
REDIS_TLS=${REDIS_TLS}
REDIS_KEY_PREFIX=poker:

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
JWT_ISSUER=poker777

WELCOME_BONUS=1000
TOPUP_MIN=1
TOPUP_MAX=100000
INTERNAL_API_KEY=${INTERNAL_API_KEY}
EOF
chown -R ec2-user:ec2-user "$APP_DIR"
chmod 600 "$APP_DIR/backend/.env"

# 5) Create tables (idempotent: CREATE TABLE IF NOT EXISTS). Retry while RDS/NAT comes up.
for attempt in $(seq 1 12); do
  if sudo -u ec2-user /usr/local/bin/node src/scripts/migrate.js; then break; fi
  echo "migrate attempt ${attempt} failed, retrying in 10s"; sleep 10
done

# 6) Run as a service (auto-restart, starts on reboot)
cat > /etc/systemd/system/poker777-backend.service <<EOF
[Unit]
Description=Poker777 backend (REST + WebSocket)
After=network-online.target
Wants=network-online.target

[Service]
User=ec2-user
WorkingDirectory=${APP_DIR}/backend
ExecStart=/usr/local/bin/node src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now poker777-backend

# 7) Self-check
sleep 5
curl -fsS http://127.0.0.1:4000/health && echo " <- backend OK"
