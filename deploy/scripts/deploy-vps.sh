#!/usr/bin/env bash
# Update a VPS install to the latest commit: pull, rebuild the images, restart.
# The api applies database migrations when it starts.
#
#   cd /opt/agentic-ai && ./deploy/scripts/deploy-vps.sh
#
# Settings come from .env (see .env.vps.example). COMPOSE_PROFILES there adds optional
# services (e.g. `demo` for the practice portal).
set -euo pipefail
cd "$(dirname "$0")/../.."

DC=(docker compose -f docker-compose.yml -f docker-compose.vps.yml)

git pull --ff-only

# P23: the browser network became internal (its only way out is the egress proxy). Docker
# cannot change that on an existing network, so the first deploy after it removes the old
# one; the browser and worker are stateless and come back with `up` below.
proj="$("${DC[@]}" ps -a --format '{{.Project}}' 2>/dev/null | head -n1 || true)"
if [ -n "$proj" ] && [ "$(docker network inspect "${proj}_browser" --format '{{.Internal}}' 2>/dev/null)" = "false" ]; then
  echo "Recreating ${proj}_browser as an internal network"
  "${DC[@]}" rm -sf browser worker practice-portal
  docker network rm "${proj}_browser"
fi
"${DC[@]}" build api web browser egress sandbox backup
"${DC[@]}" up -d --remove-orphans
"${DC[@]}" ps --format "table {{.Service}}\t{{.Status}}"
echo
echo "Published ports (must all be 127.0.0.1):"
"${DC[@]}" ps --format "{{.Service}}  {{.Ports}}" | grep -- "->" || echo "(none)"
