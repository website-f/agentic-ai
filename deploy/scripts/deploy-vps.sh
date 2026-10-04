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
"${DC[@]}" build api web browser sandbox backup
"${DC[@]}" up -d --remove-orphans
"${DC[@]}" ps --format "table {{.Service}}\t{{.Status}}"
echo
echo "Published ports (must all be 127.0.0.1):"
"${DC[@]}" ps --format "{{.Service}}  {{.Ports}}" | grep -- "->" || echo "(none)"
