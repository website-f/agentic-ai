# P19 to P28: overview

There are no design documents for these phases; this summary is written from the commit
messages (`git log`) and checked against the code. Dates are commit dates (2026).

**P19 — Companies with ready-made AI teams (10-04).** Adding a company now brings an industry
AI team (network, engineering, trading, professional, general; `org/starter.py`,
`deploy/scripts/add_company.py`). Agents gained finance tools (`finance_calc`: hire purchase
with EIR, reducing balance, NPV/IRR, payback, break-even, depreciation, CAGR, SST) and a
forecaster (Holt / Holt-Winters with an 80 % range), with six finance skills. New pages:
`/impact` (measured results, editable ROI assumptions), `/tutorial` (role tracks with
detected progress) and a staff onboarding path (`/welcome`, "Hire your AI worker",
`/my-worker`). Agents respect their own work hours in launches, schedules and heartbeats,
and run a **self-check** before handing in (`agents/verify.py`) that feeds skill learning.

**P20 — User Guide and client presentation (10-05).** `/guide` documents every page with
annotated screenshots whose hotspots light up per step, desktop and phone views, and flow
videos; `/present` is an 18-slide client deck. Help is pinned in the sidebar and a `?` on
every page opens its guide. `deploy/docs-capture` seeds a demo office and captures the
96 screenshots and 6 videos with Playwright; `docs/USER-GUIDE.md` is generated from the same
content. Open tabs now pick up new versions every 15 minutes and on focus.

**P21 — Canvases, kanban and chat (10-05, commit "Phase 1").** One shared camera
(`lib/viewport.ts`) for the n8n-style workflow canvas and the office floor, native kanban
drag and drop, a full-screen assistant chat, an all-companies switcher and meeting minutes.

**P22 — Accountable work, cleaner reading, Bahasa Melayu (10-05, commit "Phase 2 + 3").**
Task dependencies with release and blocker routing, a liveness watchdog that relaunches a
dead run once then hands it to a person, review stages with an agent reviewer and optional
human check, and objectives (a goal tree with cost roll-up and budget holds). Web reading
became boilerplate-free markdown with section picking without a model call
(`research_gather`); the browser got stable element refs, delta snapshots, iframes, saved
encrypted sessions and a per-task site allow-list. Tool-result compression saves tokens.
Every screen, the guide and the tutorial exist in English and Bahasa Melayu.

**P23 — Malay on the server, meeting speakers, browser egress lock (10-05).** Errors,
notifications, push, Telegram and WhatsApp messages render in the recipient's language;
agents reply in the person's language. Meeting minutes separate speakers on the CPU
(sherpa-onnx) and attribute points to named people. Schedules understand Malay phrasing.
Workflow runs can serve an objective. The agent browser lost its own route out: its network
is internal and its only exit is the new egress proxy (`apps/egress`), which refuses
non-public addresses on every connection and pins the checked IP.

**P24 — Company files that organise themselves (10-05).** Upload anything per company (zips
with folders, PDF, Office files, images): it is unpacked safely, read (OCR included), sorted
by kind and department, and browsable as a folder tree with previews and zip downloads.
Every upload is scanned: passwords, login IDs, PINs or several IC numbers hold a file back
from agents, the library and staff until a manager releases it. Agents get a catalog of
each company's documents, and each upload yields AI-drafted SOPs and runnable workflows
(approved before use). nginx now streams big uploads and downloads.

**P25 — Search inside every document; everything AI makes is stored (10-06).** A full-text
index of files page by page, SOPs, documents, templates and wiki pages, tuned for Malay
roots, amounts, dates and reference codes, with suggestions as you type, a header search
box and a `/search` page; agents get `search_documents` with file and page citations. Every
agent draft, revision or export is saved into the company's AI folder with its provenance,
and a review queue lets people approve or send back what AI made.

**P26 — My workspace (10-06).** One desk per person, staff and owners alike: ask or search
(or hand the question to their AI worker), pinned SOPs, workflows, files and documents, "My
work", their own files (files and documents now record an owner), their AI workers, what is
waiting for them, and their procedures. Everyone lands there after signing in. Follow-ups:
agents stop after 20 searches per task and conclude, colleague questions can no longer go
round in a circle, and each company works in its own document language (Malay starters,
amounts in words, AI folder names).

**P27 — Company forms, AI form filling, member import (10-06).** Each company publishes
forms (claims, advances, monthly records, requests) with a blank to download and a window
to hand it in (monthly, yearly, once, any time; late for 10 days). People hand in the filled
form with receipts, or ask their AI worker to fill the company's own Excel (layout, merged
cells and formulas kept). Managers add ready-made or their own forms and accept or return
submissions per round. Members can be imported from an Excel/CSV sheet with one-time
passwords; tasks and workflow answers take file attachments. Navigation became six plain
groups, with a tabbed workspace and shared, read-only tasks.

**P28 — Tender preparation, browser downloads and uploads, one file store (10-06).** Tender
mode (Browse for me > Prepare a tender) drives portals such as ePerolehan in stages:
research, product recommendation with sources (confirmed by a person), technical proposal,
only verified values filled, the portal's own offer printout kept as the result, and a stop
before final submission and signing; it is safe to rerun. The browser now keeps downloads
(saved to company files as outside content, secrets-scanned, zips unpacked), follows new
tabs, saves pages as PDF, and uploads company files with `browser_upload` (always approved
by a person); a session waiting for an approval is held. Server-touching actions are paced
at a human speed, and the egress proxy can send selected hosts out through a trusted
upstream on another line (docs/EPEROLEHAN-EXIT-IP.md). Files became one store with views
(needs review, by task, recent, made by AI, from websites, uploaded, library, folders).
