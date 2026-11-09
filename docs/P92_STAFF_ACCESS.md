# P92: what each role sees and does (staff first)

Fitri, 9 Nov 2026: "Check the permissions for each role, like what staff see, and make it super
mobile friendly ... Don't let them access any high-level things. You decide first; later I will
check whether anything needs restricting for each role."

This is the decision for review. The server is the rule: the web only hides what the API refuses.
The permissions per role (`core/security.py` `PERMISSIONS`) are unchanged; the leaks below were
closed in the routers. `apps/api/tests/test_p92_staff_access.py` walks every API route as each role
(see "How it is checked").

## Roles in one line

| Role | Scope | Permissions (unchanged) |
|---|---|---|
| Owner, Admin | whole workspace | everything (owner can also make owners) |
| Branch manager | their company | read, office.view, work, approvals, agents, logins, team, assistants, money |
| HOD | their department | read, office.view, work, approvals, agents, logins, team, assistants |
| Supervisor | their department | read, office.view, work, approvals, assistants |
| **Staff** | **their own agents and work** | read, work.write, approvals.decide, agents.own, vault.own |
| Operator | whole workspace | read, office.view, org.read, work.write |
| Approver | whole workspace | read, office.view, org.read, approvals.decide |
| Viewer | whole workspace, read only | read, office.view, org.read |

## Staff: what they see and do

| Area | Staff see / do | Refused (API answers 403 or 404) |
|---|---|---|
| Home (My desk) | their desk, pins, their AI worker, the work they gave | other people's desks |
| My AI (twin), My computers | their own twin: hire, chat, teach, hours, duties; their own computers | anyone else's twin or computers |
| Tasks, Approvals, Chat | tasks of their own agents and tasks they created, tasks shared with them (read only); decisions their own agents ask | other people's tasks and approvals, another company's work (404) |
| Colleagues' agents (same company) | watch that they are busy or idle (P16 "watch") | their tasks, chats, approvals, settings |
| Forms, Reports, Workflows | forms to fill and hand in; reports of their own agents; workflows they own or are part of | other people's reports |
| Contacts, Deals | **the whole company's (branch) contacts and deals**, add and edit them | another company's |
| Prima | opens Prima as themselves (Clock in tab on the phone) | Prima's own permissions apply inside |
| Library | files, documents, templates, packs they may see; **SOPs: every-company, Library, their company's and their department's, active only** | another company's SOPs, AI-drafted SOPs not yet approved |
| Company kit | **their own company's kit only** (was: every company's legal name, bank, signatory) | other companies' kits |
| Settings, Channels, Logins | their profile, language, password, two-step sign-in; link their own phone (Telegram, WhatsApp, push); their own saved logins | other people's links, the gateway, its errors, the bindings to chats |
| The app badge and counts (`/api/system/status`) | **their own**: their agents, their tasks, the decisions waiting for them; no server detail | members, companies, AI providers, skill proposals, the office's tasks and approvals |
| AI model pickers (`/api/ai/groups`) | **group names and how many models each has** (to pick their twin's model, voice notes) | which providers and models are in each group |
| Objectives | the task form's picker: titles in their company, **no cost or budget** | the objective's page (cost by day, its tasks) |
| Brain, Skills, Learning | their own twin's memory (on its page) and their own agents' share of the nightly tidy-up (dreams, as before) | brain pages, facts, graph, search, skills, skill proposals, learning overview and week |
| Command center, company overview, Office floor, Agents, Timetable, Monitor, Meetings, Broadcasts, Schedules | nothing (lists the API scopes to their own agents come back empty) | the pages (web guard) and their APIs |
| AI engine, MCP tools, File storage, Web connections, Approved services, Members, AI use, Approval limits, Activity log, Money, CRM (unless shared), Data export and erase | nothing | all refused |

Writes: every write route was called as staff with an empty body. Only their own things answer:
their twin and AI worker, their Microsoft and Google connection, their two-step sign-in, linking
their phone, their desk, preferences and tutorial, a draft document of their own, retrying their
own failed work, previews that save nothing. Everything else is refused or rejected.

## Other roles

| Role | Sees | Changed in P92 |
|---|---|---|
| Viewer, Operator, Approver | the whole workspace, as before: every agent, task, objective, brain, skills, the AI engine page read only (provider names and the last 4 key characters, never keys) | a broken channel's number and error, and the WhatsApp gateway's address and key, are for who runs channels only |
| Supervisor, HOD, Branch manager | their department or company, the office pages (office.view) | the app badge counts their own scope's approvals and tasks (was the whole workspace); company kit is their own company's; AI model groups show names and counts only (no org.read); channel errors hidden |
| Owner, Admin | everything | nothing |

## Decisions for Fitri

1. **Contacts and deals are company-wide for staff** (`crm/access.py`): a guard or clerk in a
   company sees every customer and deal of that company and can add or edit them. Kept as is,
   because staff and their AI log customer work there. If staff should see only contacts they
   own, that is a one-line scope change in `crm/access.py`.
2. **Colleagues' agents**: staff see the other agents in their company busy or idle, with their
   name, job and instructions (P16 "watch"), never their work. Kept.
3. **The office WhatsApp number** is shown to staff when it works: they message it to link their
   phone. Hidden when it is not working.
4. **Branch names**: staff see their own company only (branches list, kits, SOPs).
5. Workspace roles (viewer, operator, approver) still see the whole workspace: that is what they
   are for. If HR or management should be narrower, that is the roles work (another engineer).

## Phone (staff)

- Bottom bar for staff (no office.view): **My desk, Clock in, Tasks, Chat, More**. Clock in opens
  `/prima#clock`; the office passes `#clock` on to Prima, which opens on its clock screen. If the
  person's Microsoft account is not connected yet, the Prima page shows one clear card with three
  numbered steps and a full-width "Connect Microsoft" button, and they come back to the clock.
- Approvals moved under More for staff; More carries the waiting count, and so does the Approvals
  tile in the sheet. Other roles keep today's bar (My desk, Tasks, Approvals, Chat, More).
- More sheet for staff: Help, then My AI, Work (Approvals, Microsoft 365, Forms & reports,
  Workflows), Customers, Prima, Library, Settings. Nothing high-level is in it (the same rule as
  the sidebar and the page guard).
- Report tables are cards on a phone (no sideways scrolling); the table stays from tablet up.
- Channels: when the office WhatsApp is down, staff read "Ask an owner or admin to fix it, then
  try again", not the gateway's technical fix, and no "WAHA, self-hosted" label.
- Every staff page was opened at 390px and 1366px in a local run: no page scrolls sideways. Most
  pages were already phone-first; the survey's wide tables (channel deliveries, shared mailboxes,
  CRM tables) are admin-only or already cards on a phone.
- Tab bar targets are at least 48px tall.

## How it is checked

`apps/api/tests/test_p92_staff_access.py`:
- seeds an owner's office with two companies, agents and tasks in both, a renamed AI provider, a
  broken WhatsApp channel (encrypted gateway key), an objective and an SOP of the other company,
  an owner's saved login and a colleague, each marked with a canary string;
- calls every GET route as staff and asserts no canary in any answer, no crash, every answering
  route is on a reviewed list (a new route fails the test until someone checks it), and the
  office-wide routes are refused;
- calls every write route as staff and asserts only their own things answer;
- repeats the GET walk as viewer, operator, approver and supervisor for secrets (keys, passwords,
  channel errors, the gateway) and, for a supervisor, another company's work.

`P92_DUMP=<folder>` writes what each role got, route by route.
