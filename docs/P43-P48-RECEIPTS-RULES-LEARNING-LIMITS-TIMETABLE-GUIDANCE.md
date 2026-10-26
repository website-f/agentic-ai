# P43–P48: receipts, inbox rules, weekly learning, approval limits, timetable, page guidance

Six changes that take routine work off staff and make every page say what to do. Migration
`0040_mail_rules`. Tests: `apps/api/tests/test_p43_receipts.py`, `test_p44_mail_rules.py`,
`test_p45_weekly.py`, `test_p46_limits.py`, `test_p47_timetable.py`, `test_p48_needs.py`.

## P43 Receipts and bills from photos and PDFs

Bill capture (P35) already turned a supplier's PDF into a payable waiting for approval. Now:

- **Receipts as well as invoices** (`crm/capture.py`). The reader returns `kind` (invoice |
  receipt), `paid` and `payment_method`; it is kept in `money_docs.external.capture`, with a
  note for finance. A receipt that was paid is **paid when approved**: approving records the
  payment (method, receipt date). A staff member's receipt is their **claim**: approved, then
  waits for finance to pay them back.
- **Photos read by a vision model** when OCR finds too little text (or the text does not make
  sense of a photo): group "vision", else "smart", within the company's data level (P33: a
  Confidential company's pictures go to trusted providers only; Local only never leaves the
  server). A scanned PDF's first two pages are sent as pictures.
- **From a phone**: a photo or PDF sent to the office on **WhatsApp** (WAHA or Meta) or
  **Telegram** (`channels/receipts.py`) is saved in the sender's own workspace
  ("My workspace/From my phone"). No caption, or a caption like "receipt / resit / bil /
  claim / tuntutan", reads it as a receipt into their company's payables and answers with what
  was read; any other caption goes to their AI with the file's id. 40 files a person a day.
- **On the Money page**: *Upload receipts and bills* (many at once, `POST /api/money/receipts`,
  into the company's "Bills and receipts" folder; optionally as a member's claim), *Type in a
  bill*, *Read a bill already in the Library*, and **Correct** a captured bill (supplier,
  number, dates, lines) before approving. Pills show "Receipt, already paid" and "Claim:
  reimburse <name>".
- Approving moved into one function (`crm/service.approve`) shared by people and P46.
- A file held for a security check is never read.

## P44 Inbox rules

`mail_rules` (one mailbox each: a person's Outlook, or a shared mailbox). When a mail is
**from** (addresses or domains), **about** (subject words), of a **kind** (the AI's sorting)
or **has attachments**, a rule can: **draft a reply** as you describe (one cheap model call;
the draft waits in Outlook Drafts for a person, as every AI draft does), **save attachments**
to a folder (a shared mailbox's into the company Library there; a person's into "My
workspace/<folder>"), **make a task**, or **ignore** it. Rules run in order before the
mailbox's own switches; *stop* ends the list. Matching is plain code, no model; a **preview**
shows which recent mail a rule would have caught. `api/routers/mail_rules.py`,
`microsoft/rules_engine.py`. A person's rules are theirs only; a shared mailbox's are set by
the people who approve its drafts.

Fix: the shared mailbox switch "Save attachments to the Library" now does that
(`files.library`); invoice attachments are restricted to the mailbox agent's department.

## P45 What the AI team learned this week

`brain/weekly.py`: per agent, from rows the office already keeps (no model, no tokens): tasks
done, facts and lessons (from people saying no), skill proposals and uses, routines learned,
routine runs and tokens saved; plus routines waiting to be trusted and skill proposals to
decide. Every Monday at 08:00 (workspace time) last week's is written as a Report
("learning", "weekly") and owners and admins are notified. **Learning > Week by agent**
(`/learning`, now the first tab) shows any week for the agents you may see, with **Trust** and
**Not useful** on each routine.

## P46 Approval limits

Settings > **Approval limits** (`crm/limits.py`, `api/routers/approval_limits.py`, owners and
admins). Off by default.
- **Bills**: approved on their own when in RM, at or under the limit, not a possible duplicate
  and, unless turned off, from a supplier a person approved a bill from before. Paid receipts
  are then recorded as paid.
- **Invoice drafts**: an agent may draft a customer invoice without asking under the limit
  (unless a manager set the tool to "ask" for it on purpose). A person still approves and
  sends every invoice.
- **A daily cap** for everything automatic; the rest waits.
Every automatic approval is in the audit log (`system:limits`) or the task's events, and
listed on the settings page.

## P47 Timetable

**Timetable** (`/timetable`, `teams/timetable.py`): every agent's day like a staff rota:
working hours with breaks, duties (schedules) at their times, duties that fall outside its
hours (they wait for the shift), and work waiting for its next shift. Click an agent to set
its days, hours, lunch break, "urgent work any time", and **a summary when its day ends**
(`work_hours.day_report`; a Report built from its tasks, no model, to its person or to the
people who manage agents). Add duties from a ready-made list (go through new email, chase
overdue invoices, follow up quotations, check stock, end-of-day summary, weekly report) or
your own.

## P48 Every page says what to do

- **"What to do here"** under every page title (`lib/page-tips.ts`,
  `components/page-tips.tsx`): what the page is for and two or three next steps, written for
  **staff** or for **managers and owners**. Hide it per page (×); the lightbulb by the title
  brings it back.
- **Needs you** (the bell in the top bar, `GET /api/me/needs`): approvals and questions,
  decisions you own, finished work to accept, AI documents to review, your failed tasks,
  email drafts to send, bills to approve, skills and routines to decide; each a link. Only
  what the person may act on.
- No more dead ends for staff (the megaphone, New company / Add member in the command
  palette, Meeting on a task, Schedules links); the tutorial nudge is on My workspace too.
- Plainer words: "company" instead of "branch" where people see it; no "Temporal UI",
  "git vault / Obsidian" or "search-and-call bridge".

## Remote computers: the switch explained (P42 follow-up)

Seeing or using a computer from the web needs **two** yeses: one **on the computer** (once:
`agentic-pc remote control`, or tick *Also let me see and use this computer from the web*
when linking it) and one **on the web** (with your password). The remote page now shows them
as two numbered steps with their state, so a greyed-out switch is never a mystery; the switch
appears once both are done. Turn it on before you travel: from far away it can only be turned
off.
