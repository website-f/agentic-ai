# Insurance claim steps (masterplan row 61)

Fauzan, 3 Nov 2026: "proceed work", after Arisha main named insurance claims as an open detail in the masterplan
ledger. This is a draft on PR #61. Synthetic data only. Nothing is merged, migrated or deployed. There is no schema
change: the new fields are JSONB on the existing `prima.insurance_claims` rows.

## What changes

Before this change, a claim was a record that anyone keeping it could edit freely, including typing "settled" and an
amount. The record form now opens the claim (policy, reference, what happened, incident date, amount claimed) and
can be edited only until the insurer is told. After that, the claim moves only through these steps:

| Step | Who | Needs |
|---|---|---|
| Insurer told | Company desk or Chief of Staff | Date (incident date to today), the insurer's reference, how it was told |
| Documents | Company desk or Chief of Staff | Name and reference of each document. `CLAIM_DOCS` holds a typical list per cover; the insurer's own list wins |
| Sent for assessment | Company desk or Chief of Staff | Every typical document listed, and the date |
| Insurer offer | Company desk or Chief of Staff | Amount (not above the sum insured), the offer or discharge letter reference, and the date |
| Accept for the company | Company manager, never the person who recorded the offer | A comment. An offer below the amount claimed needs the reason |
| Money received | The company's Finance team or the FD, never the person who accepted | Bank statement reference and date. Only then is the claim **settled** |
| Rejected | Company desk or Chief of Staff | The insurer's reason, letter reference and date |
| Appeal | Company manager, once | The grounds. The claim goes back to assessment |

Each step locks the claim row, re-checks its state inside the transaction, keeps a history line and writes an audit
entry. The Insurance screen also flags an incident outside the policy period, and an accepted offer whose money has not
yet arrived.

API: `POST /insurance-claims/:id/act` `{ action: notify | add_doc | submit | offer | accept | received | reject | appeal, ... }`

## Tests (synthetic)

- `packages/core/test/insurance-claims.test.ts`: the full journey, the refusals (wrong date, missing documents,
  self-acceptance, Finance before acceptance, the manager recording money, a second appeal, another company), and the
  record form refusing edits after notification.
- `apps/api/test/insurance-claims-pg.test.ts`: on PostgreSQL through `prima_app`. Covers the company wall, two
  acceptances at once (one wins), two Finance receipts at once (one wins), and the audit entries.

## Not done

- No insurer or broker connection; staff record each step.
- No warranty claims for equipment (row 61's warranty part); asset warranty stays with Procurement and Asset Management.
- Phone and browser UAT by staff.
