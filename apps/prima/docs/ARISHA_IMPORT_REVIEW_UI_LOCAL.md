# Arisha import review UI — local candidate, 31 October 2026

Base: main `62ec74795c38ff5c70d5a8b3bb7fe3eac808155b`. Backend inspected: PR42 `a231e33`.
This UI is not published, deployed, or connected to backend writes. It must not be described as operational import completion.

## Built
- Existing extraction page hands at most 20 proposals into local review without another AI call.
- Exact authorized `api.itBoard().team` names and stable Prima IDs are shown, not a hardcoded roster or fuzzy match. Manager excluded under existing T9 semantics. Duplicate IDs rejected; duplicate names remain distinct.
- Evidence is copied unchanged; local edits explicitly human-edited, not newly verified source text or proof of AI provenance.
- Exact CEO ID plus current CEO marker and non-integration identity required. This browser guard is not the authorization boundary; server must recheck.
- Local state machine invalidates edited previews, prevents repeated requests, handles expiry, freezes approval, refuses uncertain retries, shows receipts/skips, and reconciles the same saved review.
- Default adapter is deliberately blocked. No REST write method is wired, no Graph calls, no paid AI calls added. Opening workspace only reads existing setup/directory surfaces.
- Cancel/back clears browser review only, never deletes server review/imported work. In-flight creation/approval and unknown results cannot silently reset. Page navigation still discards local state; server resumption/reconciliation is a release gate, not a client-storage workaround.

## Required backend contract before replacing blocked adapter
1. Authenticated per-account capability/readiness with explicit reviewed version, enabled/permitted flags, immutable evidence + resumability guarantee, supported 20-proposal limit. No inference from extraction readiness, CI, or route existence.
2. Stable eligible staff IDs for this import kind, current at preview and approval. `itBoard.team` has no offboarding/real-directory provenance flag: it must NOT be treated as confirmation that seeded names are real, identities linked, or accounts active.
3. Persist immutable extraction/source/evidence and original provenance. Updates may change explicitly human-edited fields but cannot replace original bindings. Server validates evidence; no browser assertion is trusted.
4. Return full safe resumable snapshot with version, active preview token, expiry, validated rows/errors and status. GET must not generate a token the approval endpoint rejects. Support 24h review editing without requiring 15-minute extraction to be recreated/recharged.
5. Idempotent create/update/approval, durable client-request reconciliation (including lost create response with no review ID), identity-scoped listing/resume, receipt return for an already approved batch. Current local candidate has no create replay/retry workaround; reload recovery is blocked until this exists.
6. Approval atomically binds exact version/token/rows/skips and current eligibility; duplicate clicks, expired versions and permissions fail closed. Do not turn model output into operational writes before exact CEO action.
7. Server enforcement and tests for 24h expiry and 30-day review-data purge. Policy is review data only, not imported records or guaranteed backup erasure. UI currently explicitly says enforcement pending verification.
8. Keep manual deterministic import at its existing 200-row limit; AI extraction remains 20 proposals. Multi-part 200-row AI aggregation is not approved by this frontend.

The UI adapter types are a normalized boundary, NOT a claim these routes already exist. Map actual PR42 `{review,preview}` responses to this model only after independent contract review. No backend files are changed by this patch.

## Validation
Run `npm run typecheck`, `npm run build`, and `node --test scripts/it-import-review-*.test.mjs scripts/it-extraction-state.test.mjs scripts/it-extraction-render.test.mjs`.
Synthetic-only tests; no staging DB, real staff records, Graph, AI, email, migrations, permissions or charges. Full API/database integration tests have NOT been run by this frontend task.

### Durable uncertain-result recovery design (release gate, not implemented)
Before enabling writes, allocate an opaque idempotency/request key bound by the server to the authenticated CEO, operation kind and immutable input digest. Persist only that key, owner account ID and pending status in the browser (never source, proposal text, tokens, staff records or evidence). On navigation/reload/account switch, check the server-owned operation/receipt before allowing a new batch. A lost create response must be discoverable by the same key even without a review ID. Clear the guard only after authoritative reconciliation or a server-confirmed safe cancellation; expiry alone is not proof that approval did not occur. Retain pending guards across route changes; do not reuse another account's key. Existing PR42 has no such reconciliation contract, so adding a client key alone would provide false safety. The default adapter stays disabled.

### Final local verification
- 36 synthetic state/render/extraction tests passed, including two issues caught independently (expired approved receipt retrieval and clearing an optional staff selection).
- Full local build and workspace typecheck passed after correcting isolated workspace dependency links. Final UI-only hygiene changes were rechecked with web typecheck/build.
- Independent synthetic QA: 22/23 probes passed; remaining lost-create-response reconciliation probe is a known backend/enablement gate, not an operational pass.
- No real browser interaction, staging login, real directory identity confirmation or live import is claimed by these unit/render checks.

Browser QA limitation: the available remote CUA Chrome could not reach the executor-local fixture (ERR_CONNECTION_REFUSED). No browser success is claimed and no browser workaround was attempted. Independent static-render coverage is separate.

## Combined frontend publication candidate — 31 October 2026, 14:45 UTC

Current main reverified as `62ec74795c38ff5c70d5a8b3bb7fe3eac808155b`. Combined candidate includes the read-only PR42 decoder, disabled production adapter, review UX and regression tests. It does NOT include any Claude backend files or offline prototype.

Additional completion work: handoff waits for authorized directory loading rather than silently losing a click; confirmed receipts allow an explicit next review, while unknown outcomes remain locked; proposal counts are displayed without claiming server-created counts.

Validation at this checkpoint: 51 synthetic state/render/contract tests passed and web typecheck passed. Final aggregate build/typecheck recorded in accompanying validation logs. Synthetic browser harness lives only in `scripts/it-import-review-browser-smoke.mjs`; it is not imported by the production bundle and requires explicit synthetic opt-in plus installed browser tooling. Local Chromium launch failed with `socket() failed: Operation not permitted` (SIGABRT); no browser retry/bypass was attempted after that restriction. Browser assertions did not execute. Earlier remote CUA localhost failure also remains a separate limitation.

Open repository PR inspection found no existing frontend import-review PR to update. PR42 is Claude-owned backend; do not mix these frontend changes into it. Suggested publication is a separate draft frontend PR only after owner review. Connected repository is private and has push permission, which is capability—not permission to publish without the requested checkpoint.

Operational completion still requires independently cleared backend contract and SQL gates, durable creation/reload reconciliation, permission and runtime checks, deployed frontend/backend compatibility, and actual staff/CEO browser UAT. The production write adapter intentionally remains disabled; none of these local results certifies deployed import operation.
