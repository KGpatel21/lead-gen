#!/usr/bin/env bash
# =============================================================================
# scripts/restore-db.sh — restore a Postgres backup produced by backup-db.sh.
#
# Usage:
#   sudo ./scripts/restore-db.sh /var/backups/outbound/outbound-outbound_ai-YYYYMMDD-HHMMSS.sql.gz
#
# The backup dump uses --clean --if-exists so re-running it drops and
# recreates every table. This script will REFUSE to continue unless the
# operator confirms with the DB name, to prevent fat-fingering.
# =============================================================================
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/outbound-ai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"

log()  { printf '\033[36m[restore]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[restore]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[restore]\033[0m %s\n' "$*" >&2; exit 1; }

FILE="${1:-}"
[ -n "$FILE" ] || die "Usage: $0 <backup.sql.gz>"
[ -f "$FILE" ] || die "Backup file not found: $FILE"

command -v docker >/dev/null || die "docker not installed."
$COMPOSE_CMD version >/dev/null || die "docker compose plugin missing."
[ -d "$DEPLOY_ROOT" ] || die "$DEPLOY_ROOT does not exist."
cd "$DEPLOY_ROOT"

# Validate the archive.
gzip -t "$FILE" 2>/dev/null || die "Not a valid gzip file: $FILE"

DB_USER=$($COMPOSE_CMD exec -T postgres printenv POSTGRES_USER 2>/dev/null | tr -d '\r')
DB_NAME=$($COMPOSE_CMD exec -T postgres printenv POSTGRES_DB   2>/dev/null | tr -d '\r')
[ -z "$DB_USER" ] && die "postgres container not running."

warn "About to restore into database: '$DB_NAME' on user '$DB_USER'."
warn "This will DROP and recreate every table."
if [ "${YES:-}" != "1" ]; then
  read -r -p "Type the database name ('$DB_NAME') to continue: " confirm
  [ "$confirm" = "$DB_NAME" ] || die "Confirmation did not match — aborted."
fi

log "Pausing app services so the DB isn't mutated mid-restore…"
$COMPOSE_CMD -f "$COMPOSE_FILE" stop backend

log "Streaming $FILE into postgres…"
gunzip -c "$FILE" | \
  $COMPOSE_CMD exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"

log "Restore SQL replayed. Bringing app back up…"
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d backend

log "Waiting for backend healthy (up to 90s)…"
for i in $(seq 1 30); do
  status=$($COMPOSE_CMD -f "$COMPOSE_FILE" ps --format json backend 2>/dev/null | \
           tr -d '\r' | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -1)
  [ "$status" = "healthy" ] && { log "Backend healthy — restore complete."; exit 0; }
  sleep 3
done
die "Backend did not become healthy — inspect 'docker compose logs backend'."
