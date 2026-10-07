#!/usr/bin/env bash
# Update a VPS install to the latest commit: back up, pull, rebuild the images, restart.
# The api applies database migrations when it starts.
#
#   cd /opt/agentic-ai && ./deploy/scripts/deploy-vps.sh [--skip-backup] [--no-pull]
#
#   --skip-backup  do not take a backup first (only when the backup itself is what is broken)
#   --no-pull      deploy the commit that is checked out now (used for a rollback, below)
#
# Rollback: the script prints the commit it started from. To go back to it:
#   git checkout <previous-rev> && ./deploy/scripts/deploy-vps.sh --no-pull
# (Migrations are not reversed. If the new version changed the database, restore the
# backup this script took first: docs/RUNBOOK.md, Restore.)
#
# Settings come from .env (see .env.vps.example). COMPOSE_PROFILES there adds optional
# services (e.g. `demo` for the practice portal). Always deploy with this script: a bare
# `docker compose up -d --build` leaves out docker-compose.vps.yml, which means dev mode,
# dev test logins and published dev ports.
set -euo pipefail
cd "$(dirname "$0")/../.."

DC=(docker compose -f docker-compose.yml -f docker-compose.vps.yml)
SKIP_BACKUP=false
PULL=true
for arg in "$@"; do
  case "$arg" in
    --skip-backup) SKIP_BACKUP=true ;;
    --no-pull) PULL=false ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 64 ;;
  esac
done

# Fails here, before anything changes, if a required value in .env is missing.
"${DC[@]}" config --quiet

prev="$(git rev-parse HEAD)"
echo "Deploying from $prev"
echo "Rollback: git checkout $prev && ./deploy/scripts/deploy-vps.sh --no-pull"
echo

# 1. A backup of what runs now, before any image or migration changes. Abort if it fails.
if [ "$SKIP_BACKUP" = true ]; then
  echo "WARNING: skipping the pre-deploy backup (--skip-backup)"
elif [ -n "$("${DC[@]}" ps -q --status running backup 2>/dev/null)" ]; then
  echo "Backing up before the deploy (the running backup container)"
  if ! "${DC[@]}" exec -T backup agentic-backup backup; then
    echo "Pre-deploy backup FAILED: nothing was changed. Fix it, or rerun with --skip-backup." >&2
    exit 1
  fi
elif [ -n "$("${DC[@]}" ps -q postgres 2>/dev/null)" ]; then
  echo "Backing up before the deploy (one-off backup container)"
  if ! "${DC[@]}" run --rm --no-deps backup backup; then
    echo "Pre-deploy backup FAILED: nothing was changed. Fix it, or rerun with --skip-backup." >&2
    exit 1
  fi
else
  echo "No running install found: first deploy, nothing to back up."
fi

# 2. The new code and images (base images refreshed too, for security fixes).
if [ "$PULL" = true ]; then
  git pull --ff-only
  [ "$(git rev-parse HEAD)" = "$prev" ] || echo "Now at $(git rev-parse HEAD)"
fi
"${DC[@]}" config --quiet  # the new compose files may need new .env values
"${DC[@]}" build --pull api web browser egress sandbox backup

# 3. Networks whose isolation changed. Docker cannot flip `internal` on an existing network,
# so the first deploy after the change removes the old one (and the stateless services on
# it); `up` below recreates both.
#   P23: browser became internal (the browser's only way out is the egress proxy)
#   llm became internal (ollama has no internet; ollama-pull downloads on its own network)
proj="$("${DC[@]}" ps -a --format '{{.Project}}' 2>/dev/null | head -n1 || true)"
recreate_internal() {  # <network> <services on it...>
  local net="$1"; shift
  if [ -n "$proj" ] && [ "$(docker network inspect "${proj}_${net}" --format '{{.Internal}}' 2>/dev/null)" = "false" ]; then
    echo "Recreating ${proj}_${net} as an internal network"
    "${DC[@]}" rm -sf "$@"
    docker network rm "${proj}_${net}"
  fi
}
recreate_internal browser browser worker practice-portal
recreate_internal llm ollama ollama-pull api worker

# 4. Start.
"${DC[@]}" up -d --remove-orphans
"${DC[@]}" ps --format "table {{.Service}}\t{{.Status}}"
echo

# 5. Nothing may listen on a public address: only 127.0.0.1 (the reverse proxy's upstream).
echo "Published ports (must all be 127.0.0.1):"
ports="$("${DC[@]}" ps --format "{{.Service}}  {{.Ports}}" | grep -- "->" || true)"
echo "${ports:-(none)}"
public="$(printf '%s\n' "$ports" | grep -oE '[^ ,]+->' | grep -vE '^(127\.0\.0\.1|\[::1\]):' || true)"
if [ -n "$public" ]; then
  echo >&2
  echo "FAILED: published on a public address: $public" >&2
  echo "Check docker-compose.vps.yml / .env (every port must be 127.0.0.1:...)." >&2
  exit 1
fi
echo
echo "Deployed $(git rev-parse --short HEAD). Rollback: git checkout $prev && ./deploy/scripts/deploy-vps.sh --no-pull"
