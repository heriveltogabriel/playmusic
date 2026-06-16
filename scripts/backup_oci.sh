#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/backup_oci.sh

Required:
  OCI_BACKUP_BUCKET     OCI Object Storage bucket name.

Optional:
  OCI_BACKUP_PREFIX     Object prefix. Default: oracle-primary
  OCI_CLI_AUTH          OCI CLI auth mode. Default: instance_principal
  OCI_CLI_PROFILE       OCI CLI profile name, when using API key auth.
  OCI_CLI_REGION        OCI region override.
  OCI_NAMESPACE         OCI Object Storage namespace override.
  PROJECT_DIR           Vinyl Display project directory. Default: script parent.
  BACKUP_ROOT           Local backup directory. Default: PROJECT_DIR/backups/oci
  LOCAL_RETENTION_DAYS  Days to keep local archives. Default: 7
  INCLUDE_ENV           Include .env in archive. Default: 0
  INCLUDE_CERTS         Include certs/ in archive. Default: 0

Notes:
  The script creates a consistent SQLite backup with sqlite3 .backup before
  archiving data/. It uploads both a timestamped object and latest.tgz.
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
OCI_CLI_AUTH="${OCI_CLI_AUTH:-instance_principal}"
OCI_CLI_PROFILE="${OCI_CLI_PROFILE:-}"
OCI_CLI_REGION="${OCI_CLI_REGION:-}"
OCI_NAMESPACE="${OCI_NAMESPACE:-}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
INCLUDE_ENV="${INCLUDE_ENV:-0}"
INCLUDE_CERTS="${INCLUDE_CERTS:-0}"

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

oci_common_args=()
[ -n "$OCI_CLI_AUTH" ] && oci_common_args+=(--auth "$OCI_CLI_AUTH")
[ -n "$OCI_CLI_PROFILE" ] && oci_common_args+=(--profile "$OCI_CLI_PROFILE")
[ -n "$OCI_CLI_REGION" ] && oci_common_args+=(--region "$OCI_CLI_REGION")

oci_object_args=()
[ -n "$OCI_NAMESPACE" ] && oci_object_args+=(--namespace-name "$OCI_NAMESPACE")
oci_object_args+=(--bucket-name "$OCI_BACKUP_BUCKET")

upload_object() {
  local source_file="$1"
  local object_name="$2"

  oci "${oci_common_args[@]}" os object put \
    "${oci_object_args[@]}" \
    --name "$object_name" \
    --file "$source_file" \
    --force >/dev/null
}

head_object() {
  local object_name="$1"

  oci "${oci_common_args[@]}" os object head \
    "${oci_object_args[@]}" \
    --name "$object_name" >/dev/null
}

require_cmd oci
require_cmd sqlite3
require_cmd tar
require_cmd cp

DATA_DIR_VALUE="$(read_env_value VINYL_DATA_DIR)"
DATABASE_PATH_VALUE="$(read_env_value VINYL_DATABASE_PATH)"
DATA_DIR="$(abs_path "${DATA_DIR_VALUE:-data}")"
DB_PATH="$(abs_path "${DATABASE_PATH_VALUE:-data/vinyl_display.sqlite3}")"

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found: $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_ROOT"
WORK_DIR="$(mktemp -d "${BACKUP_ROOT}/work.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

STAMP="$(date -u +%Y%m%d-%H%M%S)"
HOSTNAME_VALUE="$(hostname 2>/dev/null || echo unknown-host)"
APP_VERSION="$(cat "$PROJECT_DIR/version.txt" 2>/dev/null || true)"
STAGING_DIR="$WORK_DIR/package"
SQLITE_SNAPSHOT="$WORK_DIR/vinyl_display.sqlite3"
ARCHIVE="$BACKUP_ROOT/playmusic-backup-$STAMP.tgz"
OBJECT_NAME="$OCI_BACKUP_PREFIX/daily/playmusic-backup-$STAMP.tgz"
LATEST_OBJECT_NAME="$OCI_BACKUP_PREFIX/latest.tgz"

mkdir -p "$STAGING_DIR/data"

echo "== Creating SQLite snapshot =="
sqlite3 "$DB_PATH" ".backup '$SQLITE_SNAPSHOT'"
INTEGRITY="$(sqlite3 "$SQLITE_SNAPSHOT" "PRAGMA integrity_check;")"
if [ "$INTEGRITY" != "ok" ]; then
  echo "SQLite integrity check failed: $INTEGRITY"
  exit 1
fi

echo "== Staging data directory =="
if [ -d "$DATA_DIR" ]; then
  cp -a "$DATA_DIR/." "$STAGING_DIR/data/"
fi
rm -f \
  "$STAGING_DIR/data/$(basename "$DB_PATH")" \
  "$STAGING_DIR/data/$(basename "$DB_PATH")-shm" \
  "$STAGING_DIR/data/$(basename "$DB_PATH")-wal"
cp "$SQLITE_SNAPSHOT" "$STAGING_DIR/data/$(basename "$DB_PATH")"

if [ "$INCLUDE_ENV" = "1" ] && [ -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env" "$STAGING_DIR/.env"
fi

if [ "$INCLUDE_CERTS" = "1" ] && [ -d "$PROJECT_DIR/certs" ]; then
  mkdir -p "$STAGING_DIR/certs"
  cp -a "$PROJECT_DIR/certs/." "$STAGING_DIR/certs/"
fi

cat > "$STAGING_DIR/manifest.env" <<EOF
created_at_utc=$STAMP
source_host=$HOSTNAME_VALUE
project_dir=$PROJECT_DIR
data_dir=$DATA_DIR
database_path=$DB_PATH
app_version=$APP_VERSION
include_env=$INCLUDE_ENV
include_certs=$INCLUDE_CERTS
EOF

echo "== Creating archive =="
tar -czf "$ARCHIVE" -C "$STAGING_DIR" .

echo "== Uploading to OCI Object Storage =="
upload_object "$ARCHIVE" "$OBJECT_NAME"
upload_object "$ARCHIVE" "$LATEST_OBJECT_NAME"
head_object "$OBJECT_NAME"
head_object "$LATEST_OBJECT_NAME"

find "$BACKUP_ROOT" -type f -name 'playmusic-backup-*.tgz' -mtime "+$LOCAL_RETENTION_DAYS" -delete

cat <<EOF
Backup completed.
Local archive: $ARCHIVE
OCI object:    $OBJECT_NAME
OCI latest:    $LATEST_OBJECT_NAME
EOF
