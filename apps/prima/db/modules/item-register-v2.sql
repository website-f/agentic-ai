-- Item register, second part (P85; Fitri's implementation paper v1.0 sections 2, 7, 9 and 10): the label print log
-- (generation, reprint reason and identity check, scan-back), each company's SQL book, the export-only outbox's
-- export files and the SQL Account exports Finance loads for the reconciliation, running references taken under a
-- lock, and the per-person unknown-label limiter. Also tightens the first part: the laundry state, unique movement,
-- shared and case references, one SQL document number per book and document type, money in whole sen, and the
-- evidence kinds Finance attaches.
--
-- PROPOSED, preparation only. Apply only in a separately authorized migration window, AFTER item-register-v1.sql
-- (requires: item_register). Not startup SQL and not run by 001_init.sql. Repeat-safe: a second run keeps every row
-- and only replaces this module's own constraints, policies and grants. Until it is applied the API reads nothing
-- from these tables and refuses every save that needs them with a plain message.
-- Catalogue check: apps/api/src/item-register-readiness.ts itemRegisterV2Problems.
--
-- Nothing here posts to SQL Account: a book's channel can only be 'export_only' until the connection is proved in
-- both books (paper Phase 0, decisions D01, D05, D06). No DELETE grant anywhere.
BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_label_prints','item_sql_books','item_sync_batches','item_sql_snapshots','item_counters','item_scan_denials']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS prima.%1$I (
        id        text PRIMARY KEY,
        party_ids text[] NOT NULL,
        data      jsonb NOT NULL,
        CONSTRAINT %1$s_id_matches CHECK (data->>'id' = id)
      );
      CREATE INDEX IF NOT EXISTS %1$s_party_idx ON prima.%1$I USING gin (party_ids);
      CREATE INDEX IF NOT EXISTS %1$s_data_idx ON prima.%1$I USING gin (data jsonb_path_ops);
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS item_wall ON prima.%1$I;
      REVOKE ALL ON prima.%1$I FROM prima_app;
    $f$, t);
  END LOOP;
END $$;

-- The same wall as the first part: readable by a party in the row (prima.item_parties() from item-register-v1.sql).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_label_prints','item_sql_books','item_sync_batches','item_sql_snapshots','item_counters']
  LOOP
    EXECUTE format($f$
      CREATE POLICY item_wall ON prima.%1$I
        USING (party_ids && prima.item_parties())
        WITH CHECK (party_ids && prima.item_parties() AND cardinality(party_ids) > 0);
    $f$, t);
  END LOOP;
END $$;
-- The unknown-label limiter is private to the person it counts (fingerprints only, never the raw label).
CREATE POLICY item_wall ON prima.item_scan_denials
  USING (id = current_setting('app.user_id', true) AND data->>'userId' = current_setting('app.user_id', true))
  WITH CHECK (id = current_setting('app.user_id', true) AND data->>'userId' = current_setting('app.user_id', true));

-- No DELETE anywhere. SQL exports loaded by Finance are append-only; prints are stamped once when scanned back,
-- export files change status (generated, sent), books are re-verified, counters and the limiter move on.
GRANT SELECT, INSERT, UPDATE ON prima.item_label_prints, prima.item_sql_books, prima.item_sync_batches, prima.item_counters, prima.item_scan_denials TO prima_app;
GRANT SELECT, INSERT ON prima.item_sql_snapshots TO prima_app;

-- Label prints: generation 1 to 31, first print or reprint; a reprint always carries its reason.
ALTER TABLE prima.item_label_prints DROP CONSTRAINT IF EXISTS item_label_prints_shape;
ALTER TABLE prima.item_label_prints ADD CONSTRAINT item_label_prints_shape CHECK (
  jsonb_typeof(data->'gen') = 'number' AND (data->>'gen')::int BETWEEN 1 AND 31
  AND data->>'kind' IN ('first','reprint')
  AND (data->>'kind' = 'first' OR length(coalesce(data->>'reason','')) >= 5));
CREATE UNIQUE INDEX IF NOT EXISTS item_label_prints_gen_unique ON prima.item_label_prints ((data->>'itemId'), ((data->>'gen')::int));
-- SQL books: export only, MYR, Malaysia time.
ALTER TABLE prima.item_sql_books DROP CONSTRAINT IF EXISTS item_sql_books_shape;
ALTER TABLE prima.item_sql_books ADD CONSTRAINT item_sql_books_shape CHECK (
  id = data->>'partyId' AND data->>'channel' = 'export_only' AND data->>'currency' = 'MYR' AND data->>'timeZone' = 'Asia/Kuala_Lumpur');
-- Export files: one reference each, generated then sent (or void).
ALTER TABLE prima.item_sync_batches DROP CONSTRAINT IF EXISTS item_sync_batches_shape;
ALTER TABLE prima.item_sync_batches ADD CONSTRAINT item_sync_batches_shape CHECK (data->>'status' IN ('generated','sent','void') AND data->>'format' = 'prima_csv_v1');
CREATE UNIQUE INDEX IF NOT EXISTS item_sync_batches_ref_unique ON prima.item_sync_batches ((data->>'ref'));
ALTER TABLE prima.item_sql_snapshots DROP CONSTRAINT IF EXISTS item_sql_snapshots_kind;
ALTER TABLE prima.item_sql_snapshots ADD CONSTRAINT item_sql_snapshots_kind CHECK (data->>'kind' IN ('stock_balance','doc_listing'));
ALTER TABLE prima.item_counters DROP CONSTRAINT IF EXISTS item_counters_n;
ALTER TABLE prima.item_counters ADD CONSTRAINT item_counters_n CHECK (jsonb_typeof(data->'n') = 'number' AND (data->>'n')::bigint >= 0);

-- Tightening the first part.
ALTER TABLE prima.item_units DROP CONSTRAINT IF EXISTS item_units_state;
ALTER TABLE prima.item_units ADD CONSTRAINT item_units_state CHECK (data->>'state' IN ('quarantine','available','reserved','in_transit','with_person','at_site','repair','laundry','missing','lost','disposed'));
ALTER TABLE prima.item_units DROP CONSTRAINT IF EXISTS item_units_label_gen;
ALTER TABLE prima.item_units ADD CONSTRAINT item_units_label_gen CHECK (data->'labelGen' IS NULL OR (jsonb_typeof(data->'labelGen') = 'number' AND (data->>'labelGen')::int BETWEEN 0 AND 31));
ALTER TABLE prima.item_docs DROP CONSTRAINT IF EXISTS item_docs_mime;
ALTER TABLE prima.item_docs ADD CONSTRAINT item_docs_mime CHECK (data->>'mime' IN ('application/pdf','image/jpeg','image/png') AND data->>'kind' IN ('invoice','payment_slip','acknowledgement','sql_receipt','book_evidence'));
-- Running references are unique (no listing of a whole table to number one row).
CREATE UNIQUE INDEX IF NOT EXISTS item_movements_ref_unique ON prima.item_movements ((data->>'ref'));
CREATE UNIQUE INDEX IF NOT EXISTS item_movements_commercial_ref_unique ON prima.item_movements ((data->>'commercialRef')) WHERE data->>'commercialRef' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS item_cases_ref_unique ON prima.item_cases ((data->>'ref'));
-- The outbox: known statuses and revision actions; one SQL document number per book and document type.
ALTER TABLE prima.item_sync_jobs DROP CONSTRAINT IF EXISTS item_sync_jobs_shape;
ALTER TABLE prima.item_sync_jobs ADD CONSTRAINT item_sync_jobs_shape CHECK (
  data->>'status' IN ('not_ready','ready','queued','sent','acknowledged','reconciled','rejected','retryable_error','outcome_unknown','manual_review')
  AND coalesce(data->>'revisionAction','insert') IN ('insert','update','reverse')
  AND (data->>'status' NOT IN ('acknowledged','reconciled') OR length(coalesce(data->'dest'->>'docNo','')) > 0));
CREATE UNIQUE INDEX IF NOT EXISTS item_sync_jobs_docno_unique ON prima.item_sync_jobs ((data->>'book'), (data->>'docType'), upper(data->'dest'->>'docNo')) WHERE data->'dest'->>'docNo' IS NOT NULL;
-- Money as whole sen, never a floating-point amount (paper section 6).
ALTER TABLE prima.item_uniform_records DROP CONSTRAINT IF EXISTS item_uniform_records_sen;
ALTER TABLE prima.item_uniform_records ADD CONSTRAINT item_uniform_records_sen CHECK (data->>'amountSen' IS NULL OR data->>'amountSen' ~ '^[0-9]{1,9}$');
COMMIT;
