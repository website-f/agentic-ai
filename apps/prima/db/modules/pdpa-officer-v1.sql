-- PDPA officer department check (Fauzan, 23 Nov 2026: "Do the gap"). Separate reviewed module; never run implicitly
-- during startup. NOT yet registered in db/release-manifest.json: Fauzan runs it with infra/run-db-migration.sh after
-- the merge, staging first. Repeat-safe. Nothing is deleted from these tables by the app.
--
-- prima.pdpa_inbox: a staff member's question about their own personal data (D2) and a lost or stolen device IT was
-- told about (B4). The person who asked or reported writes and reads only their own lines; the PDPA wall (the PDPA
-- officer, the Operations Director and group leadership) reads all; only the PDPA wall marks a line handled.
--
-- prima.pdpa_purge_oks: the PDPA officer's weekly OK for the clean-up of data past its keep period (D1). The daily
-- clean-up jobs (apps/api/src/purge-retention.ts and purge-locations.ts, run with the administrator login) delete only
-- while an OK is valid, and add each run to it.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.pdpa_inbox (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('ask', 'device')),
  CHECK (coalesce(data->>'userId', '') <> '')
);
ALTER TABLE prima.pdpa_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.pdpa_inbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pdpa_inbox_read ON prima.pdpa_inbox;
DROP POLICY IF EXISTS pdpa_inbox_add ON prima.pdpa_inbox;
DROP POLICY IF EXISTS pdpa_inbox_handle ON prima.pdpa_inbox;
CREATE POLICY pdpa_inbox_read ON prima.pdpa_inbox FOR SELECT
  USING (prima.has_wall('pdpa') OR data->>'userId' = current_setting('app.user_id', true));
-- A new line is always the person's own and never arrives already handled.
CREATE POLICY pdpa_inbox_add ON prima.pdpa_inbox FOR INSERT
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true) AND coalesce(data->'handled', 'null'::jsonb) = 'null'::jsonb);
CREATE POLICY pdpa_inbox_handle ON prima.pdpa_inbox FOR UPDATE
  USING (prima.has_wall('pdpa')) WITH CHECK (prima.has_wall('pdpa'));
GRANT SELECT, INSERT, UPDATE ON prima.pdpa_inbox TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.pdpa_inbox FROM prima_app;

-- A handled line stays as it was handled: who asked, what and when never change.
CREATE OR REPLACE FUNCTION prima.pdpa_inbox_keep() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data->'userId' IS DISTINCT FROM OLD.data->'userId' OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind'
     OR NEW.data->'at' IS DISTINCT FROM OLD.data->'at' OR NEW.data->'detail' IS DISTINCT FROM OLD.data->'detail'
     OR NEW.data->'askKind' IS DISTINCT FROM OLD.data->'askKind' THEN
    RAISE EXCEPTION 'A PDPA inbox line keeps who asked, what and when';
  END IF;
  IF coalesce(OLD.data->'handled', 'null'::jsonb) <> 'null'::jsonb THEN
    RAISE EXCEPTION 'This PDPA inbox line is already handled';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pdpa_inbox_keep ON prima.pdpa_inbox;
CREATE TRIGGER pdpa_inbox_keep BEFORE UPDATE ON prima.pdpa_inbox FOR EACH ROW EXECUTE FUNCTION prima.pdpa_inbox_keep();

CREATE TABLE IF NOT EXISTS prima.pdpa_purge_oks (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK ((data->>'okOn')::date <= (data->>'validUntil')::date),
  CHECK ((data->>'validUntil')::date - (data->>'okOn')::date < 7),
  CHECK (length(coalesce(data->>'reason', '')) >= 10)
);
ALTER TABLE prima.pdpa_purge_oks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.pdpa_purge_oks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pdpa_purge_ok_wall ON prima.pdpa_purge_oks;
CREATE POLICY pdpa_purge_ok_wall ON prima.pdpa_purge_oks USING (prima.has_wall('pdpa')) WITH CHECK (prima.has_wall('pdpa'));
-- The clean-up jobs run with the administrator (schema owner) login: it reads the OK and adds its run, nothing else.
DROP POLICY IF EXISTS pdpa_purge_ok_owner ON prima.pdpa_purge_oks;
CREATE POLICY pdpa_purge_ok_owner ON prima.pdpa_purge_oks TO CURRENT_USER USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON prima.pdpa_purge_oks TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.pdpa_purge_oks FROM prima_app;

-- An OK keeps who gave it, when and why; only its list of runs grows.
CREATE OR REPLACE FUNCTION prima.pdpa_purge_ok_keep() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.data - 'runs') IS DISTINCT FROM (OLD.data - 'runs')
     OR jsonb_array_length(coalesce(NEW.data->'runs', '[]'::jsonb)) < jsonb_array_length(coalesce(OLD.data->'runs', '[]'::jsonb)) THEN
    RAISE EXCEPTION 'A clean-up OK only gains runs';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pdpa_purge_ok_keep ON prima.pdpa_purge_oks;
CREATE TRIGGER pdpa_purge_ok_keep BEFORE UPDATE ON prima.pdpa_purge_oks FOR EACH ROW EXECUTE FUNCTION prima.pdpa_purge_ok_keep();
COMMIT;
