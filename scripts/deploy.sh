#!/usr/bin/env bash
# =============================================================================
# scripts/deploy.sh — first-time production deployment.
#
# Runs on a fresh EC2 host. Idempotent: safe to re-run.
#
# Prerequisites (once on the host):
#   • docker + docker compose plugin installed
#   • repo cloned to ${DEPLOY_ROOT:-/opt/outbound-ai}
#   • `.env` populated at the repo root (see .env.example)
#
# Usage:
#   sudo ./scripts/deploy.sh
# =============================================================================
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/outbound-ai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"

log()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not installed."
$COMPOSE_CMD version >/dev/null || die "docker compose plugin missing."

[ -d "$DEPLOY_ROOT" ] || die "$DEPLOY_ROOT does not exist. git clone the repo there first."
cd "$DEPLOY_ROOT"

[ -f .env ] || die ".env file missing at $DEPLOY_ROOT/.env — copy .env.example and fill it in."

# Ensure the certbot volumes exist so the nginx service can mount them on
# first boot even without a cert.
log "Ensuring persistent volumes exist…"
$COMPOSE_CMD -f "$COMPOSE_FILE" pull postgres redis nginx || true

log "Validating compose config…"
$COMPOSE_CMD -f "$COMPOSE_FILE" config >/dev/null

log "Building images…"
$COMPOSE_CMD -f "$COMPOSE_FILE" build --pull

log "Bringing the stack up…"
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d --remove-orphans

log "Waiting for backend to report healthy (up to 90s)…"
for i in $(seq 1 30); do
  status=$($COMPOSE_CMD -f "$COMPOSE_FILE" ps --format json backend 2>/dev/null | \
           tr -d '\r' | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -1)
  if [ "$status" = "healthy" ]; then
    log "Backend is healthy."
    break
  fi
  sleep 3
done

log "Stack status:"
$COMPOSE_CMD -f "$COMPOSE_FILE" ps

log "Deployment complete."
warn "Next steps:"
warn "  1. Point DNS for your APP host to this server."
warn "  2. Run ./scripts/issue-cert.sh (or 'docker compose --profile tls run --rm certbot')"
warn "     to obtain a Let's Encrypt certificate."
warn "  3. Flip nginx.conf to redirect HTTP → HTTPS."
