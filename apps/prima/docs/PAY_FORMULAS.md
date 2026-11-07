# Pay formulas set by ACT

Fauzan, 5 Nov 2026:

> Make sure guard salary counting formula can be set per site or per company or per region or per whole company. All
> be set by act director. For now we set the normal calculation formula for work full month with 12 hours shift. With
> 2 hours rest per day, 2.5 hour, 3 hour.
>
> Make sure also there is formula for driver who overtime. Formula of everyone can be set the amount by act department.

Fauzan's answers later on 5 Nov 2026:

> Labour law is a flag in ceo. But formula can be at the amount act director chose.
> 1. Yes. Act set formula for everyone overtime. 2. Yes [install the database part] 3. As i said before. Security guard got exemption.

Status: draft PR only. Not merged, not migrated, not deployed. Test amounts only. Installing the database module is
approved by Fauzan; it still goes through the release path.

## What it does

- **A formula** is a named set of amounts: basic pay, normal hours a day, working days a week, overtime rates (working
  day, rest day, public holiday), extra days' wages for a rest day or public holiday worked, and fixed allowances.
  Guard formulas add the shift length, rest hours, whether the guard is relieved during the rest, and the days counted
  as a full month. Driver and staff overtime formulas add an overtime meal allowance and an outstation allowance (0 = none).
- **Who sets it.** The ACT Director sets a formula live directly. The rest of ACT (Deputy, Assistants) prepare a
  change, which waits for the ACT Director to set it live or send it back. Every save and decision carries a reason.
  The preparer can withdraw a draft. Group leadership (CEO, COO, Finance Director, Chief of Staff, Chairman, Vice
  Chairman) sees everything and changes nothing. HR, company managers and everyone else do not see the screen.
- **Where it is used.** The ACT Director picks the formula for the whole group, a region, a company or a site, from a
  month. The narrowest choice wins: site, then company, then region, then the whole group. "None" on a region,
  company or site hands it back to the wider choice. Driver and staff overtime formulas are set for the group, a region or a company
  (they have no guard post). A site's region comes from its branch's state.
- **Versions.** Changing amounts makes a new version of the same formula code from a month. Older months keep the old
  version. Nothing starts in a past month.
- **Worked month.** Each formula shows a worked month. "Which formula pays here?" shows the formula in force for a site,
  company or month, and the worked month for it.

## The standard formulas (test copy)

| Code | Shift | Rest | Worked | Overtime a day | Full month (26 days) |
|---|---|---|---|---|---|
| STD-12H-R2 | 12 h | 2 h | 10 h | 2.5 h | 65 OT hours |
| STD-12H-R2.5 | 12 h | 2.5 h | 9.5 h | 2 h | 52 OT hours |
| STD-12H-R3 | 12 h | 3 h | 9 h | 1.5 h | 39 OT hours |
| DRV-OT | driver, 8 normal hours, 5.5 days | | hours entered | | |
| STAFF-OT | everyone else's overtime, same shape as drivers | | hours entered | | |

How a month is counted (EA s.60I; the CEO can change the divisor in the pay law settings): daily rate = basic / 26, hourly rate = daily rate / normal hours (7.5 for a six-day
week at the 45-hour limit). Basic pay is paid for the full month (26 working days); a day not worked takes off one daily
rate. Overtime on a working day is hours x hourly rate x 1.5. A rest day worked adds one daily rate plus its overtime
at 2x; a public holiday worked adds two daily rates plus its overtime at 3x.

With the placeholder basic of RM1,700, STD-12H-R2 comes to RM1,700 + 65 x RM8.72 x 1.5 = RM2,550 gross, which matches
the blueprint's Structure C. Group default: STD-12H-R2 for guards, DRV-OT for drivers, STAFF-OT for all other staff; one sample site uses
STD-12H-R3.

The basic pay is the minimum wage as a placeholder and there are no allowances: **ACT sets the real amounts**. Nothing
here is a real rate.

## Fauzan's usual guard rules (6 Nov 2026) and how the standard formula matches

> Usually, for guard, basic is calculated by 45 hours of work a week. We calculate easier using hours of work. 1 rest
> day per week. Overtime in normal days is paid 1.5 times of normal hour rates. If working on rest day, 7.5 hours of
> work is paid 1 normal day rate. For overtime in rest days is paid 2 times normal hour rates. For public holidays, 2
> times for normal hours, and 3 times for overtime hours.

| Rule | Standard formula setting | Same? |
|---|---|---|
| Basic covers 45 hours a week, 1 rest day a week | 7.5 normal hours a day x 6 days | Yes |
| Hourly rate | basic / 26 / 7.5 = basic / 195, equal to basic x 12 / 52 / 45 | Yes |
| Working-day overtime 1.5x | otNormalRate 1.5 | Yes |
| Rest day: 7.5 hours = 1 day's pay | restDayDays 1 | Yes |
| Rest-day overtime 2x | otRestDayRate 2 | Yes |
| Public holiday: normal hours 2x | publicHolidayDays 2 (on top of the month's pay, which already covers the holiday) | Yes |
| Public-holiday overtime 3x | otPublicHolidayRate 3 | Yes |

These are the Employment Act minimums (s.60, s.60A, s.60D, s.60I), so the standard formula raises no flag. ACT can
still change any of them; a lower figure is saved and flagged to the CEO.

Worked month at the RM1,700 placeholder (12-hour shift, 2 hours rest relieved: 7.5 normal + 2.5 overtime a day):
hourly RM8.72, daily RM65.38; 26 working days give RM850.00 overtime; each rest day worked adds RM65.38 + 2.5 x RM17.44
= RM108.97; each public holiday worked adds 2 x RM65.38 + 2.5 x RM26.15 = RM196.15.

## Site man-hours (Fauzan, 6 Nov 2026)

> The most important we monitor guard total hours when we do salary. A site that need 2 guard per shift of 12 hours a
> days. For a 30 days month. Total man power need is 4 people. Total man hours cannot exceed 1440 hours. Flag any total
> hours that be more. Od or ogm need to give approval if it will be more than supposedly number of total hours. Usually
> happen when some guard training, anual leave, or on job trainig.

Screen "Site man-hours" (menu for operations, HR, ACT, the company office and group leadership; not guards or site
devices), rule SITE-HOURS.

- **Allowed hours** for a site and month = for every post, guards per shift x hours the post is covered a day x days in
  the month. Shift types: A (2 x 12 h) and B (3 x 8 h) cover 24 h, C day and D night 12 h, E office 9 h. People needed =
  guards per shift x shifts a day. Fauzan's example: 2 x 24 x 30 = 1,440 hours, 4 people (a 31-day month is 1,488).
- **Hours counted**: rostered hours from the roster; worked hours from clock-in to clock-out inside the rostered shift
  (early clock-in or late clock-out adds nothing). Hours with no shift, for example a new guard on on-the-job training,
  count in full. A night shift counts in the month it starts.
- **Flags**: *over* (worked above allowed + approved), *roster over* (the month's roster is above it), *heading over*
  (the month is still running and hours worked so far are above the allowance up to now), *extra approved*.
- **Approval**: the Operations Director for a private site, the OGM for a government site, from the site's sector. Each
  approval adds extra hours for that site and month, with a cause (training, annual leave, on-the-job training, client
  asked for more, other) and a reason; several add up. Approvals are add-only and audited (ops.site_hours.approve).
  Nobody else approves, including the COO and CEO; they see the board.
- Stored in `prima.site_hours_approvals` (company wall, SELECT and INSERT only), in the same optional module as the
  pay formulas. The hours themselves are counted live from shifts and attendance.
- Not yet: the guard pay run (draft PR #120) does not yet stop on a site that is over without approval; that is the
  next step once both are reviewed. The board is per company and month; a group-wide list of flagged sites is not built.

## Public holidays (Fauzan, 6 Nov 2026)

> Om or ogm need to set the 11 days of public holiday per years each 10 December every year. Guard not working on the
> day still been paid 7.5 hours as follow one work day.

Checked against the Employment Act 1955 s.60D (rule PAY-PUBLIC-HOLIDAYS), and it is correct:

- 11 paid public holidays a year; five are compulsory: National Day, the Agong's birthday, the Ruler's birthday or
  Federal Territory Day, Labour Day, Malaysia Day. The employer posts the list before the year starts, so 10 December
  is in time.
- A guard who does not work on a holiday is paid one normal day: basic / 26, which is 7.5 hours x the hourly rate. For a
  monthly-paid guard it is inside the monthly pay (no deduction). Working it pays 2 extra days + overtime at 3x.
- A holiday on the guard's rest day moves to the next working day; a holiday during annual or sick leave is a holiday,
  not a leave day; a guard absent without consent or good reason on the working day just before or after loses that
  holiday's pay (s.60D(2)). Helpers `guardHolidayDates` and `holidayPayLost` do these for the pay run.

In Prima (tab "Public holidays" on Site man-hours): a list is 11 dated, named days for a company and year, for the whole
company or for one state (state holidays differ). The Operations Director or the OGM sets every list; the OM does not
(Fauzan, 6 Nov 2026: "Od or ogm. Not om set the holidays"). Each save keeps a reason and makes a new version. Fewer
than 11 days is refused; a missing compulsory day is a flag. Government-declared extra days can be added. From 1
December the OD and OGM see a reminder on their operations board; after 10 December the CEO's home flags lists still
missing. The pay run reads `holidaysInMonth(lists, company, month, state)`: the state list, else the company list.
Table `prima.public_holiday_lists` (company wall, no DELETE) in the same module.

Fauzan confirmed (6 Nov 2026): one list per company per state, with the whole-company list as fallback.

## Salary calculator (Fauzan, 6 Nov 2026)

> Give an interactive salary calculator for om and above to know how to calculate salary. So they know what to expect.

Screen "Salary calculator" for the OM, ROM, OGM, Operations Director, COO, CEO, ACT and group leadership. Pick the
standard formula (12-hour shift with 2, 2.5 or 3 h rest), change the basic, and enter the guard's month: working days,
training, annual leave, MC, public holidays off, rest days worked, public holidays worked. It shows each step (daily
and hourly rate, basic, unpaid short days, overtime, rest day and holiday pay) and the gross. Training, annual leave, MC
and a holiday off are one normal day each, inside basic, with no overtime (Fauzan, 6 Nov 2026). The OM, ROM, OGM,
OD, COO and CEO (and ACT and group leaders) can also pick a guard formula ACT set that is in force this month, counted
with the CEO's pay law for the month (`GET /salary-calc`, `salaryCalcData`: amounts only, no drafts or place choices).
On PostgreSQL they read it through the read-only `pay_read` wall (the same wall HR uses in the guard pay module);
writing still needs the ACT wall. Gross only; no EPF, SOCSO, EIS or PCB. Code: `packages/core/src/salary-calc.ts` (`guardSalaryCalc`),
`apps/web/src/views/SalaryCalc.tsx`.

## The CEO sets the base and the pay law (Fauzan, 6 Nov 2026)

> Ceo can set the base salary. When new law came in. Ceo have the flexibility control to set how salary is set and how
> the base is set base by the new law that came. Even with socso or epf or add new way.

- The CEO sets formulas live, decides drafts and picks where formulas are used, the same as the ACT Director. The basic
  pay is part of each formula.
- **Pay law settings** (CEO only, panel on Pay formulas): the days the basic is divided by (26), the minimum wage and
  the next announced one, the lowest overtime rates and extra days' wages, the RM4,000 overtime wage limit, the
  104-hour overtime cap and the normal-hours limits. Set from a month with a reason and the law reference; a new
  version for the same month replaces the earlier one; nothing starts in a past month. Formulas, worked months, labour
  law flags and the salary calculator use the version in force for the month. Defaults are the law as at November 2026.
- Table `prima.pay_law_versions` (ACT wall: ACT and group leadership read; only the CEO writes, checked by the API).
  Operations managers' salary calculator uses the defaults, since they cannot read behind the ACT wall.
- EPF, SOCSO, EIS, LINDUNG and any new contribution type are counted in the pay runs (staff payroll, guard pay run
  PR #120), not here; those rates are to be made CEO-settable there.

## Labour law: flags to the CEO, never a refusal

The ACT Director's amounts are saved as chosen. Prima refuses only entries it cannot count (not a number, no normal
hours, a rest as long as the shift). Every labour law point is a flag: shown on the formula, and on the CEO's home
(Monitor) for each formula in force, starting later or waiting for the Director. The ACT Director's home shows drafts
waiting for a decision.

Flagged (Employment Act 1955):

- basic below the minimum wage (Minimum Wages Order 2024, RM1,700 a month), or below the announced RM2,000 from June
  2027 (until gazetted);
- overtime under 1.5x on a working day (s.60A(3)), under 2x on a rest day (s.60(3)), under 3x on a public holiday
  (s.60D(3)); under one extra day's wages for a rest day worked, or under two for a public holiday worked;
- basic above RM4,000 (the Act's overtime rules bind only up to RM4,000, First Schedule);
- driver and staff overtime formulas only: normal hours over 8 a day or 45 a week (s.60A(1)), more than 6 working days
  a week (s.59);
- guard formulas only: **rest needs a real break (rule PAY-REST-BREAK)**. Rest is unpaid only when the guard is
  relieved from the post (a relief guard covers, or the guard may leave). Untick "relieved" and the rest is paid as
  work.

**Security guards are exempt from the hours limits** (Fauzan, 5 Nov 2026), so guard formulas carry no spread-over,
12-hours-a-day, normal-hours or 104-overtime-hours flags.

Not legal advice.

## What it does not do yet

- It counts pay; it pays nobody. Guard payroll is still in the JA Group app; Prima's own guard payroll (slice 2 of the
  "Prima's own JA" plan) will read the formula for each site and month from here. Driver overtime hours are entered on
  the worked month; there is no driver overtime claim or trip feed yet.
- Statutory deductions (EPF, SOCSO, EIS, PCB) are not on the worked month: it stops at gross.
- Guard salary approval stays with the COO (salary-approval rule); setting a formula is not approving anyone's pay.

## Database

New tables `prima.pay_formulas` and `prima.pay_formula_uses` behind the ACT wall, in the optional module
`db/modules/pay-formulas-v1.sql` (proposal `db/proposed/pay-formulas-module.json`). Not in the release manifest and not
in `001_init.sql`. Until it is installed, the screen shows no formulas and every save is refused with a plain message.
Fauzan approved installing it (5 Nov 2026); it goes in through the release path in a migration window.

## Code

- `packages/core/src/pay-formulas.ts`: amounts, the law check, the worked month, where-used lookup, standard amounts.
- `packages/core/src/service.ts`: `payFormulaBoard`, `payFormulaAt`, `savePayFormula`, `decidePayFormula`,
  `withdrawPayFormula`, `setPayFormulaUse`.
- `packages/core/src/rules.ts`: rules PAY-FORMULA and PAY-REST-BREAK.
- `apps/api/src/controllers.ts`: `GET /pay-formulas`, `GET /pay-formulas/at`, `POST /pay-formulas`,
  `POST /pay-formulas/:id/decide`, `POST /pay-formulas/:id/withdraw`, `POST /pay-formula-uses`.
- `apps/web/src/views/PayFormulas.tsx`: the screen (menu "Pay formulas" for ACT and group leadership).
- Site man-hours: `packages/core/src/site-hours.ts`, service `siteHoursBoard` and `approveSiteHours`,
  `GET /site-hours`, `POST /site-hours/approve`, `apps/web/src/views/SiteHours.tsx`.
- Tests: `packages/core/test/pay-formulas.test.ts`, `packages/core/test/site-hours.test.ts`,
  `apps/api/test/pay-formulas-pg.test.ts`.
