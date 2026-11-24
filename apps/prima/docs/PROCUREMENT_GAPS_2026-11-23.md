# Procurement and the store: department check gaps (23 Nov 2026)

Fauzan, 23 Nov 2026: "Do the gap", after the department check (study note "Procurement and the store: department
check"). Repository source and tests only. Nothing here is merged, migrated or deployed.

No new table and no new database module. The new fields live in the existing purchase record (`prima.pur_requests`,
JSON data): `po.expectedOn` and `submitted`.

| Gap | What is built |
|---|---|
| B1 Own work | Procurement staff have no Home screen; their alert bell, daily summary and Teams/email alerts now carry their own work: the executive sees purchases to quote, approved purchases to order and rejected ones to correct; the storekeeper sees orders to receive; orders past the supplier's date show red to both. The Inventory Manager also sees items at or below the reorder level, counts due and losses to confirm. |
| B2 Work KPIs | Purchases show on Work KPIs for Procurement and Inventory: quoting (request to "sent for approval"), ordering (last approval to order placed) and invoice match (goods received to Finance's match). The COO and CEO approvals and the supplier's delivery are not timed. Targets stay empty until proposed. The Inventory Manager sees the department as its head. |
| B3 Delivery date and supplier record | "Order placed" takes the date the supplier promised (today up to a year ahead; optional). After it passes with no goods, the order is "Late delivery" in red and counted. Each supplier shows its record: orders, delivered on time or late, no date given, open past the date, damaged and wrong pieces, invoice mismatches. |
| B4 Purchase Order PDF | "Download Purchase Order (PDF)" once ordered: buyer, supplier and SSM, quotation ref, order date, deliver-by date, lines, total, approvals, and a note to quote the PO number and send a validated e-Invoice. Read-only; anyone who sees the purchase may print it. |
| B5 Last price paid | Each line for a store item shows the last unit price paid, its purchase and date. It decides nothing. |
| B6 Buy more | A low-stock row offers "Buy more" to Procurement: it fills a new purchase with the reorder suggestion (usage and supplier lead time, Part U8), else up to Max, else an empty quantity. Nothing is bought until it is quoted and approved. |
| B7 Fixes | The PUR-DOA rule text now says 5% (Fauzan lowered 10% to 5% on 28 Oct 2026). Purchase numbers come from the highest number used, under a per-company lock (checked on PostgreSQL), so two purchases raised at once never share a number. |
| Found on the way | The storekeeper's "Goods received" button sent no DO number or photo, which Part U16 requires, so it always failed. It now asks per line for received, damaged and wrong pieces, the DO number and a photo or scan of the DO. |

Decisions D1 to D5 from the study note (Inventory Manager check, one supplier list, online platforms, store and item
register link, urgent path) are not built here; they wait for Fauzan's answer.

## Decisions D1 to D5 (Fauzan, 23 Nov 2026: "Yes, all five as recommended")

- **D1 Inventory Manager check.** Every purchase gets a check by the Inventory Manager, with a comment, before the COO.
  Left out when the Inventory Manager raised or sourced it, on the urgent path, or when no Inventory Manager account is
  active. The Inventory Manager needs company access lines like the executive's to see each company's purchases.
- **D2 One group supplier list.** A new supplier goes on one group list (kept under PWVSB); Finance verifies the bank
  and reviews it once, and every company can take quotes from it. Older per-company suppliers still work for their own
  company. Adding the same SSM number twice to the group list is refused.
- **D3 Online platform as the source.** Procurement may choose an online listing (Shopee, Lazada) instead of a supplier
  quote, up to a limit the CEO sets on the Approval limits panel (empty = off). Finance approves paying the platform
  before Procurement orders; at the invoice step the platform receipt is attached instead of an e-Invoice. The three
  quotes and the online price check still apply.
- **D4 Store and item register.** See `docs/ITEM_REGISTER.md`, "Link with the store".
- **D5 Urgent path.** Procurement ticks Urgent with a reason; the COO approves alone. Missing quotes and online prices
  follow within 3 working days (rule PUR-DOA `urgentQuotesWorkingDays`), with a reminder and then a late alert. The
  CEO sees it on the Executive Home after approval and marks it seen.

No new database module: all new fields sit in the existing JSON data of purchases, store items and the group Finance row.
