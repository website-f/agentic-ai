# Disconnected manual IT pilot

Local build only. No provider provisioning/revocation, SharePoint grants, external mail, financial approval, migration execution, or deployment is performed by these workflows.

## Contract

Existing `itAct` gateway actions: `manualBoard`, `manualReceipt`, `manualAbandon`, `createIntake`, `createSystem`, `createGuidance`, `createAsset`, `updateGuidance`. Actors are refreshed from current users before reads/writes. UUID v4 request IDs are owner-bound. Unknown fields are refused. Optional organization association is a visible registered company or explicit null; a free label does not prove company identity. Linked people/jobs resolve through current server-visible references. Never store credentials in notes.

Board returns `serviceId:it-manual`, `userId`, `connection:not_connected`, `configuration:ready|setup_required`, safe readiness codes and capability flags. HR receives no intake/account/asset payload through this new board, matching existing intake visibility. Existing broader asset/Finance views remain separate. Current IT staff may register existing stock (Fauzan, 1 Nov 2026); this creates no provider access or payment. No purchase, price, rental rate, payment or ownership is fabricated for unlinked stock.

Every accepted or rejected attempt returns service/user/request/kind binding and `terminal:committed|rejected`. Committed receipts include recordId and positive version. Rejected receipts have null recordId/version and a validation message. Durable receipts never retain raw request payload. The same UUID cannot be repurposed. Receipt `found:false` proves nothing about an in-flight request and must not clear the UI's marker.

Explicit `manualAbandon {requestId,kind}` serializes against saves. An existing receipt is returned unchanged; otherwise an immutable rejected tombstone prevents a delayed original save from committing. It is not an implicit effect of lookup. Generic errors, missing setup and lost responses remain uncertain; only authenticated, correctly bound terminal receipts permit UI recovery.

Guidance states are recorded, guidance_given and manually_checked; connection remains not_connected. A manual check is not compliance certification. Only the IT Manager may independently check prior guidance evidence, and cannot check their own guidance or a record assigned to themselves. No alternate checker authority is invented for Manager-authored work.

## Transactions and storage

Create/update/recovery use a common transaction-held advisory lock. Existing access-request creation/CEO decisions and onboarding checklist changes now lock before reading, avoiding lost concurrent changes. Calendar validation rejects impossible dates. PostgreSQL transaction rollback is required for atomic record/audit/receipt behavior; MemoryStore demo does not implement rollback and is not production persistence.

A new `prima.it_manual_receipts` table and forced-RLS/guard protections for manual registers are required. Catalog readiness checks policy/function/trigger/role boundaries before writes. Existing installations require a separately reviewed migration; this patch does not execute one. Receipt deletion/retention is not implemented or approved; do not silently expire replay protection. Metadata update history is bounded at 100 edits per guidance record, then requires an approved archive process.

## Rental and inspection extension

Owner policy of 1 Nov 2026 supersedes the earlier setup-only rental gate: actual effective-dated rates are entered by the IT Manager, IT staff prepare records from explicit linked assets, and Finance retains payment-record authority. See IT_OPERATIONS_PILOT.md. The old simulation billing route is still unavailable on real database storage; new operational actions do not fall back to sample prices.

## Verification boundary

Synthetic core/API checks are local. Actual restricted-role PostgreSQL tests, migration rehearsal, browser identity switching/recovery checks and deployment validation remain release gates. No successful local synthetic test substitutes for these gates or authorizes activation.
