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

## JV branches (Fauzan, 4 Nov 2026)

Owner rules, given in the project thread on 4 Nov 2026:

- "As jv branch manager have the authority to buy any or choose any supplier they wanted." Decision card answer: **buy freely, company watches**.
- "Arms control have full control of arms. So branch need to follow."
- "Yes but hr is manage by branch manager. We just take data and monitor."
- "Flag to ceo if pnl is less than 10% from billing."
- "Ceo can set the percentage of company management fee or each branch."
- Asked whether the Branch Manager also sets staff pay: "Yes they set it them self."
- "There are branch that company take only management fee. But we just monitor its doing. The manager have full control." This is Model A.

A JV branch is one whose agreement in force is Model A (company fee is a % of billing) or Model C (company fee is a % of net profit). Model B (salaried manager) is not JV and keeps the company's usual controls.

| Rule | Where | Behaviour |
|---|---|---|
| Purchases | `recordBranchPurchase`, action `purchase` | Only the branch's own Branch Manager (`User.branchId`) records a purchase, from any supplier, with no approval step. Needs date (not future), supplier, item, kind (`equipment`, `transport`, `hostel`, `insurance`, `subcontract`, `other`), amount and supplier invoice number. Same supplier + invoice twice is refused. A month already settled is refused. Audit `branch.purchase`. |
| Company watches | `queryBranchPurchase` / `answerBranchPurchase` | The company manager, group leaders and the company's Finance may ask about a purchase; the Branch Manager answers. A question never blocks or reverses a purchase. |
| Arms | `isArmsItem` | Firearms and ammunition (English and Malay words) are refused: "Arms Control has full control of firearms and ammunition". |
| P&L | `prepareBranchSettlement` | For a JV month, every purchase of the month and the branch office staff's pay from the company's approved/consented/paid Prima staff pay run (gross wages + employer EPF/SOCSO/EIS/HRD) are added as lines when the preparer has not listed them (same kind and reference). Guard pay from the JA Group app stays the preparer's wages line. |
| Staff HR | `leaveLadder` / `canDecideLeave` | Leave for a person tagged to a JV branch is decided by that branch's Branch Manager only; the company, OMs and central HR see it but do not decide. The manager's own leave, or a branch with no manager on record, uses the usual ladder. Staff stay employed by the licensed company. |
| Staff pay | `setBranchStaffPay`, action `staff_pay` | The JV Branch Manager sets the basic pay of their branch's active office staff, with a start date and reason, without the company CoS/COO approval. Recorded as a verified pay change (`payChanges`) and audit `branch.staff.pay`, so the company and HR see it. Never their own pay; guard and officer pay stays in the JA Group app; a salary account change still needs the HR Director and Finance. |
| Staff and pay data | `branchJv`, `GET /api/branches/:id/jv` | Branch staff list, the last 3 staff pay runs for them (per-person lines only for the Branch Manager, company manager and Finance), purchases by month, open questions. |
| Management fee | `setBranchFeePct`, action `fee` | CEO only (`opsTier === 'ceo'`). New agreement version from the first day of a month, after the current version and after the last settled month, 0 to 100 %, with a reason; `ceoSetting` records it. Model B is refused. Audit `branch.fee.set`. The signed agreement with the Branch Manager should be updated to match. |
| Low profit flag | `branchMargin`, `BRANCH_LOW_MARGIN_PCT = 10`, CEO home | A branch month whose profit (billing less all branch costs, before the company's share) is under 10 % of billing is shown on the CEO's Monitor list and on the branch. It uses the latest settled or prepared month in the last three months. Months with costs and no billing are flagged. Only the CEO's home shows it. |

### Who sees what (Fauzan, 4 Nov 2026: "Branch manager are govern by company manager and monitored by ceo and team and finance"; "Not they can see everything")

| Who | Sees | Decides |
|---|---|---|
| Branch Manager (`User.branchId`) | Only their own branch on the Branches board and JV panel, and only their own branch's sales leads (new leads are always tagged to their branch; another branch's lead is "not found"; no company quotation list; no branch lead clash view). Any other branch is "not found", including every branch action. | Their branch's purchases, branch staff leave and office staff pay (JV); prepares their own branch's months. |
| Company manager (governs the Branch Manager) | Every branch of their company, purchases, staff pay per person. | Approves months, steps in, records agreements, asks about purchases, decides the Branch Manager's own leave. |
| Company admin executives | Their company's branches; branch staff pay as totals only. | Prepare months. |
| CEO and group leaders (CEO's team) | All branches they can see, staff pay per person, purchases; the CEO gets the under-10% profit flag. | CEO sets the management fee. Monitor and ask. |
| Finance (company's team, FD) | Branches of companies whose books they keep, staff pay per person. | Project code, validation, payout, treasury figures. Monitor and ask. |

Tests: `packages/core/test/branch-jv.test.ts` (12) and `apps/api/test/branch-jv-pg.test.ts` (7, incl. own-branch-only leads and lead clashes; incl. branch-manager-only staff pay, own-branch-only view, company manager decides the Branch Manager's leave; PostgreSQL with RLS: company wall, arms, concurrent purchases, branch-manager-only leave, CEO-only fee with two settings at once, CEO-only flag).

Open points: whether a CEO fee change needs the company manager to attach the signed addendum.

## Model B: salaried Branch Manager (5 Nov 2026)

Fauzan, 5 Nov 2026: "Build all that still not build." The not-built audit listed Model B in the branch ledger (A and C were
built above). Masterplan V12: under Model B the company runs the branch, the manager gets a salary only and never a profit
share, and every company matter is approved by the company first. Mock data only; no schema change (JSONB on the existing
rows); nothing merged, migrated or deployed.

| Rule | Where | Behaviour |
|---|---|---|
| Agreement | `addBranchAgreement` | Model B needs a monthly salary in ringgit (up to 2 decimals). The manager must be the company's employee; a partner business is refused (it takes Model A or C). The CEO fee setting stays refused for Model B. |
| Salary in the month | `prepareBranchSettlement`, `managerPayLines`, `managerSalaryCheck` | A Model B month must carry the Branch Manager's salary on its own line (`manager_salary`, counted in wages). It is added from the company's approved staff pay run (the manager's gross, plus the employer EPF/SOCSO/EIS/HRD on a separate line), or the preparer lists it citing the payroll; a hand-entered line replaces the payroll one so the salary is never counted twice. If the month's salary differs from the signed salary, the preparer must say why (`salaryNote`). The month keeps `managerSalary { signed, paid, note }`. A `manager_salary` line on a Model A or C month is refused. |
| Branch staff pay | same | The branch office staff's pay from the approved staff pay run is added as for JV months, without the manager (whose pay is the salary line). |
| Purchases | `requestBranchPurchase`, `decideBranchPurchase`, `recordBranchPurchaseBought`; actions `purchase_request`, `purchase_decide`, `purchase_bought` | The branch never buys on its own (`purchase` is refused). The Branch Manager or company staff send a request with the supplier quotation. Only the company manager approves or refuses it, with a reason, and never a request they sent. After approval, the supplier invoice is recorded (date from the request date to today, never above the approved amount, never into a settled month, same invoice twice refused). Only bought purchases count in the month; requests, approved-not-bought and refused ones never do. Arms are refused (Arms Control). Audits `branch.purchase.request`, `.approve`, `.refuse`, `.bought`. |
| Split | `branchSplit` (unchanged) | The company keeps the whole result (profit or loss); the manager's share is zero. |
| Close, no payout | `recordBranchPayout` | After Finance validates, a different Finance person closes the month with a comment and no bank reference: nothing is paid out (`noPayout: true`, step "closed, nothing paid out", audit `branch.closed`). |
| Staff HR | unchanged | Leave and staff pay follow the company's usual approvals; the JV-only Branch Manager powers stay off. |
| Screens | `SalariedPanel` in `Branches.tsx` | Purchase requests with approve/refuse, invoice recording, the signed salary, and the month showing "Company keeps the whole result" and the salary paid through payroll. The board row shows requests waiting. |

Tests: `packages/core/test/branch-salaried.test.ts` (5) and `apps/api/test/branch-salaried-pg.test.ts` (2, PostgreSQL through
`prima_app`: company wall, Branch Manager cannot decide, two decisions at once and exactly one applies). The generic ledger
tests now run their payout journey on a synthetic Model A agreement (core) or add the salary line when the branch is Model B
(PostgreSQL), because a Model B month no longer pays out.

Open point: the seeded Branch Managers are not on the seeded staff pay runs, so a mock Model B month
needs the salary line entered by hand.

### Fauzan's changes, 5 Nov 2026 02:45Z

- "Create also if partner company is the manager." A Model B manager may be an employee or a partner company. A partner is not on the payroll: its fixed monthly amount is the month's `manager_salary` line citing the partner's invoice, and a payout to it goes only into its verified business account.
- "Purchase approve by fd or ceo with consent by company manager." Model B purchase: request, then the company manager consents or declines (`purchase_consent`), then the Finance Director or the CEO approves or refuses (`purchase_decide`), each with a reason. Nobody consents to or approves their own request, and the approver is never the person who consented. Audit `branch.purchase.consent`.
- "Payout is approve or determined by fd." After Finance validates a Model B month, only the Finance Director determines and approves the payout: an amount of zero or more with a reason; above zero needs the bank reference (audit `branch.paid`), zero closes the month with nothing paid out (audit `branch.closed`). The month keeps `payout { amount, reason, by }`. Still never the person who prepared or validated it. Model A and C payouts are unchanged (the split decides them).
- "Yes can also but fd can set it." (masterplan FF-6) A Model C manager may draw a salary as a branch cost before the profit split. Only the Finance Director sets a Model B or C manager's salary (`manager_salary` action, `setBranchManagerSalary`): a new agreement version from the first day of a month after the last settled month, with a reason (`fdSetting`, audit `branch.salary.set`). Zero ends a Model C salary. A Model C month with a salary set must carry the salary line, checked like Model B; a Model A month refuses it.
- "Branch expenses also follow same like purchases." (5 Nov 2026 03:04Z) A Model B request is a purchase (goods) or an expense (a service or cost to pay, e.g. repairs, utilities, travel), field `category`. An expense goes through the same steps: request with a quotation or estimate, company manager consent, Finance Director or CEO approval, then the invoice or receipt is recorded, never above the approved amount. Only then does it count in the month, with its line marked "Expense". JV branches (Model A or C) still buy and pay on their own.
- "All of this can be set the style of approval or any by fd." (5 Nov 2026 03:14Z) The Finance Director sets each Model B branch's approval style (action `approval_style`, `setBranchApprovalPolicy`, reason required, audit `branch.approval.set`, history in `approvalPolicyLog`). It sets, separately for purchases and expenses, whether the company manager consents first (or no consent step), who approves (Finance Director or CEO, Finance Director, CEO, or the company manager), and an amount at or under which a request is approved with nobody acting; and who decides a month's payout (Finance Director, or Finance Director or CEO). The default is the style above. Each request keeps the style it was sent with. The company manager cannot both consent and approve, nobody approves their own request, and every decision needs a reason.
