#!/usr/bin/env bash
# Copy the live VPS data into this machine's local stack, so local shows the same company,
# agents, tasks, brain and files as the VPS. Read-only on the VPS: it dumps, it never writes.
#
#   ./deploy/scripts/pull-from-vps.sh            # host alias `vps` from ~/.ssh/config
#   VPS=root@1.2.3.4 ./deploy/scripts/pull-from-vps.sh
#
# What it copies: the three databases (app + Temporal's two), the brain vault and media.
# Stored provider keys and channel tokens only decrypt if this .env has the VPS's
# AGENTIC_SECRET_KEY and AGENTIC_MASTER_KEY (copy them by hand from /opt/agentic-ai/.env).
#
# The local copy runs its own worker and browser (docker-compose.override.yml: the browser
# goes out directly, no egress proxy), so tasks given here run here. To keep it from doubling
# what the VPS does, every pull switches off all channels and schedules in the local copy.
# NO_WORKER=1 starts only the dashboard (api + web), no agents.
set -euo pipefail
cd "$(dirname "$0")/../.."

VPS="${VPS:-vps}"
REMOTE_DIR="${REMOTE_DIR:-/opt/agentic-ai}"
OUT="data/vps-pull/$(date +%Y%m%d-%H%M%S)"
DBS="agentic temporal temporal_visibility"
mkdir -p "$OUT"

echo "== dumping from $VPS:$REMOTE_DIR"
for db in $DBS; do
  ssh "$VPS" "cd $REMOTE_DIR && docker compose exec -T postgres pg_dump -U agentic -Fc -d $db" > "$OUT/$db.dump"
  echo "   $db: $(du -h "$OUT/$db.dump" | cut -f1)"
done
for vol in vault media; do
  ssh "$VPS" "docker run --rm -v agentic_$vol:/d:ro alpine tar -C /d -cf - ." > "$OUT/$vol.tar"
  echo "   $vol: $(du -h "$OUT/$vol.tar" | cut -f1)"
done

echo "== loading into the local stack"
docker compose up -d postgres valkey
docker compose rm -sf api worker web temporal temporal-ui >/dev/null 2>&1 || true
# Volumes made by an older version of this script lack compose's labels: recreate them
# (their contents are replaced below anyway).
for vol in vault media; do
  if docker volume inspect "agentic_$vol" >/dev/null 2>&1 && [ -z "$(docker volume inspect -f \
    '{{index .Labels "com.docker.compose.project"}}' "agentic_$vol")" ]; then
    docker volume rm "agentic_$vol" >/dev/null
  fi
done
until docker compose exec -T postgres pg_isready -U agentic >/dev/null 2>&1; do sleep 2; done
for db in $DBS; do
  echo "   $db"
  docker compose exec -T postgres pg_restore -U agentic --clean --if-exists --no-password -d "$db" < "$OUT/$db.dump"
done
for vol in vault media; do
  echo "   $vol"
  # Labelled as compose would, so `docker compose up` adopts the volume without a warning.
  docker volume create --label com.docker.compose.project=agentic \
    --label com.docker.compose.volume="$vol" "agentic_$vol" >/dev/null
  docker run --rm -i -v "agentic_$vol:/d" alpine sh -c 'find /d -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -C /d -xf -' < "$OUT/$vol.tar"
done
# Valkey only holds caches and locks; drop the old ones so nothing points at stale state.
docker compose exec -T valkey valkey-cli FLUSHALL >/dev/null
# This copy must not act as the live office: no Telegram/WhatsApp (the VPS polls the same
# bot and owns the phone session) and no recurring schedules (the VPS already runs them).
docker compose exec -T postgres psql -U agentic -d agentic -tAq \
  -c "update channels set enabled = false; update schedules set enabled = false;"

if [ "${NO_WORKER:-}" = "1" ]; then
  echo "== starting (no worker)"
  docker compose up -d postgres valkey temporal temporal-ui api web
else
  echo "== starting (with worker and browser; channels and schedules are off in this copy)"
  docker compose up -d postgres valkey temporal temporal-ui api web worker browser sandbox ollama ollama-pull
fi
docker compose ps --format "table {{.Service}}\t{{.Status}}"
echo "Open http://localhost:${WEB_PORT:-8500} and sign in with your VPS login. Dumps kept in $OUT"
