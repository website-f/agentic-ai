> Historical proposal and decision record. Current implemented UI/backend scope, exact schema and unresolved release gates are recorded in MONDAY_PILOT_COMBINED_CANDIDATE.md and MONDAY_PILOT_REQUIREMENTS_MATRIX.md. Earlier statements that UI is missing are not current availability claims. Nothing here proves deployment, migration, tenant setup or staff UAT.

# Proposal: Arisha IT extraction → T9 batch import handoff (backend interface)

Status (31 Oct 2026, evening): **server side built on this branch (draft PR #42)** after Fauzan said batch import must "come together" with Monday's real-data entry (18:59 MYT). Not merged, not migrated, not deployed. §10 lists what the build changed from the first proposal. Written by Fauzan 6 (Claude) on 31 Oct 2026 at Arisha main's request (her email of 10:41Z). Arisha main owns the mapping and preview UI and reviews this interface before anyone builds it. Fauzan approves the build, the migration and activation separately.

> **Read §10 and §11 first.** Sections 1 to 9 are the first proposal, kept for the record, and are superseded wherever §10 or §11 says otherwise. In particular, as built: there is no `approving` state (approval is one transaction); the review ledger's receipt keeps reason codes only (`error`, `duplicate`, `left_out`), never T9's reason text (T9's own operational receipt is separate; see §10, Receipt); `edited` is replaced by `quoted` / `typed` / `cleared`; the table is in `001_init.sql`, not a separate module migration; editing is `POST /reviews/:id`; and a new review needs a `requestId`.

Fauzan's requirement (31 Oct 2026, 18:29 MYT): batch import through in-app Arisha is a must. Arisha main: the manual T9 path already takes up to 200 IT rows per CSV or Excel paste. What's missing is Arisha's reviewed handoff into T9. No Monday commitment. No destructive rollback.

## 1. Principle: one write path

Arisha never writes IT records. The only write path stays `PrimaService.itImportApprove` (T9 slice 1, see `docs/IT_IMPORT_HANDOVER.md`), and all of its rules still apply unchanged:
- CEO only;
- preview-token binding;
- create-only;
- duplicate checks;
- `lock('itSettings','it')`;
- idempotent retry by `batchId`;
- per-item and per-batch audit.

The handoff adds a **durable review ledger** between `ItExtractionPreviewService.preview` (preview-only, `apps/api/src/arisha-it-extraction.ts`) and that T9 write path.

```
Arisha extraction (proposal, no writes)
   → CEO edits/accepts fields in Arisha's review UI
   → POST review       (ledger row: reviewed rows + hashes, status 'reviewing')
   → server renders reviewed rows into canonical CSV → itImportPreview (T9, no writes)
   → CEO approves the exact T9 preview (reviewId + version + previewToken + skipRows)
   → itImportApprove(batchId = reviewId)   ← the only write, unchanged T9 rules
   → ledger 'committed' with the T9 receipt
```

## 2. Ledger table: `prima.it_import_reviews` v1

This needs a versioned, CEO-run migration step (proposed name `module_it_import_reviews_v1`), with a pinned SHA-256 and a readiness gate checked on every call. It uses the same pattern as the PR #39 job-email table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Also used as the T9 `batchId`. |
| `actor_id` | text | Must be `u-fauzan`. |
| `kind` | text | `tickets` or `jobs`. |
| `extraction_id` | uuid | The `attemptId` of a successful extraction audit event for this actor. |
| `source_label` | text ≤120 | |
| `source_sha256` | char(64) | Must equal that extraction's audited `sourceSha256`. |
| `reviewed_rows` | jsonb | The rows the CEO reviewed: raw strings per field, plus an `edited` flag per field and evidence offsets. **The source text itself is never stored.** |
| `reviewed_hash` | char(64) | SHA-256 of the canonical CSV rendering of `reviewed_rows`. |
| `preview_token` | char(64) null | The latest T9 preview token. |
| `status` | text | `reviewing` → `approving` → `committed`, or `reviewing` → `abandoned` / `expired`. |
| `version` | int | Optimistic concurrency, incremented on every change. |
| `receipt` | jsonb null | Superseded (§10): `{ created, skipped: [{ row, reason code }], skipRows }`; the review ledger does not store T9's reason text. |
| `created_at`, `updated_at` | timestamptz | |
| `expires_at` | timestamptz | `created_at` + 24h while `reviewing`. |
| `purge_after` | timestamptz null | See retention below. |

Rules:
- RLS is forced. Rows are visible and writable only when `actor_id = current_setting('app.user_id')`.
- `prima_app` gets SELECT, INSERT and UPDATE. No DELETE.
- A guard trigger allows only the forward transitions above. It also allows clearing `reviewed_rows` after `purge_after`.
- **Retention (confirmed by Fauzan, 31 Oct 2026, 21:48 MYT):** clear `reviewed_rows` 30 days after commit, abandonment or expiry. Keep the hashes, counts and receipt. The created IT items keep their own `sourceRef`, as today.

## 3. Endpoints (all under `/api/arisha/it-import`, real linked Entra auth only)

The access check is the same as `extractionPermitted`: exact `u-fauzan`, plus the `ceo` tier, plus a verified Entra assertion, and never an integration or dev token. This check runs on **every** endpoint, including GET. Everyone else gets 403, with no row existence leaked.

| Method | Path | Body | Effect |
|---|---|---|---|
| POST | `/reviews` | `{ extractionId, kind, source: { label, sha256, canonicalText }, rows: [{ fields: Record<field, string\|null>, evidence?: Record<field,{start,end}> }] }` | Checks that the extraction audit event exists, belongs to this actor, has outcome `success`, and is within its 15-minute expiry. Checks `sha256(canonicalText) === source.sha256 === audited sourceSha256`. Re-checks evidence offsets against `canonicalText`, and marks a field `edited` where the raw value no longer matches. Renders the CSV, runs `itImportPreview`, and stores the ledger row. **`canonicalText` is used for verification only and is discarded.** Returns `{ reviewId, version, t9Preview }`. |
| PATCH | `/reviews/:id` | `{ version, rows }` | Only while `reviewing` and when the version matches; otherwise 409. Re-renders, re-runs the preview, and increments `version`. |
| POST | `/reviews/:id/approve` | `{ version, previewToken, skipRows }` | See §4. |
| POST | `/reviews/:id/abandon` | `{ version }` | `reviewing` → `abandoned`. |
| GET | `/reviews/:id` | none | The ledger row (without other users' data; RLS). |

### Rendering to T9 input (deterministic)

- Fixed heading row using the T9 mapping names for the kind, in a fixed column order. RFC 4180 CSV quoting, which T9's parser already handles, including multi-line `detail`.
- Values are passed **as reviewed**. Unknown dates or enums are not repaired; T9 reports them as row errors.
- Staff fields (`doer`, `itPerson`) must be picked by the CEO from the IT staff list in the review UI, and are rendered as that person's exact Prima name. A free-text staff value that T9's `findItPerson` can't match is a row error. Prima never guesses.
- The T9 `source` is `Arisha: <label> (sha256 <first 12>)`. T9 then gives each row the `sourceRef` `"<source>, row N"`.

## 4. Approve: exact batch, idempotent, crash-safe

(Superseded by §10: built as one transaction with no `approving` state.)

In one transaction on the ledger:
1. Lock the ledger row with `SELECT … FOR UPDATE`.
2. If `committed`, return the stored receipt with `{ already: true }`.
3. Require status `reviewing` or `approving`, a matching `version`, and `now < expires_at` (only while `reviewing`).
4. Re-render the CSV from the **stored** `reviewed_rows`. Never re-render from the request body. Require that its hash equals `reviewed_hash`.
5. Set status `approving` and commit.

Then call `itImportApprove({ kind, text, source, batchId: reviewId, previewToken, skipRows })`. T9 re-runs the preview inside its own lock and refuses a stale token. If the same batch was already imported with the same input and skips, it returns the original receipt.

Then, in a second transaction, lock the row again and set `committed` with the receipt.

**Crash or timeout between the two transactions:** the row stays `approving`. Retrying approve with the same `previewToken` and `skipRows` reaches T9's idempotent path, so it gets the original receipt and nothing is created twice. A retry with different skips is refused by T9, as today.

## 5. Corrections: no destructive rollback

There is no delete or undo by batch. Every created item carries `importBatchId = reviewId` and its `sourceRef`. Mistakes are fixed record by record on the normal IT screens, under the normal IT rules, with audit. A later "list items from this batch" read-only filter is fine.

## 6. Audit: metadata only

The audit records `it.import.review.create`, `.update`, `.approve`, `.commit`, `.abandon` and `.expire`, each with `entity: 'it_import_review'` and `entityId: reviewId`. Each entry carries only:
- `kind`;
- row count;
- edited-field count;
- the first 12 characters of `reviewed_hash`, `source_sha256` and `preview_token`;
- `extractionId`;
- `version`.

**No field values, names or source text.** T9 keeps writing its existing `it.ticket.import`, `it.job.import` and `it.import` lines.

## 7. Required tests (before any merge)

- **Negative permissions** on all five endpoints:
  - a fifth user, the FD, the COO, the ACT Director and the IT Lead each get 403;
  - a dev token gets 403 even with `ALLOW_DEV_LOGIN=true`;
  - an integration user gets 403;
  - a CEO without a verified Entra assertion gets 403;
  - GET leaks nothing.
- **Binding checks:**
  - an extraction ID from another actor, an expired extraction or a failed extraction is refused;
  - a source SHA mismatch is refused;
  - an evidence offset mismatch marks the field `edited`.
- **Concurrency on PostgreSQL through the restricted login:**
  - two simultaneous approves give one import;
  - a PATCH racing an approve gives a 409 or a clean order, never a mixed state;
  - a stale `version` gets 409.
- **Crash recovery:** a crash after `approving` followed by a retry returns the original receipt, and the created count is unchanged.
- **Approving from the wrong state:**
  - an abandoned or expired review can't be approved;
  - a tampered `reviewed_rows` (hash mismatch) is refused.
- **RLS:** another DB session's `app.user_id` can't read or update the row, and DELETE is refused.
- **Retention:** `reviewed_rows` is cleared after `purge_after`, and the hashes and receipt stay.
- **Readiness gate:** with the table missing, at the wrong version, or with wrong grants, every endpoint returns "not ready". There is no fallback.

## 8. Split of work (proposed)

- **Fauzan 6 (Claude):** the ledger SQL and readiness gate, the five endpoints, the rendering, the approve flow and all tests in §7, as a draft PR.
- **Arisha main:**
  - review of this interface;
  - the mapping and preview UI;
  - staff-picker wiring;
  - integration with `ItExtractionPreviewService`, flipping `readyForT9Preview` only when this is live;
  - deploy.
- **Fauzan:**
  - approves the build;
  - approves the migration step;
  - approves retention;
  - approves activation;
  - approves which data classes may be sent to Azure (`ARISHA_IT_EXTRACTION_DATA_CLASSES`).

## 9. Open questions for Arisha main

1. Should `canonicalText` be re-sent with `POST /reviews` for verification, as proposed, or should the extraction service keep a short-lived server-side copy? I prefer re-sending, because then no source text is stored anywhere.
2. Is 24h review expiry and 30-day purge of `reviewed_rows` acceptable to put to Fauzan?
3. Is it acceptable that one review equals one T9 batch (≤200 rows) while the extraction gives at most 20 model rows per call? The alternative is letting several extraction calls append to one review, up to the 200-row T9 limit.

## 10. As built (differences from the proposal above)

- **Where the table lives:** `prima.it_import_reviews` is in `db/migrations/001_init.sql`, next to `arisha_drafts`, so it rides the same CEO-run migration as the rest of main. That migration's SHA-256 changes, so Arisha main's Monday migration plan must use the merged main's SHA. There is no separate module step.
- **Table shape:** `(id text, data jsonb)`, like every other Prima table. The review is `ItImportReview` in `packages/core/src/it-import-review.ts`. It holds `parts[]`; each part is one extraction (`extractionId`, `sourceLabel`, `sourceSha256`, `rows[]`). There are 1 to 10 parts, with at most 200 rows in total, which answers question 3.
- **Database checks** (after Arisha main's reviews of a231e33 and 4901249):
  - Every check is null-safe (`coalesce(..., false)`), and one CHECK requires all 16 keys to be present (`id`, `actorId`, `kind`, `parts`, `counts`, `reviewedHash`, `previewToken`, `status`, `version`, `receipt`, `createdAt`, `updatedAt`, `expiresAt`, `purgeAfter`, `purged`, `requestHash`), so no change can remove one. The trigger compares with `IS DISTINCT FROM` throughout. Tested key by key through `prima_app`: an insert without it, an update removing it, and an update setting it to null are all refused.
  - The review ID must be a UUID v4.
  - Required fields as CHECKs: `parts` is an array, `counts` an object, `version` a whole number of at least 1, `reviewedHash` 64 lowercase hex, `previewToken` a non-empty string, `purged` a boolean, `receipt` null or an object, and the times are ISO timestamps (`purgeAfter` may be null).
  - RLS `review_own` admits a row only when `actorId` is exactly `u-fauzan`, equals the request's `app.user_id`, and `prima.is_ceo_request()` holds (opsTier `ceo`, not an integration). A second account given the CEO tier is still refused.
  - `prima_app` gets SELECT, INSERT and UPDATE only, so removing a row is refused.
  - Trigger `it_import_review_guard` (before INSERT or UPDATE):
    - a new review must be `reviewing`, version 1, `purged` false, `receipt` null and `purgeAfter` null;
    - `actorId`, `kind`, `createdAt` and `expiresAt` never change;
    - an open review changes only by raising its version by exactly one; it stays unpurged, and while open it has no receipt and no keeping time;
    - expiry is allowed only after `expiresAt`, only inside the retention function (the trigger checks it runs as the table owner), sets `purgeAfter` to exactly `expiresAt` + 30 days, and changes nothing else but `status` and `updatedAt` (the version stays);
    - closing (committed or abandoned) sets `purgeAfter` between 29 and 31 days from now;
    - closing (committed or abandoned) must keep the parts, counts, fingerprint and preview token exactly as reviewed; committed needs a receipt, abandoned has none;
    - a closed review allows one change only: clearing, inside the retention function, after `purgeAfter`, where everything except `parts`, `purged` and `updatedAt` stays equal, and `parts` must equal the old parts with each part's `rows` emptied (extraction, label, fingerprint and admission time stay).
- **No "approving" state:** every API request is already one database transaction (`Db.asUser`). So approve does the following in one transaction:
  1. locks the review (`SELECT … FOR UPDATE`);
  2. re-renders the text from the stored review;
  3. checks `reviewedHash` and `previewToken`;
  4. calls `itImportApprove` with `batchId = review id`;
  5. marks the review `committed`.
  Either all of it lands or none of it does. A retry after an uncertain answer returns the first receipt (`already: true`).
- **Expiry and keeping time:** an open review expires 24h after it was started; a closed review clears its rows 30 days after it closed, and an expired one 30 days after its expiry time (not when clean-up noticed). Fauzan confirmed 24h and 30 days on 31 Oct 2026, 21:48 MYT.
  - Both run only in `prima.tidy_it_import_reviews(by)`, one UPDATE each, so an approval at the same moment either lands first or finds the review expired.
  - **Who may run it:** the CEO's own review requests, meaning `app.user_id` is exactly `u-fauzan` and that account is the CEO (it runs at the start of each), and the daily job, which sets `app.job = review-tidy` (`npm run reviews:tidy -w @prima/api -- --by "<who>"`, `apps/api/src/tidy-reviews.ts`). Anyone else gets 42501, and `by` must name who is running it.
  - **Audit cannot be skipped:** the function writes each expiry and clearing to the audit chain itself, in the same transaction, through `prima.audit_append_internal` (hashed exactly as `packages/core/src/audit.ts` does; `verifyChain` passes on the result). No role but the owner may call that internal function. Because the trigger allows expiry and clearing only as the table owner, a direct UPDATE by the app role cannot do either without the audit.
  - **Audit head on Azure:** a new policy `audit_owner_read` lets the schema owner read the whole audit log, so `prima.audit_head()` finds the true head. Without it, on a non-superuser owner (Azure), a request that cannot see some companies' entries gets an older head (shown locally: true head 99, head seen 3). That affects all audit writes, not only this PR. The same policy, with the same text, is in PR #45 for Monday's migration. If PR #45 merges first, this branch merges main and keeps one copy; the schema SHA is then whatever main plus this PR gives, and Arisha main uses the SHA of what is actually merged.
  - The function is SECURITY DEFINER, owned by the schema owner, which policy `review_tidy` alone admits. Tested with a non-superuser owner, like the Azure admin (`apps/api/test/setup.test.ts`).
- **Retry-safe start:** `POST /reviews` takes `{ requestId, kind, parts }`. `requestId` is a fresh UUID v4 from the screen and becomes the review ID. A retry with the same ID and the same request (fingerprint `requestHash` of kind and parts, keys sorted) returns the first review with `replayed: true`, even after the 15-minute extraction window, and writes nothing. The same ID with a different request gets 409. Two at once make one review (advisory lock on the ID). After a lost answer, `GET /reviews/:requestId` also finds it.
- **Readiness:** `GET /api/arisha/it-import` returns `{ enabled, ready, problems }` (problems for the CEO only). `ready` needs the switch on, the CEO, and no problems. The database is asked directly: the table exists with forced RLS, the CEO policy, the guard trigger enabled, the field checks, the retention and internal audit functions; `prima_app` can SELECT, INSERT and UPDATE but not DELETE or TRUNCATE, can run retention, and cannot call the internal audit function. Every review route answers 503 while anything is missing. The API already refuses to start on an older schema fingerprint.
- **Routes** (`apps/api/src/arisha-it-import.controller.ts`, registered in `AppModule`):
  - `GET /api/arisha/it-import`: `{ enabled, ready }`. Never 503; `ready` is true only for the CEO when the switch is on.
  - `POST /reviews`; `GET /reviews/:id` (adds `stale`); `POST /reviews/:id` (edit); `POST /reviews/:id/refresh`; `POST /reviews/:id/approve`; `POST /reviews/:id/abandon`.
  - **Switch:** every review route answers 503 and reads or writes nothing unless `ARISHA_IT_IMPORT_ENABLED` is exactly `true`. Default off; it stays off until Arisha main has verified the handoff.
  - Each route needs a verified Microsoft sign-in whose object ID matches the CEO's linked account. A development token gets 403.
  - A stale version or a closed review gets 409.
- **Extraction check:** reads the CEO's own `arisha.extraction.terminal` audit entry for that `extractionId`. The outcome must be `success`, the kind and source SHA-256 must match, and the entry must be at most 15 minutes old.
- **Field labels** (replace the single `edited` flag): each row has a `rowId` and three lists. `quoted`: the value equals the source text at its evidence span, word for word. `typed`: anything else with a value (no evidence, or a value that differs from it). `cleared`: empty, where evidence pointed at something. Evidence outside the source (negative, empty, past the end, or not two whole numbers) is refused with 400, never relabelled. A staff field is never `quoted`.
- **Staff by stable ID:** `itPerson` and `doer` must be a Prima user ID of the IT Lead or an active IT Executive (not the IT Manager, not an integration, not closed). A name is refused. Approval checks every named person again and refuses with 409 if anyone has left IT or been closed since.
- **Receipt:** the first approval and every retry return the same shape, `{ reviewId, already, created, skipped, skipRows }`, where `skipped` is `{ row, reason }` with reason `error`, `duplicate` or `left_out`. T9's full reasons are shown on the preview before approval. The exclusion applies to the review ledger only: T9's unchanged approval still writes its own operational receipt (`importReceipt` on the first created ticket or job, with T9's `skipped` reasons as text, which can quote a cell value such as an unmatched IT person) and its own `it.import` audit line (counts, created references, source label and preview prefix). Those are ordinary IT records and the audit log; clearing a review does not touch them.

### Tests run (local, 31 Oct 2026, after the review fixes)

- `packages/core/test/it-import-review.test.ts`, 12 tests: the 7 earlier ones (updated for row labels and staff IDs), plus:
  - resume after the 15-minute window: an admitted part is edited by `rowId` without its source; changed values become `typed`, an emptied one `cleared`; an unknown or repeated `rowId` is refused; a resent source still needs a recent extraction;
  - evidence past the end, or empty, is refused; a value emptied against evidence is `cleared` and the source is not stored;
  - staff by name or the IT Manager's ID is refused; an IT Executive closed after review blocks approval with nothing created;
  - refresh: an unchanged preview writes nothing; after someone logs the same request by hand the review reads `stale`, the old token is refused, refresh saves version 2, and approval then creates only the new row with `duplicate` kept as a code;
  - only reason codes are stored for skips; expiry and clearing are audited.
- `apps/api/test/it-import-review.test.ts` on PostgreSQL 16 through `prima_app`, 6 tests: the 3 earlier ones, plus:
  - the CHECKs refuse each malformed field, the insert rule refuses any new review that is not open at version 1, and a second account with the CEO tier still cannot write; versions must rise by exactly one, start and expiry times cannot move, early expiry and a closing that changes the parts are refused;
  - expiry runs from a request and keeps the version; early clearing is refused even for the CEO's login; clearing that touches counts or removes parts is refused; the daily job clears through the app role only, changes nothing but rows, `purged` and `updatedAt`, and audits without values;
  - the switch: off, empty, `false`, `TRUE` and `1` all give 503 on create, refresh and approve; on, without a Microsoft sign-in, 403 (status too).
- `apps/api/test/setup.test.ts`: retention runs with a non-superuser schema owner, called by the API login through `prima_app`.
- Full suites: core 350/350, API 175/175 (the PostgreSQL file 10 runs in a row without a failure), web typecheck clean, demo web build OK.

### Tests added after the second review (4901249)

- Core, 3 more (15 in the file): a create retried with the same request ID after the extraction window returns the first review and writes one audit entry, a reused ID with a different request or a bad ID is refused; first approval and retry return the same receipt; an expired review is kept 30 days from its expiry time.
- PostgreSQL, 2 more (8 in the file) and stronger existing ones: each of the 16 keys missing, removed or set to null is refused through `prima_app`; the CEO's login cannot expire or clear directly; retention from a request and the daily job is audited by the database and `verifyChain` passes; the COO, an empty `by` and the internal audit function are refused; two creates with the same request ID at once make one review; readiness reports a disabled guard, a missing UPDATE right and an added DELETE right.
- `setup.test.ts`: under the non-superuser owner, the API login is refused retention without the job setting, runs it with it, and the audit entry it writes verifies.
- Full suites: core 353/353, API 177/177 (the review file 5 runs in a row without a failure), web typecheck clean.

### Still for Arisha main

- The review UI and staff picker.
- Wiring `ItExtractionPreviewService` to hand over `extractionId` and the canonical text, then setting `readyForT9Preview` when this is live.
- Her review of this PR, and the migration plan with the new schema SHA.
- Turning on `ARISHA_IT_IMPORT_ENABLED` only after she has verified the handoff, and scheduling `reviews:tidy` daily.

## 11. Contracts for the review UI

**Version.** Every review starts at version 1. Every successful edit, refresh that changes the preview, approval and abandon raises it by exactly one; expiry and clearing do not. Each write sends the version the screen last read; a different one gets 409 ("Load it again"), and the screen reloads with `GET /reviews/:id`. Never retry a 409 with a guessed version. Two replays are the exceptions, and both are deliberate:
- A create replay (same `requestId`, same request) returns the review as it is now, at its current version, which is above 1 if it was edited since. It does not reset or raise the version.
- An approval retry sends exactly the first attempt's body, including the version sent then. The committed review is one version higher, and that is expected: for a committed review the server compares only `previewToken` and `skipRows`, and returns the stored receipt with `already: true`. Any other body gets 409.

**Retries.** Start: make one `requestId` (UUID v4) per new review and keep it until the review is shown; a lost answer is recovered by sending the same body again (`replayed: true`) or by `GET /reviews/:requestId`. Approve: a network error or 5xx is safe to retry with the same body: the T9 batch ID is the review ID, so a second approval returns the first receipt with `already: true` and creates nothing. A retry that changes `skipRows` gets 409. Edit, refresh and abandon are not idempotent by themselves; after an uncertain answer, read the review and compare its version before sending again.

**Source rows.** A review starts with `{ requestId, kind, parts }`. A part is admitted once, with `{ extractionId, source: { label, sha256, canonicalText }, rows: [{ fields, evidence? }] }`, within 15 minutes of the CEO's own successful extraction. Its source text is checked and dropped. After that the part is sent as `{ extractionId, rows: [{ rowId?, fields }] }`, with no source and no time limit while the review is open. Send every row the CEO keeps: a row left out is removed, a row with its `rowId` keeps the labels of unchanged values, a row with no `rowId` is new (all its values `typed`). Leaving a part out removes it. Sheet row numbers (for `skipRows` and the receipt) run from 2 across parts in order.

**Stale preview.** `GET /reviews/:id` returns `stale: true` when Prima has changed since the saved preview (for example, someone logged the same request by hand). Approval needs the saved token, so the screen calls `POST /reviews/:id/refresh` with the version, shows the new preview, and approves with the new version and token.

**What is kept, and where.** Clearing a review is not complete erasure. After clearing, the review row still holds: the review ID, owner, kind, status, version, times, `requestHash`, `reviewedHash`, `previewToken`, counts, the receipt (created item IDs, row numbers and reason codes) and, for each part, the extraction ID, the source label the CEO typed, the source SHA-256 and the admission time. Outside the review:
- the IT tickets and jobs created by an approval are ordinary Prima records, kept like any other, and each carries `importBatchId` and a `sourceRef` that includes the source label;
- the audit log keeps the review entries (ID, kind, counts, fingerprint prefixes, outcome) and T9's own import entries, and is never cleared;
- Arisha's extraction audit entries keep the source SHA-256 and length;
- database backups keep earlier copies for the server's backup retention (below).
So the source label should not contain personal data; the review screen should say so.

**Retention and backups.** The approved 24-hour review expiry and 30-day payload-clearing rules apply to review rows, not all related records, audits or backups. Backup retention must be read from the actual approved environment; this proposal does not establish its configured value or change it.

**Proposed clean-up scheduling (not applied).** Review requests already invoke clean-up; a separately approved scheduled task would also cover periods without interactive requests. Before any change, verify the selected environment, reviewed image, database identity, current schedule and cost in approved configuration. Use generic references such as `<resource-group>`, `<api-app>` and `<cleanup-job>` in review material. Do not copy staff identities, resource identifiers, URLs or secrets into this document.

The task would run the existing `node dist/src/tidy-reviews.js` command with a descriptive audit actor label. Frequency, time zone, retry policy, deployment configuration and cost require explicit review; no free-tier guarantee is made. Confirm actual run results and expiry/purge audit outcomes, and preserve a reviewed recovery plan. This document does not authorize creating, deleting or modifying a cloud job, secret, identity or deployment.
