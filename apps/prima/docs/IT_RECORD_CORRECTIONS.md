# Bounded IT record corrections

Local implementation scope: descriptive correction, not account provisioning, company reassignment, cleanup execution, financial correction, or compliance certification.

## Actions and fields

All use existing `/it/action`, current server identity and `serviceId: it-manual` envelopes:

- `correctionBoard {}`: current IT actors only; returns scoped rows, frozen `expectedHash`, `version`, `canEdit`, `blockedReason`, `editableFields`, and displayed fields.
- `correctAsset {requestId,id,expectedHash,reason,serial,model,location,warrantyTo}`.
- `correctSystem {requestId,id,expectedHash,reason,name,note}`.
- `correctIntake {requestId,id,expectedHash,reason,on,jobTitle,personName}`.
- Existing `manualReceipt` and explicit `manualAbandon` reconcile the same actor/request UUID and kind (`asset`, `system`, `intake`). A missing receipt never proves a delayed request cannot commit.

Only exact field sets are accepted. Unknown asset text is the empty string, not invented content; unknown warranty is null. A changed known serial must normalize to an ASCII identifier, and known serials cannot collide. Ambiguous legacy Unicode identifiers hold new serial assignment pending reconciliation; descriptive updates and explicit unknown values remain possible.

Company-linked corrections require an explicit current actor company assignment and a visible registered company. Existing central-employer assets use the authoritative central-employer IDs only with explicit assignment. Manual unlinked records do not grant company access. This new correction action does not widen or change existing IT board/status permissions.

System corrections are limited to the creator or IT Manager/Lead. A reviewed system or one with access records cannot be renamed; its operational note can be corrected. No access, MFA, CEO ownership, credential-location or review field changes.

Manual intake corrections require the assigned IT worker or IT Manager/Lead. Any completed checklist step blocks descriptive correction until a separately governed reopening process exists. Linked person names remain immutable. No person/company/kind change or automatic clearing of historical evidence.

## Consistency and evidence

The server checks the canonical full-record SHA-256 under the existing shared transaction lock, then a per-record lock. Correction metadata increments a separate revision and records actor, UTC instant, reason, request UUID and prior hash. The narrow SQL trigger independently validates the same protected-field boundary and prior hash. Descriptive corrections invalidate pending billing previews through an additional asset-version component; issued financial snapshots and inspection histories are not rewritten.

Record update, audit and immutable terminal receipt share a PostgreSQL transaction/savepoint. Storage-phase failures are uncertain, not falsely terminal rejected. Existing MemoryStore tests are synthetic behavioral checks; its transaction implementation is not proof of PostgreSQL rollback. Real restricted-role PostgreSQL rollback/race cases are separate release gates.

## Cleanup preview is read-only

Every displayed record remains `provenance: unknown` and `archiveEligible: false`. Manual entry is an entry origin, not evidence that data is real or demonstration data. Dependency hints are incomplete and cannot authorize cleanup. No classification, archive, restore, deletion or protected-identity endpoint is introduced here. Any subsequent verified-demonstration nomination/archive workflow is separate, with its own owner-approved authority and dependency review.

## Release gates

The changed global SQL and matching function fingerprints require exact review and an explicitly authorized migration. Catalog mocks do not establish runtime installation. Run the normal restricted PostgreSQL CI suite, including correction SQL/hash parity, UTC/MYT timestamps, unlinked/central audit receipts, stale updates and rollback. No live migration, tenant grant, provider operation or deployment follows from this source change.
