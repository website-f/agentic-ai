# Controlled Excel handover contract v1

> Latest clarification (8 November 2026, isolated local review): the read-only library includes active unassigned extra-buffer guards for authorized company-wide DOA/Finance readers. Site-limited readers still need a published assignment within their scope. Select each authorized company; no grants or security policies are changed. Empty assignments allow list preparation only: payment intake still requires an authoritative current/next site assignment, never an invented shift.
>
> Remote acknowledgement may be a scan, photo or electronic acknowledgement genuinely supplied for this particular guard/payment/date/amount/reference (PDF, PNG or JPEG). Stored signatures may be compared for identity through existing authorized processes only; they are never exported here or pasted as receipts. Missing acknowledgement stays pending.
>
> Finance manually posts the external journal against the named site and records its unique line reference here. `post` may explicitly set `treatmentStatus: "pending"`, `statutoryRecordsConfirmed: false` with a payroll accounting/pending-treatment register reference and evidence. This records the actual expense once and keeps synthetic workflow/site accounting functional without pretending statutory treatment is settled. Completion stays blocked. Finance later uses `reviewTreatment` with the treatment decision reference, completed records reference, evidence and confirmation; the append-only review does not change or repost the journal. Treatment is externally configurable through the documented Finance/adviser decision, not a hard-coded exemption or tax calculation. The existing confirmed-records posting path remains compatible.
>
> Complete, accurate payroll/accounting records and Finance/adviser treatment review are required before live use. No automatic payslip posting, ordinary-wage deduction, false acknowledgement or suppression of required records is authorized. Earlier statements below requiring completed statutory records *before accounting* are superseded by this explicit pending path; requirements before completion/live use remain. Paid/posted corrections and reversals remain gated pending policy.


The workbook stays outside Prima. This repository supplies a protected Excel template, scoped JSON master export, local refresh/seal/convert tooling and JSON intake. See `CONTROLLED_GUARD_CASH_WORKBOOK.md` for repeatable commands. There is no automatic provider connection or scheduled refresh. DOA downloads the authorized read-only guard master from the Director Office screen, refreshes lookup data, records only manually approved names/amounts, produces the payment list and submits the controlled handover. Do not ask OMs to re-enter guard data already held in Prima.

GET `/api/finance/exceptionalcash/:companyId` returns version, companyId, refreshedAt, master and rows. Master contains only guard ID, staff number, name, company and authorized roster site/date assignments. No salary, account, full identity number, signature or biometric data is exported. The UI CSV export escapes formula prefixes. Access is DOA or Finance with current company/team/site scope.

POST `/api/finance/:companyId/controls/exceptionalcash/submit` uses the same existing control-action route shape (see controllers for canonical routing). Submit the JSON envelope below using `finControlAction`; names/site labels are taken from authoritative records. The local `scripts/cash_workbook.py convert` command validates the Excel rows against the separately human-checked scope and embeds the evidence files. It never submits automatically. A batch is atomic; do not split one approval across repeated rows. Reference each approval line uniquely. The occasion is a specific payment date. Changes before preparation require a fresh approval reference/file and `supersedes`; after preparation, stop for Finance correction handling.

```json
{
  "version": 1,
  "batchId": "<unique-handover-id>",
  "workbookRef": "<controlled-workbook-version>",
  "evidenceChecked": true,
  "rows": [{
    "personId": "<authoritative-guard-id>",
    "siteId": "<authoritative-site-id>",
    "occasion": "YYYY-MM-DD",
    "amount": 150,
    "reason": "<individual-exception-reason>",
    "request": {
      "byId": "<responsible-om-account-id>",
      "at": "YYYY-MM-DDTHH:mm:ss+08:00",
      "evidence": {"name": "manual-request.pdf", "data": "data:application/pdf;base64,<bytes>"}
    },
    "approval": {
      "id": "<unique-manual-approval-line-reference>",
      "byId": "<ceo-account-id>",
      "at": "YYYY-MM-DDTHH:mm:ss+08:00",
      "evidence": {"name": "manual-approval.pdf", "data": "data:application/pdf;base64,<bytes>"}
    }
  }]
}
```

Evidence is PDF/PNG/JPEG, at most 1.5 MB per file. A shared manual request/approval list may be referenced by multiple named rows in the same company; use a unique approval line reference per row. A replacement needs different approval evidence. Actual payment, signed receipt, return and accounting files remain transaction-specific and cannot be reused. Human DOA checking must verify that each actual document covers that guard, amount, company/site and occasion; software can validate identities, roles, roster, dates, amounts and duplicates but cannot establish document authenticity.

Finance actions: `prepare` (reference, custodianId), `pay` (actual amount, atPaid, unique reference, evidence), `reconcile` (returned amount, reference, evidence, different Finance counter), `returnUnpaid` (entire amount, reference, evidence, different counter), `post` (journalRef, payrollRecordRef, additionalPayrollConfirmed, statutoryRecordsConfirmed, evidence) and `complete`. Every action names immutable `id`. `post` records Finance's external accounting, it does not send a journal to SQL Account. Journal/payroll references identify unique lines, not whole batches.

DOA `receipt` supplies `signedByPersonId`, `paymentRef`, actual `amount`, `signedAt`, `transactionSpecific: true` and a fresh evidence file. Signature authenticity requires human verification; no stored-signature selector or signing-on-behalf mechanism exists. Scanning differently encoded copies is not fraud detection.

Company row locking serializes submission, payout and accounting replay. File hashes and audit events retain traceability. No automatic payment, integration consent or live activation is part of this change. Local workbook generation is implemented; scheduled/provider refresh is not. Cancellation/correction/reversal after preparation is explicitly gated pending an agreed independent authorization and payroll/accounting procedure; wholly unpaid cash may use the documented independent return path.

## Pending treatment and append-only review

Finance `post` example (synthetic placeholders):
```json
{"id":"<cash-row-id>","journalRef":"<unique-external-site-journal-line>","payrollRecordRef":"<payroll-accounting-or-pending-register>","additionalPayrollConfirmed":true,"statutoryRecordsConfirmed":false,"treatmentStatus":"pending","evidence":{"name":"journal.pdf","data":"<PDF-data-url>"}}
```
Finance `reviewTreatment` after required processing:
```json
{"id":"<cash-row-id>","policyRef":"<Finance-adviser-treatment-decision>","recordRef":"<completed-required-records>","statutoryRecordsConfirmed":true,"evidence":{"name":"review.pdf","data":"<PDF-data-url>"}}
```
Both use existing company/team/site authorization and company transaction locking. The latter only accepts a posted pending row once, retains the original accounting record, logs the reviewer and exposes review evidence only to the existing authorized audience. Review does not perform tax calculations or external posting. Do not assert review/record completion without actual evidence. A pending expense is visible in site P&L, while the cash row explicitly retains its pending treatment status.

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
