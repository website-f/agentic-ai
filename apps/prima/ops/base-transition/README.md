# Explicit exact base-transition package — local candidate only

This package adds an operator CLI around the independently reviewed runner. It does not change that runner, its exact SQL, or catalog validators. It is not invoked by the API, Docker startup, `db-setup`, or the normal five-module installer. No live migration, deployment, credentials, role grants or four-head checker arrangement is authorized by packaging it.

## Exact scope and pins

Only base `678910162fcf0d878b128df61d291f4742c836b4846c36519e8d9c934598071b` → `d1a9ec22ffeb955a5228e9fc578a65b940e8730037c9d134aa3037f097c6a283` is admitted. Runner SHA256 is `e470e38f3c308a08e49aa9caa229eaa4563dcdf92ad188322081069fabba938d`. `artifact-manifest.json` additionally pins this CLI, both SQL files, the readiness manifest, and the complete validator source/compiled closure. No arbitrary SQL file, path, target or revision is accepted.

The existing runtime image supplies its lockfile-installed `pg` dependency; plan mode does not load it or establish a connection. The operator entry is `/app/ops/base-transition/cli.cjs` in the packaged image. The API CMD is unchanged.

## Plan without database access

```
node /app/ops/base-transition/cli.cjs plan
```

This verifies packaged bytes and prints fixed target and hashes only. It is not readiness proof or execution approval.

Execution, after separate exact-target/live approval, requires the literal ordered arguments:

```
node /app/ops/base-transition/cli.cjs execute --owner <verified-existing-owner> --artifact-sha <plan-artifactSha> --old-sha <plan-oldSha> --new-sha <plan-newSha> --runner-sha <plan-runnerSha> --confirm MIGRATE_EXACT_BASE_ONLY
```

The existing `DATABASE_URL` must already be supplied through the approved operator environment, not pasted into command history/chat or extracted from secrets by this tool. The CLI checks exact hostname `psql-prima-staging-sea.postgres.database.azure.com`, port5432, database `appdb`, matching owner and nonempty password **before constructing/connecting a client**. Query parameters are forbidden except optional single `sslmode=verify-full`; downgrade modes and connection options are refused. The parsed connection explicitly enables certificate validation and expected servername. There is no production local-host/TLS bypass. The runner rechecks actual target, encrypted authorized stream, session/schema-owner identity and existing catalog before any transition.

No retries occur. COMMIT loss or ambiguous execution returns an unconfirmed outcome; inspect the actual catalog through a separately authorized read-only procedure before deciding next steps. Cleanup failure is reported without exposing raw connection/server errors. Fixed diagnostics never include URL/password/provider bodies.

## Migration effects and unresolved execution route

The runner takes exclusive table locks and its existing setup/transition advisory locks, verifies exact old structures and rental-data preconditions, adds the exact owner-only audit read policy inside the transaction, and preserves complete bounded users/grants/audit snapshots. It applies reviewed candidate base DDL including its ACL/RLS changes, then verifies catalog and preservation before stamping/commit. This is **not read-only**. It does not reseed, reset passwords, link identities, create API roles, change application-role attributes, or invoke generic `db-setup`. Snapshot limits and unknown/partial data/catalog state HOLD; they are not auto-repaired.

The five selected modules are a separate stage and are not installed by this command. A successful base transition alone cannot make the candidate API ready; it can also make the old API incompatible immediately. Existing owner privileges, network/TLS reachability, backups, coordinated maintenance, compatible roll-forward/recovery, selected module approvals and final runtime/UAT remain separate prerequisites. The existing migration job's exact owner/network metadata is unverified: this package does not assume it can be used or modify its identity/settings. Do not use image-only rollback after incompatible schema changes.

## Tests and source recovery boundary

The reviewed helper's40 mocks and11 disposable PostgreSQL16 tests are retained. CLI negatives prove plan/no-connect, input/pin/target/TLS rejection, sanitized uncertainty and artifact tamper refusal. New CLI PostgreSQL tests use an explicitly code-only localhost transport adapter in the test file; they do not prove Azure TLS or the live execution route. Fresh independent CI service instances isolate the helper and CLI rehearsals; none modifies an existing local appdb/role set. Image CI copies the package from an **unstarted** image and runs plan outside it; no push, container startup or provider call is added.

This local packaging workspace contains only six recovered baseline files from immutable `6b809648d36b4fcb8e95e0b1c9d903224dd19d9f`, plus this additive package. It is not a recovered full540-file repository. Integration/aggregate build and actual packaged image verification must use the complete reviewed repository in CI. Publication and live execution remain separately gated.

## Maintenance/candidate sequence remains a separately reviewed route

The proposed maintenance design (not executed or authorized here) uses temporary multiple-revision mode, ingress closed and the old revision deactivated, with zero old replicas/in-flight writers verified before owner DDL. Never restart the old API against the new ACLs merely to run a verifier. After the exact base and separately approved modules, stage the exact NEW candidate while ingress remains closed; its normal startup enforces the restricted-login/full-release catalog. Execute that candidate's own diagnostic/local health before any traffic restoration. The existing main-only deployment workflow cannot bootstrap through its old-health gate; an explicit reviewed closed-candidate staging procedure is still required. No generic uploaded-JSON bypass is added. Existing owner/job role and SET capabilities remain unknown; no implicit permission grant is allowed.
