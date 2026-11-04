# Procurement reconstruction: explicit local-only module

New implementation on verified PR50 0129fc8, not recovery of lost source. Preserve later rental adapter repair be72c5311522e4335589550e315224162aa89114 during assembly.

## Release gates, not automatic setup

Apply the reviewed base schema (narrow optional receipt admission), then `it-procurement-v1.sql` as a separately approved transaction with its own immutable hash/install ledger. Application startup never installs this module. The base schema hash alone does not prove it is present. Refresh backup and tested recovery evidence, rehearse against existing data with the actual restricted role, and obtain migration/maintenance authority before any live change. Old application schema pins can reject restart after migration; image-only rollback is not a recovery plan.

No authority is seeded. An administrator must separately approve/provision the exact Merdeka Finance team mapping; the app can only read it. Version changes invalidate old PO authority snapshots. There is no provider connection, invoice transmission, bank instruction or actual payment execution.

## Workflow and safeguards

Only Merdeka purchases can enter this recording workflow. Assigned Finance issues the approved immutable PO with its actual issue date and documentary evidence. IT records actual partial receipts and stock; warranty, health and service dates start unknown. Finance checks actual invoice quantities and unit prices against PO and complete receipts, then records the exact remaining payment reference. A mismatched old invoice never becomes matched merely because later goods arrive.

One unresolved advance at a time binds PO revision, supplier, amount, reason and terms. Distinct current COO then CEO approve it afresh; purchase approval is not reused. Finance records the exact approved advance reference; receiving/invoice duties remain open.

Typed exact JSON, immutable history, current actor/config locks, shared admission serialization, input hashes and owner UUID/tombstones prevent altered replays. Deferred checks require terminal receipts and actual newly received stock before commit. Private fixed-path definers, exact catalog identities/ACLs, forced RLS and trigger metadata are checked. The base manual verifier validates the entire optional module whenever any module marker exists.

## Verification limits

Catalog/source mocks are not PostgreSQL execution proof. Restricted lifecycle, raw malformed writes, deferred stock, replay, concurrency, rollback and drift cases must pass disposable PostgreSQL CI before release. No live migration, permission, deletion or provider action was performed by this artifact.
