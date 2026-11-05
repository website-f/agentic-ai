# Closed-ingress cutover and roll-forward plan: live staging → combined candidate (preparation only)

Revision 2, 4 Nov 2026, after the release owner's review of revision 1 (e0d9f5b, six gaps). **Nothing in this plan is
authorized or has been run.** Each gate needs its own explicit approval from Fauzan for the exact target, digest and
hashes named at that time. Placeholders only: `<staging-api-url>`, `<api-image-digest>`, `<owner-role>`,
`<restore-point>`, `<test-identity>`.

## Why a closed window is needed

- The base transition (`ops/base-transition`, live `678910…` → candidate base) changes ACLs and RLS in one owner
  transaction. **Once it commits, the old API is incompatible with the database.** There is no image-only rollback.
- Deploy staging gates on the running API's `/api/health/release`; the old API lacks it, so that workflow cannot
  bootstrap this transition.
- The exact-SPA workflow needs **external** ingress: it checks the public API (`/api/health`, `/api/health/schema`,
  `/api/health/release`) before and immediately before publishing. It cannot run while ingress is closed (gap 1).

## Roles

| Role | Who | Does |
|---|---|---|
| Approver | Fauzan (CEO) | Approves each gate by its exact values |
| Operator | release owner, with Fauzan present | Runs each command once; reads the full output before the next step |
| Reviewer | combined team | Prepares artifacts, checks hashes against this plan, never runs live commands |

## Before the window (read only)

1. Freeze one combined head with green hosted CI on that exact head. Record tested tree, release sha (sha256 of
   `db/release-manifest.json`), base sha, the image digest from a **build-only** run, and `node
   ops/base-transition/cli.cjs plan` (artifactSha, oldSha, newSha, runnerSha). Plan output is **only** the packaged
   hashes; it verifies no database (gap 2).
2. Regenerate exact-candidate operator material on that head: `ops/base-transition` (done for round 8), the
   exact-SPA workflow pins once the build-only digest exists (revision name at G6), and either a redesigned
   `ops/existing-admin` modules profile or a decision to use the strict route only (see BASE_TRANSITION.md).
   `kit/stale-pins.sh` must then say "current". Run the workflow's offline
   contract tests and a local SPA build of the source commit with the pinned API origin, comparing the file manifest
   the workflow would record (this tests the build path, not Azure).
3. **Baseline on the real routes** (gap 4): public `GET <staging-api-url>/api/health` (200, `ok:true`),
   `/api/health/schema`, and ARM state: ingress `external=true`, active revisions, replica count per revision, revision
   mode `Single`. Read-only inspect of the live catalogue (base `678910…`, no prima module, users/grants/audit counts).
   Any drift = stop.
4. Restore drill on a recent point (`infra/restore-drill.sh`, CEO-run), **extended** (gap 5): on the temporary
   server check schema hash, row counts of users/grants/audit and a sample of department tables against step 3, and
   that the old API image can start against it and answer `/api/health` (no public traffic). Record restore duration.
5. Agree the window and tell staff (pilot is IT staff only): Prima unavailable for the window.

## In the window

| Gate | Step | Check before moving on | If it fails |
|---|---|---|---|
| G0 | **Write freeze, then recovery point** (gap 5): close ingress as in G1, wait until the old revision has 0 replicas and `pg_stat_activity` shows no API-login sessions; record the time `<restore-point>`. Writes after this time cannot exist. | No API sessions for 2 minutes; time recorded. | Reopen; nothing changed. |
| G1 | Close ingress: ACA ingress `external=false` (or old revision scaled to 0; the method is an open decision). | ARM shows `external=false` / 0 replicas; public `<staging-api-url>/api/health` no longer answers 200 (gap 4: real route). | Reopen; nothing changed. |
| G2 | Base transition: `cli.cjs execute` once, exact plan values, `--confirm MIGRATE_EXACT_BASE_ONLY`, as `<owner-role>`. | `status: committed`, no `connectionCleanupConfirmed:false`. | See **G2 outcomes** below. |
| G3 | Modules: `module-install.js` execute once per module in manifest order (14), each with exact release and module sha. Record each result. | Each returns `installed` with `catalogVerified:true`. A later **separately approved** execute of the same module returning `already_installed` is the only repeat check; never re-run an execute silently (gap 2). | `refused`: stop, read-only inspect, roll forward with a reviewed fix or restore. Ambiguous/connection error: hold, read-only inspect, no retry. |
| G4 | Start the candidate image `<api-image-digest>` with ingress still closed (procedure is an open decision). | Startup release check passes; from inside the environment `/api/health`, `/api/health/schema` (current, candidate base), `/api/health/release` complete. Sign-in test only with `<test-identity>` over the approved closed-ingress route (gap 6: open decision; dev login stays off). | Scale candidate to 0; roll forward or restore. |
| G5 | Reopen API ingress **with sign-in restricted**: pilot list (`RULES.pilot`) narrowed to `<test-identity>` only, or `LEADERSHIP_ONBOARDING_ONLY=true` (which switch is an open decision). | Public `/api/health`, `/api/health/schema`, `/api/health/release` exact for the candidate; staff sign-in refused. | Close ingress again. |
| G6 | Publish the exact SPA with the regenerated exact-SPA workflow (its public checks now pass on the candidate). | Workflow records the exact source and file manifest; website loads and calls the candidate API. | Republish; sign-in stays restricted. |
| G7 | Lift the sign-in restriction. | A pilot user signs in; errors normal for 30 minutes. | Restrict again; roll forward. |

Between G5 and G7 only `<test-identity>` can use the system, so the old website briefly in front of the new API
cannot be used by staff.

### G2 outcomes (gap 3)

| Result | Meaning | Action |
|---|---|---|
| `committed` | Transition done, preserved, stamped. | Continue to G3. |
| `committed` with `connectionCleanupConfirmed:false` | Committed, but the session close is not confirmed. | **Hold.** Do not reopen. Read-only check that the owner session is gone and schema_info = candidate base; then continue. |
| `refused` | Nothing changed (checks before BEGIN or rolled back). | Reopen the old API; investigate. |
| `rollback_unconfirmed` | Began, failed, ROLLBACK not confirmed. | **Hold.** No retry, no reopen. Read-only inspect: schema_info, catalogue against `live.sql` and candidate. If it matches live exactly → treat as refused. Anything else → restore from `<restore-point>`. |
| `outcome_unconfirmed` | COMMIT sent, acknowledgement lost. | **Hold.** No retry, no reopen. Read-only inspect: candidate base stamped and catalogue matches → continue to G3; live unchanged → treat as refused; partial → restore. |

## Roll-forward, not roll-back

- After G2 commits the only ways back are **roll forward** (fixed image or module against the new schema) or a **full
  restore** to `<restore-point>` plus the old image.
- Because G0 froze writes before `<restore-point>`, a restore before G7 loses **no staff writes** (only the window's
  own operator changes). After G7, a restore loses staff writes made since `<restore-point>`; it then needs Fauzan's
  explicit decision with that loss stated, otherwise fixes roll forward only.
- Never: re-run the transition, install a module over drift, start the old image on the new schema, or open ingress
  to verify anything.

## Evidence to record

Per gate: time, operator, exact command (no secrets), full JSON output, hashes named. For a restore: the restore
point, restore duration, the extended drill checks above on the restored server, and the stated data loss (none
before G7).

## Open decisions for Fauzan (not invented here)

1. How ingress is closed and reopened on ACA staging (external=false vs scale old revision to 0), and who holds that
   right.
2. The exact `<owner-role>` for G2/G3 and its membership (the package refuses otherwise; no grant is implied).
3. A reviewed procedure for G4: starting a candidate revision while ingress is closed and reaching it from inside.
4. `<test-identity>` for G4/G5: which approved Microsoft account, its pilot scope and data access, and the
   closed-ingress sign-in route. Dev login stays off in production.
5. Which existing switch restricts sign-in for G5–G7 (pilot list or leadership-only), set by whom.
