-- Part U (Fitri package, 13-14 Nov 2026): inventory control records: stock count sessions with their lines and
-- variance decisions, urgent passes during a freeze, Monday week closes, book adjustments, disposal cases, company
-- item damage charges and the monthly inventory report. Separate reviewed module; never run implicitly. NOT yet in
-- db/release-manifest.json: the CEO-run migration (infra/run-db-migration.sh) installs it.
-- Wall: rows of the store's company (or, for a damage charge, the person's employer), visible to whoever may see that
-- company, as stock_items and stock_requests. Identity is immutable, history is append-only, nothing is deleted.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.inventory_recs (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'kind' IN ('settings','count','urgent','weekClose','adjust','disposal','charge','report')),
  CHECK (jsonb_typeof(data->'history') = 'array')
);
CREATE INDEX IF NOT EXISTS inventory_recs_company_idx ON prima.inventory_recs (company_id);
ALTER TABLE prima.inventory_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.inventory_recs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.inventory_recs;
CREATE POLICY company_wall ON prima.inventory_recs
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));

CREATE OR REPLACE FUNCTION prima.inv_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Inventory records are never deleted' USING ERRCODE = '23514'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind' THEN
    RAISE EXCEPTION 'Inventory record identity is immutable' USING ERRCODE = '23514';
  END IF;
  -- History: unchanged, or exactly one entry appended with the old entries untouched.
  IF NOT (NEW.data->'history' = OLD.data->'history'
          OR (jsonb_array_length(NEW.data->'history') = jsonb_array_length(OLD.data->'history') + 1
              AND (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) = OLD.data->'history')) THEN
    RAISE EXCEPTION 'Inventory record history is append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inv_guard ON prima.inventory_recs;
CREATE TRIGGER inv_guard BEFORE UPDATE OR DELETE ON prima.inventory_recs FOR EACH ROW EXECUTE FUNCTION prima.inv_guard();
GRANT SELECT, INSERT, UPDATE ON prima.inventory_recs TO prima_app;
COMMIT;
