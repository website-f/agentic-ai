# Complete release artifact and explicit module installation

This local packaging repair covers the exact base schema and five mandatory SQL artifacts: procurement, rental corrections, controlled cleanup, workflow metrics, and selected job-email v2. `db/release-manifest.json` pins all six files. It is not a provider connection, tenant consent, user mandate, licensing, live-data or browser acceptance certificate.

## No automatic database changes

API startup and `GET /api/health/release` only verify packaged bytes and actual catalog protections. Ordinary `/health` remains liveness; release diagnostics are heavier and coalesce concurrent calls only. A failed release check prevents production startup. No installer is invoked on startup. No command here resets/reseeds data, rotates passwords, provisions an API login, or creates roles. Explicitly installing a pinned module DOES apply that module’s reviewed GRANT/REVOKE and RLS DDL to existing roles; it requires separate live authorization. The runner adds no extra privilege provisioning outside that approved module SQL.

The operator command requires a separately authorized existing non-superuser/non-bypass schema-owner connection with existing membership of `prima_app`. This is **not** the API credential. Runtime verification separately requires the actual restricted API login, with no prior SET ROLE disguise. Never share credentials in logs or command arguments.

After building, from the API directory:

```
node dist/src/module-install.js
```

prints a file-only plan and immutable release hash without connecting to a database. For each specifically approved module, use the exact hashes printed by that plan:

```
node dist/src/module-install.js --module procurement --release-sha <release-sha256> --module-sha <module-sha256> --confirm INSTALL_SELECTED_MODULE
```

Install order: existing exact base → procurement → rental_corrections → cleanup → metrics. Select `job_email` separately for fresh v2 only. Do **not** install mail v1 first; existing v1/partial installations require a separately reviewed data-preserving migration. The base is not installed by this runner.

Each selected installation runs under one owner transaction/advisory lock, verifies prerequisites, applies only the fixed hash-pinned module body, and checks its actual catalog before commit. A complete exact existing module is a read-only no-op; partial or drifted state is refused, not overwritten. Any ambiguous failure requires read-only inspection before retry. No generic SQL path or arbitrary module is accepted.

With the actual API connection, `node dist/src/release-check.js` verifies the complete release. Catalog-only installer success is not proof that the API login works. Required authority mappings, selected sites/mailbox configuration, and live-provider tests remain separate gates.

## Deployment transition HOLD

The workflow now checks packaged SQL inside an unstarted image and gates forward/rollback on complete release catalog status, not only the base hash. **An older running API without `/api/health/release` cannot satisfy this new gate.** The first transition (and a differing release-manifest transition) needs a separately reviewed candidate-image read-only verification/bootstrap procedure. This patch does not bypass that gate, run migrations, or authorize deployment. An old rollback image missing the complete manifest also fails closed.

## Evidence limits

Local pure/catalog tests do not establish real PostgreSQL installation. `release-install-rls.test.ts` exercises non-superuser owner installation and a separate restricted login in a disposable localhost database, all five modules, repeat/no-op, drift, and existing-mail refusal. Actual CI execution is required. No live migration or deployment has been performed for this repair.

### Safe first-transition design (not executed or an automatic bypass)

A separate transition must run the **candidate's** read-only diagnostic in an explicitly authorized environment with the existing restricted runtime connection. Bind the result to the immutable candidate image digest, this manifest hash, database target, current ready revision and fresh observation; verify the revision has not changed before cutover. Keep normal exact-release verification after deployment. Do not use the administrator setup job plus `SET ROLE` as runtime-login proof, accept pasted JSON as trusted workflow evidence, or introduce a signer/credential/job implicitly.

An owner-controlled existing API console could run an independently hash-verified candidate diagnostic bundle from temporary storage using its existing environment without printing/copying credentials. That is a possible manual evidence procedure, **not implemented trusted workflow transport** and not permission to mutate that environment. Current Azure execution details, explicit cutover authorization and a rehearsed compatible recovery plan are still required. If these cannot be established, the first transition remains held; the code does not fabricate deployment readiness.
