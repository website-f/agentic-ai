# Microsoft sign-in: setup for the IT Lead

Prima uses **two** app registrations in the group's Microsoft Entra ID, one per environment (staging first):

| Registration | What it is | Platform |
|---|---|---|
| `Prima Secure App - Staging` | The React web app people open | Single-page application |
| `Prima Secure API - Staging` | The NestJS API the web app calls | Exposes the delegated scope `access_as_user` |

Nothing here costs money. Tenant IDs, client IDs and the Application ID URI are public identifiers, not secrets.
No client secret is used anywhere, and implicit grant stays off.

## 1. API registration (`Prima Secure API - Staging`)
1. **New registration**, single tenant (this organisational directory only). No redirect URI.
2. **Expose an API.** Application ID URI: keep the default `api://<API client ID>` (if you choose another, give it to
   the developer). Add scope `access_as_user`, who can consent: **admins only**, state enabled.
3. **Manifest:** set `requestedAccessTokenVersion` (under `api`) to `2`. Prima refuses v1 tokens.

## 2. Web app registration (`Prima Secure App - Staging`)
1. **New registration**, single tenant.
2. **Authentication → Add a platform → Single-page application.** Add redirect URIs **only once the exact address is
   known**: the staging web address with a trailing slash, and `http://localhost:5173/` for development. Do not add a
   guessed production address. Implicit grant: **off**.
3. **API permissions → My APIs → Prima Secure API - Staging → access_as_user** (delegated). Keep Microsoft Graph
   *User.Read*. Press **Grant admin consent**. No other Graph permissions.
4. **Enterprise applications → Prima Secure App - Staging → Properties:** *Assignment required* = **Yes**; assign only
   the pilot users or a pilot group.
5. **Conditional Access:** require MFA for this app (or confirm the tenant-wide MFA policy covers it).

## 3. Server settings
```
ENTRA_TENANT_ID=<directory (tenant) id>
ENTRA_SPA_CLIENT_ID=<application (client) id of Prima Secure App - Staging>
ENTRA_API_CLIENT_ID=<application (client) id of Prima Secure API - Staging>
# ENTRA_API_APP_ID_URI=<only if not api://<API client ID>>
ALLOW_DEV_LOGIN=false
```
The web app reads the web app client ID and the API scope from the API at start-up (`GET /api/auth/config`), so the
web build needs no Entra settings. What Prima checks on every call: Microsoft's signature (RS256), v2.0 token, your
tenant, issuer, audience = the **API** (its client ID or Application ID URI, never the web app's), issued to the
**web app** (`azp`), the `access_as_user` scope, expiry and not-before.

Moving from the earlier single-registration setting: `ENTRA_CLIENT_ID` still works and means "the same registration is
both". With two registrations, remove it and set `ENTRA_SPA_CLIENT_ID` and `ENTRA_API_CLIENT_ID`.

## 4. Link each pilot user to their Prima record
Find each person's **Object ID** in *Users → (person) → Overview*, then on the server:

```
npm run build -w @prima/api
npm run entra:link -w @prima/api -- u-it-lead <object id> --by "IT Lead name"
npm run entra:link -w @prima/api -- u-it-lead --unlink --by "IT Lead name"
```

Each link and unlink goes on the audit chain. One Microsoft account links to one Prima record only. Someone signing
in before they are linked sees their account ID so IT can link it.

## 5. Staging sign-in test (UAT) before any production decision
Automated tests use made-up keys; they do not prove the live tenant. On staging, with real pilot accounts, record:
1. A linked pilot user signs in, passes MFA, accepts the confidentiality rule, lands on their home screen.
2. An account not assigned to the app is stopped by Microsoft.
3. An assigned but unlinked account sees "not linked to a Prima staff record yet".
4. A linked account outside the pilot sees "not part of the pilot yet".
5. Sign out returns to the sign-in screen; the browser back button does not reopen Prima.
6. The person picker is absent (`ALLOW_DEV_LOGIN=false`).
