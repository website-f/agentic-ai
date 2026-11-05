# Microsoft 365 Connections (Outlook, Teams, SharePoint)

Built for the Arisha main review of 2 Nov 2026, section B. Base: `main` at `0ead549`. **Off by default.** This code does not grant consent, change the tenant, install an app, activate a provider or incur charges. Each of those needs Fauzan's direct approval.

## What staff see

On the Connections page, the "Your Microsoft 365 connections" panel shows one status each for Outlook, Teams and SharePoint:

| State | Meaning |
|---|---|
| Not configured | The server switch or IT setup is missing. No Microsoft call is made. |
| Configured, not checked | Ready, but Microsoft has not answered a check for this person yet. Signing in to Prima does not count. |
| Consent needed | Microsoft needs permission (never granted, or granted before and since removed: "ConsentRevoked"). |
| Connected | Microsoft answered a read-only check for this person. The page shows when it answered. The status lasts 8 hours, then asks for a fresh check. |
| Expired or revoked | The Microsoft session expired, or Microsoft wants a new sign-in (MFA or Conditional Access claims challenge). **Reconnect** starts a Microsoft sign-in and passes the claims along. |
| Unavailable | Microsoft refused this person (for example, not a team member), asked Prima to wait (Retry-After is respected and no call is made until it passes), or did not answer clearly. |

The actions are **Check**, **Reconnect** and **Disconnect**.

- **Disconnect** makes Prima forget its own status record for that person and service. It also discards any check or status read that is still running, so a late answer cannot bring "Connected" back. It does **not** revoke Microsoft consent. The permission stays in Entra until an administrator removes it there.
- **Token handling.** The browser (MSAL) holds only the person's token for the Prima API, in that tab's session storage, as for normal sign-in. The server exchanges it on-behalf-of for a Graph token on each check. That Graph token lives only for the length of the request: it is never cached, never stored, and never sent to the browser. The page never shows any token.
- **Binding.** Every stored check is bound to the tenant, the app registration, the resource key and the immutable Microsoft ID (team ID or site ID). If IT replaces an ID under the same key, or the app registration changes, the old result is ignored and the person must check again. This also applies when the ID changes while Microsoft is still answering.

Link checks:
A link check answers for one link only. It **never changes the connection status** above it.
- **Teams channel link** ("Get link to channel"). Prima checks the tenant, then whether the team is approved for the person's company. Only then does it ask Microsoft, with the person's own token, whether they can see the channel. Private and shared channels need membership. A verified result confirms **that channel only**: someone who belongs only to a shared channel is not shown as a team member. The team check reports "not a team member" honestly and points them to the channel check. The result gives the channel type and a rebuilt "Open in Teams" link.
- **SharePoint site or library address.** Only the organization's approved SharePoint hosts are looked up. Sharing links, tokens, `_api` and `_layouts` addresses are refused. Prima uses the existing parse-only `sharePointRequestUrl`, never fetches the pasted URL, and never uses `/shares`.
  - A **site** link is verified as the site.
  - A **library** link is verified as that library. Microsoft must list it for this person on that site (`/drives?$select=id,webUrl`, IDs and addresses only), and its drive ID must be in IT's `approvedDriveIds`. Otherwise the result says that only the parent site is confirmed ("library not approved" or "library not found").
  - If a site isn't approved, the existing IT setup request card is right below.

The page is now available to every office role: director, PWVSB officer, company manager and admin executive. Guards and site devices are excluded, and the server checks role and identity again.

## Capability and permission matrix

All scopes are **delegated** (on-behalf-of the signed-in person) and **read-only**. One scope is requested per exchange. If Microsoft grants a broader or extra scope, the request fails closed (`UnexpectedScopes`).

| Capability | Code | Delegated scope | Graph call | Server switches | Tenant / app registration steps (Fauzan approves) | Boundaries | Evidence |
|---|---|---|---|---|---|---|---|
| Outlook check | `connections-m365/service.ts` `probe('outlook')` | `Mail.ReadBasic` | `GET /me/mailFolders/inbox?$select=id` | `M365_CONNECTIONS_ENABLED`, `M365_OUTLOOK_ENABLED`, `M365_OBO_CLIENT_SECRET` | Add Mail.ReadBasic to `<application-id>`; admin or user consent in `<tenant-id>`; add the API secret | No Mail.Send, no Mail.ReadWrite, no message bodies, no app-only Mail.Read (Exchange Application RBAC is reviewed first if ever needed) | `m365-connections.test.ts` |
| Teams membership check | `probe('teams')` | `Team.ReadBasic.All` | `GET /me/joinedTeams?$select=id` | `M365_TEAMS_ENABLED`, `M365_TEAMS_APPROVED_JSON` | Add the scope; admin consent; IT lists approved team IDs with their companies | No messages read or sent | same |
| Teams channel link | `teamsLink()` | `Channel.ReadBasic.All` | `GET /teams/{id}/channels/{id}?$select=id,membershipType` | same | Add the scope; admin consent | Microsoft enforces private/shared channel membership | same + browser run |
| SharePoint site check | `probe('sharepoint')` | `Sites.Selected` | `GET /sites/{site-id}?$select=id` | existing `SHAREPOINT_*` + `M365_CONNECTIONS_ENABLED` | Sites.Selected consent; grant the app only the `<approved-site-id>` sites | No tenant-wide scan, no write, no `/shares`, no downloadUrl | same |
| SharePoint link | `sharePointLink()` | `Sites.Selected` | `GET /sites/{host}:/sites/{name}?$select=id` | same | same | Only approved hosts; site must be approved for the person and all of its companies | same |
| Teams Approvals evidence | `connections-teams/evidence-reader.ts` (existing) | none yet | none | none | Power Automate Approvals connector to be evaluated | **Not built.** A chat "approved" is not evidence; the Graph beta approvals API is not production-supported | `teams-evidence-reader.test.ts` (repeated, reassigned, cancelled, changed version) |

The same matrix is served to the screen and to Arisha at `GET /api/connections/m365/matrix`, from `apps/api/src/connections-m365/capabilities.ts`. It includes the BM and English "why, what data, where to get the link, who helps" guidance.

Example `M365_TEAMS_APPROVED_JSON` (placeholders only): `[{"key":"sasa-ops","name":"Sasa operations","teamId":"<team-id>","companyIds":["<company-id>"]}]`.

## Requirement-to-capability map (what is built versus what is not)

Arisha main asked for this before anything is called complete. **Built** means code and offline tests exist. Nothing here is deployed, consented or tested against a real tenant.

| Requirement (section B) | What exists | State |
|---|---|---|
| One Connections entry per person with truthful states | `connections-m365` status, check, reconnect and disconnect | Built (offline). Off. |
| Outlook "monitoring and context links" | (a) This page checks **only that the person's mailbox can be reached** (Mail.ReadBasic). It reads no messages and does no monitoring. (b) The existing job-email feature lets a person attach **one selected message** to an IT job (Mail.Read, preview, attach, 30-day snapshot). | Mailbox reachability built. Selected-message attach built earlier (not migrated). **Ongoing mailbox monitoring is not built.** |
| SharePoint links validated for org and user access | Site and library link check, site check, existing approved-library metadata listing on explicit request | Built (offline). **Automatic synchronisation or monitoring of SharePoint processes is not built.** |
| Teams: open link, show status, approvals evidence kept separate | Channel link check and team membership check | Built (offline). |
| Teams Approvals evidence | `connections-teams/evidence-reader.ts` verifies a supplied record against the exact payment attempt | **Not usable.** There is no configured trusted production source and no end-to-end consumer. The Power Automate Approvals connector still needs evaluating. |
| Arisha explains each connection | Bilingual why, data, where-to-get-the-link and who-helps text in the matrix and on the page | Built. Guide-card registration waits for #56. |
| Claims, consent, expiry, 429 handling | Provider classification and Retry-After | Built (offline). |

## Automation map

Each intended automation is traced from trigger to human exception. Only the first three rows are built, and none of them runs on a schedule or without a person pressing a button.

| Automation | Trigger | Authenticated source | Role and company mapping | Action | Audit | Retries | Human exceptions | Test (offline or mocked, delegated scope) |
|---|---|---|---|---|---|---|---|---|
| Connection check (Outlook, Teams, SharePoint) | Person presses Check or Reconnect | Person's Entra token → on-behalf-of → Graph, one read-only scope | Office role; team or site approved for **all** of its companies; tenant + object ID + user binding | Store a status for that person only (memory) | **None.** It is a read-only status. Not written to the audit chain (gap; can be added if wanted) | None automatic. Retry-After blocks calls until it passes. Duplicate clicks share one call | Consent, reauthentication or "not a member" are shown to the person with who to ask | `m365-connections.test.ts` |
| Link check (Teams channel, SharePoint site or library) | Person pastes a link and presses Check link | Same | Same, plus tenant and approved host before any call | Show the result. Status is unchanged | None (read-only) | Same | Same | same |
| Attach one Outlook message to an IT job (existing) | Person previews and attaches on an authorized job | Person's token → Mail.Read | IT job audience (API and RLS) | Durable snapshot row with an attached/removed event history | Row events (attached and removed by whom and when) | Durable dedupe | Audience and retention decisions are open | `job-email*.test.ts` |
| Outlook mailbox monitoring | — | — | — | — | — | — | — | **Not built** |
| SharePoint process sync or monitoring | — | — | — | — | — | — | — | **Not built** |
| Teams notifications from Prima | — | — | — | — | — | — | — | **Not built** (Website connectors have their own Teams delivery, separate from this page) |
| Teams or Power Automate approval → Prima Finance | Approval completes in Power Automate | Needs a trusted production source (not configured) | Payment attempt binds the approver set, version and amount | Would let Finance apply an approval inside its own transaction | Would be audited by Finance | Replay protection designed (source, resultId, version) | Pending, rejected, cancelled and expired outcomes are never promoted | Verifier only: `teams-evidence-reader.test.ts`. **No source and no consumer.** |

## Control ownership

| Control | Owner |
|---|---|
| Passwords, MFA, sign-in risk; Conditional Access and Purview when present (never a prerequisite) | Microsoft |
| Mailbox, team, channel, site and library permissions (not mirrored in Prima) | Microsoft |
| Roles and workflow permissions; approvals stay in Prima workflows | Prima |
| Binding each check to tenant + Entra object ID + Prima user | Prima |
| Status cache isolation and retention (memory only; verified 8 h; dropped after 24 h or on disconnect; 5,000-entry cap) | Prima |
| Duplicate clicks (one Microsoft call per person and action); late results after disconnect discarded | Prima |
| Request version, approver and outcome validation for future Teams evidence | Prima (reader built, not connected) |
| Truthful status | Prima |
| Approved team and site lists | IT desk |
| Admin consent, app registration changes, secrets, provider activation, charges | CEO (Fauzan), directly |

## Tests

| Suite | Result on this branch (local) |
|---|---|
| `apps/api/test/m365-connections.test.ts`: two synthetic identities, stubbed Microsoft | 30/30 |
| API suite on local PostgreSQL 16 (`npm test -w @prima/api`) | 709/709 |
| Core suite (Vitest) | 680/680 |
| `scripts/m365-connections-state.test.mjs` + `m365-connections-render.test.cjs` | 10/10 + 8/8 |
| Existing Connections tests (`connections-v2`, `connections-state`, mail, SharePoint request, job email) | 88/88 |
| `scripts/connections-browser-smoke.mjs` (existing, updated) | passed, 1440 and 390 px |
| `scripts/m365-connections-browser-smoke.mjs` (new; two identities) | 26 steps passed, 1280 and 390 px |
| Web typecheck and demo build | pass |

Two-identity coverage: allowed and denied access; wrong company; wrong tenant; private, shared and standard channels; shared-channel-only membership; library versus site links; replaced team or site IDs and a changed app registration (including mid-check); a status read racing Disconnect; consent required versus revoked; expired session; claims challenge (token endpoint and Graph CAE); 429 Retry-After; broader-scope refusal; duplicate clicks; disconnect racing a check; reconnect; 8-hour expiry; de-approved team. For repeated, reassigned and cancelled approvals and changed request versions, see the existing Teams evidence reader tests.

The browser runs use a synthetic API in place of Prima, and the PostgreSQL run is local. Neither is evidence of tenant consent, live Microsoft behaviour or staff UAT.

## Not done and still needed

1. Tenant steps in the matrix: scopes, admin consent, Sites.Selected site grants, approved team list, and the `M365_OBO_CLIENT_SECRET` secret. These need Fauzan's direct approval.
2. A synthetic-tenant UAT with two real test accounts, after those steps.
3. Status is held in memory per API instance. With several replicas, a person may see "not checked" on a different replica. That is safe (never falsely connected), but if it matters it needs a durable table and a migration.
4. Guide cards: when PR #56 lands, register `m365.connections.*` cards from this matrix with `registerGuideCards`.
5. Teams Approvals: evaluate the Power Automate Approvals connector. Nothing is claimed as built.
