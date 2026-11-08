# Switch-over from the JA Group app

Status: draft, sample data only. Not merged, not deployed, no database change.

Source: Fauzan, 5 Nov 2026 (third audit, item 3 approved: "one month side by side, then switch by area; import of guard
history from JA") and the plan "Prima's own JA and Asset Management features", section "How we switch safely". Later the
same day: "Do the guard pay run on mock" (guard pay compared with Prima's own pay run) and "Every formula can set by act
director" (the numbers below are set in the app by the ACT Director).

Stacked on the guard pay run draft (PR #120), which is itself stacked on the pay formulas draft (PR #112).

## What it does

Screen **Switch from JA** (`jaswitch`), API under `/api/ja/switch`, `/api/ja/imports` and `/api/ja/history`, code in
`packages/core/src/ja-switch.ts`, rule `JA-SWITCH`.

1. **Side by side.** The CEO or COO starts a 30-day run for one company and one area (incidents, attendance, patrol,
   guard pay, hostels). JA stays the real system.
2. **Difference report.** Prima's own records are compared with JA's, day by day:
   - attendance per guard per day (present or not, hours within 15 minutes);
   - patrol tag scans per site per day;
   - incidents matched by site within 60 minutes (missing on either side, severity, open or closed);
   - guard pay per guard per month (gross, net, EPF, SOCSO, EIS, PCB), within the pay tolerance. Prima's side is the
     newest COO-approved (or paid) guard pay run of each month; guards with nothing to pay are left out, since JA issues
     them no payslip. A month with no approved run blocks the report and the check;
   - hostel per worker at each month end.
   A day with no approved JA data is listed as unknown, never as matching.
3. **Explain or fix.** Each difference is explained or fixed, with a note, by the people who run the area: Operations
   (OM and above) for incidents, attendance and patrol, HR for guard pay, FWM for hostels, the company manager, the COO
   or the CEO.
4. **ACT check.** After the run ends, the ACT Lead or Deputy checks the report. They cannot check a report they explained
   a difference in. The check is bound to a fingerprint of the exact report; if any data changes afterwards, the check
   no longer holds and ACT checks again.
5. **CEO switch.** Only the CEO switches the area for that company, with a reason. The switch records that JA stays
   read-only for 92 days (3 months). Only the CEO can undo it.

**JA history import.** Anyone in ACT stages a CSV export from JA for one company: guard records, payslips, attendance,
patrol scans, incidents or hostels, with the first and last day the file covers. Prima:

- keeps only the listed columns, and lists the columns it ignored;
- refuses a row with a reason and line number (bad date, duplicate, net more than gross, outside the days covered);
- refuses any value that looks like a full IC number, because JA keeps full IC numbers and Prima does not;
- lists staff numbers that are not on Prima's people list (HR adds people; the import never creates them);
- shows what is new, the same, or will change what Prima already holds.

Nothing is written until the ACT Lead or Deputy, who is not the person who staged it, approves the exact file by its
fingerprint. An approved file is also the JA side of a side-by-side run.

## What it does not do yet

- Switching records the decision. It does not yet turn Prima or JA screens on or off. Rule `SYS-JA-OWNS` still controls
  which Prima screens show.
- Prima cannot make JA read-only. That needs the JA developer and the agreement Fauzan is arranging.
- Guard pay compares only once HR has prepared and the COO has approved that month's run. On the database the pay run
  tables come from PR #120's migration; until it runs, the report says pay cannot be compared yet.
- The JA live feed does not yet send attendance or patrol, so those come from export files.
- Comparisons read a company's whole attendance and scan tables. At the 8,000-guard scale they need the date-window
  reads from draft PR #63.

## Numbers the ACT Director sets

Tab **Numbers** on the Switch from JA screen. Only the ACT Director (ACT Lead) changes them, with a reason of at least 10
characters, within the limits below. Every change is kept with who, when and why, and written to the audit trail. A
side-by-side run keeps the numbers it started with, so a later change never moves a report ACT has already checked. Group
sign-ins see the numbers; a company manager sees each run's numbers in its report instead (the group record sits behind
the company wall on the database).

| Number | Starts at | Limits |
| --- | --- | --- |
| Days side by side | 30 | 7 to 92 |
| Attendance hours may differ by | 0.25 hours (15 minutes) | 0 to 2 hours |
| Incidents match within | 60 minutes, same site | 5 to 240 |
| JA read-only after a switch | 92 days | 30 to 365 |
| Pay may differ by | RM0.00 (to the sen) | RM0 to RM10 |

The ACT Director role holding these is an assumption from Fauzan's message; the starting values are proposals.

## Other proposed values for Fauzan to confirm

| Value | Proposed |
| --- | --- |
| Who starts a run | CEO or COO |
| Who checks the report | ACT Lead or Deputy |
| Who switches and undoes | CEO only |
| Who stages and approves JA files | ACT stages, ACT Lead or Deputy approves |
| Rows per file | 2,000 |

## Storage

Everything lives in `prima.ja_records` behind the company wall, told apart by `dataset`: `switch` (one area at one
company), `import` (a staged file), `hist_<kind>` (one row from an approved file) and `settings` (the ACT Director's
numbers, one group row under the PWVSB company id). The JA feed screen reads only its
own datasets.
