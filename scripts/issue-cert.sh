#!/usr/bin/env bash
# =============================================================================
# scripts/issue-cert.sh — issue a Let's Encrypt cert for NGINX_SERVER_NAME.
#
# Prereqs:
#   • DNS A/AAAA record for $NGINX_SERVER_NAME points at this host.
#   • Port 80 is open (ACME HTTP-01).
#   • .env has NGINX_SERVER_NAME + CERTBOT_EMAIL set.
#
# After first success, flip nginx.conf to force HTTPS.
# =============================================================================
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/outbound-ai}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"

log() { printf '\033[36m[cert]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[cert]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$DEPLOY_ROOT"
[ -f .env ] || die ".env missing."

# shellcheck disable=SC1091
set -a; . ./.env; set +a

[ -n "${NGINX_SERVER_NAME:-}" ] || die "NGINX_SERVER_NAME not set in .env."
[ -n "${CERTBOT_EMAIL:-}"      ] || die "CERTBOT_EMAIL not set in .env."

log "Issuing cert for $NGINX_SERVER_NAME…"
$COMPOSE_CMD --profile tls run --rm certbot
log "Cert issued. Reloading nginx…"
$COMPOSE_CMD exec -T nginx nginx -s reload
log "Done. Renewals: add 'docker compose --profile tls run --rm certbot renew' to cron."
