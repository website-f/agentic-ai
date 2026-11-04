# Prospective workflow metrics: SQL boundary

This is a new, additive, separately installed module, not a migration execution or a readiness certificate. Install `db/modules/it-workflow-metrics-v1.sql` only through an explicitly approved migration after base schema installation and successful restricted-PostgreSQL CI/rehearsal. The module is transactional and not an idempotent reinstaller. No calendar, targets, historical timers or user permissions are seeded.

## Meaning and authority

- Staff explicitly record work, pauses, waiting and readiness for handoff. These intervals are claims about workflow activity, not surveillance or proof of continuous work.
- Domain completion, actor identity and quality come from existing authorized jobs/tickets. Timing cannot approve, check, resolve or accept a domain record.
- Only jobs (work/check/approve), tickets (work/confirm) and valid linked website tickets (work/confirm) have adapters. Other workflow categories remain uninstrumented.
- Metrics synchronization is separate and post-commit. Failure must not undo a successful operational action. Unsynchronized terminal records and changed ownership/entitlement have unknown durations, not continuously accumulating performance claims.
- Unknown-boundary closure retains history, excludes that segment from completed KPI attribution, and permits a new prospective segment. The scalar `wm_next_segment(ref)` returns only the next authorized segment number, never a previous owner's notes or history.
- No automatic HR review rights are introduced. The owner's request for HR review requires its separately reviewed visibility and authority design.

## Data protection

Four forced-RLS tables hold streams, exact owner/UUID terminal receipts, immutable Manager-reviewed targets, and immutable administrator-provisioned calendar revisions. Runtime cannot configure calendars, delete history or mutate targets/receipts. A missing calendar leaves business-time measurements null/Unknown; catalog readiness does not certify a configured business calendar. No office-hours assumptions are invented. A new stream retains the immutable configuration revision visible to its admission statement; it does not promise the newest revision at transaction commit if an independent configuration review races with admission. No retroactive target/calendar rewriting follows later reviews.

Runtime helper entrypoints are only `wm_active`, `wm_role`, `wm_visible`, `wm_lock`, `wm_boundary` and `wm_next_segment`; source payload/authority/quality helpers are private. Function owners, bodies, signatures, ACLs, search paths, policy definitions, trigger OIDs and unconditional execution, primary keys, source visibility and active-owner uniqueness are checked by the catalog gate. No UPDATE privilege is granted on users.

Source locking derives current actor and source participants inside a fixed-path definer. Selected waiting owner is locked and revalidated before storing the event; the whole IT team is not locked. Ordering is owner/config advisory, UUID, stream, then source authority. Raw SQL DML can acquire its row lock before its trigger; PostgreSQL abort/retry handling remains required for a deadlock, never blind duplicate execution.

One active stream per owner prevents concurrent work double-counting. Event and target operation hashes are reconstructed from exact typed input. UUID tombstones reject delayed/cross-kind reuse. Deferred operation/receipt constraints require matching terminal recovery evidence before commit. Domain source events and business dates are not rewritten.

## Verification limits and rollout gate

Catalog/source mocks and TypeScript compilation do not execute PostgreSQL or establish production health. Disposable localhost-only restricted-role tests cover lifecycle transitions, receipt rollback, hidden-history segment recovery, source actor attribution, role isolation, configuration denial, concurrent active timers and catalog drift. This workspace has no reachable PostgreSQL server: the execution attempt failed before SQL with ECONNREFUSED at localhost:5432. Real CI and migration rehearsal remain mandatory.

The raw SQL website scope test checks the already server-selected `app.company_ids` boundary. It does not establish the application's actual authority-grant resolver; a separate PgStore fixture must verify grant, revoke and current-role behavior end-to-end.
