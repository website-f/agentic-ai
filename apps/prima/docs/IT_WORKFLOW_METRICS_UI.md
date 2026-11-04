# Timing and quality frontend — source-backed first slice

New isolated implementation on the verified metrics-v3 contract snapshot. This is not attendance tracking, physical productivity measurement, surveillance, staff ranking, complete Phase1 instrumentation or an HR-review authorization system.

## Actual UI scope

- A dedicated signed-in route calls owner-pinned, allowlisted metrics actions; it does not fetch a generic IT board on behalf of otherwise unauthorized staff. Navigation availability is not record permission. All choices, current actions, stage owner, coverage segment and source versions come from current server authorization.
- Current adapters: assigned job work/check/approve, ticket work/confirm, and linked website-ticket work/confirm. Seven other workflow categories remain explicitly not instrumented. Ordinary inspection jobs do not become separately instrumented inspections.
- Intervals start prospectively in queued state. Staff explicitly record active, paused/internal queue, external wait and readiness for handoff. These are staff-recorded intervals, not proof of continuous activity. Readiness for handoff is not domain submission or reviewer latency; authorized resumption remains available.
- External waiting needs a server-permitted internal liaison ID, a reason, note and explicit next-review time in Malaysia time. Total elapsed never pauses. Actual source submission/approval/confirmation still happens in existing workflow screens; timing sync rechecks the stored domain outcome and cannot create it.
- Assignment/cycle/entitlement boundaries remain unknown until the original owner explicitly reconciles the minimal server recovery reference. No fabricated stop/completion timestamp or quality pass is supplied. Later segments are server-derived, never chosen by staff.
- Source quality remains nullable. Closed-stage quality is an immutable closure-time snapshot, not a promise to incorporate later downstream acceptance. Missing calendar/targets/history is unknown, never zero/free/on-time/pass.
- Cohorts are consumed from the server, grouped by workflow, stage, complexity, target version and calendar version, with sample sizes and known denominators. Completed results, open age and unknown measurements are separate; no cross-role fastest-staff ranking.
- Current IT Manager may record new provisional target revisions from the explicit authorized revision list. Fields begin blank, no sample targets installed automatically. Existing stream target/calendar snapshots and domain deadlines are not changed. The UI does not configure calendars or grant HR access.
- Owner requested HR KPI review. Its scoped review/acknowledgment process remains a separate required proposal/implementation; this panel does not claim it is delivered.

## Interrupted work

A single panel session and owner+operation+UUID-only recovery marker serialize writes with a browser Web Lock. No workflow payload, notes or tokens are persisted in that marker. Unknown results retain the UUID; missing receipt is not cancellation. Explicit abandon relies on the server's guarded tombstone. Expected stream/source/target versions and the admitted UI snapshot do not silently advance beneath a stale form. Account change hides prior data and transport checks the selected identity before and after requests. The standalone route remains reachable for active original-owner receipt/boundary recovery after IT entitlement loss, without domain reads being granted.

## Evidence gates

Local source, decoder/state, actual-component, actual-core adapter, typecheck and build evidence are separate from PostgreSQL/RLS, interactive-browser CI, deployed configuration and real staff UAT. The CI browser harness uses the actual panel/session but a synthetic gateway; it does not prove production authorization or SQL races. No live provider action, staff observation, payment, approval, access change or deployment is performed by these tests.
