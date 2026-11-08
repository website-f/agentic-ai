# Mail and Power BI Connections modules (PROPOSED, aligned to Connections V2)

**Status, 31 Oct 2026:** draft PR #39. Stacked on the Connections V2 candidate (`docs/CONNECTIONS_V2_EXTENSION.md`, PR #37 head 722f398, explicit action capabilities and `cancel()`/`fail()`), so the PR base is PR #37's branch. Not merged, not registered, not deployed. No secrets, consent, Azure/Entra changes, migrations, live mail or charges. All tests are synthetic with mocked Microsoft Graph and Power BI.

> **Decision, Fauzan, 31 Oct 2026 10:24Z (approvals item 1, option B):** staff keep sending email from **Outlook**. Prima does **not** ship a Send feature; it will check or pull emails read-only instead. The Mail send code below is **held, switched off and unregistered** (not deleted) pending the scope decision on which emails Prima may read (asked in the coordination thread: only emails staff link to a job, Sent Items to approved domains, or the whole mailbox). No read or pull is designed or built until that answer. Power BI is unchanged.


Requested by Arisha main (email 31 Oct 2026, 05:41Z) for Fauzan's Phase 1 readiness. Per the V2 contract, the shared Connections screen, `contract/registry/session.ts`, SharePoint, auth, navigation, dependency manifests, `http.ts`, `AppModule` and CI belong to the Connections owner. This change touches none of them; registration is a proposed diff below.

## Files (all within the Claude-owned paths in the V2 contract)

| Path | Purpose |
| --- | --- |
| `apps/api/src/connections-mail/delegated.ts` | Fixed-tenant on-behalf-of (OBO) for exactly one scope, linked-identity check, bounded JSON, per-request scoped actor. Mirrors the SharePoint rules without editing `connections.ts`. |
| `apps/api/src/connections-mail/staff-email.ts` | Compose, review, explicit Send from own mailbox. |
| `apps/api/src/connections-mail/ledger.ts` | Draft ledger interface and the in-memory (non-durable) ledger. |
| `apps/api/src/connections-mail/ledger-v1.sql`, `pg-ledger.ts` | **Proposed** durable PostgreSQL ledger `prima.staff_email_drafts` (needs review and the CEO-run migration). |
| `apps/api/src/connections-mail/controllers.ts` | `/api/connections/mail` routes; `mailConnectionsModule(ledger)` for registration. |
| `apps/api/src/connections-powerbi/power-bi.ts` | Approved-report allowlist and authenticated secure embed. |
| `apps/api/src/connections-powerbi/controller.ts` | `/api/connections/powerbi` routes; `powerBiConnectionsModule()` for registration. |
| `apps/web/src/connections/mail/adapter.ts`, `panel.tsx` | `Adapter` for `serviceId: 'mail'`; `mailAdapter(mailClient(transport))`. |
| `apps/web/src/connections/powerbi/adapter.ts`, `panel.tsx` | `Adapter` for `serviceId: 'powerbi'`; `powerBiAdapter(powerBiClient(transport))`. |
| `apps/api/test/staff-email.test.ts`, `staff-email-pg-ledger.test.ts`, `power-bi.test.ts`, `scripts/connections-mail-powerbi.test.mjs` | Synthetic tests, no network; the ledger test needs a disposable local PostgreSQL. |
| `scripts/connections-mail-powerbi-browser.mjs` | Interactive Playwright tests of both modules inside the real `ConnectionCard` shell, StrictMode, 1440px and 390px. |

## Contract conformance

- **Server-bound identity:** every status, check and embed response carries server-set `serviceId` and `userId`; check evidence binds the exact `resourceKey`/`reportKey` and a point-in-time `checkedAt`. Adapters copy those values and never stamp a client ID. The shell's own user/service/resource checks reject mismatches (tested).
- **Not configured until verified:** `NotConfigured` (reason `ConfigurationMissing`) by default; `ConfiguredNotVerified` never means connected; no approved resources means `NoApprovedResources` with no capabilities.
- **Explicit action capabilities (722f398):** Mail advertises `['checkAccess', 'composeSend']` and declares `panelCapability: 'composeSend'`. Power BI advertises `['checkAccess', 'viewReport']` and declares `viewReport`, because it only opens the report in the Power BI service through a labelled external link; it will declare `embedReport` only when in-app embedding is built. Neither ever advertises `readMetadata`. The pre-722f398 shell refuses both (tested), so they fail closed rather than mounting as read-only.
- **The access check is not proof of sending:** the Mail check returns `proves: 'DelegatedTokenOnly'`, and the adapter refuses any other claim. Microsoft's answer to Send is the only proof the mailbox can send.
- **No read on mount; cancel vs fail:** panels make requests only on button presses and take the shell's `AbortSignal`. A provider error or a response for the wrong user calls `fail()`. "Stop waiting" / "Cancel request" call `cancel()` (neutral note, late answers discarded); for Mail the panel says stopping does not recall a sent message and points to "Find my recent drafts". Tokens never reach props, storage or logs.
- **Explicit, independently authorised reads:** every API call re-reads the user through `Db.asUser` (offboarded accounts refused), requires request-local verified Entra evidence matching the current object-ID link, and re-checks the allowlist. Query parameters are refused.

## Mail (`/api/connections/mail`)

| Route | Body | Result |
| --- | --- | --- |
| `GET /` | none | `{ serviceId, userId, status, canCompose, resources: [{ key: 'own-mailbox', name }], recipientDomains }`. No provider call. |
| `POST /own-mailbox/check` | none | OBO token check for `Mail.Send` only → `{ serviceId, userId, status: 'VerifiedForCurrentUser', resourceKey, checkedAt }`. Sends and reads nothing. Any other resource key is refused. |
| `POST /drafts` | `{ to[], cc[], subject, body }` | New draft (`Draft`) with `contentHash`. |
| `GET /drafts` | none | Up to 20 of the caller's recent drafts, newest first, for recovery after a reload, lost response or account switch. |
| `GET /drafts/:id` | none | Own drafts only. |
| `POST /drafts/:id/edit` | `{ to[], cc[], subject, body }` | Edit while `Draft` or `Failed`. (POST because the shared client has GET/POST only.) |
| `POST /drafts/:id/discard` | none | `Discarded`. |
| `POST /drafts/:id/send` | `{ reviewedHash }` | The explicit Send → `{ draft, alreadyHandled }`. |
| `POST /drafts/:id/resolve` | `{ sentItems: 'found' \| 'not-found' }` | After checking Outlook Sent Items: `found` → `Accepted`; `not-found` is recorded but the draft **stays locked** (`Uncertain`). |

- **Own mailbox only:** delegated `Mail.Send` via OBO, `POST https://graph.microsoft.com/v1.0/me/sendMail`. A returned extra or broader scope (`Mail.Read`, `Mail.Send.Shared`, `Mail.ReadWrite`, `.default`) fails closed.
- **Outside recipients denied by default:** To and Cc must each be in `STAFF_EMAIL_RECIPIENT_DOMAINS`, checked on create, on every edit and **again at Send** against the current setting (a domain removed after review blocks the send). Open mode only by setting `*` explicitly.
- **Bound to the Microsoft identity:** each draft records the owner's Prima user, Entra tenant and object ID, and the review hash covers them with the content. Send refuses a draft written under a different Microsoft account (`identityMatches: false`); saving it again under the current account re-binds it with a new hash and a `rebound` event, so it must be reviewed again.
- **No inbox reading, automatic replies, attachments, bcc or HTML.** Plain text; up to 10 To + 10 Cc; subject 200, body 20,000 characters; header injection refused.
- **Review before Send:** Send must quote the `contentHash` of the reviewed content.
- **No duplicate sends:** Send is a compare-and-set `Draft/Failed → Sending`; repeat, double or concurrent presses get `alreadyHandled: true` and no Graph call. The client never retries.
- **No blind retry:** 202 → `Accepted` (shown as "Accepted by Microsoft for delivery", never as delivered); 429 → `Failed` with `retryNotBefore` from `Retry-After` (delta-seconds or IMF-fixdate; any valid value honoured in full, never shortened; missing or unparseable → 60 s) and Send refused until then; other 4xx or failed token exchange → `Failed` (may press again); timeout, dropped connection, 5xx or anything else → `Uncertain`, locked, never retried. `X-Prima-Draft-Id` header helps find it in Sent Items. A `Sending` row whose outcome could not be recorded can be reported after five minutes.
- **"Not in Sent Items" never unlocks:** the original request may still complete, so `not-found` keeps the draft `Uncertain` (a stale `Sending` becomes `Uncertain`) and it is never sent again. To send the message anyway, the person uses "Start a new draft from this": a new draft id, a new review and a new explicit Send, with a warning that it may arrive twice. Only `found` settles a lock (→ `Accepted`).
- **Readiness gate on every call:** Mail is `NotConfigured`, and every action is refused, unless the settings are complete **and** `ledger.readiness()` passes on that call. The PostgreSQL gate reads `pg_catalog` only (works from the restricted API login) and requires: the table exists; marker `prima-staff-email-ledger v1`; exact columns and types; RLS enabled and forced; exactly one policy, `own_drafts`, with the exact owner expression; `prima_app` not superuser and not BYPASSRLS; `prima_app` has SELECT, INSERT and UPDATE and none of DELETE, TRUNCATE, REFERENCES or TRIGGER; the API login can `SET ROLE prima_app`. A failed or unreachable check is never treated as ready.
- **Arisha cannot send** (tested: no Arisha module references these modules).
- **Durable ledger needed before live use.** The in-memory default reports `durable: false` and keeps Mail `NotConfigured` even with every setting present. The durable ledger is written and tested but **not applied**; see below.

### Proposed table (needs review and the CEO-run migration; NOT applied)

**Versioned module migration, v1:** `apps/api/src/connections-mail/ledger-v1.sql`. The main `001_init.sql` schema fingerprint does not cover it, so it has its own version: the file ends with `COMMENT ON TABLE prima.staff_email_drafts IS 'prima-staff-email-ledger v1'`, its SHA-256 is pinned in `pg-ledger.ts` (`STAFF_EMAIL_LEDGER_SHA256 = 5c5e11cd…cb39f6e`, tested), and the readiness gate above checks the marker and structure. Any change must be a new `ledger-v2.sql` with a new marker and pin. The owner adds it to the CEO-run migration as a named, versioned step (proposed name `module_staff_email_ledger_v1`, recording the pinned SHA-256); the API never applies it.

```sql
CREATE TABLE prima.staff_email_drafts (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('Draft','Sending','Accepted','Failed','Uncertain','Discarded')),
  version int NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,              -- full draft: tenant, OID, content, hash, retryNotBefore, events
  CHECK (data->>'id' = id::text AND data->>'ownerUserId' = owner_user_id AND data->>'state' = state AND (data->>'version')::int = version)
);
CREATE INDEX ON prima.staff_email_drafts (owner_user_id, updated_at DESC);
ALTER TABLE prima.staff_email_drafts ENABLE ROW LEVEL SECURITY; ... FORCE ROW LEVEL SECURITY;
CREATE POLICY own_drafts ... USING (owner_user_id = current_setting('app.user_id', true)) WITH CHECK (same);
REVOKE ALL ...; GRANT SELECT, INSERT, UPDATE ... TO prima_app;   -- no DELETE for the app
```

- `PgEmailLedger(pool)`: every call runs in a transaction as `prima_app` with `app.user_id` set to the owner; `transition` is `UPDATE … WHERE id = $1 AND version = $2`, so exactly one of several workers or restarts wins the `Draft/Failed → Sending` claim.
- Retention: `PgEmailLedger.purge(adminPool, before)` (privileged, scheduled by the owner) deletes `Draft`, `Accepted`, `Failed` and `Discarded` rows older than the cut-off and never `Sending` or `Uncertain`. Retention period is a Fauzan/PDPA decision; none is set.
- Tests (`staff-email-pg-ledger.test.ts`, local disposable PostgreSQL only): survives a restart; another user cannot read, spoof-insert, update or delete a draft; six concurrent workers produce one Graph call; a crash after the claim stays locked even after a not-found report; `Uncertain` survives restarts and is never resent; retention keeps locked rows; the v1 file pin; the readiness gate refuses 11 broken setups (wrong or missing marker, extra column, RLS not forced or disabled, extra or loosened policy, DELETE or TRUNCATE granted, UPDATE revoked, table missing) plus an unreachable database; and the full flow through a **restricted login** (`NOSUPERUSER NOBYPASSRLS`, `prima_app` granted `WITH INHERIT FALSE, SET TRUE` as in `db-setup.ts`), including a 2-hour Retry-After honoured across restarts, with SELECT/DELETE/ALTER/DROP/`SET ROLE postgres` refused both before and after `SET ROLE prima_app`.
- Wiring after the migration: `mailConnectionsModule(new PgEmailLedger(pool))`.

**Grok split:** Arisha main confirmed (07:13Z) that staff-pressed Send of new emails is part of Fauzan's approved design and Grok's separate reply role does not prohibit it; 722f398's card text now says so. No replies and no AI sending. Fauzan has not confirmed this himself in this thread.

## Attach an Outlook email to a job (BUILT in this draft PR, not registered or migrated; Fauzan 31 Oct 2026)

Fauzan's decisions: staff send from Outlook (10:24Z, option B); Prima reads **only the Outlook emails a staff member attaches to a job** (10:26Z); copies are kept **30 days** (10:34Z, item 8a); he wants the table in Monday's release if Arisha main agrees (item 8b). Arisha main agreed the design 10:41Z (IT jobs first, preview then Attach, no AI reading, no file attachments, Send inactive). **Fauzan 11:02Z:** (1) yes, Arisha main may grant delegated `Mail.Read` and create `JOB_EMAIL_OBO_CLIENT_SECRET`, to be tried on Monday; (2) no notice telling staff who will see an attached email is needed. The panel never had one; it only says Prima reads the one pasted email and keeps a copy for 30 days. Nothing is granted or created from this PR.

**Flow:** on a job the person may act on, they open the email in Outlook on the web, copy its link and paste it into **Outlook emails on this job**. **Preview this email** reads that one message from their **own** mailbox (`GET /me/messages/{id}`, explicit `$select`, plain text) and shows it; nothing is stored. **Attach to this job** re-reads it, refuses if it changed since the preview, and stores a copy: subject, from, to, cc, sent/received time, plain-text body (first 50,000 characters), whether it has files, the Outlook link and `internetMessageId`. Files and inline images are **not** copied. The same email cannot be attached twice to one job. Everyone who may view the job sees the copy; only the person who attached it may **Remove from this job** (the copy is erased, a stub stays, Outlook is never changed). After **30 days** the copy is hidden on every read and erased by the retention job; the stub (who, when, **Open in Outlook** link) stays.

**Never:** list, search, folders, `$filter`/`$search`/`$expand`, delta or subscriptions, attachments, other people's or shared mailboxes, sending, automatic matching, or Arisha reading these emails (tested).

| File | Purpose |
| --- | --- |
| `apps/api/src/connections-mail/job-email.ts` | Service: link parsing, one-message read, preview/attach/list/remove, 30-day view rule, `JobEmailAccess` port (default deny). |
| `apps/api/src/connections-mail/job-email-store.ts`, `pg-job-email-store.ts` | Store interface, in-memory store (keeps it NotConfigured), PostgreSQL store with readiness gate and `eraseExpired`. |
| `apps/api/src/connections-mail/job-email-v1.sql` | **Versioned module migration v1** (SHA-256 `3d710e97…662c7914`, pinned and tested), including the database job rule `prima.job_email_job_access`. |
| `apps/api/src/connections-mail/it-job-access.ts` | The IT job rule for the API (`itJobEmailRule`, `itJobEmailAccess(getJob)`); must match the SQL function, tested on the same people and jobs. |
| `apps/api/src/connections-mail/controllers.ts` | `JobEmailController` and `jobEmailModule(store, access)`. |
| `apps/web/src/connections/mail/job-emails.tsx`, `job-emails-client.ts` | The job-screen panel and its validating client. |
| `apps/api/test/job-email.test.ts`, `job-email-pg.test.ts`, `scripts/job-emails-browser.mjs` | Unit, PostgreSQL and interactive browser tests. |

**API (`/api/connections/mail/jobs`):** `GET status`; `POST :jobId/emails/preview { outlookLink }`; `POST :jobId/emails { outlookLink, previewHash }`; `GET :jobId/emails`; `POST :jobId/emails/:id/remove`. Accepted links: `https://outlook.office.com/…/id/<id>` or `…?ItemID=<id>` (also `outlook.office365.com`). The exact Outlook link format must be confirmed on the live tenant before go-live; if Outlook's ID differs from the Graph ID, `translateExchangeIds` would be added.

**Permission:** delegated Graph **`Mail.Read`**, one scope, on behalf of the signed-in person; anything broader or extra fails closed (`Mail.ReadWrite`, `Mail.Read.Shared`, `Mail.Send`, `.default`). Microsoft has no per-message permission, so the scope technically covers the person's own mailbox; the code requests only the single message ID from the pasted link. `Mail.ReadBasic` is not enough (no body). **`Mail.Send` is no longer requested.** Settings: `JOB_EMAIL_ENABLED=true`, `JOB_EMAIL_OBO_CLIENT_SECRET` (Key Vault), existing `ENTRA_TENANT_ID` / `ENTRA_API_CLIENT_ID`.

**Job permission, checked in the API and again in the database (Arisha main, 31 Oct 2026):** IT jobs first. Attach: the assignee, the person who gave the job, the IT Manager, the IT Lead and the COO, while the job is not cancelled. View (and remove one's own): those plus the CEO, ACT and HR / Chief of Staff, who only look. Integration and closed accounts, unknown people and unknown jobs: nothing. The API side is `itJobEmailAccess(getJob)` (the `JobEmailAccess` port; the default still denies everything until the owner wires it). The database side is `prima.job_email_job_access(job, need)`, a `SECURITY DEFINER` function that reads its own `prima.users` and `prima.it_jobs` rows; every policy calls it, so an API mistake that says yes still reads and writes nothing (tested with a deliberately too-loose API). A test runs both rules for 14 people x 4 jobs x 2 needs and requires they agree.

**Table `prima.job_email_attachments` v1** (`job-email-v1.sql`; needs review and the CEO-run migration, proposed step `module_job_email_attachments_v1`):

```sql
id uuid PK, job_id text, attached_by text, internet_message_id text,
attached_at timestamptz, expires_at timestamptz CHECK (expires_at <= attached_at + interval '30 days'),
removed_at timestamptz NULL, data jsonb  -- copy + identity binding + events; data columns must match
UNIQUE (job_id, internet_message_id) WHERE removed_at IS NULL
-- guard trigger: the only allowed change is removal (once) or erasing the copy after expiry
RLS forced: job_read  SELECT USING job_id = app.job_email_job AND job_email_job_access(job_id,'view')
            job_attach INSERT CHECK job_id = app.job_email_job AND attached_by = app.user_id AND job_email_job_access(job_id,'attach')
            job_remove UPDATE USING/CHECK job_id = app.job_email_job AND attached_by = app.user_id AND job_email_job_access(job_id,'view')
prima.job_email_job_access(job text, need text): SECURITY DEFINER, STABLE, search_path pinned, EXECUTE for prima_app only (not PUBLIC)
prima_app: SELECT, INSERT, UPDATE only (no DELETE); COMMENT 'prima-job-email-attachments v1'
```

RLS shows only the one job of the request, and only if the database's own job rule allows the person. **Readiness gate** (every call, pg_catalog only): marker, exact columns, forced RLS, exactly the three policies, the job rule function unchanged (md5 of its body pinned), SECURITY DEFINER with pinned search_path and no PUBLIC execute, guard trigger enabled, unique index, `prima_app` not superuser/BYPASSRLS with exactly SELECT/INSERT/UPDATE, login can `SET ROLE prima_app`. Any failure keeps it NotConfigured. **Retention:** `PgJobEmailStore.eraseExpired(adminPool, now)` from a privileged daily job (owner schedules).

**Registration (owner):** `jobEmailModule(new PgJobEmailStore(pool), itJobEmailAccess(id => store.get('itJobs', id)))` in AppModule; mount `<JobEmails client={jobEmailClient(api.connectionsCall)} userId jobId />` on the IT job screen; CI lines `node scripts/job-emails-browser.mjs` (and the API tests run with the existing suite).

**Send path:** held, unregistered, not deleted (option B).

## Power BI (`/api/connections/powerbi`)

| Route | Body | Result |
| --- | --- | --- |
| `GET /` | none | `{ serviceId, userId, status, reports: [{ key, name }] }` for reports this user may open. No provider call. |
| `POST /:reportKey/check` | none | Checks the report with the user's own token → `{ serviceId, userId, status: 'VerifiedForCurrentUser', reportKey, checkedAt }`. |
| `POST /:reportKey/embed` | none | Same checks, plus `embedUrl` (authenticated `app.powerbi.com/reportEmbed`), `tokenType: 'Aad'`, `tokenScopes`, `openInService { url, label }`. |

- **User-owns-data only:** the viewer's own identity, so workspace permissions and dataset **RLS stay in force**. No `GenerateToken`, service principal or master user.
- **Never Publish to web:** server and client both refuse `/view?r=`, foreign hosts, ports, extra parameters, mismatched report/workspace IDs, and config keys such as `publishToWebUrl`, `embedToken` or `servicePrincipal`.
- **No tokens from the API;** the client also rejects a response carrying one.
- Every embed answer must be for the signed-in user and the selected report (server and client), or it is not shown and the card fails.
- The panel shows the clearly labelled **"Open in Power BI (opens the Power BI service, not part of Prima)"** link and states that the report is not shown inside Prima yet. In-app rendering needs the `powerbi-client` package and the SPA's own MSAL token for `Report.Read.All`, both shared-file changes for the Connections owner.
- A user sees a report only when listed in `allowedUserIds` and able to see **all** mapped `companyIds`.

## Proposed registration diff (for the Connections owner; NOT applied)

```diff
// apps/api/src/app.module.ts
+import { mailConnectionsModule } from './connections-mail/controllers';
+import { powerBiConnectionsModule } from './connections-powerbi/controller';
+import { PgEmailLedger } from './connections-mail/pg-ledger';
+const mail = mailConnectionsModule(new PgEmailLedger(pool)); // only after ledger.sql is migrated
+const powerBi = powerBiConnectionsModule();
-  controllers: [..., ConnectionsController, ItExtractionController],
-  providers: [Db, { provide: SharePointConnections, ... }],
+  controllers: [..., ConnectionsController, ...mail.controllers, ...powerBi.controllers, ItExtractionController],
+  providers: [Db, { provide: SharePointConnections, ... }, ...mail.providers, ...powerBi.providers],

// apps/web/src/api/http.ts — expose the existing authenticated call for adapters
+  connectionsCall: ConnectionsTransport = (method, path, body, signal) => this.call(method, path, body, signal);
// (demo.ts: return NotConfigured status for /connections/mail and /connections/powerbi)

// apps/web/src/views/Connections.tsx
+import { mailAdapter } from '../connections/mail/panel';
+import { mailClient } from '../connections/mail/adapter';
+import { powerBiAdapter } from '../connections/powerbi/panel';
+import { powerBiClient } from '../connections/powerbi/adapter';
-  createRegistry([sharePointAdapter(api)])
+  createRegistry([sharePointAdapter(api), mailAdapter(mailClient(api.connectionsCall)), powerBiAdapter(powerBiClient(api.connectionsCall))])

// .github/workflows/ci.yml
-      - run: node --test scripts/connections-state.test.mjs scripts/connections-v2.test.mjs
+      - run: node --test scripts/connections-state.test.mjs scripts/connections-v2.test.mjs scripts/connections-mail-powerbi.test.mjs
+      - run: node scripts/connections-mail-powerbi-browser.mjs   # Playwright, synthetic only
// CEO-run migration: add versioned step module_staff_email_ledger_v1 = apps/api/src/connections-mail/ledger-v1.sql (pinned SHA-256)
```

## Setup prerequisites (each needs separate human approval; none done)

**Job emails (approved by Fauzan 31 Oct 2026 11:02Z for Arisha main to do on Monday, not done from this PR):** delegated Graph `Mail.Read` on the API registration with admin consent, `JOB_EMAIL_OBO_CLIENT_SECRET` in Key Vault, `JOB_EMAIL_ENABLED=true`, after the CEO-run migration of `job-email-v1.sql` and the owner's wiring. The Send-path settings below stay unused (option B).

| Variable | Purpose |
| --- | --- |
| `STAFF_EMAIL_ENABLED` | Exactly `true` to enable. |
| `STAFF_EMAIL_OBO_CLIENT_SECRET` | Confidential API credential for OBO (Key Vault only). |
| `STAFF_EMAIL_ALLOWED_USER_IDS` | Comma list of Prima user IDs allowed to send. No wildcard. |
| `STAFF_EMAIL_RECIPIENT_DOMAINS` | **Required** comma list of approved recipient domains (for example `pwvsb.com`), max 50. Missing or empty keeps Mail **NotConfigured**. Open sending to any domain only with the explicit value `*` on its own (`*` mixed with domains, or `*.x`, is refused). Exact match only: subdomains and look-alikes are refused. Each outside domain (client, auditor, regulator) must be approved by name. |
| `POWERBI_CONNECTION_ENABLED` | Exactly `true` to enable. |
| `POWERBI_OBO_CLIENT_SECRET` | Confidential API credential for OBO (Key Vault only). |
| `POWERBI_APPROVED_REPORTS_JSON` | `[{ key, name, workspaceId, reportId, companyIds, allowedUserIds }]`, max 30, GUIDs only, no URLs. |
| `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID` | Existing values, reused. |

Entra: on the API registration add delegated Graph **`Mail.Send`** and Power BI Service **`Report.Read.All`**; on the SPA registration add **`Report.Read.All`** (for in-app embed later). Admin consent only after approval. No `Mail.Read`, `Mail.ReadWrite`, `Mail.Send.Shared` or application permissions. IT should review mailbox auditing and outbound DLP.

Exchange: each sender needs an Exchange Online mailbox. The check proves the token, not the mailbox; the first Send proves the mailbox. Exchange per-mailbox sending limits apply.

**Who gets Power BI (Fauzan, 31 Oct 2026):** only people Fauzan authorises receive a Power BI licence, not every staff member. Usually a department head or manager; **not** company heads. `allowedUserIds` in `POWERBI_APPROVED_REPORTS_JSON` must list only those licensed, authorised people; everyone else sees no reports and no Power BI panel.

Power BI licensing and tenant (**cost**): each viewer needs **Pro or Premium Per User**, unless the workspace is on **Premium (P SKU) or Fabric F64+** capacity. Tenant setting **"Embed content in apps"** on (scoped to a group); **"Publish to web"** off. Viewers get the Viewer role (RLS does not apply to Admin/Member/Contributor) and are mapped to the dataset RLS roles. Report list and company mapping need sign-off (Finance Director for finance reports). Confirm current Microsoft pricing before committing.

## Test results (local, 31 Oct 2026, with job emails)

- `npm run typecheck`: clean.
- API (`node --test`, disposable local PostgreSQL 16, `DEV_TOKEN_SECRET=ci-only`): 213/213 at 7705356 (job permission checked in API and DB), including 37 Mail/Power BI/ledger tests and 17 job email tests (10 unit with Graph mocked, 7 on PostgreSQL incl. RLS by job, the change guard, concurrency, 30-day erasure, the readiness gate with 10 broken setups and the restricted login).
- `node --test scripts/*.test.mjs`: 85/85 (Mail/Power BI adapters 9/9 against the real 722f398 session).
- Browser (`scripts/connections-mail-powerbi-browser.mjs`, Chromium): 22/22 steps (11 at 1440px, 11 at 390px), including not-found keeping the draft locked and "Start a new draft from this" creating a new draft rather than resending, no page errors, no request outside the local server.
- Core (`vitest`): 324/324 locally; CI may still hit the known Vitest worker timeout fixed in PR #38.
- Job emails browser (`scripts/job-emails-browser.mjs`): 16/16 steps (8 at 1440px, 8 at 390px), no page errors, no outside requests.
- `npm run demo:build`: builds.

## Still open

- Superseded: Fauzan chose option B (send in Outlook; Prima checks or pulls read-only); read scope, 30-day keep, Mail.Read for Monday and no staff notice are all decided (31 Oct 2026).
- Review and CEO-run migration of `ledger.sql`; retention period decision.
- Use one shared Microsoft delegated helper once PR #37 exports it (review finding F12), and consider one OBO credential or a federated credential instead of three secrets (F11).
- Registration diff, `powerbi-client` dependency and SPA Power BI scope (Connections owner).
- Business decisions: who may send, which outside domains are approved, which reports for which authorised department heads/managers.
- In-app Power BI embedding (then declare `embedReport`).
- Live tenant validation after consent, with a test mailbox and a test report; human UAT.
