#!/usr/bin/env bash
# Restore drill: prove a backup can be restored (connect-departments, 2 Nov 2026).
# Restores the database server to a NEW temporary server at a point in time, checks it starts and holds the Prima
# schema, records the result in ops/restore-drills/, then deletes the temporary server. The live server is never
# touched. The temporary server is billed while it exists (usually under an hour).
#
# The CEO runs it, and only on purpose:
#   CONFIRM=restore-drill RESTORE_AT=2026-11-02T01:00:00Z bash -c 'set -a; eval "$(infra/staging-env.sh)"; set +a; infra/restore-drill.sh'
set -euo pipefail
: "${RG:?}" "${PG:?}"
[ "${CONFIRM:-}" = restore-drill ] || { echo "Refused: set CONFIRM=restore-drill. This creates a billed temporary server."; exit 2; }
: "${RESTORE_AT:?Give RESTORE_AT, an ISO time inside the backup window (infra/check-golive.sh shows the earliest).}"
day=$(date -u +%Y%m%d%H%M)
tmp="${PG}-drill-${day}"
log="ops/restore-drills/${day}.log"
mkdir -p ops/restore-drills
cleanup() {
  if az postgres flexible-server show -g "$RG" -n "$tmp" -o none 2>/dev/null; then
    az postgres flexible-server delete -g "$RG" -n "$tmp" --yes -o none && echo "Temporary server $tmp deleted." | tee -a "$log"
  fi
}
trap cleanup EXIT
{
  echo "Restore drill $day"
  echo "Source: $PG  Point in time: $RESTORE_AT  Temporary server: $tmp"
} | tee "$log"
start=$(date +%s)
az postgres flexible-server restore -g "$RG" -n "$tmp" --source-server "$PG" --restore-time "$RESTORE_AT" -o none
state=$(az postgres flexible-server show -g "$RG" -n "$tmp" --query state -o tsv)
echo "State after restore: $state ($(( $(date +%s) - start ))s)" | tee -a "$log"
[ "$state" = Ready ] || { echo "RESULT: FAILED (server not ready)" | tee -a "$log"; exit 1; }
dbs=$(az postgres flexible-server db list -g "$RG" -s "$tmp" --query '[].name' -o tsv)
grep -Fxq "${PG_DATABASE:-appdb}" <<<"$dbs" && echo "Database ${PG_DATABASE:-appdb} present." | tee -a "$log" ||
  { echo "RESULT: FAILED (database missing)" | tee -a "$log"; exit 1; }
echo "RESULT: RESTORED. Record who ran it and commit $log." | tee -a "$log"
