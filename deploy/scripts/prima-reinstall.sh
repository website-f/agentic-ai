#!/usr/bin/env bash
# Install Prima Secure's database afresh from the release now checked out, after a backup.
#
#   cd /opt/agentic-ai && ./deploy/scripts/prima-reinstall.sh --yes
#
# For a Prima release that changes its BASE schema (db/migrations/001_init.sql), such as the
# combined candidate round 8: Prima's own setup refuses a database on another base, and its
# in-place "base transition" is a staged procedure for a database holding real records. Ours
# holds Prima's sample data (PRIMA_DATA_MODE staging-pilot), so it is reinstalled instead:
#   1. a compressed pg_dump of the whole Prima database to data/backups/prima-<time>.sql.gz
#      (stops here if the backup fails or is empty);
#   2. prima-api, prima-setup and prima-db removed, then the primadata volume;
#   3. prima-db, prima-setup (base + every module of the release manifest) and prima-api
#      started again. The office's links to Prima staff records (prima_links) keep working:
#      the sample records keep their ids.
# Restore a backup: docs/P66-PRIMA-ONE-SYSTEM.md, "Reinstalling Prima".
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "${1:-}" = "--yes" ] || { echo "This replaces Prima's database (after a backup). Run with --yes." >&2; exit 64; }

DC=(docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile prima)
mkdir -p data/backups
out="data/backups/prima-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
if [ -n "$("${DC[@]}" ps -q prima-db 2>/dev/null)" ]; then
  echo "Backing up Prima's database to $out"
  "${DC[@]}" exec -T prima-db pg_dump -U prima_super -d prima --no-owner | gzip > "$out"
  [ "$(gzip -dc "$out" | head -c 1000 | wc -c)" -gt 100 ] || { echo "Backup is empty: nothing was changed." >&2; exit 1; }
  echo "Backup: $(du -h "$out" | cut -f1)"
else
  echo "Prima's database is not running: nothing to back up."
fi

"${DC[@]}" rm -sf prima-api prima-setup prima-db
vol="$(docker volume ls -q | grep -E '(^|_)primadata$' | head -1 || true)"
[ -z "$vol" ] || docker volume rm "$vol"
"${DC[@]}" up -d prima-db prima-setup prima-api
echo "Prima reinstalled. Logs: docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile prima logs prima-setup prima-api"
