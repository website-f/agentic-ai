# Monthly reports Prima makes by itself

Fauzan, 23 Nov 2026: "Let system automaticly create every month report needed."
Decision card, 23 Nov 2026: **the owner checks; Prima sends on the due day** if the owner has not, marked *Not checked*.
Client reports always wait for a person.
Fauzan, 23 Nov 2026: "Yes proceed. Let they customize follow thier preference. At director office adminstrator can set
what must have and what need added in each report."

Rule `RPT-AUTO` (`packages/core/src/rules.ts`). Code: `packages/core/src/auto-reports.ts` (the figures and the papers),
`packages/core/src/auto-report-service.ts` (who, when, sending), `apps/api/src/auto-reports-online.ts` (daily run),
`apps/web/src/views/AutoReports.tsx` (the "Made by Prima" panel on the Reports screen).
Database module: `db/modules/auto-reports-v1.sql` (not on the release list).

## Inventory of monthly reports (23 Nov 2026)

| Monthly report | Owner, receiver | Before this change | Now |
|---|---|---|---|
| Monthly management accounts (`accounts-monthly`, due 10th) | Company manager / admin execs → Director Office | Typed outside Prima, uploaded as a file | Made by Prima on the 1st: client invoices, money overdue, claims paid, purchases; P&L from SQL Account added by Upload |
| Monthly HR and statutory payments (`hr-monthly`, due 7th) | Company office → Director Office | Typed and uploaded | Made by Prima: headcount, joiners, leavers, leave, payroll paid; EPF/SOCSO/EIS/PCB slips by Upload |
| Any other monthly company report the Director Office adds | Company office → Director Office | Typed and uploaded | Made by Prima with the full company pack (duty, no-shows, cases, clients, tenders, dates due) |
| 16 central department monthly reports on the ACT form (`dept-*-monthly`, due 25th) | Department staff → Director Office, checked by ACT | Typed and uploaded | Made by Prima section by section on the ACT form, with the figures ACT checks for that department (rule RPT-MONTHLY checks) |
| Monthly service report to each client | Operations (who act on the client) → client | Typed outside Prima, uploaded by hand | Made by Prima per client: sites, shifts and attendance, incidents, visits, complaints and requests. Never sent by Prima |
| Group monthly report for the CEO | Director Office → CEO and group leadership | Missing | New: people, operations, clients, money in Prima, tenders, dates due, and how many monthly reports were made and sent |
| ACT month summary for the CEO | ACT | Already worked out when opened | Unchanged |
| IT service report | IT Manager, COO, CEO | Already worked out when opened | Unchanged |
| Director Office counter (who sent what) | Director Office | Already worked out | Unchanged; Prima's sends count as sent |
| Monthly JA Group meeting 14-item company report (Part Y) | Company office → HR | Built from the toolbox pack | Unchanged |
| Finance month-end close and packs | Finance | Checklists in Prima | Unchanged |
| Cleaning monthly client acknowledgement | Client signs | Client's own paper | Unchanged (the client's signature is not a report Prima can make) |

Weekly reports (operations weekly, HR monitor weekly, regional operations weekly) are not monthly and are not made yet.

## How it works

1. **Make (the 1st).** For the month just ended Prima makes one report per company report on the list (pilot companies),
   per central department report, per active client, and one group report. It is made by the daily run (system sign-in
   `u-report-maker`), by the Director Office, CEO or COO pressing **Make now**, or when the owner opens Reports.
   Each report holds only what the sign-in that made it may read. A figure Prima cannot read says *Not available*, never 0.
2. **Tell.** The owner sees "… is ready: check and send" on Home and the bell (Teams and email alerts follow the bell),
   amber 5 days before the due day, red once past due.
3. **Check.** The owner opens Reports → *Monthly reports made by Prima*: **Key in** a short note on any part (600
   characters), **Upload** a PDF paper Prima does not hold (up to 3), **Make again** from today's records,
   **Download** the PDF or the spreadsheet.
4. **Send.** *Checked: send* puts it in the Director Office's report list with the PDF (and the papers, for a company
   report). For a client: *record as sent to the client* (the PDF goes on the client's file; give it to the client the
   usual way). The group report is sent to the CEO.
5. **Due day.** A company or department report not sent by its due day is sent by Prima itself and marked
   *Sent by Prima, not checked* on the Director Office board and on the paper. Client reports are never sent by Prima.

## What each report must have (the Director Office sets it)

On Reports → *Monthly reports made by Prima* → **What each report must have**, the Director Office opens any report
Prima makes (each company report on the list, each department report, the client service report, the group report):
(Only the head of the Director Office and the CEO change these settings, the same people who change the report list;
until a head is named on the organisation chart, the Director Office staff do. Others read them.)

- Each part Prima fills is **Must have**, **Optional** or **Left out**, in the order shown.
- **Add a part**: a part the owner keys in, with a line on what to write; tick *Must have* if it cannot be empty.
- **Owners may add parts of their own**: on by default; untick to fix the parts.
- A short note on what changed is needed; every change is kept in the history and the audit log.

A report cannot be sent by its owner until every must-have part has Prima's figures or the owner's words. On the due
day Prima still sends it (as decided), and the Director Office board shows which must-have parts were empty.
Settings apply at once to reports not yet sent (Prima's figures and the owner's notes stay) and to every report made after.

## The owner's own choices

The owner may **Leave out** an optional part (it stays listed, greyed, with **Put back**) and **Add part** of their
own (up to 5, with a note). Both are kept: next month's report is made the same way. Must-have parts cannot be left out.

Who reads: the owner, the Director Office (not client reports), group leadership, ACT (department reports), and the
company office (its clients' reports).

## Setting up at go-live

- Run `db/modules/auto-reports-v1.sql` with the other modules (`infra/run-db-migration.sh`).
- The daily run is on by default (`AUTO_REPORTS_ENABLED=false` stops it). Its sign-in `u-report-maker` needs company
  monitor lines from the CEO in the app to make and send company and client reports; without them those are made when
  the owner opens Reports and sent on the due day when the Director Office presses Make now.
- Confirmed by Fauzan (23 Nov 2026): make on the 1st; client report due the 10th; group report due the 7th. The client care
  reminder (rule OPS-CLIENT-CARE `reportByDay`) moved from the 7th to the 10th to match (decision card, 23 Nov 2026).
  Still proposals: the 5-day warning, 600-character notes, 10 added parts per report, 5 own parts per owner.
- The module also makes `prima.auto_report_layouts` (what each report must have): every sign-in reads it, only group
  sign-ins write it, nothing is deleted.
