# IT procurement — reconstructed local candidate

This is a NEW build on PR50 0129fc8, not recovery of the lost earlier bundle. Local tests do not establish migration, deployed readiness, supplier ordering, bank verification or completed payments.

## Authority and scope

The application cannot create or change the authoritative `merdeka` Finance-team mapping. Missing mapping means setup required. Only active ordinary Finance staff in that explicitly configured team record PO, invoice checking and payment references. This mandate permits **Merdeka purchases only**; PWVSB and other-company records cannot use it. Existing IT purchase need agreement, three supplier quotations plus ONE evidenced online comparison, and COO then CEO purchase approval remain.

## Normal recording sequence

Assigned Finance reviews the exact approved supplier, item quantities and unit prices, binds the purchase hash and mapping version/hash, and records an immutable PO with its actual issue date and evidence. Inconsistent approved totals must be reconciled, never redistributed automatically. IT records actual dated deliveries and stock location. Partial delivery creates only actual units and remains `partially_received`; full receipt requires every ordered quantity. New stock has unknown serial/purchase/warranty/inspection/service evidence rather than invented dates.

Finance records actual invoice date, supplier, line quantities, unit prices, amount and evidence. Mismatch history is retained. A later receipt does not turn an old invoice check into a match; Finance rechecks it. Normal payment-reference recording requires full receipt and the latest exact match, for the unpaid balance. It does not initiate or verify a bank transfer.

## Separate advance exception

An IT or assigned Finance requester records exact supplier/PO revision/amount/reason/terms. Independent current COO then CEO give fresh decisions; original purchase approval is not reused. Only one unresolved advance exists at a time. Rejected or paid requests release that reservation. Assigned Finance may record the exact approved amount once, while actual goods and invoice obligations remain outstanding. Current approver roles, current mapping and immutable purchase snapshot are rechecked. No automatic supplier communication, payment execution or financial authority expansion.

## Recovery and evidence

Every action uses an owner-bound UUID, exact input hash and packet version. All events are append-only. Repeated identical UUID returns its original receipt; changed or cross-kind reuse is refused. Abandon records a permanent tombstone under the same transaction-held `it-manual:create` lock. Storage-phase errors are uncertain: keep the original UUID and reconcile; never infer success from HTTP status. Database packet, purchase projection, actual stock, audit and terminal receipt require transaction verification in disposable PostgreSQL.

Historical paid/received records remain read-only `legacy_unverified`; no PO, invoice or payment evidence is manufactured. The old pilot payment-before-receipt shortcut is disabled, with explicit regression assertions. The separate historical nonpilot Procurement route is not silently rewritten; tracked packets have their own database guard.

## Release gates

Install only the separately reviewed transactional module and narrow existing-stock guard change under explicit migration approval. Verify catalog bodies, owner/ACLs, exact unconditional triggers, FORCE RLS, indexes and mandatory dependencies. Actual restricted-login PostgreSQL/concurrency/rollback tests and combined browser/UI tests remain mandatory. No production mapping is seeded. No startup auto-install or provider activation occurs.
