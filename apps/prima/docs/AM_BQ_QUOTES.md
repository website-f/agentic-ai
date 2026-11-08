# Asset Management: BQ, quotes and award

Requested by Fauzan on 5 Nov 2026 (audit decision 3). Every job that Asset Management sends out to a contractor gets a bill of quantities (BQ), quotes compared line by line, and an approved award. This is a draft. The limits below are **proposed** under rule `AM-BQ` and are waiting for the owner's decision.

## Storage

The BQ is stored on the work order's existing row, at `prima.am_work_orders.data.bq`.
- There is no new table, no migration and no new grant.
- Rows are protected by the existing Asset Management department wall (`asset_read` / `asset_write`).

## Flow

0. **Job details first** (Fauzan, 5 Nov 2026). Before any BQ can be drafted, saved or submitted, the Maintenance Executive or Manager fills in the job details. The list has two parts:
   - **Every job:** what is needed, who asked for it, who it was discussed with, the site visit date, the existing condition, the before photos, the materials and standard required, whether the place is in use, the needed-by date, the urgency, and whether a warranty or defect period applies. Optional: likely cause, access, permits, budget.
   - **The kind of job:** the questions that change the price for that job, such as paint inside or outside, roof material, pipe material and size, single or three phase, aircond type and horsepower, council approval, or grass-cutting frequency.
   - **Site measurements:** at least one measurement for the job.
   - The screen shows what is still missing. Only the Asset Management team can fill it in, and every save is audited (`asset.bq.brief`).

1. **Prepare.** The Asset Management team chooses a job template (painting, roof, plumbing, electrical, air-conditioning, inside renovation, landscaping, new building, building renovation or extension, other) and enters the site measurements. Quantities are taken directly from those measurements, in the same unit, with no conversion factors.
2. **Price.** A line gets a rate only from the median of our own past awarded quotes for the same item and unit, from the last 24 months.
   - Any other rate must give its source, for example an online price or a supplier call.
   - A line with no known price stays empty.
   - No rate is ever invented.
3. **Submit.** Submitting fixes the route:
   - under RM5,000: one quote
   - up to RM50,000: three quotes (RFQ)
   - above RM50,000: open tender
   - A BQ with unpriced lines never goes out on a single quote.
4. **Approve.** The Asset Director approves, and the COO also approves above RM50,000. When the Asset Director prepared the BQ, the COO decides in their place. Nobody decides their own BQ, and every decision needs a reason.
5. **Quotes.** The team records each contractor's rate for each BQ line, plus the total written on the quote. The system then checks each quote:
   - the arithmetic
   - lines left unpriced
   - lines more than 20% dearer than our past price
   - quotes that have expired
6. **Award.** The team asks to award a quote.
   - The quote must price every line, add up, and still be valid.
   - Choosing a quote that is not the lowest complete one needs a written reason.
   - Choosing with fewer quotes than the route needs also needs a written reason.
   - A price above the route's ceiling must go out again on the next route.
   - The Asset Director decides, plus the COO above RM50,000.
   - The final approval sets the contractor and the agreed price on the work order, in the same transaction.
7. **Advice** for the lowest cost. This is advice only, and people decide. It covers:
   - asking suppliers for missing prices
   - bundling other open jobs at the same place
   - warning when a split would avoid a higher route
   - negotiating dearer lines
   - the saving if the lowest quote matched other contractors' lower line prices

## Controls (review, 5 Nov 2026)

- **Who decides.** Nobody who wrote the job details or saved the BQ lines may approve that BQ. Nobody who asked for an award, or recorded the chosen quote, may approve that award. If the Asset Director is one of those people, the COO decides in the Director's place.
- **Two people at once.** Every BQ write locks the work order row (`FOR UPDATE`) and then checks the version. If two people decide at the same moment, only one decision is kept.
- **Reopening.** An approved BQ with no award waiting or made can be reopened, with a reason. Use this when the route was wrong, the scope changed, or prices came in above the route's limit.
  - The quotes so far are kept as an earlier round (the last 10 are kept).
  - The BQ then needs approval again.
- **Work order edits.** After an award is approved, the work order edit form cannot change the contractor or the price. While an award waits for approval, the edit form cannot change them either.
- **Finished work.** No quotes or awards can be added once the work order is marked done.
- **Quote totals.** A quote "adds up" when its line total is within RM1 of the total written on it.
- **Personal data.** Job details may name tenants or contacts. Only Asset Management and its overseers can see them.

## Variation orders (Fauzan, 5 Nov 2026)

"Every price change variation order." After the award is approved, the work order price changes only through a
variation order (VO); the work order edit form still cannot change the contractor or price.

- The Asset Management team raises a VO with the reason, the contractor's VO quote or letter number and 1 to 50 lines.
- A line points at a BQ line (add work, or omit with a negative quantity, never more than is left after earlier VOs)
  or is new work (positive only). A rate other than the awarded rate on that line needs its reason.
- One VO waits at a time. A VO that changes nothing, or takes the price to zero or below, is refused.
- The Asset Director decides with a reason, never the person who raised it (the COO decides when the Asset Director
  raised it). The COO also decides when all approved VOs plus this one exceed `voCooPct` (10%, proposed) of the award,
  or the price after it exceeds `cooAbove` (RM50,000).
- Fauzan, 5 Nov 2026: every VO must get the consent of the Chairman and the CEO. After the approvals above, the CEO
  consents, then the Chairman, each with a reason. Nobody who raised or approved the VO gives consent, and a refused
  consent turns the VO down. Audit actions `asset.bq.vo.consent.ceo`, `asset.bq.vo.consent.chairman` (or `vo.refuse.*`).
- A VO waiting for someone's approval or consent is on that leader's home (Do today for the CEO), with the COO's and
  Chairman's items on their homes too. The team can withdraw a waiting VO with a reason (`asset.bq.vo.withdraw`) and
  raise a corrected one.
- The Chairman's consent sets the work order cost to award + approved VOs in the same locked transaction. Audit actions:
  `asset.bq.vo.ask`, `asset.bq.vo.approve`, `asset.bq.vo.reject` and the consent actions above.
- Advice flags VOs over `voWarnPct` (20%, proposed) of the award, or a price that has passed its route ceiling.

## Building BQs: new building, renovation or extension (Fauzan, 5 Nov 2026)

Modelled on Fauzan's own BQ, *Kerja ubahsuai, menaikkan siling ke 3.5m dan bilik tambahan 4.0m x 6.0m*, and its
drawing set L-00 to L-06. Two job kinds:

- **New building** (`NEW_BUILDING`): a single-storey building on a cleared site. Must measure length, width, floor to
  ceiling height and roof slope; the rest (eave, inside walls, columns, doors, windows, toilets, water points, septic
  tanks, light, socket, aircond and fan points, outside drain) adds lines when measured.
- **Building renovation or extension** (`BUILDING_WORKS`): strip-out, an extra room at one end, walls raised for a
  higher ceiling, a new roof over both, floor raised and retiled, new points, repainting. Must measure the existing
  length and width; every other part is left out when it is not measured (0).
- Both have their own job-detail questions (council approval, drawings, ground, lorry access, supply, site limits such
  as a tree over the roof).

What the draft gives, as in the sample:

- **Lettered sections** (A Kerja awalan & am, B Kerja roboh ..., up to Kemasan & cat). Empty sections are dropped and
  the letters close up. Lines are numbered A1, A2, B1 on screen and in Excel; stored line ids stay L1, L2 for quotes
  and VOs.
- **Item text in Malay**, for contractors, with **the working** in the Catatan column (`(7.2 + 6) x 2 x 1.2`).
  Quantities that need a factor (footing 0.6 x 0.9, fill 0.3m, roof slope) say *anggaran* and write the factor, so the
  contractor and engineer can check them. With the sample's measurements the draft gives the same key quantities as
  Fauzan's sheet: raised wall 31.7 m², ceiling 67.2 m², ridge 12.4 m, ring beam 40.4 m (his 40).
- **(Pilihan)** optional lines (aircond unit, ceiling fans), priced like others; leaving one out after the award is an
  omit VO.
- **Notes and assumptions** (Nota) and a **drawing list**, both editable; a **title** and **place** (Lokasi).
- **Contingency** (5% by default, 0 to 20%). Proposed: it counts towards the estimate, the route and the COO limit, so
  it can never keep a job under a limit, but it is our reserve and not part of the contractor's price. Quotes and
  awards compare line totals. A quote whose written total includes the contingency (the sheet's *Jumlah
  Keseluruhan*) still adds up, and the screen says so.
- No rate is set by the template. Rates still come only from our own past awards or a staff price with its source.

**Excel for contractors.** "Download BQ for contractors (Excel)" builds an .xlsx in the browser with three sheets,
like the sample: *Ringkasan* (section totals carried from the BQ sheet, Jumlah Kecil, contingency % in a yellow cell,
Kontingensi, Jumlah Keseluruhan, contractor name, quote date, valid until, signature), *BQ* (Bil, Keterangan Kerja,
Kuantiti, Unit, Kadar, Jumlah, Catatan / Pengiraan; the Kadar cells are empty and yellow and every Jumlah and section
total is a formula) and *Nota* (notes and drawing list). Our estimated rates are never written into the file. Text is
written as text, never as a formula. No library and no server call: `packages/core/src/am-bq-xlsx.ts`.

Storage is unchanged: the new fields (`title`, `location`, `sections`, `contingencyPct`, `notes`, `drawings`, and per
line `section`, `calc`, `optional`) sit in the same `data.bq` JSON. No migration.

## Helper

The draft helper is rule-based. It uses no AI service and makes no outside calls. Staff screens do not mention AI. Arisha can write fuller drafts later, through the existing reviewed-draft path, once the AI service is approved.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/assets/work-orders/:id/bq` | View the BQ |
| `POST .../bq/brief` | Save the job details |
| `POST .../bq/draft` | Draft from a template |
| `POST .../bq` | Save |
| `POST .../bq/submit` | Submit |
| `POST .../bq/reopen` | Reopen an approved BQ |
| `POST .../bq/approve` | Approve |
| `POST .../bq/return` | Return |
| `POST .../quotes` | Record a quote |
| `POST .../award` | Ask to award |
| `POST .../award/approve` | Approve the award |
| `POST .../award/reject` | Reject the award |
| `POST .../variations` | Raise a variation order (reason, contractor reference, lines) |
| `POST .../variations/:voId/withdraw` | Withdraw a waiting VO (team, reason required) |
| `POST .../variations/:voId/approve` | Approve a variation order (reason required) |
| `POST .../variations/:voId/reject` | Turn down a variation order (reason required) |

## Not yet

- Uploading the drawings (PDF) to the work order: the BQ lists the drawing numbers for now.
- Multi-storey buildings: the new-building template is single storey.
- A contractor register (slice 5).
- Malay wording on this screen.
