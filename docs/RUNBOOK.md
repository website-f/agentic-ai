# Runbook

Day-to-day operation of an Agentic-AI install, on the dev PC or a VPS. Commands run from
the repo root. On the VPS, add `-f docker-compose.yml -f docker-compose.vps.yml` to every
`docker compose` command (or `export COMPOSE_FILE=docker-compose.yml:docker-compose.vps.yml`),
and deploy only with `./deploy/scripts/deploy-vps.sh` (section 2).

## 1. Start, stop, look

| Task | Command |
|---|---|
| Start (or apply changes), dev PC | `docker compose up -d --build` |
| Start (or apply changes), VPS | `./deploy/scripts/deploy-vps.sh` (never a bare `up` there: section 2) |
| Stop, keep data | `docker compose stop` |
| State of every service | `docker compose ps` (every long-running service except temporal-ui has a healthcheck) |
| Logs of one service | `docker compose logs -f --tail 200 api` (api, worker, web, temporal, postgres, backup) |
| App health in one view | Command center page, System panel (database, Valkey, Temporal, worker) |
| Workflows (running tasks, schedules) | Temporal UI at http://localhost:8502 (VPS: an SSH tunnel to `127.0.0.1:<TEMPORAL_UI_PORT>`) |
| Model-call traces (profile `obs`) | Langfuse at http://localhost:8503 |

Ports are in docs/DOCKER-AND-DEPLOY.md section 2. Everything binds to 127.0.0.1.

## 2. Upgrade

**On a VPS: always the deploy script.**

```bash
./deploy/scripts/deploy-vps.sh      # backup, pull, build --pull, up, port check
```

It backs up first and aborts if the backup fails (`--skip-backup` only when the backup itself
is what is broken), prints the commit it started from and the rollback line
(`git checkout <rev> && ./deploy/scripts/deploy-vps.sh --no-pull`), recreates networks whose
isolation changed, and fails if any port is published on something other than 127.0.0.1.
Do **not** run a bare `docker compose up -d --build` on the VPS: without
`docker-compose.vps.yml` that is dev mode (dev seed logins, dev ports, insecure cookies).

**On the dev PC:**

```bash
docker compose run --rm backup backup   # the rollback, if anything goes wrong
git pull
docker compose up -d --build        # migrations run automatically when the api starts
docker compose ps                   # all healthy?
```

- A backup taken first is the rollback: migrations are not reversed by checking out an
  older commit.
- `VITE_*` variables are baked in at build time: change them, then `--build`, never only
  `--force-recreate`.
- Running tasks survive an upgrade: their state is in Temporal and Postgres, and the
  worker picks them up again when it is back.

## 3. Backups and restore

Nightly at `BACKUP_HOUR` (default 03:00 Asia/Kuala_Lumpur) the `backup` service writes
one encrypted restic snapshot: `pg_dump` of the app database and Temporal's two, the
brain vault, the WhatsApp (WAHA) session folder, and (with `BACKUP_INCLUDE_SECRETS=true`)
the secret and master key. Retention: 7 daily, 4 weekly, 6 monthly, pruned only after a
complete upload. Valkey is not backed up (caches and locks only). A failed step fails the
whole backup: nothing is pruned, and the container turns **unhealthy** (also when the last
success is older than `BACKUP_MAX_AGE_HOURS`, 30 h).

| Task | Command |
|---|---|
| Back up now | `docker compose run --rm backup backup` (or `docker compose exec -T backup agentic-backup backup`) |
| Is it healthy? | `docker compose ps backup`; `docker compose exec backup agentic-backup health` says why not |
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
2. Stop what writes: `docker compose stop api worker temporal temporal-ui waha`
3. Restore: `docker compose run --rm backup restore` (or `restore <snapshot id>`)
4. WhatsApp sessions (only if the snapshot has them and you want them back): the restore
   unpacks them to `data/restore/waha`. Copy them into the volume with WAHA stopped, e.g.
   `docker run --rm -v agentic_wahadata:/s -v "$PWD/data/restore/waha:/r:ro" alpine sh -c 'rm -rf /s/* && cp -a /r/. /s/'`,
   then delete `data/restore/waha`. Never run the same session on two machines at once.
5. Start: `docker compose up -d` (VPS: `./deploy/scripts/deploy-vps.sh --skip-backup --no-pull`)
6. Check: sign in, open a few tasks and a brain page; `docker compose exec api python -m agentic.admin stuck-tasks`.

If the restore prints "this machine's keys differ from the backup's", copy the two lines
from `data/restore/secrets.env` into `.env`, run `docker compose up -d --force-recreate`,
then delete `data/restore/secrets.env`.

Drill: restore into a throwaway project once a quarter (`-p agentic_restore` with other
ports, see docs/SECURITY.md section 9). It takes about two minutes. It is not automated.

## 4. Secrets

| Secret | Rotate how | Effect |
|---|---|---|
| `AGENTIC_SECRET_KEY` | New value in `.env`, `up -d --force-recreate` | Everyone signs in again. In dev it also derives the master key, so set `AGENTIC_MASTER_KEY` explicitly first |
| `AGENTIC_MASTER_KEY` | Set the new value in `.env`, recreate, then `docker compose exec -e AGENTIC_OLD_MASTER_KEY=<old> api python -m agentic.admin rotate-master-key` (re-wraps every stored secret; `--from-dev` when moving dev data to a server) | Stored keys stay readable; keep the new key in the password manager |
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

- The `browser` service runs Camoufox for agents: a pool of browser processes, 2 agents
  each (`BROWSER_PER_PROCESS`), at most `BROWSER_MAX_SESSIONS` (6) at once (3 GB). When all
  are busy agents wait, then say so. A stuck process restarts itself; an idle page closes
  after 10 minutes. `docker compose exec worker python - 6 < deploy/demo/browser_load.py`
  checks 6 agents signing in at once on the practice portal.
- Give an agent the browser: Agents > the agent > Permissions (browser tools), or create it
  from the Web Operator template. Form submits always come to Approvals.
- **Browse for me** (Office: click the agent; or the agent's page): a link, what you want,
  *Find information* (reads only) or *Interact and fill in* (with the values to use), an
  optional saved login, and a short answer or a report. It starts at once and the panel
  shows the browser live. Agents without the browser get it if you manage them. Before a
  form is sent, the approval lists every field and value it is about to send.
- The local model is the `ollama` container (`AGENTIC_LOCAL_LLM_URL`, default
  `http://ollama:11434/v1`, model `qwen3:0.6b`), on the internal `llm` network with no
  internet; `ollama-pull` downloads the model once on its own network. It does a few small
  side jobs and answers in backup mode when every cloud model is down. Empty
  `AGENTIC_LOCAL_LLM_URL` turns it off. `OLLAMA_KEEP_ALIVE=30m` frees its memory when idle.
- Re-check reliability after changing models: docs/RELIABILITY.md.

## 8. Preparing documents and packs

Sidebar > Documents, top to bottom (details: DOCUMENT-STUDIO.md):

1. **Company kit** — fill each company's facts and logo once. Every letterhead uses them.
2. **Files** — drop the papers a company keeps (registration certificate, bank statements,
   licences). Each is read once, scans included, and summarised; expiry dates are flagged.
3. **Templates** — use the starters, write your own with `{{placeholders}}`, or upload a
   Word file with `{{placeholders}}` typed where values go.
4. **Documents** — New document → pick the company and a template (or "Write it with AI").
   Optionally describe it and AI fills the fields. Fix what the checks list, then Approve.
   Export PDF, Word or Excel.
5. **Packs** — list what a submission needs (or "Draft it with AI"), Auto-fill from files,
   "Draft it" for items we write ourselves, or "Ask an agent" to prepare the rest. Compile
   PDF, check it, and submit it yourself.

Scans stay unread if the image has no Tesseract (`tesseract --list-langs` inside the api
container should list `eng` and `msa`); use "Read again" on a file after fixing that.

## 9. Workflows (how a job is done)

**Running a job through a workflow:** open the workflow, set on each step the agent who does
it (or pick when starting), mark steps you want to check with "I review it before it moves on",
and on each decision choose a person or an agent. Save, then **Run**: describe the job, pick the
company and any files, confirm who does each step, Start. The run page shows each step live;
**Needs you** holds the decisions, the reviews and any question an agent asked. A run whose
worker restarts carries on where it was.


Knowledge > Workflows: draw a procedure as connected steps (or click "Draft with AI" and
describe it), set it Active, and attach agents. Attached agents get the compiled procedure
in their prompt and follow it. It is guidance, not an automation that runs on its own.

## 10. Blueprints (reusable roles)

Knowledge > Blueprints: define a role once — instructions, model, tool scope, SOPs and
skills — and apply it to any agent, or stamp new agents from it. The tool scope's "Never"
column is how you hard-limit what a role can ever do. Managed by anyone who can manage
agents.

## 11. People, roles and personal agents

| Role | Sees and manages |
|---|---|
| Owner, admin | Everything (admins cannot change owners) |
| Branch manager | One branch: its agents, work, approvals, logins, and its HODs, supervisors and staff |
| Head of department | One department: its agents, work, approvals, logins, and its supervisors and staff |
| Supervisor | One department's work and approvals (does not change agents) |
| Staff | Their own personal agents: create, give work, answer them |
| Operator, approver, viewer | The whole workspace: work / approvals / read only |

Add people on Settings > Members: pick the role, then the branch or department. A branch
manager or HOD can add people below them in their own area. Phone pushes and Telegram
buttons reach only the people whose area covers the asking agent.

## 12. Saved logins

Logins page: name (what agents call it), the site address, username and password. The
password is never shown again and never reaches an AI model; the browser types it in only
on that site, and every use is in Activity. Workspace-wide, one branch, or personal (only
your own agents). Put the login's name in the agent's SOP or task ("sign in with the saved
login 'supplier-portal'"). Only save logins you are allowed to give to software; sites
that need a one-time code, a captcha or a personal signing PIN stay with a person (the
agent stops and asks).

## 13. Practice supplier portal (testing)

A fake portal with a login and a 34-message inbox, for testing agents end to end:
`docker compose --profile demo up -d practice-portal` (http://localhost:8509; login
demo.supplier / practice-only-2026). Agents reach it as http://practice-portal:8080 because
`.env` allows it (`AGENTIC_PRIVATE_HOSTS_ALLOWED` and `BROWSER_ALLOW_HOSTS`). Never set
those two in production.

## 14. Capacity (measured 2026-10-02, load test in deploy/loadtest)

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

## 15. Browser egress: allow-list and upstream

The browser's only way out is the `egress` proxy (`apps/egress`). It allows public addresses
on ports 80/443 and refuses everything internal; denials are logged without paths:
`docker compose logs egress | grep '"deny"'`.

| Setting (`.env`) | What it does |
|---|---|
| `EGRESS_ALLOW_PORTS` | Ports any public host may use (default `80,443`) |
| `EGRESS_ALLOW_HOSTS` | Hosts allowed although private (dev: `practice-portal`). Empty in production |
| `EGRESS_UPSTREAM` + `EGRESS_UPSTREAM_HOSTS` | Send only those hosts (https and plain http) through a trusted upstream proxy on another line, so they exit its IP (ePerolehan blocks datacenter IPs). The upstream does the address checks for them; it must be our egress run as in docs/EPEROLEHAN-EXIT-IP.md (tailnet IP only, `EGRESS_ONLY_HOSTS`). If it is down, those hosts fail; nothing falls back to direct |
| `EGRESS_ONLY_HOSTS` | Makes an egress single-purpose: only these destinations. For the exit proxy, not for this stack |
| `EGRESS_LOG_ALLOWED=true` | Log allowed connections too (to see what a task reached) |

Changes need `docker compose up -d egress` (VPS: the deploy script).

## 16. Browser pacing and held sessions

- **Pacing.** Server-touching actions (clicks, form posts, navigations) wait a human gap:
  `BROWSER_PACE_MIN` seconds plus up to `BROWSER_PACE_JITTER` random, and at most
  `BROWSER_PACE_MAX_PER_MIN` per minute per session (local 2.5 s + 1.5 s, 20/min; the VPS
  overlay 4 s + 3 s, 12/min). Reading the loaded page is never paced. Raise them if a portal
  still flags the agent.
- **Idle and held sessions.** An idle session closes after `BROWSER_IDLE_SECONDS` (600). While
  an approval waits (a submit or an upload), the worker *holds* the session so it is still
  there when the person says yes, up to `BROWSER_HOLD_MAX` (7200 s). After that the agent
  opens the page again.
- **Downloads and uploads** (P28): files a page downloads land in the company's files
  (`Web downloads/<site>`, secrets-scanned); `browser_upload` always waits for a person.

## 17. Code sandbox

`run_python` sends code to the `sandbox` service (no internet, no data, own uid 10010).

- One run at a time. Another run waits up to `SANDBOX_QUEUE_SECONDS` (45) and then gets
  "busy" (the agent is told to try again).
- Limits per run: `SANDBOX_CPU_SECONDS` (15), `SANDBOX_WALL_SECONDS` (30), `SANDBOX_MEM_MB`
  (512), `SANDBOX_NPROC` (96 processes/threads for the uid), 10 MB per file, 20 MB of input.
- Only files written to `./out` come back (saved to the company's AI folder).
- Look: `docker compose logs sandbox`; health `docker compose ps sandbox`. If run code crashed
  it, the container restarts by itself.
