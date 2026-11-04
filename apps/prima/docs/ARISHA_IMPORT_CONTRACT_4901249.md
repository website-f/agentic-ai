# Import review contract preparation — PR42 4901249, local only

Read exact head `4901249f54e66894e340f6035f625476fe833d7c`. This branch extends local frontend candidate `d2e3503` with a read-only response decoder and synthetic tests. No API transport, writes, endpoint activation or backend change is added. Production UI remains on its disabled adapter.

## New backend interface observed
- GET `/api/arisha/it-import`: `{enabled,ready}`; default-off `ARISHA_IT_IMPORT_ENABLED`. The response currently means flag+CEO, not a complete verified capability contract.
- POST `reviews`: still `{kind,parts}` with server-generated random review ID. Lost create response has no stable client request ID or lookup/list reconciliation route.
- GET known review ID: `{review,preview,stale}`. `review.previewToken` is the saved token; a changed preview token must not silently replace it.
- POST `reviews/:id/refresh`: `{version}`; explicit transaction persists refreshed token and updates version when needed.
- POST update: admitted source is `{extractionId,rows:[{rowId,fields}]}`; no resubmission of canonical text for already admitted source. New extraction parts still require source/evidence.
- First approval's skipped rows use `{row,why}`. Retry/GET receipts use `{row,reason}` reason codes. Decoder preserves either, rejects ambiguity/unknown codes and does not invent successful records.

## Decoder safeguards
- Exact expected review ID/CEO actor, bounded fields/counts, strict supported shape.
- Sheet rows start at2 (CSV heading is row1), independent of extraction proposal numbering. Stable part/extraction/row identifiers preserved.
- `source-supported`, `human-entered`, `cleared`, `unverified` labels only. Server response does not contain original source offsets; decoder does not fabricate original evidence or certify original model output.
- Saved versus displayed preview token remains explicit; stale response requires refresh.
- Purged committed reviews retain counts/receipts without pretending deleted proposal content is available.
- AI scope remains at most20 rows even though manual T9 supports200. Multi-source expansion not silently adopted.
- `canWrite` is alwaysfalse in this preparation layer, including server enabled+ready=true.

## Blocking integration requests (draft only, not sent)
1. Durable owner-bound idempotency key supplied BEFORE create, canonical payload binding, and lookup by key after lost response. No timeout-driven new batch creation.
2. Durable client pending-request/review guard across navigation and reload; no source/token storage workaround. Server receipt resolution must precede unlocking creation after uncertainty.
3. Reviewed activation/version contract including missing-schema/grant/purge readiness and server validation of eligible stable staff IDs. Browser directory labels do not establish active eligibility or real identity provenance.
4. Independent review of PR42 revisions and SQL/HTTP tests before wiring. This decoder's unit tests do not establish backend correctness or permission enforcement.

Validation: `node --test scripts/it-import-contract.test.mjs` (13 synthetic tests), plus web TypeScript check. No real data, Azure/Graph/AI requests, migrations, publication or deployment. Offline prototype `0672eada` is unchanged and separate; its72-hour access policy does not change import24-hour expiry/30-day purge.
