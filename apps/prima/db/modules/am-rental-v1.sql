-- Part V (Fitri package, 14 Nov 2026; papers V-D6..V-D46, Fauzan's answers V-X11..V-X37): rental home records from
-- vacant to the keys and back: settings, owner companies (bank account, e-Duti Setem role, signatories), unit details,
-- letting files, agents, applications with the deposit request, agreements with stamping, monthly collections, zakat
-- approvals, unmatched bank lines, arrears cases, move-out files, repair reports, panel contractors and old deposits.
-- Separate reviewed module; never run implicitly. NOT yet in db/release-manifest.json: the CEO-run migration
-- (infra/run-db-migration.sh) installs it. Until then the API reads nothing from it and refuses every save plainly.
-- Wall: the Asset Management wall (as am-extras-v1): its team, group leadership and the finance staff who oversee it
-- read; the team, leadership and Finance write (the service decides who does which step); ACT reads only.
-- Identity is immutable, history is append-only, nothing is deleted (stamping records are kept 7 years and more).
BEGIN;
CREATE TABLE IF NOT EXISTS prima.am_rental_recs (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('settings','owner','unitInfo','listing','agent','application','agreement','collection','bankLine','zakat','arrears','moveout','repair','panel','oldDeposit')),
  CHECK (jsonb_typeof(data->'history') = 'array')
);
ALTER TABLE prima.am_rental_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.am_rental_recs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dept_read ON prima.am_rental_recs;
DROP POLICY IF EXISTS dept_insert ON prima.am_rental_recs;
DROP POLICY IF EXISTS dept_update ON prima.am_rental_recs;
CREATE POLICY dept_read ON prima.am_rental_recs FOR SELECT USING (prima.has_wall('asset_read'));
CREATE POLICY dept_insert ON prima.am_rental_recs FOR INSERT WITH CHECK (prima.has_wall('asset_write'));
CREATE POLICY dept_update ON prima.am_rental_recs FOR UPDATE USING (prima.has_wall('asset_write')) WITH CHECK (prima.has_wall('asset_write'));

CREATE OR REPLACE FUNCTION prima.am_rental_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Rental records are never deleted' USING ERRCODE = '23514'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind' THEN
    RAISE EXCEPTION 'Rental record identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.data->'history' = OLD.data->'history'
          OR (jsonb_array_length(NEW.data->'history') = jsonb_array_length(OLD.data->'history') + 1
              AND (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) = OLD.data->'history')) THEN
    RAISE EXCEPTION 'Rental record history is append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS am_rental_guard ON prima.am_rental_recs;
CREATE TRIGGER am_rental_guard BEFORE UPDATE OR DELETE ON prima.am_rental_recs FOR EACH ROW EXECUTE FUNCTION prima.am_rental_guard();
REVOKE ALL ON prima.am_rental_recs FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.am_rental_recs TO prima_app;
COMMIT;
