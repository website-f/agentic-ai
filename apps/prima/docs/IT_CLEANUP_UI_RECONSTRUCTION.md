# Controlled cleanup UI — new local reconstruction

Based on the verified 473-file pre-cleanup source, not a claim that a previously lost artifact was recovered. The frontend requires the separately reviewed cleanup backend and its protected dependency/SQL module. Missing readiness means no domain actions.

## User workflow

- Existing authorized IT assets, systems and intake panels show a company-scoped documentary nomination/review panel. The server decides record visibility and capabilities. Manual/seed/import labels do not prove demo origin.
- A nomination captures an exact source hash and documentary origin summary (20–500 characters) and reference (12–1000). It does not classify or archive a record.
- A distinct current IT Lead—not the creator/nominator, and no Manager fallback—may record a hold decision. Archive is a separate capability: exact current source, verified-demo classification, documentary attestation and current dependency checks are required. Real/mixed/unknown origin or incomplete coverage cannot be assumed safe.
- Restore binds the active nomination, nomination version, archive version and record hash, with server conflict/dependency rechecks. IDs, histories, immutable receipts and identifier reservations are preserved. There is no hard-delete action.
- A single panel session shares an owner/action/UUID-only durable marker and browser Web Lock across editor and recovery. Evidence and form payloads are not stored in the marker. Unknown results retain the original identity; not-found does not mean cancelled. Explicit abandon relies on the server's serialized terminal tombstone.
- Own receipt-only recovery is also mounted outside IT navigation for an active original owner who loses IT entitlement. It offers no board read or domain write. Disabled/closed identities remain denied by the server. Generic network/authorization errors never clear the marker.

## Verification boundaries

Synthetic state, actual-component render, account-switch transport and actual-core gateway tests exercise nomination, independent review, hold/restore, stale snapshots, lost-response recovery, repeated actions and cancellation before submission. The CI-only browser harness uses the actual panel/session with a synthetic gateway at desktop/mobile widths; it is not local browser evidence, SQL evidence or real staff-role UAT.

The browser fixture does not replace server/SQL independence checks. The actual-core fixture separately checks Manager/creator refusal and receipt-only recovery after entitlement loss. New restricted PostgreSQL dependency/writer races and migration rehearsal remain backend release gates. No live archive, provider call, permission change or deployment is performed by these tests.
