# Prima staging on Azure: cost, security and setup plan (Issue #12)

Version 3, 28 Oct 2026. Version 2 answered the independent review on Issue #12; version 3 answers the CTO review
on PR #13 (deployment approval gate, merge order, calculator inputs, failing smoke check, Azure checks, rollback). **Nothing has been bought,
created or deployed.** Each paid resource waits for the CEO's written approval.

**Goal:** open Prima Secure App in a browser and sign in with the CEO's own Microsoft 365 account. Staging holds no
real records. It starts with the companies and staff accounts only, and the CEO adds test records himself.

> **Update 28 Oct 2026 (pre-publication review):** staging was built by hand with these names, which replace the
> generated names in section 5: `psql-prima-staging-sea` (database `appdb`), `acrprimastagingsea`,
> `cae-prima-staging-sea`, `ca-prima-api-staging`, `swa-prima-staging`, `kv-prima-staging-sea`, identities
> `id-prima-staging-app` and `id-prima-staging-dbsetup`. "Provision staging" is removed; use the read-only
> "Check staging" and see `docs/STAGING_PREPUBLICATION_REVIEW.md` for deploy and rollback. The RM 300 hard cap below
> was withdrawn by the CEO (28 Oct 2026): the price estimate is information only; budget e-mail alerts remain.

---

## 1. Monthly cost (Southeast Asia, staging)

| What | Azure service and size | Est. USD / month | How sure |
|---|---|---|---|
| Database computer | PostgreSQL Flexible Server, Burstable **B1ms** (1 vCPU, 2 GiB) | **19.00** | Southeast Asia list price [1] |
| Database disk | 32 GiB Premium SSD | **3.70 to 4.60** | USD 0.115/GiB-month list price [2]; Southeast Asia rate to confirm |
| Database backups | 7 days, point-in-time restore | **0** | Free up to the size of the disk [3] |
| Private network | Virtual network, plus the database's private DNS zone | **about 0.50** | Network free; DNS zone list price, to confirm |
| API | Container Apps, Consumption, **one copy always awake** (CEO, 28 Oct: "Keep awake") | **about 10 to 15** | Idle copy about USD 10 after the free allowance [4], plus use when busy |
| Database setup job | Container Apps job, runs a few seconds per deployment | **0** | Inside the same allowance [4] |
| API image store | Container Registry **Basic** | **about 5** | List price [5]; Southeast Asia rate to confirm |
| Passwords vault | Key Vault Standard | **under 0.10** | Per-use |
| Files | Blob Storage, private, LRS | **under 0.50** | Per-GiB; little use in staging |
| Logs | Log Analytics, capped at 0.15 GiB a day | **0** | First 5 GiB a month free [6] |
| Website | Static Web Apps **Free** | **0** | [7] |
| Web addresses and HTTPS | Azure default addresses with free certificates | **0** | |
| Data between these services | All in the same region | **0** | No charge inside one region |
| Arisha (AI assistant) | Azure OpenAI, pay per use | **0 while off** | Stays off (`ARISHA_ENABLED=false`) until the CEO approves it and its own quote |
| **Total before tax** | | **about USD 39 to 45** | |
| Service tax on imported digital services (8%, if it applies) | | about USD 3 to 4 | Finance to confirm |
| **Total with tax** | | **about USD 42 to 49** | |

**In ringgit:** the bill is in US dollars, so the ringgit figure moves with the exchange rate. At RM 4.20 to 4.70 per
USD it comes to **about RM 175 to 230 a month**, still under the **RM 300 target**.

**Options that change the cost:**
- **Stop the database between test sessions.** It can stay stopped for up to 7 days, then Azure restarts it.
  While stopped, the database computer costs nothing; the disk is still charged. Saves up to about USD 19 a month.
- **One API copy always running (chosen, no cold start).** Adds about **USD 10 a month**, already in the table. That
  is 0.5 vCPU and 1 GiB kept idle, at USD 0.000003 per second each, after the free allowance [4]. Setting the
  minimum back to 0 saves it, at the cost of a 10 to 20 second wait on the first visit after a quiet spell.
- **Restore drill.** Each drill restores the database to a new temporary server for about 2 hours, costing well
  under USD 0.50. The temporary server is deleted afterwards.
- **Not chosen for staging:** a second-region backup copy (CEO decision, 28 Oct), private endpoints for Key Vault and
  Storage (about USD 7 a month each, which isn't justified for made-up data), and Defender for Cloud plans.

**Confirm before buying.** I could not reach Microsoft's live price list from my working environment. The
Southeast Asia rates in the table therefore come from public price tables [1] to [7], and some are marked "to
confirm". Before the CEO approves the spend, the IT Lead should enter these items into the
[Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/), with region **Southeast Asia**, and
export the estimate. **The figures above are my estimate, not a quotation; only the exported calculator estimate
counts as the quote.**
- PostgreSQL Flexible Server: Burstable B1ms, 730 hours, 32 GiB Premium SSD storage, 7-day backup, locally redundant
- Container Apps, Consumption plan: **1 replica idle for the full 730 hours** (0.5 vCPU, 1 GiB), plus about 50
  active hours a month on top of that; tick "apply free grant"; 1 million requests
- Container Apps job: 20 runs a month of 1 minute each (0.5 vCPU, 1 GiB)
- Container Registry Basic
- Key Vault Standard: 10,000 operations
- Storage account (Blob, Hot, LRS): 5 GiB, 10,000 write and 100,000 read operations
- Log Analytics (Analytics logs): 3 GiB a month, 30 days retention
- Virtual network: 1 network, no peering (free); Private DNS: 1 zone and under 1 million queries
- Bandwidth: 5 GiB outbound to the internet a month
- Static Web Apps: Free plan

The budget guard (step A) is **USD 64 a month, about RM 300**, the agreed ceiling. The IT Lead confirms in the Azure
portal that the budget and its alerts exist before step B.

---

## 2. Security design (answers the review)

| Review point | What this plan does |
|---|---|
| 1. Real Southeast Asia quote | See section 1. The IT Lead exports a Pricing Calculator quote before any purchase. |
| 2. No "allow all Azure services" database firewall | The database has **private access only**: it sits inside a private virtual network with no public address. Only the API and the setup job, which run in the same network, can reach it. Cost: about USD 0.50 a month for the private DNS zone. This must be chosen when the database is created and cannot be changed later. |
| 3. API never uses the database administrator | The **setup job** uses the administrator login, only to create tables and logins and to link the first accounts. The **API** uses its own login, `prima_api`. That login can read only the staff and grant lists it needs to sign people in, and must switch to the company-wall role `prima_app` for everything else. It cannot change the schema, delete audit entries, update staff records directly or become the administrator. Automated tests prove this against a non-superuser administrator, as on Azure (`apps/api/test/setup.test.ts`). |
| 4. No test-sign-in secret in staging | `DEV_TOKEN_SECRET` is **not set** on Azure, and `ALLOW_DEV_LOGIN=false`. The API **refuses to start** if test sign-in is switched on in the container image. A test also checks that test tokens are refused while test sign-in is off. |
| 5. Backups | Azure's point-in-time restore is a **recovery feature managed by Azure inside the same region**. It is not a separate copy held elsewhere. For staging with made-up data that is acceptable. Before real data arrives, a separately exported copy (a weekly database export to a different storage account) will be added and costed. A restore drill is part of the test checklist (section 6). |
| 6. Cold start and database connections | One API copy is kept awake (CEO, 28 Oct), so there is **no cold-start wait**. A second copy starts only under load. Each API copy holds at most 10 database connections and there are at most 2 copies, so up to 20 connections plus 1 for the setup job. B1ms allows 50. The 11-user test (section 6) measures both. |
| 7. Website address | The website's redirect address is entered in Microsoft Entra **only after** Static Web Apps has created the real address (step H). |
| 8. Made-up data only | The setup job **never wipes anything**. It loads the starting accounts only into an empty database, and leaves a database that already has data exactly as it is (tested). `db:reset` refuses any non-local database. `ALLOW_REMOTE_RESET` is never set on Azure. No extra Microsoft Graph permissions are requested. |

Also in place:
- Only the staging website may call the API from a browser (`WEB_ORIGIN`).
- The website sends basic security headers.
- Deployment signs in to Azure with federated identity, so no Azure password is stored in GitHub.
- The website deployment token is fetched for each run and never stored.
- Only the CEO can deploy, only from `main`, and only after typing DEPLOY STAGING (section 5, step M). Azure itself
  refuses a deployment sign-in from any other branch.
- The deployment stops with an error unless the API, its database login and Microsoft sign-in all check out.

---

## 3. What is ready and what is left

| Item | State |
|---|---|
| Microsoft sign-in (two registrations, token checks, account linking) | Coded and tested (PR #11). **Not merged.** |
| API container (`Dockerfile`), website settings (`staticwebapp.config.json`) | Coded and built locally (staging PR). **Not merged.** |
| Safe database setup job (`db-setup.ts`): starting accounts, `prima_api` login, first-account links | Coded and tested as a non-superuser administrator. **Not merged.** |
| Deployment workflow (`.github/workflows/deploy-staging.yml`) | Coded. **Never run.** GitHub can start it only after it reaches `main` (step M). It needs the Azure resources and the CEO's approval. |
| Smoke check (`scripts/staging-smoke.sh`) | Tested locally: fails when the API is down, when the database has no schema and when test sign-in is on. |
| Azure subscription, `rg-prima-staging-sea`, budget alerts | Reported by the CEO. **The IT Lead must verify.** |
| Entra registrations "Prima Secure App - Staging" and "Prima Secure API - Staging" | Reported by the CEO. **The IT Lead must verify** (section 4). |
| Every Azure resource in section 5 | **Not created.** |

---

## 4. Microsoft Entra settings to verify (IT Lead)

| Registration | Must have |
|---|---|
| **Prima Secure API - Staging** | Expose an API: Application ID URI `api://<its application ID>`; scope **access_as_user**, admins consent, enabled. Manifest `requestedAccessTokenVersion = 2`. No client secret. No redirect URI. |
| **Prima Secure App - Staging** | Platform **Single-page application**. Redirect URI exactly `https://<the website address from step H>/`, with the trailing slash. Implicit grant **off**. **No client secret.** API permissions: *Prima Secure API - Staging / access_as_user* and Graph *User.Read* only, admin consent granted. |
| Enterprise application *Prima Secure App - Staging* | *Assignment required* = **Yes**. Assign the CEO only for the first sign-in, then the pilot users. |
| MFA | Conditional Access requires MFA for this app, or the tenant-wide MFA rule covers it. |

---

## 5. Setup steps (only after the CEO approves the quote)

**Automated path (CEO, 28 Oct: "do everything you can automatically").** Steps A to L below are scripted; the manual
steps stay as the reference for what the scripts do.
1. `infra/bootstrap-staging.sh`, pasted once into Azure Cloud Shell by the CEO. It creates nothing that costs money:
   it registers the resource providers, checks both sign-in registrations (sets version 2 tokens on the API, lets the
   web app request `access_as_user`, admin consent, *Assignment required* with the CEO assigned), creates the Static
   Web App (Free) and adds its address as the web app's redirect URI, creates the deployment identity (federated
   credential for `main` only) and the app identity `id-prima-staging`, grants roles on the resource group only
   (deployment: Contributor, AcrPush, Key Vault Secrets Officer; app: AcrPull, Key Vault Secrets User), and adds the
   USD 64 budget with alerts to the subscription owners. It prints IDs only, which go in `infra/staging.env`.
2. *Provision staging* (`.github/workflows/provision-staging.yml`, same CEO-only gate as *Deploy staging*). It first
   runs `infra/staging-price.mjs`, which prices every paid item from Microsoft's live Retail Prices API for Southeast
   Asia and **stops before creating anything** if the month would exceed RM 300 with 8% tax at RM 4.70 per USD. Then
   `infra/provision-staging.sh` creates steps B to K. Database passwords are generated in the run, written straight
   into Key Vault and masked; nobody sees them. Unique names get a 5-character suffix from the subscription ID.
3. *Deploy staging*, as in step M, now also opens the website in a headless browser and checks that Microsoft's
   sign-in page opens for the right app, tenant, scope and return address.

Differences from the manual steps: the Static Web App's own region is East Asia (Static Web Apps has no Southeast
Asia region; the site is served worldwide and holds no data), and the API and setup job share the user-assigned
identity `id-prima-staging` for the registry and Key Vault, while the API also keeps a system-assigned identity for
Arisha (step N).

Everything goes in region **Southeast Asia** and resource group **rg-prima-staging-sea**. A few names must be unique
across Azure; add a short suffix if one is taken.

The IT Lead does these steps with their own Azure admin account, not the CEO's login. Passwords are generated in
the portal and go straight into Key Vault. Nobody types them into chat, email or GitHub.

**A. Budget guard.** Cost Management → Budgets → `rg-prima-staging-sea`: **USD 64 a month (about RM 300)**, alerts at 50%, 80%
and 100% to the CEO and the IT Lead.

**B. Logs.** Log Analytics workspace `log-prima-staging`, daily cap **0.15 GiB**, 30 days retention.

**C. Private network.** Virtual network `vnet-prima-staging`, address space `10.20.0.0/16`, with two subnets:
- `snet-apps`, `10.20.0.0/23`, delegated to *Microsoft.App/environments*
- `snet-db`, `10.20.2.0/28`, delegated to *Microsoft.DBforPostgreSQL/flexibleServers*

**D. Database.** PostgreSQL flexible server `psql-prima-staging-sea`:
- Version **16**. Burstable **B1ms**. **32 GiB** storage. High availability **off**. Backup **7 days**, geo-redundant
  **off**.
- Authentication: PostgreSQL. Admin name `primaadmin`, with a generated password.
- Networking: **Private access (VNet integration)** into `snet-db`, and let Azure create the private DNS zone. No
  public access and no firewall rules.
- Create the database `prima`.

**E. Key Vault.** `kv-prima-staging`: Standard, **Azure RBAC**, purge protection on. Add three secrets, all using
`sslmode=require` where a database address is involved:
- `db-admin-url`: `postgres://primaadmin:<admin password>@psql-prima-staging-sea.postgres.database.azure.com:5432/prima?sslmode=require`
- `db-api-password`: a new generated password, at least 24 characters
- `db-api-url`: `postgres://prima_api:<that password>@psql-prima-staging-sea.postgres.database.azure.com:5432/prima?sslmode=require`

**F. Image store.** Container Registry `acrprimastaging`, tier **Basic**, admin user **off**.

**G. Files.** Storage account `stprimastagingsea`: Standard **LRS**, public blob access **off**, key access **off**,
minimum TLS 1.2. Add a private container `evidence` for later use.

**H. Website.** Static Web App `swa-prima-staging`, plan **Free**, deployment source **Other**. Write down its
address, `https://<random-name>.azurestaticapps.net`. **This is the staging web address.** Now enter the redirect URI
in section 4.

**I. API environment.** Container Apps environment `cae-prima-staging`, **workload profiles (Consumption only)**,
virtual network `vnet-prima-staging`, subnet `snet-apps`, **external** access, logs to `log-prima-staging`.

**J. Database setup job.** Container Apps job `caj-prima-dbsetup-staging`, in environment `cae-prima-staging`:
- Trigger **manual**, 0.5 vCPU, 1 GiB, timeout 600 s, retries 0.
- System-assigned identity with **AcrPull** on the registry and **Key Vault Secrets User** on the vault.
- Command `node dist/src/db-setup.js`. Environment variables:
  ```
  DATABASE_URL          = secretref:db-admin-url
  PRIMA_API_DB_USER     = prima_api
  PRIMA_API_DB_PASSWORD = secretref:db-api-password
  ENTRA_BOOTSTRAP_LINKS = u-fauzan=<CEO's Entra object ID>
  ```
- The first image comes from the workflow. A public placeholder image is fine when creating the job.

**K. API.** Container App `ca-prima-api-staging`:
- Ingress **external**, HTTPS only, target port **3000**. CPU **0.5**, memory **1 GiB**, scale **min 1, max 2** (one copy always awake, CEO 28 Oct).
- System-assigned identity with **AcrPull** and **Key Vault Secrets User**.
- Environment variables (all IDs are public):
  ```
  DATABASE_URL        = secretref:db-api-url
  ALLOW_DEV_LOGIN     = false
  ENTRA_TENANT_ID     = <Directory (tenant) ID>
  ENTRA_SPA_CLIENT_ID = <Application ID of Prima Secure App - Staging>
  ENTRA_API_CLIENT_ID = <Application ID of Prima Secure API - Staging>
  ENTRA_SCOPE         = access_as_user
  WEB_ORIGIN          = https://<the website address from step H>
  ```
- Arisha settings, needed only once Arisha is approved and built: `ARISHA_ENABLED=false` (the default; Arisha shows
  "not connected"), `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` and `AZURE_OPENAI_API_VERSION`. There is no API
  key: the API's identity gets the **Cognitive Services OpenAI User** role on the Azure OpenAI resource (step N).
- `DEV_TOKEN_SECRET` is **not** set. Set `ENTRA_API_APP_ID_URI` only if the API's Application ID URI is not
  `api://<API application ID>`.

**L. Deployment identity.**
1. In Entra, create an app registration `prima-github-deploy-staging` with a **federated credential** for this
   GitHub repository (`fauzan4377/prima-secure-app`), entity type **Branch**, branch **main**. The subject is
   `repo:fauzan4377/prima-secure-app:ref:refs/heads/main`. It has no client secret. Do not add any other federated
   credential: this is what stops a run from any other branch, or a changed copy of the workflow, reaching Azure.
2. Give it **Contributor** on `rg-prima-staging-sea` only, and **AcrPush** on the registry.
3. In GitHub, check **Settings → Collaborators**: the CEO's account `fauzan4377` must be the only person with write
   or admin access. Anyone added later with write access must be approved by the CEO, because write access lets a
   person change the workflow through a merged pull request.
4. Add these repository variables. They are not secrets:
   - `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
   - `AZURE_RESOURCE_GROUP` = `rg-prima-staging-sea`
   - `AZURE_ACR_NAME` = `acrprimastaging`
   - `AZURE_API_APP` = `ca-prima-api-staging`
   - `AZURE_DB_SETUP_JOB` = `caj-prima-dbsetup-staging`
   - `AZURE_STATIC_WEB_APP` = `swa-prima-staging`

**M. Merge order, approval gate and first deployment (after the CEO approves).**

*Why there is no GitHub "required reviewer" click.* This repository is private. GitHub offers required reviewers on
environments only for public repositories on GitHub Free, Pro and Team [8]; private repositories need GitHub
Enterprise. The repository stays private. Instead, the workflow enforces the CEO's approval three ways:
1. The deploy job runs only when it is started, or re-run, by the CEO's own GitHub account (`fauzan4377`) on `main`.
   Anyone else's run, or a run on another branch, skips the deploy job; only the tests run.
2. The person starting it must type **DEPLOY STAGING** in the run form.
3. Azure issues a sign-in token only to runs on `main` of this repository (step L), so even a changed copy of the
   workflow on another branch cannot reach Azure.

*Merge order.* GitHub can only start a hand-run workflow once the workflow file is on the default branch (`main`) [9].
1. The CEO merges PR #11 (Microsoft sign-in) into `main` after its checks pass on its latest commit.
2. PR #13 is then pointed at `main`, brought up to date, and its checks must pass again on that new commit.
3. The CEO merges PR #13. Only now does *Deploy staging* appear under Actions. Merging does not deploy anything.

*First deployment.* In GitHub, go to Actions → *Deploy staging* → *Run workflow*, branch **main**, type
**DEPLOY STAGING**. Then:
1. The tests run.
2. The deploy job starts only for the CEO's account, on `main`, with the typed words.
3. It builds and pushes the API image, tagged with the commit.
4. It runs the database setup job and stops if the job fails.
5. It updates the API.
6. It builds and publishes the website.
7. It runs `scripts/staging-smoke.sh`, which **fails the run** unless the API answers, the API's own database login
   can read the staff table, Microsoft sign-in is on and test sign-in is off.

*Gate test, before the first real deployment.* With the Azure resources in place, the IT Lead and the CEO check:
(a) a run with the wrong words skips the deploy job; (b) a run started from another branch skips the deploy job; (c)
the deployment identity has only the one `main` credential in Entra.

*Rollback.*
- **API:** every image is kept in the registry under its commit. To go back, run
  `az containerapp update -n ca-prima-api-staging -g rg-prima-staging-sea --image acrprimastaging.azurecr.io/prima-api:<previous commit>`,
  or reactivate the previous revision in the portal (Container App → Revisions).
- **Website:** revert the commit on `main` through a pull request and run *Deploy staging* again.
- **Database:** the setup job never changes or deletes existing data, so a code rollback needs no database step.
  If data itself goes wrong, use point-in-time restore to a new server (the same steps as the restore drill, test
  16), check it, then point the `db-admin-url` and `db-api-url` secrets at it.

*Azure checks before the first deployment* (the local tests are good evidence, but they are not Azure):
- The setup job's first run succeeds and its log shows "created a clean slate". This proves the private network,
  the private DNS zone and the administrator login.
- `/api/health` answers `{"ok":true}`. This proves the `prima_api` login over the private network and that it can
  read staff accounts.
- Test 9 (company wall) passes with real sign-ins, which proves the `prima_app` company wall on Azure.
- Test 1 passes. This proves the API can reach Microsoft's signing keys over the internet.
- The database has no public address (test 17).

**N. Arisha's AI (later, only after the CEO approves it).** Create an **Azure OpenAI** resource in Southeast Asia, or
the nearest region that offers the chosen model, and deploy the model. Give the API's identity
(`ca-prima-api-staging`) the **Cognitive Services OpenAI User** role on it. Then set the four Arisha settings in
step K and turn on `ARISHA_ENABLED`. Only the CEO gets Arisha's record tools; everyone else gets plain help. It is
charged per use, so it gets its own quote first.

### Linking and unlinking accounts later
The database has no public address, so links are made through the setup job or a one-off run of the same image:
- **Link:** add `u-…=<object ID>` to `ENTRA_BOOTSTRAP_LINKS` and start the job again. Existing links are never
  changed.
- **Unlink (someone leaves):** first block the person in Entra, which stops new sign-ins within about an hour. Then
  start a one-off job run with the command `node dist/src/entra-link.js <u-id> --unlink --by "<IT Lead name>"`. The
  link is removed at once.
- Every link and unlink is written to the audit chain with who did it.

---

## 6. Staging test checklist (UAT), with owners

| # | Test | Expected | Owner |
|---|---|---|---|
| 1 | CEO opens the staging address and signs in with Microsoft | MFA, then the confidentiality rule, then the CEO home screen | CEO |
| 2 | Account from another Microsoft tenant | Stopped by Microsoft (single tenant) | IT Lead |
| 3 | Token meant for another app (wrong audience) | API refuses | Automated (PR #11); IT Lead spot check |
| 4 | Token issued to another client app (`azp`) | API refuses | Automated |
| 5 | Token without `access_as_user` | API refuses | Automated |
| 6 | Account in the tenant but **not assigned** to the app | Stopped by Microsoft | IT Lead |
| 7 | Assigned but **not linked** | "Not linked to a Prima staff record yet", with the account ID shown | IT Lead |
| 8 | Linked, but not a pilot user | "Not part of the pilot yet" | IT Lead |
| 9 | A pilot user tries another company's records | Refused (company wall) | ACT head |
| 10 | Test sign-in | No person picker; test tokens refused; API will not start if it is switched on | IT Lead |
| 11 | Sign out, then press Back | Sign-in screen, no data | CEO |
| 12 | Idle over an hour, then use | Token renews silently, or Microsoft asks to sign in again | IT Lead |
| 13 | First visit after 15 quiet minutes | Opens within a few seconds (one API copy is kept awake) | CEO + IT Lead |
| 14 | 11 users at once for 10 minutes | Pages open within a few seconds; no database connection errors in the logs | IT Lead |
| 15 | Monitoring | Sign-in errors visible in Log Analytics; budget alert at 50% received | IT Lead |
| 16 | Restore drill | Restore the database to a temporary server, check it opens, delete it | IT Lead + ACT head |
| 17 | Database reachable from the internet? | No: the server has no public address | ACT head |
| 18 | *Deploy staging* run with the wrong words, or from another branch | Deploy job skipped; nothing changes in Azure | IT Lead + CEO |
| 19 | Rollback drill: put the previous API image back | Previous version answers; the smoke check passes | IT Lead |

The ACT head reviews the results and signs off before the CEO decides anything beyond staging.

---

## 7. CEO decisions

Already decided on 28 Oct, **for staging only**: about RM 150 a month was approved, there is no second-region backup,
the deployment code may be written, and the API stays awake (one copy always running). The always-on API brings the
**estimate** to about RM 175 to 230, which is not yet a quotation. These choices do not carry over to live use.

Before any real staff or company data goes in (not part of staging): an independent off-site export of the database,
a privacy (PDPA) review, and a fresh CEO decision on backups and cost.

Still needed before anything is bought:
1. Approve the Pricing Calculator quote from the IT Lead (section 1), with one API copy always running.
2. Merge PR #11, then PR #13, each only after its checks pass on its latest commit (step M). Merging deploys nothing.
3. Approve the first run of *Deploy staging*.

---

**Sources** (checked 28 Oct 2026):
- [1] [Bytebase price table, Azure Flexible Server B1ms](https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/): Southeast Asia USD 19 a month, updated 26 Oct 2026.
- [2] [c3x.dev, PostgreSQL Flexible Server cost](https://c3x.dev/blog/azure-postgresql-flexible-server-cost/): storage about USD 0.115 per GiB-month.
- [3] [Microsoft Learn, PostgreSQL backup and restore](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore).
- [4] [Microsoft Learn, Container Apps billing](https://learn.microsoft.com/azure/container-apps/billing): free allowance of 180,000 vCPU-s, 360,000 GiB-s and 2 million requests a month, and no charge at zero copies. Rates from [DevZero, Container Apps pricing](https://www.devzero.io/blog/azure-container-apps-pricing).
- [5] [c3x.dev, Container Registry cost](https://c3x.dev/blog/azure-container-registry-cost/): Basic about USD 5 a month.
- [6] [ManageEngine, Azure Monitor pricing](https://www.manageengine.com/it-operations-management/blog/azure-monitor-pricing.html): 5 GiB a month free, then about USD 2.30 per GiB.
- [7] [Microsoft Learn, Static Web Apps plans](https://learn.microsoft.com/en-us/azure/static-web-apps/plans).
- [8] [GitHub Docs, deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments): required reviewers on private repositories need GitHub Enterprise.
- [9] [GitHub Docs, triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow): `workflow_dispatch` needs the workflow on the default branch.
