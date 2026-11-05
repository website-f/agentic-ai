#!/usr/bin/env bash
# P65: link (or unlink) a person's Microsoft account to their Prima Secure user, so they can
# sign in at /prima/. Prima has no screen for this; its own tool does it as the schema owner,
# audited in Prima's audit chain.
#
#   link:   ./deploy/scripts/prima-link-user.sh <prima-user-id> <entra-object-id> "<who is linking>"
#   unlink: ./deploy/scripts/prima-link-user.sh <prima-user-id> --unlink "<who is linking>"
#
# The Entra object ID is on the person's page in Microsoft Entra (Users > the person > Object
# ID). Prima user IDs (u-...) are in Prima's People screens and docs/system.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ $# -ne 3 ]; then
  sed -n '2,10p' "$0"
  exit 64
fi
DC=(docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile prima)
# prima-setup runs as the schema owner (its DATABASE_URL), which entra-link needs.
"${DC[@]}" run --rm --no-deps prima-setup node dist/src/entra-link.js "$1" "$2" --by "$3"
