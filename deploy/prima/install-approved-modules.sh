#!/bin/bash
# Kept in the repo (P88) so a rebuilt or restored office database gets the same 13 upstream modules: run it on the
# server as root (it reads /opt/agentic-ai/.env). "rehearse" restores a copy of live and installs there; "live" backs up,
# then installs on the live database. Upstream keeps these modules out of startup on purpose; they are installed explicitly.
# P88b: install the 13 upstream modules the owner approved (Fitri, 8 Nov 2026: "install it immediately").
# Usage: modules.sh rehearse | live. Explicit migration, as upstream asks: each file once, as the schema owner,
# stopping at the first error. Prints counts and names only, never row data.
set -euo pipefail
MODE=${1:?rehearse or live}
W=/root/p88-rehearsal; cd "$W"
set -a; . /opt/agentic-ai/.env; set +a
MODS=/opt/agentic-ai/apps/prima/db/modules
ORDER="client-codes rba-readiness am-extras cleaning-ops fw-epf-socso-recharge fw-recruitment-cost governance-registers pdpa-register quality-compliance site-surveys staff-directory tender-opportunities time-slip"
TS=$(date -u +%Y%m%dT%H%M%SZ)
counts() { docker exec $1 psql -At -U prima_super -d prima -c "SELECT format('%s %s', c.relname, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM prima.%I', c.relname), false, true, '')))[1]::text) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relkind='r' ORDER BY 1"; }

echo "== backup of live Prima"
docker exec agentic-prima-db-1 pg_dumpall -U prima_super --clean --if-exists | gzip -9 > "$W/prima-premodules-$TS.sql.gz"; chmod 600 "$W/prima-premodules-$TS.sql.gz"
gzip -t "$W/prima-premodules-$TS.sql.gz" && echo "backup ok: prima-premodules-$TS.sql.gz"

if [ "$MODE" = rehearse ]; then
  DBC=p88m-db; NET=p88m-net
  docker rm -f $DBC p88m-api >/dev/null 2>&1 || true; docker network create --internal $NET >/dev/null 2>&1 || true
  docker run -d --name $DBC --network $NET -e POSTGRES_USER=prima_super -e POSTGRES_PASSWORD="$PRIMA_DB_SUPER_PASSWORD" -e POSTGRES_DB=postgres postgres:16.8-alpine >/dev/null
  for i in $(seq 1 60); do docker exec $DBC pg_isready -U prima_super -q 2>/dev/null && break; sleep 1; done; sleep 2
  gunzip -c "$W/prima-premodules-$TS.sql.gz" | docker exec -i $DBC psql -q -U prima_super -d postgres > restore-m.log 2>&1 || true
  echo "restored tables: $(counts $DBC | wc -l)"
else
  DBC=agentic-prima-db-1
fi
counts $DBC > m-before.txt

echo "== install, in order"
for m in $ORDER; do
  f="$MODS/$m-v1.sql"
  { echo "SET ROLE prima_owner;"; tr -d '\r' < "$f"; } | docker exec -i $DBC psql -q -U prima_super -d prima -v ON_ERROR_STOP=1 > "m-$m.log" 2>&1 \
    && echo "  ok   $m" || { echo "  FAIL $m"; tail -5 "m-$m.log"; exit 1; }
done

echo "== verify"
counts $DBC > m-after.txt
echo "existing tables with changed counts (must be none):"; join <(sort m-before.txt) <(sort m-after.txt) | awk '$2!=$3{print "  CHANGED", $0}'
echo "new tables: $(comm -13 <(cut -d' ' -f1 m-before.txt | sort) <(cut -d' ' -f1 m-after.txt | sort) | tr '\n' ' ')"
echo "new tables without forced row security (must be none):"
comm -13 <(cut -d' ' -f1 m-before.txt | sort) <(cut -d' ' -f1 m-after.txt | sort) | while read t; do docker exec $DBC psql -At -U prima_super -d prima -c "SELECT CASE WHEN relrowsecurity AND relforcerowsecurity THEN '' ELSE '  '||relname END FROM pg_class WHERE oid='prima.$t'::regclass" ; done | grep . || true
echo "new tables owned by someone other than prima_owner (must be none):"
docker exec $DBC psql -At -U prima_super -d prima -c "SELECT '  '||c.relname||' '||pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relkind='r' AND pg_get_userbyid(c.relowner)<>'prima_owner'"

if [ "$MODE" = rehearse ]; then
  echo "== the API on the copy"
  docker run -d --name p88m-api --network $NET -e NODE_ENV=production -e PORT=3000 \
    -e DATABASE_URL="postgres://prima_api:${PRIMA_API_DB_PASSWORD}@$DBC:5432/prima" -e PRIMA_API_DB_USER=prima_api \
    -e PRIMA_DATA_MODE="${PRIMA_DATA_MODE:-test}" -e PIN_PEPPER="${PRIMA_PIN_PEPPER:-}" -e OFFICE_SIGNING_SECRET="${PRIMA_OFFICE_SECRET:-}" -e PRIMA_ORG_LINKS=true \
    agentic-prima-api:dev >/dev/null
  ok=no; for i in $(seq 1 40); do docker exec p88m-api node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>{console.log(t.slice(0,200));process.exit(0)}).catch(()=>process.exit(1))" 2>/dev/null && { ok=yes; break; }; sleep 2; done
  echo "api healthy: $ok"
  docker rm -f p88m-api $DBC >/dev/null; docker network rm $NET >/dev/null
fi
echo "DONE ($MODE)"
