# Pinned versions

Recorded at P0 (2026-10-01). Lockfiles (`apps/api/uv.lock`, `pnpm-lock.yaml`) are the source of truth for libraries; this table tracks images and the headline packages.

## Images

Updated at P8 (2026-10-02). Digests are the multi-arch index digests that were pulled and
tested; pin them (`image: name:tag@sha256:...`) in the VPS copy if you want byte-for-byte
repeatable deploys, and re-scan with Trivy whenever you move them.

| Service | Image | Digest | Note |
|---|---|---|---|
| postgres | `pgvector/pgvector:0.8.6-pg17-trixie` | `sha256:724a4041afdb1750446e3f6b5cfa8f3b0ac5a2cf538ddfa6bfee4f94c2fa85c6` | PostgreSQL 17.11 + pgvector 0.8.6, runs as 999 |
| valkey | `valkey/valkey:8.1.10-alpine` | `sha256:081c2f5cb575efc901aa80ff9cdbd1ec6a301682fd35e1ebb4b0990a4a4a8507` | runs as 999 |
| temporal | `temporalio/auto-setup:1.29.7` | `sha256:f14912b699cf73015ad5c4fc18d522d4b014db90e794039214dfb7c022c2644f` | Last auto-setup tag. Moving to `temporalio/server` + an admin-tools schema job is still open |
| temporal-ui | `temporalio/ui:2.54.1` | `sha256:ff0943fe532b8e33c46cd28b29e81e0ce0b6f55b9ee50a38ef1b437cc4de3fa5` | |
| api / worker base | `python:3.12-slim-trixie` + `ghcr.io/astral-sh/uv:0.10.7` | built | `agentic-py`, Debian 13, Python 3.12.14, OpenSSL 3.5.7, 0 critical (Trivy). Meeting minutes add Debian's `ffmpeg` package (7.1, apt, about +90 MB); re-scan after the next build |
| backup base | `postgres:17.11-alpine3.24` + restic 0.18.1 | built | `agentic-backup`, gosu removed, 0 critical |
| web build | `node:22-alpine` | `sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32` | pnpm 10.18.0 via corepack |
| web runtime | `nginxinc/nginx-unprivileged:1.31-alpine` | built | `agentic-web`, about 86 MB, 0 critical / 0 high |
| langfuse-web (obs) | `langfuse/langfuse:4.49.0` | `sha256:a9d1951e9e6cc1b5ad48bca3aefd31358a54fde4f84b9681f8ace2ff076c0c03` | MIT core; OTLP ingestion |
| langfuse-worker (obs) | `langfuse/langfuse-worker:4.49.0` | `sha256:40df08a1d15ecfa9542f1fd3b481f6d1afa16404a512e1ff51bc85b72144cedd` | |
| clickhouse (obs) | `clickhouse/clickhouse-server:25.12.11.4` | `sha256:8a790dd3468db22b1d4e7b18a176f378ff5ff6053b9c48dd4ea1fa71a24c5ba6` | Apache-2.0, runs as 101 |
| rustfs (obs) | `rustfs/rustfs:1.0.0` | `sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff` | S3, Apache-2.0, runs as 10001 |
| obs-bucket job | `rclone/rclone:1.71` | `sha256:3103526c506266a9ecdf064efe99bf3677d92ef6407af124d8c56b4f49cbaa51` | MIT |

Tools used, not shipped: `grafana/k6` (load test), `aquasec/trivy` (image scan).

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
