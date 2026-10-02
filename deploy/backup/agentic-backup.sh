#!/bin/sh
# Agentic-AI backups. Everything a fresh machine needs to come back:
#   - pg_dump -Fc of the app database and Temporal's two (running tasks, schedules)
#   - the brain vault (one git repo per workspace)
#   - optionally the two keys that decrypt stored secrets (BACKUP_INCLUDE_SECRETS)
# Valkey is not backed up: it only holds caches, cooldowns, locks and link codes.
#
# Usage (from the repo root):
#   docker compose run --rm backup backup            # one backup now
#   docker compose run --rm backup snapshots         # list them
#   docker compose run --rm backup check             # verify the repository
#   docker compose stop api worker temporal temporal-ui
#   docker compose run --rm backup restore [latest|<id>]
#   docker compose up -d
set -eu

DBS="agentic temporal temporal_visibility"
WORK=/work/staging
: "${RESTIC_REPOSITORY:=/repo}"
: "${BACKUP_HOUR:=3}"
: "${BACKUP_INCLUDE_SECRETS:=true}"
: "${BACKUP_KEEP:=--keep-daily 7 --keep-weekly 4 --keep-monthly 6}"
export RESTIC_REPOSITORY PGHOST="${PGHOST:-postgres}" PGUSER="${PGUSER:-agentic}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

need_password() {
  if [ -z "${RESTIC_PASSWORD:-}" ]; then
    log "RESTIC_PASSWORD is not set: refusing to write an unencrypted-looking repo."; exit 2
  fi
  if [ "$RESTIC_PASSWORD" = "dev-only-backup-password" ]; then
    log "warning: using the dev backup password. Set RESTIC_PASSWORD for real backups."
  fi
}

ensure_repo() {
  need_password
  if ! restic cat config >/dev/null 2>&1; then
    if [ -d "$RESTIC_REPOSITORY" ] && [ ! -w "$RESTIC_REPOSITORY" ]; then
      log "$RESTIC_REPOSITORY is not writable by uid $(id -u). On Linux: sudo chown 10001:10001 <BACKUP_DIR>"
      exit 3
    fi
    log "creating restic repository at $RESTIC_REPOSITORY"
    restic init
  fi
}

do_backup() {
  ensure_repo
  rm -rf "$WORK" && mkdir -p "$WORK/db" "$WORK/vault"
  for db in $DBS; do
    log "dumping $db"
    pg_dump -Fc --no-password -d "$db" -f "$WORK/db/$db.dump"
  done
  if [ -d /data/vault ]; then
    log "archiving the vault"
    tar -C /data/vault -cf "$WORK/vault/vault.tar" .
  fi
  rev=$(psql -d agentic -tAc "select version_num from alembic_version" 2>/dev/null || echo unknown)
  printf '{"created_at":"%s","alembic":"%s","databases":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rev" "$DBS" > "$WORK/manifest.json"
  if [ "$BACKUP_INCLUDE_SECRETS" = "true" ]; then
    # Inside the encrypted repository only. Without these, stored provider keys and
    # channel tokens cannot be decrypted on the new machine.
    umask 077
    printf 'AGENTIC_SECRET_KEY=%s\nAGENTIC_MASTER_KEY=%s\n' \
      "${AGENTIC_SECRET_KEY:-}" "${AGENTIC_MASTER_KEY:-}" > "$WORK/secrets.env"
  fi
  log "uploading to $RESTIC_REPOSITORY"
  (cd "$WORK" && restic backup --host agentic --tag agentic --tag "alembic-$rev" .)
  # shellcheck disable=SC2086
  restic forget --host agentic --tag agentic $BACKUP_KEEP --prune --quiet
  rm -rf "$WORK"
  date +%s > /work/last-success
  log "backup done"
}

do_restore() {
  need_password
  snap="${1:-latest}"
  rm -rf /restore/snapshot && mkdir -p /restore/snapshot
  log "restoring snapshot $snap"
  restic restore "$snap" --host agentic --target /restore/snapshot
  src=/restore/snapshot
  [ -f "$src/manifest.json" ] || src=$(dirname "$(find /restore/snapshot -name manifest.json | head -1)")
  log "manifest: $(cat "$src/manifest.json")"
  for db in $DBS; do
    log "loading $db"
    # Ownership is kept (the temporal role must own its tables); pg_restore runs as the
    # superuser, so the roles from deploy/postgres/initdb must exist, as on any fresh start.
    pg_restore --no-password --clean --if-exists --exit-on-error -d "$db" "$src/db/$db.dump"
  done
  if [ -f "$src/vault/vault.tar" ]; then
    log "restoring the vault"
    find /data/vault -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar -C /data/vault -xf "$src/vault/vault.tar"
  fi
  if [ -f "$src/secrets.env" ]; then
    cp "$src/secrets.env" /restore/secrets.env
    if [ "$(grep AGENTIC_MASTER_KEY "$src/secrets.env" | cut -d= -f2-)" != "${AGENTIC_MASTER_KEY:-}" ] \
      || [ "$(grep AGENTIC_SECRET_KEY "$src/secrets.env" | cut -d= -f2-)" != "${AGENTIC_SECRET_KEY:-}" ]; then
      log "IMPORTANT: this machine's keys differ from the backup's. Copy the two lines from"
      log "  data/restore/secrets.env into .env, then: docker compose up -d --force-recreate"
    fi
  fi
  rm -rf /restore/snapshot
  log "restore done. Start the stack: docker compose up -d"
}

seconds_until() {
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) $(printf '%02d' "$1"):00:00" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

do_loop() {
  ensure_repo
  log "nightly backups at $(printf '%02d' "$BACKUP_HOUR"):00 ${TZ:-UTC} to $RESTIC_REPOSITORY"
  while true; do
    wait=$(seconds_until "$BACKUP_HOUR")
    # Sleep in short steps so the healthcheck file stays fresh.
    while [ "$wait" -gt 0 ]; do
      touch /tmp/alive
      step=$((wait < 60 ? wait : 60))
      sleep "$step"
      wait=$((wait - step))
    done
    do_backup || log "backup FAILED (see above); next try tomorrow"
  done
}

cmd="${1:-loop}"
[ $# -gt 0 ] && shift
case "$cmd" in
  loop) do_loop ;;
  backup) do_backup ;;
  restore) do_restore "$@" ;;
  snapshots) need_password; restic snapshots --host agentic ;;
  check) need_password; restic check --read-data-subset=10% ;;
  *) echo "usage: agentic-backup loop|backup|restore [snapshot]|snapshots|check"; exit 64 ;;
esac
