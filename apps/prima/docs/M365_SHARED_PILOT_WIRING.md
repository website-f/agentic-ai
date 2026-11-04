# Monday online pilot: shared Microsoft wiring

Build-time integration only; no live account, permission, secret, migration or deployment changed.

- Existing IT job drawer mounts the selected-job email panel with the signed-in Prima user ID. Every response is independently checked for user/job identity.
- Job-email controller/provider registration uses the reviewed request-scoped backend factory, PostgreSQL store and readiness checks. Mail Send and Power BI controllers remain UNREGISTERED. Users send in Outlook; autonomous replies remain outside Prima.
- Narrow Microsoft-only transport refuses development bearer fallback, arbitrary endpoints and Mail Send. No automatic retries or provider calls from rendering.
- Before mailbox configuration, paste an Outlook message link for local format checking, then explicitly request IT setup. Only a stable request UUID is sent; no email URL, ID, subject or body enters the setup ticket or recovery storage. A localStorage UUID plus Web Locks preserves setup uncertainty across reopen and prevents same-client duplicate operations. The backend serializes requests and returns the same ticket for the same user/request ID.
- Once configured: explicit Preview reads one own-mailbox message. The signed, expiring preview token binds the displayed snapshot; Attach sends that exact token. Unknown attach/remove results disable new mutations until saved-copy reconciliation. An Available copy, not an expired/removed record, can reconcile attach. Server canonical immutable message identity provides dedupe across drawer reload; no client source/token persistence.
- Copies expire after 30 days; UI does not falsely claim that physical storage or backups were erased. Operational retention cleanup remains a required deployment step.

Local synthetic tests cover transport refusal, identity/token shape, setup marker save/readback, lost response/reopen, claim denial, corrupted marker, no network on rendering and initial-status retry. Existing browser harness fixtures now use the signed preview-token contract. Local interactive browser execution remains blocked; CI/browser and real staff-account UAT must provide separate evidence. No source or mailbox content was sent to Arisha/AI.

Integration prerequisites: PR39 code plus job-email backend9e36db2, current-main Db Store callback, and signed-preview key/server OBO configuration after explicit approval. Shared AppModule/http/types/demo/Connections changes must be merged additively with Arisha PR44 and SharePoint request changes. No migrations are run by registration; missing configuration/schema keeps capabilities unavailable.

Before dispatch, the shared transport pins one Microsoft bearer, verifies `/api/me` matches the current screen's expected user, and rechecks the active Microsoft account key after token/identity awaits. A stale user-A panel cannot submit as newly signed-in user B and merely discover that mismatch after mutation. Response identity validation remains in addition to this pre-dispatch guard.
