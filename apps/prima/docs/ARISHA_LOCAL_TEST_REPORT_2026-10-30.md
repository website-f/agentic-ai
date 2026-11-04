# Local validation report — Arisha review draft candidate

Base repository main: `997ac0db24c43e9820401f19bc4049151f1eec10`.
Validation date: 30 October 2026. Isolated cloud working copy; synthetic data and mocked model responses only.

## Passed

| Check | Result |
|---|---|
| `npm test -w @prima/core` (final run) | **280/280**, 10 files, 50.87 seconds, exit 0 |
| New policy/workflow coverage within core | **26 tests**: 5 policy + 21 workflow |
| `npm run typecheck` | Core, API and web passed; final core typecheck repeated after last core change |
| Core/API TypeScript builds | Passed; new PostgreSQL regression tests compile |
| Focused API tests: arisha-pilot, arisha, arisha-draft-routes | **12/12 passed**, Azure responses mocked |
| Existing `node --test dist/test/entra.test.js` | **17/17 passed**, offline token/key fixtures |
| Production web build (`VITE_ALLOW_SAME_ORIGIN_API=true`) | Passed |
| Demo web build | Passed |
| `npm audit --omit=dev --audit-level=high` | **0 known vulnerabilities** reported for production dependencies |
| `git diff --check` | Passed |
| Independent source review | Three findings corrected and re-reviewed: pilot reviewer dead-end, Finance lost-update race, returned-Finance resubmission dead-end |

The full core run includes existing company onboarding, pilot routing, IT, secrecy, audit/approval and business-rule regression tests. New tests cover exact identity/role scope, direct forged preparation, protected fields, references, grants/expiry, draft-only persistence, human authority, immutable responses, submit/commit retry idempotency, stale Finance source, author/reviewer revocation, resubmission and the CEO company compatibility path.

## Not executed / not established

- **Full API PostgreSQL suites** (`http`, `rls`, `setup`): no PostgreSQL server/client or Docker is installed in this environment. Standard user-space binary paths are absent. Official distro metadata probing failed to read `/etc/apt/apt.conf.d/80-applied-apt-retries` (permission denied); no unofficial binaries or permission bypass were used.
- Added PostgreSQL tests for tenant isolation, concurrent identical submission/commit and a controlled Finance draft-vs-direct-screen lock race are **compiled but unrun**. MemoryStore lacks transactional rollback and is not a substitute for PostgreSQL RLS, locking or atomic failure recovery.
- **Desktop/mobile browser UAT**: Chromium was present but startup failed with `socket() failed: Operation not permitted` (and a crashpad database error). The local server was stopped; no browser interaction succeeded and no sandbox bypass was attempted.
- No real Entra sign-in, staff identity link, live mandate, deployment, migration, paid model, production API, runtime health or security certification was tested or changed.
- Complete organization-wide Arisha retrieval/analysis and all requested business schemas are not implemented by this bounded candidate. See `ARISHA_REVIEW_DRAFTS_2026-10-30.md` for exact coverage and exclusions.

## Tool interruptions

Two local command-status polls were incorrectly classified as the earlier read-only health-watch scope. Each was retried only once with the newer direct development authorization; the retry returned an unknown process ID, not a successful build claim. Independent already-running checks supplied the successful build/test evidence above. Dependency installation initially failed on an unwritable default npm cache; it succeeded with a cache inside the authorized workspace. Dependencies were fetched from `registry.npmjs.org`, with lifecycle scripts disabled; no paid calls or remote repository writes occurred.

## Required before release

Run the complete API suite against disposable PostgreSQL 16, execute the new concurrency tests and rollback failure cases, then perform synthetic desktop/mobile UAT and security review. Publishing this patch, applying its additive migration, identity mapping and AI activation each remain separate approval/deployment steps. Passing GitHub or local checks alone proves none of those outcomes.
