-- Vehicle accidents, traffic summonses and driver licences (Transport check, 23 Nov 2026: Fauzan "Do the gap").
-- Separate reviewed module; never run implicitly during startup. NOT on db/release-manifest.json: Fauzan runs it with
-- infra/run-db-migration.sh after the release is merged. It needs only the base schema. Until it runs, the Vehicles
-- screen says "Not installed" on these tabs and vehicles still go out (the licence check is skipped).
--
-- One row per accident, summons or licence copy. The files stay in prima.evidence_docs. Nothing is deleted: a record is
-- closed with a note and proof, a licence is replaced by a newer copy, and history only grows.
-- Walls: group staff (PWVSB sign-ins) and people of the row's company. The service narrows it further: Transport, the
-- OGM and group leaders see all; anyone else only the records where they are the driver.
BEGIN;
CREATE TABLE prima.fleet_records (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'kind' IN ('ACCIDENT','SUMMONS','LICENCE')),
  CHECK (data->>'status' IN ('open','closed')),
  CHECK (jsonb_typeof(data->'history') = 'array' AND jsonb_array_length(data->'history') >= 1),
  CHECK (jsonb_typeof(data->'docIds') = 'array')
);
CREATE INDEX fleet_records_company_idx ON prima.fleet_records (company_id);
ALTER TABLE prima.fleet_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.fleet_records FORCE ROW LEVEL SECURITY;
CREATE POLICY fleet_wall ON prima.fleet_records
  USING (current_setting('app.group_user', true) = 'on' OR company_id = ANY (prima.visible_companies()))
  WITH CHECK (current_setting('app.group_user', true) = 'on' OR company_id = ANY (prima.visible_companies()));
-- No DELETE.
GRANT SELECT, INSERT, UPDATE ON prima.fleet_records TO prima_app;

-- What happened never changes; only the status (open to closed, once), the outcome, added files, added history and,
-- once, how a paid summons is recovered from the driver (Fauzan, 23 Nov 2026, rule FLEET-SUMMONS).
CREATE OR REPLACE FUNCTION prima.fleet_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog, prima AS $$
BEGIN
  IF (NEW.data - 'status' - 'outcome' - 'docIds' - 'history' - 'recovery') IS DISTINCT FROM (OLD.data - 'status' - 'outcome' - 'docIds' - 'history' - 'recovery')
     OR (OLD.data->>'status' = 'closed' AND (NEW.data->'status' IS DISTINCT FROM OLD.data->'status' OR NEW.data->'outcome' IS DISTINCT FROM OLD.data->'outcome'))
     OR (coalesce(OLD.data->'recovery', 'null'::jsonb) <> 'null'::jsonb AND NEW.data->'recovery' IS DISTINCT FROM OLD.data->'recovery')
     OR jsonb_array_length(NEW.data->'history') < jsonb_array_length(OLD.data->'history')
     OR NEW.data->'history'->0 IS DISTINCT FROM OLD.data->'history'->0
     OR jsonb_array_length(NEW.data->'docIds') < jsonb_array_length(OLD.data->'docIds') THEN
    RAISE EXCEPTION 'A fleet record is not changed; close it with a note, or file a newer licence' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fleet_record_guard BEFORE UPDATE ON prima.fleet_records FOR EACH ROW EXECUTE FUNCTION prima.fleet_record_guard();
COMMIT;
