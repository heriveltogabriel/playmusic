#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/install_oci_backup_timer.sh

Required:
  OCI_BACKUP_BUCKET     OCI Object Storage bucket name.

Optional:
  OCI_BACKUP_PREFIX     Object prefix. Default: oracle-primary
  OCI_CLI_AUTH          OCI CLI auth mode. Default: instance_principal
  OCI_CLI_PROFILE       OCI CLI profile name, when using API key auth.
  OCI_CLI_REGION        OCI region override.
  OCI_NAMESPACE         OCI Object Storage namespace override.
  PROJECT_DIR           Vinyl Display project directory. Default: script parent.
  APP_USER              Linux user that runs the backup. Default: current user.
  SERVICE_PATH          PATH used by systemd service. Default includes user bins.
  BACKUP_SERVICE_NAME   systemd backup service name. Default: vinyl-display-backup
  BACKUP_ON_CALENDAR    systemd OnCalendar value. Default: *-*-* 03:00:00
  LOCAL_RETENTION_DAYS  Days to keep local archives. Default: 7
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
APP_USER="${APP_USER:-${SUDO_USER:-$USER}}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
OCI_BACKUP_BUCKET="${OCI_BACKUP_BUCKET:-}"
OCI_BACKUP_PREFIX="${OCI_BACKUP_PREFIX:-oracle-primary}"
OCI_CLI_AUTH="${OCI_CLI_AUTH:-instance_principal}"
OCI_CLI_PROFILE="${OCI_CLI_PROFILE:-}"
OCI_CLI_REGION="${OCI_CLI_REGION:-}"
OCI_NAMESPACE="${OCI_NAMESPACE:-}"
SERVICE_PATH="${SERVICE_PATH:-$APP_HOME/.local/bin:$APP_HOME/bin:/usr/local/bin:/usr/bin:/bin}"
BACKUP_SERVICE_NAME="${BACKUP_SERVICE_NAME:-vinyl-display-backup}"
BACKUP_ON_CALENDAR="${BACKUP_ON_CALENDAR:-*-*-* 03:00:00}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
SERVICE_FILE="/etc/systemd/system/$BACKUP_SERVICE_NAME.service"
TIMER_FILE="/etc/systemd/system/$BACKUP_SERVICE_NAME.timer"

if [ -z "$OCI_BACKUP_BUCKET" ]; then
  echo "Missing OCI_BACKUP_BUCKET."
  usage
  exit 1
fi

if [ ! -x "$PROJECT_DIR/scripts/backup_oci.sh" ]; then
  echo "Backup script is missing or not executable: $PROJECT_DIR/scripts/backup_oci.sh"
  exit 1
fi

if ! sudo -v; then
  echo "This installer needs sudo access to create systemd units."
  exit 1
fi

echo "== Writing $SERVICE_FILE =="
sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Vinyl Display OCI backup
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$PROJECT_DIR
Environment=PATH=$SERVICE_PATH
Environment=PROJECT_DIR=$PROJECT_DIR
Environment=OCI_BACKUP_BUCKET=$OCI_BACKUP_BUCKET
Environment=OCI_BACKUP_PREFIX=$OCI_BACKUP_PREFIX
Environment=OCI_CLI_AUTH=$OCI_CLI_AUTH
Environment=OCI_CLI_PROFILE=$OCI_CLI_PROFILE
Environment=OCI_CLI_REGION=$OCI_CLI_REGION
Environment=OCI_NAMESPACE=$OCI_NAMESPACE
Environment=LOCAL_RETENTION_DAYS=$LOCAL_RETENTION_DAYS
ExecStart=/usr/bin/bash $PROJECT_DIR/scripts/backup_oci.sh
EOF

echo "== Writing $TIMER_FILE =="
sudo tee "$TIMER_FILE" >/dev/null <<EOF
[Unit]
Description=Run Vinyl Display OCI backup daily

[Timer]
OnCalendar=$BACKUP_ON_CALENDAR
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
EOF

echo "== Enabling timer =="
sudo systemctl daemon-reload
sudo systemctl enable --now "$BACKUP_SERVICE_NAME.timer"

cat <<EOF
Backup timer installed.
Service: $BACKUP_SERVICE_NAME.service
Timer:   $BACKUP_SERVICE_NAME.timer

Useful commands:
  sudo systemctl list-timers '$BACKUP_SERVICE_NAME.timer'
  sudo systemctl start '$BACKUP_SERVICE_NAME.service'
  sudo journalctl -u '$BACKUP_SERVICE_NAME.service' -n 100 --no-pager
EOF
