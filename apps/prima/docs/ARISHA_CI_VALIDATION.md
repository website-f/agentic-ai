# Proposed CI validation for Arisha review drafts

**Local candidate only.** No branch was pushed, PR created, workflow dispatched, or Azure operation performed by this change. Future GitHub Actions execution requires the separately authorized publication of the draft PR and may consume the repository's CI allowance. A green check on a prior commit does not validate this candidate.

## Database checks already present

`.github/workflows/ci.yml` already runs a disposable `postgres:16` service and executes the complete core and API suites. Its database is `prima_test` on the ephemeral runner; the password and development token are CI-only fixture values, not production credentials. Existing API tests reset this database.

Therefore the new RLS, simultaneous submission/commit and Finance draft-versus-direct-screen locking regressions in `apps/api/test/rls.test.ts` will run in the existing test job when the candidate is published. They have **not** run in the current local workspace: no usable PostgreSQL installation was available. Compilation and MemoryStore tests do not prove PostgreSQL isolation, concurrency or rollback.

## Proposed hardening and browser job

- Explicit workflow permission: `contents: read`. No `id-token`, cloud permissions, environment secrets or `pull_request_target` trigger.
- Checkout does not persist Git credentials.
- Ubuntu 24.04 is pinned for compatibility with the repository's already-used Playwright 1.56.1 version; Node 22 and PostgreSQL 16 remain unchanged.
- Browser tooling is installed into runner temporary storage, using the official `playwright` package pinned at **1.56.1**, without editing the repository manifest or lockfile. Its Chromium dependencies are installed only on the disposable GitHub runner.
- The independent browser job builds **demo mode**, not a staging-connected site. `scripts/arisha-review-smoke.mjs` serves only the built HTML from a loopback server and refuses external target URLs. Browser routing aborts every non-loopback request, including fonts, Microsoft sign-in and model endpoints. No Claude host capability is installed.
- No browser screenshots, traces, authentication state or seeded record dumps are uploaded. Only pass/fail text is produced. All fixture records are generated synthetic data.

## Browser coverage designed into the script

At desktop 1440×1000 and phone 390×844:

1. Load an ACT-authored checkpoint proposal through the existing demo mutation replay format; prove ACT has no operational Save action.
2. Close/reopen the review panel and switch to CEO without retaining the prior user's component state.
3. Cancel a Save confirmation and verify no commit was recorded.
4. Repeat Save clicks; verify exactly one logged commit, committed state and one proposal after reload.
5. Load a Finance paper proposal, return it, cancel resubmission, then explicitly resubmit and save with the Finance Director's existing authority.
6. Confirm reopening clears prior company selection, the review panel fits the viewport, and no uncaught page errors occurred.

These checks exercise review UI and the demo's actual shared core authorization. Fixture insertion intentionally bypasses model generation; this is **not** a test of paid AI responses, real sign-in, actual PostgreSQL HTTP integration, all responsive layouts, all navigation/back-forward behavior, complete screen-reader accessibility or production runtime health.

## Local evidence and remaining gates

- `node --check scripts/arisha-review-smoke.mjs`: passed.
- `node scripts/arisha-review-smoke.mjs --check-fixtures`: passed; validates synthetic fixtures through real core rules without opening sockets.
- Browser execution: **not run**. The environment previously denied Chromium socket startup; this script does not bypass that restriction.
- GitHub workflow: **not run for this candidate**. Review and authorize draft-PR publication, then inspect checks for the exact pushed commit.

Before any release, require the full database job and browser job to pass on the candidate commit, investigate all failures, and retain separate human UAT, migration, identity and AI-activation approvals. These checks do not deploy anything and are not security certification.
