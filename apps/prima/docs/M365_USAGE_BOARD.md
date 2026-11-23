# Microsoft use board

Rule **M365-USE**. Fauzan, 23 Nov 2026: "Make sure prima secure can make sure every staff make full use of microsoft 365
premium". He then answered "1. Ok 2. Ok" to two things: (1) a read-only Microsoft report permission, and (2) the PDPA
officer agreeing to show names in Microsoft's usage reports. Later the same day he confirmed both ("1. Yes. 2. Agreed")
and widened the goal: "Make sure every staff make full use of microsoft we buy". The board therefore covers every plan the group buys
(Business Basic, Basic with the Entra ID P1 add-on, Business Premium), not only Premium. He then asked "How about using
the sharepoint?", so OneDrive and SharePoint are separate checks. Then: "Make sure we fully use the integration between
prima secure and microsoft 365", so the board also counts sign-ins to Prima with Microsoft and lists every Prima to
Microsoft 365 link with its state (see below).

**Status:** this is source code only. It is **off by default**, its database module is **not** in
`db/release-manifest.json`, and nothing has been consented to, installed, deployed or switched on.

## What it does

Once a day Prima reads Microsoft's own usage records and stores a checklist for each office staff member. It covers
directors, PWVSB officers, Company Managers and admin executives with an open sign-in; guards, site devices and
connected systems are left out. The board sits on the **Connections** screen.

| Check | Who | Microsoft record |
| --- | --- | --- |
| Signs in to Prima with Microsoft in the last 30 days | All | Entra sign-in log, Prima's own sign-in app only |
| Microsoft Authenticator registered | All | Sign-in method registrations |
| Password reset registered | All | Sign-in method registrations |
| My Apps used in the last 30 days | All | Entra sign-in log, My Apps sign-ins only |
| Teams used in the last 30 days | All | Active users report |
| Outlook used in the last 30 days | All | Active users report |
| OneNote used in the last 30 days | All | Microsoft 365 apps usage report |
| Loop used | All | Not measured: Microsoft has no per-person Loop report yet, so always Unknown (how-to only) |
| Mailbox under 90% full | All | Mailbox usage report |
| OneDrive used in the last 30 days (own work files) | All | Active users report |
| SharePoint: shared company or department files opened or edited in the last 30 days | All | SharePoint activity report (falls back to the active users report if it cannot be read) |
| Managed laptop or phone that meets the rules | Business Premium, E3, E5 | Intune managed devices |
| Desktop Office installed | Business Premium, E3, E5 | Office activations report |
| "Confidential" labels used | Business Premium, E3, E5 | Not measured yet: always Unknown |

A check that cannot be read is **Unknown**, never green. A licence with no Outlook, Teams, OneDrive or SharePoint use
in 30 days is flagged **Unused**, so the Company Manager can move it. A Business Premium licence whose Premium-only
features (managed device and desktop Office) are both unused is flagged **Premium not used**, so IT books the set-up
or the licence moves to someone who needs it. Each person sees their plan and what it gives them. Anything missing
shows a short how-to, in BM first and then English.

**Plans.** Prima reads the plan from the products on each licence in Microsoft's active users report: Business
Premium (or E3/E5), Business Basic with Entra ID P1, Business Basic alone, or Other. Managers and leaders see how many
people hold each plan.

**Help to do it.** Fauzan, 23 Nov 2026: "Make sure guide can help them to do microsoft. Or help them to do it." Every
item that is not done (or Unknown) opens "How to do it": three short numbered steps in BM and English
(`USE_STEPS` in `packages/core/src/m365-usage.ts`), a button to the official Microsoft page, and **Ask IT to help**.
That button raises an ordinary IT help request as the person (Microsoft 365, P4, with the item named), which IT takes,
resolves and the person confirms as usual. The guide also has two cards, `m365.checklist` and `m365.ask_it`
(`packages/core/src/m365-guide-cards.ts`), for every office staff member. No step asks for a password or sign-in code,
and the board says IT never asks for them.

**Prima and Microsoft links.** IT, group leaders and the ACT head or manager also see every link between Prima and
Microsoft 365 that is built (`packages/core/src/m365-links.ts`): Sign in with Microsoft, alerts to Teams, e-mail and
the Prima bell, the Outlook, Teams and SharePoint check, SharePoint files as proof, attaching an Outlook e-mail to a
job, Finance approvals in Teams, Planner tasks (Partly at most until sending to Planner is built; see `docs/M365_PLANNER_LINK.md`), Power BI reports, the website requests list (`docs/M365_WEBSITE_REQUESTS_LIST.md`) and this board. Each shows
On, Partly or Off from the server's own settings (never a setting value), what staff get from it, and what is still
needed. Beside it, the share of staff linked to Microsoft and actually using Prima sign-in, My Apps, SharePoint and
Teams. On means the settings are in place; it is not a check of tenant grants or database modules, and each link is
switched on only after the CEO's go-ahead.

**Who sees what.** These are the same walls as the rest of Prima, enforced in `usageVisible` on the server.

| Viewer | Sees |
| --- | --- |
| Every staff member | Their own checklist only |
| Company Manager | Office staff of their own companies |
| Department head (IT Manager, FWM Manager, Procurement Manager, Asset Director, ACT lead or manager) | Their own department |
| Finance team leader | Their own team |
| Group leaders, IT and the ACT head or manager | Everyone, plus scores per company and department |

**Coaching, never discipline.** Prima reads counts and dates only, never the content of e-mail, chats or files. It
drops display names from the report files as it reads them. The stored day holds only Prima ids and check results:
no names, sign-in names or e-mail addresses. Days are kept for 90 days.

## Setup

Each step needs the CEO's go-ahead.

1. **App registration** (Entra admin centre): create *Prima Microsoft Use - <environment>* with a client secret
   stored in Key Vault. Add these **application** permissions, all read-only, and grant admin consent:
   - `Reports.Read.All`: the active users, mailbox, SharePoint activity, Microsoft 365 apps and Office activation reports.
   - `AuditLog.Read.All`: sign-in method registrations, and successful sign-ins to My Apps and to Prima from the Entra sign-in log
     (only the account id and the day are kept; addresses, places and devices are dropped as they are read). Both
     need Entra ID P1, which every staff member will have.
   - `DeviceManagementManagedDevices.Read.All`: Intune devices. This is only useful once Intune is in use.
2. **Show names in reports** (Microsoft 365 admin centre > Settings > Org settings > Reports): untick "Display
   concealed user, group, and site names in all reports". Do this only after the PDPA officer agrees, and tell staff
   first. Until it is done the board says that Microsoft still hides names.
3. **Database module:** run `db/modules/m365-usage-v1.sql` with `infra/run-db-migration.sh`, staging first. It is an
   off-list module and needs Fauzan's go-ahead.
4. **Settings** on the API:
   - `M365_USAGE_ENABLED=true`
   - `M365_USAGE_RUN_KEY`: 32 or more random characters, kept in Key Vault.
   - `M365_USAGE_CLIENT_ID`
   - `M365_USAGE_CLIENT_SECRET`
   - `ENTRA_TENANT_ID` (already set for sign-in).
5. **Daily run:** have the scheduler call `POST /api/m365-usage/run` once a day with header `X-Usage-Key`. It answers
   counts only. Microsoft's reports run about 2 days behind.

## Code

- `packages/core/src/m365-usage.ts`: checks, scores, walls and the report CSV reader. Tests:
  `packages/core/test/m365-usage.test.ts`.
- `apps/api/src/m365-usage/`: the Graph reader (`graph.ts`), the store (`pg-store.ts`) and the endpoints
  (`controller.ts`). Tests: `apps/api/test/m365-usage.test.ts`, which includes a PostgreSQL test when `DATABASE_URL`
  is set.
- `apps/web/src/connections/m365/usage-panel.tsx`: the panel on the Connections screen.
- `db/modules/m365-usage-v1.sql`: the daily snapshot table.

## Not done yet

- "Confidential" label use shows Unknown until a reviewed source is added (Purview activity explorer).
- Loop use shows Unknown until Microsoft publishes a per-person Loop report (Fauzan, 23 Nov 2026: "One notes and loop?").
- Nudges show on the board only. Sending them to Teams or e-mail would use the alerts module, after its own
  switch-on.
- Staff and device UAT with real accounts is still required.
