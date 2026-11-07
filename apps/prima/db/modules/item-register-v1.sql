-- One item register for the whole group (Fauzan, 6 Nov 2026; Fitri's implementation paper v1.0, sections 2-10):
-- item catalogue (SKU), physical units with a permanent label, bulk stock, the append-only event history, movements
-- between companies, stores and sites, cases, counts, the SQL Account outbox (never sent), processed request ids and
-- each company's tagging choice (barcode, QR or RFID) and the scanned sale papers (invoice, payment slip, signed
-- letter of acknowledgement).
--
-- PROPOSED, preparation only. Apply only in a separately authorized migration window to the reviewed base schema.
-- Not startup SQL and not run by 001_init.sql. Not yet run against PostgreSQL in CI: it must pass an RLS test
-- (U20: a company cannot read another company's items even with the label) before it is applied.
-- Repeat-safe: a second run keeps every row and only replaces this module's own policies and grants. Until it is
-- applied the API reads nothing from these tables and refuses every save with a plain message.
-- Catalogue check: apps/api/src/item-register-readiness.ts itemRegisterProblems.
--
-- Each row carries party_ids: the legal entities that may read it (owner, holder and the other side of an open
-- movement). Goodwill Empire is not yet in the company master, so group staff reach its rows through the group flag.
-- The service still checks every role, state and version; the database wall stops a direct read across companies.
BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_skus','item_units','item_lots','item_events','item_movements','item_cases','item_counts','item_sync_jobs','item_requests','item_settings','item_docs','item_uniform_records']
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

-- Readable by a party in the row; the shared catalogue ('*') by every signed-in user.
CREATE OR REPLACE FUNCTION prima.item_parties() RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.visible_companies()
    || CASE WHEN current_setting('app.group_user', true) = 'on' THEN ARRAY['goodwill','pwvsb','merdeka'] ELSE ARRAY[]::text[] END
    || ARRAY['*']
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_skus','item_units','item_lots','item_events','item_movements','item_cases','item_counts','item_sync_jobs','item_settings','item_docs','item_uniform_records']
  LOOP
    EXECUTE format($f$
      CREATE POLICY item_wall ON prima.%1$I
        USING (party_ids && prima.item_parties())
        WITH CHECK (party_ids && prima.item_parties() AND cardinality(party_ids) > 0);
    $f$, t);
  END LOOP;
END $$;
-- After a sale the seller and the buyer follow each item's whole life (Fauzan, 6 Nov 2026). Earlier history rows
-- are append-only and keep their own party_ids, so a company listed in the unit's historyPartyIds may also READ
-- the unit's events and cases. Read only: writes still need the ordinary wall above. The unit row itself is
-- behind its own wall, so this never opens a unit the reader cannot already see.
DROP POLICY IF EXISTS item_history_read ON prima.item_events;
CREATE POLICY item_history_read ON prima.item_events FOR SELECT
  USING (data->>'itemId' IS NOT NULL AND EXISTS (
    SELECT 1 FROM prima.item_units u WHERE u.id = item_events.data->>'itemId' AND (u.data->'historyPartyIds') ?| prima.item_parties()));
DROP POLICY IF EXISTS item_history_read ON prima.item_cases;
CREATE POLICY item_history_read ON prima.item_cases FOR SELECT
  USING (data->>'itemId' IS NOT NULL AND EXISTS (
    SELECT 1 FROM prima.item_units u WHERE u.id = item_cases.data->>'itemId' AND (u.data->'historyPartyIds') ?| prima.item_parties()));

-- Processed request ids are private to the user who sent them.
CREATE POLICY item_wall ON prima.item_requests
  USING (data->>'userId' = current_setting('app.user_id', true))
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true));

-- No DELETE anywhere: a correction is a new event with a reason. History and request ids are append-only.
GRANT SELECT, INSERT, UPDATE ON prima.item_skus, prima.item_units, prima.item_lots, prima.item_movements, prima.item_cases, prima.item_counts, prima.item_sync_jobs, prima.item_settings TO prima_app;
GRANT SELECT, INSERT ON prima.item_events, prima.item_requests, prima.item_docs, prima.item_uniform_records TO prima_app;

-- One label, one item, for life.
CREATE UNIQUE INDEX IF NOT EXISTS item_units_token_unique ON prima.item_units ((data->>'token'));
ALTER TABLE prima.item_units DROP CONSTRAINT IF EXISTS item_units_token_format;
ALTER TABLE prima.item_units ADD CONSTRAINT item_units_token_format CHECK (data->>'token' ~ '^P1-[0-9A-HJKMNP-TV-Z]{16}$');
ALTER TABLE prima.item_units DROP CONSTRAINT IF EXISTS item_units_state;
ALTER TABLE prima.item_units ADD CONSTRAINT item_units_state CHECK (data->>'state' IN ('quarantine','available','reserved','in_transit','with_person','at_site','repair','missing','lost','disposed'));
-- One RFID tag, one item (optional tags, upper-case hexadecimal EPC).
CREATE UNIQUE INDEX IF NOT EXISTS item_units_rfid_unique ON prima.item_units ((data->>'rfidTag')) WHERE data->>'rfidTag' IS NOT NULL;
ALTER TABLE prima.item_units DROP CONSTRAINT IF EXISTS item_units_rfid_format;
ALTER TABLE prima.item_units ADD CONSTRAINT item_units_rfid_format CHECK (data->>'rfidTag' IS NULL OR data->>'rfidTag' ~ '^([0-9A-F]{4}){4,16}$');
-- Sale papers (invoice, payment slip, signed letter): append-only, one row per file fingerprint, PDF/JPEG/PNG only.
ALTER TABLE prima.item_docs DROP CONSTRAINT IF EXISTS item_docs_mime;
ALTER TABLE prima.item_docs ADD CONSTRAINT item_docs_mime CHECK (data->>'mime' IN ('application/pdf','image/jpeg','image/png') AND data->>'kind' IN ('invoice','payment_slip','acknowledgement'));
-- Uniform records (Fauzan, 6 Nov 2026): past pieces entered by a manager, and 4th/5th pieces paid by the guard. Append-only.
ALTER TABLE prima.item_uniform_records DROP CONSTRAINT IF EXISTS item_uniform_records_kind;
ALTER TABLE prima.item_uniform_records ADD CONSTRAINT item_uniform_records_kind CHECK (data->>'kind' IN ('past','paid') AND (data->>'pieces')::int BETWEEN 1 AND 3);
-- Each company's choice of barcode, QR or RFID.
ALTER TABLE prima.item_settings DROP CONSTRAINT IF EXISTS item_settings_method;
ALTER TABLE prima.item_settings ADD CONSTRAINT item_settings_method CHECK (data->>'tagMethod' IN ('barcode','qr','rfid'));
-- One IT asset, one item record.
CREATE UNIQUE INDEX IF NOT EXISTS item_units_it_asset_unique ON prima.item_units ((data->>'itAssetId')) WHERE data->>'itAssetId' IS NOT NULL;
-- Bulk stock never goes below zero.
ALTER TABLE prima.item_lots DROP CONSTRAINT IF EXISTS item_lots_qty;
ALTER TABLE prima.item_lots ADD CONSTRAINT item_lots_qty CHECK ((data->>'qty')::numeric >= 0 AND (data->>'qty')::numeric = trunc((data->>'qty')::numeric));
-- One outbox row per book, document, source and revision.
CREATE UNIQUE INDEX IF NOT EXISTS item_sync_jobs_key_unique ON prima.item_sync_jobs ((data->>'key'));
CREATE UNIQUE INDEX IF NOT EXISTS item_skus_code_unique ON prima.item_skus ((data->>'code'));
COMMIT;
