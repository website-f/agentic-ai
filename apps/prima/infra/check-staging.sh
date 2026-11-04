#!/usr/bin/env bash
# Read-only check of the real Prima staging resources (pre-publication review, 28 Oct 2026). It replaces the earlier
# provisioning script, whose generated names did not match what exists in Azure and could have created a second
# database, vault and registry. This script CREATES, CHANGES and DELETES NOTHING: it only reads settings and names
# (never secret values) and fails if staging is not safe to deploy to.
#
# Run it after infra/staging-env.sh (GitHub Actions), or in Azure Cloud Shell:
#   bash -c 'set -a; eval "$(infra/staging-env.sh)"; set +a; infra/check-staging.sh'
set -euo pipefail
: "${RG:?}" "${PG:?}" "${PG_DATABASE:?}" "${ACR:?}" "${CAE:?}" "${API_APP:?}" "${SWA:?}" "${KV:?}"
: "${APP_IDENTITY:?}" "${DBSETUP_IDENTITY:?}" "${SETUP_JOB:?}" "${WEB_ORIGIN:?}" "${API_URL:?}"
: "${ENTRA_TENANT_ID:?}" "${ENTRA_SPA_CLIENT_ID:?}" "${ENTRA_API_CLIENT_ID:?}"

bad=0
ok() { echo "  ok    $*"; }
no() { echo "::error::$*"; echo "  FAIL  $*"; bad=1; }
warn() { echo "::warning::$*"; echo "  warn  $*"; }
q() { az "$@" -o tsv 2>/dev/null || true; }

echo "Resources in $RG (must already exist; nothing is created)"
for x in "postgres flexible-server:$PG" "acr:$ACR" "containerapp env:$CAE" "containerapp:$API_APP" "staticwebapp:$SWA" \
  "keyvault:$KV" "identity:$APP_IDENTITY" "identity:$DBSETUP_IDENTITY" "containerapp job:$SETUP_JOB"; do
  kind=${x%%:*} name=${x#*:}
  # shellcheck disable=SC2086
  if [ -n "$(q $kind show -g "$RG" -n "$name" --query id)" ]; then ok "$kind $name"; else no "$kind $name was not found in $RG"; fi
done

echo "Database"
# List databases rather than using db show -d: different installed Azure CLI versions may reject that short flag.
db_names=$(q postgres flexible-server db list -g "$RG" -s "$PG" --query '[].name')
if grep -Fxq "$PG_DATABASE" <<<"$db_names"; then
  ok "database $PG_DATABASE on $PG"
else
  no "database $PG_DATABASE was not listed on $PG (or could not be read)"
fi
pub=$(q postgres flexible-server show -g "$RG" -n "$PG" --query network.publicNetworkAccess)
[ "$pub" = Disabled ] && ok "no public database address" ||
  warn "$PG allows public network access ($pub). Keep its firewall to Azure services you trust; plan private access before real data."
ssl=$(q postgres flexible-server parameter show -g "$RG" -s "$PG" -n require_secure_transport --query value)
[ "${ssl,,}" = on ] && ok "encrypted connections required" || no "$PG does not require encrypted connections (require_secure_transport=$ssl)"
geo=$(q postgres flexible-server show -g "$RG" -n "$PG" --query backup.backupRetentionDays)
[ -n "$geo" ] && ok "backups kept $geo days" || warn "could not read the backup retention of $PG"

echo "API $API_APP"
env_json=$(az containerapp show -g "$RG" -n "$API_APP" --query "properties.template.containers[0].env" -o json 2>/dev/null || echo '[]')
envv() { jq -r --arg k "$1" '.[] | select(.name==$k) | (.value // ("secretref:" + .secretRef))' <<<"$env_json"; }
[ "$(envv ALLOW_DEV_LOGIN)" != true ] && ok "development sign-in off" || no "ALLOW_DEV_LOGIN=true on the API"
[ -z "$(envv DEV_TOKEN_SECRET)" ] && ok "no development token secret" || no "DEV_TOKEN_SECRET is set on the API; remove it"
# Azure may return secretRef together with value:""; jq's // treats "" as present, so the
# old envv helper incorrectly reported this valid configuration as missing. Never print URL values.
db_status=$(jq -r '
  [.[] | select(.name=="DATABASE_URL")] as $d |
  if ($d | length) == 0 then "missing"
  elif ($d | length) != 1 then "duplicate"
  elif (($d[0].value // "") | length) > 0 then "plaintext"
  elif (($d[0].secretRef // "") | length) > 0 then "secretref:" + $d[0].secretRef
  else "invalid" end
' <<<"$env_json")
case "$db_status" in
  secretref:*) ok "database address comes from a secret ($db_status)" ;;
  missing) no "the API has no DATABASE_URL" ;;
  plaintext) no "the API's DATABASE_URL contains a nonempty plain value; use a secret reference only" ;;
  duplicate) no "the API has multiple DATABASE_URL entries; remove duplicates" ;;
  *) no "the API's DATABASE_URL has neither a usable secret reference nor a value" ;;
esac
# Staff PINs are checked against keyed hashes (docs/STAFF_DATA_SECURITY.md). Without PIN_PEPPER from a secret, PIN
# sign-in on site devices and witness sign-offs is refused (a warning, not a failure: nothing breaks, PINs just stay off).
pin_status=$(jq -r '[.[] | select(.name=="PIN_PEPPER")] as $p |
  if ($p | length) == 0 then "missing" elif (($p[0].value // "") | length) > 0 then "plaintext"
  elif (($p[0].secretRef // "") | length) > 0 then "secretref" else "invalid" end' <<<"$env_json")
case "$pin_status" in
  secretref) ok "PIN key comes from a secret" ;;
  plaintext) no "PIN_PEPPER on the API is a plain value; use a Key Vault secret reference only" ;;
  *) warn "no PIN_PEPPER secret on the API: staff PIN checks are switched off until it is set" ;;
esac
[ "$(envv PRIMA_API_DB_USER)" = "" ] || [ "$(envv PRIMA_API_DB_USER)" = prima_api ] && ok "API database login is prima_api (checked again by the API at start-up)" ||
  no "PRIMA_API_DB_USER on the API is $(envv PRIMA_API_DB_USER), not prima_api"
[ "$(envv WEB_ORIGIN)" = "$WEB_ORIGIN" ] && ok "only $WEB_ORIGIN may call the API from a browser" || no "WEB_ORIGIN on the API is '$(envv WEB_ORIGIN)', expected $WEB_ORIGIN"
[ "$(envv ENTRA_TENANT_ID)" = "$ENTRA_TENANT_ID" ] && ok "Microsoft tenant" || no "ENTRA_TENANT_ID on the API differs from staging.env"
[ "$(envv ENTRA_SPA_CLIENT_ID)" = "$ENTRA_SPA_CLIENT_ID" ] && ok "website registration" || no "ENTRA_SPA_CLIENT_ID on the API differs from staging.env"
[ "$(envv ENTRA_API_CLIENT_ID)" = "$ENTRA_API_CLIENT_ID" ] && ok "API registration" || no "ENTRA_API_CLIENT_ID on the API differs from staging.env"
[ "$(envv NODE_ENV)" = "" ] || [ "$(envv NODE_ENV)" = production ] && ok "runs in production mode" || no "NODE_ENV on the API is $(envv NODE_ENV)"
fqdn=$(q containerapp show -g "$RG" -n "$API_APP" --query properties.configuration.ingress.fqdn)
[ "https://$fqdn" = "$API_URL" ] && ok "address $API_URL" || no "API address is https://$fqdn, staging.env says $API_URL"
[ "$(q containerapp show -g "$RG" -n "$API_APP" --query properties.configuration.ingress.allowInsecure)" != true ] && ok "HTTPS only" || no "the API allows plain HTTP"
uai=$(q identity show -g "$RG" -n "$APP_IDENTITY" --query id)
[ -n "$uai" ] && az containerapp show -g "$RG" -n "$API_APP" --query "identity.userAssignedIdentities" -o json 2>/dev/null | grep -qi "$APP_IDENTITY" &&
  ok "uses identity $APP_IDENTITY" || warn "the API does not list identity $APP_IDENTITY"
if az containerapp show -g "$RG" -n "$API_APP" --query "identity.userAssignedIdentities" -o json 2>/dev/null | grep -qi "$DBSETUP_IDENTITY"; then
  no "the API holds the database setup identity $DBSETUP_IDENTITY; it must not"
fi

echo "Database setup job $SETUP_JOB"
if az containerapp job show -g "$RG" -n "$SETUP_JOB" -o none 2>/dev/null; then
  args=$(q containerapp job show -g "$RG" -n "$SETUP_JOB" --query "join(' ', properties.template.containers[0].args || \`[]\`)")
  [[ "$args" == *db-setup* ]] && ok "runs db-setup" || no "$SETUP_JOB does not run dist/src/db-setup.js (args: $args)"
  job_db=$(az containerapp job show -g "$RG" -n "$SETUP_JOB" --query "properties.template.containers[0].env[?name=='DATABASE_URL'] | [0]" -o json 2>/dev/null || echo null)
  case "$(jq -r 'if . == null then "" elif .secretRef then "secret" else "plain" end' <<<"$job_db")" in
    secret) ok "administrator database address comes from a secret" ;;
    plain) no "the setup job's DATABASE_URL is written in plain text in its settings; move it to a Key Vault secret" ;;
    *) warn "could not read the setup job's DATABASE_URL setting" ;;
  esac
  az containerapp job show -g "$RG" -n "$SETUP_JOB" --query "identity.userAssignedIdentities" -o json 2>/dev/null | grep -qi "$APP_IDENTITY" &&
    no "the setup job holds the API's identity $APP_IDENTITY; it must use $DBSETUP_IDENTITY only" || ok "setup job does not use the API's identity"
  echo "  note  routine deploys never run this job; the CEO runs migrations with infra/run-db-migration.sh"
fi

echo "Database schema"
schema=$(curl -fsS --max-time 10 "$API_URL/api/health/schema" 2>/dev/null || true)
want=$(sha256sum db/migrations/001_init.sql | cut -d' ' -f1)
if [ -z "$schema" ]; then
  warn "the running API does not report its schema version yet (older image); the next deploy's new API checks it at start-up"
elif [ "$(jq -r .applied <<<"$schema")" = "$want" ]; then
  ok "database schema matches this branch"
else
  warn "database schema $(jq -r '.applied // "not marked"' <<<"$schema" | cut -c1-12) differs from this branch's ${want:0:12}: the CEO must run infra/run-db-migration.sh before the next deploy"
fi

echo "Key Vault $KV (names only, values are never read)"
names=$(q keyvault secret list --vault-name "$KV" --query "[].name")
if [ -n "$names" ]; then ok "secrets: $(echo $names)"; else warn "could not list secret names in $KV (needs Key Vault Secrets User or Reader on names)"; fi
[ "$(q keyvault show -g "$RG" -n "$KV" --query properties.enablePurgeProtection)" = true ] && ok "purge protection on" ||
  warn "purge protection is off on $KV: a deleted secret cannot be recovered after the soft-delete period"

echo "Website $SWA"
host=$(q staticwebapp show -g "$RG" -n "$SWA" --query defaultHostname)
[ "https://$host" = "$WEB_ORIGIN" ] && ok "address $WEB_ORIGIN" || no "website address is https://$host, staging.env says $WEB_ORIGIN"

echo "Registry $ACR"
[ "$(q acr show -g "$RG" -n "$ACR" --query adminUserEnabled)" != true ] && ok "admin user off" || warn "$ACR has its admin user on; turn it off"

echo "Microsoft sign-in website registration"
uris=$(az ad app show --id "$ENTRA_SPA_CLIENT_ID" --query "spa.redirectUris" -o tsv 2>/dev/null || true)
if [ -z "$uris" ]; then
  warn "could not read the website registration's redirect addresses (needs directory read)"
elif grep -qx "$WEB_ORIGIN/" <<<"$uris"; then
  ok "redirect address $WEB_ORIGIN/ registered as a single-page app"
else
  no "add $WEB_ORIGIN/ (with the slash) as a Single-page application redirect URI on 'Prima Secure App - Staging'"
fi

if [ "$bad" = 1 ]; then echo "Staging is NOT ready to deploy. Fix the FAIL lines above."; exit 1; fi
echo "Staging checks passed."
