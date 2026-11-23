# Store sets and parts, and item-needs requests from the office

Fauzan, 23 Nov 2026: "Inventory manager cannot key in what item for inventory. Like uniform, it break down to
appalet, badges, pants, shoes, belt. So if the guard only need just pant, no place to key in. Also inventory manager
or ogm should be able to start item needs, like we start a new sites, some item needed, inventory or operation
deparment can key in to ask for it."

## Sets and parts (Procurement, Store, "Sets and parts")

- A **set** is a store item that lists its parts and how many of each are in one set, for example
  "Uniform set, guard (M / 32 / 8)" = 1 shirt M, 1 trousers 32, 1 pair of epaulettes, 2 badges, 1 belt, 1 pair of
  shoes size 8.
- Every **part** is an ordinary store item with its own code, size, stock, reorder level, Min/Max, count and life. A
  guard who needs only trousers is asked for the trousers alone.
- A set holds **no stock** of its own. Asking for one set in a site supplies request (Permohonan Pesanan Barang) adds
  one line per part. A set is never issued, bought or asked for as a uniform piece directly.
- Who: the **Inventory Manager** or the **Procurement executive** keeps the sets (storekeepers issue and count). Each
  change needs a reason and is kept with who and when. "Add a new part" creates the part as a store item with stock
  zero; stock comes in only through goods received or a witnessed opening count (unchanged rule).
- A part cannot be a set, and a set cannot contain itself or another set. Sets are size-specific; for a guard who needs
  other sizes, ask for the parts.
- Uniform count (Fauzan, 23 Nov 2026: "A full suit of uniform from shoes to cap. Only 2 are compulsory per year" and
  "Shirt also and badges everything guard wear on body counts"): every worn item counts toward the allowance **item by
  item**, by its name across sizes. Worn items are every item of kind Uniform and every part of a uniform set. Each
  worn item has its own yearly allowance: 3 free (2 compulsory), after that paid by the guard with a receipt, never
  from pay. Where one suit holds more than one of an item (2 badges), the free number is multiplied by that (6 badges).
  A full suit for one guard therefore uses one of each item's allowance.

## Item-needs request started by the office

The site supplies request (Part T) could only be started by the OM or Regional OM covering the site. Now the office
side can start one too, for example the items a new site needs:

| Who | For which sites |
| --- | --- |
| Inventory Manager, Procurement executive | any site their store serves |
| OGM | government sites (Goodwill store) |
| Operations Director | private sites of companies they cover |
| OM / Regional OM (as before) | sites they cover |

- The office requester names the **OM or Regional OM covering the site** who receives and counts the goods there.
  A new site needs its OM set first.
- "Items for a new site" lets a cleaning (KBK) line go without an existing site supply to refill; it goes as a bulk
  delivery, counted at the site.
- Every later step is unchanged: first check (Nepal), OGM confirms, storekeeper checks stock, Procurement decides issue
  or buy (3 quotes + online, COO and CEO approve purchases), PIC check, issue, count at the site. Nobody confirms,
  decides or issues their own request.
- When the confirmer (the OGM, the Operations Director or the deputy the OGM names) starts the request, it is
  approved as asked when it reaches the confirmation step (Fauzan, 23 Nov 2026: "they have the power to start it").

No new table: sets are two optional fields on the store item (`kitParts`, `kitHistory`), requests stay in
`prima.stock_requests` (module uniform-requests-v1). Not merged, migrated or deployed.
