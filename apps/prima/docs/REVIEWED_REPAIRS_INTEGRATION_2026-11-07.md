# Reviewed repair integration, 7 November 2026

## Scope

Base: `440aa8396c056a6df98639b6be29e858c74b39a1`. The candidate combines the following six exact repair tips and their ancestry. It is not a bulk merge or validation of every open PR.

- `arisha/repair-equipment-review-20261107`: `c5cefbf0b628b35e58c97cd440d73e6e0202d07f`
- `arisha/repair-invoice-review-20261107`: `b725f0fbecac04df7443104d2561f5d786cc7650`
- `arisha/repair-payroll-review-20261107`: `a893c5eb618e1fee929457bd90f98f8952d57d31`
- `arisha/repair-offline-review-20261107`: `eef467e0ae2cbf6ba9d9043eb28384d8450f6006`
- `arisha/repair-kpi96-review-20261107`: `f7e5195bbe589835b3d41dc1444c3f290f268ec7`
- `arisha/repair-kpi108-review-20261107`: `e6519a5f8f39934ff591ba9cd303e5c32424a816`

## Integration decisions

- Preserve author branches and all source functions. Resolve moved `PrimaService` methods by identity rather than positional text conflicts.
- Keep office-HR and guard-pay public-holiday rule objects separate, with their existing IDs and respective minimum/list contracts.
- Preserve both allowance-aware staff-pay calculation and month-effective statutory settings. Bind effective statutory inputs to staff-pay drafts; recheck under the statutory lock at forward transitions and unpaid export. Metadata-only or future-month changes do not stale an unrelated month. Paid history remains historical.
- Ordinary payroll Finance receives only the narrow statutory-settings read wall. This does not grant ACT, pay-formula, staff-identity or rate-write access.
- Preserve payroll/item module readiness checks, company walls, stale approval rejection, immutable receipts and shared-device offline identity binding.
- Combined base SQL SHA256: `0b2ffca438ca3067458fde56358a69d3eebe50aa63ba338e455552e6f7f4799c`. The five released module definitions remain unchanged. Proposed payroll module declarations bind to this base; they are still outside the release manifest.

## Reproducible validation

Required checks on the exact candidate include core/API builds, all core tests, all API tests against disposable PostgreSQL, web typecheck and both builds, script suites, offline HTTP replay, inventory concurrency/RLS, security audit, packaged-release check and synthetic-browser CI. Focused tests do not replace aggregate or browser checks.

`scripts/combined-base-upgrade.pg.test.cjs` pins the frozen main schema and module artifact, rehearses actual main-to-combined DDL with synthetic data under two restricted profiles, verifies rollback/replay/data preservation/RLS and checks the compiled API catalogue. Run it only through the fresh-cluster wrapper:

```sh
PG_BIN=/usr/lib/postgresql/16/bin bash scripts/run-combined-upgrade-pg.sh
```

It is a regression, not a deployment CLI. Ordinary script-test globs must exclude `*.pg.test.cjs`; run this explicitly gated suite separately. The CI job creates its own fresh native PostgreSQL16 cluster.

## Remaining release boundaries

- No deployment, live migration, provider/tenant changes or security-setting changes are authorized by this integration. Both deployment workflows remain unchanged and manually CEO-gated.
- Existing base-transition/existing-admin deployment artifacts remain pinned to the previous base. A separately reviewed, approved migration package for the new base is required before deployment. Passing the regression does not supply that package or permission.
- Guard payroll remains a side-by-side trial (`primaPays: false`). Proposed guard-pay, pay-formula and item modules are not newly activated by the release manifest.
- Uniform policy remains unresolved across source proposals: equipment requires separate payment/receipt for fourth/fifth uniforms, while payroll contains a deduction path. Do not enable real use until management/legal policy is reconciled.
- Real staff/device/scanner UAT, SQL Accounting, in-house visitor services/keys, statutory bands, PDPA/retention and external Microsoft integrations require their own acceptance.
- A successful source merge is not a statement that all open PRs or the live system are ready.
