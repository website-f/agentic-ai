# Docker and deploy

## 0. Local first

The stack is developed and used on the dev PC. No domain, VPS or paid service is required.

- Requirements: Docker Desktop (WSL2 backend on Windows) or Docker Engine, about 8 GB free RAM.
- `docker compose up -d --build`, then open `http://localhost:8500`. Core services carry no profile, so they always start; `obs` and `demo` stay opt-in.
- `localhost` is a secure context, so the PWA installs and Web Push works on the dev machine without HTTPS.
- Phone testing without buying anything: share the dev machine over Tailscale (free tier) and use its HTTPS serve feature, or mkcert on the LAN.
- The VPS sections below apply when the stack runs on a server (it does: section 10).

## 1. Services and compose profiles

| Profile | Services | When |
|---|---|---|
| (default) | web, api, worker, temporal, temporal-ui, postgres, valkey, backup, browser, egress, sandbox, ollama (+ one-shot ollama-pull), waha | Always (no `--profile` flag needed) |
| `obs` | langfuse-web, langfuse-worker, clickhouse, rustfs, langfuse-valkey (+ two one-shot jobs) | Traces of every model call; adds about 4 GB RAM. `COMPOSE_PROFILES=obs` + `AGENTIC_LANGFUSE_HOST` in `.env` |
| `demo` | practice-portal | A fake supplier portal the browser agents practise on |

What each default service is for:

| Service | Role |
|---|---|
| web | nginx: the built PWA, and `/api` proxied to the api (streams, big uploads/downloads) |
| api | FastAPI; runs migrations and the dev seed on start |
| worker | Temporal worker: agent tasks, schedules, workflows, channels (Telegram polling) |
| temporal, temporal-ui | durable workflows on the shared Postgres; the UI is for operators only |
| postgres, valkey | data (pgvector) and caches/cooldowns/locks/pub-sub |
| browser | Camoufox (Firefox) that agents drive, `apps/browser`; no route out except egress |
| egress | `apps/egress`: the browser's only way out; refuses non-public addresses, pins the checked IP; optional upstream for listed hosts (docs/EPEROLEHAN-EXIT-IP.md) |
| sandbox | `apps/sandbox`: runs agents' `run_python` code, no network, own uid, one run at a time |
| ollama (+ ollama-pull) | the local backup model (`qwen3:0.6b`) for a few small jobs and chat backup mode; ollama-pull downloads it once |
| waha | WhatsApp gateway (NOWEB) for assistants and the WhatsApp channel |
| backup | nightly pg_dump + vault + WhatsApp sessions into an encrypted restic repository (section 8) |

A 4 GB server stacks `docker-compose.small.yml` last; there the browser and egress move to
profile `browser` and Temporal UI to `ops` (see `docs/SMALL-SERVER.md`).

## 2. Ports (reserved block 8500-8509 locally)

All bound to `127.0.0.1`. Only web goes through the host's reverse proxy.

| Port | Service | Exposure |
|---|---|---|
| 8500 | web (SPA + `/api` proxy) | Public via the reverse proxy (`AGENTIC_PORT` on a VPS) |
| 8501 | api | Dev only; on a VPS reached only through web |
| 8502 | temporal-ui | SSH tunnel / Tailscale only (`TEMPORAL_UI_PORT`) |
| 8503 | langfuse | SSH tunnel / Tailscale only (profile `obs`) |
| 8504, 8505 | spare (ollama and rustfs are never published) | |
| 8506 | Postgres | Dev only; dropped in the VPS override |
| 8507 | Valkey | Dev only |
| 8508 | Temporal gRPC | Dev only, for a worker run from the host |
| 8509 | practice portal | Dev only (profile `demo`); dropped in the VPS override |

## 3. Images

Our images are built from `deploy/*.Dockerfile` (build context: repo root); everything else
is upstream, pinned by version tag. Versions: `deploy/VERSIONS.md`.

| Image | Dockerfile | Contents |
|---|---|---|
| `agentic-py` (api, worker, practice portal) | `deploy/api.Dockerfile` | `python:3.12-slim-trixie` + uv 0.10.7; `uv sync --frozen --no-dev --reinstall-package agentic`; the embedding and speaker models baked in (`/opt/models`, offline at run time); Tesseract (eng + msa), Liberation fonts, ffmpeg; uid 10001 |
| `agentic-web` | `deploy/web.Dockerfile` | `node:22-alpine` build (pnpm) → `nginxinc/nginx-unprivileged:1.31-alpine` with `deploy/nginx/web.conf`; uid 101 |
| `agentic-browser` | `deploy/browser.Dockerfile` | `python:3.12-slim-trixie` + Camoufox + Playwright (Firefox deps), browser binary fetched at build; uid 10001 |
| `agentic-egress` | `deploy/egress.Dockerfile` | `python:3.12-slim-trixie`, one standard-library file; uid 10001 |
| `agentic-sandbox` | `deploy/sandbox.Dockerfile` | `python:3.12-slim-trixie` + offline data libraries (openpyxl, matplotlib, pillow, python-docx); server root-owned and read-only; uid 10010 |
| `agentic-backup` | `deploy/backup/Dockerfile` | `postgres:17.11-alpine3.24` (pg_dump 17) + restic, gosu removed; uid 10001 |

nginx (`deploy/nginx/web.conf`): long-cache hashed assets, `no-cache` for the app shell and
service worker, CSP and security headers, `proxy_buffering off` + 1 h read timeout on
`/api/events` (SSE), streamed uploads/downloads for recordings, intake zips and files, and
real-client-IP handling (realip module; the api gets one address in `X-Real-IP` /
`X-Forwarded-For`, never a client-supplied chain).

## 4. Compose rules, as they are

- Images pinned by version tag; no `latest` except the local default of `WAHA_IMAGE` (the VPS
  overlay requires it pinned). No digests in compose (see `deploy/VERSIONS.md`).
- `cap_drop: [ALL]` and `no-new-privileges` on every service. Our own services run non-root
  (10001; sandbox 10010; web 101) with a read-only root and explicit `tmpfs`. Upstream images
  run as their own user (Postgres/Valkey 999, Temporal 1000), except **ollama and waha, which
  run as root** (root-owned volumes) with no capabilities.
- Healthchecks on postgres, valkey, temporal, api, worker, web, browser, egress, sandbox,
  ollama, waha, backup (and the obs services); not on temporal-ui or the one-shot jobs.
  `depends_on: condition: service_healthy` where order matters (api on the data services,
  worker on api, web on api, browser on egress, backup on postgres).
- Networks:

  | Network | Members | Internet |
  |---|---|---|
  | `data` | postgres, valkey, temporal, temporal-ui, api, worker, backup (+ obs) | yes locally; **internal** on a VPS |
  | `edge` | web, api, worker, waha, backup, langfuse-web | yes |
  | `browser` | browser, worker, egress | **internal** |
  | `egress-out` | egress, practice-portal | yes (the browser's only way out, through egress) |
  | `sandbox` | sandbox, worker | **internal** |
  | `llm` | ollama, api, worker | **internal** |
  | `llm-pull` | ollama-pull | yes (downloads the model into the shared volume) |
  | `ops` (VPS only) | temporal-ui | yes (only so its 127.0.0.1 port can be published) |

- Named volumes: `pgdata`, `valkeydata`, `vault`, `media`, `backupwork`, `ollamadata`,
  `wahadata` (+ obs volumes). `AGENTIC_VAULT_DIR` / `AGENTIC_MEDIA_DIR` / `BACKUP_DIR` may
  point at host folders.
- Logging: `json-file`, `max-size: 10m`, `max-file: 3`.
- Secrets come from `.env` (never committed); `.env.example` and `.env.vps.example` document
  every variable; the VPS overlay makes each secret required (`${VAR:?}`).
- `restart: unless-stopped`; no `docker.sock` mounted anywhere.

## 5. One Postgres, many databases

`deploy/postgres/initdb/01-roles.sh` creates the `temporal` role and the `temporal` and
`temporal_visibility` databases next to `agentic` (and `obs-init` adds `langfuse` when `obs`
is used). Extensions: `vector`, `pg_trgm`. Tuned via `command:` flags
(`shared_buffers=${PG_SHARED_BUFFERS:-512MB}`, `work_mem=16MB`, `max_connections=150`).

Temporal runs `temporalio/auto-setup` with SQL persistence on this Postgres (no Cassandra, no
Elasticsearch). Moving to `temporalio/server` + a schema job is still open.

## 6. Resource limits (default stack)

| Service | mem_limit | cpus |
|---|---|---|
| postgres | 1.5 GB | 1.0 |
| valkey | 256 MB | 0.25 |
| temporal | 768 MB | 0.75 |
| temporal-ui | 128 MB | 0.25 |
| api | 1 GB (includes the ~300 MB embedding model) | 1.0 |
| worker | 1.5 GB | 1.0 |
| web | 64 MB | 0.25 |
| browser | 3 GB | 3 |
| egress | 128 MB | 0.5 |
| sandbox | 1 GB | 2 |
| ollama | 1.5 GB | 2 |
| waha | 512 MB | 1 |
| backup | 256 MB | 0.5 |

These are ceilings. Measured on the live server after start: about 3.3 GB in use (api ~0.8,
worker ~0.73, ollama ~0.86 until it unloads, WAHA 0.33, Postgres 0.2). The small overlay fits
4 GB (docs/SMALL-SERVER.md).

## 7. Local vs VPS

- `docker-compose.yml`: the whole local stack, dev defaults, dev ports on 127.0.0.1. There is
  no `docker-compose.override.yml`; run the api/web from the host for hot reload (README,
  Develop).
- `docker-compose.vps.yml`: production mode (`AGENTIC_ENV=prod`, no dev seed, Secure cookies),
  every secret required, only web (and the Temporal UI, for a tunnel) published on
  127.0.0.1, `data` internal, Temporal UI on its own `ops` network, `WAHA_IMAGE` required.
- `docker-compose.small.yml`: stacked last for a 4 GB server.

On a VPS, always deploy with **`./deploy/scripts/deploy-vps.sh`**. A bare
`docker compose up -d --build` there leaves out `docker-compose.vps.yml`: dev mode, the dev
test logins, the dev ports. The script:

1. checks the compose config (a missing `.env` value stops it before anything changes);
2. prints the current commit and the one-line rollback;
3. runs a backup in the running backup container (`agentic-backup backup`) and **aborts if
   it fails** (`--skip-backup` to override, only when the backup itself is broken);
4. `git pull --ff-only` (skip with `--no-pull`), `build --pull` of our images;
5. recreates the `browser` / `llm` networks once if they are not yet internal;
6. `up -d --remove-orphans`, then **fails** if any published port is not on 127.0.0.1.

Rollback: `git checkout <previous-rev> && ./deploy/scripts/deploy-vps.sh --no-pull`.
Migrations are not reversed; if the new version changed the database, restore the
pre-deploy backup (docs/RUNBOOK.md, Restore).

Vite variables are build-time: any `VITE_*` change needs a rebuild, not just a recreate.

## 8. Backups

The `backup` service (`deploy/backup/`: `agentic-backup` script, pg_dump 17 + restic) runs
inside the stack, not as a host cron, so it works the same on Windows and Linux:

1. Nightly at `BACKUP_HOUR` (`BACKUP_TZ`): `pg_dump -Fc` of `agentic`, `temporal` and
   `temporal_visibility`; a tar of the vault volume (one git repo per workspace, history
   included); a tar of the WAHA session volume (mounted read-only); a manifest (alembic
   revision); optionally the two keys that decrypt stored secrets
   (`BACKUP_INCLUDE_SECRETS`, inside the encrypted repository only).
2. `restic backup` into `RESTIC_REPOSITORY`: a local folder by default (`BACKUP_DIR`, better a
   second disk), or any restic backend (B2, S3, sftp) for offsite copies.
3. Only after a complete upload: `restic forget --prune` (7 daily / 4 weekly / 6 monthly)
   and `last-success` is written. Any failed step stops the backup, prunes nothing and
   records a failure.
4. Healthcheck `agentic-backup health`: unhealthy when the loop stopped, the last backup
   failed, or the last success is older than `BACKUP_MAX_AGE_HOURS` (30; a fresh install
   counts from container start).
5. On demand: `backup`, `snapshots`, `check`, `restore [latest|<id>]` (docs/RUNBOOK.md).

Not backed up: Valkey (caches only), the `media` volume (transient recordings), the Ollama
model (downloaded again). There is no automated restore test; the drill below was by hand.

## 9. CI

**Not set up.** There is no CI pipeline (no GitHub Actions or other runner): tests, linters,
type checks, image builds and Trivy scans are run by hand before a deploy. Wanted later:
ruff + pyright + pytest (with Postgres, Valkey and Temporal), eslint + tsc + vitest, image
builds, Trivy (fail on critical) and a license check.

## 10. As built

### P8 (2026-10-02)

**Hardening.** Our services run non-root with `cap_drop: ALL` and `no-new-privileges`
(Postgres 999, Valkey 999, Temporal and its UI 1000, api, worker and backup 10001, web 101;
later ollama and waha as root without capabilities, sandbox 10010). App containers have a
read-only root. Outside `AGENTIC_ENV=dev` the api refuses to start without a random 32+
character secret key, a valid 32-byte master key and Secure cookies. The images are built
on Debian 13 (trixie) with `apt-get upgrade`, and the backup image drops the unused `gosu`:
Trivy found no critical vulnerabilities in the three images then built (re-scan before each
deploy; there is no CI doing it).

**Backups.** Restore drill done on 2026-10-02: a brand-new stack (fresh volumes, other ports)
restored from a copy of the backup folder had the same agents, tasks, facts and brain pages,
a valid audit chain, a provider key that decrypted, the vault with its git history and the
user's schedule back in Temporal. The worker also re-syncs every schedule into Temporal on
start, so recurring work survives even a restore without Temporal's databases.

**VPS override.** Postgres, Valkey, Temporal and the api publish nothing, and the `data`
network is `internal: true`, so the databases have no route to the internet. Verified
locally: production mode starts, no dev seed, Secure + HttpOnly cookies, the worker reaches
AI providers, Postgres cannot reach anything outside.

**Observability.** Langfuse v4 (MIT core) with ClickHouse, rustfs (S3, Apache-2.0) and its
own Valkey (`noeviction`), all permissive licences. The gateway sends one OTLP span per
model call (`agentic/obs/langfuse.py`, no SDK). Off unless `AGENTIC_LANGFUSE_HOST` is set;
a slow or absent Langfuse never affects agents. Langfuse web needs 2 GB.

**Capacity fixes found by the load test** (numbers in docs/RUNBOOK.md): the worker's database
pool ran dry with 20+ concurrent task steps (now 16 steps, pool 24 + 16); every open live
stream held a database connection and its own Valkey subscription (now none, and one shared
subscription per process); the task and agent lists ran two queries per row (now batched).

### Live install (2026-10-04)

The stack runs in production at **https://agent.oriondesk.space**.

- Server: an Ubuntu 24.04 VPS (`<VPS_IP>`), shared with other projects; access details are
  kept with the operator, not in this repository.
- Code: `<INSTALL_DIR>` (a clone of this repository). Secrets: `.env`, mode 600, generated on
  the server; a copy belongs in a password manager.
- Ports: web on `127.0.0.1:8700`, Temporal UI on `127.0.0.1:8702` (`AGENTIC_PORT`,
  `TEMPORAL_UI_PORT`); the 8500 block is used by another project on that server.
- TLS and routing: a custom Go reverse proxy ("Orxies") on the host, whose site file points
  `agent.oriondesk.space` at `127.0.0.1:8700`; it reloads site files and obtains the
  certificate by itself. Its admin UI is reachable only through an SSH tunnel to the server.
- Updating: `./deploy/scripts/deploy-vps.sh` from the install directory (section 7).
- Server `.env` extras: `COMPOSE_PROFILES=demo` (practice portal), `OLLAMA_KEEP_ALIVE=30m`,
  `WAHA_IMAGE` pinned to the image the WhatsApp session was created with.

How the dev PC's data was moved:

1. Stopped the writers, then `pg_dump -Fc` of `agentic`, `temporal` and
   `temporal_visibility`. Tarred the `vault` and `wahadata` volumes.
2. On the server: started `postgres` alone so its first boot creates the roles. Ran
   `pg_restore --no-owner --role=<owner>`, then untarred the volumes.
3. Ran `python -m agentic.admin rotate-master-key --from-dev`: it re-wraps every stored
   secret from the dev-derived key to the server's `AGENTIC_MASTER_KEY`.
4. Pointed the WhatsApp channel at the server's WAHA key.
5. Gave the test accounts one-time passwords with `reset-password`, because the dev password
   is published in the README.
6. Stopped WAHA on the dev PC. **One WhatsApp session must never run in two places at once.**

### VPS deploy behind the shared Caddy (general recipe)

1. On the VPS: `git clone` into the install directory, `cp .env.vps.example .env`, fill it
   (`python3 deploy/scripts/gen-secrets.py`), set `AGENTIC_DOMAIN`, `AGENTIC_PUBLIC_URL`,
   `AGENTIC_PORT` and a pinned `WAHA_IMAGE`.
2. `install -d -o 10001 -g 10001 data/backups data/restore` (better: `BACKUP_DIR` on a
   second disk, or an offsite `RESTIC_REPOSITORY`).
3. `./deploy/scripts/deploy-vps.sh` (it checks that every published port is 127.0.0.1).
4. In the reverse proxy, route the domain to `127.0.0.1:<AGENTIC_PORT>`. For Caddy:

   ```caddy
   {$AGENTIC_DOMAIN} {
       import common_headers
       header Strict-Transport-Security "max-age=31536000"
       reverse_proxy {$AGENTIC_UPSTREAM} {
           flush_interval -1   # live updates (server-sent events) stream without buffering
       }
   }
   ```

   Do not cap request bodies there below nginx's limits (recordings up to ~1 GB, intake zips
   200 MB): nginx in `web` enforces them. The proxy should set `X-Forwarded-For` (Caddy and
   Orxies do); nginx takes the client address from it.
5. Open `https://$AGENTIC_DOMAIN/setup` to create the owner (no dev logins exist in prod).
6. Temporal UI and Langfuse: an SSH tunnel to `127.0.0.1:<TEMPORAL_UI_PORT>` / `:8503`.
