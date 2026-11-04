# Selected Microsoft connections: implementation and activation boundary

Baseline: PR50 `0129fc8d28ed09a81d3a10fd706ad0f50b5e3f95`. This local change does not grant consent, install credentials, migrate a database or verify any live provider.

## What exists

- SharePoint: existing selected-site check and approved-library/item metadata routes. Site configuration combines explicit Prima user/company scope with approved drive IDs. Status performs no provider request. A successful selected check is evidence only for that user/resource/time, not a global connected state.
- Outlook: existing own-mailbox selected-message preview and explicit attach to an authorized IT job, with current job ACL, server preview proof, durable saved-copy store and expiry. Sending, scanning folders, attachments and AI processing are not registered. Staff continue sending in Outlook.
- New setup diagnostics name missing local prerequisites without returning credentials or resource IDs. The Connections card exposes the existing selected-email setup path rather than claiming a generic mailbox connection. A new UUID reuses the person's existing open setup ticket and persists an alias for recovery; closed-ticket UUID retries still return the original receipt. No pasted mail link is stored in setup tickets.

## Required administrator/resource setup (not performed)

1. Verify the confidential API registration and fixed tenant; do not assume the SPA client is the OBO application. Supply a server-held credential through the approved secret process. No browser-held client secret.
2. SharePoint requires delegated `Sites.Selected` consent, explicit read assignment to each approved site, current user's existing rights, and the app's exact selected site/library configuration. Provide the actual approved site URL and library names plus intended Prima user/company scope. A URL alone grants nothing.
3. Selected own-email preview currently uses delegated `Mail.Read`, whose actual permission is broader than one selected message; the application narrows reads to an explicit selected message under `/me`. This distinction requires explicit administrator approval, not a claim that consent itself is message-scoped. Configure the separate preview signing secret and reviewed `job-email-v2.sql` store only through approved deployment/migration procedures.
4. Saved-copy content expiry is currently 30 days in code. This is not evidence of approved organization-wide retention or deletion of backups/audit metadata. Confirm the retention/redistribution policy before activation.
5. Test with an approved pilot user: wrong user/site/library denied; selected SharePoint metadata read; selected own email preview, explicit job attach, current job visibility and expiration. Do not infer these successes from sign-in or a local `ConfiguredNotVerified` result.

The selected-message route and plain-text body preference are documented at https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0 .

Microsoft explains that selected-resource access requires consent, explicit resource assignment and an appropriate token: https://learn.microsoft.com/en-us/graph/permissions-selected-overview

## Teams: server-only interface, NOT a completed integration

`connections-teams/evidence-reader.ts` defines a trusted source port and verifies an exact selected approval result against current Finance state. Production composition injects **no source**. GET `/api/connections/teams/status` therefore reports `NotConfigured` / `TrustedReaderUnavailable`. There is no public decision ingestion POST, arbitrary endpoint configuration, Graph request or Finance approval mutation. A feature flag/manual link cannot make evidence trusted.

A future reviewed adapter must authenticate a fixed tenant/environment/flow/producer and obtain the selected approval result from a trusted server source. Bound response bytes and cancellation at that adapter. The reader checks source provenance, freshness, exact payment/beneficiary revision, amount/currency/reference, fresh attempt nonce, eligible immutable approver OIDs, complete decisions and expiry. Comments remain untrusted content. Verified objects are process-local, immutable and cannot be recreated by JSON deserialization.

Finance must construct the current attempt from its own database, and inside one transaction recheck current route/attempt/version/eligibility/SoD, call the current-attempt check, atomically consume source-result/version and attempt replay keys, and commit approval/audit/payee snapshot/expiry together. Identical resubmission needs a new attempt ID. This module does **not** provide that Finance transaction, durable replay ledger, payment execution or post-payment proof. Approval is not payment evidence. Pending/rejected/cancelled/incomplete/stale results never become approval.

Power Automate Approvals is the candidate supported integration surface, subject to actual environment, flow ownership, licensing and permissions review: https://learn.microsoft.com/en-us/connectors/approvals/
The Graph approval-items endpoint is beta and explicitly unsupported for production applications; it is not used here: https://learn.microsoft.com/en-us/graph/api/approvalsolution-list-approvalitems?view=graph-rest-beta

## Evidence and remaining gates

Tests use synthetic users/provider responses only. Run the API build and selected connection/Teams tests; the frontend has its own owner/session/setup recovery tests. Any database/browser CI result must be attached to the final integrated commit, not assumed from this local module. Live consent, selected resources, trusted Teams adapter and Finance atomic consumer remain distinct activation gates.
