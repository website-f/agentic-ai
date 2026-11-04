#!/usr/bin/env bash
# Test only: existing PG16 binaries, fresh localhost cluster, synthetic credentials.
# No downloads, sudo, system service changes, Azure connections or product overrides.
set -euo pipefail
: "${PG_BIN:?Set PG_BIN to existing PostgreSQL 16 bin directory}"
if [ "$(id -u)" -eq 0 ]; then echo 'Run this disposable PostgreSQL test as a non-root user.' >&2; exit 1; fi
"$PG_BIN/postgres" --version | grep -Eq 'PostgreSQL\) 16\.'
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SUITE=${1:-combined-module-loss.pg.test.cjs}
case "$SUITE" in combined-module-loss.pg.test.cjs|modules-admin.pg.test.cjs|inspect.pg.test.cjs) ;; *) echo 'Unsupported disposable test suite' >&2; exit 1;; esac
PORT=${TEST_PG_PORT:-55437}
case "$PORT" in ''|*[!0-9]*) echo 'Invalid local port' >&2; exit 1;; esac
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then exit 1; fi
umask 077
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/prima-admin-pg16.XXXXXX")
cleanup() {
  rc=$?
  if [ -f "$ROOT/data/postmaster.pid" ]; then
    if ! "$PG_BIN/pg_ctl" -D "$ROOT/data" -m fast -w stop >/dev/null 2>&1; then
      echo "Local test server stop was not confirmed; retaining temporary cluster at $ROOT" >&2
      exit 1
    fi
  fi
  rm -rf -- "$ROOT"
  exit "$rc"
}
trap cleanup EXIT
printf '%s\n' local-test-only > "$ROOT/password"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout "$ROOT/server.key" -out "$ROOT/server.crt" -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' >/dev/null 2>&1
"$PG_BIN/initdb" -D "$ROOT/data" -U postgres --auth-local=trust --auth-host=scram-sha-256 --pwfile="$ROOT/password" --encoding=UTF8 --no-locale > "$ROOT/initdb.log" 2>&1
printf "listen_addresses='127.0.0.1'\nport=%s\nunix_socket_directories=''\nssl=on\nssl_cert_file='%s/server.crt'\nssl_key_file='%s/server.key'\n" "$PORT" "$ROOT" "$ROOT" >> "$ROOT/data/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$ROOT/data" -l "$ROOT/server.log" -w start
export TEST_POSTGRES_URL="postgres://postgres:local-test-only@127.0.0.1:$PORT/postgres"
export TEST_PG_CA="$ROOT/server.crt"
node --test "$HERE/$SUITE"
