# ADR 0004: Microsoft 365 sign-in for office staff

Date: 2026-10-28. Status: Accepted (CEO: "Implement microsoft sign in", Microsoft-first architecture).

## Decision
Office staff sign in with their Microsoft 365 account through Microsoft Entra ID, single tenant. The web app uses
MSAL (authorization code with PKCE, redirect) and sends the Entra access token for this API on every call. The API
checks the token itself (`apps/api/src/entra.ts`): RS256 signature against Microsoft's published keys, `ver` 2.0,
tenant, issuer, audience = the API registration (its Application ID URI or client ID), authorised party (`azp`) = the
web app registration, expiry and not-before with 5 minutes of clock difference, and the delegated scope
`access_as_user`. App-only tokens are refused.

A verified Microsoft account is identity only. It opens Prima only when IT has linked its Entra object ID to exactly
one staff record (`User.entraOid`, set with `npm run entra:link -w @prima/api`, recorded on the audit chain). The link
is never by name or email, which can be reassigned. Company access still comes only from Prima's own grants and the
database company wall. During the pilot, linked people outside the pilot are refused.

The development person picker and its HMAC tokens work only while `ALLOW_DEV_LOGIN=true`; production leaves it off.
The test link (demo build) is unchanged and does not load the Microsoft library.

## Consequences
- MFA, password rules and account blocking are enforced by Microsoft. Disabling a person in Entra stops new tokens
  within the token lifetime (about an hour); removing the Prima link stops access at once.
- Two registrations per environment (review on PR #11, 28 Oct 2026): "Prima Secure App" (SPA) and "Prima Secure API"
  (exposes `access_as_user`). The older single-registration setting `ENTRA_CLIENT_ID` still means "one for both".
- Guards and shared site devices are not covered here (ADR 0003; guards stay in the JA app).
