# Mesyuarat bulanan JA Group and duty checklists (Part Y)

Source: Fitri package Part Y (14 Nov 2026) and Fauzan's answers Y-Q1..Y-Q10 the same day, with the company duty map
(Y11). Rules `GROUP-MONTHLY` and `GROUP-DUTIES` (Policy). Screen: Meetings > Mesyuarat bulanan JA Group
(`apps/web/src/views/GroupMonthly.tsx`). Service `packages/core/src/group-month-service.ts`, one door
`svc.groupMonthAct(user, op, input)`, API `POST /group-month/:op`.

| Item | What is built |
| --- | --- |
| Y1 | Each company's monthly report uses the 14-item template. Prima fills it from the company's last verified Part X toolbox pack (from the month reported to the end of the next month) and adds the monthly-only lines. Each unit's report is its department pack plus the unit sections. The standing plan `grp-general` now falls due by the 18th with the new agenda. "Bil n/yyyy" is numbered per year. |
| Y2 / Y-Q3 | The deadline is 3 working days before the meeting date (public holidays are skipped). The admin team prepares. The company manager or a company director verifies with a comment, never the preparer; for a unit, the unit head verifies. "Siapa sudah hantar" lists every company and unit. A report not verified after the deadline is late and shows on Unit HR's home. One still missing on the meeting day is red to the Director Office. |
| Y3 | New lines:<br>• Item 1: directors from the company secretary register, plus a paid-up capital note. Shareholders go to SULIT.<br>• Item 5: open court cases from Legal.<br>• Item 9: guard pay method counts, recorded by the company because guard pay stays in JA.<br>• Item 10: JTK complaints and audits register. The complainant is recorded by staff number only.<br>• Items 13 and 14: status lines, which are required. |
| Y4 | Unit sections are added to the department pack for Audit, Finance, FWM and IT. KBK & BMB, Sekolah and Kenderaan sections appear once those units exist as Prima departments. The Audit unit also gets a summary line from the accounts report tracker. |
| Y5 | Accounts report tracker per entity per month. A month's report is due on the 28th of the next month, from the company checklists. The company office or Finance records it as sent, with the file and the Finance team. Internal Audit reviews it, never the sender. Late days are counted. The Friday red/yellow/green report: red when a due report is not sent; yellow when one was sent late or there are open ACT findings; green otherwise. Internal Audit freezes it once a week. |
| Y6 / Y11 | Duty checklist lines can be daily, weekly, monthly, yearly or ad hoc. Each line has a date window, a person in charge, a backup and an SOP reference. The company manager or unit head loads the group template (company manager, admin executive) per person, then adds or removes lines; removing a line needs a reason. A person with checklist lines no longer gets the draft playbook duties. |
| Y7 | A line opens as a task in My Work on the first day of its window, due on its last day at 17:00. Finishing it inside the window with proof counts as on time. "KPI senarai tugas" shows each person's on-time share for the month. The line manager still accepts or returns each task. |
| Y8 / Y9 | Named people's PCB, zakat and shareholdings stay in the SULIT section. Only the CEO, the FD, Internal Audit and the company's directors see the detail; others see "Sulit: n perkara". Each opening is logged. |
| Y8b | A payment can be approved in Prima, in Teams (when that connection is on) or in its SharePoint form, chosen when it is prepared. A SharePoint payment becomes approved only when its approved SharePoint request is linked. The approver named there must be the FD or the CEO (the COO or the CEO for COO subjects), never the preparer or the reviewer, and the person recording it is neither of those. Prima refuses to approve it again. A SharePoint approval is refused on a payment already approved in Prima or Teams. Prima does not connect to Power Automate. |
| Y9 / Y-Q10 | Unit HR sets the date agreed with the CEO and records that the Outlook invites were sent. Prima sends no invites. Unit HR also keeps the minute-taker roster and links the last minutes. Unit HR writes the minutes after the meeting. Pasted AI notes must be ticked as checked before submitting. The Director Office or the CEO verifies, never the preparer. Prima's verified minutes are the record. Catering stays outside Prima. |

## Database

New module `db/modules/group-monthly-v1.sql` (table `prima.group_month_recs`). It is not in the release manifest: the
CEO installs it with `infra/run-db-migration.sh`. Until then the steps are refused with a clear message, and the draft
playbooks stay in use. Read and write walls are in the module header. History is append-only and nothing is deleted.

## Not done by Prima

Real checklist lines and real JTK or pay data are entered by the company or unit only after the real-data go-ahead. The
duty map lists named staff; their names are not in code or seed data. Outlook invites, SharePoint and Power Automate
forms, Loop and OneNote stay outside Prima.

## Tests

Core `packages/core/test/group-month.test.ts`; PostgreSQL `apps/api/test/group-month-pg.test.ts`.
