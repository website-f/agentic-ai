# Selected Outlook email on an IT job — local Monday candidate

This document supersedes the mail-send setup snippets in STAFF_EMAIL_POWER_BI.md. Built locally from PR39 b3e2511; not a permission grant, migration, deployment or operational-readiness claim.

## Actual scope
Staff send and reply in Outlook. Prima reads a single message from the current linked user's own mailbox only after Preview; Attach re-reads it and stores the reviewed plain-text copy. No mailbox lists, search, scanning, subscriptions, files, shared mailbox, Send registration or Arisha access. SharePoint and Power BI are separate modules.

When not configured, the browser may validate a copied Outlook link locally and offer a setup request. `POST /api/connections/mail/jobs/setup { requestId }` accepts a UUID v4 ONLY, requires a verified linked Microsoft session, creates a generic M365 IT ticket, and returns `{serviceId:'mail',userId,requestId,ticketId,ticketRef,replayed}`. No email link, message ID or content is sent to this endpoint or stored in its ticket. Same-user setup requests are serialized via the transaction-scoped `job-email-setup:<userId>` advisory lock; retrying a request ID returns its prior ticket. This request neither grants access nor contacts Graph.

## Runtime registration
Only `jobEmailRuntimeModule()` from `connections-mail/controllers.ts` belongs in AppModule. It injects Db, uses PgJobEmailStore(db.pool), and performs fresh identity/job permission lookups in a new Db.asUser transaction per check. It never captures a live request Store in a singleton. Current-main Db already exposes the third Store callback argument; the old PR39 snapshot includes a compatibility delta for that API.

Do NOT register `mailConnectionsModule`, MailConnectionsController, StaffEmail, Mail.Send, or the Send ledger migration. Legacy code is inactive.

## Preview and attach contract (v2)
- `POST :jobId/emails/preview {outlookLink}` returns `{serviceId:'mail',userId,jobId,previewToken,expiresAt,snapshot}`.
- `POST :jobId/emails {outlookLink,previewToken}` attaches only after current permission checks, HMAC verification, and a second Graph read.
- `previewHash` is no longer accepted. Preview tokens expire after ten minutes and bind user, tenant, mailbox object ID, job, requested ID, canonical immutable Graph ID, content hash and issuance/expiry times. They contain no email body or provider token. Do not log or persist tokens in browser storage.
- Configure a distinct `JOB_EMAIL_PREVIEW_SECRET`: exactly 64 lowercase hexadecimal characters representing 32 random bytes, held server-side in Key Vault. Never reuse an OAuth credential; rotation invalidates outstanding previews. Missing/invalid key keeps the feature NotConfigured. No key was created by this work.
- Graph requests add `Prefer: outlook.body-content-type="text", IdType="ImmutableId"`. Canonical deduplication is `(job, tenant, mailbox OID, immutable message ID)`, not the sender-controlled Internet Message-ID header. Duplicate attach returns conflict with no second copy.

## Supported links and hard boundaries
Only HTTPS outlook.office.com/outlook.office365.com without credentials, nondefault port or fragment. Known shapes: `/mail/id/<id>`, `/mail/inbox/id/<id>` (also sentitems/drafts/deleteditems/junkemail/archive), optional numeric/u-numeric mailbox segment, `/mail/deeplink/read/<id>`, or `/owa/?ItemID=<id>`. Optional presentation parameters are bounded/allowlisted. Duplicate/contradictory message parameters fail.

A syntactically valid link is NOT proof that its embedded ID is Graph-compatible. The single `/me/messages/<id>` request must succeed. Unsupported tenant/Exchange URL formats fail closed with no search, redirect follow or translation fallback. Real tenant Outlook URL validation with a synthetic message remains a release gate. Adding translation or any additional scope needs separate review.

## Setup and activation gates
- Verify existing fixed ENTRA_TENANT_ID and confidential ENTRA_API_CLIENT_ID; do not substitute the known SPA registration by assumption.
- `JOB_EMAIL_ENABLED=true`, JOB_EMAIL_OBO_CLIENT_SECRET, and the separate preview secret, after reviewed setup.
- Delegated Mail.Read consent for the API. It technically permits own-mailbox reading; code restricts use to selected messages. No per-message Microsoft grant exists; never claim otherwise.
- Named checksum-verified module migration `module_job_email_attachments_v2`. `job-email-v1.sql` remains immutable. Version 2 is fresh-install/once-only and refuses an existing table rather than upgrading, dropping data or stamping an old structure. A runner must record the step and skip a completed install only after exact readiness passes. Existing v1 data needs a separate reviewed upgrade.
- Readiness is checked on every service call: exact table columns/nullability, primary/check constraints, canonical unique index, function bodies/configuration, forced RLS, policy identities and restricted-role permissions. Marker alone never proves readiness.
- Current job audience is enforced in API and database. Attachers: assignee, giver, IT manager/lead, COO on noncancelled jobs. Viewers also include CEO, audit, HR/chief of staff. This redistributes a copy beyond the mailbox owner; do not imply Outlook's mailbox ACL governs the stored copy.
- Local builds/tests are not tenant consent, site assignment, mailbox licensing, deployment or live UAT evidence.

## Retention truth
Snapshots are hidden on reads at expiry (30 days), and a separately scheduled privileged cleanup erases their stored body/subject/address snapshot. Removal erases the snapshot immediately and leaves a stub. Retained metadata includes attacher identity/name, job, timestamps, canonical message identity, Internet Message-ID, Outlook link, hash and events. Backups may retain previous snapshots under their own policy. Therefore “30 days” is not complete erasure of every associated datum or backup. No cleanup schedule or live migration was applied by this work.

No local browser caching/offline email copies: Monday is an online pilot. Unknown outcomes require reload/reconciliation, not an automatic second copy.

## Local evidence and packaging
The version-2 SQL SHA256 is `cefa0824c56a1e0f0e11c74d8929f181ed30810eef139f0116d72f27820e6e65`. Cleanup uses exact owner-only expired-row SELECT/UPDATE policies compatible with FORCE RLS; the table owner must be isolated from `prima_app`. Restricted-owner lifecycle tests were added, but PostgreSQL execution is still required: this workspace has no PostgreSQL server/binaries. This is a release gate, not a skipped success.

Backend targeted synthetic tests pass 16/16; script tests pass 85/85. Browser integration is assembled and checked separately with the shared frontend candidate. Do not overwrite current-main Db/PgStore with this older PR39 snapshot: use only additive new module paths and the narrow setup-prefix advisory-lock hunk. Current main already has Db.asUser's third Store callback argument.
