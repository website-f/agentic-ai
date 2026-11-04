# Screens: finance, payment requests, credit and procurement

Status key: **Main**, **Candidate (#nn)**, **Main, extended (#nn)**. See [screens index](README.md).

SQL Account stays the books and the bank portal moves the money. Finance screens hold approvals, evidence, checks and
who did what. Figures are test data until SQL Account is connected; with no recent figures a company shows Unknown.

---

## Finance (`finance`)

**Status:** Main for the monitor tabs (Companies/Teams, Bank reconciliation, Closing and posting, Auditor and tax).
Candidate (#49) for the desk tabs (Dashboard, Payments, Month-end close, Checks, Settings, KPIs) and Today.

**Who sees it.** The Finance Director, CEO, Chairman, Vice Chairman, ACT head and Finance team members (each team its own
companies). The COO sees a separate **Payments to approve** page instead (below).

**Roles inside Finance.** Data entry prepares; the deputy also reviews; the team leader and the Finance Director also
send. Nobody reviews, approves or releases what they prepared; nobody releases a payment they approved; every approval
has a comment.

**Top of the page.** Companies to act on now, Unknown, bank accounts not reconciled (due by the 10th), papers overdue;
**Today** *(candidate)*: one list of what waits for this person, urgent first; key numbers for the companies the person
sees (never a ranking).

### Tabs

| Tab | What it does |
|---|---|
| **Teams / Companies** | Each team and its companies: books complete, reconciled, closed; integrity tests; what was posted in SQL Account |
| **Dashboard** *(candidate)* | Companies for the period; each company's **monthly pack** (profit against budget, cash, invoices and collection, loans and collateral, profit per site estimate), **Print**, **Reviewed for the board** once the month is closed |
| **Payments** *(candidate)* | **New payment** (Prima fills payee details, purpose, budget line and account from the last payment to that payee; a company with one account pays from it); waiting for you; other payments; **cash needed** for approved payments due in 7 and 30 days against each bank's last known balance; supporting documents; Teams or SharePoint approval links (every approver's decision copied with its comment); who did what; **Edit and resubmit** / **Resubmit as it is** for a returned payment (documents stay; changes written into the history) |
| **Month-end close** *(candidate)* | Per company: already done (checked by Prima), to fix before the close, bank reconciliation reports (**Attach**), exceptions to explain; **Send for review**, **Mark reviewed**, **Approve financials** (FD or CEO), **Return**, **Reopen**. Bank pack, payment pack and monthly audit file, each reviewed and sent with a comment |
| **Checks** *(candidate)* | The monthly checks, one section at a time, opening on the busiest company (see below) |
| **Settings** *(candidate)* | Group Finance settings in force; only the FD or CEO changes them, with a comment; earlier settings kept; **teams and their companies** (the FD decides yearly) |
| **KPIs** *(candidate, FD, CEO, leaders)* | Speed by stage from when work reaches each person, and quality; people listed by name, never ranked; provisional targets |
| **Bank reconciliation** | Accounts not reconciled to last month end |
| **Closing and posting** | Months not closed; what Prima billed and paid but is not yet posted |
| **Auditor and tax** | Papers for the auditor and the tax agent, overdue or due within 30 days |

### Checks tab sections *(candidate)*

| Section | What it does | Who checks |
|---|---|---|
| Payees: paid to the right person | **Add payee**, **Verify** by call-back on an independently sourced number, **Change bank details** (holds unreleased payments until re-verified) | A second person |
| Bank statements and reconciliation | **Load statement**; paste SQL Account's ledger and **Reconcile now**; Prima pairs lines; **Match**, **Explain** ("let Prima explain the same kind of line next time"), **Unmatch**; **Review** when it balances; **Remembered explanations** | Someone else reviews |
| Invoice problems and bad debt | **Open case** for an invoice that cannot be collected; sign off monthly; **Send for approval**; **Prepare the Customs claim** for bad debt relief | FD or CEO approves |
| Customer and supplier ageing | Monthly ageing, **Mark reviewed** | Reviewer |
| e-Invoice (LHDN MyInvois) | Per entity per period | |
| Service tax (SST) | Returns and payment to Customs; claims to Customs (bad debt relief, wrong payment) with **Record submission** and **Record Customs' answer** | |
| Budget and forecast | **Save draft**, **Submit budget for approval**, **Approve budget**, **Save actuals**; variance over 5% (and RM5,000) explained | FD or CEO |
| Budget revisions; three-statement forecasts | Team leader or deputy drafts a revision; **FD and CEO both approve**. Forecast prepared by Finance, approved by FD or CEO (never the preparer or sender) | FD, CEO |
| Year-end audit deadlines; tax and statutory calendar | Every deadline from the company's year end; **Filed** | |
| Client reminders to send | Reminder letters Prima drafted; staff **Copy** and send, then **Mark sent** | |
| Money in | Every contract's monthly invoice in SQL Account (**Record invoice**, **No invoice this month** with a reason that someone checks); government claims followed until the money is on the statement; money in with no invoice **allocated within 7 days** and checked | Second person checks allocations |
| Stamp duty | Agreements stamped within 30 days; the refund procedure for cancelled agreements | |
| Regular payments | Hire purchase, loans, bills, rent, insurance, EPF/PERKESO/HRD/PCB/CP204, zakat: Prima works out each due date and finds direct debits on statements; **Prepare all due**, **Record bill** (copy last month's amount), **Check against agreement**; the FD or CEO approves the reviewed batch with one comment | FD or CEO |
| IG and BG | Guarantees and cash collateral held; **Client released it (letter)**, **Claim sent** | |
| Hostel bills | Bills the companies pay through FWM, found on the statement | |
| Where the money sits | Fixed deposits and idle cash with maturity alerts (**Renew**, **Uplift**, **Close**); bank charges against what the bank agreed | |
| Bank mandates | Who signs and approves for each account; **Save for checking** | Second person |
| Staff advances, petty cash, company cards | Advances with a settle-by date (unsettled ones shown to HR and Finance); petty cash counts and vouchers; credit and fuel cards (**Load**, **Paid back**, "It was personal") | Second person |
| Contracts that ended | Final invoice, deposits and retention to claim back, IG/BG to release, stamp duty refund | |
| Client credit limits; supplier statements | Limits per private client and balances from SQL; Operations warned before a new post; quarterly statements of the top 10 suppliers, differences explained | Someone else reviews |
| Intercompany; 13-week cash | Intercompany balances agreed on both sides monthly (reviewer explains differences); 13-week cash forecast per company | Reviewer |
| Daily cash pay | See W23 in [workflows](../04-workflows.md): Finance lists people and days; **only the FD approves**; COO or CEO pays and gives back the rest | FD |
| Statement checks FS-01 to FS-12 | The twelve statement tests from the month's SQL figures; **Review figures** | |
| Chart of accounts mapping | **Propose mapping**, **Approve mapping**, **Return** | |
| SQL Account connection | Read-only connector, **switched off**; **Save set-up**, **Confirm set-up** | |
| Withholding tax, prepayments and accruals, fixed assets, auditor requests | Prima works out the tax, due day and monthly amounts; staff record what they did in SQL and with LHDN. Money to LHDN is checked by a second person | |

---

## Payments to approve (COO) (`finance` for the COO)

**Status:** Candidate (#49).

**Purpose.** The COO approves payments by subject matter (operations, IT, FWM, inventory, transport, Goodwill). Nothing
else in Finance is open to him here.

**What is on it.** Waiting for you; decided or with Finance in the last 60 days; supporting documents and steps for each.
**Approve** or **Return**, each with a comment. Also **Daily cash you hold**: **Confirm count**, pay, **Give back**.

---

## Payment requests (`payreq`)

**Status:** Candidate (#49).

**Purpose.** A company or department asks for money to be paid.

**Who sees it.** Group leaders, company managers, and the department heads and Finance checkers who act on them.

**Flow.** The company head **New payment request** says what it is for; the head of that department approves; Finance
checks the calculation; the COO (or the FD for Finance) approves; Finance prepares and pays it. The request's final
approval is the payment's approval, never given twice. A returned request can be **Edit**ed and resubmitted with its
history. Guide cards explain each step.

---

## PWVSB credit (`credit`)

**Status:** Main, extended (#52 corrections and KPKT note).

**Purpose.** PWVSB lends to, or pays on behalf of, a group company. A beneficial-interest agreement is collateral only.

**Who sees it.** The credit officer, the Finance Director, legal, group leaders, and the company manager for its own
loans.

**What is on it and actions.**
- **Run the daily check**: a missed instalment opens an **investigation**, never a default.
- **Investigations and defaults**: **Bank reconciled**, **Clear, not a default**; a default needs the checks plus the
  credit officer and the Finance Director (and legal on a template's first default); then the enforcement case opens.
  **Suspend enforcement** / **Resume**. Enforcement steps 7 to 9 stay off until counsel approves the template.
- **Loans and amounts paid on behalf**: **Record repayment**; **Agreement stamped** (30 days), **Charge lodged with
  SSM** (30 days); **Correct collateral record** and **Correct stamping, charge or signing date** with a reason.
- **Record new financing** (interest capped at 12% secured, 18% unsecured).
- The Deputy Chief of Staff records the KPKT licence check; staff never wait on it.

Ownership records never change by software; only the company secretary's verified update changes them.

---

## Procurement (`purchasing`)

**Status:** Main, extended (#54 Goodwill store, delivery proof, billing).

**Purpose.** Procurement and Inventory under the OGM, monitored by the COO and CEO: 1 executive and 2 storekeepers buy
operational equipment (walkie-talkies, uniforms, bodycams, patrol devices, NFC tags, cleaning supplies) and follow each
item through its life.

**Who sees it.** Group leaders, Procurement, Finance, the OGM and Operations Director, company managers and admin
executives (own company store).

**What is on it and actions.**
- **Purchases**: **New purchase** with lines; **Add quote** (3 needed) and **Add online price**, all with documents;
  **Send for approval**; COO then CEO **Approve** or **Reject**; **Order placed**; **Goods received** (storekeeper; an
  approver never receives); **Match invoice** (PO, goods and e-Invoice UUID within 1%); **Entered in SQL Account**.
  **Correct and send again** after a rejection starts fresh quotes and a fresh approval round.
- **Approved suppliers**: **Add supplier**; **Bank verified against bank letter**; **Conflict declaration received**;
  **Anti-bribery signed**; **Yearly review done (Finance)**; **Block** / **Unblock**.
- **Stock**: on hand only from goods received, issue and return (never typed); **Count** with a witness; issued and not
  yet returned; to collect from people who have left; lost or damaged waiting for confirmation (**Confirm** /
  **Refuse**).
- **Issue to a person** (Goodwill's store issues to guards of every company it serves, never to central staff); a Goodwill
  item goes store, OM, patrolling officer, guard, with **Proof** at each step (who received it, signature, slip, photo,
  and a fingerprint check against the audit log). **Record return**.
- **Goodwill Empire billing to companies** *(candidate)*: a monthly draft for Finance (rent or sale of equipment).
