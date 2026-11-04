#!/usr/bin/env bash
# After a staging deployment: fails (exit 1) unless the API answers its health check, which reads the staff table as
# the API's own database login, sign-in is set up for Microsoft with test sign-in off, protected screens refuse a
# caller with no sign-in, and (with the website address) only that website may call the API from a browser.
# Usage: scripts/staging-smoke.sh <API base URL> [attempts] [seconds between attempts] [website address]
set -euo pipefail
api="${1:?API base URL}"
attempts="${2:-12}"
wait_s="${3:-10}"
web="${4:-}"

ready=
for _ in $(seq 1 "$attempts"); do
  if curl -fsS --max-time 10 "$api/api/health"; then ready=1; break; fi
  sleep "$wait_s"
done
if [ -z "$ready" ]; then
  echo "::error::The API or its database did not become ready after $attempts tries." >&2
  exit 1
fi
echo

curl -fsS --max-time 10 "$api/api/auth/config" | python3 -c '
import json, sys
c = json.load(sys.stdin)
if not c.get("microsoft"):
    sys.exit("::error::Microsoft sign-in is not configured on the API.")
if c.get("devLogin") is not False:
    sys.exit("::error::Development sign-in must be off on staging.")
print("Sign-in settings OK")
'

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$api/api/me")
[ "$code" = 401 ] || { echo "::error::/api/me without sign-in answered $code, expected 401." >&2; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H 'content-type: application/json' -d '{"userId":"u-fauzan"}' "$api/api/auth/dev-login")
[ "$code" = 403 ] || { echo "::error::Development sign-in answered $code, expected 403 (off)." >&2; exit 1; }
echo "Protected screens refuse callers without sign-in: OK"

headers=$(curl -sS -D - -o /dev/null --max-time 10 "$api/api/health")
grep -qi '^x-content-type-options: nosniff' <<<"$headers" || { echo "::error::The API sends no security headers (old image?)." >&2; exit 1; }
if grep -qi '^x-powered-by' <<<"$headers"; then echo "::error::The API still says which server it runs." >&2; exit 1; fi

if [ -n "$web" ]; then
  pre=$(curl -sS -D - -o /dev/null --max-time 10 -X OPTIONS -H "Origin: $web" -H 'Access-Control-Request-Method: GET' \
    -H 'Access-Control-Request-Headers: authorization' "$api/api/me")
  grep -qi "^access-control-allow-origin: $web" <<<"$pre" || { echo "::error::The API does not let $web call it (WEB_ORIGIN setting)." >&2; exit 1; }
  other=$(curl -sS -D - -o /dev/null --max-time 10 -X OPTIONS -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: GET' "$api/api/me")
  if grep -qi '^access-control-allow-origin' <<<"$other"; then echo "::error::The API lets other websites call it." >&2; exit 1; fi
  echo "Only $web may call the API from a browser: OK"
fi
