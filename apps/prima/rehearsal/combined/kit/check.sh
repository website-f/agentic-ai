#!/bin/bash
# Checks for a rehearsed combined candidate. Fails closed: exit 1 if any step fails. Logs go to <logs dir>.
#   usage: check.sh <worktree> <logs dir>
#   DATABASE_URL     disposable local test database for the API tests (default postgres://postgres:localdev@localhost:5432/prima_test)
#   PRIMA_REHEARSAL_PG  disposable local server for the schema rehearsal (see schema-rehearsal.js)
set -uo pipefail
K=$(cd "$(dirname "$0")" && pwd)
W=$(cd "${1:?worktree}" && pwd); L=$(mkdir -p "${2:?logs dir}" && cd "$2" && pwd)
export DATABASE_URL=${DATABASE_URL:-postgres://postgres:localdev@localhost:5432/prima_test}
fail=0
step() { local name=$1; shift; if (cd "$W" && "$@") > "$L/$name.log" 2>&1; then echo "PASS $name"; else echo "FAIL $name (see $name.log)"; fail=1; fi; }
step install      npm ci --no-audit --no-fund
step core-build   bash -c 'cd packages/core && npm run build'
step typecheck    npm run typecheck
# 20 s per test: a few dataset-heavy tests pass alone in 3-4 s but pass the 5 s default only when the machine is idle.
step core-tests   bash -c 'cd packages/core && npx vitest run --testTimeout=20000'
step api-build    bash -c 'cd apps/api && npm run build'
step api-tests    bash -c 'cd apps/api && ROLLOUTS_CHECKED_LOG=1 node --test --test-concurrency=1 dist/test/*.test.js'
step cms-tests    bash -c 'cd apps/cms && npm test'
step web-demo     bash -c 'cd apps/web && npx vite build --mode demo'
step schema       bash -c "cd apps/api && node '$K/schema-rehearsal.js'"
step stale-pins   bash "$K/stale-pins.sh" "$W"
grep -hE "^# (tests|pass|fail) |rollouts checked" "$L/api-tests.log" 2>/dev/null
grep -h "Tests " "$L/core-tests.log" 2>/dev/null
exit $fail
