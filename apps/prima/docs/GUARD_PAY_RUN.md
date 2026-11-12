# Guard pay run

Fauzan, 5 Nov 2026 (third audit, item 1: "Build"): Prima's own monthly pay for guards, stationed officers and
patrolling officers, with payslips and a bank file, reading the ACT pay formulas (PR #112, `docs/PAY_FORMULAS.md`).

Status: draft, synthetic data only. Not merged, not migrated, not deployed. The JA Group app still pays guards.

Switch date (Fauzan, 8 Nov 2026): Prima takes over guard pay on 1 August 2027 (rule PAY-GUARD `switchDate: '2027-08-01'`; `primaPays` stays off until then). Until then the JA Group app keeps paying guards and Prima pay runs are side-by-side trials only. The pay formulas and guard pay modules are optional and installed later as their own step, never with a release (`docs/RELEASE_MODULE_INSTALLATION.md`).

## Who does what

Each security company prepares its own pay run (Fauzan, 11 Nov 2026, P100 B1: "each Company Manager monitors the pay run
and delegates the preparing to whoever they choose in their company"). HR (PWVSB HR officers) and the OMs no longer prepare.

| Step | Who | Notes |
| --- | --- | --- |
| Name the preparer(s) | The company's Company Manager (or General Manager) | An admin executive or another manager of the same company, with a reason; changeable later (each naming and removal kept and audited). Never themself, an OM, central HR or a guard. Office module `db/modules/guard-pay-preparers-v1.sql` (forced row-level security: only that company's manager writes; read by the company's managers, the person named, HR and leadership). A named preparer gets the read-only `pay_read` door to the ACT formulas, the pay law and the statutory rates. |
| Prepare / recalculate | The preparer the Company Manager named for that company | This month or last month, their own company only. Public holidays come from the yearly guard lists (below). Can enter a PCB from e-PCB or a one-off item with a reason (flagged for the COO). |
| Record whose account it is | HR | Own, joint, immediate relative's or close friend's; bank or e-wallet. Someone else's account needs the guard's consent letter, stamped by a Commissioner for Oaths (Pesuruhjaya Sumpah). |
| Approve a consent letter | COO only, no CEO stand-in (Fauzan, 6 Nov 2026) | Reason required; not the HR officer who recorded it. Until approved the account cannot be paid into. |
| List a guard for cash | Director Office staff | Only for a guard with pay and a reason. |
| Give or refuse cash | COO or CEO | Reason required; not the person who listed it. |
| Hand out cash | CEO or COO | Once the month is approved, never on a trial month; records the date. |
| Upload the signed cash receipt | Director Office staff | The guard's signed receipt paper, as proof (PDF, JPEG or PNG; SHA-256 kept). |
| Record an advance or loan | HR | Limit, purpose, repayment period (1-24 months), the worker's signed agreement. |
| Approve an advance or loan | Chief of Staff, then the CEO | Reason each; nobody decides a record they made or already approved. Finance is told at each step. |
| Pay out an advance or loan | Finance | Bank reference; only once Prima pays guards (repayments come off Prima's pay run). |
| Submit | The company's preparer | Refused while the month is open, any guard with pay has no account they can be paid into and is not listed for cash, any worked site has no formula, any shift is unlocked or has no clock-out, or a line is negative. |
| Approve | COO (CEO stands in during the pilot) | Reason required (approval-reasons rule). Nobody approves a month they prepared or submitted. Refused while a cash listing waits for a decision. Can return it to the company's preparer with a reason. |
| Pay | Finance (FD or a Finance team member) | Bank reference + PCB checked. Refused while the run is a trial or a cash listing is undecided. Paid after the 7th is recorded as late (EA s.19). |
| Files | Finance (bank file, e-wallet list), HR + Finance (SQL journal, EPF, SOCSO/EIS, PCB lists), Finance + Director Office + COO/CEO (cash list) | After COO approval. A trial file's first line says DO NOT UPLOAD. |
| View | Group leaders and HR; the Company Manager sees every run of their own company | Read only. |
| Payslips | The guard or officer, on their Duty screen | Paid months only. |

Rule `PAY-GUARD` (`RULES.guardPayroll`): `primaPays: false` until Fauzan picks the JA switch date. While off, every run
is a trial compared with JA's payroll feed for the same company and month (headcount, gross, net, difference), never
marked paid. The database refuses a trial stored as paid (`guard_pay_runs_trial_unpaid`).

## Paying out (Fauzan, 6 Nov 2026)

"Make sure every guard or staff are paid using bank account or e wallet only. Cash are not acceptable. A written consent
are needed for using immediate relatives or close friends accounts ... Only coo and ceo can give the cash if there is a
need for it. The list will be collected and submited by director office staff." Then: "Consent letter must be approve by
coo. The letter must have notory stamp by pesuruhjaya sumpah."

- Bank lines go in the bank file; e-wallet lines go in their own list; cash lines (given by the COO or CEO) go on the
  cash list. Fauzan, 6 Nov 2026: "Cash only by exeption. Director list will send cash person list per site per name and
  the amount, cash will be given out by ceo or coo. Signed paper of the receive collected and upload as proof. Upload
  done by director office." The cash list is grouped by site with each name and amount; the CEO or COO records the
  hand-out; the Director Office uploads the guard's signed receipt; the run shows how many are handed out and receipted. A line with no usable account blocks submission unless the Director Office lists it.
- The same account rule applies to staff payroll at submission.
- One-off deductions: equipment is never charged to the guard (EA s.24). Uniform and lost or damaged item deductions are
  a management and legal decision, not settled in code (Fauzan, 8 Nov 2026). Rule PAY-GUARD `uniformDeduction` stays
  `awaiting_decision`, so no uniform or item deduction is accepted, until they decide between the paper "Kertas
  Pelaksanaan Prima Uniform dan Peralatan" (6 Nov 2026: no automatic salary deduction) and PR #120's path
  (`fourth_fifth_set`: only a 4th or 5th uniform set, flagged on the line as an EA s.24 legal point for the CEO). A guard
  who pays for an item does so on the item, outside payroll. Advances and loans are taken back only from their approved,
  signed records.
- Legal flags kept on every such line for the CEO: EA s.25 asks for the worker's own or joint account, so an e-wallet or a
  third-party account is a legal point even with consent.
- Pay by the 7th of the next month (rule PAY-GUARD payByDay, EA s.19); the run shows the due date.
- The daily cash buffer (Finance PR #49, rule FIN-DAILYCASH) is not on this branch; the same rule needs adding there.

## Wage advances (Fauzan, 6 Nov 2026)

- The OM (or Regional OM) sets the amount and pay date (default the 20th) for one guard, or in bulk for a site, a zone
  (assumed to be a branch) or a region, from each guard's latest rostered site. This month or next month only.
- The Operations Director approves for a private site, the OGM for a government site, with a reason; one or many at once.
  Nobody approves an advance they set or changed. Any change after approval goes back for one more approval.
- Refused: no usable account, a second advance in the same month, or more than last month's wages in Prima (EA s.22). When
  last month is not in Prima the advance is flagged.
- Finance marks an advance paid with the bank reference, only once Prima pays guards. The month's pay run takes only
  actually paid advances back from net pay, after statutory shares. Approval without payment never creates a deduction.
  The recorded payment date must be within the advance month. A new advance payout is refused after the monthly run
  is submitted: return it to HR first; no further advance can be added to an already paid month.

## Advance and loan scheme (Fauzan, 6 Nov 2026, IWAY item 4)

"Yes. Approve by cos and ceo. Finance must be notify and monitored about this." Separate from the wage advance on the 20th.

- Each record: kind (advance or loan), limit, amount lent (not over the limit), purpose, repayment period in months, the
  first repayment month, and the worker's signed agreement (reference and date). Paid into the guard's own usable account.
- HR records it; the Chief of Staff approves, then the CEO, each with a reason. Finance gets a notice on every step,
  pays it out with a bank reference and sees what is lent and still owed.
- The pay run takes repayments only from these records: a one-off item naming a loan or advance is refused.
- All the employer's deductions together (one-off items, hostel utilities, wage advances and these repayments) stay
  within half the month's wages (EA s.24(8); assumption: statutory shares and PCB are outside the cap). What does not fit
  waits; the balance stays on the record. Over 50% before any repayment holds submission, approval, payment and unpaid-run exports; HR must resolve it.
- When the month is paid, each repayment comes off its record; at zero it is settled. The database refuses a record
  without both approvals, with the two approvals by the same person, or lending more than its limit.

## Public holidays and man-hours (Fauzan, 6 Nov 2026)

- Guard holidays come from the yearly lists the Operations Director or OGM set (PR #112): the state list of the guard's
  main site, else the whole-company list. Staff holidays are different and are never read here. HR enters holidays only
  for a company with no yearly list.
- EA s.60D(2): a guard absent without leave on the rostered working day just before or after a holiday is not paid for it
  (closed month only).
- Sites over their man-hours without OD/OGM approval are flagged on the run and on each guard's line. Wages are not held,
  because they are due by the 7th.
- A holiday on a guard's rest day is not moved yet: guards have no fixed rest day in the roster.

## How a line is worked out

- Formula: the site the guard worked most days at this month; its formula is resolved site > company > region > group
  for the month (PR #112). Other sites on a different formula are flagged; a missing formula at any worked site blocks submission, approval,
  payment and unpaid-run exports under either multi-site setting. Per-site calculation never substitutes the main-site
  rate for a missing secondary formula.
- Days: a shift counts only with a clock-in, a clock-out and the supervisor's lock (W11). Two shifts on one day count once.
- Full month = the formula's `fullMonthDays` (26). Approved paid leave (annual, MC, training: one normal day, no OT) and every public holiday are paid days.
  Paid leave is paid at basic pay only (Fauzan, 11 Nov 2026, P100 C1b): each fixed allowance's daily share (allowance / the
  day divisor) is taken off for every paid leave day, and no overtime is paid for it.
  A dated leave day is counted once, excluding days already worked or counted as paid public holidays. Overlapping
  leave records do not create extra paid days. Ordinary days worked past that room are rest days worked; days short of
  it are unpaid at the daily rate (closed month only).
- Rates (EA s.60I through the formula): daily = basic / the pay law's day divisor for the month (26 today, set by the CEO in PR #112), hourly = daily / normal hours. Overtime = the hours
  actually worked past the normal day on each day worked, up to the formula's OT hours per shift (P100 B1b), at the working-day, rest-day or holiday rate. Rest-day and holiday work add the
  formula's extra days' wages. Fixed allowances from the formula.
- Statutory: rates come from the statutory settings in force for the pay month (see below). Today: EPF on gross less
  overtime (KWSP), foreign 2%/2%; SOCSO and LINDUNG 24 Jam in separate columns; EIS for Malaysians 18-59; any new
  contribution the CEO adds is its own column; HRD 1% on basic and fixed allowances, Malaysians; PCB estimate unless
  HR enters the e-PCB figure. Hostel utility deductions HR already approved for that payroll month are deducted.

## Hours recorded and paid must match (P100 B1b, Fauzan 11 Nov 2026)

"Salary and total working hours must match." Every line shows the hours recorded beside the hours paid:

- Recorded: hours worked from locked attendance (clock-in to clock-out inside the rostered shift; a clock-in within the
  late grace and a clock-out within the early grace count the whole shift, rules OPS-LATE-GRACE and OPS-EARLY-GRACE; a
  rest the guard is relieved for comes out of the time past the normal day), plus approved paid leave, training and MC
  days and paid public holidays off at the formula's normal hours.
- Paid: normal hours, overtime, rest-day and public-holiday hours, paid leave and holidays, and any days of basic paid with
  nothing recorded (only when ACT's formula says not to deduct short days).
- A line whose totals differ is held: it cannot be changed (PCB or one-off item), and the run cannot be submitted, approved,
  paid or exported. Typical causes: a day shorter than the normal day the basic pays, hours past the shift the formula pays
  (for example two shifts on one day), basic paid for days with no attendance or leave. The fix is the attendance or leave
  record, corrected with its own approval and reason, then a recalculation. The pay line is never changed to hide it.
- Calculation version 3: unpaid runs calculated before this must be recalculated.

## Database

Optional module `db/modules/guard-pay-v1.sql` (proposal `db/proposed/guard-pay-module.json`): two company-walled tables,
`prima.guard_pay_runs`, `prima.guard_pay_advances` and `prima.guard_loans`, plus `prima.statutory_versions` (CEO writes, HR/Finance read), no DELETE, stage, status, period and amount checks. Not in the release manifest. Installing it needs Fauzan's
approval and the CEO-run migration window. Until then the screen shows no runs and preparing is refused plainly.

## Settings on the formula (ACT Director)

Fauzan, 5 Nov 2026: "Every formula can set by act director". Besides the amounts, each guard shift formula carries the
pay run settings, set on the Pay formulas screen and versioned with the formula:

| Setting | Default | Choices |
| --- | --- | --- |
| A month at more than one site | Main site's formula for the whole month | Or each day's overtime and extra pay at its own site's formula (basic and allowances stay on the main site's) |
| Public holidays are paid days | Yes (EA s.60D) | Off is flagged as a labour law point |
| Deduct days short of the full month | Yes | Off: only approved unpaid leave is deducted |
| Rest-day and holiday day pay are EPF wages | Yes | Off is flagged for Finance to confirm with KWSP |

Not on the formula: the day divisor (pay law, PR #112) and the EPF, SOCSO, LINDUNG, EIS and HRD rates (statutory
settings below). Both are set by the CEO by month.

## Statutory rates by month (CEO, Fauzan 6 Nov 2026)

"Ceo have the flexibility control to set how salary is set ... Even with socso or epf or add new way."

- Screen *Statutory rates*: the CEO sets, from a month onward, EPF (employee, employer below/above the wage limit,
  older and foreign rates, band rounding), SOCSO (rates, wage cap, older employer rate), EIS (rates, cap, ages,
  Malaysians only), LINDUNG 24 Jam (rate, cap) and HRD (rate, Malaysians only).
- New contribution types: code, name, employee %, employer %, wage cap, whether overtime counts, who it applies to
  (all, Malaysians, foreign), age limit and payee. Each shows as its own column on payslips, totals and the SQL journal.
- Every change needs a reason and the law reference; it cannot be backdated before last month; the old version is
  kept. Guard pay and staff pay both read the version in force for the pay month. Today's law is the default.
- HR and Finance see the settings; only the CEO changes them (also refused in the database).
- Database: HR now has a read-only `pay_read` door to the pay formulas, pay law and statutory settings. Before this,
  the real database hid ACT's formulas from HR and the pay run could not find a formula.

## Open points (assumptions)

1. Settled 11 Nov 2026 (P100 B1): each company prepares its own guard pay, by the person its Company Manager names; not
   HR and not the OM. HR still records salary accounts and consent letters, the advance and loan scheme, and takes the
   statutory lists after approval.
2. A zone for bulk advances is a branch.
3. Officers (stationed and patrolling) use the guard shift formula of their main site.
4. The test link now carries 40 days of shift history so last month can be run.
5. EPF/SOCSO use percentages with EPF rounded up to the ringgit; the published band tables (PR #49) replace them when merged.

## Independent payroll repair checks (7 Nov 2026)

- The salary calculator and payroll both include a worked public holiday in the basic-paid month, once. Rest-day work
  remains additional. Existing ACT holiday/short-day options and advisory legal flags remain in force.
- Partial-range leave (for example 2 working days somewhere in a 3-calendar-day range) cannot identify the leave dates.
  When it intersects work, a paid holiday, another leave record, or a month boundary, the draft is held. HR must resolve
  the dated leave before release; no new workday allocation, substitute-holiday or legal policy is inferred. An isolated
  whole-month record retains its approved count. Conflicting paid and unpaid leave is also held.
- Submit, approve, pay, unpaid-run exports and cash handout recheck hard holds. Current paid advance IDs and totals must
  match the snapshot; a later payout requires HR recalculation. Payout and release use the same company/month lock.
- Unpaid snapshots calculated before these checks must return to HR and be recalculated. Already paid historical runs
  remain unchanged. Older unpaid periods outside the existing preparation window require a separately reviewed
  reconciliation path, rather than silently changing history or extending the window.
- The enforced 50% test is the existing employer-recovery cap, including utilities, one-off deductions, wage advances
  and scheme repayments. Whether statutory deductions and PCB belong in the legal cap remains unresolved. This repair
  does not certify legal compliance, modify ACT/CEO legal discretion, change statutory tables or enable live payroll.
