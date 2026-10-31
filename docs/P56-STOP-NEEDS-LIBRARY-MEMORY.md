# P56: stopping a task for good, the Needs-you list, the Library folder browser, and memory that scales

## The same approval kept coming back
**What happened:** saying no to "read a web page" did not stop the agent. It tried another page and
asked again, with the same wording. A stopped or finished task also left its question "pending"
in Approvals, where it could still be answered.

**Fixes:**
- **No is not asked again.** Once a person denies a tool in a task, the agent is not allowed to ask
  for it again in that task (`runtime._said_no`). It is told "the person already said no", finishes
  with what it has, and says what it could not do.
- **A stopped task's questions end with it.** Any move to done, failed, cancelled, review, triage or
  ready cancels the task's pending approvals (`runtime._void_approvals`, in `set_task_status`).
  They leave Approvals, and answering one answers 409.
- **Stop the whole task, right where it asks.** The approval card (Approvals page, office floor,
  chat) has **Stop the whole task**: `POST /api/approvals/{id}/stop`. It cancels the task and its
  sub-tasks, and its questions end at once.

## Needs you (the bell)
- The bell lists **each thing**: the approval with its task title, the task to accept, the
  document, the draft. Newest first, in a list that scrolls inside the panel. The kinds at the
  top filter it.
- **Mark all as read**: the badge counts only what arrived since (`POST /api/me/needs/seen`, kept
  in the person's prefs). Nothing is decided or hidden. Items stay listed until they are done.

## Library: a real folder browser
- On desktop, two panes in a fixed frame:
  - the folder tree scrolls on its own, with expand/collapse and counts;
  - the contents have a clickable breadcrumb.
- Picking a folder no longer jumps the page to the top (`resetScroll: false`), and the tree keeps
  its place.
- Keyboard works like a file tree (arrows, Enter, Home/End).
- On phones, it drills down like a phone file manager: a back button goes up a folder, and
  **Folders** opens the tree in a sheet.
- Every existing feature is kept: search, upload, filters, sort, views, held-back files, preview,
  move and the rest.

## Brain graph
**Why it looked broken:** the overview's "Links" counted the nightly index's links to every page,
but the graph leaves those out. The stat said there were links, and the graph said "No links yet".
The example `[[page-name]]` in AGENTS.md also showed as a page "not written yet". A workspace with
only facts had no graph at all.

**Now:**
- The graph shows the facts agents learned, each joined to the agent that learned it and to the
  wiki pages it names. Up to 150 facts are shown, the most used and newest first.
- The graph appears as soon as there is anything to show, even without links between pages.
- The Links stat counts what the graph draws.
- Example links written in `code` are not links.
- "Linked but not written" lists only links on pages you may read.
- Clicking an agent opens its profile; clicking a fact opens the Facts tab.

## Memory that stays sharp as it grows
- **SOPs fill a budget.** About 24,000 characters of SOPs go into each prompt, most general
  first. One long SOP is cut at 12,000 characters, with a pointer to `find_sop` for the rest.
  The others are listed by title, and the agent reads them with `find_sop` when the work needs
  them. Before, every SOP went in whole: ten long SOPs came to about 100k tokens on every call.
- **Recall precision.** A fact that shares only one word with the question, and not its meaning,
  ranks well below real matches (`WEAK_MATCH`). The six facts recalled each turn stay relevant as
  memory grows. Such a fact still fills a slot when nothing better is known.
- **Shared, and private where it should be.** Team facts are shared across the office already.
  Two fixes:
  - a personal assistant's `remember` now always stays private (it could save team-visible facts);
  - a helper's private facts are kept under the agent it helps, where recall looks (they were
    stored where nobody could recall them).

## Skill tests
- An update that passes only a few of its tests is no longer approved automatically because it
  beats an even worse current version (1/5 against 0/5 used to pass).
- A skill with no tests shows "No tests yet", not a green "0/0 passed".
- The results say plainly that the tests run with simulated tools: they check the steps, not live
  data.

## The nightly dream, one workspace at a time
**Before:** one hourly job dreamed every due workspace one after another, inside a single
30-minute limit with no retry. A big office could starve the rest, and a workspace whose 02:00
slot was missed (the worker was down) skipped that night.

**Now:**
- Every hour, `brain_dream_due` lists the due workspaces. Due means past the dream hour where
  the workspace is, with no dream yet today.
- Each due workspace dreams in its own workflow, with its own 30-minute limit. The workflows
  are started and left to finish on their own.
- A missed night is caught up the same day.
- A dream stuck "running" for over an hour (its worker died) is done again.
- The old single job still runs for workflows already in flight (`workflow.patched`).

## Skill tests in a real agent's instructions
**Before:** skills were tested inside a bare "office assistant" prompt.

**Now:** they run inside the system prompt of the agent that proposed the skill, else one it is
given to, else the workspace's most recently active office agent. That prompt includes the
agent's role, its rules and its SOPs. The skill is tested the way it is used.

The results say which agent the skill was tested as. Tools are still simulated, so the tests
check the steps, not live data.

## Not changed yet
- The tool list sent with each call (about 17k tokens) could be trimmed to the tools a task
  needs.
