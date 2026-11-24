# Uniform requests from Operations Managers

Fauzan, 11 Nov 2026: "Create button from om to need uniform. Let the om collect signature as the shared device or guard
app still not available."

Status: on main (source only). Not migrated or deployed: the table is in the off-list module `uniform-requests-v1`, which Fauzan runs later with the others.

## Site supplies requests (Part T, 13 Nov 2026)

The same table also holds the site supplies request for KBK, PKK Nepal and PKK Local sites, where a guard's uniform is
one line per guard and the same allowance applies. See [SITE_SUPPLIES_REQUESTS.md](SITE_SUPPLIES_REQUESTS.md). This
single-guard request stays as it is; the queue here does not show supplies requests.

## How it works

1. **OM asks.** A government Operations Manager or Regional OM opens **My details > Uniform requests > Ask for a
   uniform**, types the guard's staff number, picks the uniform and size from the Goodwill store, the number of pieces
   (1 to 3) and the reason. The OM must cover the guard's company.
2. **Allowance check** (rule from 6 Nov 2026): pieces the guard had from the Goodwill store in the last 12 months, plus
   open requests, are counted.
   - Up to 3 pieces are free.
   - Every piece after the 3rd only when the guard pays: the receipt number and amount are recorded. It is never taken
     from pay. No upper limit (Fauzan, 13 Nov 2026 23:52Z; earlier the 6th was refused). The limit is a setting
     (UNIFORM_RULE.paidMaxPerYear) if one is wanted later.
   - A piece within 6 months of the last one is allowed with the reason given, and is marked "within 6 months".
   - One open request per guard per item.
3. **Store decides.** The storekeepers and the Procurement executive see the request on **Procurement** (and on their
   home page). They either:
   - **Issue to the OM**, naming the patrolling officer of the guard's company. This uses the normal Goodwill issue, so the
     stock goes down and the handover starts; or
   - **Refuse**, with a reason the OM can see.

   The OM who asked can cancel while the request is open. The OGM sees every request but does not decide.
4. **OM collects the signatures** under **Items to pass on**, on the OM's own phone, because the shared site device and
   the guard app are not available yet:
   - the OM confirms receiving the item from the store;
   - the patrolling officer signs on the OM's screen (or the OM attaches the signed slip);
   - the guard signs on the OM's screen (or the OM attaches the signed slip and a photo of the guard holding the item).

   This step was already built on 2 Nov 2026. Each signature is kept with its SHA-256 in the audit log.
5. **Billing.** Goodwill bills the guard's company only after the guard has acknowledged the item, as before.

## Code

- Core: `requestUniform`, `uniformRequests`, `decideUniformRequest` in `packages/core/src/service.ts`; rule
  `UNIFORM_REQUEST_RULE`; type `StockRequest`.
- API: `GET/POST /purchasing/uniform-requests`, `POST /purchasing/uniform-requests/:id/(issue|refuse|cancel)`.
- Screens: `apps/web/src/views/MyItems.tsx` (OM panel), `apps/web/src/views/Purchasing.tsx` (store queue).
- Database: `db/modules/uniform-requests-v1.sql` adds `prima.stock_requests` with the same company wall as
  `stock_issues`. It is **proposed**, not in `db/release-manifest.json`. Until it is installed, the screen says
  "Uniform requests are not installed in this database yet".
- Test version: three synthetic Goodwill uniform items (shirt M and L, trousers 32) so the flow can be tried.

## Tests

- `packages/core/test/uniform-requests.test.ts`: full flow to the guard's signature, roles, allowance.
- `apps/api/test/uniform-requests-pg.test.ts` (local PostgreSQL 16): module missing message, forced row-level security,
  company wall, and two storekeepers issuing the same request at once (one issue only).
- Browser check of the test version, desktop and phone: `/mnt/project-files/uniform-request-uat/`.

## Not covered

- The two stores now share one allowance (23 Nov 2026, Goodwill study gap 7): uniform suits a guard had in the item
  register (`Items and equipment`: handed over, past pieces a manager entered, and paid pieces) in the last 12 months
  each count as one of every worn item here, times how many of the item one suit holds. Where the item register module
  is not installed, nothing is added. The item register's own suit count does not yet read the Goodwill store.
- Private-side (Sasa Team) OMs do not ask here, because only Goodwill holds stock.
