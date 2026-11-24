-- FWM department check gaps (Fauzan, 23 Nov 2026: "Do the gap"): one record table for foreign worker exit files,
-- absconding cases, quota applications and the FWM caseload (which FWM Executive owns each company's workers).
-- Separate reviewed module; never run implicitly during startup. NOT registered in db/release-manifest.json: it goes on
-- the after-merge run list and is installed by the CEO-run migration (infra/run-db-migration.sh). Nothing is deleted.
-- Walls: the company wall of 001_init.sql (own companies, or a group role such as FWM). Inside the wall the service
-- decides who records what (FWM records; the OM or company manager raises an absconding case; the FWM Manager sets the
-- caseload). Kind, company and id never change; history is append-only. Passport numbers and IC numbers are never kept.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.fw_gap_recs (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'kind' IN ('exit','abscond','quota','caseload')),
  CHECK (jsonb_typeof(data->'history') = 'array'),
  -- One caseload row per company, and nothing else can pose as it.
  CHECK ((data->>'kind' = 'caseload') = (id = 'fwcl-' || company_id))
);
CREATE INDEX IF NOT EXISTS fw_gap_recs_company_idx ON prima.fw_gap_recs (company_id);
ALTER TABLE prima.fw_gap_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.fw_gap_recs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.fw_gap_recs;
CREATE POLICY company_wall ON prima.fw_gap_recs
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));

CREATE OR REPLACE FUNCTION prima.fw_gap_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Foreign worker records are never deleted' USING ERRCODE = '23514'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind' OR NEW.data->'personId' IS DISTINCT FROM OLD.data->'personId' THEN
    RAISE EXCEPTION 'Foreign worker record identity is immutable' USING ERRCODE = '23514';
  END IF;
  -- Every change adds one line to the history; earlier lines never change.
  IF jsonb_array_length(NEW.data->'history') <= jsonb_array_length(OLD.data->'history')
     OR (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) IS DISTINCT FROM OLD.data->'history' THEN
    RAISE EXCEPTION 'Foreign worker record history is append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fw_gap_guard ON prima.fw_gap_recs;
CREATE TRIGGER fw_gap_guard BEFORE UPDATE OR DELETE ON prima.fw_gap_recs FOR EACH ROW EXECUTE FUNCTION prima.fw_gap_guard();

GRANT SELECT, INSERT, UPDATE ON prima.fw_gap_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.fw_gap_recs FROM prima_app;
COMMIT;
