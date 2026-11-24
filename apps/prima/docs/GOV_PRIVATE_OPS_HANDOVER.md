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

## Goodwill gaps closed (23 Nov 2026)

From the Goodwill study (Fauzan, 23 Nov 2026: "Do the gap") and his answers that day:

- **Deputy OGM, full stand-in at any time** (decision card). The operations officer the CEO or the HR Director names
  deputy of Goodwill Empire in the org chart (unit `c_goodwill`) may do every OGM step: government sites, cases above
  the Regional OM, guard leave, no-shows, site supply orders, uniform requests, handover steps, Beli baru / renovasi,
  site hours, holiday lists, Finance requests for Goodwill, FW moves, staff stays and the rollout. `isOgm()` in
  `packages/core/src/ops-access.ts` now means "the OGM or the Deputy OGM"; `isOgmByJob()` is the OGM alone (unit head,
  alerts and the line manager still go to the OGM). Every step still names the person who did it, and nobody approves
  their own request. A closed account, a system feed, a deputy outside Operations or a deputy role past its last day
  stands in for nothing. On PostgreSQL, `db/modules/office-am-buy-v1.sql` (not run yet) now lets the named deputy read
  and approve a government "buy new" job, reading `prima.org_lines` only when module org-lines-v1 is installed.
- **Rental at month end is the rule** (decision card "Yes, held on last day"): a rented item still with the guard on
  the month's last day is billed one month's rent to the guard's company. No longer a proposal.
- **Prices**: the Inventory Manager sets Goodwill's rental and sale prices (store item or the Goodwill prices panel);
  the Finance Director (and the CEO) may set them too (Fauzan: "Inventory set it. But fd can set also").
- **Cost and stock by price** (Fauzan: "Make sure charges price and stock by price are stated in data"): each store
  item keeps `unitCost`, the weighted average of the orders received (order amount shared over the lines by value), or
  entered with a reason for opening stock. The panel shows unit cost, stock value (on hand x cost), sale and margin;
  items with no cost are counted as missing, never guessed.
- **Selling below cost needs the FD** (Fauzan: "unprofit need fd approval"): a sale price at or below the unit cost
  from anyone else waits as `pendingSale` and the earlier price stays; the Finance Director (or the CEO) approves or
  refuses with a reason, never their own. The FD may set such a price directly; it is marked approved. Rental is not
  checked against cost (no rule given).
- **Uniform allowance across both stores**: suits from the item register count toward the Goodwill per-item allowance.

API: `POST purchasing/goodwill-prices/:itemId` and `POST purchasing/goodwill-prices/:itemId/decide`. No new table;
new optional fields on the stock item. Tests: `packages/core/test/deputy-ogm.test.ts`,
`packages/core/test/uniform-requests.test.ts`, `packages/core/test/inventory-control.test.ts`.

## Private operations gaps closed (23 Nov 2026)

From the private operations study (Sasa Team, under the Operations Director) and Fauzan's answers that day ("Do the gap"):

- **Deputy Operations Director, full stand-in at any time** (decision card "Yes, full stand-in any time"). The
  operations officer the CEO or the HR Director names deputy of Sasa Team in the org chart (unit `c_sasateam`) may do
  every Operations Director step on private sites: cases above the Regional OM, guard leave, roster publishing, site
  man-hours, public holidays, client report choices, wage advances, FW moves and hostel checks, Sasa Team supply orders
  and Min/Max, Beli baru, Finance requests for private operations, and the private ops monitor and fee bills.
  `isOpsDirector()` in `packages/core/src/ops-access.ts` now means "the OD or the Deputy OD"; `isOpsDirectorByJob()` is
  the OD alone (unit head, alerts, the RBA committee seat and the line manager stay with the OD).
- **The COO covers the OD's decisions** (Fauzan: "Let coo cover also"). `actsAsOpsDirector()` lets the COO take the OD's
  approval step on a private item: roster publish, site man-hours, public holidays, client reports, wage advances, FW
  moves, hostel maintenance and needs, supply order confirm and Min/Max, Beli baru, Finance requests. The COO keeps the
  COO's own view (not narrowed to private sites). Where the COO already has a later step (hostel bills), the COO does not
  also take the OD's step: one person, one step. Every step names who did it, with the reason the step asks for.
- **Lines follow the side.** With no line set in the org chart: a government Regional OM reports to the OGM and a
  private or unsided one to the Operations Director (before, all went to the OD); an OM goes to a Regional OM of the
  same region and side; a patrolling officer tied to the private side with no OM goes to the OD, not the OGM.
- **The Operations Director delegates patrolling officers** to OMs and Regional OMs in the org chart, as the OGM does,
  each head only on their own side.
- **OMs with no side are listed** on the org chart (CEO, HR Director, OGM, OD): Sasa Team and Goodwill have separate
  staff, so HR sets Government or Private in Accounts and access. Nothing is changed automatically.
- Also fixed for the Deputy OGM: wage advances and hostel bill approvals checked the job tier, so the deputy could not
  approve them.

Database module: `db/modules/office-am-buy-v1.sql` (already listed, not run yet) now also lets the Deputy OD (org chart
row `head-c_sasateam`, read only when org-lines-v1 is installed) and the COO read and approve a private "buy new" job.
No new table. Tests: `packages/core/test/deputy-ops-director.test.ts`.

Not done: the Operations Director's work score board still counts operations work of both sides, because the score
records carry the company but not the site's side. Splitting it needs the side added to each operations score record.
