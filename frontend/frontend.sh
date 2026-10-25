#!/bin/bash
set -Eeuo pipefail

APP_DIR=/opt/poker777-frontend
BRANCH=AlmostDone

# สตรีม Log ของ User Data ไปไว้ที่ /var/log/poker777-user-data.log เพื่อใช้ตรวจสอบภายหลัง
exec > >(tee -a /var/log/poker777-user-data.log) 2>&1

echo "=== 1. Installing System Packages & Nginx ==="
for package in git jq nginx; do
  if ! rpm -q "${package}" >/dev/null 2>&1; then
    dnf install -y "${package}"
  fi
done

echo "=== 2. Installing Node.js 22 ==="
if ! command -v node >/dev/null 2>&1 || [ "$(node -p "process.versions.node.split(\".\")[0]")" != "22" ]; then
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf install -y nodejs
fi

echo "=== 3. Cloning Repository & Switching to Branch: ${BRANCH} ==="
mkdir -p "${APP_DIR}"
if [ ! -d "${APP_DIR}/.git" ]; then
  git clone --branch "${BRANCH}" --single-branch \
    https://github.com/getzaa456/Poker777.git "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull origin "${BRANCH}"
fi

echo "=== 4. Installing Frontend Dependencies & Building ==="
cd "${APP_DIR}/frontend"
npm ci
npm run build

echo "=== 5. Configuring Nginx for Port 3000 ==="
cat >/etc/nginx/conf.d/poker777-frontend.conf <<'NGINX_EOF'
server {
  listen 3000;
  server_name _;

  resolver 169.254.169.253 valid=30s ipv6=off;
  set $backend_origin http://internal-poker777-prod-internal-371436866.us-east-1.elb.amazonaws.com:4000;

  root @FRONTEND_ROOT@;
  index index.html;

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

  location ~ ^/(health|auth|users|wallet|tables)(/|$) {
    proxy_pass $backend_origin;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
  }

  location /assets/ {
    try_files $uri =404;
    expires 1h;
    add_header Cache-Control "public";
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
NGINX_EOF
sed -i "s|@FRONTEND_ROOT@|${APP_DIR}/frontend/dist|" \
  /etc/nginx/conf.d/poker777-frontend.conf
grep -Fqx "  root ${APP_DIR}/frontend/dist;" /etc/nginx/conf.d/poker777-frontend.conf
nginx -t

# ลบ Config default ออก
rm -f /etc/nginx/default.d/*.conf 2>/dev/null || true

# Enable และ Start Nginx ให้ทำงานทันที
systemctl enable nginx
systemctl restart nginx

echo "=== FRONTEND USER DATA COMPLETED SUCCESSFULLY ==="
