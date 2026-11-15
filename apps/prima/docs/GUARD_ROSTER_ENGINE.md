# Guard roster, breaks and hybrid pay engine (Part O)

Status: built and tested in code; **not switched on anywhere**. The database part `db/modules/guard-roster-v1.sql` is not on
the release list and needs the CEO's go-ahead to install. Guard pay stays a trial until 1 Aug 2027 (rule PAY-GUARD).
The roster and pay pack v3 (14 Nov 2026) is a draft for HR/Legal sign-off.

Sources: `/mnt/project-files/fitri-instructions/2026-11-13_guard-roster-break-hybrid-pay-part-O.txt` (Fauzan's answers
PO-1 to PO-7, 13 Nov 2026) and the v3 pack in `/mnt/project-files/fitri-instructions/roster-pay-v3/`.

## What it does

| Part | Where | What |
|---|---|---|
| O1 day status | `roster-engine.ts` `RosterStatus` | WORK-D/N, OFF-REST, OFF-ADD, AL, MC, HOSP, PH, UPL, ABS, RELIEF-D/N, TRF, END, PENDING. Planned and actual are separate. OFF is never absence. |
| O2 coverage | `requiredCoverage`, `SiteCoverage` | Posts per shift per date, any calendar (every day, weekdays, exact dates). Billing method kept apart from pay. |
| O3 checker | `checkRoster` | Coverage exact; overlaps across sites; join/leave; licence; armed post; client limits (block); law points (flag RED/AMBER); cross-month windows; fairness. |
| O4 approval | `rosterStepProblem` | OM prepares, Area/Zone Supervisor verifies where the site has one, OD (private) / OGM (government) publishes; reason at every step; nobody approves their own. |
| O6 breaks | `breakPlanProblems`, `workedMinutes` | Slots per post, minute-level minimum active guards, max segment; unpaid only if confirmed and relieved with client permission; interrupted minutes paid; paid breaks (IKEA) never deducted. |
| O7 formula | `PayFormulaAmounts` new fields | `payMode`, `normalWorkingDaysPerMonth`, `incompleteMonthMethod`, `otRateBase`/`otFixedBase`/`otRateRounding`, `restDayExtraTreatment`, `restDayNormalRateBase`, `restDayOtMultiplier`, `hourlyRate`. |
| O8 pay | `hybridPay`, wired into `buildGuardPayLine` | Full basic; deduct only UPL, ABS the OD/OGM decided unpaid, and days not employed, at basic / the site's normal working days; OT from verified minutes summed and rounded once at the higher of company and statutory rate; rest-day pay only for duties on OFF dates; public holiday 2 days + 3x. The old `count_days` method is unchanged. |
| O9 allowances | `allowanceLines` | Armed (only with arms authorisation in force), transport (none on company-transport days; per trip), night, supervisor, remote, custom; HR Director verifies, COO approves. |
| O10/O11 | `ledgerTotals`, `rosterExceptions`, `rosterDashboard` | Duty ledger, exception list with owner and due date, site dashboard numbers. |
| O12 evidence | `evidenceCovers` | A document scoped to rule, site, guards and dates; client permission never clears a law flag; expired turns RED again. |
| Lump sum (v3) | `lumpSumConsentProblem`, `hybridPay` | Target never lowers what is due: shortfall alert, or a separate top-up when the target is higher. Consent is the guard's own, never reused or backdated. |

## Example settings (draft, not approved; the ACT Director enters the real ones)

| Setting | IKEA Klang | School zone |
|---|---|---|
| Basic | RM1,700 | RM1,700 |
| Normal hours | 5 x 9 h | 6 x 7.5 h |
| OT base | fixed RM8.72 x 1.5 = RM13.08 | fixed RM8.72 x 1.5 = RM13.08 |
| Normal working days a month | 22 | 26 |
| Breaks | paid by IKEA | two 60-minute unpaid slots, one guard active |
| Coverage | 14 day + 12 night | 2 day + 2 night per school |

## Not built here (later)

O13 auto-roster proposal [WAIT], O14 Sabah/Sarawak rules [WAIT], and the screens and API for roster versions, relief
pool, break recording, allowances, exceptions, evidence and lump-sum signing (next pull request).

## Screens and server actions (Part O O4, O5, O6, O9, O11, O12; 14 Nov 2026)

Built and tested, not switched on. The database part `db/modules/guard-roster-v1.sql` is still off the release list;
installing it needs the CEO's go-ahead. Until it is installed every roster call answers "The guard roster is not
installed in this database yet".

Screen: **Guard roster (engine)** under Operations (and ACT, read only). Guards see their published days and their own
agreements under **Duty → My roster**.

| Step | Who | Server action |
| --- | --- | --- |
| Contract coverage from a date (posts per shift, client limits, break plan, the client's break permission, Area/Zone Supervisor) | Operations Director (private) / OGM (government), with the contract document and a reason | `saveSiteCoverage` |
| Prepare the month; a change after publishing is a new version with a reason | OM | `saveRosterDraft` |
| Submit, verify, publish, return (reason at every step, nobody approves their own, client limits and uncovered posts block publishing) | OM → Area/Zone Supervisor (if the site has one) → OD/OGM | `rosterStep` |
| Record the actual day once | OM or the site supervisor (never the guard) | `recordRosterActual` |
| Correct a recorded day | OM proposes with evidence and a reason; OD/OGM (a different person) decides | `proposeRosterCorrection`, `decideRosterCorrection` |
| Decide an absence unpaid or paid, once | OD/OGM, not the person who recorded it | `decideRosterAbsence` |
| Record and confirm a break (inside the duty, no overlap, within the site's longest break) | OM or the site supervisor | `recordRosterBreak`, `confirmRosterBreak` |
| Permit or permission for a law point (no waiver without a document; never edited) | OD/OGM | `recordRosterEvidence` |
| Guard allowance | Operations proposes from an approval; HR Director verifies; COO approves (three different people) | `proposeGuardAllowance`, `decideGuardAllowance` |
| Agreed lump-sum pay | OD/OGM proposes; COO approves; the named guard signs or refuses in the app (the signed text's SHA-256 and the server time are kept, never backdated) and may withdraw | `proposeLumpSum`, `approveLumpSum`, `decideMyLumpSum` |
| Lump-sum pay on at a site | CEO only | `setLumpSumSwitch` |

Pay run: when the module is installed and a site's month has a published version, the guard pay run reads published
days, verified minutes (clock-in/out inside the duty, minus confirmed relieved unpaid breaks; a single guard on the post
has no unpaid break), ABS decisions, approved allowances and a signed lump sum only where the CEO switched it on. A duty
with no clock-out stays on the exception list and is paid once verified.

Added 14 Nov 2026 (Fauzan: "Built it also"): ACT's check on each permit record (ok or query, once, with a note; the
record itself never changes; `checkRosterEvidence`), a printable monthly roster (codes stay as codes in every screen
language), and the auto-roster suggestion (O13, `proposeRosterMonth`): 5 on / 2 off or 6 on / 1 off, fixed day and night
teams, OFF days spread over the week, cycles carry on across months, fewer past duties start first, leave and dates
outside employment left as PENDING. It saves nothing; the OM reviews, saves a draft, and the normal chain follows.

Not built: Sabah/Sarawak (O14, WAIT).

Tests: `packages/core/test/roster-desk.test.ts` (in memory), `apps/api/test/roster-controller.test.ts` (input checks),
`apps/api/test/roster-desk-pg.test.ts` (local PostgreSQL with the module installed, as the app role under row security).
