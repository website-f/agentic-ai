# Plan

## 1. Vision

A workspace where a small team runs a staff of AI agents the way they would run an office:

- Each agent has a **role, a personality (`SOUL.md`), a manager, a budget, tools, and permissions**.
- Agents **remember**: facts about the workspace, about the people they work for, and about past tasks.
- Agents **learn procedures**: after a hard task they write or patch a skill file, which a human approves. The next time, they use the skill and spend fewer tokens.
- People **see the office**: a pixel-art room where every agent sits at a desk, walks to the approval podium when it needs a decision, and walks to the library when it searches memory.
- People **direct from anywhere**: assign, instruct, approve, pause from the web dashboard or the phone PWA. Push notifications for approvals.
- Everything runs **self-hosted** in one optimized Docker stack on the VPS.

## 2. Scope

### In v1

1. AI Engine: provider keys, test connection, model discovery, routing groups, fallback, usage and cost.
2. Agent runtime: agent definitions, chat, tasks, delegation, task board, approvals, schedules.
3. Second brain: facts, Obsidian-compatible vault, hybrid search, capped core memory, session recall, nightly dream job.
4. Self-improving skills: auto-proposed skills, review queue, curator, evals.
5. Pixel office: live view, interactions, mobile controls.
6. PWA: installable, push, approve from notification. Telegram channel with approval buttons.
7. Governance: org chart, budgets with auto-pause, activity and audit log.
8. Ops: one compose stack, backups, observability profile.
9. Organization: branches (one per company) with departments inside; agents are created by hand and placed into a department; SOPs attach at branch, department or agent level and load into the agent's prompt.
10. Broadcasts: send a message to everyone, to chosen branches or departments, or to picked agents, with delivery and acknowledgement tracking.
11. Meetings: bounded agent-to-agent discussions that end in a structured decision summary, watchable live.

### Out of v1 (later)

- Native app via Capacitor (only if iOS push limits hurt).
- Third-party skill marketplace (security risk, see SECURITY.md).
- WhatsApp channel (official Cloud API only, later).
- Distillation / fine-tuning small models from logs (needs data first).
- Arbitrary shell or code execution tools (needs the sandbox service, phase 7+).
- Browser-automation tools (Playwright) for the Data department's Automator agent: ship after the sandbox service exists, gated by approvals and an owner-controlled site policy.
- Local models via Ollama (kept as an optional profile; not part of the default plan).

## 3. Principles

1. **Deterministic policy is the floor.** The LLM never decides alone whether a risky action is allowed. A hardline blocklist and per-agent tool allowlists apply in every mode.
2. **One source of truth per concern.** Temporal owns durability and schedules. Postgres owns state. The vault owns human-readable knowledge. Agno owns the agent loop.
3. **Port patterns, pin dependencies.** We copy ideas from fast-moving projects (Hermes, OpenClaw) instead of forking them. Every library and image is pinned.
4. **Cheap by default.** Prompt-cache-friendly prompts, small models first, local embeddings, batch jobs at night. Every token is logged.
5. **Humans can read everything the agents know.** Memory is markdown plus rows, never hidden state.
6. **Mobile is a first-class client.** Every action that matters works one-handed on a phone.
7. **Local first, free only.** The whole stack runs on one dev PC with Docker; a public deployment is an optional later step. Nothing in v1 requires buying anything: CC0 art, local backups, the AI keys the user already has.

## 4. Roadmap

Durations assume one developer working with Claude Code. Each phase ends with a deployable stack.

| Phase | Weeks | Delivers | Exit criteria |
|---|---|---|---|
| **P0 Foundations** (done 2026-10-01) | 1 | Monorepo, compose `core` profile, Postgres + pgvector, Valkey, Temporal, auth (owner/admin/operator/approver/viewer), workspace, design tokens, app shell (sidebar desktop, tab bar mobile), CI lint + typecheck + tests | `docker compose up` healthy on a clean machine in under 3 min; login works on phone and desktop |
| **P1 AI Engine** (done 2026-10-01) | 1 | Provider CRUD, 6 presets, encrypted keys, 3-step test connection, model discovery, model groups with fallback, cooldowns, token + cost logging, usage charts, scheduled health checks | All 6 providers pass test with real keys; killing one provider mid-run falls back automatically; usage page shows tokens per provider/agent/day |
| **P2 Agent runtime core** (done 2026-10-01) | 2.5 | Branches and departments, agent builder wizard (placement, identity, soul, skills, SOPs, model, tools, budget), SOP layering into prompts, agent chat, `AgentTaskWorkflow` on Temporal, task board, broadcasts with receipts, approvals with hardline policy, SSE event stream, activity log | Task survives an API restart mid-run; an approval waits 24 h and resumes; blocked tool never runs even in "auto" mode; a broadcast to one department reaches exactly that department's agents |
| **P3 Second brain** | 2 | Mem0 facts on pgvector, git vault in wiki layout, hybrid search (BM25 + vector + link graph, RRF), capped core memory with frozen snapshot, session recall, Brain UI with graph view, nightly dream workflow + diary review | Agent recalls a fact from 2 weeks earlier without it in context; vault opens in Obsidian with working links; dream diary lists merges and contradictions |
| **P4 Self-improving skills** | 1.5 | `SKILL.md` store, progressive disclosure loader, `skill_manage` proposals, review queue with diff, curator, eval harness, skill usage stats | Agent proposes a skill after a multi-step task; approved skill is used next time and the task costs fewer tokens (measured) |
| **P5 Pixel office** | 2 | Phaser 4 + Tiled office, rooms per role, sprite state machine, pathfinding, tap-to-inspect sheet, drag-task-onto-agent, pinch-zoom, list-view fallback | 10 agents animate at 60 fps desktop / 30 fps mid-range phone; every agent state maps to a visible behaviour |
| **P6 PWA + channels** | 1 | Installable PWA, VAPID push, approve-from-notification (Android actions, iOS deep link), badge count, Telegram bot with inline approve/deny | Approve a pending action from a locked Android phone and from an iPhone home-screen app |
| **P7 Teams + governance** | 2 | Delegation trees (depth cap, leaf/orchestrator, output schema), meetings (bounded agent-to-agent discussions with decision summaries), org chart editor, budgets with auto-pause, heartbeats, cron ledger UI, bindings (channel to agent routing), OpenAI-compatible agent API | Orchestrator splits a task to 3 children in parallel and merges validated outputs; two agents hold a meeting and post one decision summary to the task; an agent over budget pauses and asks |
| **P8 Hardening + deploy** | 1 | `obs` profile (Langfuse), backups (restic to a local repo by default, any S3 target optional), security review, load test, optional VPS deploy behind `/opt/reverse-proxy`, runbook | Restore from backup on a fresh machine works; security checklist in SECURITY.md all green |

**Total: about 14 weeks.** P1 comes before P2 because every agent depends on the gateway, and most of it is a port from CrawlOps. Everything through P7 runs entirely on the local dev PC.

## 5. Milestone demos

- **End of P2:** "Ask the Researcher on your phone, watch the task run, approve one step."
- **End of P4:** "The agent wrote its own skill, you approved it, the second run was cheaper."
- **End of P6:** "The office on your phone, push notification, approve from the lock screen."
- **End of P7:** "Broadcast a note to the Finance department, then watch Research and Finance hold a meeting and bring you one recommendation."

## 6. Open decisions (need the user)

Resolved 2026-10-01 by the user: **local first** (no domain for now), **no Ollama** in the default plan, **nothing paid** (CC0 art, local backups), providers = the existing API keys, with optional Hermes-style subscription sign-in.

| # | Decision | Default if no answer |
|---|---|---|
| 1 | First chat channel | Telegram |
| 2 | Private GitHub repo name | `seancreative/agentic-ai` |
| 3 | Default departments for a new branch | Management, Finance, Research, Operations, Data, Writing |
| 4 | Turn on subscription sign-in (use an existing ChatGPT plan instead of API keys, like Hermes) | Off; experimental provider type, see AI-ENGINE.md |
| 5 | Add Anthropic / Gemini keys later for explicit prompt caching | Presets exist, disabled |
