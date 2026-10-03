# Docker and deploy

## 0. Local first

v1 is developed and used on the dev PC. No domain, VPS or paid service is required.

- Requirements: Docker Desktop (WSL2 backend on Windows) or Docker Engine, about 8 GB free RAM.
- `docker compose up -d --build`, then open `http://localhost:8500`. Core services carry no profile, so they always start; `obs` stays opt-in.
- `localhost` is a secure context, so the PWA installs and Web Push works on the dev machine without HTTPS.
- Phone testing without buying anything: share the dev machine over Tailscale (free tier) and use its HTTPS serve feature, or mkcert on the LAN.
- The VPS sections below apply only when the stack later goes public.

## 1. Compose profiles

| Profile | Services | When |
|---|---|---|
| (default) | web, api, worker, temporal, temporal-ui, postgres, valkey, backup, browser, sandbox, ollama (+ one-shot ollama-pull) | Always (no `--profile` flag needed) |
| `obs` | langfuse-web, langfuse-worker, clickhouse, rustfs, langfuse-valkey (+ two one-shot jobs) | Traces of every model call; adds about 4 GB RAM. `COMPOSE_PROFILES=obs` + `AGENTIC_LANGFUSE_HOST` in `.env` |
| `demo` | practice-portal | Dev only: a fake portal the browser agents practise on |

A 4 GB server stacks `docker-compose.small.yml` last; there the browser moves to profile `browser` and Temporal UI to `ops` (see `docs/SMALL-SERVER.md`).

`docker compose up -d` is the whole product.

## 2. Ports (reserved block 8500-8509)

All bound to `127.0.0.1` on the VPS. Only `8500` goes through the shared Caddy.

| Port | Service | Exposure |
|---|---|---|
| 8500 | web (SPA + `/api` proxy) | Public via `/opt/reverse-proxy` |
| 8501 | api | Internal (reached through web) |
| 8502 | temporal-ui | Tailscale only |
| 8503 | langfuse | Tailscale / SSH tunnel only (profile `obs`) |
| 8504 | spare (ollama is internal only: network `llm`, never published) | |
| 8505 | spare (rustfs is internal only, no console) | |
| 8506 | Postgres | Dev only, so host tools and tests can connect; dropped in the VPS override |
| 8507 | Valkey | Dev only |
| 8508 | Temporal gRPC | Dev only, for a worker run from the host |
| 8509 | spare | |

Add the block to `reverse-proxy/ADD-NEW-PROJECT.md` port table when P0 lands (CrawlOps holds 8400-8409, Sejuk Ops 8300-8309).

## 3. Images

Two custom images, everything else upstream and pinned by digest.

### `agentic-py` (api + worker, one image)

```dockerfile
# syntax=docker/dockerfile:1.7
FROM ghcr.io/astral-sh/uv:0.8-python3.12-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# deps layer: only lockfiles, so source edits do not bust it
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=apps/api/uv.lock,target=uv.lock \
    --mount=type=bind,source=apps/api/pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev
COPY apps/api/ ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
# pre-download the embedding model so containers start offline
RUN .venv/bin/python -m agentic.brain.prefetch_models

FROM python:3.12-slim-bookworm AS runtime
RUN groupadd -r app && useradd -r -g app -u 10001 app \
 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "agentic.api.main:app", "--host", "0.0.0.0", "--port", "8501", "--proxy-headers"]
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8501/healthz')"
```

`worker` uses the same image with `command: ["python", "-m", "agentic.workflows.worker"]`.
Target size: under 450 MB (no torch; fastembed uses ONNX Runtime).

### `agentic-web`

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/office/package.json packages/office/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter web build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
```

nginx config: long-cache hashed assets, `no-cache` for `index.html` and `sw.js`, `proxy_buffering off` + 1 h read timeout on `/api/events` (SSE), gzip + brotli static.
Target size: under 40 MB.

## 4. Compose rules applied to every service

- Pinned image tag **and** digest; no `latest`.
- `healthcheck` on every service; `depends_on: condition: service_healthy`.
- Non-root user, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true` with explicit `tmpfs` where the app allows it.
- Two networks: `edge` (web, api) and `backend` (`internal: true`: postgres, valkey, temporal, rustfs, worker, api).
- Named volumes: `pgdata`, `valkeydata`, `rustfsdata`, `vault`, `temporal-dynamic`.
- Logging: `json-file`, `max-size: 10m`, `max-file: 3`.
- Secrets (`MASTER_KEY`, DB password, VAPID private key, Telegram token) via Docker secrets / `env_file` not committed; `.env.example` documents every variable.
- `restart: unless-stopped`.
- No `docker.sock` mounted anywhere.

## 5. One Postgres, many databases

`deploy/postgres/init.sql` creates databases `agentic`, `temporal`, `temporal_visibility` (and `langfuse` when `obs` is used), each with its own role. Extensions: `vector`, `pg_trgm`. Tuned via `command:` flags for a 4-8 GB VPS (`shared_buffers=512MB`, `work_mem=16MB`, `max_connections=150`).

Temporal uses the official server image with SQL persistence pointed at this Postgres (no Cassandra, no Elasticsearch; Postgres visibility store).

## 6. Resource budget (core profile, idle to light load)

| Service | mem_limit | cpus |
|---|---|---|
| postgres | 1.5 GB | 1.0 |
| temporal | 768 MB | 0.75 |
| temporal-ui | 128 MB | 0.25 |
| api | 512 MB | 0.75 |
| worker (x1) | 1 GB | 1.0 |
| valkey | 256 MB (`maxmemory 200mb`, `allkeys-lru` for cache DB) | 0.25 |
| rustfs | 256 MB | 0.25 |
| web | 64 MB | 0.25 |
| **Total** | **about 4.5 GB** | |

## 7. Dev vs prod

- `docker-compose.yml`: base definitions.
- `docker-compose.override.yml` (dev, auto-loaded): bind mounts for hot reload, Vite dev server on 5173, api with `--reload`, ports on localhost.
- `docker-compose.vps.yml` (prod): `ports: !override` binding to `127.0.0.1:<port>` per the shared reverse-proxy convention.

Prod deploy (on the VPS, `/opt/agentic-ai/`), see section 10 for the full steps:

```bash
cp .env.vps.example .env && python3 deploy/scripts/gen-secrets.py   # paste into .env
install -d -o 10001 -g 10001 data/backups data/restore
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
# then in /opt/reverse-proxy: add AGENTIC_DOMAIN + upstream 127.0.0.1:8500, ./deploy-vps.sh
```

Vite variables are build-time: any `VITE_*` change needs `--build`, not just a recreate.

## 8. Backups

Nightly `deploy/scripts/backup.sh` (host cron):

1. `pg_dump -Fc` per database.
2. `git bundle` of every vault repo.
3. `rustfs` bucket mirror.
4. `restic backup` to a local repository on a second disk by default (free); point `RESTIC_REPOSITORY` at B2 or any S3 target when offsite copies are wanted. Retention 7 daily / 4 weekly / 6 monthly.
5. Weekly restore test into a throwaway compose project (`-p agentic_restore`).

## 9. CI

GitHub Actions: ruff + pyright + pytest (with Temporal test server), eslint + tsc + vitest, Playwright e2e (desktop + mobile viewports), build both images with BuildKit cache, Trivy image scan (fail on critical), license check, push to GHCR on tags.

## 10. As built in P8 (2026-10-02)

**Hardening.** Every service runs as a non-root user with `cap_drop: ALL` and
`no-new-privileges` (Postgres as 999, Valkey as 999, Temporal and its UI as 1000, api,
worker and backup as 10001, web as 101). App containers also have a read-only root.
Outside `AGENTIC_ENV=dev` the api refuses to start without a random 32+ character secret
key, a valid 32-byte master key and Secure cookies. The images are built on Debian 13
(trixie) with `apt-get upgrade`, and the backup image drops the unused `gosu`: Trivy
finds no critical vulnerabilities in any of the three images (44 high in Debian base
packages with no fix published yet; re-scan before each deploy).

**Backups.** Built as a service (`deploy/backup/`: pg_dump 17 + restic), not a host cron,
so it runs the same on Windows and Linux. Details and commands: docs/RUNBOOK.md section 3.
Restore drill done on 2026-10-02: a brand-new stack (fresh volumes, other ports) restored
from a copy of the backup folder had the same agents, tasks, facts and brain pages, a
valid audit chain, a provider key that decrypted, the vault with its git history and the
user's schedule back in Temporal. The worker also re-syncs every schedule into Temporal on
start, so recurring work survives even a restore without Temporal's databases.

**VPS override.** `docker-compose.vps.yml` publishes only `web` (127.0.0.1:8500) and the
Temporal UI (127.0.0.1:8502, for an SSH tunnel); Postgres, Valkey, Temporal and the api
publish nothing, and the `data` network is `internal: true`, so the databases have no
route to the internet. Every secret is `${VAR:?}`: a missing one stops the deploy. Verified
locally: production mode starts, no dev seed, Secure + HttpOnly cookies, the worker
reaches AI providers, Postgres cannot reach anything outside.

**Observability.** Langfuse v4 (MIT core) with ClickHouse, rustfs (S3, Apache-2.0) and its
own Valkey (`noeviction`), all permissive licences. The gateway sends one OTLP span per
model call (`agentic/obs/langfuse.py`, no SDK): a generation with the model, token usage,
cost, the prompt and answer with secret values masked, grouped into one trace per task.
Off unless `AGENTIC_LANGFUSE_HOST` is set; a slow or absent Langfuse never affects agents.
Langfuse web needs 2 GB: with 1 GB it ran out of heap and crash-looped.

**Capacity fixes found by the load test** (numbers in docs/RUNBOOK.md section 7):
the worker's database pool ran dry with 20+ concurrent task steps (now 16 steps, pool
24 + 16, and a step that keeps failing marks the task failed instead of leaving it
"running"); every open live stream held a database connection and its own Valkey
subscription, so about 20 open tabs stalled the app (now no connection, and one shared
subscription per process); the task and agent lists ran two queries per row (now batched).

### VPS deploy behind the shared reverse proxy

Not deployed yet: this is the recipe for when it is wanted.

1. On the VPS: `git clone` into `/opt/agentic-ai`, `cp .env.vps.example .env`, fill it
   (`python3 deploy/scripts/gen-secrets.py`), set `AGENTIC_DOMAIN`.
2. `install -d -o 10001 -g 10001 data/backups data/restore` (better: `BACKUP_DIR` on a
   second disk, or an offsite `RESTIC_REPOSITORY`).
3. `docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build`, then
   `docker compose ... ps` and `ss -ltnp | grep 85` (must show 127.0.0.1 only).
4. In `/opt/reverse-proxy`: add to `.env` `AGENTIC_DOMAIN=...` and
   `AGENTIC_UPSTREAM=127.0.0.1:8500`; add to `Caddyfile`:

   ```caddy
   {$AGENTIC_DOMAIN} {
       import common_headers
       header Strict-Transport-Security "max-age=31536000"
       request_body {
           max_size 25MB
       }
       reverse_proxy {$AGENTIC_UPSTREAM} {
           flush_interval -1   # live updates (server-sent events) stream without buffering
       }
   }
   ```

   Add the port to the table in `ADD-NEW-PROJECT.md` (8500, block 8500-8509), point the
   DNS record at the VPS, then `./deploy-vps.sh`.
5. Open `https://$AGENTIC_DOMAIN/setup` to create the owner (no dev logins exist in prod).
6. Temporal UI and Langfuse: `ssh -L 8502:127.0.0.1:8502 -L 8503:127.0.0.1:8503 vps`.

CI (section 9) is not set up: the project has no remote repository yet.

