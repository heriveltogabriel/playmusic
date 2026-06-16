#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/restore_oci.sh
  OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/restore_oci.sh oracle-primary/daily/playmusic-backup-YYYYMMDD-HHMMSS.tgz

Required:
  OCI_BACKUP_BUCKET     OCI Object Storage bucket name.

Optional:
  OCI_BACKUP_OBJECT     Object to restore. Default: OCI_BACKUP_PREFIX/latest.tgz
  OCI_BACKUP_PREFIX     Object prefix. Default: oracle-primary
  OCI_CLI_AUTH          OCI CLI auth mode. Default: instance_principal
  OCI_CLI_PROFILE       OCI CLI profile name, when using API key auth.
  OCI_CLI_REGION        OCI region override.
  OCI_NAMESPACE         OCI Object Storage namespace override.
  PROJECT_DIR           Vinyl Display project directory. Default: script parent.
  BACKUP_ROOT           Local restore safety directory. Default: PROJECT_DIR/backups/oci
  SERVICE_NAME          systemd service name. Default: vinyl-display
  RESTORE_ENV           Restore .env if present in archive. Default: 0
  RESTORE_CERTS         Restore certs/ if present in archive. Default: 0

Notes:
  The script validates the downloaded SQLite database before it stops the app.
  It creates a local pre-restore archive of the current data/ directory.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_ROOT="${BACKUP_ROOT:-$PROJECT_DIR/backups/oci}"
OCI_BACKUP_BUCKET="${OCI_BACKUP_BUCKET:-}"
OCI_BACKUP_PREFIX="${OCI_BACKUP_PREFIX:-oracle-primary}"
OCI_BACKUP_OBJECT="${1:-${OCI_BACKUP_OBJECT:-$OCI_BACKUP_PREFIX/latest.tgz}}"
OCI_CLI_AUTH="${OCI_CLI_AUTH:-instance_principal}"
OCI_CLI_PROFILE="${OCI_CLI_PROFILE:-}"
OCI_CLI_REGION="${OCI_CLI_REGION:-}"
OCI_NAMESPACE="${OCI_NAMESPACE:-}"
SERVICE_NAME="${SERVICE_NAME:-vinyl-display}"
RESTORE_ENV="${RESTORE_ENV:-0}"
RESTORE_CERTS="${RESTORE_CERTS:-0}"
APP_USER="${APP_USER:-${SUDO_USER:-$USER}}"

if [ -z "$OCI_BACKUP_BUCKET" ]; then
  echo "Missing OCI_BACKUP_BUCKET."
  usage
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local env_file="$PROJECT_DIR/.env"
  local line

  [ -f "$env_file" ] || return 0
  line="$(grep -E "^(export[[:space:]]+)?${key}=" "$env_file" | tail -n 1 || true)"
  [ -n "$line" ] || return 0

  printf '%s\n' "$line" \
    | sed -E "s/^(export[[:space:]]+)?${key}=//" \
    | sed -E 's/[[:space:]]+#.*$//' \
    | sed -E 's/^["'\'']//; s/["'\'']$//'
}

abs_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$PROJECT_DIR/$1" ;;
  esac
}

service_exists() {
  command -v systemctl >/dev/null 2>&1 \
    && systemctl list-unit-files --no-legend "$SERVICE_NAME.service" 2>/dev/null \
      | awk '{print $1}' \
      | grep -Fxq "$SERVICE_NAME.service"
}

oci_common_args=()
[ -n "$OCI_CLI_AUTH" ] && oci_common_args+=(--auth "$OCI_CLI_AUTH")
[ -n "$OCI_CLI_PROFILE" ] && oci_common_args+=(--profile "$OCI_CLI_PROFILE")
[ -n "$OCI_CLI_REGION" ] && oci_common_args+=(--region "$OCI_CLI_REGION")

oci_object_args=()
[ -n "$OCI_NAMESPACE" ] && oci_object_args+=(--namespace-name "$OCI_NAMESPACE")
oci_object_args+=(--bucket-name "$OCI_BACKUP_BUCKET")

require_cmd oci
require_cmd sqlite3
require_cmd tar
require_cmd rsync

DATA_DIR_VALUE="$(read_env_value VINYL_DATA_DIR)"
DATABASE_PATH_VALUE="$(read_env_value VINYL_DATABASE_PATH)"
DATA_DIR="$(abs_path "${DATA_DIR_VALUE:-data}")"
DB_PATH="$(abs_path "${DATABASE_PATH_VALUE:-data/vinyl_display.sqlite3}")"
DB_BASENAME="$(basename "$DB_PATH")"

mkdir -p "$BACKUP_ROOT"
WORK_DIR="$(mktemp -d "${BACKUP_ROOT}/restore.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

ARCHIVE="$WORK_DIR/restore-source.tgz"
EXTRACT_DIR="$WORK_DIR/extracted"
SAFETY_DIR="$WORK_DIR/current"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
SAFETY_ARCHIVE="$BACKUP_ROOT/pre-restore-$STAMP.tgz"

echo "== Downloading backup from OCI Object Storage =="
oci "${oci_common_args[@]}" os object get \
  "${oci_object_args[@]}" \
  --name "$OCI_BACKUP_OBJECT" \
  --file "$ARCHIVE" \
  --force >/dev/null

mkdir -p "$EXTRACT_DIR"
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"

RESTORE_DB="$EXTRACT_DIR/data/$DB_BASENAME"
if [ ! -f "$RESTORE_DB" ]; then
  echo "Backup archive does not contain data/$DB_BASENAME."
  exit 1
fi

echo "== Validating downloaded database =="
INTEGRITY="$(sqlite3 "$RESTORE_DB" "PRAGMA integrity_check;")"
if [ "$INTEGRITY" != "ok" ]; then
  echo "Downloaded SQLite integrity check failed: $INTEGRITY"
  exit 1
fi

if service_exists; then
  echo "== Stopping $SERVICE_NAME =="
  sudo systemctl stop "$SERVICE_NAME"
fi

echo "== Saving current local data before restore =="
mkdir -p "$SAFETY_DIR"
if [ -d "$DATA_DIR" ]; then
  mkdir -p "$SAFETY_DIR/data"
  rsync -a "$DATA_DIR/" "$SAFETY_DIR/data/"
fi
if [ -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env" "$SAFETY_DIR/.env"
fi
if [ -d "$PROJECT_DIR/certs" ]; then
  rsync -a "$PROJECT_DIR/certs/" "$SAFETY_DIR/certs/"
fi
tar -czf "$SAFETY_ARCHIVE" -C "$SAFETY_DIR" .

echo "== Restoring data directory =="
mkdir -p "$DATA_DIR"
rsync -a --delete "$EXTRACT_DIR/data/" "$DATA_DIR/"

if [ "$RESTORE_ENV" = "1" ] && [ -f "$EXTRACT_DIR/.env" ]; then
  cp "$EXTRACT_DIR/.env" "$PROJECT_DIR/.env"
fi

if [ "$RESTORE_CERTS" = "1" ] && [ -d "$EXTRACT_DIR/certs" ]; then
  mkdir -p "$PROJECT_DIR/certs"
  rsync -a --delete "$EXTRACT_DIR/certs/" "$PROJECT_DIR/certs/"
fi

sudo chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
[ -f "$PROJECT_DIR/.env" ] && sudo chown "$APP_USER:$APP_USER" "$PROJECT_DIR/.env"
[ -d "$PROJECT_DIR/certs" ] && sudo chown -R "$APP_USER:$APP_USER" "$PROJECT_DIR/certs"

if service_exists; then
  echo "== Starting $SERVICE_NAME =="
  sudo systemctl start "$SERVICE_NAME"
  sleep 2
  curl -ksS https://127.0.0.1:8080/api/health || true
  echo
fi

cat <<EOF
Restore completed.
Restored object:      $OCI_BACKUP_OBJECT
Pre-restore archive: $SAFETY_ARCHIVE
EOF
