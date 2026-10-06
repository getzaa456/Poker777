sudo bash -c 'cat << "EOF" > /tmp/prepare-frontend-ami.sh
#!/bin/bash
set -Eeuo pipefail

APP_DIR=/opt/poker777-frontend
BRANCH=AlmostDone

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
cat >/etc/nginx/conf.d/poker777-frontend.conf <<NGINX_EOF
server {
    listen 3000 default_server;
    listen [::]:3000 default_server;
    server_name _;

    root ${APP_DIR}/frontend/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX_EOF

# ลบ Config default ออก
rm -f /etc/nginx/default.d/*.conf 2>/dev/null || true

# Enable Nginx ให้ auto-start ทันทีเมื่อ Boot เครื่อง
systemctl enable nginx

echo "=== PREPARE FRONTEND AMI COMPLETED SUCCESSFULLY ==="
EOF
chmod +x /tmp/prepare-frontend-ami.sh
/tmp/prepare-frontend-ami.sh
rm -f /tmp/prepare-frontend-ami.sh
'