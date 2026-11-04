# Manual IT daily-work UI — local candidate

Base: rebuilt website candidate `d4a71a2d50a2b833b7f5cca8c08f8012bc057135`. This frontend patch is separate from the backend/SQL patch and requires their reviewed contract. It does not change the frozen replacement or publish anything.

## Staff workflow

- **Joining/leaving:** create a manual checklist against a scoped, stable staff ID, or explicitly record an unlinked person without auto-associating a name. Organization linkage is optional and unverified labels stay labelled. Existing assigned checklist work remains separate from actual account provisioning/revocation.
- **Systems/access:** register an existing system with unknown MFA/access-review state. CEO access decisions are recorded, not executed in external systems.
- **SharePoint guidance:** record a pending or supplied URL, optional site owner, responsible IT staff, next review and accessible IT-job reference. Guidance evidence has an exact record version; independent checking follows the backend Manager-only capability and excludes the guidance author/responsible worker. Manager-authored work is not silently passed to a Lead or self-certified. A linked IT job retains its existing independent-check workflow.
- **Existing devices:** Manager/Lead register an existing-stock item using a unique tag/serial. Unknown purchase dates stay unknown, the device starts unassigned, and no purchase, cost, rental charge or invoice is invented.
- **Rental:** the server shows setup required and inventory counts only until separately approved rate configuration exists. Billing/payment controls and invented totals are absent. Explicit demo simulation remains test-only.

Manual/disconnected integration work still requires an authenticated connection to Prima to save. It is not offline synchronization and makes no Microsoft connection, security-certification or live-provider claim.

## Interrupted and repeated saves

The browser persists only an owner-scoped request UUID and operation kind, never staff details, evidence, URLs, passwords or tokens. A cross-tab Web Lock protects marker ownership. The server atomically stores immutable operation receipts with business records. Network uncertainty, missing receipts and identity changes cannot silently create a new request.

A verified durable rejection permits correction with a new UUID. A read-only `found:false` response does not. The explicit **Resolve or cancel pending request safely** action asks the server to return an existing commit, or create a rejection tombstone preventing any delayed original request from committing. It never claims to undo a committed record. Generic authorization/storage/network errors preserve the pending identity.

Account selection is bound before mutation with the same bearer and `/me` check, rechecked after the response, and prior-user option lists are hidden immediately on a UI identity change. Unsupported browser storage/Web Locks block saving rather than weaken these protections.

## Release gates and evidence

The manual backend introduces protected receipt storage and a reviewed schema/RLS migration. `configuration:setup_required` disables creation/checking until server-side catalog checks confirm required protections. No migration is run by this UI patch. PostgreSQL concurrency/RLS, real-browser/mobile and actual staff/provider UAT are separate from synthetic tests.

CI invokes state/transport tests, actual-component synthetic form/provenance tests, and a frontend-session integration test against this candidate's built core with synthetic records only. Final hashes/test logs belong in the assembled release manifest; local passing tests do not mean deployed or operationally accepted.
