# HR / IT identity coordination — staged, not account provisioning

## Direct owner policy implemented locally
HR prepares the staff subject and exact proposed role/company scope. Two **different** authorized people, CoS and the relevant Company's Head, review that same request version/hash before an explicitly entitled HR Administrator reviews the handoff. IT Lead prepares technical Microsoft identity details; only a current Manager-approved, target/task-bound, expiring delegation permits an IT Executive to do that work. A collection-only delegation permits sign-in label/evidence collection, never tenant/OID preparation; preparing the technical link request requires its distinct approved task. Staff can supply their own unverified sign-in label/evidence reference.

This pilot deliberately **cannot** bind an account, change a role/company grant, assign an Entra application, create a credential, read a directory, or revoke an external account. HR handoff is a review record, never “applied”, “linked”, “provisioned” or “completed”. After reviews the state remains **pending directory verification**. Offboarding intake does not delay or replace the existing separately authorized urgent access-closure process.

## Authoritative configuration, not inferred names
- CoS is the current trusted user `leadership:cos` entitlement. Deputy/title/name similarity does not qualify.
- Company Head and HR Administrator require separately administered, versioned, active, company-scoped `hr_it_authority_mappings`. The app has SELECT only. No UI/API bootstraps authority or widens users/grants permissions.
- `Company.headOfCompany` is a display name, never approval authority.
- Server `ENTRA_TENANT_ID` supplies the trusted tenant. A submitted tenant never becomes configuration. Missing tenant/mappings explicitly produces **pending_setup**.
- Mapping configuration and any eventual actual binding executor need a separate reviewed administrative process. No migration has been run and no current staff mapping has been invented.

## Bounded intake assumptions
One authoritative company per request; multi-company access needs separate company-scoped requests. HR can create only for its current companyIds scope. Subject is an existing ordinary app user or a registered HR Person; new staff need not already have an app account. No name/email matching. Subject/company are immutable; cancel and prepare a new request to change either. Ambiguous Person mappings or an existing Person-linked account lacking that company scope, privileged subjects (including active mapped Company Heads and HR Administrators), and replacement of a different existing OID are rejected for separate recovery review.

Technical labels and pasted evidence are **unverified**. Never enter passwords, secrets, tokens, or credential contents. Tenant/OID format, tenant match, canonical identity collisions and unchanged authoritative subject mapping are checked; these are validation, not proof of same person. An eventual directory verifier must obtain trusted current principal evidence independently.

## Separation and stale-state controls
- Target and request author cannot approve their own request. One person holding both CoS/head roles still cannot supply both approvals.
- Current active entitlements and exact current mapping version are rechecked, including at HR handoff. Closed/integration/device principals are refused.
- Scope, technical details, self details, submission, cancellation and delegation changes append a version/hash history and invalidate prior reviews. No approval migrates silently to edited scope. A scope return/reapproval also requires a newer HR handoff review; an old handoff cannot revive.
- Lead requests delegation, Manager approves/revokes; Executive cannot delegate or approve scope. Delegation is capped at seven days as a conservative technical bound, not a new grant policy. Current Manager/Lead entitlement and expiry are checked on use; no role inheritance.
- Executive visibility is limited to the exact effective delegated request; unrelated staff see only their own request. HR options expose minimal names/IDs/company, not pay, personal ID, DOB or other Person fields.

## Recovery / database release gates
Stable owner-bound operation UUIDs produce immutable committed/rejected receipts. Retries reconcile the same UUID; unknown errors never mean “not committed”. Explicit safe-abandon under the same lock returns an existing commit or writes a permanent rejection tombstone so a delayed original request cannot later commit. Read-only receipt `found:false` never cancels work.

All writes share transaction serialization `it-manual:hr-it`; request revisions/history, approvals, delegation changes, audit and receipts must commit atomically. PostgreSQL savepoints prevent partial work being described as rejected. MemoryStore is a demonstration/test store with **no rollback**; its synthetic tests do not prove PostgreSQL atomicity.

Five dedicated JSONB tables need reviewed FORCE RLS, immutable receipt/approval protections, exact transition/identity guards and fail-closed catalog readiness. Restricted PostgreSQL role, concurrent replay, rollback, policy tamper and migration rehearsal tests plus browser account-switch/recovery tests are release gates. No live provisioning, grant or deployment is authorized by these local tests.

The transaction-local tenant setting is populated/cleared only from validated server configuration before every intake read/write. This follows the existing trusted backend `app.user_id` context boundary; it is not claimed to resist arbitrary SQL execution under the runtime database role. Future real binding requires a separately reviewed stronger proof/executor design.

Retention/deletion policy for identity labels, evidence references, request history and audit has not been approved here. There is no automatic purge: records currently persist until a separately authorized retention action. This is not an approved indefinite-retention policy. Agree a retention/access-review policy before live personal-data intake; receipt tombstones must not be removed while delayed replay remains possible.
