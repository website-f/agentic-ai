# Disposal of goods, PKK and KBK (Part U12-U13)

One case ("Permohonan Pelupusan") covers both store items and site items. The rule is `INV-CONTROL`, the service is
`inventory-control.ts`, and the table is `prima.inventory_recs` (module inventory-control-v1, which the CEO installs).
The audit trail follows SOP-ADM-001 s.8.

| # | Status | Who | What |
|---|---|---|---|
| 1 | Permohonan | Storekeeper (store items) or the OM (site items) | Lines: item, quantity, location, condition now, reason from the policy list. A photo is required for a damaged or unsafe item. Store lines leave usable stock at once ("menunggu pelupusan"). |
| 2-3 | Semakan, Penilaian | Procurement executive (never the requester) | Checks quantity, condition, ownership and contract. Picks the outcome per line: reuse, repair, transfer, recycle, dispose, or return to the client. Reuse, repair, transfer and return go back to stock and stop here. The cause is recorded here (U17); negligence or misuse makes a damage charge. |
| 4 | Kelulusan | OGM or company manager | Needed for a case at RM1,000 or more, any sensitive item (radios, devices), and any sale or auction (U-X7). Under the limit, the reviewer decides. |
| 5 | Kaedah | Procurement executive | Method per line: normal waste, recycle, third-party disposer, sale, destroy, return to the supplier, e-waste or scheduled waste. Each line also needs where it goes. A sale needs a price and a buyer; a third party needs a contractor and a quote. |
| 6 | Pelaksanaan | Storekeeper or the OM who asked | Before and after photos. "Marks removed" is ticked for marked items. The data wipe or radio reset reference is given for electronic items. Destroy, third-party and sale need a witness with a staff number and PIN. |
| 7 | Bukti | Store, OM or Procurement | Receipt (sale), certificate (destroy, third party, e-waste) or DOE note (scheduled waste), each with its number and the file. |
| 8-9 | Selesai | Procurement executive | Prima refuses to close while any evidence, marks tick or wipe record is missing. On close, Finance is told the write-off value. Sale money is recorded by Finance, never by the store. |

- The target is 10 working days from request to SELESAI (U-X11). The board shows the days each case has been open.
- The case downloads as a PDF ("Borang Pelupusan").
- The register is the list of cases on the Inventory board, readable by Finance and ACT.
- Records are kept for 7 years, and nothing is deleted.

Item register units keep their own `dispose` case in the item register (`item-service.ts`) while that module is
uninstalled. The ledger records this (the reason: the register has its own labels and unit states).
