# Government and Private Operations, Procurement: handover notes (PR #54)

Scope: Goodwill Empire Sdn Bhd (government sites), Sasa Team Sdn Bhd (private sites), the Goodwill item handover chain,
the ops monitors (site profit and loss, salary check, leave, client satisfaction), management fees, and Procurement.
This is a draft PR. Nothing here is merged, migrated, installed or deployed, and no provider is connected.

## How the monitors count money (Arisha main review round 2, 2 Nov 2026)

- **Salary check rows** are built from everyone rostered at, or clocked in at, the sites in view this month. A guard
  rostered with no clock-in is listed with `No clock-in at these sites in <month>` and the missed-shift count. They are
  never dropped.
- **Pay** is the guard's whole month in the company: basic, plus overtime at 1.5 times from every hour clocked at any
  site. That is the figure the JA pay summary is compared with. `payHere` is the part for the hours at the listed sites.
  The pay total uses `payHere`, so the government and private totals add up to the company's pay and don't count it twice.
- **Shared costs** are split over each guard's hours at every site of the company before the list is cut to a sector,
  a region or an OM's area. Shared costs here means employer EPF, SOCSO, EIS, the HRD or foreign worker levy, the hostel
  share and Goodwill items. One RM100 hostel bill therefore shows as RM100 in total across both monitors, not RM100 in
  each. Tests: `packages/core/test/ops-monitor-reconcile.test.ts`.
- **A guard with no clocked hours anywhere** has no hours to split by, so their employer costs and hostel share are not
  put on any site. They still appear in the salary check with the missing attendance flagged.

## Central employers

PWVSB, Merdeka Network, Goodwill Empire and Sasa Team are central employers (`CENTRAL_EMPLOYER_IDS`). They are not
rows of the companies table. They are treated the same way in:

- **IT manual records:** the company selector lists all four, and records can be linked to them.
- **IT corrections:** for assets and for the manual system and intake records.
- **IT cleanup:** `ic_scope`.
- **Rental corrections:** `rc_scope`.

On PostgreSQL the same four ids are in `db/migrations/001_init.sql` (`it_register_guard`), `db/modules/it-cleanup-v1.sql`
and `db/modules/rental-correction-v1.sql`. Parity tests:

- `apps/api/test/it-corrections-sql.test.ts`: a correction for each central employer;
- `apps/api/test/it-manual-rls.test.ts`: a Goodwill and a Sasa Team manual record, and an unknown company refused.

**Release owner, please note:** these SQL edits change file hashes.

| What | Before | After |
|---|---|---|
| Base 001 | `4b4cf4d3…` | `244b563d…` |
| Rental correction | `251de5d5…` | `3bc99a1d…` |
| Cleanup | `0f3daa00…` | `0c768fcf…` |

- **Re-pinned in this PR:** `db/release-manifest.json`, plus the function-body pins in `apps/api/src/it-cleanup-readiness.ts`, `rental-correction-readiness.ts` and `it-manual-readiness.ts`.
- **Not re-pinned:** the operator packages under `ops/base-transition` and `ops/existing-admin`, and `.github/workflows/deploy-exact-spa.yml`. These still pin the earlier candidate, so the release owner must regenerate and re-review them before this SQL is used.
- **Not authorized:** installing or migrating any of this.

## Procurement: recovering from a rejection

1. An approver (company manager, COO or CEO, depending on the amount) rejects the request with a reason. The request shows **Rejected**, with who rejected it and why.
2. **Procurement** or **the person who raised it** opens the request and uses **Correct and send again**:
   - correct the quantities or estimated prices if the rejection was about what is being bought;
   - say what was corrected (required).
   The person who rejected it cannot reopen it.
3. The request goes back to **quoting**:
   - the earlier quotes, online check, approvals and rejection are kept unchanged as a numbered round;
   - fresh quotes are needed, and a supplier who quoted before may quote again;
   - then the online check, submit, and the full approval chain.
4. Each reopen is audited (`pur.reopen`). After five rejected rounds the request cannot be reopened; raise a new request.
5. If the purchase is no longer needed, leave it rejected. That is its final state.

API: `POST purchasing/requests/:id/reopen` with `{ note, lines?, title? }`.

Tests:

- `packages/core/test/pur-reopen.test.ts`;
- `apps/api/test/procurement-stock-lock.test.ts`, the reopen case on PostgreSQL.

## Kept unchanged

- Fee locks and their audit.
- The monitor gates (OGM is government only; the Operations Director is private only; OMs see their own area and side).
- The handover order OM → patrol officer → guard.
- Proof hashing.
- JA HMAC and validation.
