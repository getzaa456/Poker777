#!/bin/bash
# =============================================================================
# Poker777 — EC2 User Data: Web Server (Frontend + Nginx, public subnet)
# OS: Amazon Linux 2023
# Serves the React build on port 3000 and proxies /auth /users /wallet /tables /health /ws
# to the Internal ALB (frontend/nginx.conf in the repo).
# Target group: HTTP 3000, health check path /
# Log of this script: /var/log/poker777-userdata.log
# =============================================================================
set -euxo pipefail
exec > >(tee -a /var/log/poker777-userdata.log) 2>&1
export HOME=/root

# ---------------- แก้ค่าตรงนี้ก่อนใช้ ----------------
REPO_URL="https://github.com/getzaa456/Poker777.git"
BRANCH="AlmostDone"
APP_DIR="/opt/poker777"

# DNS name ของ Internal ALB + port ของ listener (4000) — ต้องมี :4000 ต่อท้าย
BACKEND_INTERNAL_DNS="internal-poker777-prod-internal-REPLACE.us-east-1.elb.amazonaws.com:4000"
# ------------------------------------------------------

# 1) Packages + Node.js 22 (only needed to build the site)
dnf install -y git nginx gettext xz
NODE_TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64.tar.xz/{print $2}')
curl -fsSL "https://nodejs.org/dist/latest-v22.x/${NODE_TARBALL}" | tar -xJ -C /usr/local --strip-components=1

# Small instances (t2/t3.micro) can run out of memory during the build — add 1 GB swap
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
fi

# 2) Build the React app. VITE_API_BASE stays empty so the site calls the API on its own
#    origin (https://japansg.me/auth/...), which nginx below forwards to the backend.
rm -rf "$APP_DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
cd "$APP_DIR/frontend"
npm ci
npm run build
rm -rf /usr/share/nginx/html/*
cp -r dist/. /usr/share/nginx/html/

# 3) Nginx site config from the repo's template (fill only these two variables;
#    nginx's own $uri, $host, ... must stay untouched)
export NGINX_RESOLVER="169.254.169.253"      # Amazon-provided DNS inside the VPC
export BACKEND_INTERNAL_DNS
envsubst '${NGINX_RESOLVER} ${BACKEND_INTERNAL_DNS}' < nginx.conf > /etc/nginx/conf.d/poker777.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# 4) Self-check: the page and the proxied backend health endpoint
sleep 2
curl -fsS -o /dev/null http://127.0.0.1:3000/ && echo "site OK"
curl -sS http://127.0.0.1:3000/health && echo " <- should be JSON from the backend"
