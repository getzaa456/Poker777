#!/bin/bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root, for example: sudo bash $0" >&2
  exit 1
fi

exec > >(tee -a /var/log/poker777-user-data.log) 2>&1
trap 'status=$?; printf "ERROR: command failed at line %s (exit %s). See /var/log/poker777-user-data.log.\n" "$LINENO" "$status" >&2; exit "$status"' ERR

APP_DIR=/opt/poker777
CONFIG_DIR=/etc/poker777
ENV_FILE="${CONFIG_DIR}/backend.env"
RDS_CA_FILE="${CONFIG_DIR}/rds-ca.pem"
SECRET_ID=poker777/prod/backend
BRANCH=AlmostDone

for package in git; do
  if ! rpm -q "${package}" >/dev/null 2>&1; then
    dnf install -y "${package}"
  fi
done

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf install -y nodejs
fi

TOKEN=$(curl -fsS -X PUT \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" \
  http://169.254.169.254/latest/api/token)
AWS_REGION=$(curl -fsS \
  -H "X-aws-ec2-metadata-token: ${TOKEN}" \
  http://169.254.169.254/latest/meta-data/placement/region)
export AWS_REGION

install -d -m 0750 /etc/poker777

SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "${SECRET_ID}" \
  --query SecretString \
  --output text)

if ! jq -e '
  type == "object" and
  all(to_entries[]; (.key | test("^[A-Z][A-Z0-9_]*$")) and (.value | type == "string"))
' <<<"${SECRET_JSON}" >/dev/null; then
  echo "Secrets Manager secret must be a JSON object of string environment values." >&2
  exit 1
fi

for key in DB_HOST DB_USER DB_PASSWORD DB_NAME JWT_SECRET INTERNAL_API_KEY CORS_ALLOWED_ORIGINS; do
  if ! jq -e --arg key "${key}" '.[$key] | strings | length > 0' <<<"${SECRET_JSON}" >/dev/null; then
    echo "Required environment value ${key} is missing from Secrets Manager." >&2
    exit 1
  fi
done

if [ "$(jq -r '.JWT_SECRET | length' <<<"${SECRET_JSON}")" -lt 32 ]; then
  echo "JWT_SECRET must be at least 32 characters." >&2
  exit 1
fi

curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o "${RDS_CA_FILE}"
chmod 0644 "${RDS_CA_FILE}"

{
  jq -r 'del(.DB_SSL_CA) | to_entries[] | "\(.key)=\(.value | tojson)"' <<<"${SECRET_JSON}"
  printf 'NODE_ENV="production"\n'
  printf 'DB_SSL_CA="%s"\n' "${RDS_CA_FILE}"
} >"${ENV_FILE}"
chmod 0600 "${ENV_FILE}"

if [ -d "${APP_DIR}/.git" ]; then
  git -C "${APP_DIR}" fetch --depth 1 origin "${BRANCH}"
  git -C "${APP_DIR}" checkout -B "${BRANCH}" FETCH_HEAD
elif [ -e "${APP_DIR}" ]; then
  if [ -d "${APP_DIR}" ] && rmdir "${APP_DIR}" 2>/dev/null; then
    echo "Removed empty directory left by an earlier run."
  else
    echo "${APP_DIR} exists and is not an empty Git checkout. Inspect its contents and move it aside before retrying." >&2
    exit 1
  fi
fi

if [ ! -d "${APP_DIR}/.git" ]; then
  git clone --branch "${BRANCH}" --single-branch \
    https://github.com/getzaa456/Poker777.git "${APP_DIR}"
fi

if ! id -u poker777 >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --shell /sbin/nologin poker777
fi
chown root:poker777 "${CONFIG_DIR}"
chmod 0750 "${CONFIG_DIR}"
chown root:poker777 "${RDS_CA_FILE}"
chmod 0640 "${RDS_CA_FILE}"
chown -R poker777:poker777 "${APP_DIR}"
runuser -u poker777 -- bash -c "cd '${APP_DIR}/backend' && npm ci --omit=dev"

cat >/etc/systemd/system/poker777-backend.service <<EOF
[Unit]
Description=Poker777 backend
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=poker777
Group=poker777
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now poker777-backend.service
