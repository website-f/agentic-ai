# Inventory control (Part U, Fitri package)

Owner decisions: Fauzan, 14 Nov 2026 (answers U-X1 to U-X15). Rule `INV-CONTROL` in `packages/core/src/rules.ts`.
Service: `packages/core/src/inventory-control.ts`. Screen: Purchasing, Goodwill store, "Kawalan Inventori".
Database: the new table `prima.inventory_recs` in `db/modules/inventory-control-v1.sql`. It is **not** on the release
list, and the CEO installs it with `infra/run-db-migration.sh`. Until then the screen says the module is not installed,
and every hook below lets the existing flow run unchanged.

Nothing here is deployed, migrated or merged. These are repository source and tests only.

## Who does what (by post)

| Step | Who |
|---|---|
| Count, Monday opening balance, disposal request (store items) | Storekeeper. At a private store this is the admin executive. |
| Variance decision, monthly report, disposal review, method and close | Procurement executive (the "Admin", U-X8). At a private store this is the company manager. |
| Adjustment above RM500, disposal at RM1,000 or more, any sale, sensitive item, urgent pass during a freeze, course buffer, settings | The OGM (Goodwill store) or the company manager (private store). |
| Disposal request for site items | The OM covering the site. |
| Damage charge review | HR (PWVSB HR, the CoS or the DCoS). Never the person who decided the charge. |
| Read | Finance, ACT, the COO, the CEO and group leaders. |

Nobody decides their own work:

- The counter and the witness never decide the variance.
- The requester never reviews or approves a disposal case.
- The PIC check is done by a second store person.

## U1-U2 Counts and the freeze

- **Monthly count** (U-X1): every store is counted once a month, with no freeze.
- **Major count** (U-X10): the whole store is counted at the end of June and the end of December, from 2 to 5 PM.
  - While it is open, every stock movement is refused: issue, goods received, return, site delivery, bulk send and disposal request.
  - The OGM may let **one** urgent move through with a reason. That pass is used once and listed on the count.
- To finish a count, every line is counted and a witness signs in with a staff number and PIN.
- A line that differs from the system figure needs a reason from the list.
- The count sheet is a PDF ("Borang Kiraan Stok").

## U3 Variance and the only book correction

There are two ways to decide a variance:

- **Explain**: the missing issue or receipt was recorded, so no adjustment is needed.
- **Adjust**: one adjustment line is written on the stock card, and `onHand` moves by the variance.
  - Finance is told the write-off value.
  - Above RM500 the adjustment waits for the OGM.

When the same item is short in 3 counts in a row, it is flagged to the OGM.

## U4 Monday opening balance

Each Monday the storekeeper confirms last week's closing balance as this week's opening balance. After that, a
movement dated in a closed week is refused, and it is recorded today with a note.

## U5 Stock card

Every movement of an item is shown in date order with the running balance, read from the existing records. Nothing is
copied. The movements are:

- goods received (good pieces only)
- issues
- returns (good or worn)
- site deliveries and bulk sends
- adjustments
- disposal out and back

## U6-U7 Store stages and stage times (site supplies requests)

See `docs/SITE_SUPPLIES_REQUESTS.md`.

While a request is "Dalam Tindakan", the store moves it through three stages: Stok disediakan, then Disemak oleh PIC
(a second store person), then Sedia untuk dihantar.

Prima keeps the hours for each stage: order, receiving, preparation and delivery.

- In-stock lines are due "Sedia untuk dihantar" within **7 working days** of approval (U-X11), counted on the public holiday calendar.
- A line sent to purchase stops that clock, and the requester sees "dalam pembelian, akan lewat".
- Other stage targets stay empty until the OGM sets them after a month of data (U-X5).
- The stages also show on Work KPIs (adapter `work-kpi-inventory.ts`).

## U8 Buffer and reorder suggestion

- The OGM sets a buffer level per item, with a reason. It starts with the CSG/TNG course uniform sets (U-X6).
- An item below its buffer shows red.
- An item at zero is a critical stock-out. Prima records the date it started and how long it lasted.
- A buffer not reviewed in 90 days is listed.
- The reorder suggestion is weekly usage over 8 weeks x (lead time + 1 week), capped at Max. It is never automatic.
- A course issue (CSG/TNG) is outside the 3 free pieces (U-X6b).

## U9 KPIs and U21 "data as at"

The 7 KPIs, each with its target from SOP-INV-001 (Fauzan may change them):

- stock accuracy (98%)
- unauthorised transactions (0)
- movements recorded complete (100%)
- uniform recorded to a name (100%)
- counts done (100%)
- variances investigated (100%)
- critical stock-outs (0)

There is also "purchase lines that reached the store", which has no target. Every board and report says "Data setakat" with its sources.

## U10 Monthly report

- Prima builds the report per store for each month. It shows, per item:
  - opening and closing balance, with the value where a price is set
  - received, issued, delivered, returned, adjusted and disposed
- It also shows the KPIs with a 3-month trend, and the open items.
- The Procurement executive adds comments and submits it.
- Open items are a warning, not a block, and ACT sees them.
- The OGM reviews the report, and returning it needs a reason.
- A submitted report is frozen. A later correction is a note on next month's report.
- The report is a PDF.

## U11 Paper document to Prima record

| Paper | Prima record |
|---|---|
| Request Form | Site supplies request (Part T T1) |
| Purchase Order (PO) | PurRequest PO |
| Goods Receipt Note | PurRequest GRN with condition (T7), the supplier's DO number and a photo of the DO (U16) |
| Issue Form | StockIssue / site delivery (T5) and the DO PDF (U16) |
| Stock Card | Stock card (U5) |
| Employee Uniform/PPE Record | Uniform record per person (T9) |
| Stock Count Sheet / Stock Take Form | Count session (U1), PDF |
| Variance Report | Variance lines on the count (U3) |
| Return / Disposal Record, Damage-Loss Report | stockReturn and the disposal case (U12) |
| Monthly Management Report | Monthly inventory report (U10), PDF |
| Min/Max record, forecast | Min/Max (T4), buffer and reorder suggestion (U8) |

During the changeover, a photo of the paper form can be attached to the matching Prima record.

## U15 Current, reserved and available stock

When a site supplies line is decided "issue from stock", its quantity is **reserved**.

- Reserved is not a stored number. It is worked out from the open approved lines.
- A new decision, or a direct issue to someone else, can only use the available stock (on hand minus reserved).
- The item row is locked, so two approvals cannot reserve the same last unit.
- The OGM may release a reservation, with a reason.

## U16 Delivery order

- Every site delivery and bulk send prints a DO in two copies (store copy and site copy).
- The OM's bulk count records that the site copy was signed, with its photo.
- Every goods received note needs the supplier's DO number and a photo of the DO. This is a switch, `grnDoRequired`, which starts on.
- The delivery method (own vehicle, courier, supplier, collected) is recorded. There is no rule for it.

## U17 and U-X12 Cause of damage or loss and the damage charge

The manager who decides the case records the cause: normal wear, accident, negligence, misuse or unknown. The
reporter never sets it. The case can be:

- a variance
- a confirmed store loss
- a disposal review

**Negligence or misuse** charges the actual cost to the person's next pay as "Kerosakan / kehilangan barang syarikat":

- The charge is the store price. It is never guessed: with no price, it waits until Procurement enters one.
- A photo is required.
- HR reviews every charge before that month's pay run, and may keep, reduce, spread or cancel it with a reason.
- The person sees the charge in "Barang saya".
- Staff are charged through Prima staff payroll (the same path as the Part P24 stay damage). It is one part per run, and the 50% check is unchanged.
- Guard pay is still in JA, so a guard's charge is marked `ja` for keying into JA.

The legal flag is shown on every charge, and it never blocks the charge: Employment Act 1955 s.24 (written agreement
or the Labour Director General's permission, s.24(4); 50% of wages, s.24(8)).

Unchanged by this rule:

- Extra uniform pieces after the 3 free ones are paid by receipt (T-X5b).
- A lost firearm follows Part R.

## U18 Purchase to store match

For Procurement, Finance and ACT, the match lists:

- GRN lines not linked to a store item
- received quantity different from ordered with no reason
- invoice without goods received
- goods not in the store after the registration days (setting, empty until set)

## U19 Equipment life

The expected life per kind is a setting, empty until set. Items past it show on the store board (items with a person)
and on the monthly site kit check.

## U20 Workshop action items

ACT findings gain the area "Bengkel inventori 2026" and the status "deferred" (tertangguh).

- Only the ACT Director sets it, with a reason and the date it is picked up again.
- A deferred finding is not overdue until that date.
- The real workshop items are entered by ACT through the app.

## U-X14 Office purchases

An office purchase (`forOffice`) needs 3 shop quotes **and 2 online prices**. All other purchases keep 1 online price:

- store and site stock (U-X15)
- IT purchases (Part Q)
- office repairs (Part S)
- arms (Part R)

## Records

Inventory, count and disposal records are kept at least 7 years (U-X9). Prima deletes none of them, and the database
refuses a delete or a history rewrite.
