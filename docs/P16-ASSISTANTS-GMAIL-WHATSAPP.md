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

All reports run in the owner's scope (`member_scope`), from the office's own records.

## 3. Gmail: setup (one time, free)

An API key cannot read a mailbox: Google requires the mailbox owner's consent through an
OAuth client. In the **same Google Cloud project** you already have:

1. APIs & Services > Library > **Gmail API** > Enable.
2. OAuth consent screen: user type External (or Internal on Google Workspace). Add your own
   Gmail as a **Test user**. Scopes: `gmail.readonly`, `gmail.compose`.
3. Credentials > Create credentials > **OAuth client ID** > Web application. Authorised
   redirect URI: `<AGENTIC_PUBLIC_URL>/api/integrations/google/callback`
   (dev: `http://localhost:8500/api/integrations/google/callback`).
4. Paste the Client ID (`…apps.googleusercontent.com`) and secret in Channels > Gmail (or
   set `AGENTIC_GOOGLE_CLIENT_ID` / `AGENTIC_GOOGLE_CLIENT_SECRET`).
5. Each person: My assistants > Settings > Connect Gmail.

In "Testing" mode Google keeps refresh tokens for 7 days for unverified apps with sensitive
scopes; publish the consent screen (or use Internal on Workspace) for long-lived access.
The Gmail API costs nothing (per-user quota). Tokens: refresh token encrypted at rest
(`google_accounts.token_enc`), access tokens cached in Valkey; PKCE + single-use state.

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
- Live: WAHA 2026.9.2 running; our API created the session and served a real login QR; WAHA's
  signed status webhooks reached the API. A real model answered "Where are we slacking?" with
  four tools and the office's actual stuck work.
- Not verifiable here: a scanned WhatsApp session (needs the office phone) and a real Google
  sign-in (needs your OAuth client).
