# Unpaid rental replacement — isolated candidate, not activated

Owner-approved scope: IT prepares a correction to an existing unpaid configured-rate bill; an independent IT Manager checks asset/rate facts; the existing Finance Director approves issuing the replacement. Finance may separately record a payment reference against the exact replacement identity/hash. No bank transfer, refund, external payment or financial-system posting occurs.

## Boundaries
- Original bills and their recorded history are never overwritten or deleted. Replacement, review, receipt and reference ledgers are append-only. Existing bill displays project the effective replacement once, not both totals; original snapshot remains in correction history.
- Paid, legacy/historical and second-generation replacement chains are deliberately unavailable. They need a separately authorised adjustment/reconciliation design.
- Exact current actor, existing role, explicit company assignment and visible company are required. Explicit central-employer IDs are recognised; no automatic central/group grant. Seeded users lacking company assignments see `RENTAL_COMPANY_ASSIGNMENT_REQUIRED`.
- Manager cannot check a request they prepared. Finance approval requires a still-current independent Manager review and unchanged original, rate and asset snapshots. Returned/cancelled requests remain history; reprepare uses a new ID.
- Rate is the latest effective version applicable on the billing month's first day, never an invented amount. Asset selection is explicit and versioned. New rates never rewrite issued bills.
- Existing original-payment recording now rechecks current scoped Finance authority and rejects a superseded original ID. It never silently redirects to a different replacement.
- Minimal owner/operation IDs support receipt lookup, same-ID replay and explicit abandonment. Absence is not proof of failure. Write-phase failures remain uncertain; only an owner-bound terminal receipt permits clearing.

## Evidence and outstanding gates
Local synthetic lifecycle, role, stale, replay, scope, duplicate and payment-vs-replacement tests are in `packages/core/test/rental-corrections.test.ts`. They are author tests, not independent clearance or production evidence. MemoryStore cannot establish PostgreSQL rollback/RLS/concurrency.

The separate `db/modules/rental-correction-v1.sql` module and exact catalog readiness are now authored but not installed here. Installing the base schema alone does not activate this workflow. Restricted PostgreSQL execution and independent review remain release gates; the local PostgreSQL attempt was refused before SQL (ECONNREFUSED). The release operator must review/checksum and explicitly apply this module only under separate migration authority. No migration, live data, provider call or tenant authority was changed.

Manager may return a stale/blocked request with reason even when its preparer lost access, but `canManagerApprove` remains false and the server refuses approval of changed facts. This does not appoint another checker or widen scope. Read-only board checks do not take write locks; mutations serialize and recheck facts.
