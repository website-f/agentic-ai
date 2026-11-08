# Alerts to Teams and email

Owner decision: staff usability rule 7 (4 November 2026), "Yes" to Teams and email alerts (5 November 2026).

Staff should not have to open Prima just to check for updates. Prima sends each person what is waiting for them,
and they act in Prima. Fauzan, 5 November 2026: alerts show in **Teams, email and inside Prima** (the bell at the
top of every screen). The bell works now; Teams and email are switched on after the Azure setup.

**Status:** built and tested with mock data only. The alerts are **switched off**. They are not deployed, no
Microsoft consent has been given, and the sent-record table has not been migrated.

## What is sent

| Alert | When | To whom | What |
|---|---|---|---|
| Urgent email | Each scheduler run (proposed every 15 minutes, 8 am to 6 pm) | The person | New red items on their own to-do list. Each item is sent once. |
| Daily digest email | Once a day (proposed 8 am) | The person | Everything still waiting on their list: red, amber and for-information items. |
| In-app bell | Always (refreshes every 2 minutes) | The signed-in person | The same items, red first; the badge counts new red items. Each line opens its screen. |
| Teams channel post | Each urgent run | One channel per department | How many new red items of each kind the department has. **Counts only:** no titles, details or names, because everyone in the channel sees the post and channel membership is not a Prima permission. Each item is counted once. |

- Each item comes from the person's own to-do, read with their own permissions: their home screen, or their IT
  jobs and the jobs waiting for their check. Nobody is alerted to check their own work.
- The text is in Bahasa Melayu and never names an AI tool. Item titles appear as they are written in Prima.
- A message lists at most 15 items and counts the rest. It links to the Prima screen when `ALERTS_APP_URL` is set.
- Guards, site devices, connected systems, closed accounts and anyone without a linked Microsoft account get
  nothing. During the pilot, only pilot users get alerts.
- Prima never reads a reply. Approvals and other actions stay in Prima.

## Never sent twice

Before anything is sent, each alert is claimed in `prima.alert_deliveries` (`apps/api/src/alerts/alerts-ledger-v1.sql`).
The claim is a SHA-256 of the channel, the person and the item, so the table holds no names, addresses or item text.
Two runs, or two API copies, cannot send the same alert. A failed send gives the claim back, and the next run tries
again.

## Settings (all required for a channel; any gap keeps it off)

| Setting | Value |
|---|---|
| `ALERTS_ENABLED` | `true` |
| `ALERTS_RUN_KEY` | Random secret of at least 32 characters, kept in Key Vault. The scheduler sends it as `X-Alerts-Key`. |
| `ENTRA_TENANT_ID` | `<tenant-id>` (already set for sign-in) |
| `ALERTS_CLIENT_ID` | `<application-id>` of a separate "Prima Alerts" app registration |
| `ALERTS_CLIENT_SECRET` | That app's secret, kept in Key Vault |
| `ALERTS_SENDER_MAILBOX` | The shared alert mailbox, for example `alerts@<company-domain>` |
| `ALERTS_TEAMS_WEBHOOKS_JSON` | `{"it":"<workflow-webhook-url>", "finance":"…"}`. The keys are Prima department names. Only Teams Workflows addresses (`*.logic.azure.com` or `*.environment.api.powerplatform.com`) over https are accepted. Each address carries its own signature, so treat the whole value as a secret and keep it in Key Vault. |
| `ALERTS_APP_URL` | `<prima-web-url>` (optional; adds links) |

## Steps for the Microsoft admin (Fauzan approves each one)

1. Create a shared mailbox for alerts. A shared mailbox needs no licence.
2. Register an app, "Prima Alerts", with Microsoft Graph **application** permissions `Mail.Send` and
   `User.ReadBasic.All`, and give admin consent.
3. Limit `Mail.Send` to the alert mailbox only, using Exchange Online RBAC for Applications (or an application access
   policy). Without this step the app could send as any mailbox, so do not skip it.
4. In each department's Teams channel, add the Workflows template "Post to a channel when a webhook request is
   received". Copy its address into `ALERTS_TEAMS_WEBHOOKS_JSON`.
5. Apply `alerts-ledger-v1.sql` through the reviewed, CEO-run migration.
6. Schedule two calls, for example as an Azure Container Apps job:
   - `POST /api/alerts/run?mode=urgent` every 15 minutes in working hours
   - `POST /api/alerts/run?mode=digest` once at 8 am MYT
7. UAT first: each tester checks the bell in Prima. It shows exactly what email would list. Then switch on for the IT
   pilot only.

## Endpoints

- `POST /api/alerts/run?mode=urgent|digest` with `X-Alerts-Key`. It answers counts only:
  `{mode, people, emails, teamsPosts, nothingToSend, noAddress, failed}`. It answers 503 while alerts are off or the
  sent-record is not installed, and 401 for a wrong key.
- `GET /api/alerts/mine` (signed in): the bell. The person's own items, red first, and whether email and their
  department channel are on. Sends nothing.

## Review, 5 November 2026

Checked for security, privacy, permissions, wording and failure cases. Changed after the review:

- Teams channel posts carry counts by kind only (see above). Titles go only to the person's own email and bell.
- The bell stops asking the server while its browser tab is hidden, and catches up when the person returns.

Known limits, accepted for the pilot:

- An urgent item is emailed once. If the same work closes and comes back with the same title and record, it is not
  emailed again as urgent; it still shows in the daily digest and the bell.
- If the server stops between claiming and sending, that one alert is lost rather than sent twice. The daily digest
  and the bell still list the item.
- Alerts go out even when the person is on leave. Leave-aware alerts are a later step.
- A run is one request that walks every recipient in turn. That is fine for the IT pilot; for the whole group the
  scheduler should split runs by department before go-live.
- Email item titles leave Prima, so a title opened in email is not in Prima's file-open log. Item titles should not
  hold confidential figures.
- Runs are not yet written to the activity log (rule 9). The run answers counts only.

## Not done yet

- Item titles are not yet translated into Bahasa Melayu inside the message. The screen translator runs only in the
  browser.
- Staff cannot yet choose which alerts they get. Everyone receives urgent alerts plus the daily digest.
- Guards are not included. Their work stays in the JA Group app for now.

Tests: `packages/core/test/alerts.test.ts`, `apps/api/test/alerts.test.ts`. They use synthetic data, and no provider
is called.
