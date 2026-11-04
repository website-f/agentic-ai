# IT rental and six-month inspection pilot (local candidate)

Owner decision, 1 Nov 2026: IT Manager enters actual rental rates; IT staff enter existing assets and actual billing records; every asset needs health/condition inspection every six calendar months. No real rates, bills, payments or provider changes are made by this build.

## Bounded assumptions

- Retain existing monthly billing basis and MYR currency. Rates take effect on the first of a month; no invented proration, tax, discount, automatic collection or dispatch rules.
- Staff explicitly choose linked, in-use/repair assets. Unlinked existing stock is not billable. Historical actual amounts are recorded separately, without invented rate snapshots or assumed payment.
- Every active asset category needs inspection. Disposed assets cannot receive a new inspection. Unknown history means initial check needed, not healthy.
- Six calendar months clamp the end of the target month (31 Aug → 28/29 Feb), never 180 days. Generic inventory checks, service and repairs do not satisfy this ledger.

## Actions and controls

Existing owner-pinned itAct gateway: operationalBoard, operationalReceipt, operationalAbandon, setRentalRates, prepareRentalBill, recordRentalHistory, recordAssetInspection.

Only the IT Manager sets rates; current IT staff prepare bills, migrate existing stock/historical amounts and record observations. Rates have immutable versions, effective dates, evidence and creator identity. Bills snapshot applicable rate/version/effectiveness, currency, monthly period and explicit asset IDs/version hashes. Subsequent rate changes never rewrite issued records. Company+month and asset+month duplicates fail; stale asset/rate selection requires fresh review. Amount input is exact two-decimal MYR, calculated in integer sen; zero must be explicitly entered, missing values never default.

Finance retains its existing payment-record authority. Creation never marks a bill paid and nothing executes a bank payment. Existing legacy bills are preserved as legacy_unverified with unknown currency/rate provenance, not silently certified or dropped.

Requests use stable UUIDs and owner-bound immutable terminal receipts. Validation rejection can be safely retired only through the matching receipt. Unknown responses retain their ID. Explicit abandonment serializes against saves and stores a tombstone, preventing a delayed original save from committing. Generic/storage-phase failures, even typed errors after writes start, are never converted into a terminal rejection. PostgreSQL savepoints/rollback are required for atomic rows/job-note/audit/receipt behavior; MemoryStore demo has no rollback and is not production persistence.

## Inspection review remains the existing IT job workflow

Record an observation against the recorder's assigned open IT job (todo/doing/returned). The immutable inspection reference, asset, condition, findings, evidence and follow-up are appended to that job's log in the same transaction. Recording does not submit, check or accept the job. Already submitted/checked/accepted jobs cannot be retrospectively attached.

Existing job submission/proof and independent Manager/authorized COO checking remain unchanged. Projection says linked_job_accepted only with current accepted job status, stable independent checker identity and matching epoch-based acceptance evidence after the record. It is NOT a separate health/compliance certification. Name-only legacy logs do not prove independent acceptance. New inspection evidence is visible in the ordinary job packet. Manager-authored work cannot self-check.

The existing IT Plan and board KPI now use this inspection ledger and calendar due dates. A new inspection: plan-key namespace prevents an old yearly-check job from falsely satisfying the new schedule. Unknown history is scheduled for an initial check. Service/repair planning remains separate.

## Database/release gates

New immutable rate, inspection and operational-receipt tables; existing rental bills receive forced RLS and immutable snapshot guards with Finance-only paid-field updates. New readiness composes prior manual-register protections and new operational catalog checks. Prior manual asset role guard is narrowly widened to current IT staff, as explicitly authorized.

No migration is executed. Actual restricted-role PostgreSQL concurrency/rollback/trigger tests, migration rehearsal, full browser recovery/account-switching checks and authorized deployment remain release gates. Receipt deletion/retention is not introduced; an approved retention process must preserve replay protection. Synthetic passing tests do not authorize live billing, account grants or activation.
