# Uniform requests from Operations Managers

Fauzan, 11 Nov 2026: "Create button from om to need uniform. Let the om collect signature as the shared device or guard
app still not available."

Status (P100, 12 Nov 2026): built and tested in the office copy from Fauzan's 11 Nov handover (item I1; PR #140 was closed).
The module `db/modules/uniform-requests-v1.sql` is NOT on the release list until the CEO says so: it is not in
`db/release-manifest.json` and not in `deploy/prima/prima-setup.cjs` OFFICE_MODULES, so no start installs it. It is
repeat-safe, so the go-ahead is one line: add it to OFFICE_MODULES.

## How it works

1. **OM asks.** A government Operations Manager or Regional OM opens **My details > Uniform requests > Ask for a
   uniform**, types the guard's staff number, picks the uniform and size from the Goodwill store, the number of pieces
   (1 to 3) and the reason. The OM must cover the guard's company.
2. **Allowance check** (rule from 6 Nov 2026): pieces the guard had from the Goodwill store in the last 12 months, plus
   open requests, are counted.
   - Up to 3 pieces are free.
   - A 4th or 5th piece only when the guard pays: the receipt number and amount are recorded. It is never taken from pay.
   - The 6th piece is refused.
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
- Screens: one panel, `apps/web/src/views/UniformRequests.tsx` (phone first), shown in My details (`MyItems.tsx`, the OM),
  Procurement > Store (`Purchasing.tsx`, the store queue) and Items and equipment > Uniforms (`views/items/Uniforms.tsx`).
- Database: `db/modules/uniform-requests-v1.sql` adds `prima.stock_requests` with the same company wall as
  `stock_issues`, for the API role only, and CHECKs (1 to 3 pieces, a paid piece always has its receipt and amount).
  It is **held back**, not in `db/release-manifest.json` or OFFICE_MODULES. Until it is installed, the screen says
  "Uniform requests are not installed in this database yet".
- Test version: three synthetic Goodwill uniform items (shirt M and L, trousers 32) so the flow can be tried.

## Tests

- `packages/core/test/uniform-requests.test.ts`: full flow to the guard's signature, roles, allowance.
- `apps/api/test/uniform-requests-pg.test.ts` (local PostgreSQL 16): module missing message, forced row-level security,
  company wall, and two storekeepers issuing the same request at once (one issue only).
- Browser check of the test version, desktop and phone: `/mnt/project-files/uniform-request-uat/`.

## Not covered

- Uniforms counted in the newer item register (`Items and equipment`) are not yet added to this count; the two stores are
  still separate.
- Private-side (Sasa Team) OMs do not ask here, because only Goodwill holds stock.
