#!/usr/bin/env bash
# تركيب متجر خبر عاجل سبها على VPS جديد (Ubuntu 22.04 / 24.04) بأمر واحد.
# الاستخدام (من داخل مجلد المتجر بعد git clone، كمستخدم root):
#   bash scripts/install-vps.sh khabarsebha.com you@example.com
# الوسيط الأول: الدومين (بدون www). الثاني: إيميل حساب مدير المتجر.
# يركّب: Node.js 22 + Caddy (HTTPS مجاني تلقائي) + خدمة systemd تشتغل دائماً.
set -euo pipefail

DOMAIN="${1:-}"; ADMIN_EMAIL="${2:-}"
if [[ -z "$DOMAIN" || -z "$ADMIN_EMAIL" ]]; then
  echo "الاستخدام: bash scripts/install-vps.sh <الدومين> <إيميل المدير>"; exit 1
fi
[[ $EUID -eq 0 ]] || { echo "شغّله كـ root"; exit 1; }

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR=/var/lib/khabar
echo "==> مجلد المتجر: $APP_DIR"

echo "==> تحديث النظام وتثبيت الأدوات"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates openssl gnupg
if ! apt-get install -y caddy; then
  echo "==> إضافة مستودع Caddy الرسمي"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  echo "==> تثبيت Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> مستخدم خاص للمتجر ومجلد قاعدة البيانات"
id khabar >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin khabar
mkdir -p "$DATA_DIR" && chown -R khabar:khabar "$DATA_DIR" && chmod 750 "$DATA_DIR"

ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  cat > "$ENV_FILE" <<EOF
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
DATA_DIR=$DATA_DIR
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
SESSION_SECRET=$(openssl rand -hex 32)
SEED_SAMPLE_PRODUCTS=false
EOF
  chmod 640 "$ENV_FILE"; chown root:khabar "$ENV_FILE"
  NEW_PASSWORD=1
else
  echo "==> ملف .env موجود من قبل — لن يتغير"
fi

echo "==> خدمة systemd"
cat > /etc/systemd/system/khabar.service <<EOF
[Unit]
Description=Khabar Ajel Sebha store
After=network.target

[Service]
User=khabar
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now khabar
systemctl restart khabar

echo "==> Caddy (HTTPS تلقائي من Let's Encrypt)"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN, www.$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy

sleep 3
if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then echo "✅ المتجر شغّال"; else echo "⚠️ المتجر ما اشتغلش — شوف: journalctl -u khabar -n 50"; fi

echo
echo "================================================================"
echo " المتجر:        https://$DOMAIN"
echo " لوحة التحكم:   https://$DOMAIN/admin"
echo " إيميل المدير:  $ADMIN_EMAIL"
if [[ "${NEW_PASSWORD:-0}" == 1 ]]; then
  echo " كلمة السر:     $ADMIN_PASSWORD"
  echo " ⚠️ احفظ كلمة السر هذي توا وغيّرها من لوحة التحكم بعد أول دخول."
fi
echo " (HTTPS يشتغل بعد ما الدومين يشير لعنوان IP هذا السيرفر)"
echo " للتحديث لاحقاً:  cd $APP_DIR && git pull && systemctl restart khabar"
echo "================================================================"
