# P49–P50: a simpler menu with help built in, and a universal CRM

Two changes for people who are not technical: the menu is shorter, searchable and can answer
"how do I…?", and the owner gets a CRM they shape to their own business. Migration
`0041_crm_hub`. Tests: `apps/api/tests/test_p49_help.py`, `test_p50_crm.py`.

## P49 The menu, search, "Ask how" and setting up

- **Seven groups** (`apps/web/src/nav.ts`): Today, Work, Customers and money, Library, AI
  team, Settings, Help. Ten pages most people never need (Objectives, Blueprints, Brain, Office
  floor, Monitor, Meetings, Broadcasts, Schedules, MCP servers, Activity) are marked
  `advanced` and folded away behind **Show all pages (n more)**. The choice is kept per browser
  (`agentic.nav.all`). A page someone may not open is never shown.
- **Search the menu** at the top of the sidebar and in the phone drawer: it matches page names
  and what each page is for. When nothing fits, **Ask AI: "…"** sends the question to help.
- **Ask how** (`components/help-ask.tsx`, `POST /api/help/ask`): a short answer about *this*
  app, written from the pages the person can open and their setup steps, with links straight
  to the right page. Only links to pages of the app survive (`clean_links`); anything else is
  shown as plain text. It uses the cheap model groups, then "smart"; it counts against the
  person's daily AI allowance like any other call.
- **Setting up** (`/start`, `lib/setup.ts`): the few steps that make the office work, in order,
  for an owner (company, first agent, Telegram or the office channel, mailbox or Outlook, a
  computer...) and for staff (their AI, their phone, their computer). Each one ticks itself from
  real data (`GET /api/tutorial` signals). The sidebar shows the next step until all are done.

## P50 The CRM

One place to follow everything about the business, shaped by the owner: built from what the
office already keeps, from a starter for the kind of business, from blank lists, and from other
systems. Grounded in how open CRMs model this (Twenty's objects/fields/views, hybrid JSONB
storage, schema inference in connector platforms).

### What it is made of (`agentic/crm/hub/`)

| Piece | Table | Notes |
|---|---|---|
| **List** (object) | `crm_objects` | `custom`, `builtin` (the office's own data) or `synced` (from another system). Name, one-of-them name, icon, colour, which field names each record. |
| **Field** | `crm_fields` | 18 types: text, long text, number, money, percent, date, date & time, checkbox, choice, several choices, email, phone, web address, rating, person, link to another list, files, auto number. Options per type (choices with colours, currency, highest rating, which list). |
| **Record** | `crm_records` | Values in one JSONB column (GIN index). Built-in lists keep their extra fields here by `external_id`. |
| **View** | `crm_views` | table, cards, board (columns by a choice; drag to move), calendar (by a date); saved filters, sort and columns. |
| **Tile** | `crm_widgets` | the dashboard: a number, bars, pie, over time, or the latest few; count, total or average, split by a field. |
| **Connection** | `crm_connectors` | rest, csv or webhook; presets for Shopify, WooCommerce, HubSpot, Stripe, Airtable, Google Sheets. |
| **Sharing** | `crm_access` | per person: the dashboard, and per list *can see* or *can change*, minus hidden fields. |

- **Built-in lists** (`builtins.py`): contacts, deals, invoices, bills, tasks, staff, agents,
  mail, files, read live and found automatically with a count (`discover`). They are read only
  in the CRM (changed on their own page; "Open where it lives"), but people can add their own
  fields to them.
- **Starters** (`templates.py`): any business, agency, real estate, clinic, education,
  construction, retail, recruitment, logistics, events. Each adds its lists with fields, an
  "All" table, a board when there is a status, and suggested dashboard tiles.
- **Records** are filtered and sorted in Python over at most a few thousand rows a list (a
  small office's CRM), which keeps every field type filterable the same way.
- **Values are checked** by type (`fields.coerce`). A bad value is refused with the field's
  name, and the reason is shown next to the input in the person's language (the error handler
  now passes `fields` through, translated).
- **Import a CSV** (or an Excel sheet saved as CSV): columns that match a field fill it, new
  columns become new fields with a guessed type (a type is chosen when 80% of the cells fit it),
  cells that cannot be read are left empty and listed. **Download as CSV** at any time.

### Connections to other systems (`connectors.py`)

- **Test, then keep**: the owner fills in what the system needs (store address, key, sheet
  link), *Test* fetches a page and **works out the fields** (types from the values, nested
  values flattened to paths). The owner ticks the ones to keep, renames them and picks the name
  field. A new synced list is made for them.
- **Sync**: by hand or every N minutes, on the liveness round (`sync_due`). Pages are followed
  (page number, offset, cursor, Stripe's `starting_after`, or a `Link` header), up to a cap.
  Records are matched by the other system's id; **new fields and new choices found later are
  added** by themselves.
- **Webhook**: the other system posts records to `/api/crm/hooks/{token}` (no session, a long
  random token, 2 MB at most, CSRF-exempt). Nothing to fetch.
- Keys are **encrypted** (`core/crypto`, bound to the connection) and never sent back to the
  browser. Addresses go through the SSRF guard: no private or local addresses unless the
  server allows them.

### Who sees it

- The CRM is the **workspace owner's**. Everyone else sees it only through a grant from
  Sharing: the dashboard, and per list *can see* or *can change*, with some fields hidden. The
  menu shows **CRM** only to the owner and to people with a grant (`crm.access`).
- Only the owner changes how it is set up (lists, fields, views, tiles, connections, sharing).
  Everything changed is in the audit log; a record shows its history.

### The screens (`apps/web/src/pages/crm/`)

- `index.tsx`: the page. Tabs that scroll sideways on a phone: Dashboard, each list,
  Connections, Sharing. **Add to CRM** opens `setup.tsx` (already in your office / a starter /
  your own list / another system). The address keeps where you are (`/crm?o=…&v=…&r=…`).
- `object.tsx`: one list with its views, search, filters (save them to the view), sort, new,
  import and download, and its record sheet (`record.tsx`). On a phone the table becomes cards,
  the board scrolls column by column with a *Move to* picker, the calendar becomes a list of
  days.
- `fields.tsx`, `dashboard.tsx`, `connections.tsx`, `sharing.tsx`: the fields editor, the
  dashboard and its tiles, the connection wizard, and sharing per person.
