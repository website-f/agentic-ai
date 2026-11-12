# Arrival cash and CEO cash decisions — local candidate, 8 November 2026

This local branch builds on reviewed recovery commit 14f75961f87222d7e8fc34e3053cc17dba1be33a. It is not merged, published, deployed or activated. The previous publication denial remains in force. PRs 131/132 and the original checkouts are untouched.

## Three separate records

* Arrival advance: FWM Manager requests each amount and purpose for a recent foreign arrival without wages, awaiting PLKS. CEO approves/refuses each request with a reason, never their own. FWM records the approved cash handover with a genuinely supplied, transaction-specific signed receipt. Approval/refusal creates no debt; only recorded disbursement does. Finance sees request, decision, handover and recovery notices in the arrival ledger.
* Additional DOA support: manual OM request, manual **CEO-only** approval, controlled DOA Excel and Finance custody/payment records. It never becomes a loan or ordinary-wage deduction. Prior paid/posted records remain unchanged; new preparation/payment requires CEO approval.
* Ordinary wage cash: DOA lists the exact net amount, CEO alone decides, CEO or COO hands over, DOA uploads the genuine receipt. Legacy decisions cannot authorize new handouts. Versioned approval and current net amount must match. Existing CoS/CEO loan records remain separate.

Finance daily cash remains closed to new activity, including its former Finance-request route. Both server and reducer retain that closure; the dormant decision permission is CEO-only. This deliberately does not reopen a route that could bypass manual OM approval for additional support. Historical receipt/reconciliation access remains. A separately specified new daily-cash request flow is not implemented here.

## Recovery and review

FWM sets a positive integer number of months. There is no 60-day eligibility or repayment assumption. No bank account is required. One arrival record per worker prevents parallel records from bypassing the stop rule. The application checks known PLKS records and paid wages as well as the FWM eligibility attestation. Attestation is still needed where source records are incomplete; the application does not verify immigration status with a provider.

Before handover, Finance records Finance/legal references, evidence, effective/expiry months, reviewed cap percentage and the arrival receivable account. There is no default cap or receivable code. This candidate supports a review confirming gross wages as the applicable basis with all existing deductions (including statutory employee deductions) consuming cap room. Other legally required bases/exceptions need explicit implementation and review before use; do not configure a percentage to disguise an unsupported basis.

The first calculated wage month with positive gross includes the scheduled arrival recovery. The monthly amount is total actual disbursements divided by FWM months, rounded up to a cent, capped by the balance and remaining reviewed deduction room. Deferred amounts remain owed. Actual paid payroll appends repayment records once; preparation/approval does not reduce debt. New disbursements or changed reviews invalidate stale snapshots. Once repayments start, no further requests or handouts on the record are permitted. Paid wages also close further arrival requests/handouts. Payroll displays the deduction and SQL export uses the reviewed arrival receivable account with worker/site/period trace.

The existing loan/wage-advance calculation still has its historical half-wage assumption. It has not been declared legally valid or rewritten as a new policy. Arrival recovery additionally applies its reviewed cap against **all** deductions. Harmonizing the older schemes across applicable jurisdictions remains a separate Finance/legal review item.

## Legal evidence and remaining operational gates

Consulted the JTKSM-hosted Employment Act 1955 updated text (as at 1 January 2023), especially sections 22, 24, 25/25A and recordkeeping provisions: https://jtksm.gov.my/sites/default/files/2023-11/Akta%20Kerja%201955%20(Akta%20265)_0.pdf . Advance and deduction conditions, wage definitions, exceptions and required permissions require case-specific review; the text is not a universal 50% determination. Current jurisdictional applicability, including Sabah/Sarawak rules, has not been certified by this implementation. Finance/legal must confirm lawful advance limits, purpose, permissions, treatment, recovery basis and payroll records before live use.

No stored signature is pasted. Actual handover can be recorded with acknowledgement pending, so genuinely disbursed cash remains owed and visible. Recovery is held until the genuine signed receipt is attached; no receipt is fabricated. Genuine scans/photos are accepted with transaction binding. A checkbox is an attestation, not automated forensic verification. Evidence retrieval remains company/role/site scoped. Finance notices are durable in-app ledger entries, not email or external messaging.

Policy review is immutable in this candidate. Changing terms, amending reviews, correcting paid amounts or reversing paid/posted records requires an agreed independent procedure; those operations remain unavailable. No production policy, cap, real receipt, provider activation, tenant grant or database security policy has been created.

## Draft PR review follow-up

Unpaid wage-cash listings can be explicitly superseded by DOA in draft/submitted payroll, with a reason. The original named amount, site and decision remain in `cashHistory` alongside the superseding actor/time/reason and an audit event. The replacement uses the recalculated amount/site and requires a fresh CEO decision; replaying supersession on an unchanged pending listing is rejected. A zero-pay recalculation archives the old listing without creating a new handout authorization. Handed-out, receipted or paid records cannot be superseded; no paid reversal policy is introduced. The payroll screen exposes replacement and history.

Wage-cash handover dates must be real calendar dates, within the existing payroll/today bounds and not before either CEO cash approval or payroll approval, using the application's local-date convention. Missing/future approval timestamps are rejected. Regression tests first reproduced the stale approval dead end and acceptance of an impossible date on the prior candidate.

## The Finance Director stands in for the CEO (P100 B2, Fauzan 11 Nov 2026)

"The FD can stand in for the CEO when needed." Cash decisions stay the CEO's. The CEO turns a stand-in on in the app (on
this screen): for set dates while away, or for one named request, always with a reason; the CEO can end it early, with a
reason. While it is on, the Finance Director may decide in the CEO's place: the decision needs a reason and is labelled
"Standing in for the CEO", the FD can never decide a request they made or submitted, and the CEO is told of every
decision (notice on this screen and on the CEO's home until marked seen). With the stand-in off, the FD is refused.
Kept in `prima.cash_stand_ins` (office module `db/modules/cash-stand-ins-v1.sql`: forced row-level security, only the CEO
turns one on or ends it, only the CEO and the FD read it, the FD only adds their own decision to one that is on).
For exceptional guard cash the manual approval on the DOA list may name the FD only when a stand-in covers the approval
day or that approval reference, with the FD's reason (`approval.standInReason`). Before real cash is used, Finance and a
legal adviser still review the cash treatment.
