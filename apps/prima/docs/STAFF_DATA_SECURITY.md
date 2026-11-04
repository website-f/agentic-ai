# Staff data security gates: PINs, department walls, offboarding

**Date:** 31 October 2026 (Asia/Kuala_Lumpur). **Asked for by:** Fauzan (CEO), item 1 "security fixes that block real
personal data". **Built by:** Claude on branch `claude/project-thread-zoovux`. **Review and release:** Arisha main.
**Merge:** Fauzan. **Status:** MERGED to `main` in PR #34 (merge commit `15bbc5e`, 31 Oct 2026, 13:36 MYT, head `2f48c09`, CI green). Not deployed, no migration run, `PIN_PEPPER` not set, no Azure or Entra change. Arisha main reviewed the exact head `2f48c09` with green checks before Fauzan approved and merged it.

This closes, in code, three of the gates in `docs/STAGING_PREPUBLICATION_REVIEW.md` section 7 (R1 to R3) that block
real staff records. It does not close them on staging until the release steps below are done.

## What changes for people

| Who | What they see |
| --- | --- |
| HR, a company manager or admin executive, the CEO | On a staff profile, "PIN and Prima access": whether a PIN is set, and a box to set a new one. The PIN is never shown again. |
| HR, the HR Director (CoS, Deputy CoS), the CEO | On the same card, each Prima account of the person, with "Close access" (reason, and a date or now). |
| A leaver | From the closing day Prima refuses every sign-in and request: "This Prima account was closed from <date>. If you still work here, ask HR." |
| A guard or witness who has left | Their PIN no longer works on a site device or as a witness (same message as a wrong PIN): from the day after a recorded last working day, or from the day their Prima account is closed. |
| Everyone else | No change. Department screens already refused other departments; now the database refuses too. |

Recording a leaver's last working day on the staff record (existing "leaving" step) also closes their account **from the
day after the last day**, so they can still work their last day.

## 1. PINs are hashed (R1)

- A PIN is stored as `h1$<salt>$<HMAC-SHA256(key, salt:PIN)>` in `pinHash`; the typed PIN is never stored or logged.
  `packages/core/src/pin.ts`.
- A 4-digit PIN has only 10,000 values, so a salt alone would not stop someone with a database copy. The **key**
  (`PIN_PEPPER`, a Key Vault secret, 32+ characters) is what protects it, and it never sits in the database.
- In production, with no key, a short key or the test key, every PIN check is **refused** with a clear message. The API
  still starts; only PIN sign-in on site devices and witness sign-offs is off.
- PINs are 4 to 6 digits; one digit repeated and runs like 1234 or 9876 are refused. Nobody sets their own PIN.
- The API strips both `pin` and `pinHash` from every response. Mock data keeps only hashes; testers work out a mock
  PIN from the staff number (`demoPin`), shown only in the test version.

**Still open from R1:** the site device's face score is still trusted from the device. Server-side face scoring needs a
face engine and is a separate piece of work.

## 2. Department walls in the database (R2)

Each request now also sets `app.walls`, the department walls the person passes (`dataWalls` in
`packages/core/src/access.ts`). The service uses the same role functions, so the screen and the database never disagree.

| Tables | Read | Write |
| --- | --- | --- |
| `am_units`, `am_work_orders`, `am_assets`, `am_properties`, `am_depn_postings` | Asset Management, group leadership, Finance, **ACT (to audit)** | Asset Management, group leadership, Finance. **ACT never writes, ACT head included.** |
| `act_findings`, `act_improvements` | ACT and group leadership, plus the person who owns that finding or improvement | same |
| `act_audits` | ACT and group leadership | same |
| `pdpa_cases`, `pdpa_dpos`, `pdpa_requests` | PDPA officer, group leadership, Operations Director | same (the service lets only the PDPA officer write) |
| `bcm_systems`, `bcm_drills` | IT and group leadership | same |

**Deliberately not walled yet:** the IT tables (`it_*`), because Monday's IT pilot depends on them and some rows are
shared with every requester; speak-up reports (`whistle_reports`), because reporters check status by code without
being a handler; fleet, memos, products, websites. Each needs per-row rules (requester, handler, audience) and is the
next slice. Their application rules and tests are unchanged.

## 3. Offboarding (R3)

- `User.accessClosedFrom` is the first day an account is refused, with who closed it, when and why.
- The API checks it on **every request** (`Db.asUser`) and at Microsoft sign-in (`userForEntra`), so no route can
  serve a leaver whichever way they signed in.
- The API login still cannot change accounts or grants. The only way is the database function
  `prima.close_access`, which requires the `offboard` wall (HR, HR Director, CEO), refuses your own account, the
  CEO's account and system feeds, and ends the person's company grants the day before the closing day. The service
  writes the audit entry.
- The Microsoft (Entra) link is **kept**, so the audit trail still shows who the account was. IT still disables the
  Microsoft account in Entra; Prima does not touch Entra.

## Release steps for Arisha main (in order, nothing here has been done)

Revised twice after Arisha main's reviews (68582be, ff64cd6); she reviewed the final version (2f48c09) before the merge. This is not a live security certification. Every step
below needs its own approval: Fauzan approves the merge, the migration and the deployment; `PIN_PEPPER` needs its
own separate approval.

**What not to do.** Do not drop a department policy as a shortcut. Row-level security is forced on these tables, so a
table with no policy shuts **everyone** out, and an API from before this change never sets `app.walls`, so it cannot
read the walled tables either. Do not run a generic migration command without review (see step 4).

1. **Review and merge.** Done: Arisha main reviewed `2f48c09`, Fauzan merged PR #34 (`15bbc5e`). Check CI is green on the merge commit.
2. **PIN key (separate approval; optional for the release). Fauzan decided 31 Oct 2026, 15:38 MYT: keep PINs off for the Monday release, so skip this step and step 6.** If approved, create `PIN_PEPPER` in Key Vault
   `kv-prima-staging-sea` (random, 32+ characters) and reference it on `ca-prima-api-staging` as a **secret reference
   only**. The current API ignores the variable, so this can be done before the migration, but changing a Container
   App setting creates a new revision, so do it in the planned window. Without it the release still works and PIN checks
   stay refused. `infra/check-staging.sh` reports which. Cost: none.
3. **Build-only run of "Deploy staging"** (mode `build-only`, confirmation `BUILD STAGING IMAGE`). This runs the tests,
   builds and pushes the image, and reports the tag, the immutable digest and the expected schema hash. It does
   **not** run the schema gate, check the API or change anything running (`docs/STAGING_RELEASE_SAFETY_MODES.md`).
   Review the digest, and check that the reported schema hash equals `sha256sum db/migrations/001_init.sql` on the
   merged commit.
4. **Migration, by Arisha main's reviewed, administrator-controlled procedure.** The `Deploy staging` workflow never
   migrates. Whatever tool runs it, the run must meet all of these:
   - it uses the reviewed immutable image from step 3, and the schema applied is exactly that image's
     `db/migrations/001_init.sql` (same hash);
   - it **keeps the existing API database password**: no `PRIMA_API_DB_PASSWORD` in the job's settings, so
     `db-setup` only restates the API login's read rights (`apps/api/src/db-setup.ts`, `apiLogin`);
   - it does **no seeding or bootstrap**: `prima.users` is not empty, so no clean-slate data loads, and
     `ENTRA_BOOTSTRAP_LINKS` is unset, so no Microsoft link is added;
   - it is additive only: this change adds two functions (`prima.has_wall`, `prima.close_access`) and policies on
     `am_*`, `act_*`, `pdpa_*`, `bcm_*`; it deletes and rewrites no rows.
   `infra/run-db-migration.sh` points the setup job at an image and runs it. Use it only after confirming the job's
   settings meet the list above. It is not a substitute for that review.
5. **Deploy-mode run straight after the migration** (mode `deploy`, confirmation `DEPLOY STAGING`). Deploy mode
   rebuilds the merged commit (the digest may differ from step 3) and runs the schema gate: it continues only when the
   applied schema equals the candidate's.
   - **Fail-closed window between steps 4 and 5.** The old API keeps serving, because it checks the schema only at
     start-up. It sends no `app.walls`, so the Asset Management, ACT, PDPA and continuity screens show nothing and
     refuse writes. Nothing leaks and every other screen works. If the old revision restarts during the window, it
     refuses to start on the newer schema until step 5 is done, so keep the window short. Run it outside working hours,
     or tell those four departments first.
6. **Optional, after the deploy and only if `PIN_PEPPER` is set:** as the database administrator with the same key,
   `npm run pins:hash -w @prima/api -- --by "<name>"` (dry run, changes nothing), then with `--apply` if the counts are
   as expected. A record whose PIN HR has already reset keeps that new hash; only the old typed PIN is removed. Staging
   started as a clean slate with no guard PINs, so expect 0 hashed and possibly a few empty ones removed.
7. **Check** with dummy accounts only: HR sets a PIN on a test profile; HR closes a test account, and that account and
   its PIN are refused; an IT executive cannot open PDPA or Asset Management; the Asset team, ACT and the PDPA officer
   see their own boards.

**If something is wrong after the release: roll forward, never back.** After step 4 the previous image cannot be
restored automatically (`scripts/staging-schema-gate.mjs` refuses a rollback to an older schema), and the database is
never downgraded. Who passes which wall is decided in code (`dataWalls` in `packages/core/src/access.ts`); the policies
only name the walls. So a person or department wrongly kept out is fixed by an **API-only PR with no migration**, built
and deployed through steps 3 and 5. A change to a policy itself is a new reviewed migration through steps 3 to 5.

## Tests (all on a throwaway local PostgreSQL 16, never staging)

- `packages/core/test/staff-security.test.ts` (15): hashing, key off, weak PINs, who may set PINs, leaver's PIN,
  walls per department (an unrelated fifth user gets none; ACT never gets asset write), offboarding now and later,
  who may close, leaver closed from the day after the last day; after review: a closed account also stops site-device
  and witness PINs, a last working day recorded ahead stops PINs the day after, and setting a new PIN blanks an old
  typed one.
- `apps/api/test/staff-security.test.ts` (11): no typed PIN in the database; test key refused in production; each
  wall in the database; ACT cannot change assets; finding owners see only their own; walls set per request; the API
  login cannot change accounts or grants; `prima.close_access` refusals; a closed account refused on every request and
  at Microsoft sign-in with grants ended; PIN never in the audit log; the conversion script's dry run and apply,
  including old PIN A, then HR sets B, then conversion: only B works and no typed PIN is left.
- `apps/api/test/http.test.ts`: the people list and profile never carry `pinHash`.
