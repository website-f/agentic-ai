# P16: Personal assistants, Gmail and WhatsApp (2026-10-03)

## 1. Who sees and controls what

| Who | Sees | Controls |
|---|---|---|
| Owner, admin | Every agent and all work | Every agent |
| Branch manager / HOD / supervisor | Their branch / department | The agents in it (supervisors: no changes) |
| Staff | Their own agents **and the rest of their branch's office working** (view only: list, office floor, live activity) | Only their own agents |
| Anyone | Their own **personal assistants** | Their own personal assistants |

A personal assistant (`agents.private`) is seen only by its owner: not by admins and not by the
workspace owner, and not in lists, the office, tasks, approvals or live events (`api/scope.py`:
`agent_where`, `observe_where`, `observes_agent`, `task_where`, `approval_where`).
Watching (`view_only: true` on `AgentOut`) never allows chat, tasks or changes.

## 2. My assistants (`/assistants`)

Presets: Chief of Staff, Inbox Assistant, Company Analyst, custom. Each is a private agent
with these tools (only private agents get them; `assistants/names.py`):

| Tool | What it does |
|---|---|
| `company_pulse` | Work created/done/failed, open by status, decisions waiting, workflow runs waiting, AI spend, per company, top agents, recent failures |
| `team_performance` | Per agent: done, failed, sent back, open, stuck >6h, average hours, last activity. Per person: tasks given, their agents' output, reviews waiting on them, last sign-in. "Worth a look" flags |
| `slacking_report` | Stuck work, unstarted, unassigned, unreviewed results, decisions waiting >4h, failures, idle agents, workflow runs waiting, each with who should act |
| `message_agent` | Gives another agent a job ("tell Siti's agent to finish the September report"); that agent tells its person if they must act |
| `notify_person` | WhatsApp / Telegram / app notice to a person. **Every** agent has it, but a team agent may only notify the person it belongs to |
| `email_search`, `email_read` | The owner's Gmail (read-only scope), content fenced and scanned for injected instructions |
| `email_draft_reply`, `email_draft` | Creates a Gmail **draft** and an `email_drafts` row, and notifies the owner. Sent only when the owner presses Send on the Drafts tab |
| `calendar_agenda`, `calendar_free_slots` | The owner's Google Calendar (primary): events and free time, in the workspace time zone (section 3a) |
| `calendar_create_event`, `calendar_update_event`, `calendar_cancel_event` | A **proposal** the owner confirms on the Drafts tab; only then does the Calendar API run (section 3a) |

Every agent (not only assistants) also has `schedule_task`, `list_my_schedules` and
`cancel_schedule`: work on a timer when a person asks for it (section 3b).

All reports run in the owner's scope (`member_scope`), from the office's own records.

## 3. Gmail: setup (one time, free)

An API key cannot read a mailbox: Google requires the mailbox owner's consent through an
OAuth client. In the **same Google Cloud project** you already have:

1. APIs & Services > Library > **Gmail API** > Enable, and **Google Calendar API** > Enable
   (same project).
2. OAuth consent screen: user type External (or Internal on Google Workspace). Add your own
   Gmail as a **Test user**. Scopes: `gmail.readonly`, `gmail.compose`, and
   `https://www.googleapis.com/auth/calendar.events` (Data access > Add or remove scopes).
3. Credentials > Create credentials > **OAuth client ID** > Web application. Authorised
   redirect URI: `<AGENTIC_PUBLIC_URL>/api/integrations/google/callback`
   (dev: `http://localhost:8500/api/integrations/google/callback`).
4. Paste the Client ID (`…apps.googleusercontent.com`) and secret in Channels > Gmail (or
   set `AGENTIC_GOOGLE_CLIENT_ID` / `AGENTIC_GOOGLE_CLIENT_SECRET`).
5. Each person: My assistants > Settings > Connect Google (one sign-in for Gmail and
   Calendar). The redirect URI does not change for Calendar.

In "Testing" mode Google keeps refresh tokens for 7 days for unverified apps with sensitive
scopes; publish the consent screen (or use Internal on Workspace) for long-lived access.
The Gmail API costs nothing (per-user quota). Tokens: refresh token encrypted at rest
(`google_accounts.token_enc`), access tokens cached in Valkey; PKCE + single-use state.

## 3a. Google Calendar

The same Google sign-in also asks for `calendar.events` (`assistants/gmail.py` `SCOPES`, with
`include_granted_scopes` for incremental consent). A connection made before that, or one where
the person unticked the calendar box, has no calendar: `google_accounts.scopes` lacks it, the
API returns `account.calendar = false`, and both the My assistants Connections card and the
Channels > Gmail card show **Reconnect Google to add Calendar** (the same sign-in again).
Calendar tools on such an account answer "Reconnect Google to add Calendar" instead of failing.

| Tool | Risk / mode | What it does |
|---|---|---|
| `calendar_agenda` | low / allow | Events for today, tomorrow, this or next week, next N days or a date range (max 31 days), grouped by day, times in the workspace time zone, guests, Meet, your response, event ids. Fenced as untrusted text |
| `calendar_free_slots` | low / allow | Free stretches of at least N minutes inside working hours (`workspace.settings.work_hours`, default Mon-Fri 09:00-18:00, or `work_start`/`work_end`), never in the past, starting on the quarter hour. Declined and "free" (transparent) events do not block time |
| `calendar_create_event` | medium / allow | Title, start (`YYYY-MM-DD HH:MM` local, ISO, or words like "tomorrow 3pm"), end or `duration_minutes` (default 30), attendees, description, location, `meet` (Google Meet link). Makes a proposal; writes nothing |
| `calendar_update_event` | medium / allow | Change title, time (keeps the length unless told), guests, place, description, add Meet. A proposal |
| `calendar_cancel_event` | medium / allow | A proposal to cancel; guests are told only for events the owner organises |

Why proposals and not the approval gate: an approval only exists inside a task (chat answers
"needs approval, only in a task"), but people book meetings from chat and WhatsApp. So the
tools are "allow" because they only *propose*; the write happens on the person's own
**Add to calendar / Save the change / Cancel the event** on the Drafts tab (they get a phone
notice linking there), exactly like email drafts. Only then does `POST/PATCH/DELETE
calendars/primary/events` run, with `sendUpdates=all` when there are guests and
`conferenceDataVersion=1` for Meet. A short Valkey lock stops a double tap adding two events.

Proposals live in Valkey (`calprop:<id>` plus a per-person sorted set), without key expiry so
`volatile-lru` never evicts them; they lapse after 7 days and are pruned after 30. Only their
owner can list, confirm or discard them (others get 404). API: `GET /api/calendar-drafts
?status=pending|all`, `POST /api/calendar-drafts/{id}/confirm`, `POST .../discard`.

## 3b. Schedules from chat ("every Monday 9am send me the slacking report")

`schedule_task(title, brief, when)`, `list_my_schedules`, `cancel_schedule(schedule_id)`
(`agents/schedule_tools.py`), for every agent:

- **When**: `teams/when.py` is a small deterministic parser in the workspace time zone. It
  understands every day/weekday/weekend/Monday (and lists) at 9am / 14:00 / 9am and 5pm,
  Mondays 9am, every N minutes (15, 20, 30) or hours (1, 2, 3, 4, 6, 8, 12) with "on weekdays"
  and "between 9am and 5pm", every month on the 1st, every year on 1 Jan, and one-offs
  (today/tonight/tomorrow at, Friday 4pm, next Monday 9:30am, on 10 Oct at 4pm, 2026-10-10
  16:00, 25/10 at 3pm, in 2 hours), plus raw five-field cron. Anything unclear comes back as a
  question for the person instead of a guess: no time, "at 9" (morning or evening?), "10/11"
  (which is the month?), every other week, the 31st, a time already passed today.
- **Safety**: an agent schedules only for itself (the row's `agent_id`); at most 20 active
  schedules per agent; at least 15 minutes between runs (checked over the next 48 runs).
  `schedule_task` defaults to mode **ask**, and `policy.PERSON_APPROVES` makes the rule exact:
  when the person chatting could approve the agent's requests anyway (its owner, or someone
  with `approvals.decide` who sees the agent: `policy.chat_approver`), the request in chat is
  the approval (`chat.person_asked`). Anywhere else (a task, something the agent read) it waits
  for a person through the normal approval card, even on autonomy "auto". An explicit allow or
  deny on the agent still wins. Agents may cancel only schedules they set up.
- **Runs**: each run is the usual scheduled task for the same agent (no review step), and its
  result (or the failure) is sent to the person who asked (`schedules._report_to_person`). A
  one-off switches itself off (and is paused in Temporal) after it fires.
- **Who set it up**: `schedules.created_by` reads `agent:<id>|for:<person>|chat|once`
  (`schedules.origin`), no migration needed. The Schedules page shows "Set up by Aina from
  chat", "Once" and "Done".

## 4. WhatsApp

Two ways, one office number per workspace (`channels.kind = 'whatsapp'`):

| | WAHA (testing, small offices) | Meta Cloud API (official) |
|---|---|---|
| What | Self-hosted gateway (`waha` service, NOWEB engine, ~150 MB) | WhatsApp Business number |
| Connect | Channels > WhatsApp > WAHA: scan the QR with the office phone (Linked devices) | Phone number id, permanent token, app secret; set the webhook URL + verify token shown |
| Webhook | `http://api:8501/api/whatsapp/hook/waha/<id>`, HMAC-SHA512 signed | `https://<public>/api/whatsapp/hook/meta/<id>`, `X-Hub-Signature-256` |
| Limits | Unofficial: message only people who linked themselves | Outside 24h of their last message, an approved template is used |

People link their own WhatsApp with a one-time code (`LINK ABCD2345` to the office number, or
the wa.me link), just like Telegram. Unlinked senders get no reply. A linked person's message
goes to the agent bound to WhatsApp DMs, else their own personal assistant, else an agent they
own; bindings never reach an agent outside their scope. Approvals, notices and email-draft
alerts go to WhatsApp through the delivery ledger (`deliveries.channel = 'whatsapp'`).

## 5. The chain

Owner: "Tell Siti's agent to finish the September report by 5pm" → Chief of Staff
`message_agent` → a task for Siti's Agent (labelled `message`, started) → Siti's Agent
`notify_person(me)` → WhatsApp message to Siti. Covered end to end in
`tests/test_assistants.py::test_owner_asks_assistant_to_chase_a_staff_agent_who_whatsapps_its_person`.

## 6. Verified

- 8 tests (`test_assistants.py`) with fake Google and fake WAHA/Meta: privacy, insights,
  notify rules, Gmail connect → read → draft → edit → send once, drafts per person, WAHA
  connect/QR/forged webhook/stranger silence/link/dedupe/chat/notices, Meta verify + signature,
  and the chain. 258 backend tests in all.
- Calendar and schedules: `tests/test_calendar_schedules.py` (50 tests, fake Google Calendar):
  scope request and reconnect, assistant-only tools, agenda and free time across time zones
  (UTC and -04:00 events shown in Kuala Lumpur time), proposals that write nothing until
  confirmed (then the exact Calendar API call, once), change/cancel/discard, privacy of
  proposals, 37 parser cases (incl. unclear ones and the 15-minute floor), the chat-consent
  policy, schedules bound to the agent, results sent to the person, one-offs switching off,
  approval inside tasks, the 20-schedule cap, and cancelling only the agent's own.
- Live: WAHA 2026.9.2 running; our API created the session and served a real login QR; WAHA's
  signed status webhooks reached the API. A real model answered "Where are we slacking?" with
  four tools and the office's actual stuck work.
- Not verifiable here: a scanned WhatsApp session (needs the office phone) and a real Google
  sign-in (needs your OAuth client).
