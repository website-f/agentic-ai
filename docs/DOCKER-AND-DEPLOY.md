# Docker and deploy

## 0. Local first

v1 is developed and used on the dev PC. No domain, VPS or paid service is required.

- Requirements: Docker Desktop (WSL2 backend on Windows) or Docker Engine, about 8 GB free RAM.
- `docker compose up -d --build`, then open `http://localhost:8500`. Core services carry no profile, so they always start; `obs` and `llm` stay opt-in.
- `localhost` is a secure context, so the PWA installs and Web Push works on the dev machine without HTTPS.
- Phone testing without buying anything: share the dev machine over Tailscale (free tier) and use its HTTPS serve feature, or mkcert on the LAN.
- The VPS sections below apply only when the stack later goes public.

## 1. Compose profiles

| Profile | Services | When |
|---|---|---|
| (default) | web, api, worker, temporal, temporal-ui, postgres, valkey | Always (no `--profile` flag needed). rustfs joins in P3 when file storage is needed |
| `obs` | langfuse-web, langfuse-worker, clickhouse | When deep tracing is needed (adds about 2.5 GB RAM) |
| `llm` | ollama | Optional and off by default; the stack runs on hosted APIs |

`docker compose up -d` is the whole product.

## 2. Ports (reserved block 8500-8509)

All bound to `127.0.0.1` on the VPS. Only `8500` goes through the shared Caddy.

| Port | Service | Exposure |
|---|---|---|
| 8500 | web (SPA + `/api` proxy) | Public via `/opt/reverse-proxy` |
| 8501 | api | Internal (reached through web) |
| 8502 | temporal-ui | Tailscale only |
| 8503 | langfuse | Tailscale only (profile `obs`) |
| 8504 | ollama | Internal (profile `llm`) |
| 8505 | rustfs console (P3) | Tailscale only |
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

Prod deploy (on the VPS, `/opt/agentic-ai/`):

```bash
cp .env.vps.example .env && nano .env
docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile core up -d --build
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
