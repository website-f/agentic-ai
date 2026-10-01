# Agentic-AI

Self-hosted multi-agent platform. Persistent role-based AI agents (Office Manager, Researcher,
Analyst, Finance, Data Entry, Writer, Reviewer, Ops) that remember, write their own skills,
and get better over time. You watch and direct them in a pixel-art office on the web dashboard
or from your phone (installable PWA).

**Status:** P0 to P5 done (2026-10-01): foundations, AI engine, agent runtime, brain, skills, pixel office.
- P0: monorepo, Docker stack, sign-in with 5 roles, branches and departments, members, tamper-evident activity log, responsive PWA shell.
- P1: provider keys (envelope-encrypted), 3-step streamed connection test, model discovery and pricing, model groups with fallback and cooldowns, playground, usage and cost, 30-minute scheduled health checks.
- P2: SOPs (workspace/branch/department/library) layered into prompts, 6-step agent builder with templates, per-agent tool permissions, agent chat, durable tasks on Temporal (survive restarts, approvals wait 24 h), Kanban board, approvals and questions with a hardline policy floor, broadcasts with receipts and replies, live updates over SSE.

- P3: the Brain. Facts learned after every task and chat (extract, then reconcile; replaced facts are kept, never deleted), capped core memory per agent with a frozen snapshot, wiki pages in a git vault that opens in Obsidian, hybrid search (keywords + local multilingual embeddings + wikilinks, RRF), automatic recall at the start of each task and chat turn, a nightly dream that merges duplicates and settles contradictions with an undoable diary, company isolation.

- P4: Skills. Agents see a short index of proven procedures and load one only when a task matches (`SKILL.md` convention). After long or corrected work they draft a skill or an improvement; a safety scan and old-vs-new tests run before a person reviews a side-by-side diff and approves, edits or rejects (the agent remembers why). Every approval is a version and a git commit. Usage, acceptance rate and tokens saved are measured per skill; a nightly curator proposes merges and retirements.

- P5: the Pixel office. One live office per company, generated from its departments (a desk per agent) plus a library, workshop with bug corner, breakroom, meeting room and approval podium. Agents walk there because of real events: at the desk while working ("..." while the model thinks), to the podium when they need you, to the library when they search memory, to the workshop when they write a skill, to the bug corner on errors, to the breakroom when idle. Tap an agent for its panel (approve right there, ask it something, pause it); drag a task card onto an agent to assign it. Day and night themes, pinch and wheel zoom in whole steps, a list view with the same data.

Next: P6 Channels and phone push (Telegram, push approvals, API tokens).

## Run it

```bash
docker compose up -d --build
# open http://localhost:8500 and sign in with a test login below
```

On first start with an empty database, dev mode creates the workspace "Qbot Group", the
branch "Qbot Studio Sdn Bhd" with its 6 departments, and one test login per role. Every
PC that runs the command above gets the same logins:

| Role | Email | Password |
|---|---|---|
| Owner | owner@example.com | agentic-test-2026 |
| Admin | admin@example.com | agentic-test-2026 |
| Operator | operator@example.com | agentic-test-2026 |
| Approver | approver@example.com | agentic-test-2026 |
| Viewer | viewer@example.com | agentic-test-2026 |

Change the password with `AGENTIC_SEED_PASSWORD` in `.env`, or set `AGENTIC_DEV_SEED=false`
to get the setup screen instead. The seed never runs with `AGENTIC_ENV=prod` and never
touches a database that already has users. AI provider keys are data, not config: add them
again on each new PC (AI Engine page).

Everything binds to 127.0.0.1. Temporal UI: http://localhost:8502.

**Open the brain in Obsidian.** The vault lives in a Docker volume by default. Either download
it (Brain > Download vault, a zip with its git history) or set `AGENTIC_VAULT_DIR=./data/vault`
in `.env` before the first start, then open `./data/vault/qbot-group` as a vault. Edits made in
Obsidian come back in with Brain > Sync vault, and every night automatically.

## Develop

```bash
docker compose up -d postgres valkey temporal temporal-ui   # infra only

cd apps/api
uv sync
uv run alembic upgrade head
uv run uvicorn agentic.api.main:app --reload --port 8501    # API
uv run python -m agentic.workflows.worker                    # worker (second shell)
uv run pytest -q                                             # 35 tests, uses DB agentic_test

cd apps/web
corepack pnpm install
corepack pnpm dev        # http://localhost:5173, proxies /api to :8501
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test
```

On Windows without admin rights, call pnpm as `corepack pnpm` (`corepack enable` needs write access to Program Files).

## Read in this order

| # | Doc | What it decides |
|---|---|---|
| 1 | [docs/PLAN.md](docs/PLAN.md) | Vision, scope, principles, phased roadmap, acceptance criteria, open decisions |
| 2 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Services, request flows, event bus, API surface |
| 3 | [docs/TECH-STACK.md](docs/TECH-STACK.md) | Every layer, the pick, the reason, what was rejected |
| 4 | [docs/OPEN-SOURCE-INTEGRATION.md](docs/OPEN-SOURCE-INTEGRATION.md) | How each upstream project is pulled in (service / library / pattern port), licenses, monorepo layout |
| 5 | [docs/AGENT-RUNTIME.md](docs/AGENT-RUNTIME.md) | Agents, roles, delegation, task board, approvals, scheduling, and every element copied from Hermes Agent and OpenClaw |
| 6 | [docs/SKILLS-SELF-IMPROVEMENT.md](docs/SKILLS-SELF-IMPROVEMENT.md) | Hermes-style auto-written skills, review queue, curator, evals, optimizer |
| 7 | [docs/MEMORY-AND-TOKENS.md](docs/MEMORY-AND-TOKENS.md) | Second brain (Obsidian-compatible vault + facts + hybrid index + nightly dream), token-saving playbook, token logging |
| 8 | [docs/AI-ENGINE.md](docs/AI-ENGINE.md) | Provider keys, test connection, model discovery, routing, budgets, usage |
| 9 | [docs/PIXEL-OFFICE.md](docs/PIXEL-OFFICE.md) | Phaser 4 office, rooms, sprite states, interactions, event schema, assets |
| 10 | [docs/FRONTEND.md](docs/FRONTEND.md) | Design system, pages, advanced components, responsive rules, PWA |
| 11 | [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Postgres schema |
| 12 | [docs/DOCKER-AND-DEPLOY.md](docs/DOCKER-AND-DEPLOY.md) | Optimized images, compose profiles, resource budget, ports, VPS deploy, backups |
| 13 | [docs/SECURITY.md](docs/SECURITY.md) | Auth, RBAC, secrets, policy floor, prompt injection, supply chain |

## Decisions in one screen

- **Agent loop:** Agno (Apache-2.0), Python, pinned.
- **Durability, scheduling, approvals that wait for days:** Temporal (MIT) on the shared Postgres.
- **Governance model (org chart, budgets, heartbeats):** ported from Paperclip (MIT). Not run as a service.
- **Skills that write themselves:** ported from Hermes Agent (MIT): `SKILL.md` format, `skill_manage`, staged writes, curator.
- **Memory:** Mem0 on pgvector for facts + a git markdown vault in Karpathy "LLM wiki" layout that opens in Obsidian + GBrain-style hybrid search + OpenClaw-style nightly "dreaming".
- **AI Engine:** our own gateway, ported from CrawlOps (`CrawlOps/backend/app/services/gateway.py`). Presets for Groq, OpenRouter, HuggingFace, Mistral, DeepSeek, OpenAI. No LiteLLM.
- **Office view:** custom Phaser 4 + Tiled build, patterns from `geezerrrr/agent-town` and `pablodelucca/pixel-agents` (both MIT).
- **Organization:** branches (one per company) with departments inside; agents are created by hand and placed into a department with skills and SOPs; broadcasts to all / branch / department / picked agents with receipts; bounded agent-to-agent meetings with decision summaries.
- **Web + phone:** React 19 + Vite + Tailwind v4 + shadcn/ui + Motion, installable PWA with Web Push approvals, role-based login (owner / admin / operator / approver / viewer).
- **Deploy:** local-first on the dev PC (`docker compose --profile core up`), everything free and open source (CC0 art, local backups, no Ollama by default); later an optional VPS deploy behind `/opt/reverse-proxy`, ports **8500-8509**.

## Folder layout (target)

```
Agentic-AI/
  apps/
    web/          React PWA (dashboard + office shell)
    api/          Python package `agentic` (FastAPI + Agno + Temporal worker)
  packages/
    office/       Phaser 4 game (TypeScript), embedded by apps/web
    ui/           shadcn/ui components, tokens, icons
  deploy/         Dockerfiles, compose files, Caddy snippet, backup scripts
  reference/      git-ignored upstream clones at pinned commits (read-only)
  docs/           this plan
  THIRD_PARTY_NOTICES.md
```
