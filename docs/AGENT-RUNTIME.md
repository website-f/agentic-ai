# Agent runtime

## 1. What an agent is

An agent is a row in `agents` plus files in the vault. At run time the worker builds an Agno `Agent` from it.

| Part | Stored as | Notes |
|---|---|---|
| Identity | `agents.name`, `role`, `avatar_sprite`, `desk_id` | Shown in the office and roster |
| Placement | `branch_id`, `department_id` | One branch per company; the department decides the agent's room, default SOPs and manager |
| Personality | `SOUL.md` (vault: `agents/<slug>/SOUL.md`) | Tone, values, how it reports. Copied idea from Hermes + OpenClaw |
| Operating rules | workspace `AGENTS.md` + branch SOPs + department SOPs + optional per-agent SOPs | Layered, stable, sits in the cached prompt prefix |
| Core memory | `MEMORY.md` (cap 2,200 chars) and `USER.md` (cap 1,400 chars) per agent | Hermes caps. Write fails when full, so the agent must consolidate |
| Model | `model_group` (e.g. `smart`, `fast`, `bulk`) | Resolved by the AI Engine with fallback |
| Tools | `tools[]` with per-tool mode `allow` / `ask` / `deny` | Policy engine enforces |
| Manager | `reports_to` agent id | Org chart, escalation path (Paperclip) |
| Budget | `budget_monthly_usd`, `budget_daily_tokens` | Auto-pause at 100 %, alert at 80 % (Paperclip) |
| Heartbeat | `heartbeat_cron` (optional) | Wakes the agent to check its queue (Paperclip / OpenClaw) |
| Profile flags | `can_delegate`, `max_spawn_depth`, `role_kind: leaf\|orchestrator` | Hermes delegation |

**Prompt assembly (cache-friendly order):**
`AGENTS.md` -> branch + department SOPs -> `SOUL.md` -> tool schemas -> skill index (names + one-line descriptions only) -> frozen `MEMORY.md` / `USER.md` snapshot -> recalled context -> conversation.
Everything above "recalled context" is stable within a session, so provider prompt caching hits.

## 2. Organization: branches, departments, SOPs

The user runs many companies, so the org model mirrors a real office group:

```
Workspace
  Branch "Company A"          Branch "Company B"       ...
    Management                  Management
    Finance                     Research
    Research                    Data
    Operations / Data / Writing ...
```

- A **branch** is one company: its own office map, its own vault section, its own agents.
- A **department** belongs to a branch and holds agents, an optional manager agent, a room in the office, and its own SOPs. Departments can be added freely (default set: Management, Finance, Research, Operations, Data, Writing).
- **Org chart:** agents report to their department manager; department managers report to the branch's Office Manager; every branch reports to the humans. Escalations walk up this chain.
- **SOPs are vault pages** (`branches/<branch>/sop/*.md`, `departments/<dept>/SOP.md`, or per-agent). They are versioned in git, edited in the Brain page, injection-scanned on save, and loaded into the prompt of every agent they apply to. Example: the Finance department carries the company's accounting SOP and approval workflow, so every Finance agent follows it without being told each time.
- **Isolation:** a branch can be marked isolated, and then its agents only see that branch's vault pages and facts (visibility filtered in SQL, never by the LLM).

## 3. Creating an agent by hand

Agents > New agent opens a wizard:

1. **Placement** — pick branch and department; a desk in that room is auto-assigned.
2. **Identity** — name, role title, avatar sprite.
3. **Soul** — personality from a role template or written free-form (`SOUL.md`).
4. **Skills and SOPs** — attach skills from the library (e.g. an "advanced accounting" skill pack for a Finance agent) and tick the SOPs that apply. Skills are living documents: the agent proposes upgrades to them after hard tasks (see [SKILLS-SELF-IMPROVEMENT.md](SKILLS-SELF-IMPROVEMENT.md)), so an accountant's skills version up over time with the user's approval.
5. **Operations** — model group, tool permissions (defaults from the role template), budget, heartbeat.

A review screen shows the assembled prompt preview and an estimated cost per task. On creation the agent walks to its desk in the office, introduces itself in chat, and asks for its first assignment.

**Asking for work:** an idle agent with a heartbeat checks its queue; if the queue is empty it messages its manager, and the top of the chain messages the owner ("Nothing in my queue. What should I pick up, boss?"). The frequency is configurable per agent (default: at most once per workday) so this never becomes spam.

## 4. Department templates (seeded, all editable)

| Department | Template agent | Kind | Model group | Typical tools |
|---|---|---|---|---|
| Management | Office Manager | orchestrator | smart | tasks.delegate, tasks.*, notify, brain.search |
| Management | Reviewer | leaf | smart | read-only on everything, approvals.comment |
| Finance | Accountant | leaf | smart | files.read, calc, brain.* (+ accounting skill pack) |
| Research | Researcher | leaf | smart | web.search, web.fetch, brain.* |
| Research | Analyst | leaf | smart | files.read, brain.*, calc |
| Operations | Ops | leaf | fast | schedules.*, ai_engine.health, notify |
| Data | Crawler | leaf | fast | web.search, web.fetch, brain.write |
| Data | Automator | leaf | smart | browser.* (later phase, sandboxed, approval-gated) |
| Writing | Writer | leaf | smart | brain.*, files.write |

Crawler and Automator are built to work together through delegation: Crawler gathers and structures, Automator acts on the result, with approvals on anything risky.

## 5. Tasks and the board (Hermes Kanban model)

`triage -> ready -> running -> blocked | review -> done | failed | cancelled`

- Each task is a row, each running task has a Temporal workflow id.
- Humans can **block / unblock**, reassign, reprioritize from the board or by dragging a task card onto an agent in the office.
- `review` means a human or the Reviewer agent must accept the result.
- Every transition is an event (SSE) and an activity-log line.

## 6. Delegation (Hermes `delegate_task`)

- An orchestrator spawns up to `max_parallel_children` (default 5, hard max 10) child tasks.
- Depth capped by `max_spawn_depth` (default 2). Leaf agents cannot delegate.
- Each child gets an `output_schema` (JSON Schema). Output is validated; on failure the child gets **one** correction turn, then the task fails visibly.
- Children run as Temporal child workflows, so the parent survives restarts and can wait on all of them.
- Sequential "work together" flows (one agent's output feeds the next: Crawler -> Analyst -> Writer) are delegation chains with output schemas.

## 7. Meetings: agents discussing with each other

Like a researcher walking over to accounting before a decision. Any agent working a task can call `agents.consult` to open a **meeting** with one or more other agents.

- **Bounded by design:** max 5 participants, max rounds (default 6), a per-meeting token budget, no nested meetings, and the only tool allowed during a meeting is `brain.search`.
- The initiator states the question. Participants answer in turns, each with its own soul, SOPs and memory, so the Finance agent genuinely argues from the accounting SOP while Research argues from its findings.
- The initiator closes with a **structured outcome**: decision, options considered, dissent, who does what. The outcome posts back to the originating task and is saved as a vault decision page; the full transcript is kept.
- **Humans can watch live** in the Meetings page (and see the characters sitting in the office meeting room) and interject; an interjection becomes the next turn.
- A meeting can never approve anything by itself. If the decision involves money or an `ask`-gated tool, the normal approval flow still fires afterwards.
- Cross-department and cross-branch consults are allowed unless a branch is isolated.

## 8. Broadcasts

The megaphone: message **everyone**, chosen **branches**, chosen **departments**, or picked **agents**.

- Two modes: **announcement** (no reply expected; each target stores it as context and acknowledges) and **directive** (each target turns it into a task proposal in its triage column).
- **Receipts** per agent: delivered, acknowledged, replied, shown on the broadcast's detail view.
- Broadcast text enters each agent's context as an owner message (never as system text) and passes the same injection scan as any other input.
- Who can send: owner, admin, operator. Events: `broadcast.sent`, `broadcast.ack`.

## 9. Approvals and policy (OpenClaw UX + Hermes floor)

Evaluation order for every tool call:

1. **Hardline blocklist** (cannot be overridden by any mode, including "auto"). Examples: reading secrets, writing outside allowed paths, private-network URLs, disabling policy, creating schedules from inside a scheduled run.
2. **Agent tool mode**: `deny` / `ask` / `allow`.
3. **Risk rules** (deterministic): money, external messages, deletes, bulk writes are `ask` unless explicitly allowed.
4. **Smart review** (optional): an auxiliary cheap model scores risk and can only *escalate* `allow` to `ask`, never relax.

Approval card (dashboard, phone push, Telegram): what, why, arguments preview, risk, policy rule that triggered it. Buttons: **Approve once**, **Always allow for this agent**, **Deny**. `ask_fallback` when nobody answers within the timeout: `deny` (default) or `escalate to manager`.

## 10. Scheduling (Hermes cron ledger on Temporal Schedules)

- Schedules are Temporal Schedules; our `schedules` table mirrors them for the UI.
- Every run writes a `job_executions` row: `claimed -> running -> completed | failed | unknown`.
- Transient failures retry at 5, 15, 30 minutes, then mark failed and alert.
- Failures are grouped by an **incident signature** (error class + agent + tool) so 50 identical failures create one alert.
- Output is passed through secret redaction before delivery.
- An agent running inside a scheduled job **cannot create new schedules** (no recursion).

## 11. Channels and bindings (OpenClaw bindings)

- A **binding** maps a channel account or peer to an agent: `telegram:@ops_group -> Ops`, `telegram:dm:<user> -> Office Manager`. Most specific match wins.
- Outbound messages go through a **delivery ledger** (Hermes) so a reply is never lost or sent twice.
- **OpenAI-compatible API**: `POST /api/v1/chat/completions` with `model: "agent/<slug>"` so any OpenAI client (Open WebUI, scripts, IDE plugins) can talk to an agent. Scoped API tokens only.

## 12. Everything copied from Hermes Agent and OpenClaw

| Element | Source | Where it lands | Phase |
|---|---|---|---|
| `SOUL.md` personality | Hermes, OpenClaw | agent definition | P2 |
| Layered context files (workspace / agent) | OpenClaw workspace files | `AGENTS.md` + branch/department SOP layering | P2 |
| Profiles (isolated identity, own model, own permissions) | Hermes | `agents` row | P2 |
| Capped `MEMORY.md` / `USER.md`, write errors when full | Hermes | brain | P3 |
| Frozen memory snapshot at session start (keeps prompt cache) | Hermes | prompt assembly | P3 |
| Session recall: full-text search over past sessions + LLM summary | Hermes (FTS5) | Postgres FTS on `messages` | P3 |
| Memory flush turn before context compaction | OpenClaw | agent loop hook | P3 |
| "Dreaming": score recall signals, promote above threshold, `DREAMS.md` diary for review | OpenClaw | dream workflow | P3 |
| Hybrid memory search (vector + keyword) | OpenClaw, GBrain | brain index | P3 |
| `skill_manage`: agent creates / patches skills after complex tasks | Hermes | skills | P4 |
| Staged skill writes (`write_approval`) | Hermes | review queue | P4 |
| Skill curator (consolidate overlaps) | Hermes | nightly workflow | P4 |
| `SKILL.md` standard with progressive disclosure | Hermes (agentskills.io) | skills loader | P4 |
| Trace-driven skill evolution via DSPy + GEPA, changes reviewed | Hermes self-evolution | weekly workflow | P4+ |
| Skill trust tiers (builtin / official / trusted / community) + mandatory scan | Hermes | skills | P4 |
| `delegate_task` with parallel children, depth cap, leaf vs orchestrator, output schema + one correction turn | Hermes | delegation | P7 |
| Governed agent-to-agent sessions (spawn allowlists, coordinator pattern) | OpenClaw `sessions_spawn` | meetings | P7 |
| Kanban board, task claimed by profile, human block / unblock | Hermes | tasks | P2 |
| Cron ledger, retry ladder 5/15/30, incident de-dup, secret redaction, no recursive cron | Hermes | schedules | P7 |
| Smart approvals + hardline blocklist that no mode overrides | Hermes | policy engine | P2 |
| Approval modes deny / allowlist / full, ask off / on-miss / always, `ask_fallback` | OpenClaw | policy engine | P2 |
| Approval cards in UI and chat with approve-once / always | OpenClaw | approvals UI, Telegram | P2, P6 |
| Bindings: channel/peer to agent routing, most specific wins | OpenClaw | channels | P7 |
| Durable delivery ledger for outbound messages | Hermes | channels | P6 |
| OpenAI-compatible endpoint exposing agents as models | OpenClaw, Hermes | api | P7 |
| Heartbeat wake-ups and condition watchers | OpenClaw | schedules | P7 |
| Per-session `/model` switch | Hermes | chat UI | P2 |
| Subscription sign-in instead of API keys (optional) | Hermes | AI Engine | P1+ (off by default) |
| Prompt-injection scanner on context files, SSRF block, protected write paths, MCP env scrubbing | Hermes | policy + tools | P2-P3 |
| OTel GenAI semantic-convention traces | OpenClaw | observability | P8 |
| "Trusted gateway, untrusted execution, deterministic policy" principle | OpenClaw | architecture | all |

## 13. What we deliberately do **not** copy

- An open skill marketplace (ClawHub was poisoned with 1,000+ malicious skills in 2026).
- Sandbox off by default, single owner token, control plane on the public internet.
- LLM-judged approvals as the only gate.
- Self-modification without evals and human review.
- Unbounded agent-to-agent chatter (every meeting has participants, round and token caps).

## 14. As built in P2 (2026-10-01)

What shipped differs from the plan in one place: the agent loop is our own, not Agno.
Each loop step is a Temporal activity and all state lives in Postgres, so a step that
dies is simply retried from the last committed message. Agno's own session store would
have been a second source of truth next to that.

| Piece | Where |
|---|---|
| Tools (calc, web_fetch, ask_human, report_progress), risk levels, global deny list | `apps/api/agentic/agents/tools.py` |
| Policy floor: hardline, then the agent's allow/ask/deny, then autonomy | `agents/policy.py` |
| Prompt layering: rules, SOPs (each in a `<sop>` tag), identity, tools, announcements | `agents/prompt.py` |
| Loop step, approvals, chat turns, task status and timeline | `agents/runtime.py` |
| `AgentTaskWorkflow` (approval signal, 24 h wait, cancel) and `BroadcastRepliesWorkflow` | `workflows/agent_workflows.py` |
| Routes: agents, sops, tasks, approvals, broadcasts, `/api/events` (SSE with replay) | `api/routers/` |

Limits: 6 tool calls per step, 30 per task, approvals expire after 24 h. Fetched web
content is fenced as untrusted text before the model sees it. Internal and metadata
addresses are blocked by the hardline even when the agent runs on auto.

Verified: 53 API tests, plus an end-to-end run on the full stack where a task waiting
for approval kept waiting across an api and worker restart and finished after approval.

