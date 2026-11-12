# One item register for the whole group

Fauzan, 6 Nov 2026: "Create one system for all type off things in the whole organisation", with Fitri's
implementation paper *Kertas Pelaksanaan Prima: Uniform dan Peralatan* v1.0 (6 Nov 2026) as the specification.

Status: **draft, sample data only**. Not merged, not migrated, not deployed. SQL Account is not connected.

## What it covers

Every physical thing the group must follow, in every company: uniforms, shoes (one pair), vests, torchlights, radios,
phones, patrol devices, body cameras, IT devices, office items, furniture, cleaning stock, safety gear and tools.

Not covered: firearms, ammunition and other controlled items. They stay in the Arms Control vault records (the
register refuses item types whose names say pistol, senapang, peluru, ammunition and so on). No automatic pay
deduction, purchase or tax filing.

## How it works (paper sections 2 to 10)

| Paper rule | Built as |
| --- | --- |
| One identity for life | `PhysicalItem.token`: server-made `P1-` + 15 random + 1 check character (Crockford base 32). Never changes on sale, move, repair or return; retired, never reused, after disposal. |
| Identity, SKU, owner/holder, condition kept apart | `skuId`, `ownerPartyId`, `custody` (one active holder and place), `state`, `condition` are separate fields. |
| SERIALIZED, BULK, KIT | `ItemSku.tracking`. BULK is `ItemLot` (quantity). A KIT lists its parts; only the parts are counted and checked. |
| Supplier barcode is not a unit ID | Kept as `supplierBarcodes` on the SKU only. |
| Label: opaque, no names, prices or owner | The label carries only the token. Printed as Code 128 or a QR code of the same ID, plus the typed ID, SKU and size. |
| Barcode, QR or RFID (Fauzan, 6 Nov 2026) | Each company's manager chooses (`settings.tagMethod`, with a reason, audited; default barcode). Every scan box accepts all three, so another company's labels still scan. RFID is optional per item (`item.rfid`): one tag per item, replace or remove only with a reason, recorded in the history. The printed ID stays the identity and the backup. Reader lists can be pasted for counts and receipts (`count.scanMany`, `move.receiveScan`). A product barcode is never read as a tag. |
| Four sale papers before ownership (Fauzan, 6 Nov 2026) | Ownership on a sale passes only with: the receipt, the seller's invoice (seller Finance, scanned PDF/JPEG/PNG), the buyer's payment slip (buyer Finance, after the invoice) and the buyer's letter of acknowledgement (buyer's manager, not the person who checked the goods in, only after every unit is checked). The letter is made from the receipt and acknowledges only items received in good order. A paper is replaced only with a reason; all stay on record. Papers are stored once by fingerprint (`item_docs`, append-only) and open only to seller and buyer. Ownership cannot be dated before the last paper. Amounts are never entered or invented here. |
| After-sale care (Fauzan, 6 Nov 2026) | Even after a sale the seller looks after each unit's health, maintenance and life as a service, and the owning company monitors the same list (After-sale care tab): condition, last check, next service due, age and expected end of life, services done, open requests. Service interval and expected life are set per item type by a central store manager with their source (`sku.care`); none is assumed ("interval not set"). The seller records service checks (`item.service`), the owner asks for service (`service.request`, a case the seller answers). Neither moves the item nor changes the owner; a damaged result opens a case for the holder. |
| Seller and buyer both follow the item (Fauzan, 6 Nov 2026) | When Finance records ownership, the buyer becomes owner and both companies are added to `historyPartyIds`. Both see the item's whole life, before and after the sale, with the other company's staff names hidden. Following is read only: the seller cannot act on the buyer's item. |
| OM scans to receive (Fauzan, 6 Nov 2026) | `move.receiveScan`: the receiving store, the site supervisor or the Operations Manager / Regional OM of the site's area scans each item; each scanned unit still in transit is received on its movement. Unscanned units stay waiting. The sender can never receive. |
| Guard confirms on the shared post device with a face check (Fauzan, 6 Nov 2026) | `device.confirm` on the post's shared device: staff number + face check, then scan the item. Only the guard the item was handed to can confirm it; a wrong face, a photo held up or no picture leaves it waiting. Waiting items are shown only after the face check (`devicePending`). |
| IT devices, rented devices and other assets | The same rule: the receiving company checks in what arrived, never the sender; a person then confirms their own. Sample MV-0003 is a Merdeka laptop rental waiting for Sasa. |
| Scan does not grant access | `resolve()` checks the user's companies; links and unknown payloads are refused without opening. |
| Sale Goodwill to Sasa | `move.create` (sale) → scan units (`move.add`, reserved) → `move.dispatch` (in transit) → `move.receive` per unit by a different person of the receiving company (received / damaged / missing / wrong item; cases open; never a false full receipt) → `move.ownership` by Finance with date and sale terms. |
| Rental, loan, transfer, supplier return | Rental/loan keep the owner and record the due-back date. Transfer stays in one company (site to site via transit). Supplier return must point at the original sale; ownership does not change on receipt. |
| Guard returns a Sasa-bought item | Back to the holding company's store, quarantine; owner unchanged. |
| Handover confirmed by the person | `issue` sets `pendingAck`; only that person confirms or disputes in their own sign-in. |
| Site check moves nothing | `observe` records an event; wrong place or serial mismatch opens a case. |
| Repair, replacement, size swap | Repair out/back via quarantine. Replacement is a new ID linked both ways. |
| Loss and disposal | Reported, then a manager who did not open the case decides; `writeOff: finance_to_decide`. Never a pay deduction. |
| Counts | Snapshot at the start; not scanned = "not found yet" case; items moved after the start are listed separately; nothing is adjusted. |
| Concurrency and double taps | Every write carries a request id (same id + same change = first result; different change = refused); per-item locks; version checks. |
| SQL outbox | `ItemSyncJob` per book, document type, source and revision, with payload hash. Always `not_ready` with reasons. No sending code exists. |
| Reconciliation | Board checks: in transit, ownership to record, one-sided documents, overdue rentals, unconfirmed handovers, negative stock, open cases, unverified opening balances. |
| Uniform allowance (Fauzan, 6 Nov 2026) | Each guard gets at least 2 and at most 3 uniform pieces a year, usually 1 every 6 months (`UNIFORM_RULE`). Counted per person over the last 12 months; one unit counts once even if handed over again; a uniform set counts as one piece. A piece within 6 months of the last needs a reason (kept in the audit trail). A 4th or 5th piece in 12 months is allowed only when the guard pays, with the receipt number and amount recorded (`UniformRecord` kind `paid`, never taken from pay); a 6th is refused. A company manager records pieces given before the register (kind `past`) for one guard or in bulk for a site (latest shift), zone (branch state) or region; each guard is checked on its own and skipped if it would go over 3 free pieces or already has an entry that day. Uniforms tab for the store, managers and group leaders; the guard sees their own count. |
| Company walls | Rows carry `partyIds`; another company's people are shown as "a <company> staff member"; another company's label returns "not found". |

## Who does what (assumptions to confirm)

| Role | Can |
| --- | --- |
| Procurement storekeepers | Run the Goodwill and head-office stores. See other companies only through their monitor grant (view). |
| Procurement executive, OGM, Operations Director | Manager for Goodwill: decide losses and disposals. |
| Company manager | Manager for their company. |
| Admin executive | Store for their company. |
| Supervisor, patrol officer | Hand over, take back, transfer, receive and check at their own sites. |
| Operations Manager, Regional OM | The same at every site in their states or regions, in every company with sites there. |
| Company manager (and IT manager for Merdeka) | Choose barcode, QR or RFID for the company. |
| Finance, Finance Director | Record SQL item codes per book, record when ownership passes, see the outbox. |
| IT | IT devices only; owned by Merdeka Network; one IT asset = one item record. |
| Guards and staff | See and confirm their own items. |
| CEO, group leaders, ACT head | See everything, change nothing. |
| Arms Control, CMS | Not in this register. |

## Decisions still needed (paper section 14)

- **D01** Fauzan, 6 Nov 2026: "Sasa Security" in the paper is an example; the buyer is whichever group company buys.
  Decided by Fauzan, 11 Nov 2026 (E11): **one SQL Account book per company**, and Goodwill Empire Sdn Bhd is on the
  company list. In Prima the item register's company list is the central entities (PWVSB, Merdeka Network, Goodwill
  Empire, `items.ts` CENTRAL_PARTIES) plus every company master record; Goodwill keeps its structural id `goodwill` and,
  as a central employer, has no company master record (the same as PWVSB and Merdeka). Each company's legal name,
  registration number and book id are entered by Finance in Items, Finance and SQL (`book.set`), verified by a second
  Finance person; a book id already recorded for another company is refused. Real company master records are data: they
  come from the real-data file read by db-setup on an empty database (`scripts/build-real-data.mjs`, `PRIMA_REAL_DATA`),
  never from code.
- **D02** Fauzan, 6 Nov 2026: ownership passes to the buyer, and seller and buyer both monitor each item's lifecycle.
  Fauzan, 6 Nov 2026: the trigger is all of receipt, invoice, payment slip and a letter of acknowledgement of the
  items received. Finance then records ownership.
- **D03 to D10** Which categories are per unit, label printer and scanners, SQL version and modules, item codes and
  accounts per company, approval limits, rental rules, pilot sites, retention. None decided.

## Not built yet

- SQL Account adapter (paper Phase 2), U13 to U19 against real books.
- Offline scan drafts (paper suggests online-only for Phase 1).
- Phone camera scanning works only where the browser reads codes (Android Chrome). On iPhone the ID is typed or a
  Bluetooth/USB scanner is used. RFID readers work as keyboard readers or by pasting their list; no reader is
  connected or tested.
- Face check: like clock-in, the test version simulates the result and the live API accepts the device's result.
  Prima's own server-side engine (draft PR #76, off by default) replaces this when merged, so clock-in, the guard
  phone and the post device share one engine. Not ready for live use until then.
- Linking the old `StockItem`/`StockIssue` store and PR #69 site kits to unit IDs (Phase 1 says do this step by step).
- Migration of real opening balances.
- Uniform payments by guards: the receipt is recorded, but Finance does not yet check it against cash received. Zone means the guard's branch state (assumption).

## Database

`db/modules/item-register-v1.sql` is **proposed**, not applied and not yet tested on PostgreSQL. Until a separately
authorized migration applies it, the API reads nothing from these tables and refuses every save with a plain message.
`apps/api/src/item-register-readiness.ts` checks the tables, forced row-level security, the wall policy and that
history and request ids are append-only. It also adds `item_settings` (each company's barcode, QR or RFID choice), a unique RFID tag index, and a read-only `item_history_read` policy so a company following an item can read its earlier events and cases.

## Tests

- `packages/core/test/item-register.test.ts`: 27 tests (U01-U10, U12, U13, U20, U21, counts, loss and disposal, IT devices,
  seller and buyer following, RFID, tagging choice, OM scan receipt, IT laptop check-in, shared device face confirm, the
  four sale papers before ownership, after-sale care).
- Browser check of the test version (desktop and phone): `/mnt/project-files/item-register-uat/`.
- Not run: PostgreSQL row-level security for the new tables (no database in this environment).


### Reviewed defect repairs (pre-activation)

Bulk receipts now retain a separate received lot ID on each movement line. Finance changes only that allocation, not all lots matching a SKU. An older merged receipt without an allocation, or an allocation whose quantity, owner or holder has changed, requires reconciliation and is refused rather than guessed. Rentals and other sellers remain separate.

A kit remains unavailable until all components have arrived in acceptable condition. Handover locks and checks each required component, including custody, condition and pending confirmation. Reissuing a garment already counted for the same person in the allowance window does not request another payment or early-issue justification. This repair does not authorize actual uniform charging.

Lifecycle event and case authors carry their own company scope, separately from companies following the item. Other-company and unknown historical authors are masked, together with their free-text notes; case resolution authors are checked independently. This intentionally hides cross-company service notes too, because free text may contain staff identities. Structured lifecycle status and service dates remain visible.

The optional PostgreSQL store now calls the existing protection verifier before item-table reads/writes, including required unique-index presence/validity checks. This is a fail-closed catalogue gate, not proof that policy expressions, index definitions, or production RLS behave correctly. The proposed module remains outside startup migrations. No live database activation, migration, server-face enablement, SQL Account posting or payment is part of these repairs.

Regression checks include synthetic MemoryStore workflows, mocked camera cancellation and catalogue responses, plus disposable PostgreSQL16 tests for simultaneous stock receipts, a blocked stale read, replay, company walls, append-only grants and readiness drift. CI runs these against its ephemeral service, never a live database. Physical browser/camera checks and broader operational concurrency/security validation remain required before activation.
