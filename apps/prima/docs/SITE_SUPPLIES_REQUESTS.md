# Site supplies requests (Permohonan Pesanan Barang): Part T

Source: the KBK, PKK Nepal and PKK Local papers Fauzan sent on 13 Nov 2026 (T-D1..T-D9) and his answers T-X1..T-X9
(13 Nov 23:49Z) and round 2 (23:52Z). Code: `packages/core/src/site-supplies.ts`, rule `SITE-SUPPLIES` in
`rules.ts`, screen `apps/web/src/views/SiteSupplies.tsx` (on the OM's Duty page and on the Goodwill store tab).
Effective 18 Nov 2026 (T-X9). Nothing here is deployed or migrated.

## One flow, three contract types

| Contract type | Reference | Started by (entered by the OM) | First check | Bulk count before hand-out | Responsible person for shared kit |
| --- | --- | --- | --- | --- | --- |
| KBK (cleaning) | KBK-YYYYMMDD-NNN | cleaning supervisor | off | off (every site delivery is already counted) | off |
| PKK Nepal | NEP-YYYYMMDD-NNN | the OM, one line per guard | ON (Gov Ops HQ admin executive) | ON | ON |
| PKK Local | PKK-YYYYMMDD-NNN | patrolling officer | off | ON (T-X8b) | ON (T-X8b) |

The switches are settings per store (the OGM for the Goodwill store, the Operations Director for a private store),
each change with a reason and kept in a history. The site's contract type is set by the OM or OGM with a reason; until
set, a site with a cleaning set-up is KBK and any other site is PKK Local (PKK Nepal is never automatic).

## Steps and statuses (the papers' own words)

1. **Baharu / submit**: the OM or Regional OM covering the site enters the lines (store item, size, quantity, purpose,
   optional area, optional guard staff number, KBK: the site supply or equipment it refills). The app builds the
   summary per item and size. One open request per site per item (per guard for a personal piece); the duplicate is
   shown, not added. A KBK line that would take the site above its Max needs a reason.
2. **Dalam Semakan Awal** (Nepal): the HQ admin executive ticks "complete and matches the site roster" or returns it
   with a reason. Guards on the lines who were not on the site's roster in the last 14 days are listed; passing with
   gaps needs a note.
3. **Dalam Kelulusan**: the OGM (or the deputy the OGM names) confirms, changes quantities (each change kept with the
   old figure and the reason) or rejects. Nobody confirms their own request.
4. **Diluluskan**: a storekeeper records what the store can give now (pre-filled from onHand); then the Procurement
   executive decides per line "issue from stock" or "buy". Buy lines become ONE purchase per category, linked back
   (`PurRequest.siteRequestIds`), and follow the normal purchase rules (3 quotes + online, delegation tiers, PO,
   goods received, e-Invoice).
5. **Dalam Tindakan**: the store issues. KBK site lines go out as a cleaning delivery that takes the store stock off
   in the same transaction (item row locked; never below zero) and carries the request id; the supervisor's count
   then flags a short delivery as before. Guard lines go through the Goodwill handover per guard, or, with the bulk
   switch on, in bulk to the OM, who counts what arrived (photo; short or damaged needs a note) before handing each
   piece to the guard (the patrolling officer and guard sign on the OM's phone). Pieces not handed out within 30 days
   (setting) show on the board. A buy line issues only after its purchase is received.
6. **Siap**: when every line is delivered and confirmed, or closed by the OM or the store with a reason. **Ditolak**:
   rejected or cancelled with a reason.

The requester sees every step on the request and on their home page (in-app notices; email later with the Outlook
connection, T-X6). The OGM, Operations Director, COO, CEO and group leaders see every request read-only.

## Changeover (T-X2)

During the changeover staff keep the paper form, email and SharePoint upload AND enter the request in Prima. The
request records "also sent by" (paper / email / SharePoint) with the SharePoint item number or a photo of the paper
form. The setting "Prima only from" is empty; when Fauzan sets the date the other channels are refused. Prima never
connects to SharePoint or Power Automate.

## Other items

- **T4 Min/Max**: `StockItem.maxAt` beside `reorderAt` (the Procurement executive sets both with a reason; history
  kept); `CleaningSupply.minOnHand/maxOnHand` proposed by the OM and approved by the OGM. Screens show "belum
  ditetapkan" (not set), never a default number. New flags: store below Min / above Max; site `below_min` /
  `above_max`.
- **T7 goods received with condition**: per line damaged and wrong-item pieces with a note (photo optional); only good
  pieces are added to the store; the rest show in the e-Invoice match notes as "to return to the supplier".
- **T8**: issues and site delivery lines carry the condition at issue (new / good used), the area and a tag number.
- **T9 uniform record**: one page per guard built from the store issues (item, size, quantity, date, condition, who
  handed over, signed, returned or disposed). The guard sees their own; the OM, OGM, store and HR see it.
- **T10**: site fittings lines may name the responsible person (patrolling officer, supervisor or other).
- **T11 returns**: what a guard or every guard of a site still holds against the original issue; the OM records each
  return through the existing store return (lost or damaged stays a case for the company manager).
- **T12 disposal**: a returned damaged or worn piece is disposed of by someone other than the person who recorded the
  return, with a reason; a marked piece needs "marks removed" ticked and a photo.
- **Uniform allowance (T-X5b)**: 3 free pieces in 12 months; every piece after the 3rd is paid by the person with a
  receipt and amount; no upper limit while `UNIFORM_RULE.paidMaxPerYear` is empty. Never a pay deduction.

## Storage and gates

Rows live in `prima.stock_requests` (module `db/modules/uniform-requests-v1.sql`, Part I) with `kind`
`site_supplies`, `ss_settings`, `ss_site`, `ss_minmax` and `ss_bulk`. No new table. The module is not on the release
list; the CEO installs it. Cleaning deliveries need `cleaning-ops-v1`.

## Tests (synthetic data only)

- Core: `packages/core/test/site-supplies.test.ts` (8): KBK end to end with a quantity change and a short receipt;
  nobody confirms their own request and another company sees nothing; Nepal per-guard lines with the allowance
  (receipt from the 4th, a 6th allowed), first check, bulk count then hand-out and guard signature; a buy line with a
  linked purchase that issues only after goods received, two storekeepers issuing once, never below zero; goods
  received with condition; Min/Max; disposal with marks removed; settings and "Prima only from".
- PostgreSQL: `apps/api/test/site-supplies-pg.test.ts` (2): the "not installed" message, and a KBK request under
  row-level security with two storekeepers issuing at once (one issue), the store stock down with the delivery, the
  company wall, and the store Min/Max update.

## Not done here (outside our control)

- The 18 papers in the policy library: the files must be uploaded by HR through the app (they are owner documents).
- Email to the requester at each step waits for the Outlook connection (T-X6).
- Usage by area in the monthly cleaning report counts deliveries by area; the supervisor's stock count stays per site.

## Part U additions (14 Nov 2026)

- **Store stages (U6)**: while a request is "Dalam Tindakan", the store moves it through three stages: Stok disediakan, then Disemak oleh PIC, then Sedia untuk dihantar.
  - The PIC is a second store person, never the one who prepared the goods.
  - At a store listed in `picStores` (Goodwill), nothing is issued before "Sedia untuk dihantar".
- **Stage times (U7)**: Prima keeps the hours for each stage (order, receiving, preparation, delivery) per request, with the average and slowest on the board.
  - In-stock lines are due ready within 7 working days of approval.
  - A purchase line shows "dalam pembelian, akan lewat" to the requester.
- **Reserved stock (U15)**: "issue from stock" lines reserve available stock. The OGM may release a reservation with a reason.
- **DO (U16)**: the DO prints in two copies (store and site). The bulk count records the signed site copy, and the delivery method is recorded.
- **Freeze (U2)**: nothing is issued while a major count is open, unless the OGM let one urgent move through.
