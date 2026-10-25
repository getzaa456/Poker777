#!/bin/bash
set -Eeuo pipefail

APP_DIR=/opt/poker777-frontend
BRANCH=AlmostDone

# Backend ที่ nginx จะส่งต่อ /auth /users /wallet /tables /health /ws ไปให้ (Internal ALB port 4000)
# ปล่อยว่างได้: สคริปต์จะหา DNS ของ Internal ALB ชื่อ INTERNAL_ALB_NAME เอง (ต้องใช้ IAM profile LabInstanceProfile)
# หรือใส่เองก็ได้ เช่น BACKEND_ORIGIN=http://internal-poker777-prod-internal-123456.us-east-1.elb.amazonaws.com:4000
BACKEND_ORIGIN=""
INTERNAL_ALB_NAME=poker777-prod-internal

# สตรีม Log ของ User Data ไปไว้ที่ /var/log/poker777-user-data.log เพื่อใช้ตรวจสอบภายหลัง
exec > >(tee -a /var/log/poker777-user-data.log) 2>&1

echo "=== 1. Installing System Packages & Nginx ==="
for package in git jq nginx; do
  if ! rpm -q "${package}" >/dev/null 2>&1; then
    dnf install -y "${package}"
  fi
done

echo "=== 2. Finding the Backend (Internal ALB) ==="
# [แก้บัค]: เดิม nginx เสิร์ฟแค่ไฟล์หน้าเว็บ ไม่ได้ส่งต่อ API ไป Backend -> Login / เข้าโต๊ะไม่ได้ (ได้ index.html กลับมา)
if [ -z "${BACKEND_ORIGIN}" ]; then
  TOKEN=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" \
    http://169.254.169.254/latest/api/token || true)
  AWS_REGION=$(curl -fsS -H "X-aws-ec2-metadata-token: ${TOKEN}" \
    http://169.254.169.254/latest/meta-data/placement/region || true)
  ALB_DNS=$(aws elbv2 describe-load-balancers --region "${AWS_REGION:-us-east-1}" \
    --names "${INTERNAL_ALB_NAME}" --query 'LoadBalancers[0].DNSName' --output text 2>/dev/null || true)
  if [ -n "${ALB_DNS}" ] && [ "${ALB_DNS}" != "None" ]; then
    BACKEND_ORIGIN="http://${ALB_DNS}:4000"
  fi
fi
if [ -z "${BACKEND_ORIGIN}" ]; then
  echo "Cannot find the Internal ALB '${INTERNAL_ALB_NAME}'. Create it first (guide step 13)," >&2
  echo "or set BACKEND_ORIGIN at the top of this script." >&2
  exit 1
fi
# รับได้ทั้งแบบมี/ไม่มี http:// และ :4000
case "${BACKEND_ORIGIN}" in http://*|https://*) ;; *) BACKEND_ORIGIN="http://${BACKEND_ORIGIN}" ;; esac
if ! [[ "${BACKEND_ORIGIN}" =~ :[0-9]+/?$ ]]; then BACKEND_ORIGIN="${BACKEND_ORIGIN%/}:4000"; fi
BACKEND_ORIGIN="${BACKEND_ORIGIN%/}"
echo "Backend: ${BACKEND_ORIGIN}"

echo "=== 3. Installing Node.js 22 ==="
if ! command -v node >/dev/null 2>&1 || [ "$(node -p "process.versions.node.split(\".\")[0]")" != "22" ]; then
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf install -y nodejs
fi

echo "=== 4. Cloning Repository & Switching to Branch: ${BRANCH} ==="
mkdir -p "${APP_DIR}"
if [ ! -d "${APP_DIR}/.git" ]; then
  git clone --branch "${BRANCH}" --single-branch \
    https://github.com/getzaa456/Poker777.git "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull origin "${BRANCH}"
fi

echo "=== 5. Installing Frontend Dependencies & Building ==="
cd "${APP_DIR}/frontend"
npm ci
npm run build

echo "=== 6. Configuring Nginx for Port 3000 ==="
# resolver + ตัวแปร: IP ของ ALB เปลี่ยนได้ตลอด ให้ nginx ถาม DNS ใหม่ทุก 30 วิ แทนการจำ IP ไว้ตั้งแต่เปิด
cat >/etc/nginx/conf.d/poker777-frontend.conf <<NGINX_EOF
server {
    listen 3000 default_server;
    listen [::]:3000 default_server;
    server_name _;

    resolver 169.254.169.253 valid=30s ipv6=off;
    set \$backend_origin ${BACKEND_ORIGIN};

    root ${APP_DIR}/frontend/dist;
    index index.html;

    # WebSocket ของโต๊ะ
    location /ws {
        proxy_pass \$backend_origin;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_read_timeout 3600s;
    }

    # REST API (ไม่รวม /internal ซึ่งต้องเรียกจากในระบบเท่านั้น)
    location ~ ^/(health|auth|users|wallet|tables)(/|\$) {
        proxy_pass \$backend_origin;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
    }

    location /assets/ {
        try_files \$uri =404;
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

# [แก้บัค] ค่าเริ่มต้นของ nginx รับได้ 1024 การเชื่อมต่อต่อ worker (t3.micro = 2 worker) และผู้เล่น 1 คนใช้ 2 การเชื่อมต่อ
# (ฝั่งผู้เล่น + ฝั่ง ALB ภายใน) → เครื่องละ ~1,000 คนก็เต็ม แล้ว health check ล้ม → ASG ฆ่าเครื่องทิ้ง (เจอใน Load test 4)
sed -i -E 's/^(\s*)worker_connections\s+[0-9]+;/\1worker_connections 16384;/' /etc/nginx/nginx.conf
grep -q '^worker_rlimit_nofile' /etc/nginx/nginx.conf || sed -i '/^worker_processes/a worker_rlimit_nofile 65535;' /etc/nginx/nginx.conf

# ตรวจ config ก่อน ถ้าผิดจะหยุดตรงนี้ (ไม่ restart ด้วย config เสีย)
nginx -t

# Enable และ Start Nginx ให้ทำงานทันที
systemctl enable nginx
systemctl restart nginx

echo "=== FRONTEND USER DATA COMPLETED SUCCESSFULLY ==="
