# Nepali EPF and SOCSO recharge (rule FW-RECHARGE)

Owner decision (Fauzan, 5 Nov 2026): "Make sure epf and socso for nepali are paid by the owner company and repaid back by the
company that used it, if branch manager that used, it need to pay the amount of epf and socso to the owner company. Salary
can be paid by company that use or branch that use."

Stacked on the recruitment-cost work (`claude/fw-recruitment-cost`, PR #64): it reuses that work's placements (which Nepali
worker of which permit company works under which company or branch, from when to when).

## How it works, in business terms

1. **The permit company pays.** The company holding the worker's permit (the owner) pays KWSP and PERKESO every month as
   usual, by the 15th, whether or not the user has repaid. Nothing here changes the statutory filing.
2. **Finance issues a debit note.** After a month ends, the owner's Finance team (or the Finance Director) sees "Months to
   charge": one line per user company or user branch with placed Nepali workers. Finance enters, per worker, the wage and
   what was actually paid (EPF employer and employee, SOCSO employer and employee, LINDUNG 24 Jam) with the KWSP and
   PERKESO receipt numbers. The screen starts from the published rates; a different figure needs a reason.
3. **The user repays its share.** The debit note charges the days the user had the worker (days used / days in month).
   The user company's staff or Finance record the transfer. When a branch used the worker, **the Branch Manager of that
   branch** records the repayment (a Branch Manager sees only their own branch). Full amount only, within 30 days.
4. **The owner checks the money in.** Only the owner's Finance (never the person who recorded the payment) matches the
   transfer to the bank statement. Until then the owner's copy stays "Waiting for repayment".
5. **Salary.** Recorded per placement: paid by the user company, or by the user branch (default when a branch hosts).
   The salary is not part of this debit note.

Each company sees only its own copy of a debit note (company wall). Audit lines are written in both companies for issue,
repayment, check-in and cancel. A recharged month locks the placement: it cannot be back-dated into or cut short inside a
month that already has a live debit note; cancel the note first.

FWM sees which workers are placed where, but no money.

## Decided

- **Mid-month move: split by days worked** (Fauzan, 5 Nov 2026). The user repays days used / days in the month; this
  differs on purpose from recruitment cost, which splits half each.

## Proposals waiting for Fauzan

- 30 days to repay; RM1 tolerance before a figure counts as "differs from the rate".
- Rates used to prefill: EPF 2% + 2% (foreign worker), SOCSO 1.75% employer and 0.5% employee up to the RM6,000 wage
  ceiling, LINDUNG 24 Jam 0.75% employee. The wage is mock (basic pay) until payroll feeds it.

## Legal flag

A PLKS permit ties the worker to the permit company. A worker working under another company may need Immigration approval
and counsel's view; the recruitment-cost legal flag and the CEO log from PR #64 apply here too. Debit notes record a
cost-sharing arrangement between group companies; they are not a payment and they do not move the statutory duty.

## Branch ledger

`fwStatBranchLines(companyId, branchId, period)` returns the statutory lines for a branch month so the branch settlement in
PR #61 / #85 can show them. It is not wired yet because those PRs are not in this base.

## Database

- New module `db/modules/fw-epf-socso-recharge-v1.sql`
  (sha256 `1d4f23722166865a347c432d5f54ac9de78fae88b18f7e9c7613b3facc4bcdb0`): table `prima.fw_stat_charges` with the
  company wall (forced row-level security), no delete grant, a shape check, one live debit note per user and month,
  and an update trigger: an issued note is never rewritten, its steps only move forward, and a recorded repayment is
  never changed.
- **Not registered in the release manifest and not applied anywhere.** The base `001_init.sql` is unchanged.
- Applying it needs Fauzan's approval and the CEO-only migration path.

## Evidence (local, synthetic data only)

- Core rules and service tests: `packages/core/test/fw-recharge.test.ts` (in-memory store, no database walls).
- PostgreSQL 16 with row-level security: `apps/api/test/fw-stat-pg.test.ts` (own-copy visibility, branch repay, owner
  check-in, unique index, shape check, update trigger, two issues at once give one, placement lock).
- Demo browser walk at 1280 and 390 px (FWM places, Finance issues, Branch Manager repays, other branch sees none, owner
  Finance checks in); not a CI job.

Not merged, not migrated, not deployed.
