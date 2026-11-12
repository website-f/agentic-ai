# Complete release artifact and explicit module installation

This local packaging repair covers the exact base schema and six mandatory SQL artifacts: procurement, rental corrections, controlled cleanup, workflow metrics, selected job-email v2 and the item register (added 8 Nov 2026 after the owner chose the release path for it). `db/release-manifest.json` pins all seven files. It is not a provider connection, tenant consent, user mandate, licensing, live-data or browser acceptance certificate.

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

Install order: existing exact base → procurement → rental_corrections → cleanup → metrics → item_register (no prerequisites; it only adds `item_*` tables and the `item_parties` function). Select `job_email` separately for fresh v2 only. Do **not** install mail v1 first; existing v1/partial installations require a separately reviewed data-preserving migration. The base is not installed by this runner.

## Optional modules: pay formulas and guard pay (off until Fauzan says)

Fauzan decided on 8 Nov 2026 that the guard pay database is installed **later, as its own step**. Prima takes over guard pay on **1 August 2027** (rule PAY-GUARD `switchDate`); until then the JA Group app keeps paying guards and Prima pay runs are side-by-side trials only (`primaPays` stays off). The cash and advance policy in the code is unchanged.

- `pay_formulas` (`db/modules/pay-formulas-v1.sql`, sha256 `38718470f582cb438a08d42d6131187aa55c0613e3aa58a924836f77cfbfda72`, no prerequisites) and `guard_pay` (`db/modules/guard-pay-v1.sql`, sha256 `c6ca56b61b076181eba45bd1c1c88d766c9339b981e45c41154b8fee0c32d8a1`, requires `pay_formulas`) are listed in `OPTIONAL_MODULE_SPECS` (`apps/api/src/release-artifact.ts`) and `OPTIONAL_MODULE_IDS` (`apps/api/src/release-catalog.ts`). Their bytes are pinned there; they are **not** in `db/release-manifest.json`, so release readiness, API startup and the office `prima-setup` service (which installs every manifest module) never need or install them. `prima-setup` also refuses to start if a release ever lists them.
- Their catalogue checks stay (`pay-formulas-readiness.ts`, `guard-pay-readiness.ts`): every table exists, row security is on and forced, every policy name the module file creates is present, `prima_app` has exactly the rights the file grants and never DELETE or TRUNCATE. `guard_pay` also reports a problem while `pay_formulas` is not ready.
- The plan (`node dist/src/module-install.js`) prints them under `optional`, apart from the release modules. Install only when Fauzan says, after all the mandatory modules, in this order, each with the optional confirmation:

```
node dist/src/module-install.js --module pay_formulas --release-sha <release-sha256> --module-sha 38718470f582cb438a08d42d6131187aa55c0613e3aa58a924836f77cfbfda72 --confirm INSTALL_OPTIONAL_MODULE
node dist/src/module-install.js --module guard_pay --release-sha <release-sha256> --module-sha c6ca56b61b076181eba45bd1c1c88d766c9339b981e45c41154b8fee0c32d8a1 --confirm INSTALL_OPTIONAL_MODULE
```

`INSTALL_SELECTED_MODULE` is refused for them, `guard_pay` is refused until `pay_formulas` is catalogue-verified, a second run is a no-op and a drifted install is refused. Never edit the two .sql files: their hashes are pinned. Before the install the Guard pay, advances, loans, pay formulas and statutory rates screens show nothing and refuse to save, with a plain message.

Each selected installation runs under one owner transaction/advisory lock, verifies prerequisites, applies only the fixed hash-pinned module body, and checks its actual catalog before commit. A complete exact existing module is a read-only no-op; partial or drifted state is refused, not overwritten. Any ambiguous failure requires read-only inspection before retry. No generic SQL path or arbitrary module is accepted.

## Optional module: central employers (E5, install through the CEO-run migration)

Fauzan, 11 Nov 2026 (E5): Perfect Global Logistics (PGL) is also an employer of staff. The service, the base schema and the IT cleanup and rental correction scopes already know `pgl`; the one database rule that still listed only PWVSB and Merdeka is the hand-over layer's `prima.org_central_employer` (org-links-v1.sql), which refuses a company-office hand-over line for a central employer. `central_employers` (`db/modules/central-employers-v1.sql`, sha256 `29d388a4ef7b80c547ebdf9b903d59b7138499249aae435d47885223595cdd03`, requires `org_links`) re-states that rule for all five central employers (`pwvsb`, `merdeka`, `goodwill`, `sasateam`, `pgl`) and adds `prima.ce_central_employers()` as its marker. No table, policy or row changes. It is optional (never in the release manifest, never installed by `prima-setup`); the CEO runs it once, after `org_links`:

```
node dist/src/module-install.js --module central_employers --release-sha <release-sha256> --module-sha 29d388a4ef7b80c547ebdf9b903d59b7138499249aae435d47885223595cdd03 --confirm INSTALL_OPTIONAL_MODULE
```

Its catalogue check is `central-employers-readiness.ts`; the `org_links` check accepts either the first or the E5 body of `org_central_employer`. Rollback: run the `org_central_employer` block of org-links-v1.sql again and drop `prima.ce_central_employers()`.

With the actual API connection, `node dist/src/release-check.js` verifies the complete release. Catalog-only installer success is not proof that the API login works. Required authority mappings, selected sites/mailbox configuration, and live-provider tests remain separate gates.

## Deployment transition HOLD

The workflow now checks packaged SQL inside an unstarted image and gates forward/rollback on complete release catalog status, not only the base hash. **An older running API without `/api/health/release` cannot satisfy this new gate.** The first transition (and a differing release-manifest transition) needs a separately reviewed candidate-image read-only verification/bootstrap procedure. This patch does not bypass that gate, run migrations, or authorize deployment. An old rollback image missing the complete manifest also fails closed.

## Evidence limits

Local pure/catalog tests do not establish real PostgreSQL installation. `release-install-rls.test.ts` exercises non-superuser owner installation and a separate restricted login in a disposable localhost database, all five modules, repeat/no-op, drift, and existing-mail refusal. Actual CI execution is required. No live migration or deployment has been performed for this repair.

### Safe first-transition design (not executed or an automatic bypass)

A separate transition must run the **candidate's** read-only diagnostic in an explicitly authorized environment with the existing restricted runtime connection. Bind the result to the immutable candidate image digest, this manifest hash, database target, current ready revision and fresh observation; verify the revision has not changed before cutover. Keep normal exact-release verification after deployment. Do not use the administrator setup job plus `SET ROLE` as runtime-login proof, accept pasted JSON as trusted workflow evidence, or introduce a signer/credential/job implicitly.

An owner-controlled existing API console could run an independently hash-verified candidate diagnostic bundle from temporary storage using its existing environment without printing/copying credentials. That is a possible manual evidence procedure, **not implemented trusted workflow transport** and not permission to mutate that environment. Current Azure execution details, explicit cutover authorization and a rehearsed compatible recovery plan are still required. If these cannot be established, the first transition remains held; the code does not fabricate deployment readiness.
