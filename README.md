# Agentic-AI

Self-hosted multi-agent platform. Persistent role-based AI agents (Office Manager, Researcher,
Analyst, Finance, Data Entry, Writer, Reviewer, Ops) that remember, write their own skills,
and get better over time. You watch and direct them in a pixel-art office on the web dashboard
or from your phone (installable PWA).

**Status:** P0 to P8 done (2026-10-02): the whole roadmap. Foundations, AI engine, agent runtime, brain, skills, pixel office, channels, teams and governance, hardening.
- P0: monorepo, Docker stack, sign-in with 5 roles, branches and departments, members, tamper-evident activity log, responsive PWA shell.
- P1: provider keys (envelope-encrypted), 3-step streamed connection test, model discovery and pricing, model groups with fallback and cooldowns, playground, usage and cost, 30-minute scheduled health checks.
- P2: SOPs (workspace/branch/department/library) layered into prompts, 6-step agent builder with templates, per-agent tool permissions, agent chat, durable tasks on Temporal (survive restarts, approvals wait 24 h), Kanban board, approvals and questions with a hardline policy floor, broadcasts with receipts and replies, live updates over SSE.

- P3: the Brain. Facts learned after every task and chat (extract, then reconcile; replaced facts are kept, never deleted), capped core memory per agent with a frozen snapshot, wiki pages in a git vault that opens in Obsidian, hybrid search (keywords + local multilingual embeddings + wikilinks, RRF), automatic recall at the start of each task and chat turn, a nightly dream that merges duplicates and settles contradictions with an undoable diary, company isolation.

- P4: Skills. Agents see a short index of proven procedures and load one only when a task matches (`SKILL.md` convention). After long or corrected work they draft a skill or an improvement; a safety scan and old-vs-new tests run before a person reviews a side-by-side diff and approves, edits or rejects (the agent remembers why). Every approval is a version and a git commit. Usage, acceptance rate and tokens saved are measured per skill; a nightly curator proposes merges and retirements.

- P5: the Pixel office. One live office per company, generated from its departments (a desk per agent) plus a library, workshop with bug corner, breakroom, meeting room and approval podium. Agents walk there because of real events: at the desk while working ("..." while the model thinks), to the podium when they need you, to the library when they search memory, to the workshop when they write a skill, to the bug corner on errors, to the breakroom when idle. Tap an agent for its panel (approve right there, ask it something, pause it); drag a task card onto an agent to assign it. Day and night themes, pinch and wheel zoom in whole steps, a list view with the same data.

- P6: Channels. Phone and desktop notifications (Web Push, our own VAPID keys) with Approve / Deny buttons that work from the lock screen on Android (single-use 10-minute tokens), a one-screen approve page for iPhone, the app-icon badge, an installable PWA. A Telegram bot (long polling, no public URL) with inline approve/deny, answers by replying, and chats routed to the agent bound to that chat; only linked people are served. A delivery ledger so nothing is lost or sent twice. Scoped API tokens and an OpenAI-compatible endpoint (`/api/v1/chat/completions`, `model: "agent/<name>"`).

- P7: Teams and governance. Agents marked Leads split a task into up to 10 parallel sub-tasks for other agents (depth cap of 1 to 3 levels), optionally with a JSON Schema the answer must match (one correction turn, then the sub-task fails), and merge the answers. Meetings: 2 to 5 agents discuss for a few rounds (only memory search allowed, a token cap, early stop when nobody adds anything, people can interject) and the chair writes one decision summary (decision, why, options, dissent, next steps) that lands on the task and in the brain as a decision page; meetings only recommend. A drag-and-drop org chart. Budgets per agent (tokens per day, dollars per month): an alert at 80 %, and at 100 % the agent pauses and asks; approving allows half the limit again. Heartbeats: hourly during work hours an agent picks up its queued work or asks for some, once a day. Schedules on Temporal (cron + time zone) with a run ledger, retries at 5/15/30 minutes, and failures grouped into incidents.

- P8: Hardening. Nightly encrypted backups (restic, a local folder by default, any S3/B2 target optional) with a tested restore onto a fresh stack. A security review with a test for every checklist item; it fixed DNS-rebinding in the URL guard, fence break-outs in untrusted text, prompt injection into agent memory and a database-pool exhaustion from open browser tabs. Every container non-root with all capabilities dropped; production refuses to start on unsafe settings; zero critical vulnerabilities in our images (Trivy). A load test (50 dashboard users, 200 live streams, 30 parallel agent tasks: p95 203 ms, no errors). Optional Langfuse traces of every model call (`COMPOSE_PROFILES=obs`). A VPS override for the shared reverse proxy, ready but not deployed. Operations: docs/RUNBOOK.md.

- After P8 (2026-10-02): live **Monitor** (pick an agent, or "Watch live" in the office: its thinking, every tool and result, tokens and cost per step, and its browser screen with the click marker); a real browser for agents (**Camoufox**, isolated, every form submit approved by a person, forms filled in one step); **colleagues helping colleagues** (`ask_colleague`, memory checked first by the local model, answers saved for next time; `find_sop`); the local model as the office's free **backup brain** for memory, page digests and housekeeping. Measured with real models: docs/RELIABILITY.md.

Optional next steps: deploy to the VPS (docs/DOCKER-AND-DEPLOY.md section 10), CI once there is a remote repository, TOTP sign-in.

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

**Use it on your phone.** Notifications need a secure origin. `localhost` counts, but a
phone opening `http://<laptop-ip>:8500` does not. For a phone on the same network, use
Tailscale's free HTTPS (`tailscale serve 8500`) or a mkcert certificate, then install the app
from the browser (iPhone: Share > Add to Home Screen) and turn on notifications in Channels.

**Telegram.** Create a bot with @BotFather, paste its token in Channels > Telegram, press
"Link my account", and pick which agent answers direct messages. The worker polls Telegram,
so no domain or webhook is needed.

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
| 14 | [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operating it: start, upgrade, backups and restore, secrets, fixes, capacity |
| 15 | [docs/RELIABILITY.md](docs/RELIABILITY.md) | Real-model reliability results, the office scenario, how to re-run |

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
