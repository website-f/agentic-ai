# Client report links (client portal, first step)

Decision: Fauzan, 3 Nov 2026, chose "Shared report links first". This is a draft (PR #61). It has not been merged, deployed or switched on.

## What it does

- A **company manager** makes a link for one client, covering one period. The period can be up to 92 days and must end by today. The link stays open for 1 to 30 days. A client can have at most 5 open links at a time.
- The manager writes who at the client receives the link. That name or role is kept in the audit and is never shown on the page.
- The manager sends the link from their own email. Prima does not send email.
- The **company manager or an admin executive** of that company can revoke a link with a reason. It stops working at once.
- Staff can preview the page inside Prima. A preview is not counted as a client view.
- Every link is audited: `client.share.create`, `client.share.view` (each time the client opens it) and `client.share.revoke`.

## What the client sees

The client opens the link without signing in to Prima. The page is plain HTML with no scripts, no images and no forms. Its content security policy allows only its own inline style. It shows:

- the client's own sites, with the number of patrol checkpoints scanned and the number of closed supervisor visits in the period;
- incidents, emergency alerts and complaints at those sites, each with its reference, date, site, kind, severity and status (Open / In hand / Resolved);
- invoices by billing month, with the amount and the date first sent. A billing month is listed only when the whole month falls inside the link period (`monthInsidePeriod`), so a link for 20 to 26 October does not show the October invoice. The date sent may be after the period ends. The page says that this is not a statement of account and does not show payments;
- the billing months, under the same whole-month rule, for which monthly service reports were recorded.

The screen's default period is the last calendar month, so its invoice and report appear.

The page never shows staff or guard names, case descriptions, other case kinds (no-show, missed check-in, identity, arms or compliance), overdue amounts or payment status.

A forged, altered, revoked, expired or unknown link always gets the same "not available" page. So does a link for an ended client.

## How it is protected

- **Concurrency.** Counting a view holds the client row, reads it again and re-checks the link, so a revoke that commits meanwhile is kept and the page is refused. Create and revoke also re-read the links inside their save.

- **Signed link.** The link is `<SHARE_LINK_BASE>/api/share/<token>`. The token carries the company, client and link ids, signed with HMAC-SHA256 using `SHARE_LINK_SECRET` (32 or more characters, kept in Key Vault). The signature is checked in constant time. The server then checks the stored link on every open: it must not be revoked, must not be past its expiry, and must belong to that company.
- **Fails closed in production.** If `SHARE_LINK_SECRET` is missing or short, or `SHARE_LINK_BASE` is missing or not https, links are switched off. The screen says so, and no link can be made or opened.
- **Database scope.** The public request runs as `prima_app` with `app.company_ids` set to the one company named in the signed link, with no group access and no department walls (`Db.asShareLink`). Row-level security keeps sites, cases, scans, site visits and the audit to that company.
  - `client_accounts` is a group table without row-level security. This was already the case before this change. For that table, the company check is done in code. Adding row-level security to it needs a migration, which only the CEO may run.
- **Rate limit.** `/api/share` allows 30 calls per minute per address (`SHARE_RATE_LIMIT_PER_MIN`), on top of the general limit.
- **No caching or indexing.** The responses carry `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `frame-ancestors 'none'`.

## Settings (placeholders only)

| Setting | Value |
|---|---|
| `SHARE_LINK_SECRET` | A random value of 32+ characters, from Key Vault. Never put it in code or docs. |
| `SHARE_LINK_BASE` | The public API address, for example `https://<staging-api-url>`. |

Turning links on for real clients needs Fauzan's approval and both settings. Until then, the feature can be checked on the test build with Preview.

## Not done yet

- Client sign-in, client feedback and requests through the portal (Gov Ops asked that feedback, once taken, goes to `ClientAccount.ratings` / complaints with via `portal`).
- Row-level security on `client_accounts` (needs a migration).
- Report PDFs or attachments. The page lists only the months for which reports were sent.

## Tests

- Core: `packages/core/test/client-share.test.ts`. Covers who may make a link, the limits, the audit, the content filter (no names or descriptions), wrong company, view counting, preview not counted, revoke, and expiry.
- API on local PostgreSQL 16: `apps/api/test/client-share-pg.test.ts`. Covers rejection of a forged or altered token, production fail-closed, HTML escaping and CSP, the company wall through the restricted role, the view audit, and revoke.
- Headless browser on the demo build: make a link, preview it and revoke it at 1280 px, then a phone-width (390 px) overflow check.
