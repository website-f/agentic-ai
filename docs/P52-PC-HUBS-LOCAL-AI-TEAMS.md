# P52: computers that stay online, a Windows program, a shorter menu, Library search, a faster local AI, and Teams

Tests: `apps/pc-agent/agent.test.cjs` (reconnect and the status page), `apps/api/tests/
test_devices.py` (the .exe download), `test_p52_teams.py`. Details of the PC agent are in
`docs/PC-AGENT.md` ("Always back online, the Windows program, the status page").

## Computers that went offline after a restart

The agent (0.2.x) could look running but stay offline for good: a reconnect attempt that hung
(the office server restarting during an update, Wi-Fi changing, the laptop waking) was never
given up. 0.3.0 cuts a hanging attempt after 20 s and retries, reconnects at once after sleep,
logs every retry with a plain reason, and writes `status.json`. Start-at-login was working.

- **Windows program** (`AgenticOfficePC.exe`): on *Link a computer*, Windows people download
  the program with their one-time code inside. Double-click: it installs itself, starts with
  Windows (no script host, no console window), appears in Settings > Apps and the Start menu
  (*Agentic Office*), links, and opens its status page. The one-line command stays.
- **Status page on the computer** (127.0.0.1 only, with a key): online or not and why,
  *Reconnect now*, pause, what to do when offline, link with a new code.
- **`agentic-pc doctor`** checks everything and starts the agent if it stopped; `open`,
  `start`.
- **On the web**, an offline computer shows what to do in order, and says so when it runs an
  older agent that should be installed again.

## A shorter menu: hubs (`nav.ts` HUBS, `components/hub-tabs.tsx`)

Pages that belong together are one sidebar entry and show as tabs at the top of each other's
page (every page keeps its own address):

| Entry | Tabs |
|---|---|
| Command center | Command center, Impact |
| My AI | My AI, My assistants, My computers |
| Forms & reports | Forms, Reports |
| Workflows & goals | Workflows, Objectives |
| Customers | Contacts, Deals |
| Agents | Agents, Timetable, Monitor, Office floor, Meetings, Broadcasts |
| Knowledge & skills | Learning, Skills, Brain, Blueprints |
| Organization & people | Organization, Members and roles, AI use and limits, Approval limits |
| Settings | Settings, Channels, AI engine, Storage, Logins, Schedules, MCP servers, Activity |
| Learn (Help) | Tutorial, Guide, Present |

An owner's menu goes from about 34 entries to 19. Each person sees only the tabs they may
open; a hub is listed under the first of them.

## Library: one search for everything

Every Library tab starts with one search box that finds names and the words inside every
file, SOP, document and template as you type; Enter opens every result.

## Microsoft 365 (was "Mail") and Teams

The Mail page is now **Microsoft 365**, with *Outlook mail* and *Teams*. Teams uses the same
personal connection (its own scopes, all ones a person may consent to: `Chat.Read`,
`ChatMessage.Send`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`): your own chats, open one,
or *Ask my AI about it*. Connections made before Teams was added are asked to reconnect once.

Your own AI (twin or private assistant) has `teams_chats`, `teams_read_chat` and `teams_send`
(sending waits for your approval). Isolated like Outlook: only your own connection, only your
own AI, only when you are the one asking (a manager chatting with your twin never reaches your
Teams, P51), and what it reads is treated as outside text.

## A faster local backup AI, and fewer tokens

Measured on the server: `qwen3:0.6b` answered "OK" in 21-35 s with its thinking on and in
0.5 s with it off (generation is ~4 tokens a second on the CPU, and thinking added 80-130
hidden tokens to every answer).

- Real work already turned thinking off; the **connection test and the scheduled health
  check did not** (`client.local_quirks`, now used by all three).
- The scheduled health check ran ~20 tests an hour (about 11,000 a month, 900,000 tokens, paid
  models included): the local model, one Ollama, was tested once per workspace, each test
  holding its only CPU worker for about a minute while real work waited. Now the local model
  is checked once per round, and **a provider that answered real work in the last 2 hours is
  not tested at all**.
- **Answer cache** (`gateway.chat`): an exact repeat of a background job (memory extraction
  and reconciliation, skill evaluations, reading a file or a picture, colleague memory, a
  document review) is answered from the cache, free and instant, for a week, per workspace.
  Never agent work, chat or anything with tools.
- **Routines** (agents doing a job again without the model, P36) learned none in the last 300
  finished tasks: almost all of that work drives a browser, asked a person, or had a failed
  step, which a routine must not replay. Work that is repeatable is learned as before.
