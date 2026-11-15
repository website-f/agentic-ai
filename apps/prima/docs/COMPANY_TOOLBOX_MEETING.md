# Company and department toolbox meeting (Part X)

Source: Fitri package Part X (14 Nov 2026) and Fauzan's answers X-Q1..X-Q11, with both assumptions confirmed the same
day. Rule `TOOLBOX-AGENDA` (Policy). Screen: Meetings > Toolbox (`apps/web/src/views/Toolbox.tsx`). Service
`packages/core/src/toolbox-service.ts`, one door `svc.toolboxAct(user, op, input)`, API `POST /toolbox/:op`.

The companies' "toolbox meeting" is the HQ admin status meeting, not a safety talk. Every company (standing series
`co-office`) and every central department (`dept-toolbox`) meets every 2 weeks, kind `toolbox`.

| Item | What is built |
| --- | --- |
| X1 | Both standing series are kind `toolbox`, BM labels "Mesyuarat Toolbox Syarikat / Jabatan". The MTG-PREP toolbox checklist is "Status pack built", "Open lines from the last meeting listed", "Attendance confirmed". The safety lines moved to X19. |
| X2 | Two standard agendas in the setting: company a) to o) plus SULIT, department 1 to 8. Central Admin changes it with a reason but cannot drop a standard section; a company manager or department head adds own sections. A meeting keeps the agenda it was built with. |
| X3 | "Bina pek status" fills each section from that company's or department's own records and freezes it with its time. Every line names its source; a missing record is "tiada rekod" in red. Rebuilding is refused once submitted or verified. |
| X4 | Status lines per section (matter, status, owner, target, note); open lines carry forward; "selesai" shows once more then closes; age in meetings; owners become the meeting's action items. |
| X5 | Each section must be ticked "berubah" or "tiada perubahan"; minutes identical to the last meeting with no line change need a reason; dates after the meeting need a reason. |
| X6 | Submitted by the preparer; verified with a comment, or returned with a reason, by the director who chairs, else the company manager (only when no director attended), the department head, or the visiting central director; never the preparer. Verified minutes lock; a correction is a new version with the reason. "Minit (PDF)" export. Verifying replaces signature and stamp. |
| X7 | "Bil n/yyyy" per company or department per year. The meeting counts as held for the standing plan only once its minutes are verified. |
| X8 | Registers: KDN state branch offices (one chosen branch per zone, maximum is a setting with no number yet), MOF nominees (an IC number is refused; it stays on the attached MOF document), PGM claims, and Finance's client receipts with named deductions. |
| X9 | Billing grid per client account: month by month from the invoices sent and Finance's receipts; a month not invoiced is red. |
| X10 | Statutory grid from Finance regular payments (KWSP, PERKESO, SIP, HRD, CP204, PCB, zakat, SST two-monthly); a missed month is red. |
| X11 | Group board: last meeting, verified or late, open lines, oldest line, stale age (3 meetings: company manager / department head; 6: Director Office), red items, assigned director. Group roles see all; a company only its own row. |
| X12 | Readers per X-Q5. The FD sees d), e), f) and SULIT only. IC numbers are masked everywhere; bank accounts show the last 4 digits. |
| X15 | Department pack: headcount, leave in 2 weeks, open and late tasks, open ACT findings; other department sections are status lines. |
| X16 | The Director Office keeps a rotation of central directors (CEO, COO, CoS, DCoS, FD, Ops Director, OGM) with a reason; a missed 2-month period shows "Lawatan pengarah pusat: tiada" to the Director Office and the CEO. The visiting director may verify and add "Ulasan pengarah", which become lines. |
| X17 | AI notes from Microsoft Loop or Notes are pasted or uploaded; "nota AI - belum disemak" until the preparer ticks them. Prima does not connect to Loop or OneNote. |
| X18 | SULIT items in one person's name, kept by Finance, visible to that company's directors, the CEO, the FD and ACT; others see "Sulit: n perkara"; each opening is logged. |
| X19 | The OM records a site safety and operations talk (safety topic, operations points, guards or head count, stamped photo required, issues). Sites with no talk in 30 days show on the OM's list and home. |

## Database

New module `db/modules/toolbox-v1.sql` (table `prima.toolbox_recs`). Not in the release manifest: the CEO installs it
with `infra/run-db-migration.sh`. Before it is installed the toolbox steps are refused with a clear message.

## Tests

Core `packages/core/test/toolbox.test.ts`; PostgreSQL `apps/api/test/toolbox-pg.test.ts`.
