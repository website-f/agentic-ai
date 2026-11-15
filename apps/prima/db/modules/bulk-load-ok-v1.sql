-- Bulk data load: the CEO's OK on each load (Fitri package N2, Fauzan 11 Nov 2026). Separate reviewed module; never run
-- implicitly during startup. NOT yet registered in db/release-manifest.json: the CEO-run migration and the combined
-- release review add it. Needs org-links-v1 (prima.org_imports). Until it is installed, loads work as before (no OK
-- step). The CEO holds the bulk_load_ok wall: he reads every load's OK and records one, never on his own load (checked
-- in the application and here). An OK is never changed or removed.
BEGIN;
CREATE TABLE prima.org_import_oks (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'byId' IS DISTINCT FROM data->>'importerId')
);
CREATE UNIQUE INDEX org_import_ok_once ON prima.org_import_oks ((data->>'receiptId'));
ALTER TABLE prima.org_import_oks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.org_import_oks FORCE ROW LEVEL SECURITY;
CREATE POLICY org_import_ok_read ON prima.org_import_oks FOR SELECT
  USING (prima.has_wall('bulk_load_ok') OR prima.has_wall('act') OR data->>'importerId' = current_setting('app.user_id', true));
CREATE POLICY org_import_ok_add ON prima.org_import_oks FOR INSERT
  WITH CHECK (prima.has_wall('bulk_load_ok') AND data->>'byId' = current_setting('app.user_id', true));
-- The CEO reads every load to OK it.
CREATE POLICY org_imports_ceo_read ON prima.org_imports FOR SELECT USING (prima.has_wall('bulk_load_ok'));
GRANT SELECT, INSERT ON prima.org_import_oks TO prima_app;
COMMIT;
