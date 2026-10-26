# P36: staff keep to their work, daily AI allowances, one library, routines

Five changes that make the office safe to hand to staff, cheaper to run, and quicker to set up.
Migration `0036_allowances_library_routines`. Tests: `apps/api/tests/test_p36.py`,
`apps/web/src/nav.test.ts`.

## 1. Staff keep to their own work

- New permission **`office.view`**: every role except `staff` (core/security.py). It gates the
  office beyond a person's own work: the command center, the company overview, objectives,
  agents, office floor, monitor, meetings, broadcasts, brain, skills, learning, organization,
  schedules.
- **One guard for the sidebar and every page** (`apps/web/src/nav.ts` `pathAllowed`, used by
  the app route's `beforeLoad` in router.tsx). A page that is not in someone's navigation
  cannot be reached by typing its address. Staff opening `/agents/<id>` land on My AI.
  `/settings/members` is now for people managers only.
- **Staff sidebar:** My workspace, My AI, My computers, Tasks, Forms, Approvals, Mail, Chat,
  Reports, Workflows, Contacts, Deals, Library, Settings (their account), Channels (their
  notifications), Logins (their own), Help.
- **Server-side fixes** (the UI was the only guard before):
  - `POST /api/ai/playground` needs `engine.manage` (it was any `work.write`: raw model access
    with no agent, budget or rules).
  - `GET /api/overview` and `POST /api/overview/summary` need `office.view`; the summary also
    counts against the person's allowance.
  - Shared brain pages (not an agent's own memory) are changed only by people with
    `brain.manage`, `agents.manage` or `team.manage`.
  - **More budget or allowance is a manager's call** (agents/decisions.py `GRANTERS`): a staff
    member can no longer approve extra budget for their own AI twin. Only managers are notified
    (channels/deliver.py `deciders(budget=True)`), and the approval card tells staff a manager
    decides.

## 2. Daily AI allowance per person

- Every model call is logged against the person the work is for: `llm_calls.user_id`, set from
  a context variable (engine/acting.py). It is set by the API for the signed-in person
  (api/deps.py), by the runtime for a task (the person who gave it, or who gave the first task of
  its delegation tree, or who made its schedule: teams/allowance.py `person_of_task`), and for a
  chat (the person talking).
- **Allowance** (teams/allowance.py): workspace setting
  `ai_allowance = {"daily_tokens": 50000, "roles": ["staff"]}`, and a per-person override
  `memberships.ai_daily_tokens` (null = the default for their role, 0 = no limit). Counted per
  local day; background learning (`brain.*`, `skill.*`, `routine.*`) is never charged.
- **When it is used up:**
  - a chat answers with a fixed note (no model call);
  - a task stops with a `budget` approval (`allowance:<day>:<limit>`) that only a manager can
    approve; approving gives half the allowance again for today;
  - voice notes and the overview summary answer 429 `allowance_used`.
- **API** (api/routers/allowances.py):
  - `GET /api/me/allowance`
  - `GET /api/allowances` (people managers, in their scope)
  - `PUT /api/allowances/policy` (owner/admin)
  - `PUT /api/allowances/{user_id}` (people managers; nobody but an owner/admin changes their
    own)
- **UI:** Setup > AI use and limits (`/settings/ai-use`); a meter on My workspace and My AI.

## 3. Work-scope guard

agents/scope_guard.py. For the roles in `work_scope.roles` (staff by default), before any work
starts:
1. Attempts to switch the AI's rules off ("ignore your previous instructions", "developer
   mode", "abaikan semua arahan") are refused.
2. Short follow-ups pass.
3. Everything else is judged once by the `fast` group against the company (name, industry)
   and the owner's description of the work.

When unsure, or when no model answers, it is work: the guard never blocks real work because the
AI is down. Verdicts are cached for a day. Refusals go to the activity log
(`ai.out_of_scope`) and are listed on the AI use page.

It is checked in:
- chat (runtime.chat_turn, which also covers Telegram and WhatsApp);
- task creation (`POST /api/tasks`, `/api/desk/ask`, web tasks);
- schedules and My AI duties.

Settings: `GET/PUT /api/work-scope`, `GET /api/work-scope/refusals`.

## 4. One library

- A department on a document is **where it is filed, not a wall.** Every company document is
  searchable by every agent of that company (company isolation and held-back files are
  unchanged).
- **`files.restricted`:** only the agents of its department, and managers, read it. Never a
  staff member's AI twin, and never staff.
  - Intake marks `financial` and `contract` documents restricted.
  - A department's meeting minutes are restricted.
  - Managers switch it per file in Library > Guidelines.
- Only restricted files carry a department on their passages (knowledge/indexer.py). SOP
  passages carry none: any agent may look up how another department does something.
- **Everything uploaded through Browse (intake) joins the library**, not only how-to kinds. The
  migration puts existing intake files in and the catch-up indexes them.
- **No more silent gaps:**
  - The liveness reconciler (every 10 minutes) indexes library files whose indexing never
    finished (`indexer.catch_up`, at most 5 tries per file).
  - An agent's `search_documents` syncs the keyword index first, so new uploads are found.
  - `company_documents` now lists only what `read_file` may open.

## 5. Routines: repeat learned work without the paid model

skills/routines.py, table `routines`. A skill is advice the model reads and follows again
(tokens every time). A routine is the steps themselves.

- **Learning** (in the `skill_reflect` activity after a task):
  - Only clean work qualifies: every tool call worked, there was no correction, no person or
    other agent was involved, and no browser, PC or code tools were used.
  - Work done the same way as an existing routine **confirms** it, with no model call: same
    tools in the same order, same fixed values, and every slot value present in the task.
  - Otherwise the `smart` group drafts a routine once. It is then checked without any model:
    - filled with the task's own values, it must give back exactly the calls the agent made;
    - every slot value must be in the task text;
    - no step may reuse a value an earlier step found (it would be stale next time).
- **Going live:**
  - A candidate goes live when 2 of its tasks were accepted (status done).
  - A manager can "Trust it now".
  - It pauses itself after 2 results in a row are sent back or fail.
- **Using** (the runtime, before the model loop, on a fresh run only):
  1. A live routine is chosen when the task is within cosine 0.86 of it (local embeddings,
     free) and the agent is offered all of its tools.
  2. Slots are read by the cheapest model, and every value must appear in the task.
  3. Each step goes through the same policy and approvals as the agent's own calls.
  4. The answer is a template (no model at all) or one short `fast` call, with no tools.
  5. Any failed step hands the task to the agent with the results so far.
  6. Self-check, goal and review run as for any task.
- **Measured:** `tokens_saved` = the source task's tokens minus what the run used, added when
  the result is accepted.
- **UI:** Skills > Routines. **Switch:** workspace `routines.enabled` (`PUT /api/routines/settings`).

**Skills learn without stalling:** in `auto_safe`, a brand-new skill now goes live by itself
once a person accepted the work it was learned from, provided the scan is clean and it passes
its tests (skills/autopilot.py). Patches still need a person-approved live skill.

A task whose text closely matches a skill (0.55) is told to load it first
(skills/store.py `hint_for`).

## 6. Setup

- Connecting a known provider (Groq, OpenRouter, Mistral, HuggingFace, DeepSeek, OpenAI,
  Anthropic, Gemini) fills the **empty** smart, fast and bulk groups with its default chat models
  (engine/store.py `CHAT_DEFAULTS`). Before this, agents failed every task until someone filled
  the groups by hand. Groups already set are never changed.
- The getting-started checklist runs in the order that works:
  1. connect AI;
  2. add the company with its AI team;
  3. put SOPs and documents in the Library;
  4. add staff and allowances;
  5. give the first task.
- "Branch" is called "company" in the create dialog. The generic departments are off by
  default when a ready-made team is chosen; together they only added empty departments.
- **17 industries:** general, network, engineering, trading, professional, security, food &
  beverage, e-commerce, clinics, education, logistics, manufacturing, property, hospitality,
  agencies, software, plantation (org/starter.py).
