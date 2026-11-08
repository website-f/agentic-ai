# Offline staff work — NON-RUNTIME prototype and PR46 shape preparation

This is reviewable pure frontend code, not a working offline feature. There is **no storage adapter, encrypted queue, service worker, event subscription, HTTP transport, UI wiring or runtime activation**. Empty state disables sync planning. No live staff data or external service call is used.

## Scope and current alignment
- Only `helpRequest` and append-only `jobNote`; no attachment, approval, AI, import, financial/HR/PDPA mutation, mail-send or generic endpoint replay.
- Pure queue transition model: stable operation identity, immutable payload copy, serial attempt claims, account/tenant separation, interruption → uncertain, receipt reconciliation before resend, no silent overwrite/delete.
- `jobNote` permits baseVersion0 (server job-log length) and maximum500 characters, aligned to PR46 `138e3acc77ec07e9b6340f3eff660d47b2adb17e`. Help-request detail remains bounded1000; the prototype conservatively requires nonblank detail.
- `contract.ts` validates PR46 lease/receipt shapes and builds the exact `{leaseId,ops:[{opId,kind,createdAt,payload}]}` JSON envelope. Local schemaVersion and owner namespace are NOT sent as unsupported fields. Wire operation IDs must be UUIDv4. Local state-model fixture identifiers alone are not valid server IDs.
- `bindSubmission` must run once at admission with the original lease. Bound body is immutable; no API exists to renew its lease. This pure helper is not connected to queue storage or transport.
- Same-user receipt lookup contains only operation ID, not payload. An empty receipt list is NOT decoded as authoritative absence or permission to recreate work.
- Status decoding preserves applied/needs_review/rejected/discarded/conflict/error; decoding is not a sync-success decision. Conflict resolution remains explicit online work, not automatic send-anyway.

##72-hour boundaries and limits
Owner approved staff-controlled devices and72-hour offline access. Pure predicate checks finite timestamps and a bounded nonrolling grant; it cannot authenticate a lease, trust a device clock or enforce encrypted access. Unsynced work is preserved on expiry/logout. UI hiding/namespacing is not a security lock.

Expired access blocks payload visibility, new enqueue, local discard and fresh sends. With current online sign-in, an uncertain operation may still plan a metadata-only receipt lookup; expiry must not force an unknown result to be re-entered blindly. This requires a future storage design separating safe reconciliation identity from encrypted payload access.

Foreground sync eligibility requires app open, online hint, valid session and enablement. Closed-app delivery is not promised. Auth token lifetime is not extended. Prototype queue cap50 is a safety bound, not an approved production retention policy.

## Backend relationship and remaining blockers
PR46 is Claude-owned backend work and remains independently reviewed/disabled. This prototype does not change it and does not establish its SQL, authorization or replay protections. Actual wire contract requires current Microsoft auth, server-owned lease/clock and per-operation atomic receipt ledger. Never call the pre-existing online business routes as a replay workaround.

Before runtime integration:
1. Reviewed encrypted IndexedDB/key lifecycle and actual offline unlock expiry enforcement; device trust is not proved by a label.
2. Durable local transaction/cross-tab claim before I/O; immutable original lease binding; safe hydration and capped backoff with Retry-After.
3. Current-auth receipt reconciliation after uncertainty, including expired leases. Missing/unknown receipts cannot be silently dropped or recreated.
4. Approved receipt/tombstone retention and explicit conflict-resolution UX with current authorization.
5. UI showing draft/queued/sending/needs-signin/uncertain/needs-review/server-confirmed outcomes; source capture time distinct from server acceptance.
6. Full server/DB concurrency, duplicate, revoked-access and browser/device UAT before enabling.

No unprotected key or auth token belongs in the outbox. Basic secret-word checks are defense in depth, NOT DLP or security certification. Real work prose may contain sensitive information even if these structural tests pass.

## Validation
`node --test scripts/offline-outbox.test.mjs scripts/offline-contract.test.mjs`:33 synthetic tests. Web typecheck passes. Previous0672eada prototype's independent31-test result is historical, not a review of this new contract preparation. No migration, deployment, permission, dependency or provider charge is part of this patch.

Import review24-hour expiry/30-day review-data retention remains separate and unchanged.
