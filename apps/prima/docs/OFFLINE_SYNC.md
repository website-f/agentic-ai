# Offline work: server side (draft, switched off)

Status (31 Oct 2026; review fixes 1 Nov 2026): **built on a draft PR, not merged, not migrated, not deployed, switched off.**

Fauzan approved 72-hour offline work on 31 Oct 2026 at 14:56Z: "almost all that can be offlined can be use. but any that to complicated to offline, we let it be in online." Arisha main agreed the contract on 31 Oct 2026 at 15:12Z and said Fauzan asked for this draft PR. Arisha main owns the device side: the local queue, encryption and unlock, and the screens.

**Before anyone turns it on**, these need review: device trust, local encryption and unlock, how long receipts are kept, and how long replay protection is kept. Turning it on also needs a CEO-run migration (the schema fingerprint changes) and Fauzan's approval.

## Scope

There are only two operations, with no attachments and no replay of any other route:
- `helpRequest { title, category, priority, detail }` raises an IT help request as the person, through the normal `raiseItTicket` rules.
- `jobNote { targetId, baseVersion, note }` adds a note to an IT job through the normal `itJobStep('note')` rules. `baseVersion` is the number of entries in the job's `log` when the device last saw the job.

Everything else stays online: approvals, accept, return, assign, anything financial, HR, PDPA, audit or import, and every removal.

**Who:** only the user IDs in `OFFLINE_SYNC_USERS`, and only while `OFFLINE_SYNC_ENABLED` is exactly `true`. Both are off by default. Integrations and shared site devices are never allowed.

## Routes (`apps/api/src/offline.controller.ts`)

Every route needs a current Microsoft sign-in whose object ID matches the linked account. That sign-in, not the device, proves who is sending. Every route answers 503 while the switch is off.

| Method | Path | Body | What it does |
|---|---|---|---|
| POST | `/api/offline/lease` | `{ deviceLabel }` | Issues `{ id, userId, deviceLabel, issuedAt, expiresAt }`, with `expiresAt` = `issuedAt` + 72h by server time. At most 5 open leases per person, counted under a lock so requests at once cannot pass the limit. There is no renewal: a new lease is a new slot and never extends work saved under an older one. The label names the device and is not proof of trust. |
| POST | `/api/offline/ops` | `{ ops: [{ opId, leaseId, kind, createdAt, payload }] }` | Takes 1 to 50 operations, applied in order. Each operation names the lease it was saved under (changed 1 Nov 2026; there is no batch-level lease). Returns `{ receipts: [{ opId, status, reason, resultId, replayed, serverAt }] }`. |
| GET | `/api/offline/ops?opIds=a,b` or `?since=<time>` | | Returns the person's own receipts. Use it to settle a lost answer before sending again. |
| POST | `/api/offline/ops/:opId/resolve` | `{ action: 'discard' }` or `{ action: 'send', payload }` | Decides a held operation, once. Sending again requires the same content, checked against the stored fingerprint, and the normal rules still apply. |

## Rules

- **Server-bound expiry:** an operation is accepted only if the lease it was saved under belongs to the signed-in person and the server receives it before that lease's `expiresAt`. The device's `createdAt` is kept for information only and decides nothing. A late operation is `rejected` with `lease_expired`, even when the device holds a newer lease.
  - A device that relabels old work with a newer lease is the signed-in person sending it now: every rule and the record time are taken at sync, so it gains nothing an online action would not. Proving when a device really saved something needs device-held keys, which belong to the device-trust review.
- **Immutable operation IDs:** `opId` is a UUID v4 made when the person saves. The ledger `prima.offline_ops` is keyed by `userId:opId` and is never removed, so an ID can never run twice.
  - The same ID with the same content returns the first receipt (`replayed: true`).
  - The same ID with different content gets `conflict` / `op_id_reused`, and nothing is applied.
  - Two sends of the same new ID at once wait on an advisory lock, so one applies and the other replays.
- **Atomic receipts:** each operation runs in its own savepoint. Its effect, its ledger row and its audit entry land together or not at all.
  - An unexpected failure returns `error` / `try_again` for that operation, keeps nothing of it, and stops the batch there so the rest keep their order.
  - Operations already applied in that batch stay applied.
- **Current permissions at sync:** each operation runs through the same rules as the online action, as if the person acted now. Access taken away since gives `not_allowed`.
- **Review, not overwrite:**
  - A help request whose title matches an open request by the same person is held as `needs_review` / `duplicate_suspected`, and nothing is created. The check runs under a per-person lock, so two different operations with the same title sent at once from two devices give one request and one held item.
  - A job note is held as `needs_review` / `job_changed` if the job's log moved on since `baseVersion`, or the job was accepted or cancelled. Nothing is appended.
  - The person resolves each held item with `send` or `discard`.
- **Statuses:** `applied`, `needs_review`, `rejected`, `discarded`. Receipt-only statuses that are not stored: `conflict`, `error`.
- **Reason codes:** `duplicate_suspected`, `job_changed`, `not_allowed`, `not_found`, `bad_payload`, `lease_expired`, `lease_not_valid`, `op_id_reused`, `try_again`. Codes only, never free text.
- **Record time:** a synced request's time is the server's time when it synced, and the ticket carries `offlineOpId`. The ledger keeps `deviceAt` for information.
- **No content kept:** the ledger keeps a SHA-256 of the kind and payload (keys sorted), never the content. Audit entries (`offline.lease`, `offline.op.<status>`) keep kind, status, reason and result ID only. The ticket and the job note themselves are ordinary IT records.

## Database (`db/migrations/001_init.sql`)

- `prima.offline_leases`:
  - forced RLS, own rows only;
  - `prima_app` may SELECT and INSERT only, so a lease is never changed or removed;
  - a CHECK requires every key and limits a lease to 72 hours.
- `prima.offline_ops`:
  - forced RLS, own rows only;
  - `prima_app` may SELECT, INSERT and UPDATE, with no DELETE;
  - a null-safe CHECK requires every key, a UUID v4 `opId`, `id = userId:opId`, a 64-hex fingerprint, and a known kind and status;
  - the guard trigger keeps `id`, `userId`, `opId`, `leaseId`, `kind`, `payloadHash`, `deviceAt` and `receivedAt` unchanged, and lets only a `needs_review` row be decided, once.

## Device side (Arisha main)

- **Queue:** kept in IndexedDB and encrypted. Encryption and unlock get their own review.
- **Expiry and logout:** when the lease expires or the person signs out, sending stops. Unsynced work is kept, never deleted silently, and only the same account, signed in again, can see or send it.
- **Expired items:** work on an expired lease is never sent automatically. The person re-enters it online or discards it explicitly.
- **When it syncs:** automatically whenever the app is open, or reopened, online. Delivery while the app is closed is not promised.
- **Lost answers:** before sending again, ask `GET /api/offline/ops?opIds=` for the receipts.

## Still open (proposals, not built)

- Receipt detail retention: the proposal is to clear `resultId`, `reason` and times after 30 days. Any such clearing keeps the tombstone (`userId`, `opId`, `payloadHash`, `status`, `leaseId`), and an old operation still fails the lease check. It needs review first.
- Replay-protection retention: the ledger rows are kept indefinitely for now.
- Device trust and local encryption and unlock: to be reviewed separately.

## Tests

- `packages/core/test/offline-sync.test.ts` (7 tests):
  - only allowed staff (not the CEO, COO or IT Manager unless listed; never an integration or a shared site device);
  - apply once, recover a lost answer, retry as a replay, a reused ID refused;
  - the 72 hours counted on the server clock even when the device clock says otherwise, and an expired ID never runs later under a new lease;
  - work saved under a lease that ended is refused even while a newer lease is open, and every operation must name its lease;
  - another account's lease refused, and revoked access refused at sync;
  - a duplicate and a changed job held, then send-anyway (same content only) and discard, once each, and nobody else decides them;
  - malformed batches refused whole, malformed content per operation, and an audit with codes only.
- `apps/api/test/offline-sync.test.ts` on PostgreSQL 16 through `prima_app` (6 tests; the two race tests fail with the locks removed):
  - two sends at once give one request;
  - two different operations with the same title at once give one request and one held item;
  - eight lease requests at once never pass the limit of 5;
  - a failure part-way keeps the earlier one, keeps nothing of the failed one, and stops, and a later resend lands the rest in order;
  - row-level security, no DELETE, leases unchangeable, operations kept as sent, decided once, at most 72 hours;
  - the switch (503 for unset, empty, `false`, `TRUE` and `1`), 403 without a Microsoft sign-in, and the allow-list parsing.
