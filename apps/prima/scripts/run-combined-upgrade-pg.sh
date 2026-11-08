#!/usr/bin/env bash
# Local regression only: existing native PG16 binaries, fresh loopback cluster,
# synthetic credentials, no downloads, system services, Docker, or live database.
# Build @prima/core and @prima/api first. CI example:
# PG_BIN=/usr/lib/postgresql/16/bin bash scripts/run-combined-upgrade-pg.sh
set -euo pipefail
[[ $# -eq 0 ]] || { echo 'This wrapper only runs the fixed combined-upgrade regression.' >&2; exit 1; }
: "${PG_BIN:?Set PG_BIN to an existing PostgreSQL 16 bin directory}"
[[ "$PG_BIN" = /* ]] || { echo 'PG_BIN must be an absolute path.' >&2; exit 1; }
[[ "$(id -u)" -ne 0 ]] || { echo 'Run the disposable PostgreSQL test as a non-root user.' >&2; exit 1; }
for binary in postgres initdb pg_ctl; do
  [[ -x "$PG_BIN/$binary" ]] || { echo "Missing PostgreSQL binary: $binary" >&2; exit 1; }
done
"$PG_BIN/postgres" --version | grep -Eq 'PostgreSQL\) 16\.'
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd -- "$HERE/.." && pwd)
[[ -f "$REPO/apps/api/dist/src/release-catalog.js" ]] || { echo 'Build @prima/core and @prima/api before this regression.' >&2; exit 1; }
PORT=${TEST_PG_PORT:-55439}
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || { echo 'Invalid explicit local test port.' >&2; exit 1; }
PORT=$((10#$PORT))
(( PORT >= 1024 && PORT <= 65535 && PORT != 5432 )) || { echo 'Use a non-default local test port.' >&2; exit 1; }

# Do not inherit provider connection/service/option overrides into this test.
unset PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE NODE_OPTIONS
umask 077
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/prima-combined-upgrade.XXXXXX")
# ROOT is created by this process and never supplied as a cleanup target by a caller.
printf '%s\n' "$ROOT" > "$ROOT/.owned-by-combined-upgrade-test"
cleanup() {
  rc=$?
  trap - EXIT INT TERM
  if [[ ! -d "$ROOT" || ! -f "$ROOT/.owned-by-combined-upgrade-test" ]] ||
     [[ "$(cat "$ROOT/.owned-by-combined-upgrade-test")" != "$ROOT" ]]; then
    echo 'Cannot verify ownership of disposable test directory; retaining it.' >&2
    exit 1
  fi
  if [[ -f "$ROOT/data/postmaster.pid" ]]; then
    if ! "$PG_BIN/pg_ctl" -D "$ROOT/data" -m fast -w stop >/dev/null 2>&1; then
      echo "Test server stop unconfirmed; retaining owned directory: $ROOT" >&2
      exit 1
    fi
  fi
  if (( rc != 0 )); then
    echo 'Disposable PostgreSQL test failed; recent synthetic server log:' >&2
    if [[ -f "$ROOT/server.log" ]]; then tail -40 "$ROOT/server.log" >&2; fi
    if [[ -f "$ROOT/initdb.log" ]]; then tail -10 "$ROOT/initdb.log" >&2; fi
  fi
  rm -rf -- "$ROOT"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' prima-local-synthetic-only > "$ROOT/password"
"$PG_BIN/initdb" -D "$ROOT/data" -U postgres --auth-local=scram-sha-256 --auth-host=scram-sha-256 \
  --pwfile="$ROOT/password" --encoding=UTF8 --locale=C > "$ROOT/initdb.log" 2>&1
"$PG_BIN/pg_ctl" -D "$ROOT/data" -l "$ROOT/server.log" -o "-h 127.0.0.1 -p $PORT -k ''" -w start
export PRIMA_DISPOSABLE_PG_TEST=1
export TEST_POSTGRES_URL="postgres://postgres:prima-local-synthetic-only@127.0.0.1:$PORT/postgres"
export DATABASE_URL="$TEST_POSTGRES_URL"
export PRIMA_API_DB_USER=prima_api
cd -- "$REPO"
node --test scripts/combined-base-upgrade.pg.test.cjs
