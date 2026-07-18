#!/usr/bin/env bash
# =============================================================================
# scripts/update.sh — pull latest code + rebuild + rolling restart.
#
# Intended entrypoint for the GitHub Actions CD workflow. Safe to run
# manually.
#
# Usage:
#   sudo ./scripts/update.sh
# =============================================================================
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/outbound-ai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"
BRANCH="${DEPLOY_BRANCH:-main}"

log()  { printf '\033[36m[update]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[update]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not installed."
$COMPOSE_CMD version >/dev/null || die "docker compose plugin missing."
[ -d "$DEPLOY_ROOT" ] || die "$DEPLOY_ROOT does not exist."
cd "$DEPLOY_ROOT"
[ -f .env ] || die ".env missing."

log "Pulling latest code (branch: $BRANCH)…"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"
git log -1 --pretty=format:'  → HEAD is %h "%s"%n' || true

log "Backing up postgres before update (safety net)…"
./scripts/backup-db.sh || true

log "Pulling image bases…"
$COMPOSE_CMD -f "$COMPOSE_FILE" pull postgres redis nginx || true

log "Rebuilding backend + frontend images…"
$COMPOSE_CMD -f "$COMPOSE_FILE" build --pull backend frontend

log "Rolling restart…"
# Restart data services first so migrations that expect them will find them.
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d postgres redis
# Then app services with --force-recreate to pick up the new images.
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend frontend
# Reload nginx (config-only reload avoids dropping connections).
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d --no-deps nginx
$COMPOSE_CMD -f "$COMPOSE_FILE" exec -T nginx nginx -s reload || true

log "Waiting for backend to report healthy (up to 90s)…"
ok=0
for i in $(seq 1 30); do
  status=$($COMPOSE_CMD -f "$COMPOSE_FILE" ps --format json backend 2>/dev/null | \
           tr -d '\r' | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -1)
  if [ "$status" = "healthy" ]; then
    ok=1
    break
  fi
  sleep 3
done
if [ "$ok" -eq 0 ]; then
  die "Backend did not become healthy — check 'docker compose logs backend'."
fi

log "Pruning dangling images…"
docker image prune -f >/dev/null || true

log "Update complete."
$COMPOSE_CMD -f "$COMPOSE_FILE" ps
