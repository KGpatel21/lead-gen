#!/usr/bin/env bash
# =============================================================================
# scripts/backup-db.sh — nightly / on-demand Postgres backup.
#
# Writes a compressed pg_dump to $BACKUP_DIR (default: /var/backups/outbound).
# Retains the last $BACKUP_RETAIN files (default: 14).
#
# Optional: if $BACKUP_S3_BUCKET is set, also uploads via `aws s3 cp`.
#
# Recommended cron on the host (as root):
#   0 3 * * *  /opt/outbound-ai/scripts/backup-db.sh >>/var/log/outbound-backup.log 2>&1
# =============================================================================
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/outbound-ai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/outbound}"
BACKUP_RETAIN="${BACKUP_RETAIN:-14}"

log()  { printf '\033[36m[backup]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[backup]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not installed."
$COMPOSE_CMD version >/dev/null || die "docker compose plugin missing."
[ -d "$DEPLOY_ROOT" ] || die "$DEPLOY_ROOT does not exist."
cd "$DEPLOY_ROOT"

# Pull creds out of the running container's env so we never inline them here.
DB_USER=$($COMPOSE_CMD exec -T postgres printenv POSTGRES_USER 2>/dev/null | tr -d '\r')
DB_NAME=$($COMPOSE_CMD exec -T postgres printenv POSTGRES_DB 2>/dev/null | tr -d '\r')
[ -z "$DB_USER" ] && die "Could not resolve POSTGRES_USER — is postgres running?"
[ -z "$DB_NAME" ] && die "Could not resolve POSTGRES_DB — is postgres running?"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/outbound-${DB_NAME}-${STAMP}.sql.gz"

log "Dumping $DB_NAME as $DB_USER → $OUT"
# --clean --if-exists → makes the dump safely restorable over an existing DB.
# --no-owner --no-acl → replay onto any user without ownership grants.
$COMPOSE_CMD exec -T postgres \
  pg_dump --clean --if-exists --no-owner --no-acl -U "$DB_USER" -d "$DB_NAME" \
  | gzip -9 > "$OUT"

# Verify the archive isn't empty/corrupt.
if [ ! -s "$OUT" ] || ! gzip -t "$OUT" 2>/dev/null; then
  rm -f "$OUT"
  die "Backup file is empty or corrupted — aborted."
fi

BYTES=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
log "Backup complete: $(du -h "$OUT" | cut -f1) ($BYTES bytes)."

# ---- Retention -------------------------------------------------------------
log "Pruning to newest $BACKUP_RETAIN backups…"
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/outbound-"$DB_NAME"-*.sql.gz 2>/dev/null | \
  awk -v keep="$BACKUP_RETAIN" 'NR>keep' | \
  xargs -r rm -f

# ---- Optional S3 upload ---------------------------------------------------
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if command -v aws >/dev/null; then
    log "Uploading to s3://${BACKUP_S3_BUCKET}/"
    aws s3 cp "$OUT" "s3://${BACKUP_S3_BUCKET}/$(basename "$OUT")" --only-show-errors
  else
    log "BACKUP_S3_BUCKET set but AWS CLI not installed — skipping upload."
  fi
fi

log "Done."
