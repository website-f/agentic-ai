# P55: easy jobs, smart hand-off, office paperwork, premade roles, friendly schedules, PWA

## Give a job: clear about what an agent can do and where to click
`components/job-picker.tsx` lists every kind of job in plain words, grouped:
- **Talk:** ask a question.
- **Paperwork:** write a letter, file documents, compile into one PDF, summarise a file, check a
  document, prepare a claim.
- **Research and the web:** research on the web, use a website.
- **Routine work:** do it on a schedule, follow a workflow, set up a new workflow, weekly status
  report, check figures, something else.

Each card opens the task composer with that kind of work and a brief to fill in (or the chat,
or the workflow builder).

The picker appears in three places:
- **Office floor:** the agent sheet opens on a new **Give a job** tab for anyone who may give
  that agent work. Watchers see Monitor and Work only.
- **My workspace → AI workers:** **Give a job** on each of the person's own workers opens the
  picker in a dialog (a bottom sheet on phones).
- **Overview:** the "Give my AI a task" panel links to "See every job {name} can do".

## The Chief of Staff gives work to the right agent by itself
- `message_agent` can be called without naming an agent: the best-suited agent gets the job
  (`teams/routing.py`). The match uses each agent's role, department, instructions, the skills
  it may use and what its tools let it do, compared by meaning (embeddings) and by words. A free
  agent beats a busy one. It makes no model call.
- The new assistant tool `who_should_do` answers "who should handle this?" with the top three
  and why.
- The office's own agents are picked first. A staff member's own AI is picked only when the
  office has none.

## Agents do the paperwork (`agents/office_tools.py`)
- **`list_folders`:** the company's folders and how many files each holds.
- **`file_document`:** moves files the agent may read into a folder. Each move is on the audit log
  with where the file was. Held-back files are never moved. Folder paths are cleaned (no `..`, at
  most 6 levels).
- **`compile_documents`:** puts files and drafts into one PDF with a contents page. It reuses the
  submission-pack converter: PDFs as they are, pictures as pages, other files as text. The result
  goes to AI documents (or a chosen folder).

Twins get these through their existing helps: "Finding and filing files" and "Submission packs".

## Premade roles and office skills
- **12 built-in office skills** (`skills/office_pack.py`), in the open Agent Skills (SKILL.md)
  format and pointed at this system's tools:
  - write-business-letter, file-documents, compile-document-pack, summarise-document
  - reply-to-customer, expense-claim, staff-onboarding-file, proofread-document
  - tender-document-check, weekly-status-report, research-brief, clean-spreadsheet

  Existing workspaces gain them once.
- **9 premade role blueprints** (`agents/roles.py`):
  - Admin & filing clerk, Finance clerk, HR officer, Sales & customer service
  - Procurement & tender officer, Marketing writer, Operations coordinator, Research analyst,
    Personal assistant

  Each has a written scope (its job, what it always does, what it never does), tool permissions
  (anything outside the company asks first) and its skills. They are seeded once per workspace,
  so an owner's changes stay.
- **Staff onboarding** shows the roles and pre-selects the one that fits the person's department
  ("Finance & Accounts" gets Finance clerk), marked "suggested for your department".
- **Import a skill** (Skills page, `agents.manage`): paste a link to a SKILL.md (a GitHub page of
  the file or its folder works) or its text. It always arrives as a proposal, safety-scanned and
  reviewed before any agent uses it. Only the SKILL.md comes in, not scripts.

## Staff see only their own company
- The company list (`/api/branches`) returns only the person's own company for office roles.
  Before, it returned every one and only the web app hid them.
- The office floor of another company answers 404.
- Staff whose company was deleted watch no office. Before, they watched every company.
- **Watching a colleague's agent shows that it works, not on what.** Live events for a watched
  agent are trimmed to status and step kind (`scope.watch_view`): no task titles, thoughts, tool
  arguments, results or answers. The floor snapshot leaves out their task and last line.
- Onboarding no longer sends every company's name and departments to a placed staff member.

## Schedules without cron
There is a custom date picker, time picker and schedule picker: once, every day, weekdays, chosen
weekdays, a day of the month, or every N hours. It shows a plain-language summary and the next
runs, is phone-friendly, and is used on the Schedules page and in the composer's Repeat section.
A one-off switches itself off after it runs.

## PWA
- An install prompt in the app for Android, desktop Chrome and Edge, iPhone Safari (Share, then
  Add to Home Screen) and iOS in-app browsers (open in Safari).
- An "Install the app" section in Settings.
- An offline banner, and a friendly "You are offline" screen when the app starts without a
  connection.
- Manifest: language, categories, launch handler, more shortcuts and matching theme colours.
- No pull-to-refresh bounce in the installed app.
