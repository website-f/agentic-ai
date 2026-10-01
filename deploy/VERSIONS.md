# Pinned versions

Recorded at P0 (2026-10-01). Lockfiles (`apps/api/uv.lock`, `pnpm-lock.yaml`) are the source of truth for libraries; this table tracks images and the headline packages.

## Images

| Service | Image | Note |
|---|---|---|
| postgres | `pgvector/pgvector:0.8.6-pg17-trixie` | PostgreSQL 17.11 + pgvector 0.8.6 |
| valkey | `valkey/valkey:8.1.10-alpine` | |
| temporal | `temporalio/auto-setup:1.29.7` | Last published auto-setup tag. Before production, move to `temporalio/server:1.32.x` plus a schema job (`temporalio/admin-tools`) |
| temporal-ui | `temporalio/ui:2.54.1` | |
| api / worker base | `python:3.12-slim-bookworm` + `ghcr.io/astral-sh/uv:0.10.7` | One image, `agentic-py`, about 407 MB |
| web build | `node:22-alpine` | pnpm 10.18.0 via corepack |
| web runtime | `nginxinc/nginx-unprivileged:1.31-alpine` | `agentic-web`, about 84 MB |

Pin by digest (`image@sha256:...`) before the first VPS deploy.

## Libraries (headline)

| Area | Package | Version |
|---|---|---|
| API | fastapi | 0.142.2 |
| API | sqlalchemy | 2.1.1 |
| API | temporalio | 1.34.0 |
| API | redis (Valkey client) | 8.1.0 |
| Web | react / react-dom | 19.3.0 |
| Web | @tanstack/react-router | 1.170 |
| Web | @tanstack/react-query | 5.104 |
| Web | vite | 8.3.1 |
| Web | tailwindcss | 4.3.3 |
| Web | vite-plugin-pwa | 1.3.0 |
| Web | typescript | 6.0.3 (TS 7 is out, but typescript-eslint does not support it yet) |
