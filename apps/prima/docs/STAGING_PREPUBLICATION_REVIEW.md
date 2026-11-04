# Prima Secure App: pre-publication review for staging (28 Oct 2026)

Reviewer: Claude, at the CEO's request ("Pre-publication code review", 28 Oct 2026). Branch
`claude/project-thread-9mwk36`. **Nothing was merged, published or deployed. No Azure resource was read or changed:
this workspace cannot reach Azure (the network policy blocks it), so the live settings are checked by a new
read-only script that runs in GitHub or Azure Cloud Shell instead.**

## 1. Executive summary

**Recommendation: NO-GO today, GO once the four steps in section 6 are done** (about 30 minutes, no extra cost).

The application code is in good shape for a first user acceptance test. Microsoft sign-in checks every token
properly, each company's records are walled off inside the database itself, and the CEO's dashboard comes from the
database, not from made-up demonstration data. I found and fixed:

1. **The deployment scripts named Azure resources that do not exist.** They pointed at names such as
   `psql-prima-stg-xxxxx` and `kv-prima-stg-xxxxx`, but the real ones are `psql-prima-staging-sea` and
   `kv-prima-staging-sea`. Running the old "Provision staging" button would have built a **second database, vault,
   registry and network** and written new database passwords into a new vault. That button is gone. A read-only
   "Check staging" replaces it, and every script now uses only the real names.
2. **Guards' PINs were sent to the browser** with every staff list. Anyone who can see a company's people list could
   have read the PINs used for patrol scans and witness sign-offs. The API now never sends a PIN.
3. **The API did not check which database login it used.** It now refuses to start unless it is the restricted
   `prima_api` login, so the administrator password can never end up running the website's API.
4. **The API could crash when Azure briefly drops a database connection** (maintenance). It now logs the drop and
   reconnects. Requests also time out instead of hanging.
5. **The high-severity dependency warnings are fixed.** Everything that runs on the server now has 0 known
   vulnerabilities. Two warnings remain in a testing tool that never leaves the developer's machine (section 5).
6. **Future database changes would never have reached staging.** The setup only built tables on an empty database.
   It now adds new tables and permissions on every deploy and never removes anything. A test proves it.
7. **Smaller fixes:** website security headers, a request limit, a clear message when sign-in expires or is refused,
   automatic roll-back if a new API version fails its checks, and a website build that cannot ship without the API
   address.

Tests that actually ran: **API 82 of 82 pass** (13 new). **Core business rules: 250 of 250 pass**, but the run
still ends with one test-runner timeout on this machine (section 4). Both website builds pass, and the type-check
passes. A browser check on desktop and phone sizes showed the CEO dashboard, the Microsoft sign-in redirect and an
expired sign-in all working.

## 2. Findings

Severity: **Critical** = could damage or duplicate live staging. **High** = data exposure or outage risk.
**Medium** = weakens security or reliability. **Low** = minor.

| # | Sev | Finding | Files | Status |
|---|---|---|---|---|
| C1 | Critical | Deployment scripts built resource names from a hash (`acrprimastg<hash>`, `kv-prima-stg-<hash>`, `psql-prima-stg-<hash>`, `cae-prima-staging`, `id-prima-staging`, database `prima`) that do not match the real staging resources (`acrprimastagingsea`, `kv-prima-staging-sea`, `psql-prima-staging-sea`, `cae-prima-staging-sea`, `id-prima-staging-app`, database `appdb`). "Provision staging" would have created a duplicate database, Key Vault (with new passwords), registry, network, environment and identity. | `infra/staging-env.sh`, `infra/provision-staging.sh`, `infra/bootstrap-staging.sh`, `.github/workflows/provision-staging.yml` | **Fixed.** Names fixed to the real ones and any other value refused. Provisioning removed. A read-only `infra/check-staging.sh` and "Check staging" workflow were added. Bootstrap now stops if a resource is missing instead of creating it. |
| H1 | High | Every person record sent to the browser carried the plain 4-digit PIN (people list, profile, every screen that returns a person). | `apps/api/src/main.ts`, `apps/api/src/security.ts` | **Fixed** (the API strips `pin` from every response). Test: `http.test.ts` "never sends a person's PIN". The PINs are still stored unhashed (see R1). |
| H2 | High | The API never checked that it was using the restricted `prima_api` login. A wrong `DATABASE_URL` (for example the administrator's) would have run silently with schema-owner rights. | `apps/api/src/db.ts`, `apps/api/src/main.ts` | **Fixed.** In production the API refuses to start unless the login is `prima_api` (or `PRIMA_API_DB_USER`) with no superuser, bypass, role, database, schema-create or owner rights. Tests: `setup.test.ts` "production start-up". |
| H3 | High | Known vulnerabilities: `multer` (6 denial-of-service advisories) inside `@nestjs/platform-express` in the API image, and `vite` (file-read advisories) in the website build tool. | `apps/api/package.json`, `apps/web/package.json`, `package.json`, `package-lock.json` | **Fixed** with patch and minor updates only: NestJS 11.1 to 11.2.8, multer 2.5.0 (override), vite 6.3 to 6.4.5. `npm audit --omit=dev`: 0. CI now fails on any new high one. |
| H4 | High | No handler for a dropped idle database connection, so the API process would crash on an Azure failover or maintenance. No connection or statement time-outs. The API also fell back to a local default database if `DATABASE_URL` was missing. | `apps/api/src/db.ts` | **Fixed**: error handler, 10 s connect, 30 s statement and 60 s idle-transaction limits, and production requires `DATABASE_URL`. |
| H5 | High | The database setup ran the schema only on an empty database, so a new table in a later release would never reach staging and the screens using it would fail. | `apps/api/src/db-setup.ts` | **Fixed.** The schema file (only `CREATE ... IF NOT EXISTS`, restated policies and grants) runs on every deploy. Tests prove that records survive and that the file contains no `DROP`, `DELETE` or `TRUNCATE` of data. |
| M1 | Medium | The website had no Content-Security-Policy, HSTS or Permissions-Policy. `/api/*` on the website address was answered with the app page, which hides a wrong API address. | `apps/web/public/staticwebapp.config.json` | **Fixed.** The CSP allows only this site, the `*.azurecontainerapps.io` API, Microsoft sign-in and Google Fonts. It was checked in a browser and blocks nothing Prima needs. |
| M2 | Medium | The API had no security headers or request limit, and announced "Express". | `apps/api/src/security.ts`, `main.ts` | **Fixed**: nosniff, no-store, frame deny, HSTS and a limit of 600 calls a minute per address (settable). Test: `http.test.ts`. |
| M3 | Medium | When Microsoft sign-in succeeded but Prima refused the account (not linked, not in the pilot), the app went back to the sign-in screen without saying why. When a sign-in expired mid-session, every screen showed an error instead of asking the person to sign in again. | `apps/web/src/App.tsx`, `apps/web/src/api/http.ts` | **Fixed.** The reason is shown, with a button to sign out of Microsoft and try another account. A 401 returns the person to sign-in with "Your sign-in has ended". Checked in a browser. |
| M4 | Medium | The website could be built without the API address, so on Azure it would call itself. | `apps/web/vite.config.ts`, `package.json` | **Fixed.** A server build fails without an `https://` `VITE_API_URL`, and the deploy checks that the address is inside the built files. |
| M5 | Medium | The deploy workflow had no pre-check and no roll-back. Its health check could pass on the old API copy while the new one failed to start. | `.github/workflows/deploy-staging.yml`, `scripts/staging-smoke.sh` | **Fixed.** It runs the read-only check first, records the running image, waits for the new copy to take over, checks the API (health, sign-in settings, 401 without sign-in, test sign-in off, headers, CORS for the website only) and puts the previous image back if anything fails. |
| M6 | Medium | The bootstrap gave the GitHub deployment identity Contributor and "Key Vault Secrets Officer" on the whole resource group, so it could change any resource or overwrite stored database passwords. It also gave the app identity "Key Vault Secrets User" on the whole group, and it assigned whoever ran it as "the CEO". | `infra/bootstrap-staging.sh` | **Fixed** (CEO review, 28 Oct). The deploy identity now gets Reader on the group, AcrPush on the registry, Key Vault Reader on the vault (names only) and a custom "Prima Staging Deployer" role on the API, setup job, website, environment and the two identities only. The old group-wide grants are removed from it. The app and setup identities are left untouched. The CEO is assigned by the verified object ID. Every grant checks first. **Corrected again (29 Oct):** the role no longer touches the setup job or its identity at all, and it has no `listSecrets` on the API (section 11). |
| M7 | Medium | API test files ran at the same time and raced to create the same database role, which failed 4 tests at random. | `apps/api/package.json` | **Fixed** (files run one after another). |
| M8 | Medium | If Microsoft's signing keys could not be fetched, the person got a generic server error. | `apps/api/src/auth.ts` | **Fixed**: they now get "try again in a minute" (503) and the failure is logged. |
| M9 | High | The deploy identity could change, start and list the secrets of the database setup job. Microsoft documents that whoever can start a job with an override can make it reveal its secrets, and that job holds the administrator login (`db-admin-url`). So routine website deploys effectively held database administrator power. | `infra/bootstrap-staging.sh`, `.github/workflows/deploy-staging.yml` | **Fixed** (29 Oct). The deploy no longer runs migrations. It checks the database schema version and stops safely when a migration is needed. Migrations run only when the CEO (or an administrator the CEO names) runs `infra/run-db-migration.sh` in Cloud Shell with their own account. Details in section 11. |
| L1 | Low | The offline cache stored responses from other addresses too. | `apps/web/public/sw.js` | **Fixed** (only this website's own files). |
| L2 | Low | The database reset tool is in the image and could run on Azure with `ALLOW_REMOTE_RESET=true`. | `apps/api/src/reset-db.ts` | **Fixed**: it refuses in any production build. |
| L3 | Low | On a phone, the coloured labels on the Executive view are cut off at the right edge. | `apps/web/src/styles.css` | Not fixed (cosmetic; for the UAT list). |
| L4 | Low | The core test run reports "Timeout calling onTaskUpdate" after all 250 tests pass, so it exits as failed on this machine. It is a known test-runner issue on a busy machine and has passed before on GitHub. | `packages/core` (vitest 3.2) | Not fixed; watch the GitHub run on this PR. |
| L5 | Low | `vitest` / `tinypool` (critical) and `@vitest/mocker` (moderate) advisories. These are the test tool, which only runs on a developer's machine or in CI. The fix is a major upgrade (vitest 3 to 5). | `packages/core/package.json` | Not fixed on purpose (no blind major upgrade). Schedule as its own change. |

## 3. What was checked and found sound

- **Microsoft sign-in** (`apps/api/src/entra.ts`). It accepts RS256 only and checks the signature against
  Microsoft's keys. It also checks the tenant, the v2 issuer, that the audience is the API and the caller is the
  website, expiry and not-before (5 minutes of clock leeway), the `access_as_user` scope and the account ID. Linking
  uses the Microsoft account's object ID only. An account that is unlinked, linked twice, a system feed or outside
  the pilot is refused. Test sign-in works only with `ALLOW_DEV_LOGIN=true`, and the API refuses to start with it on
  in production.
- **Company walls** (`db/migrations/001_init.sql`, `apps/api/src/db.ts`). Each request runs in one transaction as
  `prima_app`, with the person's companies set for that transaction only. Every company table has forced row-level
  security, and the audit log is append-only and hash-chained. Tests cover reads, writes, moving a row to another
  company, regional grants, and HTTP calls to another company's dashboard, people and sites.
- **Website**: the server build uses `HttpApi` against `VITE_API_URL`, and the demonstration code is not in it (I
  checked the built files). Sign-in uses MSAL with PKCE, session storage and redirect URI `<website>/`. Sign-out
  ends the Microsoft session too.
- **Secrets**: none are in the repository. The API gets `DATABASE_URL` from Key Vault through its identity, and the
  check script reads secret names only, never values.

## 4. Test results (run on 28 Oct 2026 and again on 29 Oct, in this workspace, PostgreSQL 16)

| Command | Result |
|---|---|
| `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** |
| `npm audit` (including dev tools) | 3 (1 moderate, 2 critical), all in the vitest test runner (L5) |
| `npm run build -w @prima/core && npm run typecheck` | Pass |
| `npm test -w @prima/api` | **82 of 82 pass** (13 new: `http.test.ts` 9, `setup.test.ts` 4, including "refuses to start on an older schema until the setup job has run", 29 Oct) |
| `npm test -w @prima/core` | **250 of 250 pass**; the run exits 1 on the runner timeout (L4) |
| `VITE_API_URL=<staging API> npm run build -w @prima/web` | Pass; the API address is in the build |
| `npm run build -w @prima/web` without `VITE_API_URL` | Refused, as intended |
| `npm run build:demo -w @prima/web` | Pass |
| API installed as in the Docker image (`npm ci --omit=dev`), started with `NODE_ENV=production` | Starts as the restricted login, refuses a superuser |
| Browser (Chromium, 1366 px and iPhone 13 size) with the site's security headers | CEO dashboard loads from the API with no console or CSP errors and no sideways scrolling. An expired sign-in returns to sign-in. "Sign in with Microsoft" goes to Microsoft with the website ID, redirect `<website>/`, the API scope and PKCE. |

The Docker image itself was not built (no Docker here); GitHub builds it in the deploy run.

## 5. Remaining vulnerabilities and what they mean

- **vitest 3.2 / tinypool / @vitest/mocker.** These matter only if someone runs the test tool against untrusted
  input on their own machine. Nothing in the API image or the website uses them. Fixing them needs vitest 4 or 5,
  which changes the test tool, so it is better done as its own small change.

## 6. GO / NO-GO for publishing staging

**NO-GO with main as it is today.** Its scripts point at the wrong resources, and its website would be published
without these fixes.

**GO** once all four are true:

1. This pull request is reviewed and merged.
2. `infra/staging.env` exists with the real IDs (copy `infra/staging.env.example`). The IDs come from the output of
   `infra/bootstrap-staging.sh` (section 10). It costs nothing but is **not read-only**: it changes Entra sign-in
   settings, creates the deployment identity, grants its permissions and may create a budget alert.
3. **Actions → Check staging → Run workflow** passes. It reads the live setup and fails if any of these is wrong:
   the API's `DATABASE_URL` must come from Key Vault, `ALLOW_DEV_LOGIN` must be off, `WEB_ORIGIN` must equal
   `https://ashy-field-095365900.3.azurestaticapps.net`, the Microsoft IDs must match, the database setup job must
   exist and take its `DATABASE_URL` from a secret and not use the API's identity, and the website registration must have the redirect URI
   `https://ashy-field-095365900.3.azurestaticapps.net/` as a **Single-page application** address.
4. The live staging database holds no real records. It was meant to start with only companies and staff accounts.

## 7. Deployment instructions (staging only; never production)

1. Merge this PR on GitHub (the CEO).
2. If the GitHub deployment identity does not exist yet: open [shell.azure.com](https://shell.azure.com) (Bash), paste
   `infra/bootstrap-staging.sh` and send the printed lines (IDs only) to Claude, who adds `infra/staging.env` by PR.
3. GitHub → Actions → **Check staging** → Run workflow (branch `main`). Fix any FAIL line before going on.
4. GitHub → Actions → **Deploy staging** → Run workflow (branch `main`), type `DEPLOY STAGING`. It runs, in order:
   tests; the read-only check; it records the running API image; builds and pushes `prima-api:<commit>` to
   `acrprimastagingsea`; **checks the database schema version** (it never runs the setup job); swaps the API image;
   waits for the new copy; checks it (and puts the old image back if it fails); builds the website for
   `https://ca-prima-api-staging.yellowsand-230f2038.southeastasia.azurecontainerapps.io`; and publishes it to
   `swa-prima-staging`.
   - **If the database needs a migration, the run stops** before the API or website changes (or, on the very first
     deploy, the new API refuses to start and the old image is put back). Its summary prints
     `export IMAGE_TAG=<commit>`.
   - The CEO then opens Cloud Shell, pastes that line, pastes `infra/run-db-migration.sh`, checks the job and image
     it shows, and types `MIGRATE`. When it says "Database setup done", run **Deploy staging** again.
   - **The first deploy after this PR will always stop once**, because the live database has no schema version yet.
5. Open `https://ashy-field-095365900.3.azurestaticapps.net`, press **Sign in with Microsoft**, and sign in as the CEO.

## 8. Rollback instructions

- **API:** the deploy run's summary shows the "Rollback image". In Cloud Shell:
  `az containerapp update -n ca-prima-api-staging -g rg-prima-staging-sea --image <rollback image>`.
  The workflow does this by itself (through `infra/set-api-image.sh`) if the new API fails its checks.
- **Database setup job:** only the CEO changes it. `infra/run-db-migration.sh` prints the exact line to put the old
  image back: `az containerapp job update -n <setup job> -g rg-prima-staging-sea --image <old image>`. An older API
  will refuse to start on a newer schema version, so roll the database forward, not back.
- **Website:** revert the merge on GitHub and run Deploy staging again. Static Web Apps Free has no slots. Before
  this first publish the site was empty, so if needed it can simply stay unpublished.
- **Database:** nothing to undo. The setup only adds tables, policies and grants and never removes a row. If data
  were ever damaged, use Azure's point-in-time restore **to a new server** (`psql-prima-staging-sea` → Restore),
  never over the existing one.

## 9. Outstanding risks (not fixed here)

| # | Risk | Suggested next step |
|---|---|---|
| R1 | PINs are stored unhashed, and the site device's face score is trusted (CTO audit P0). | Hash PINs with a per-person salt and score faces on the server before any real guard uses a site device. **31 Oct 2026: PIN hashing built (keyed salted hash, merged in PR #34 `15bbc5e`, see `docs/STAFF_DATA_SECURITY.md`); not yet deployed. Server-side face scoring still open.** |
| R2 | Group-wide tables (IT, websites, speak-up reports, ACT, assets, fleet, PDPA, memos, products) have no database-level wall. Only application rules protect them, and tests cover those rules. | Add row-level policies by department before real data. **31 Oct 2026: database walls built for Asset Management, ACT, PDPA and continuity (`docs/STAFF_DATA_SECURITY.md`); IT, speak-up, fleet, memos, products and websites still to do; merged in PR #34, not yet deployed.** |
| R3 | Nothing in Prima marks a person as having left. Access ends only when IT removes the Microsoft link or disables the account. | Add a "left" flag that sign-in refuses, as part of HR offboarding. **31 Oct 2026: built (`accessClosedFrom`, checked on every request; HR closes access or it closes the day after the last working day; `docs/STAFF_DATA_SECURITY.md`); merged in PR #34, not yet deployed.** |
| R4 | The database's public network access and firewall are unknown from here. | "Check staging" warns about it; move to private access before real data. |
| R5 | The request limit is counted per API copy in memory. | Enough for staging. For live, add Azure Front Door or API Management. |
| R6 | Backups are Azure's in-region point-in-time restore only. | Add a weekly export before real data (staging plan, section 2). |
| R7 | I could not see the live settings: the Key Vault secret names, the setup job's name and identity, and whether the API already uses `prima_api`. | "Check staging" and the API's new start-up check verify these before anything changes. |

## 10. What `infra/bootstrap-staging.sh` changes (revised after the CEO's review, 28 Oct 2026)

It is **not read-only**. Every step checks first and changes only what is missing or different, so it is safe to
run again. It stops before changing anything if a staging resource or the CEO account is missing.

| Area | Change |
|---|---|
| Entra: API registration | Issues version 2 tokens (only if not already). |
| Entra: website registration | May ask for `access_as_user`, with admin consent. Adds `https://<website>/` as a single-page-app redirect address (existing ones are kept). Assignment is required. Assigns the CEO by verified object ID `98cc4e91-fb99-4f21-82e9-4535d9cda167`, never the person running the script. |
| GitHub deployment identity | Creates `prima-github-deploy-staging` if missing. It has no password, and its federated credential accepts runs on `main` of this repository only. It warns if a password, or trust for another branch, exists. |
| Permissions (deployment identity only) | Reader on `rg-prima-staging-sea`. AcrPush on `acrprimastagingsea`. Key Vault Reader on `kv-prima-staging-sea` (secret names, never values). Custom role "Prima Staging Deployer" on `ca-prima-api-staging`, `swa-prima-staging`, `cae-prima-staging-sea` and `id-prima-staging-app` only. It removes a group-wide Contributor or Key Vault Secrets Officer from this identity if an earlier run gave one, removes the custom role from the setup job and `id-prima-staging-dbsetup` if an earlier run gave it, and warns if the identity holds Owner, Contributor or a Key Vault role on the job, the setup identity or the vault. |
| Not touched | The database, Key Vault secrets, registry contents, API and job settings, website content, and the access of `id-prima-staging-app` (still only its `db-api-url` secret) and of `id-prima-staging-dbsetup`. |
| Budget | Creates the e-mail alert budget `prima-staging-monthly` (USD 64, alerts at 50/80/100% and forecast 100%) only if it is missing. A budget never stops anything. The price estimate in "Check staging" is information only: the RM 300 cap was withdrawn. |

The custom role's exact permissions are listed in section 11.

## 11. Database migrations are separate from deployment (CEO correction, 29 Oct 2026)

**Why.** The database setup job holds the administrator login (`db-admin-url`). Microsoft's Container Apps
documentation says that anyone who can start a job with an override, or list its secrets, can effectively read
them. So the GitHub deployment identity must not be able to change, start or read that job.

**How it works now.**

1. The migration file `db/migrations/001_init.sql` creates a small table `prima.schema_info`. The setup job writes the
   file's SHA-256 fingerprint there. It only adds; it never drops, empties or reloads records (a test checks this).
2. The API checks the fingerprint at start-up in production and **refuses to start** if the database is older than
   the code. So a missed migration can never run new code on an old database. The deploy then puts the old image back.
3. `GET /api/health/schema` (public, no records) reports `{current, expected, applied}`: fingerprints only.
4. **Deploy staging** compares the fingerprint before swapping the API. If they differ, it stops and tells the CEO
   what to run. It never touches the setup job.
5. **`infra/run-db-migration.sh`** is run by the CEO in Cloud Shell with the CEO's own Azure account. It checks the
   image exists in the registry, that the job exists and runs `db-setup`, shows the old and new image, asks the CEO
   to type `MIGRATE`, then points the existing job at the new image, runs it once and waits. It keeps the job's
   settings, identity and secrets, and does not change the API, the website or Key Vault.
6. When run without a new password, the setup leaves the `prima_api` password alone and only restates its read rights.

**What the GitHub deployment identity can still do** (`prima-github-deploy-staging`, `main` branch only):

| Scope | Permission | Why it is needed |
|---|---|---|
| `rg-prima-staging-sea` | Reader | Find resources and read their settings for the checks. It cannot read Key Vault values or any `listSecrets`. |
| `acrprimastagingsea` | AcrPush | Push the new API image. |
| `kv-prima-staging-sea` | Key Vault Reader | See secret **names** for the checks, never their values. |
| `ca-prima-api-staging` | `containerApps/read`, `write`, `revisions/read` | Swap the API image and wait for the new copy. No `listSecrets`: the image is changed with a direct `az rest` update of the container list only. |
| `cae-prima-staging-sea` | `managedEnvironments/read`, `join/action` | Azure requires this when the API is updated. |
| `id-prima-staging-app` | `userAssignedIdentities/read`, `assign/action` | Azure requires this because the API uses that identity. That identity can read only `db-api-url` (the restricted `prima_api` login). |
| `swa-prima-staging` | `staticSites/read`, `listSecrets/action` | Read the website deploy token to publish the site. |
| everywhere | `Microsoft.App/locations/*/read` | Follow the progress of an update (operation results and statuses, which are read-only and hold no secrets). |

**Checked against Microsoft's published list of provider operations (29 Oct 2026):** every action above exists.
`Microsoft.App/operationResults/read` does not, which made the first bootstrap run stop, so it was removed; the
operation results it was meant for are under `Microsoft.App/locations/*/read`.

**Removed from it:** `containerApps/listSecrets`, every `jobs/*` permission (read, write, start, listSecrets,
executions), and anything on `id-prima-staging-dbsetup`.

**Remaining risk.** `containerApps/write` on the API could, in principle, change the API's settings, for example point
it at a different Key Vault secret. But the API identity can read only `db-api-url`, so the most it can reach is the
restricted login, and the API refuses to start as anything else. The website token lets a `main` run replace the
site, which is its job. The role and the `az rest` update are not yet tested against live Azure: **Check staging**
and the first deploy will show it, and if Azure asks for a missing permission the deploy stops before changing
anything except possibly the API image, which it rolls back.

**Note on the green "Check staging" on this PR.** On a pull request only its *price* job runs. Its *check* job, the
one that reads live Azure, is skipped: it runs only when started by hand from `main` by `fauzan4377`. The live check
has therefore **not run yet** and must be started from `main` after the merge (section 6, step 3).
