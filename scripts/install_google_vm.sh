#!/usr/bin/env bash
set -Eeuo pipefail

# Installs Vinyl Display on a Debian/Ubuntu Google Compute Engine VM.
# Run this script on the remote VM, not on your local machine.

APP_USER="${APP_USER:-${SUDO_USER:-$USER}}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
PROJECT_DIR="${PROJECT_DIR:-$APP_HOME/vinyl_display}"
REPO_URL="${REPO_URL:-https://github.com/heriveltogabriel/playmusic.git}"
SERVICE_NAME="${SERVICE_NAME:-vinyl-display}"
PUBLIC_IP="${PUBLIC_IP:-34.123.42.233}"

require_sudo() {
  if ! sudo -v; then
    echo "This installer needs sudo access for packages and systemd."
    echo "Run it with a user that can use sudo, then try again."
    exit 1
  fi
}

upsert_env() {
  local key="$1"
  local value="$2"
  local env_file="$PROJECT_DIR/.env"

  touch "$env_file"
  if grep -q "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    echo "${key}=${value}" >> "$env_file"
  fi
}

echo "== Checking sudo access =="
require_sudo

echo "== Installing system packages =="
sudo apt-get update
sudo apt-get install -y git python3 python3-pip python3-venv openssl curl rsync

echo "== Downloading project =="
if [ -d "$PROJECT_DIR/.git" ]; then
  git -C "$PROJECT_DIR" pull --ff-only origin main
elif [ -d "$PROJECT_DIR" ]; then
  BACKUP_DIR="${PROJECT_DIR}.backup.$(date +%Y%m%d-%H%M%S)"
  mv "$PROJECT_DIR" "$BACKUP_DIR"
  git clone "$REPO_URL" "$PROJECT_DIR"

  [ -d "$BACKUP_DIR/data" ] && rsync -a "$BACKUP_DIR/data/" "$PROJECT_DIR/data/"
  [ -d "$BACKUP_DIR/certs" ] && rsync -a "$BACKUP_DIR/certs/" "$PROJECT_DIR/certs/"
  [ -f "$BACKUP_DIR/.env" ] && cp "$BACKUP_DIR/.env" "$PROJECT_DIR/.env"
else
  git clone "$REPO_URL" "$PROJECT_DIR"
fi

cd "$PROJECT_DIR"
mkdir -p data certs

echo "== Generating local HTTPS certificate =="
if [ ! -f certs/cert.pem ] || [ ! -f certs/key.pem ]; then
  openssl req -x509 -newkey rsa:4096 \
    -keyout certs/key.pem \
    -out certs/cert.pem \
    -sha256 -days 365 -nodes \
    -subj "/C=BR/O=LP da Semana/CN=$PUBLIC_IP" \
    -addext "subjectAltName=IP:$PUBLIC_IP,DNS:localhost"
fi
chmod 600 certs/key.pem
chmod 644 certs/cert.pem

echo "== Creating/updating .env =="
if [ ! -f .env ]; then
  cat > .env <<ENVEOF
DISCOGS_USER=heriveltogabriel
DISCOGS_USER_AGENT=VinylDisplayMVP/0.1 +https://$PUBLIC_IP
DISCOGS_TOKEN=
VINYL_DATA_DIR=data
VINYL_DATABASE_PATH=data/vinyl_display.sqlite3
VINYL_STATIC_DIR=static
VINYL_HOST=0.0.0.0
VINYL_PORT=8080
VINYL_CLIP_SECONDS=5
VINYL_CERT_FILE=$PROJECT_DIR/certs/cert.pem
VINYL_KEY_FILE=$PROJECT_DIR/certs/key.pem
RAPIDAPI_SHAZAM_KEY=
RAPIDAPI_SHAZAM_HOST=shazam-core.p.rapidapi.com
LYRICS_LATENCY_OFFSET=1.3
ENVEOF
else
  upsert_env "DISCOGS_USER_AGENT" "VinylDisplayMVP/0.1 +https://$PUBLIC_IP"
  upsert_env "VINYL_DATA_DIR" "data"
  upsert_env "VINYL_DATABASE_PATH" "data/vinyl_display.sqlite3"
  upsert_env "VINYL_STATIC_DIR" "static"
  upsert_env "VINYL_HOST" "0.0.0.0"
  upsert_env "VINYL_PORT" "8080"
  upsert_env "VINYL_CLIP_SECONDS" "5"
  upsert_env "VINYL_CERT_FILE" "$PROJECT_DIR/certs/cert.pem"
  upsert_env "VINYL_KEY_FILE" "$PROJECT_DIR/certs/key.pem"
  upsert_env "RAPIDAPI_SHAZAM_HOST" "shazam-core.p.rapidapi.com"
  upsert_env "LYRICS_LATENCY_OFFSET" "1.3"
fi

sudo chown -R "$APP_USER:$APP_USER" "$PROJECT_DIR"

echo "== Configuring systemd service =="
PYTHON_BIN="$(command -v python3)"

sudo tee "/etc/systemd/system/$SERVICE_NAME.service" > /dev/null <<SERVICEEOF
[Unit]
Description=Vinyl Display PWA Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$PROJECT_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$PYTHON_BIN -m vinyl_display.server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

echo "== Starting service =="
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "== Healthcheck =="
sleep 2
curl -ksS https://127.0.0.1:8080/api/health
echo
sudo systemctl status "$SERVICE_NAME" --no-pager -l

cat <<DONE

Installation complete.
App:   https://$PUBLIC_IP:8080
Admin: https://$PUBLIC_IP:8080/admin

Initial admin password: admin123

If the app opens locally but not from the browser, allow TCP 8080 in the
Google Cloud firewall for this VM.
DONE
