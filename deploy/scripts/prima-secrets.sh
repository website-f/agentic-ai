#!/usr/bin/env bash
# P65: add Prima Secure's secrets to .env when missing (never changes one already there, never
# prints a value). Run once on the server before the first deploy with Prima; deploy-vps.sh
# also runs it. Passwords are hex, so they are safe in database URLs.
#
# The Microsoft sign-in identifiers (tenant, app registrations) are public IDs, not secrets:
# they default to Prima's existing "Prima Secure App" / "Prima Secure API" registrations
# (apps/prima/infra/staging.env). The SPA registration must list
# https://<this site>/prisma/ as a redirect URI (Microsoft Entra > App registrations).
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=.env
touch "$ENV_FILE"

has() { grep -qE "^$1=" "$ENV_FILE"; }
add() { has "$1" || { printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; echo "prima-secrets: added $1"; }; }
hex() { openssl rand -hex "$1"; }

add PRIMA_DB_SUPER_PASSWORD "$(hex 24)"
add PRIMA_OWNER_PASSWORD "$(hex 24)"
add PRIMA_API_DB_PASSWORD "$(hex 24)"   # >= 24 characters (db-setup requires it)
add PRIMA_PIN_PEPPER "$(hex 32)"        # >= 32 characters (staff/guard PINs)
add PRIMA_OFFICE_SECRET "$(hex 32)"     # P66: the office signs its calls to Prima with it

staging=apps/prima/infra/staging.env
val() { grep -E "^$1=" "$staging" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }
if [ -f "$staging" ]; then
  [ -n "$(val AZURE_TENANT_ID)" ] && add PRIMA_ENTRA_TENANT_ID "$(val AZURE_TENANT_ID)"
  [ -n "$(val ENTRA_SPA_CLIENT_ID)" ] && add PRIMA_ENTRA_SPA_CLIENT_ID "$(val ENTRA_SPA_CLIENT_ID)"
  [ -n "$(val ENTRA_API_CLIENT_ID)" ] && add PRIMA_ENTRA_API_CLIENT_ID "$(val ENTRA_API_CLIENT_ID)"
  [ -n "$(val ENTRA_API_APP_ID_URI)" ] && add PRIMA_ENTRA_API_APP_ID_URI "$(val ENTRA_API_APP_ID_URI)"
fi
exit 0
