#!/usr/bin/env bash
# Read-only go-live check: backups, restore point, monitoring and alerts, and the hand-over layer (connect-departments,
# 2 Nov 2026). It CREATES, CHANGES and DELETES NOTHING and never prints secret values. It reports what still needs the
# CEO's decision before real staff data: it does not decide or buy anything.
#
#   bash -c 'set -a; eval "$(infra/staging-env.sh)"; set +a; infra/check-golive.sh'
#
# Exit 0: nothing blocking. Exit 1: at least one FAIL. Warnings are decisions for the CEO (cost or risk), not faults.
set -euo pipefail
: "${RG:?}" "${PG:?}" "${API_APP:?}" "${CAE:?}" "${API_URL:?}"

bad=0
ok() { echo "  ok    $*"; }
no() { echo "::error::$*"; echo "  FAIL  $*"; bad=1; }
warn() { echo "::warning::$*"; echo "  warn  $*"; }
q() { az "$@" -o tsv 2>/dev/null || true; }

echo "Backups ($PG)"
days=$(q postgres flexible-server show -g "$RG" -n "$PG" --query backup.backupRetentionDays)
if [ -z "$days" ]; then no "could not read the backup retention of $PG"
elif [ "$days" -ge 14 ]; then ok "point-in-time backups kept $days days"
else warn "backups kept only $days days; 14 or more is suggested before real data (Azure allows up to 35; extra backup storage may cost more)"; fi
georedundant=$(q postgres flexible-server show -g "$RG" -n "$PG" --query backup.geoRedundantBackup)
[ "$georedundant" = Enabled ] && ok "backups copied to a second region" ||
  warn "backups stay in one region (geoRedundantBackup=$georedundant). Turning it on is set when a server is created and costs more; CEO decision."
earliest=$(q postgres flexible-server show -g "$RG" -n "$PG" --query backup.earliestRestoreDate)
[ -n "$earliest" ] && ok "earliest restore point $earliest" || warn "no restore point reported yet"
ha=$(q postgres flexible-server show -g "$RG" -n "$PG" --query highAvailability.mode)
[ "$ha" = ZoneRedundant ] || [ "$ha" = SameZone ] && ok "standby server ($ha)" ||
  warn "no standby database server (highAvailability=$ha); an outage waits for Azure to restart it. Costs about double; CEO decision."
last_drill=$(ls -1 ops/restore-drills/*.log 2>/dev/null | tail -1 || true)
[ -n "$last_drill" ] && ok "last restore drill: $(basename "$last_drill" .log)" ||
  warn "no restore drill recorded in ops/restore-drills/. A backup is proven only by restoring it (infra/restore-drill.sh)."

echo "Monitoring ($API_APP)"
law=$(q containerapp env show -g "$RG" -n "$CAE" --query properties.appLogsConfiguration.destination)
[ "$law" = log-analytics ] && ok "API logs go to Log Analytics" || no "the Container Apps environment does not send logs to Log Analytics ($law)"
probes=$(az containerapp show -g "$RG" -n "$API_APP" --query "properties.template.containers[0].probes[].type" -o tsv 2>/dev/null || true)
for p in Liveness Readiness; do
  grep -qx "$p" <<<"$probes" && ok "$p probe set" || warn "no $p probe on the API; set it to GET /api/health so a stuck API is restarted"
done
minr=$(q containerapp show -g "$RG" -n "$API_APP" --query properties.template.scale.minReplicas)
[ "${minr:-0}" -ge 1 ] && ok "at least one API copy always running" ||
  warn "the API scales to zero (minReplicas=${minr:-0}); the first request after a quiet spell is slow. CEO cost decision."
alerts=$(q monitor metrics alert list -g "$RG" --query 'length(@)')
[ "${alerts:-0}" -ge 1 ] && ok "$alerts metric alert rule(s)" ||
  warn "no alert rules in $RG. Suggested: API restarts, 5xx responses, database CPU and storage above 80%, sent to the CEO and IT Lead."
budget=$(q consumption budget list --query "[?name=='prima-staging-monthly'].name | [0]")
[ -n "$budget" ] && ok "monthly budget alert $budget" || warn "no monthly budget alert found"

echo "Application health ($API_URL)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$API_URL/api/health" || true)
[ "$code" = 200 ] && ok "API answers and reads its database" || no "GET /api/health answered $code"
links=$(curl -s --max-time 15 "$API_URL/api/health/org-links" || true)
case "$links" in
  *'"ready":true'*) ok "hand-over layer ready ($(sed -E 's/.*"on":(true|false).*/on=\1/' <<<"$links"))" ;;
  '') warn "this API build has no /api/health/org-links yet" ;;
  *) no "hand-over layer switched on but not installed: run db/modules/org-links-v1.sql first" ;;
esac

[ "$bad" = 0 ] && echo "Nothing blocking. Read the warnings: each is a CEO decision." || echo "Fix the FAIL lines first."
exit "$bad"
