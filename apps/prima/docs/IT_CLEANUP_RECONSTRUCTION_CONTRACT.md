# Controlled cleanup reconstruction — not live cleanup

New isolated implementation based on verified 473-file Phase1 reconstruction, not an assertion that lost source was restored. Only IT asset/manual-system/manual-intake records are candidates. No user/grant/company-master/audit/receipt archive/delete endpoints. No hard deletes.

Staff means currently authorized IT staff within the existing specific company scope and record authority. A nomination provides documentary origin summary/proof, not a classification grant. Unknown creator, unlinked company, missing assignment, real/mixed origin, protected history, or incomplete dependency coverage holds. Seed/import/manual labels alone never establish demo provenance. Only a current distinct IT Lead—not Manager fallback, record creator or evidence submitter—may attest verified_demo and archive the exact hash. Prior real/mixed classification cannot silently become demo. Restore requires current Lead, active marker nomination/version, exact source hash and fresh conflict checks. Records remain at the same IDs, snapshots/history remain intact and identifiers remain reserved.

Actions via existing authenticated IT action dispatcher: cleanupBoard; cleanupNominate; cleanupDecide; cleanupRestore; cleanupReceipt; cleanupAbandon. Typed inputs/views: packages/core/src/it-cleanup-types.ts. Receipt/abandon accepts {requestId,kind}; UUID+actor+action+normalized input hash bind every terminal outcome. Not-found is not cancellation; explicit serialized abandon writes a rejected tombstone that prevents late original writes. No business payload in browser recovery storage.

## Dependency and writer matrix

- Assets: issue/return/status/maintenance/corrections/inspection, original and replacement rental billing, both legacy purchase receipt and new procurement receipts. Keep reservation scans over ALL rows including archived. Operational board/Plan/manual/operations/correction selectors exclude archived IDs explicitly; Store.get/list remains unfiltered. Fixed-assets/rental historical views retain history with archived identity preserved.
- Systems: access request creation/CEO grant/review/corrections/guidance. Archive candidates only manual kind system; any access/review/access-request history holds. Access Plan keys use access:<accountId>: prefix and are dependencies.
- Intake: checklist/evidence/corrections. Linked identity, completed steps, nonmanual identity or unknown creator holds.
- Protected dependencies: itPurchases.received.assetIds; itProcurementPackets.receipts[].assetIds; itAssetInspections.assetId; itRentalBills.assetSnapshot; itRentalCorrectionRequests originalSnapshot/proposedBill/assetHashes; itRentalReplacements.bill.assetSnapshot; itAccessRequests.accountId. All financial/inspection/access history is conservatively held, even when no longer active.
- Jobs/tickets/import reviews: conservative JSON string reference scan plus system access plan keys and asset owner-group inspection/service plan keys/tag references. Unknown/free-text external relationships cannot be certified absent; Lead must review documentary context. New writes into these tables must reject archived references using the same known reference rules.
- Immutable creation receipts and audit rows are retained, not treated as automatic universal veto. They cannot be edited or removed by cleanup.

Missing referenced module/table, incompatible schema, incomplete definer-owner visibility (including inherited restrictive RLS), or unknown coverage means HOLD. A narrowly scoped SECURITY DEFINER helper returns dependency booleans only, not hidden rows or counts. It does not confer application read privileges.

## SQL installation/readiness

Install base schema, actual procurement module, actual rental correction module, then separate transactional it-cleanup-v1.sql LAST. No blanket reapply/reset or replacement001. Root and dependency triggers take the same it-manual:create advisory lock and guard direct SQL as well as service writes. Current actor row is locked before approval checks. Optional cleanup-trigger compatibility must validate exact function identity/body/owner/ACL/search_path and full trigger shape (including no UPDATE OF/WHEN/args), not ignore extra triggers. Any partial cleanup presence requires complete installed guard coverage; genuinely absent cleanup remains normal baseline operation.

Actual restricted PostgreSQL tests, non-superuser FORCE-RLS owner visibility, mixed writer races, recovery/rollback and browser tests remain release gates. No live archive/data modification follows from local code tests.

## Protective Plan admission, not completion evidence

New inspection/service owner-month jobs carry a server-derived, sorted snapshot of all current nonarchived, nondisposed owner inventory and each canonical record hash. This is a conservative protective scope, not a claim that every listed asset is due, inspected or healthy. A private admission ledger binds the physical job ID, immutable plan key and exact snapshot hash. Shape-valid imported/legacy JSON alone is not proof; legacy ambiguous group references remain held. Tickets/import reviews cannot borrow job proof. Existing plan identity and admitted refs cannot be rewritten; future unrelated company work may select only the remaining live inventory. Date derivation uses the same MYT business date in core and SQL.

A restored record that is subsequently corrected cannot replace the preserved original archive snapshot in this first slice; it reports archive_snapshot_changed and requires separate history reconciliation. Unchanged restored records may receive a new documentary nomination. Hold decisions do not rewrite a prior archive marker. Synthetic MemoryStore cleanup transactions roll back domain and receipt changes on storage failure; this does not assert that unrelated MemoryStore workflows gain database transaction semantics.
