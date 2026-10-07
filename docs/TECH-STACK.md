# Tech stack

Versions were observed on 2026-10-01. Pin exact versions (and image digests) when P0 scaffolds the repo, and let Renovate propose upgrades.

## Backend (Python)

| Layer | Pick | Why | Rejected |
|---|---|---|---|
| Language | Python 3.12 | Agno, Mem0, Temporal SDK, DSPy, fastembed all first-class | TypeScript backend (Mastra): smaller agent ecosystem, enterprise `ee/` license parts |
| Package manager | `uv` with `uv.lock` (hash-locked) | Fast, reproducible, great Docker cache story | pip + requirements.txt |
| Web framework | FastAPI + Uvicorn | Async, Pydantic v2, SSE friendly; Agno AgentOS is FastAPI-based | Django |
| Agent loop | **Agno** v3.x (Apache-2.0) | Agents, teams, tools, sessions, memory hooks, multi-provider including OpenAI-compatible endpoints and Ollama | LangGraph (server is ELv2 + license key), CrewAI (no OSS server), AutoGen (maintenance mode) |
| Durable workflows | **Temporal** server + `temporalio` SDK (MIT) | Survives restarts, signals for approvals, schedules for cron, task queues | Hatchet (good, smaller), Inngest (SSPL server), Celery (not durable) |
| ORM / migrations | SQLAlchemy 2 + Alembic | Mature, async, typed | SQLModel (thin wrapper, less control) |
| Validation | Pydantic v2 | Shared with FastAPI and Agno | |
| Facts memory | **Mem0** OSS (Apache-2.0) on pgvector | Scoped by user/agent/run, one Postgres | Hindsight (kept as swap-in), Graphiti (needs Neo4j) |
| Embeddings | `fastembed` (ONNX, CPU) with a multilingual small model; provider embeddings optional | Zero API cost, runs inside the worker | sentence-transformers + torch (huge image) |
| Vault | git repo per workspace via `pygit2` or `dulwich`, markdown + YAML frontmatter | Diffable, reversible, opens in Obsidian | Basic Memory (AGPL) |
| Search | Postgres `tsvector` + pgvector HNSW + link graph table, fused with RRF | One database, no Meilisearch needed | Separate search engine |
| HTTP client | `httpx` (async) | Gateway, tools | |
| Telegram | `python-telegram-bot` v21+ | Inline keyboards for approvals | |
| Web Push | `pywebpush` (VAPID) | Standard push to PWA | Firebase |
| Prompt optimizer (P4+) | DSPy with GEPA | Trace-driven prompt and skill improvement | |
| Lint / type / test | ruff, pyright, pytest + pytest-asyncio, Temporal test env | | |

## Frontend

| Layer | Pick | Why |
|---|---|---|
| Framework | React 19 + Vite + TypeScript | SPA, no SSR needed, fast HMR, PWA plugin |
| Routing | TanStack Router (file-based, type-safe) | Typed params and search state |
| Server state | TanStack Query | Cache, optimistic updates, retry |
| Client state | Zustand | Office state, UI prefs |
| Styling | Tailwind CSS v4 (Vite plugin) | Tokens via CSS variables |
| Components | shadcn/ui (Radix primitives), customized, never default look | Owned code, accessible |
| Motion | Motion (`motion/react`) | Spring transitions, layout animations, reduced-motion support |
| Icons | Phosphor (`@phosphor-icons/react`), one family, stroke weight fixed | Taste-skill priority list |
| Fonts | Geist Sans + Geist Mono (self-hosted via Fontsource); Pixelify Sans (OFL) only inside the office canvas | |
| Tables | TanStack Table + TanStack Virtual | Usage logs, audit log, large lists |
| Charts | Recharts with theme tokens | Usage, cost, latency |
| Graphs | React Flow (`@xyflow/react`) for org chart and workflow graph; `sigma.js` + `graphology` for the brain graph view | |
| Drag and drop | dnd-kit | Task board, drag task onto agent card |
| Command palette | `cmdk` | Ctrl/Cmd+K everywhere |
| Toasts / drawers | Sonner, Vaul (bottom sheets on mobile) | |
| Forms | react-hook-form + zod | |
| Editor | CodeMirror 6 (markdown, YAML) + `react-markdown` preview | Vault pages, skills, `SOUL.md` |
| Diff | `@git-diff-view/react` | Skill proposal review |
| Office engine | Phaser 4 (MIT) + Tiled maps, separate package `packages/office` | See PIXEL-OFFICE.md |
| PWA | `vite-plugin-pwa` with `injectManifest` (custom service worker) | Push, notificationclick, offline shell |
| Test | Vitest, Testing Library, Playwright (e2e + mobile viewports) | |

## Data and infra

| Layer | Pick |
|---|---|
| Database | PostgreSQL 17 + pgvector (one instance, databases: `agentic`, `temporal`, `temporal_visibility`, optional `langfuse`) |
| Cache / pub-sub | Valkey 8 |
| Object storage | rustfs 1.0.0 (S3 API) |
| Observability | Own token log (always), OpenTelemetry traces, Langfuse (profile `obs`) |
| Local models | Ollama in the default stack: one small model (`qwen3:0.6b`) for tiny side jobs and chat backup mode; agent work uses hosted APIs |
| Reverse proxy | Existing shared Caddy in `/opt/reverse-proxy` |
| Backups | restic (pg_dump + vault git bundle + rustfs bucket) to a local repo on a second disk by default (free); any S3 target such as B2 optional later |
| CI | GitHub Actions: lint, typecheck, tests, build images, Trivy scan |

## Deliberately not used

| Thing | Reason |
|---|---|
| LiteLLM proxy | Our CrawlOps gateway already covers the 6 providers; avoids the March 2026 PyPI supply-chain incident class and one more container |
| n8n, Dify, Flowise | Licenses (Sustainable Use, modified Apache) or archived |
| OpenClaw as core | Security record; patterns ported instead |
| Neo4j | Graph needs are covered by a link table + Postgres |
| TensorFlow / PyTorch in images | Nothing trains here; ONNX keeps images small |
