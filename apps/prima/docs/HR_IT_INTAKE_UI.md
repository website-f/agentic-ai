# Staged HR / IT coordination UI

This screen records and reviews coordination requests. It never binds a Microsoft identity, creates an account, applies roles/company access, or revokes access. Pending directory verification is not an operational completion. Urgent access closure follows its separately authorized procedure.

## Authority and flow

- HR selects an existing authorized staff/HR-person record, one company, ordinary role, effective date and reason. No freely typed identity association.
- IT Lead can collect unverified labels/evidence or prepare an unverified tenant/object proposal. Executive work requires a currently effective, independently Manager-approved delegation for that exact task. Collection does not authorize object-ID preparation.
- Distinct mapped CoS and Company Head review the same exact version/hash. Server capabilities decide eligibility; UI does not invent mappings.
- A separately mapped HR Administrator reviews handoff after both approvals. Missing protected storage, trusted tenant or authority configuration stays setup-needed. No apply/link action exists.
- Ordinary staff can see only server-authorized own requests and supply labels/evidence. The standalone navigation does not grant IT board access.

## Interruption and stale scope

The transport pins the authenticated account and bearer to an owner-verified `/me` result, rechecks account around the request, and validates the response owner/service. The editor freezes its admitted scope/version/capabilities; a refresh cannot silently advance an old draft. Form changes reset explicit confirmation.

Only `{operationId,kind}` is stored in an owner-scoped recovery marker; no UPN, object ID, subject or evidence is stored there. Web Locks serialize cooperating tabs. Lost or ambiguous writes retain the same identifier. Lookup `found:false` never authorizes forgetting a request. Explicit safe-close uses the server's serialized terminal tombstone; it returns an existing commit instead if already saved. Neither generic HTTP errors nor revoked authority clear markers.

## Evidence

Local tests cover owner isolation, four actor capabilities, stale scope, task-specific delegation, exact approval kind/version, confirmation reset, cancellation before submission, durable rejected/unknown outcomes, and actual backend staged flow without user/grant mutation. `hr-it-core.test.mjs` requires `PRIMA_REVIEWED_CORE_MODULE` built from the combined backend. CI explicitly invokes these tests.

`hr-it-browser-smoke.mjs` is a CI-only synthetic transport fixture using actual React components/session. It covers desktop/phone intake, collection-only fields, CoS exact scope, keyboard submission, confirmation, pre-submit cancel and commit-response-loss reload recovery. It does not exercise Microsoft authentication, real SQL, actual directory ownership or every reviewer actor in a browser. No local browser execution was performed.

Release remains gated on combined CI/browser results, reviewed protected-storage migration and restricted-database tests, trusted tenant/authority configuration and real-user acceptance. This UI is not an identity verifier or security certification.
