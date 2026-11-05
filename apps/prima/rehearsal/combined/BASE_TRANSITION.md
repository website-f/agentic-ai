# Replacement base-transition package for combined candidate round 8 — preparation only

Prepared 4 Nov 2026 (supersedes the round-4 package on 67b6382, reviewed by Arisha 3 Nov 09:04Z) for the release owner's independent review. Nothing here authorizes or performs a migration,
deployment, role grant or provider call. The live database was not contacted; all PostgreSQL results below are from a
disposable local PostgreSQL 16 cluster (fresh per suite, as CI does), with the package's own code-only localhost transport.

## Scope

Built on the frozen round-8 commit `bccc44f` (tested tree `7008843b`). Round 8's base is the same as round 7's
(`d1a9ec22…`), so this package is byte-identical to the round-7 one (c1a689c; refresh re-run and confirmed: same
artifactSha). Only `ops/base-transition` changes; the round-8 code, base and modules are untouched. The combined team prepares the transition; the release owner reviews it
independently. It never runs on live data without a separate approval for that exact target.

| | Before (reviewed package) | After |
|---|---|---|
| live base (`live.sql`, unchanged) | `678910162fcf0d878b128df61d291f4742c836b4846c36519e8d9c934598071b` | same |
| candidate base (`candidate.sql`) | `4b4cf4d3…` (old `001_init.sql`) | `d1a9ec22ffeb955a5228e9fc578a65b940e8730037c9d134aa3037f097c6a283` = round-8 `db/migrations/001_init.sql` |
| runner `base-transition.cjs` | `66640286…` | `e470e38f3c308a08e49aa9caa229eaa4563dcdf92ad188322081069fabba938d` |
| `readiness-manifest.json` | `294f46e3…` | `48373f43239f8bc7f5ddb5c1045d98c7cbd627102157f9d2b2f7fc36541fc493` |
| `artifact-manifest.json` (plan `artifactSha`) | — | `368d65b23ab985031d3b175a81b479fff969b5d66702a551569db409397cc0fd` |
| `cli.cjs` | — | `91e84b2f580c133b99380551687323ead906f57304e611a2a9c9d06f3354879c` |

What changed, and only this (reproducible with `rehearsal/combined/kit/base-transition-refresh.js <worktree>`):

- `candidate.sql` is the round-8 base byte for byte (it adds HR #51's staff_movements and login_handover walls and
  `prima.login_handovers` over round 4's base).
- `candidate-readiness/*.ts` are the round-8 `apps/api/src` validators (unchanged since round 4). Three differ from the reviewed copies, each in
  one pinned function hash: `it-cleanup-readiness.ts` (`ic_scope`), `it-manual-readiness.ts` (`it_register_guard`),
  `rental-correction-readiness.ts` (`rc_scope`). The other four are byte-identical.
- `candidate-readiness-js/*.js` compiled with the pinned TypeScript 5.8.3, `--target ES2022 --module commonjs`. These
  flags reproduce the reviewed package's seven compiled files byte for byte from its own sources (checked first).
- Constants only in the runner (`NEXT`, the readiness-manifest pin) and the CLI (`NEXT`, `RUNNER`). No check, query,
  lock, refusal code, target or TLS rule changed. README base and runner hashes updated.
- One test expectation: the candidate model now has 167 tables (was 149).

## Results (this package, local)

- Mock suites `base-transition.test.cjs`, `cli.test.cjs`, `packaging.test.cjs`: 60/60 pass.
- `base-transition.pg.test.cjs` (fresh PG16 cluster): 11/11 pass — `logs/base-transition-pg.log`.
- `cli.pg.test.cjs` (another fresh PG16 cluster): 7/7 pass — `logs/base-transition-cli-pg.log`.
- `node ops/base-transition/cli.cjs plan` returns `plan_only` with the hashes above.
- `ops/existing-admin` tests (non-PG): 48/48 pass (unchanged package).

## Operator and website pins: why they are not regenerated here

- **`ops/existing-admin`.** Its base profile mirrors this package and can be refreshed mechanically
  (`kit/existing-admin-base-refresh.js`), but its modules profile is a frozen closure of the **five-module** world:
  release `734f15d2…`, old base `4b4cf4d3…`, and a copied, reviewed extraction of `db.ts` and the installer. Tested
  locally on fresh PG16 (`run-disposable-pg16.sh`, as postgres): unchanged round-8 package 3/3 and 12/12; with only the
  base refreshed, `combined-module-loss` 2/3 and `modules-admin` 4/12 (the old modules closure cannot install over the
  new base), `inspect` 4/4. So the base refresh is **not** committed: refreshing one profile breaks the chain.
  The combined installer's import closure is 136 files including all of `@prima/core`, so copying it the old way is
  not sound. Proposed instead, for the release owner's design review: run the BYPASS-owner modules profile from the
  exact candidate image's own `/app` dist (pinned by image digest and release sha), keeping the profile's owner and
  target checks. Until then the existing-admin route is not usable for this candidate; the strict
  `ops/base-transition` and the normal `module-install.js` route are.
- **`deploy-exact-spa.yml`.** It pins a ready revision name, an image digest and an API origin that only exist after
  an approved build-only run (digest) and the closed candidate revision (revision name). Its regeneration is a step of
  the cutover plan (Before the window, step 2, and G6), after those approvals, not something that can be pinned now.

## Still open (not done here)

- `ops/existing-admin` (base, modules working copy, inspect, operator manifest) still pins the old base and old
  validators; `deploy-exact-spa.yml` still pins older commits. `kit/stale-pins.sh` lists each. These are the release
  owner's packages and need their own refresh and review.
- Azure TLS, the existing owner identity, backups, maintenance window, module installs and runtime/UAT remain separate
  gates. The transition makes the old API incompatible immediately (see the package README).
