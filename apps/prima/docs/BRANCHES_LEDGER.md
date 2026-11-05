# Branches: lifecycle and month ledger (masterplan chapter 03)

Fauzan, 3 Nov 2026: "Yes build all not build", after the masterplan subsection ledger
(`/mnt/project-files/reviews/masterplan-subsection-ledger-2026-11-03.md`). This slice covers the branch rows. Other
missing rows went to their department threads: Central Admin (103, 126, 243), Finance (71, 72, 76), Special Ops
(191, 193, 195), ACT (241) and FWM (240).

Mock data only. No schema change: everything is JSONB on the existing `prima.branches`, `prima.branch_settlements`
and `prima.sales_leads` rows. The base schema hash is unchanged. Nothing is merged, migrated or deployed. Prima never
posts to SQL Account, contacts KDN or a council, or moves money.

## What already existed on main

The signed agreement versions (Model A, B or C, percentages only from the signed agreement), the monthly split,
holds (unreconciled bank, unpaid wages, expired licence, missing term), company approval of the month, and branch
action review. Months were seeded test figures; nobody could add a branch or prepare a month.

## What this adds

| Masterplan | Who | What |
|---|---|---|
| 145 Formation | Company manager | Proposes a branch (starts **proposed**). Company staff record the KDN approval, premises/council licence and insurance references, and the business case with a 13-week cash forecast (opening cash, money in and out each week; weeks where cash runs short are shown). Finance reviews the business case with a comment, never one they entered; a short week needs a comment saying how it is covered. A new version needs a new review. The manager confirms the company is the legal employer. Activation needs a comment and is refused while anything is missing: signed agreement in force, those three references, the SQL project code, the employer confirmation, a verified company bank account and a reviewed business case. |
| Branch treasury | Finance records, company manager sets float limit | Finance records the day's bank balance with the statement reference, the cash float held, the next payroll (date, amount, payroll or JA reference) and other payments due in 7 days. The branch shows **Unknown** when nothing is recorded or the last figure is over 3 days old (rule decided by Fauzan, 3 Nov 2026 07:42Z), and **Needs attention** when the balance is below what is due in 7 days or the float is over the manager's limit. Prima never reads the bank or pays. |
| 150 SQL project code | Finance team of the company, or FD | Sets the branch's SQL Account project code, unique in the company. A month cannot be prepared without it. |
| 148, 170 Accounts | Company staff add, Finance verifies | Three kinds: the company's own bank account for the branch (holder must be the company's exact name), the SQL project ledger, or a partner's own business (needs its SSM number; receives only the manager's approved fee). Last 4 digits only. Whoever added an account never verifies it. |
| 163.1, 165.1, 167 Month ledger | Company staff, branch manager or Finance prepare | Each line cites its SQL Account document or payroll reference. Billing is tax-exclusive invoiced value of signed work and names a site of this branch with a signed contract (active, suspended or terminated). Credit notes are negative; true-ups correct earlier months. One invoice belongs to one branch month. Only a finished month. Model C's net profit is billing less every cost line, including management fee, shared cost, bad debt and provisions. |
| 149 Payroll | Preparer | Every month carries the payroll run or JA pay summary reference. The company stays the employer. |
| 146.2, 169 Settlement | Company manager, then Finance twice | Company manager approves with a comment, never a month they prepared. Finance agrees it to the SQL project ledger (not the preparer or approver). A different Finance person records the payment with the bank reference. A partner is paid only once its own business account is verified. The company manager (draft) or Finance (approved) can return a month with a reason; the preparer corrects and resubmits, and the history keeps every step. |
| 146.1 Step-in | Company manager | Steps in to run the branch directly, and hands it back, each with a reason. |
| 157 Closing | Company manager | Six steps in order, each with a note: notice, clients moved, guards moved, assets returned, final settlement (refused while a prepared month is unpaid), closed. |
| 147 Branch leads | Company staff | A lead can name the active branch that found it. The company manager sees the same prospect worked by two branches (or a branch and head office). Contracting stays with the licensed company. |

Older seeded months show "Test figures: not prepared from SQL Account lines" and cannot be validated or paid.

## API

- `POST /companies/:companyId/branches` `{ name, state, model }`
- `GET /companies/:companyId/branch-leads`
- `POST /branches/:id/act` `{ action, ... }`: `setup`, `project_code`, `add_account`, `verify_account`, `business_case`, `review_business_case`, `activate`, `treasury`, `float_limit`, `step_in`, `step_out`, `terminate`, `prepare`
- `POST /branch-settlements/:id/act` `{ action, ... }`: `approve`, `return`, `validate`, `paid`
- `POST /branch-settlements/:id/approve` now needs `{ note }`.
- `POST /companies/:companyId/leads` accepts `branchId`.

## Tests (synthetic data)

- `packages/core/test/branch-ledger.test.ts`: 10 tests covering rules, the lifecycle, the month journey (prepare, return, correct, approve, validate, pay), refusals (unsigned work, double-claimed invoice, missing reference, wrong site, unfinished month, self-approval, wrong company, missing project code, unverified partner account) and branch leads.
- `apps/api/test/branch-ledger-pg.test.ts`: the same journey on PostgreSQL 16 through the restricted `prima_app` login and the company wall, including two concurrent approvals (one wins) and the audit entries.

## Not done

- Reading the SQL Account project ledger directly (waits for the Finance SQL connector, E62). Finance agrees by hand.
- A live bank or SQL Account feed for treasury figures: Finance records them from the statement.
- KDN's current branch procedure must be confirmed with KDN; Prima records the reference only.
- Phone and browser UAT by real staff.

## Concurrency (Arisha main, 3–4 Nov 2026)

- Every branch and settlement action locks its row first, then checks the status again inside the save.
- Month preparation takes three locks, in this order: the company's branch-key lock, then the branch, then the month itself. Approval, return, validation and payout lock the month. A correction therefore cannot rewrite a month that someone approved meanwhile. If the approval commits first, the preparation is refused.
- Invoice numbers on branch months and SQL Account project codes are unique across the whole company. Preparation and project-code changes therefore take one company-scoped lock. On PostgreSQL this is a transaction advisory lock (`branch-keys:company-keys:<company>`), always taken before any branch or month lock.
- `apps/api/test/branch-races-pg.test.ts` tests three pairs, each in both orders: preparation against approval, the same invoice on two branches, and the same project code on two branches. Each test pauses the first request while it holds its locks. The tests fail when these locks are removed.
- Approval works out the holds and the split for the month being approved, whichever month it is. It no longer uses the board row, which only shows the latest month. It locks the branch and then the month, in the same order preparation uses. A new agreement locks the branch, so an agreement and an approval always run one after the other: an agreement that would reach back into a month just approved is refused. These cases are tested in both orders in `branch-races-pg.test.ts`.
- Not done yet: database unique constraints for invoice numbers and project codes as a second layer. Invoice numbers sit inside each month's JSONB lines, so this needs its own table plus a migration. Only the CEO can run that migration. For now, uniqueness comes from the company-scoped lock above.
