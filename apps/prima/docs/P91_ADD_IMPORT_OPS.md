# P91: Add and Import at the top of Operations, Security, Equipment, HR, Payroll and Foreign workers

Fitri, 9 Nov 2026: "where do I add the items? Add manually, or by Excel/PDF? Same with most of the pages: we only see tables
but don't see where to add them. The add side must be flexible as we are moving from the old system to the new one."

This is the screen-by-screen record for the Operations, Security, Equipment (not Items), HR, Payroll and Foreign workers
menu screens: what records each keeps, where Add is, which import kind loads it from a file, or why not. It follows
`P90_IMPORT_AUDIT.md`; **P91** marks what this change added or moved.

Rules kept: the Add and Import buttons show only to people the server already lets add that record (the button is a hint;
the server checks every saved or imported row through the same call as the manual Add). Workflow screens (cases, claims,
SOCSO claims, rosters, duty plans, pay runs, advances, attendance) are not bulk-loaded as live work: their own "New …"
button is at the top instead. No new tables, migrations or permissions.

## New import kinds (P91)

Each row goes through the screen's own add, with its own permission, checks and audit entry; the preview is a dry run of
the same save; the import is all or none with a receipt (P81/P90). Rows name people, vehicles and sites the way old lists
do; a row that names nothing in Prima, or more than one, is refused in plain words. The same record already in Prima is
refused, so a second file that overlaps does not double anything. Code: `packages/core/src/org-import-ops.ts`.

| Kind | Screen(s) | Create path (permission) | Row finds | Not loaded / kept out |
|---|---|---|---|---|
| `staffTraining` Training records | HR monitor (top menu and Training card), Guards (guard papers card), Hand-overs | `recordTraining`: HR (or the owner) for anyone; the company head or Operations (OM, Regional OM, Ops Director, OGM, COO) for guards they cover | Staff number, or the exact name; an IC/passport column, when given, must agree with the masked IC kept in Prima | Nobody records their own training. The same course on the same day for the same person is refused. Cost is a historical figure only; nothing is paid |
| `guardPaper` Guard papers (KDN card, eSIMS vetting, CSG, TNG) | Guards (top), HR monitor (top menu), Hand-overs | `recordGuardPaper`: HR, or the guard's company head or Operations for guards they cover | Guard by staff number or name (+ IC check); the paper by its words ("Kad KDN", "Sijil CSG", "eSIMS", "TNG") | Guards themselves still come only from the JA feed. Firearm and foreign worker papers are refused by the create path. The KDN card needs its expiry date. The same paper (type, number, issue date) is refused |
| `fuelCard` Fuel and subsidy cards | Vehicles (top, Transport only), Fuel and usage panel, Hand-overs | `addVehicleCard`: Transport only | Vehicle by plate (spaces ignored) | Only the last 4 digits are kept, even if the file has the full number; the preview masks it. A card already kept for another vehicle is refused unless the Transport head consents (by hand). Reason defaults to "Existing card, loaded from the old list" |
| `cmsDevice` Site devices for CMS readiness | CMS site readiness (top), Hand-overs | `saveCmsReadinessDevice`: company manager, admin executive, supervisor (own sites), Arms Control, the OM/Regional OM under an act grant, the CEO in the pilot | Site by code or name | No logins or passwords. Nothing is connected. A site's checked readiness changes as it would by hand |
| `siteKitItem` Site fittings plan lines | Site stock and fittings (top), Hand-overs | `saveSiteKit` (through `importSiteKitItem`, which adds one line to the plan already there, with its version): the OM, Regional OM or OGM who manages the site | Site by code or name | Installs, monthly checks and take-backs still need the supervisor's time-marked photo (not loadable). The same item name on a site is refused |

Not made into import kinds, and why:

- **Guard loans and advances history** (`recordGuardLoan`, `setGuardAdvances`): each record is a live request: HR records,
  the Chief of Staff then the CEO approve, Finance pays out, the pay run takes repayments; the wage advance waits for the
  Operations Director or OGM. A history row (already paid, part repaid, past first month) cannot be created without
  skipping those approvals and the payout step (the create path refuses a first repayment month in the past). Left to
  the forms; old balances need the CEO's decision on an "old records" archive (the lead is proposing it).
- **Foreign worker paper renewals** (`recordFwPaper`): a renewed paper needs its copy attached (rule). Not bulk-loaded.
  Paper dates typed when a worker is first added still come in through `fwWorker` (P90).
- **Worker placements** (`recordFwPlacement`): placements start monthly charges and paybacks (money). Left to the form.
- **Public holiday lists per state** (`setPublicHolidays`, Site man-hours): a whole year's list per state, set by the Ops
  Director or OGM with a reason and checked against the Act; HR's `publicHoliday` import covers the holiday list itself.
- **Arms register kinds** (vaults, firearms, dealer licences, armed job agreements): kept on their own reviewed path (P81).

## Screen by screen

| Menu | Screen (view) | Records | Add (where) | Import (kind) or why not |
|---|---|---|---|---|
| Operations | Operations board (`ops`) | Sites (board) | **P91** "Add site" in the page head (shows only to those who may add a site) | **P91** "Import sites" (`site`) in the page head |
| Operations | Sites (`sites`) | Sites, posts, checkpoints | "Add site" page head; Add post / checkpoint on the site | `site`, `post`, `checkpoint` (P81) |
| Operations | Far branches (`branchwork`) | Checklists, visits, audits per branch (workflow) | Each branch's own checklist and visit forms | Workflow with photo proof; not loaded. Branches themselves: Branches screen (`branch`, P90) |
| Operations | Site survey (`surveys`) | Site surveys (workflow, offline) | "New site survey" page head | Workflow with photos and measurements; not loaded |
| Operations | Site man-hours (`sitehours`) | Extra-hours approvals; public holiday lists per state | Approve on each site; "Set the 11 public holidays" on each state card | Approvals are workflow; holiday lists see above |
| Operations | Guards (`people`) | Office staff; guards and officers (from JA); guard papers | "Add office staff" page head; **P91** "Record guard papers" page head (jumps to the papers list) | `officeStaff` (now labelled **P91** "Import office staff"); **P91** "Import guard papers" (`guardPaper`) in the page head and on the papers card; **P91** "Import training records" on the papers card. Guards: JA feed only |
| Operations | Roster (`roster`) | Shifts (workflow) | "Add shifts" page head | Workflow; shifts are checked one by one (papers, hours, rest); not loaded |
| Operations | Guard duty plans (`duty`) | Duty plans per post and officer routes (workflow) | Made from the roster on each post / route, then published | Workflow; not loaded |
| Operations | Attendance (`attendance`) | Day sheet, absences, leave (workflow); monthly timesheets | Clock-ins only from the site device | **P91** "Import timesheet" in the page head (same import as Monthly reports, same check `canImport`; opens Monthly reports after). Only on the server: the demo has no timesheet store |
| Operations | Cleaning plans (`cleaning`) | Cleaning sites and daily plans | **P91** "Set up cleaning at a site" in the page head (jumps to the set-up form, which was only under the list) | Set-up needs the contract scope and crew; plans are workflow; not loaded |
| Security | Cases (`cases`) | Incidents and complaints (workflow) | "Raise a case" page head | Workflow with response clocks; not loaded |
| Security | Arms control (`arms`) | Vaults, firearms; suppliers and price list (Arms Control tabs) | "Add vault", "Add firearm" at the top of their cards; suppliers in their tab head | `armsSupplier`, `supplierItem` (P81); vaults, firearms, dealer licences, armed jobs kept out (P81) |
| Security | CMS (`cms`) | Phone extensions, CMS staff, CCTV and alarm panels | Card heads; **P91** "Add CCTV or alarm" also at the top of the Sites list (was only on each site's line) | `phoneExtension`, `cmsStaff`, `siteSystem` (P81) |
| Security | CMS site readiness (`cmsready`) | Devices per site, readiness answers | **P91** "Add device" page head (asks which site, then opens that site's device form) | **P91** "Import devices" (`cmsDevice`) page head. Answers need proof references and the check is a review: not loaded |
| Security | Site device (`device`) | None (the shared site phone) | n/a | n/a |
| Equipment | Site stock and fittings (`sitestock`) | Fittings plan per site; installs and checks | **P91** "Add fittings" page head (opens fittings for one site); **P91** "Add an item" at the top of the plan (was only under it) | **P91** "Import fittings" (`siteKitItem`) page head. Installs and checks need a photo: not loaded |
| Equipment | Vehicles (`fleet`) | Vehicles; fuel and subsidy cards | "Add vehicle" page head; "Add card" on each vehicle | `vehicle` (P81); **P91** "Import fuel cards" (`fuelCard`) page head and Fuel and usage panel (Transport only) |
| Equipment | Asset Management (`assets`) | Units, assets, work orders, tenancies | "Add unit" etc. page head and each tab head | `amUnit`, `amAsset`, `amWorkOrder` (P81); tenancies edit a unit |
| HR | HR monitor (`hr`) | Training, guard papers, public holidays, leave days above the Act; many workflow queues | **P91** "Add" menu in the page head: Training record, Guard papers, Public holidays, Leave days above the Act, Office staff (each only for those who may add it); "Record training" at the top of the Training card | **P91** "Import from file" menu in the page head: `staffTraining`, `guardPaper`, `publicHoliday`, `leaveEntitlement`; **P91** "Import training records" on the Training card; holidays and leave days keep their card buttons (P90/P81). Queues (pay changes, joiners, vacancies, movements, cases, appraisals, leave requests) are workflow |
| HR | Staff directory (`staff-directory`) | Office staff directory | **P91** "Add one person" and "Load the staff list (CSV)" at the top (jump to the two forms) | Its own reviewed CSV batch with a second person approving (not the generic import) |
| HR | Staff clock (`staffclock`) | Clock-ins (board) | Staff clock in on their own phone | Workflow; not loaded |
| HR | Work KPIs (`work-kpi`) | Measured from the work itself | n/a | Dashboard |
| HR | Hand-overs (`handovers`) | Every importable kind | n/a | Generic import tab; **P91** kinds added to its list |
| HR | Claims (`claims`) | Staff claims (workflow) | "New claim" at the top of My claims; "Enter for staff" tab | Money with approvals; not loaded |
| HR | SOCSO claims (`socso`) | SOCSO claims (workflow) | "Start a claim" page head | Workflow with Form 34 deadlines; not loaded |
| Payroll | Staff payroll (`staffpay`) | Pay runs | "Start a payroll month" page head | Money; not loaded |
| Payroll | Guard pay (`guardpay`) | Pay runs per company and month | "Prepare" on each company's month | Money; trial only; not loaded |
| Payroll | Pay formulas (`payformulas`) | Formulas and where each is used | "New guard salary formula" (now **P91** the primary button) and the other New buttons at the top | Set by the ACT Director with legal checks; not loaded |
| Payroll | Salary calculator (`salarycalc`) | None | n/a | Calculator |
| Payroll | Statutory rates (`statutory`) | EPF, SOCSO, EIS, PCB tables | Load and check each table on the screen | Second-person check per table; not loaded |
| Payroll | Wage advances (`advances`) | Advances (workflow) | "Set advances" form at the top for the OM | Money with approval; not loaded (see above) |
| Payroll | Advances and loans (`loans`) | Loans and advances (workflow) | "Record an advance or loan" form at the top for HR | Money with CoS and CEO approval; not loaded (see above) |
| Foreign workers | Foreign workers (`fwm`) | Workers and papers | "Add foreign worker" page head (P90) | `fwWorker` (P90); renewals need the copy (rule) |
| Foreign workers | Recruitment cost (`fwcost`) | Placements, charges, rates | "Record a placement" at the top of Placements | Money; not loaded |
| Foreign workers | Nepali EPF and SOCSO (`fwstat`) | Months to charge, debit notes (workflow) | Each month's own step | Money; not loaded |
| Foreign workers | Hostels (`hostels`) | Hostels; bills (workflow) | "Add hostel" page head | `hostel` (P81); bills are workflow |
| Foreign workers | Arrival cash (`arrivalcash`) | Arrival cash advances (workflow) | "New arrival request" for the company | Money with review; not loaded |

## Tests

- Core: `packages/core/test/org-import-p91.test.ts` (messy Malay/English sheets, title rows, dd/mm dates, RM amounts,
  wrong IC, unknown staff number, duplicates, and refusals for people who may not add each kind).
- API on PostgreSQL: `apps/api/test/import-p91-pg.test.ts` (each kind imported by the right person; Transport, HR, another
  company's manager or another region's OM refused at preview and at import; nothing written; full card numbers never stored).
