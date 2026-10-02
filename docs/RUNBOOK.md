# Runbook

Day-to-day operation of an Agentic-AI install, on the dev PC or a VPS. Commands run from
the repo root. On the VPS, add `-f docker-compose.yml -f docker-compose.vps.yml` to every
`docker compose` command (or `export COMPOSE_FILE=docker-compose.yml:docker-compose.vps.yml`).

## 1. Start, stop, look

| Task | Command |
|---|---|
| Start (or apply changes) | `docker compose up -d --build` |
| Stop, keep data | `docker compose stop` |
| State of every service | `docker compose ps` (every service has a healthcheck) |
| Logs of one service | `docker compose logs -f --tail 200 api` (api, worker, web, temporal, postgres, backup) |
| App health in one view | Command center page, System panel (database, Valkey, Temporal, worker) |
| Workflows (running tasks, schedules) | Temporal UI at http://localhost:8502 (VPS: `ssh -L 8502:127.0.0.1:8502 vps`) |
| Model-call traces (profile `obs`) | Langfuse at http://localhost:8503 |

Ports are in docs/DOCKER-AND-DEPLOY.md section 2. Everything binds to 127.0.0.1.

## 2. Upgrade

```bash
git pull
docker compose up -d --build        # migrations run automatically when the api starts
docker compose ps                   # all healthy?
```

- Take a backup first (`docker compose run --rm backup backup`): it is the rollback.
- `VITE_*` variables are baked in at build time: change them, then `--build`, never only
  `--force-recreate`.
- Running tasks survive an upgrade: their state is in Temporal and Postgres, and the
  worker picks them up again when it is back.

## 3. Backups and restore

Nightly at `BACKUP_HOUR` (default 03:00 Asia/Kuala_Lumpur) the `backup` service writes
one encrypted restic snapshot: `pg_dump` of the app database and Temporal's two, the
brain vault, and (with `BACKUP_INCLUDE_SECRETS=true`) the secret and master key.
Retention: 7 daily, 4 weekly, 6 monthly. Valkey is not backed up (caches and locks only).

| Task | Command |
|---|---|
| Back up now | `docker compose run --rm backup backup` |
| List snapshots | `docker compose run --rm backup snapshots` |
| Verify the repository (reads 10 % of the data) | `docker compose run --rm backup check` |
| Did last night work? | `docker compose logs --since 30h backup` |

The repository is `BACKUP_DIR` (default `./data/backups`), protected by `RESTIC_PASSWORD`.
Keep the password and `.env` in a password manager: a backup cannot be opened without the
password, and stored provider keys cannot be decrypted without `AGENTIC_MASTER_KEY`.
For an offsite copy set `RESTIC_REPOSITORY` to a B2, S3 or SFTP target (see .env.example).
On Linux the folder must belong to uid 10001: `sudo install -d -o 10001 -g 10001 data/backups`.

### Restore (same machine, or a new one)

1. New machine only: install Docker, copy the repo and `.env` (same `RESTIC_PASSWORD`,
   `AGENTIC_SECRET_KEY`, `AGENTIC_MASTER_KEY`), copy the backup folder to `BACKUP_DIR`
   (or point `RESTIC_REPOSITORY` at the offsite copy), then `docker compose up -d` once
   so the databases exist.
2. Stop what writes: `docker compose stop api worker temporal temporal-ui`
3. Restore: `docker compose run --rm backup restore` (or `restore <snapshot id>`)
4. Start: `docker compose up -d`
5. Check: sign in, open a few tasks and a brain page; `docker compose exec api python -m agentic.admin stuck-tasks`.

If the restore prints "this machine's keys differ from the backup's", copy the two lines
from `data/restore/secrets.env` into `.env`, run `docker compose up -d --force-recreate`,
then delete `data/restore/secrets.env`.

Drill: restore into a throwaway project once a quarter (`-p agentic_restore` with other
ports, see docs/SECURITY.md section 9). It takes about two minutes.

## 4. Secrets

| Secret | Rotate how | Effect |
|---|---|---|
| `AGENTIC_SECRET_KEY` | New value in `.env`, `up -d --force-recreate` | Everyone signs in again. In dev it also derives the master key, so set `AGENTIC_MASTER_KEY` explicitly first |
| `AGENTIC_MASTER_KEY` | Not rotatable in place yet: changing it makes stored keys unreadable | Re-enter provider keys and channel tokens afterwards |
| Provider keys, Telegram token | AI Engine / Channels pages | Immediate |
| `AGENTIC_DB_PASSWORD` | `ALTER ROLE agentic PASSWORD '...'` in psql, then `.env`, `up -d` | |
| `RESTIC_PASSWORD` | `docker compose run --rm --entrypoint restic backup key add`, then `key remove` the old | Old snapshots stay readable |

Generate fresh values with `python deploy/scripts/gen-secrets.py`.

## 5. People

| Problem | Fix |
|---|---|
| Owner locked out / forgot password | `docker compose exec api python -m agentic.admin reset-password owner@example.com` (prints a temporary password; must be changed at sign-in) |
| A phone or laptop was lost | Members page, or `... agentic.admin sessions-revoke <email>`, and remove its push device on the Channels page |
| Too many failed sign-ins | Lockout lifts after 15 minutes (5 per email, 20 per IP) |

## 6. When something is wrong

| Symptom | Look at | Usually |
|---|---|---|
| Page shows "The server is not answering" | `docker compose ps`, `logs api` | api restarting (bad `.env` outside dev prints "Refusing to start: ..." and exits) |
| A task says running but nothing happens | Temporal UI, search the task id | Waiting on an approval or a person; or the workflow stopped: `agentic.admin stuck-tasks --fail`, then Retry on the board |
| Tasks fail with "No model ... could answer" | AI Engine, provider health and cooldowns | Key expired, quota used up, provider down; add a second model to the group |
| Agent "over budget" | Approvals page, or the agent's Team & budget tab | Approve more, or raise the limit |
| Scheduled job failed | Schedules, Incidents tab | Same cause grouped; fix it, Resolve; it reopens if it happens again |
| No phone notifications | Channels, delivery ledger | Device unsubscribed (re-enable on the phone), push service error shown per row |
| Live updates stop | Browser reconnects by itself and replays; if not, `logs api` for Valkey errors | Valkey restart |
| Disk filling up | `docker system df`, `du -sh data/backups` | Old images: `docker image prune`; backups follow retention |

## 7. Agents on the web and the local model

- The `browser` service runs Camoufox for agents. `docker compose logs browser`; at most
  `BROWSER_MAX_SESSIONS` (3) browsers at once. A stuck page closes after 10 idle minutes.
- Give an agent the browser: Agents > the agent > Permissions (browser tools), or create it
  from the Web Operator template. Form submits always come to Approvals.
- The local model is Ollama on this PC (`http://host.docker.internal:11434/v1`, allowed by
  `AGENTIC_PRIVATE_HOSTS_ALLOWED` in `.env`). If Ollama is not running, the `fast` group
  falls back to Groq, then DeepSeek, automatically.
- Re-check reliability after changing models: docs/RELIABILITY.md.

## 8. Capacity (measured 2026-10-02, load test in deploy/loadtest)

On the dev PC (16 GB Docker VM), api 1 CPU, worker 16 concurrent steps, a fake model with
0.2 to 0.6 s replies, all at once: 50 people using the dashboard (about 100 requests/s),
200 open live streams and 30 agent tasks.

| Measure | Result |
|---|---|
| Dashboard reads | p95 203 ms, p99 291 ms, 0 errors |
| Live event delivered to all 200 streams | p50 59 ms, max 70 ms (500 streams: max 285 ms) |
| 30 tasks started together | all done in 9.1 s (p50 4.9 s) |
| api CPU | at its 1-core limit: the first thing to raise |

Re-run after big changes:

```bash
docker run --rm -i -e BASE=http://host.docker.internal:8500 -v "$PWD/deploy/loadtest:/lt" grafana/k6 run /lt/dashboard.js
uv run --project apps/api python deploy/loadtest/agents.py --streams 200 --tasks 30
```
