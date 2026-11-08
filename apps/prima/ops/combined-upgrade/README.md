# Stage 2 database update: reviewed base → combined main base

Prepared 8 Nov 2026 after Fauzan asked for the reviewed database update that main needs before the merged features (site shared device, HR walls, guard phones, offline records and the rest of the combined integration) can run on the server. **Nothing here has been run on any real database.** Running it needs the CEO's separate go-ahead, a backup and a maintenance window.

## What it does

The server database must move through two fixed steps. Each step accepts only one exact starting point.

| Step | Package | From base | To base |
|---|---|---|---|
| 1 | `ops/base-transition` (already reviewed) | `678910…071b` (live.sql) | `4b4cf4d3…78fe` (candidate.sql) |
| 2 | `ops/combined-upgrade` (this package) | `4b4cf4d3…78fe` | `970b976b…71da` (`db/migrations/001_init.sql` on main) |

Step 2 refuses to start unless the database is stamped exactly `4b4cf4d3…`, so step 1 must be finished first. If the database is already stamped `970b976b…`, step 2 refuses and changes nothing.

`upgrade.sql` is the exact SQL that `scripts/combined-base-upgrade.pg.test.cjs` already rehearses in CI. It is the combined base without its `BEGIN`/`COMMIT`, followed by the two reviewed scope-function changes from the released `cleanup` and `rental_corrections` modules. `derive.cjs` rebuilds it from the repository, and `cli.test.cjs` fails if the two ever differ.

Step 2 adds 37 tables. Among them are the 8 site shared-device tables: CMS messages, videos, post log, site vehicles, gate records, client-needs reviews, site tasks and task sign-offs. Every company table gets forced row-level security. No old table is removed. No user, grant, audit or business row is changed.

## How it runs

There is one transaction, using the same advisory locks as step 1 and `db-setup`. It runs these checks, in this order:

1. **Identity:**
   - the login is the schema owner itself, not a superuser and not able to bypass RLS;
   - the API roles have not changed;
   - the API roles cannot create objects in the schema;
   - the owner has no default privileges that would quietly add grants to the new tables.
2. **Lock:** every existing Prima table is locked against writes until the end of the transaction.
3. **Stamp and modules:** the stamp is exactly `4b4cf4d3…`, and the released module scope functions are installed.
4. **Snapshot:** every existing table gets a row count and a SHA-256 fingerprint. A table over 100,000 rows or 64 MB is refused rather than guessed.
5. **Apply:** the exact `upgrade.sql` runs.
6. **After:**
   - no old table is missing;
   - every new table is owned by the schema owner;
   - no old table lost its row-level security;
   - forced RLS is on for each listed company or HR table;
   - the API roles gained no delete or truncate right, and nothing is granted to PUBLIC;
   - both scope functions accept the three reviewed group entities;
   - the API roles still cannot create objects.
7. **Preservation:** every old table's fingerprint and the API roles are identical to before.
8. **Stamp:** the stamp is set to `970b976b…`, then the transaction commits.

The command does not retry. If any check fails, the whole transaction rolls back. If the commit itself cannot be confirmed, the result says `outcome_unconfirmed`: check the catalogue read-only before deciding anything. Results never include passwords, URLs or raw server errors.

## Commands

Plan, with no database connection:

```
node /app/ops/combined-upgrade/cli.cjs plan
```

Execute, only after separate approval of the exact target. `DATABASE_URL` for the schema owner comes from the approved operator environment, never pasted into chat or history:

```
node /app/ops/combined-upgrade/cli.cjs execute --owner <verified-existing-owner> --artifact-sha <plan-artifactSha> --old-sha <plan-oldSha> --new-sha <plan-newSha> --runner-sha <plan-runnerSha> --confirm MIGRATE_EXACT_COMBINED_BASE_ONLY
```

The command accepts only one target:
- host `psql-prima-staging-sea.postgres.database.azure.com`;
- port 5432;
- database `appdb`;
- `sslmode=verify-full` or no query string at all.

It refuses any other host, port, database, user or TLS setting before it creates a database client.

## Tests

- **`cli.test.cjs` (no database):**
  - the SQL matches its derivation, and the pins match stage 1 and the release manifest;
  - plan never connects;
  - bad targets, TLS downgrades, wrong pins and wrong confirmations are refused before connecting;
  - errors are sanitized;
  - a changed file is detected.
- **`combined-upgrade.pg.test.cjs`:** runs on a fresh disposable PostgreSQL 16 only. It starts from exactly what stage 1 and the five released modules leave behind, with synthetic rows, and checks six cases:
  - the runtime login cannot pose as the owner;
  - a wrong stamp is refused and nothing changes;
  - owner default privileges are refused;
  - a failure injected after the whole SQL rolls back everything;
  - the real run commits, keeps every old table byte-for-byte, enforces the company wall on site tasks and gate records, and passes the compiled API release catalogue;
  - a second run is refused.

The test client reports the production host and TLS metadata while it actually talks to localhost. It does **not** prove the Azure TLS path or the live owner's rights.

## Still open before anyone runs it

- **Live stamp:** confirm which base staging is stamped with today, using a read-only check.
- **Owner:** confirm the schema owner login and its rights.
- **Backup:** take a backup and agree the maintenance window. Close ingress and stop the old API first: the old API is not compatible with the new base.
- **Order:** step 1 (if needed), then step 2, then the explicit install of modules released after the frozen artifact (now `item_register`, then `item_register_v2`, through the pinned module installer), then the new API image. The API refuses to start until every released module is ready. Optional modules are separate approvals.
- **Retention:** the gate record retention and PDPA notice, and the in-house server key (`INHOUSE_PUBLIC_KEY_JWK`), must be decided before real visitors are recorded.
- **Existing-admin route:** the `ops/existing-admin` route is still pinned to the previous base and is not updated here.
