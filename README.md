# Agentic-AI

Self-hosted multi-agent platform. Persistent role-based AI agents (Office Manager, Researcher,
Analyst, Finance, Data Entry, Writer, Reviewer, Ops) that remember, write their own skills,
and get better over time. You watch and direct them in a pixel-art office on the web dashboard
or from your phone (installable PWA).

**Status:** P0 to P28 done (2026-10-06). Live in production at **https://agent.oriondesk.space** (a VPS behind its own reverse proxy, deployed with `deploy/scripts/deploy-vps.sh`; docs/DOCKER-AND-DEPLOY.md section 10). P0 to P8 were the original roadmap (foundations, AI engine, agent runtime, brain, skills, pixel office, channels, teams and governance, hardening); everything after grew from using it.
- P0: monorepo, Docker stack, sign-in with 5 roles, branches and departments, members, tamper-evident activity log, responsive PWA shell.
- P1: provider keys (envelope-encrypted), 3-step streamed connection test, model discovery and pricing, model groups with fallback and cooldowns, playground, usage and cost, 30-minute scheduled health checks.
- P2: SOPs (workspace/branch/department/library) layered into prompts, 6-step agent builder with templates, per-agent tool permissions, agent chat, durable tasks on Temporal (survive restarts, approvals wait 24 h), Kanban board, approvals and questions with a hardline policy floor, broadcasts with receipts and replies, live updates over SSE.

- P3: the Brain. Facts learned after every task and chat (extract, then reconcile; replaced facts are kept, never deleted), capped core memory per agent with a frozen snapshot, wiki pages in a git vault that opens in Obsidian, hybrid search (keywords + local multilingual embeddings + wikilinks, RRF), automatic recall at the start of each task and chat turn, a nightly dream that merges duplicates and settles contradictions with an undoable diary, company isolation.

- P4: Skills. Agents see a short index of proven procedures and load one only when a task matches (`SKILL.md` convention). After long or corrected work they draft a skill or an improvement; a safety scan and old-vs-new tests run before a person reviews a side-by-side diff and approves, edits or rejects (the agent remembers why). Every approval is a version and a git commit. Usage, acceptance rate and tokens saved are measured per skill; a nightly curator proposes merges and retirements.

- P5: the Pixel office. One live office per company, generated from its departments (a desk per agent) plus a library, workshop with bug corner, breakroom, meeting room and approval podium. Agents walk there because of real events: at the desk while working ("..." while the model thinks), to the podium when they need you, to the library when they search memory, to the workshop when they write a skill, to the bug corner on errors, to the breakroom when idle. Tap an agent for its panel (approve right there, ask it something, pause it); drag a task card onto an agent to assign it. Day and night themes, pinch and wheel zoom in whole steps, a list view with the same data.

- P6: Channels. Phone and desktop notifications (Web Push, our own VAPID keys) with Approve / Deny buttons that work from the lock screen on Android (single-use 10-minute tokens), a one-screen approve page for iPhone, the app-icon badge, an installable PWA. A Telegram bot (long polling, no public URL) with inline approve/deny, answers by replying, and chats routed to the agent bound to that chat; only linked people are served. A delivery ledger so nothing is lost or sent twice. Scoped API tokens and an OpenAI-compatible endpoint (`/api/v1/chat/completions`, `model: "agent/<name>"`).

- P7: Teams and governance. Agents marked Leads split a task into up to 10 parallel sub-tasks for other agents (depth cap of 1 to 3 levels), optionally with a JSON Schema the answer must match (one correction turn, then the sub-task fails), and merge the answers. Meetings: 2 to 5 agents discuss for a few rounds (only memory search allowed, a token cap, early stop when nobody adds anything, people can interject) and the chair writes one decision summary (decision, why, options, dissent, next steps) that lands on the task and in the brain as a decision page; meetings only recommend. A drag-and-drop org chart. Budgets per agent (tokens per day, dollars per month): an alert at 80 %, and at 100 % the agent pauses and asks; approving allows half the limit again. Heartbeats: hourly during work hours an agent picks up its queued work or asks for some, once a day. Schedules on Temporal (cron + time zone) with a run ledger, retries at 5/15/30 minutes, and failures grouped into incidents.

- P8: Hardening. Nightly encrypted backups (restic, a local folder by default, any S3/B2 target optional) with a tested restore onto a fresh stack. A security review with a test for every checklist item; it fixed DNS-rebinding in the URL guard, fence break-outs in untrusted text, prompt injection into agent memory and a database-pool exhaustion from open browser tabs. Our containers non-root with all capabilities dropped (ollama and WAHA, added later, run as root without capabilities); production refuses to start on unsafe settings; zero critical vulnerabilities in our images (Trivy). A load test (50 dashboard users, 200 live streams, 30 parallel agent tasks: p95 203 ms, no errors). Optional Langfuse traces of every model call (`COMPOSE_PROFILES=obs`). A VPS override for the server's reverse proxy (deployed since 2026-10-04). Operations: docs/RUNBOOK.md.

- After P8 (2026-10-02): live **Monitor** (pick an agent, or "Watch live" in the office: its thinking, every tool and result, tokens and cost per step, and its browser screen with the click marker); a real browser for agents (**Camoufox**, isolated, every form submit approved by a person, forms filled in one step); **colleagues helping colleagues** (`ask_colleague`, memory checked first by the local model, answers saved for next time; `find_sop`); the local model as the office's free **backup brain** for memory, page digests and housekeeping. Measured with real models: docs/RELIABILITY.md.

- P9 (2026-10-02): **office roles** (branch manager, head of department, supervisor, staff with personal agents), each seeing and deciding only their own area; **saved logins** agents use without ever seeing them; **helpers** (an agent duplicates itself to split a big job); questions with answer buttons; **reports** with tables; the **company overview** of every branch with an AI briefing; the monitor **wall** of everyone at work. Tested live on a practice supplier portal (docs/RELIABILITY.md).

- P10: **Document Studio**: company kit, files read once (OCR), templates, AI-drafted and checked documents, PDF/Word/Excel export, submission packs (docs/DOCUMENT-STUDIO.md).
- P11: **workflow runs**: a job carried through a workflow graph step by step, with reviews, decisions and hand-offs to people.
- P12: upgrades from Hermes Agent: a context window for long runs (old tool results pruned and summarised), sharper skill reflection.
- P13: from Hermes Agent: untrusted-content scanner, goal loop, web search, vision, MCP client, and the isolated **code sandbox** (`run_python`) (docs/P13-HERMES-FEATURES.md).
- P14: agents ask colleagues when stuck and the fix is saved as a lesson; the whole office on a 4 GB server (docs/P14-AGENTS-HELP-EACH-OTHER.md, docs/SMALL-SERVER.md).
- P15: the **workflow editor**: draw, AI-draft or template a job, then run it (docs/P15-WORKFLOW-EDITOR.md).
- P16: **personal assistants** with Gmail and WhatsApp (WAHA), private to their owner (docs/P16-ASSISTANTS-GMAIL-WHATSAPP.md).
- P17: the **learning engine**: lessons from failures, corrections and every chat channel, each change tested before it goes live (docs/P17-LEARNING-ENGINE.md).
- P18: knowledge library (RAG), AI twins, voice notes, images, Google Calendar, schedules from chat, skill optimizer (docs/P18-*.md).
- P19: companies with ready-made industry AI teams, finance tools, impact page, tutorial, staff onboarding, work hours, self-check before hand-in.
- P20: in-app User Guide with annotated screenshots and videos, client presentation, help on every page.
- P21 (commit "Phase 1"): n8n-style canvases, native kanban drag, full-screen assistant chat, all-companies switcher, meeting minutes.
- P22 (commit "Phase 2 + 3"): task dependencies, liveness watchdog, review stages, objectives, cleaner web/browser reading, token savings, Bahasa Melayu everywhere.
- P23: server messages in Malay, meeting speakers, Malay schedules, run objectives, the browser locked behind the egress proxy.
- P24: company files that organise themselves, held-back sensitive uploads, AI-built SOPs and workflows from documents.
- P25: full-text search inside every document with page citations; everything AI makes is stored with provenance and reviewable.
- P26: **My workspace**, each person's own desk; agents conclude instead of searching forever; per-company document language.
- P27: company forms with deadlines and AI form filling, member import from Excel, file attachments, simpler navigation.
- P28: tender preparation by agents (ePerolehan), browser downloads and uploads, one file store, gentle browser pacing, egress upstream routing.

Summary of P19 to P28: docs/P19-P28-OVERVIEW.md. Still open: CI (none is set up), TOTP / two-factor sign-in, OIDC.

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
uv run pytest -q                                             # uses DB agentic_test (TEST_DB to change)

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
| 9 | [docs/PIXEL-OFFICE.md](docs/PIXEL-OFFICE.md) | The office (own Canvas 2D engine), rooms, sprite states, interactions, event schema, assets |
| 10 | [docs/FRONTEND.md](docs/FRONTEND.md) | Design system, pages, advanced components, responsive rules, PWA |
| 11 | [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Postgres schema |
| 12 | [docs/DOCKER-AND-DEPLOY.md](docs/DOCKER-AND-DEPLOY.md) | Optimized images, compose profiles, resource budget, ports, VPS deploy, backups |
| 13 | [docs/SECURITY.md](docs/SECURITY.md) | Auth, RBAC, secrets, policy floor, prompt injection, supply chain |
| 14 | [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operating it: start, upgrade, backups and restore, secrets, fixes, capacity |
| 15 | [docs/RELIABILITY.md](docs/RELIABILITY.md) | Real-model reliability results, the office scenario, how to re-run |
| 16 | [docs/P19-P28-OVERVIEW.md](docs/P19-P28-OVERVIEW.md) | What phases P19 to P28 added (P10 to P18 have their own docs) |

## Decisions in one screen

- **Agent loop:** our own (each step a Temporal activity, all state in Postgres); Agno was planned but not used (docs/AGENT-RUNTIME.md section 14).
- **Durability, scheduling, approvals that wait for days:** Temporal (MIT) on the shared Postgres.
- **Governance model (org chart, budgets, heartbeats):** ported from Paperclip (MIT). Not run as a service.
- **Skills that write themselves:** ported from Hermes Agent (MIT): `SKILL.md` format, `skill_manage`, staged writes, curator.
- **Memory:** Mem0 on pgvector for facts + a git markdown vault in Karpathy "LLM wiki" layout that opens in Obsidian + GBrain-style hybrid search + OpenClaw-style nightly "dreaming".
- **AI Engine:** our own gateway, ported from CrawlOps (`CrawlOps/backend/app/services/gateway.py`). Presets for Groq, OpenRouter, HuggingFace, Mistral, DeepSeek, OpenAI. No LiteLLM.
- **Office view:** our own Canvas 2D engine (`apps/web/src/office/`), patterns from `geezerrrr/agent-town` and `pablodelucca/pixel-agents` (both MIT). No Phaser.
- **Organization:** branches (one per company) with departments inside; agents are created by hand and placed into a department with skills and SOPs; broadcasts to all / branch / department / picked agents with receipts; bounded agent-to-agent meetings with decision summaries.
- **Web + phone:** React 19 + Vite + Tailwind v4 + shadcn/ui + Motion, installable PWA with Web Push approvals, role-based login (owner / admin / operator / approver / viewer).
- **Deploy:** local-first on the dev PC (`docker compose up -d --build`, ports **8500-8509**), everything free and open source (CC0 art, local encrypted backups, a small local Ollama model as backup brain); on a VPS behind the host's reverse proxy with `deploy/scripts/deploy-vps.sh`.

## Folder layout

```
Agentic-AI/
  apps/
    web/          React PWA (dashboard; the office engine is in src/office/)
    api/          Python package `agentic` (FastAPI api + Temporal worker)
    browser/      Camoufox service agents drive
    egress/       the browser's only way out (standard-library proxy) + tests
    sandbox/      isolated Python runner for run_python
  deploy/         Dockerfiles, nginx, backup service, deploy scripts, demo/load/eval tools
  docs/           design docs, runbook, security
  docker-compose.yml, docker-compose.vps.yml, docker-compose.small.yml
  THIRD_PARTY_NOTICES.md
```
