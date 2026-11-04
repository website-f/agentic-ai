# SharePoint Connections: read-only metadata pilot

## Current local implementation

Connections uses the user's existing verified Microsoft sign-in to Prima. This is not a new broad OAuth “Connect” flow. The default is **NotConfigured**. No credentials, consent or resource grants are created by this code or its tests.

The page initially requests only server configuration status; it does not contact Microsoft. For an approved site, the user explicitly chooses **Check access**, then **List libraries**, and optionally **List root metadata** for a selected library. Configuration is not connectivity: **ConfiguredNotVerified** never means connected. A successful check is ephemeral evidence for that user and site at the returned timestamp, not organization-wide access or a security certification. Failures, cancellation, site changes and reload clear the frontend verification state. Every provider action independently rechecks authorization.

Available endpoints, all protected by existing AuthGuard:

- `GET /api/connections/sharepoint`: configuration status and currently eligible site labels only; no provider call.
- `POST /api/connections/sharepoint/:siteKey/check`: explicit read-only access check.
- `GET /api/connections/sharepoint/:siteKey/libraries`: only explicitly approved library IDs and names (maximum 50 approvals per site).
- `GET /api/connections/sharepoint/:siteKey/libraries/:driveId/items`: up to 25 root item IDs, names, file/folder kind, size and modification timestamp. Library membership is re-resolved against the approved site on every request.

No folder traversal, pagination following, document bodies, download links, content import, AI retrieval, model context, sending or document changes are implemented by Prima. File metadata may include a direct browser display link: an explicit click opens SharePoint in a new tab, where Microsoft rechecks current browser access. This may display document content in Microsoft, not in Prima or Arisha. `hasMore` only indicates that results were truncated; the server never follows provider next links. Metadata names can themselves be sensitive. No durable connection-setup persistence or consent/grant UI is provided. Demo mode remains NotConfigured.

## Future configuration: requires separate human approval

Do not enter secrets into chat, source control, frontend settings or this page. Any future setup requires explicit approval of the server allowlist, confidential application credential, delegated `Sites.Selected` consent, and a separate site-level **read** resource grant. Consent alone does not grant site access. The user's current SharePoint permissions also apply: access is the intersection of application-selected resources and user permissions.

Server variables (currently optional and off by default):

| Variable | Purpose |
| --- | --- |
| `SHAREPOINT_CONNECTION_ENABLED` | Must be exactly `true` to enable configured service. |
| `ENTRA_TENANT_ID` | Existing fixed tenant GUID; no common/multi-tenant endpoint. |
| `ENTRA_API_CLIENT_ID` | Existing confidential API client GUID (`ENTRA_CLIENT_ID` fallback supported). |
| `SHAREPOINT_OBO_CLIENT_SECRET` | Future separately approved server-held confidential credential; never expose to client. |
| `SHAREPOINT_APPROVED_SITES_JSON` | Explicit nonempty site allowlist, maximum 20 entries. |

Synthetic allowlist example only (not real tenant IDs or approval):

```json
[
  {
    "key": "approved-site",
    "name": "Synthetic approved site",
    "host": "example.sharepoint.com",
    "siteId": "example.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222",
    "companyIds": ["co-example-a", "co-example-b"],
    "allowedUserIds": ["u-example"],
    "approvedDriveIds": ["b!synthetic-approved-library"]
  }
]
```

`companyIds` must enumerate **all companies whose metadata is stored at that site**, not just the companies one wants to assign to a user. The caller must currently see every mapped company and be explicitly listed in `allowedUserIds`. Whole-site metadata access must be approved. A site shared with other confidential domains may require narrower library-level controls in a future design; this pilot does not automatically classify directories or prove that an administrator's mapping is complete. Duplicate site resources and wildcards are rejected. Unknown or malformed configuration fails closed as NotConfigured.

## Authentication and provider boundary

Only request-local evidence set after successful Entra token verification and Prima identity linkage can be used for on-behalf-of exchange. Development HMAC login, user-supplied request properties and integration identities cannot qualify. The current Prima Entra object link and company visibility are checked afresh. Tokens are neither persisted nor globally cached.

OBO uses the fixed tenant's Microsoft token endpoint and the explicit scope `https://graph.microsoft.com/Sites.Selected`. Only the exact `Sites.Selected` or equivalent resource-qualified returned scope is accepted; broader or unexpected scopes fail closed. No `.default`, `Sites.Read.All`, `Files.Read.All` or arbitrary SQL/URLs are accepted. Tokens are opaque; Graph JWT contents are not parsed. Graph requests use fixed `https://graph.microsoft.com/v1.0` paths with redirects forbidden, bounded response bytes and an eight-second timeout per upstream request. Responses expose only the documented metadata fields. Errors are static and exclude provider bodies, tokens and credentials.

Official protocol references: [Microsoft OBO flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow) documents explicit resource scopes and resource-qualified scope responses; [Microsoft delegated Sites.Selected announcement](https://devblogs.microsoft.com/microsoft365dev/sharepoint-now-supports-delegated-sites-selected-authentication/) describes selected-site delegated access. These references support the design, not a claim that this tenant is configured or live-tested.

## Validation and remaining work

API build and offline Connections tests exercise stubbed provider responses, locally signed synthetic Entra tokens and stubbed identity lookup. They make no live Microsoft calls. No database migration or permission changes are required by this slice. Full deployment, real Entra/OBO consent/resource-grant validation, tenant-specific access checks and operational readiness remain separate approved work. Production logging/audit policy for metadata reads needs operational review; do not log tokens, document names, confidential metadata or provider response bodies.


## V2 fail-closed library restriction

`approvedDriveIds` is a server-only exact library allowlist per approved site. Missing or empty lists intentionally disable all library/item metadata access, including for legacy V1 configurations; there is no automatic “all libraries” migration. Site-only access checks remain available. Invalid lists, duplicate IDs, wildcards and URL-shaped IDs reject configuration. A human must explicitly approve library IDs and any server configuration changes. This local code does not make that change.

The status DTO exposes only `hasApprovedLibraries` per site, not configured IDs or counts. All status/check/list DTOs include literal `serviceId: 'sharepoint'` and the authenticated server-derived `userId`; clients must validate these alongside resource IDs and the current session generation.

Library membership is rechecked using only IDs from the first bounded site-drive page, never unapproved names. Only proven approved IDs receive separate name lookups, whose response IDs must match exactly. If any approved ID is absent from that first page, listing fails closed with no partial success, counts or next-link hints. No pagination is followed. Item requests reject unapproved IDs before token exchange/provider calls, then independently recheck site membership. Current all-company visibility, explicit user allowlisting and verified Microsoft identity requirements remain unchanged.

Approved-name lookups are sequential, not parallel bursts: at most 50 name reads plus one membership read. The Graph portion of a library listing has a shared 15-second deadline, each call also retains its eight-second cap, and OBO has a separate eight-second cap. Any lookup failure or deadline exhaustion fails the entire listing, never partial green success. No provider actions run on opening the page. Tests inject provider responses only, including deadline exhaustion; no live Graph access is claimed.


## Explicit file opening pilot
After the existing user/site/approved-drive checks, root metadata requests additionally select Graph `webUrl` (the browser display property), never `@microsoft.graph.downloadUrl`. Only HTTPS links on the exact approved site host pass; credentials, ports, query/fragment links, malformed/control paths and SharePoint redirect/API handler paths are omitted. Unsupported or absent links leave names visible without a fabricated destination. Folders remain metadata-only. No sharing link or grant is created.

Links are rendered only after an explicit metadata request and clear on cancel, site/library changes or session disposal. Opening is a separate click using `noopener noreferrer`, never an effect or AI action. This does not prove the browser will have permission or establish content retrieval by Arisha.
Reference: https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0 (webUrl versus preauthenticated downloadUrl).

## Staff-initiated setup request (works before configuration)
Paste a direct site/library link → **Check link format** (server parse only; no DNS, Graph or file read) → inspect the normalized requested scope → **Submit setup request to IT**. Known library Forms/AllItems paths normalize to the library; child folders/files are not silently promoted to an approved scope. Sharing/token URLs, external hosts, cross-site folder query values and unsupported paths are rejected. The UI says the normalized scope is only a request.

The request uses the existing M365 IT-ticket workflow with a generic audit title. Only the canonical site/library URL and requested scope enter the ticket detail; no tokens, file content, grants or automatic configuration. The requester sees their own ticket reference/status. IT must confirm actual tenant/site/library IDs, company mapping and authorized users, then separately approved Microsoft consent/site grants and server configuration. A resolved ticket is not a successful connection; Check my access still applies.

A user-scoped pending UUID only is persisted in localStorage before POST and guarded by Web Locks. There is no source URL, token or document metadata in local recovery storage. Unknown responses/reload block new submission until the same user's exact receipt is recovered. Server uses the current-main Db Store callback and the reviewed job-email integration's narrow `sharepoint-setup:` advisory lock to serialize same-user request admission. These are required integration dependencies. No notification channel is added. Storage is recovery metadata, not an encrypted vault or account authorization boundary.

Local synthetic checks cover canonical parsing, no-provider preview, identity-bound tickets/replay, safe browser links, state recovery and storage/cross-tab failure. Actual restricted-PostgreSQL concurrent ticket admission and real tenant/browser setup remain release tests, not claims from these mocks.

Setup POST pins the current staff bearer and verifies `/api/me` against the requesting screen user before mutation. Account switches during token/identity acquisition fail closed; response binding remains a second check.
