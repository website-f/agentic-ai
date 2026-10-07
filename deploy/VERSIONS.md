# Pinned versions

Lockfiles (`apps/api/uv.lock`, `pnpm-lock.yaml`) are the source of truth for libraries; this
table tracks images and the headline packages. Checked against `docker-compose.yml`, the
Dockerfiles in `deploy/`, `apps/*/requirements.txt` and the lockfiles on 2026-10-07.

## Images

Compose pins every upstream image by **version tag** (no digests), except WAHA: locally it
follows `WAHA_IMAGE` (default `latest`), and on a VPS `docker-compose.vps.yml` requires
`WAHA_IMAGE` to be pinned (`.env.vps.example` carries a digest). To make another image
byte-for-byte repeatable, add `@sha256:...` to its tag in your server's copy and re-scan
with Trivy when you move it.

| Service | Image | Note |
|---|---|---|
| postgres | `pgvector/pgvector:0.8.6-pg17-trixie` | PostgreSQL 17 + pgvector 0.8.6, runs as 999 |
| valkey | `valkey/valkey:8.1.10-alpine` | runs as 999 |
| temporal | `temporalio/auto-setup:1.29.7` | Last auto-setup tag; moving to `temporalio/server` + a schema job is still open. Runs as 1000 |
| temporal-ui | `temporalio/ui:2.54.1` | runs as 1000 |
| api / worker | built: `python:3.12-slim-trixie` + `ghcr.io/astral-sh/uv:0.10.7` | `agentic-py`, Debian 13, apt `ffmpeg` for meeting minutes; runs as 10001 |
| web | built: `node:22-alpine` (pnpm via corepack) → `nginxinc/nginx-unprivileged:1.31-alpine` | `agentic-web`, runs as 101 |
| browser | built: `python:3.12-slim-trixie` + `camoufox==0.5.6` + `playwright==1.62.0` (Firefox deps from Playwright, Camoufox binary fetched at build) | `agentic-browser`, runs as 10001 |
| egress | built: `python:3.12-slim-trixie`, standard library only | `agentic-egress`, runs as 10001 |
| sandbox | built: `python:3.12-slim-trixie` + `apps/sandbox/requirements.txt` (fastapi, uvicorn, pydantic, openpyxl, matplotlib, pillow, python-docx; lower bounds only, resolved at build) | `agentic-sandbox`, runs as its own uid 10010 |
| backup | built: `postgres:17.11-alpine3.24` + restic 0.18.1 (Alpine package) | `agentic-backup`, gosu removed, runs as 10001 |
| ollama, ollama-pull | `ollama/ollama:0.34.0` | local backup model `qwen3:0.6b` (`AGENTIC_LOCAL_LLM_MODEL`); runs as root with all capabilities dropped |
| waha | `${WAHA_IMAGE}` (`devlikeapro/waha`) | NOWEB engine; runs as root with all capabilities dropped. Pin per server: a new image may not read old sessions |
| practice-portal (demo) | `agentic-py:dev` | dev/demo profile only |
| langfuse-web (obs) | `langfuse/langfuse:4.49.0` | MIT core; OTLP ingestion |
| langfuse-worker (obs) | `langfuse/langfuse-worker:4.49.0` | |
| clickhouse (obs) | `clickhouse/clickhouse-server:25.12.11.4` | Apache-2.0, runs as 101 |
| rustfs (obs) | `rustfs/rustfs:1.0.0` | S3, Apache-2.0 |
| obs-bucket job | `rclone/rclone:1.71` | MIT |

Tools used, not shipped: `grafana/k6` (load test), `aquasec/trivy` (image scan, by hand: there
is no CI).

## Libraries (headline)

| Area | Package | Version |
|---|---|---|
| API | fastapi | 0.142.2 |
| API | uvicorn | 0.54.0 |
| API | sqlalchemy | 2.1.1 |
| API | temporalio | 1.34.0 |
| API | redis (Valkey client) | 8.1.0 |
| Browser | camoufox / playwright | 0.5.6 / 1.62.0 |
| Web | react / react-dom | 19.3.0 |
| Web | @tanstack/react-router | 1.170 |
| Web | @tanstack/react-query | 5.104 |
| Web | vite | 8.3.1 |
| Web | tailwindcss | 4.3.3 |
| Web | vite-plugin-pwa | 1.3.0 |
| Web | typescript | 6.0.3 (TS 7 is out, but typescript-eslint does not support it yet) |
