#!/bin/sh
# Agentic-AI backups. Everything a fresh machine needs to come back:
#   - pg_dump -Fc of the app database and Temporal's two (running tasks, schedules)
#   - the brain vault (one git repo per workspace)
#   - the WhatsApp gateway's session folder (WAHA, mounted read-only), so the office phone
#     does not have to scan the QR code again after a move
#   - optionally the two keys that decrypt stored secrets (BACKUP_INCLUDE_SECRETS)
# Valkey is not backed up: it only holds caches, cooldowns, locks and link codes.
#
# Usage (from the repo root; on a VPS add -f docker-compose.yml -f docker-compose.vps.yml):
#   docker compose run --rm backup backup                 # one backup now
#   docker compose exec -T backup agentic-backup backup   # same, in the running container
#   docker compose run --rm backup snapshots              # list them
#   docker compose run --rm backup check                  # verify the repository
#   docker compose stop api worker temporal temporal-ui waha
#   docker compose run --rm backup restore [latest|<id>]
#   docker compose up -d
#
# A backup is all or nothing: if any step fails (a dump, an archive, the upload), the command
# exits non-zero, nothing is pruned and last-success is not touched. The container's
# healthcheck (`agentic-backup health`) turns unhealthy when the last backup failed or the
# last success is older than BACKUP_MAX_AGE_HOURS (default 30).
set -eu

DBS="agentic temporal temporal_visibility"
WORK=/work/staging
: "${RESTIC_REPOSITORY:=/repo}"
: "${BACKUP_HOUR:=3}"
: "${BACKUP_INCLUDE_SECRETS:=true}"
: "${BACKUP_KEEP:=--keep-daily 7 --keep-weekly 4 --keep-monthly 6}"
: "${BACKUP_MAX_AGE_HOURS:=30}"
: "${BACKUP_LOCK_WAIT:=3600}"
LAST_OK=/work/last-success
LAST_FAIL=/work/last-failure
LOCK=/work/backup.lock
STARTED=/tmp/started
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

fail() { log "backup FAILED: $*"; date +%s > "$LAST_FAIL" 2>/dev/null || true; return 1; }

# One backup at a time across the nightly loop, `exec` and `run --rm` (they share /work).
# busybox flock has no wait option: poll.
take_lock() {
  exec 9>"$LOCK"
  waited=0
  until flock -n 9; do
    if [ "$waited" -ge "$BACKUP_LOCK_WAIT" ]; then
      log "another backup has held the lock for ${waited}s"; return 1
    fi
    [ "$waited" -eq 0 ] && log "another backup is running; waiting for it"
    sleep 5; waited=$((waited + 5))
  done
}

# Every step is checked explicitly: `set -e` does not apply inside a function that is called
# as part of `||` / `if`, so relying on it would let a failed dump still prune and report done.
do_backup() {
  ensure_repo || return 1
  take_lock || fail "could not take the backup lock" || return 1
  rm -rf "$WORK" || fail "cannot clear $WORK" || return 1
  mkdir -p "$WORK/db" "$WORK/vault" "$WORK/waha" || fail "cannot create $WORK" || return 1
  for db in $DBS; do
    log "dumping $db"
    pg_dump -Fc --no-password -d "$db" -f "$WORK/db/$db.dump" || fail "pg_dump $db" || return 1
  done
  if [ -d /data/vault ]; then
    log "archiving the vault"
    tar -C /data/vault -cf "$WORK/vault/vault.tar" . || fail "vault archive" || return 1
  fi
  if [ -d /data/waha ] && [ -n "$(ls -A /data/waha 2>/dev/null)" ]; then
    # Copied while WAHA runs: its small SQLite store is normally consistent between writes;
    # if a restored session will not reconnect, scan the QR code again on the Channels page.
    log "archiving the WhatsApp sessions"
    tar -C /data/waha -cf "$WORK/waha/waha.tar" . || fail "WhatsApp session archive" || return 1
  fi
  rev=$(psql -d agentic -tAc "select version_num from alembic_version" 2>/dev/null) || rev=unknown
  [ -n "$rev" ] || rev=unknown
  printf '{"created_at":"%s","alembic":"%s","databases":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rev" "$DBS" > "$WORK/manifest.json" \
    || fail "manifest" || return 1
  if [ "$BACKUP_INCLUDE_SECRETS" = "true" ]; then
    # Inside the encrypted repository only. Without these, stored provider keys and
    # channel tokens cannot be decrypted on the new machine.
    (umask 077 && printf 'AGENTIC_SECRET_KEY=%s\nAGENTIC_MASTER_KEY=%s\n' \
      "${AGENTIC_SECRET_KEY:-}" "${AGENTIC_MASTER_KEY:-}" > "$WORK/secrets.env") \
      || fail "secrets file" || return 1
  fi
  log "uploading to $RESTIC_REPOSITORY"
  (cd "$WORK" && restic backup --host agentic --tag agentic --tag "alembic-$rev" .) \
    || fail "restic backup" || return 1
  # Only after a complete upload: prune old snapshots, then record the success.
  # shellcheck disable=SC2086
  if ! restic forget --host agentic --tag agentic $BACKUP_KEEP --prune --quiet; then
    # The new snapshot is stored; only the clean-up failed. Say so, keep the success.
    log "warning: pruning old snapshots failed (the new backup is stored)"
  fi
  rm -rf "$WORK"
  date +%s > "$LAST_OK" || fail "cannot write $LAST_OK" || return 1
  rm -f "$LAST_FAIL"
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
  if [ -f "$src/waha/waha.tar" ]; then
    # The live session volume is mounted read-only here: unpack next to the restore, then
    # copy it into the WAHA volume with WAHA stopped (docs/RUNBOOK.md, Restore).
    rm -rf /restore/waha && mkdir -p /restore/waha
    tar -C /restore/waha -xf "$src/waha/waha.tar"
    log "WhatsApp sessions unpacked to data/restore/waha (docs/RUNBOOK.md: put them back)"
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
  date +%s > "$STARTED"
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
    # do_backup returns non-zero on any failure (and records it); try again tomorrow.
    do_backup || log "backup FAILED (see above); next try tomorrow"
  done
}

# Healthy = the loop is alive, the last backup did not fail, and the last success is recent.
# A fresh install has no success yet: it counts from the container's start instead, so it
# stays healthy until the first scheduled run is overdue.
do_health() {
  now=$(date +%s)
  alive=$(stat -c %Y /tmp/alive 2>/dev/null || echo 0)
  if [ $((now - alive)) -ge 180 ]; then echo "backup loop not running"; return 1; fi
  ok=$(cat "$LAST_OK" 2>/dev/null || echo 0)
  bad=$(cat "$LAST_FAIL" 2>/dev/null || echo 0)
  if [ "${bad:-0}" -gt "${ok:-0}" ]; then echo "the last backup failed"; return 1; fi
  ref=${ok:-0}
  [ "$ref" -gt 0 ] || ref=$(cat "$STARTED" 2>/dev/null || echo 0)
  if [ $((now - ref)) -gt $((BACKUP_MAX_AGE_HOURS * 3600)) ]; then
    echo "no successful backup in the last ${BACKUP_MAX_AGE_HOURS}h"; return 1
  fi
  echo ok
}

cmd="${1:-loop}"
[ $# -gt 0 ] && shift
case "$cmd" in
  loop) do_loop ;;
  backup) do_backup ;;
  health) do_health ;;
  restore) do_restore "$@" ;;
  snapshots) need_password; restic snapshots --host agentic ;;
  check) need_password; restic check --read-data-subset=10% ;;
  *) echo "usage: agentic-backup loop|backup|health|restore [snapshot]|snapshots|check"; exit 64 ;;
esac
