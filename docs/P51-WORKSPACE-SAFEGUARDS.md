# P51: the workspace as a home base, a Trello-wide board, CRM start-over, research that stays, and safeguards

Tests: `apps/api/tests/test_p51_safeguards.py`, plus additions to `test_p39_research.py`
(a person's own AI keeps its research) and `test_p50_crm.py` (remove a list, start over).

## My workspace (`apps/web/src/pages/desk/`)

One page from which owners and staff reach everything they use.

- **Overview**, top to bottom: *Ask or search*; **Go to** (`hub.tsx`, `DeskShortcuts`):
  big tiles for the task board, approvals, my files, workflows & SOPs, my AI, chat, mail, the
  Library, CRM, contacts, money and my computers, only the ones this person may open, with
  counts; **How do I…?** (`HowDoI`); give my AI a task; allowance; stats; pinned; waiting.
- **How do I…?** As you type ("submit a tender", "claim a receipt"), the company's own SOPs and
  workflows that match appear. *Walk me through it* gives the question to the person's AI, which
  answers from the company's SOPs, workflows, templates and documents: steps in order,
  documents needed, who approves, deadlines, links. *How to do it in this app* asks the in-app
  help (P49); *Search every document* opens search.
- **My work** has **Open the task board** (the Kanban).
- **My files**: search by name or folder; on any file, the sparkle menu *Summarize it* or
  *Pull out dates, amounts and to-dos* hands the file to the person's AI (`POST /api/desk/ask`
  with `file_ids`); *Ask my AI to find it* when it is not in the list.
- **Workflows & SOPs**: *How do I…?* on top; SOPs grouped by where they apply (your department,
  your company, everyone, Library), each with *Explain* (the AI walks you through it).

## Task board (`pages/tasks/board.tsx`)

Columns keep their width on every screen (about 19.5 rem on desktop, like Trello) and the
board scrolls sideways to the end instead of squeezing six columns into the page. A fade and
a round arrow show at each edge while more columns are that way ("Scroll sideways to see every
column"); the column switcher works on every screen size.

## CRM: remove a list or start over

The *Add to CRM* page (`pages/crm/setup.tsx`) lists **Your CRM now** with *Remove* on each
list (add another in its place), and **Start over** (`POST /api/crm/reset`, owner only, body
`{"confirm": true}`): every list, record, field, view, tile, connection and share goes. The
office's own data (contacts, deals, invoices, tasks) is never touched.

## Research that stays and makes their AI smarter (`brain/learn.py`)

When a person's own AI (their twin or private assistant) researches on the web, the report
(question, findings, sources) is saved as a file in **their workspace** ("My workspace/
Research", or "Meja kerja saya/Penyelidikan"), shown under My files, and the AI keeps a
private memory of what it found and where the full report is, so it reads that first next
time instead of searching again. A private assistant's research stays there only; company
agents still write to the shared research wiki (P39).

## Safeguards (from an audit of scope, token use and failover)

**Scope**
- A person's own AI opens **their** Outlook and **their** computer only for them
  (`runtime.owner_asks`). A manager who chats with a staff member's twin, or gives it a task,
  gets its help but never that person's inbox or PC: the tools are not offered, and are
  refused if called anyway.
- **Telegram** bindings check that the person writing may talk to the bound agent (as WhatsApp
  did), so a private assistant bound to a chat never answers someone else.
- Document AI (rewrite, fill, write, review) runs under the document's **company data level**
  (P33): a Confidential or Local-only company's text is treated as such.

**Token use**
- Every AI feature counts against the person: document AI, bill and receipt capture and the
  minutes rewrite now check the daily allowance; Telegram and WhatsApp voice notes count as
  the sender's use.
- Tasks an agent lines up inside someone's task stay **that person's** work (allowance, and
  their own AI's mail and PC rules). The 20-an-hour cap per agent still counts them.
- The **OpenAI-compatible API** is billed to the token's maker, refuses once their allowance
  is used, and allows 30 requests a minute per token.
- **The office's own pool**: work nobody asked for directly (shared-mailbox rules, agents' own
  follow-ups) draws on a daily pool (default 2,000,000 tokens, Settings → AI use and limits).
  Used up, that work stops and asks a manager, who can approve half again for today.
- In chat, the allowance is checked before anything else, so someone over it costs no model
  call.

**Failover and ways out**
- Automatic failover (P38) tries **cheaper** AI groups first; a dearer one only when the agent
  has a budget capping it. Otherwise the task stops and a person retries it with another AI.
- When the worker service is down, *Stop now* and *I'll finish it myself* offer **End it
  anyway**: the task is closed, and a run that wakes up later finds it closed and stops.
