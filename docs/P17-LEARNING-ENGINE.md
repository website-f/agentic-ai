# P17: The learning engine (2026-10-04)

P17 makes self-learning more dependable than Hermes Agent's. Hermes writes skills directly from a background review of its own sessions, and nothing measures those skills. Here every change is tested before it goes live. Learning also covers more ground: failures, denials, chat on every channel, repairs of skills that keep failing, and written sources. Everything is shown on one page, and any change can be rolled back.

## 1. Where agents learn from

| Signal | What it produces | Where |
|---|---|---|
| A finished task with many tool calls, a send-back, "remember how to do this", or a check every 8 tasks | A skill proposal (new skill or patch) | `skills/reflect.py` `_trigger`, run by the `skill_reflect` activity |
| **A failed task** (new). Skipped when nothing was tried (fewer than 2 tool calls) or the failure was outside the agent's control: timeouts, rate limits, cooldowns, budget, cancels, provider outages | A lesson written into the skill that governs the work. Facts from the run go to memory too | `reflect.TRANSIENT`, `workflows/agent_workflows.py` (patch `learn-failed-v1`), `brain/learn.py` |
| **A correction in chat** (new): "no, …", "always …", "don't …", "salah/jangan/lain kali …", "remember how to do this", or a check every 8 messages when tools were used | A skill proposal from the conversation | `reflect.chat_trigger`, `reflect_on_chat`, `LearnFromChatWorkflow` (patch `chat-skill-v1`) |
| **Chat on Telegram and WhatsApp** (new; before, only dashboard chat learned) | Facts and skills, as above | `channels/bot.py`, `channels/wa_bot.py` → `deliver.learn_from_chat` |
| **A denied approval with a reason** (new) | A private fact for that agent: `Owner denied "Read a web page" on the task "…": use the price list in Files` | `runtime._learn_denial` |
| A rejected skill proposal with a reason | A private fact (unchanged since P4) | `skills/store.reject` |
| **A skill accepted less than 70% of the time** over its current version's last 20 judged uses (new) | A repair proposal, drafted from the feedback, errors and answers of the work that was sent back or failed. At most 2 per night; each skill waits 7 days between repairs | `skills/curator.py` `_repair` |
| **A source** (new): a web page, an uploaded file or pasted notes, plus a focus | A skill proposal | `skills/learn_source.py`, `POST /api/learning/learn-source` |

Drafts are written by the `smart` group first, with a JSON check (`accept=`) so a garbled reply falls through to the next model. The draft prompt says "lessons, not logs". It also says to capture only general rules from failures, never one-off outages, and to fix wrong text in place instead of appending.

## 2. The autopilot (`skills/autopilot.py`)

Each workspace chooses a mode on the Learning page (`Workspace.settings.skill_learning.mode`):

| Mode | What goes live without a person |
|---|---|
| `review` | Nothing. Every change waits, as before P17 |
| `auto_safe` (default) | A change whose evals show it is **no worse than the live version**. A brand-new skill needs **at least 60% of its own cases** to pass |
| `auto` | Also clean changes that have no test cases |

Some changes always wait for a person:
- retiring a skill;
- anything the safety scan warns about;
- a patch that does worse than the live version;
- a change where neither version passes any case.

A draft the scan *blocks* (because it contains a secret or an injection) is now refused outright and never stored. The agent is told why, so it can try again.

Every automatic approval:
- is versioned;
- is mirrored to the vault (`skills/<name>/SKILL.md`);
- is written to the audit log as `skill.auto_approved`;
- is announced as `skill.updated` (auto=true);
- notes its reason on the proposal ("Approved automatically: passes 3/3 cases (current version 2/3).").

**Restore** (`POST /api/skills/{id}/revert {version}`) puts an older version back as a new version, so history is never lost.

The nightly dream's curator now ends with `autopilot.tidy`, which does three things:
- closes blocked drafts and redacts their body;
- closes drafts nobody reviewed for 14 days;
- runs evals on drafts that were never tested, then lets the autopilot decide.

## 3. Evals that match real use (`skills/evals.py`)

Before P17, an eval was a single text reply with no tools, so a skill that says "use calc, then write_page" was judged on prose alone. Now:

- The tools a skill names are offered as **stubs**. Nothing runs; each call is answered with "[evaluation stub] … continue". This repeats for up to 3 rounds, and the last round offers no tools so the model has to answer.
- New check `must_call: ["calc"]`: the case fails if the tool was not used.
- **A refusal fails a case**: "I'm sorry, I can't…" never passes a case that has no `must_contain`. A case can opt out with `allow_refusal`.
- Leaked tool markup (DeepSeek's DSML, raw `<tool_call>` tags) is stripped before checking.

## 4. Seeing it: the Learning page (`/learning`)

`GET /api/learning/overview?days=` shows:
- **Proposals**: created, auto-approved vs approved by a person, waiting, and the test pass rate.
- **Skills**: active skills and new versions.
- **Skill success rate**, against the previous period.
- **Facts learned**, by source, and how many facts were replaced.
- **Learning spend**: calls, tokens and cost of `skill.*`, `brain.*` and `colleague.memory`.
- **Activity**: a daily series, the latest decisions with who made them and why, and the top skills.

`PUT /api/learning/settings {mode}` is limited to owners and admins and is audited.

**Training data:** `GET /api/learning/trajectories.jsonl?days=&outcome=accepted|all` (owner/admin, audited) exports finished tasks as ShareGPT-style JSONL:
- tool calls appear as `<tool_call>[…]</tool_call>`;
- secrets are redacted;
- **private assistants are never exported**.

Use it for fine-tuning or for offline evals. This is the counterpart of Hermes' trajectory saving.

## 5. Other reliability changes in P17

- **Context window.** Compaction limits now follow the smallest known context window in the agent's model group (`agents/context.py` `limits_for`). The history may use 45% of the window. Before this, a 16k model could be sent a 24k history.
- **Goal judge.** It grades with a different group from the worker's (`goals.judge_groups`): `smart` work is judged by `fast`, and the other way round. If no judge can answer, the task goes to **review** instead of passing silently.
- **The tiny local model** (`local` provider) is never used for skills, facts or judgements when reached through another group (`gateway.TINY_TASKS`).
- **Approvals.** `browser_submit` always asks a person (`policy.ALWAYS_ASK`). "Always allow" from an approval card never un-gates a high-risk tool.
- **Skill outcomes.** A task sent back and then accepted settles its skill use as accepted (`store.settle`).
- **LLM reliability** (see RELIABILITY.md):
  - thinking models get a token budget large enough to finish their JSON, and low reasoning effort for background JSON;
  - cut-off JSON is retried on the next model;
  - errors are stored in `llm_calls.error_detail` (migration 0017);
  - the health check includes a JSON probe;
  - a private assistant's facts always stay private.

## 6. Hermes Agent vs this platform (self-learning)

| | Hermes Agent | Here (after P17) |
|---|---|---|
| Skill creation | Background review writes skills directly | Reflection on tasks, failures, chat corrections, sources. Proposals are **tested** and go live by evidence or by a person |
| Measuring a skill | None | Evals old vs new with stub tools; success rate per version from real outcomes |
| Fixing a bad skill | Only if a later session happens to notice | Nightly repair from the actual send-backs and errors, tested before it goes live |
| Rollback | Edit the file | One-click restore to any version, audited |
| Memory | MEMORY.md / USER.md, session search | Facts with reconcile (replace, confirm, expire), private vs shared scope, nightly dream, wiki pages, core memory |
| Learning from people | Corrections in the session | Send-backs, chat corrections on every channel, denied approvals, rejected proposals |
| Multi-agent | One agent | Shared skills across agents, ask-a-colleague lessons, per-branch scope |
| Trajectories | Saved for training | JSONL export (redacted, private agents excluded) |
| Safety | Skills run as written | Scan blocks secrets and injections; autopilot never approves warnings or retirements; audit trail |

## 7. Files

- **New:**
  - `skills/autopilot.py`
  - `skills/learn_source.py`
  - `api/routers/learning.py`
  - `tests/test_learning_engine.py` (18 tests)
- **Changed:**
  - skills: `skills/reflect.py`, `skills/curator.py`, `skills/evals.py`, `skills/store.py`
  - workflows: `workflows/agent_workflows.py`, `workflows/brain_workflows.py`, `workflows/skill_activities.py`, `workflows/worker.py`
  - agents: `agents/runtime.py`, `agents/context.py`, `agents/goals.py`, `agents/policy.py`, `agents/tools.py`
  - other: `brain/learn.py`, `channels/bot.py`, `channels/wa_bot.py`, `channels/deliver.py`, `engine/gateway.py`, `api/main.py`
- **Workflow patches** (safe for runs already in flight): `learn-failed-v1`, `chat-skill-v1`.
