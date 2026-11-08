-- PDPA personal data register and consent register (real-use PDPA, 5 Nov 2026).
-- PROPOSED separate module: never run implicitly during startup, not in db/release-manifest.json yet.
-- Applied only by the CEO-run migration when Fauzan approves. Mock data only until then.
-- Rows are never deleted: the app role gets no DELETE or TRUNCATE, a retired entry or a withdrawn
-- consent cannot be changed back, and the same PDPA department wall as prima.pdpa_cases applies.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.pdpa_register (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
CREATE TABLE IF NOT EXISTS prima.pdpa_consents (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
-- One settings row: PDPA on/off (Chief of Staff) and the breach register keep period (never under 2 years).
CREATE TABLE IF NOT EXISTS prima.pdpa_settings (id text PRIMARY KEY CHECK (id = 'pdpa'), data jsonb NOT NULL,
  CHECK (data->>'id' = id), CHECK ((data->>'keepYears')::int >= 2));
-- One live consent per person per register entry.
CREATE UNIQUE INDEX IF NOT EXISTS pdpa_consent_live
  ON prima.pdpa_consents ((data->>'registerId'), lower(data->>'subjectRef'))
  WHERE (data->'withdrawn') IS NULL OR (data->'withdrawn') = 'null'::jsonb;
GRANT SELECT, INSERT, UPDATE ON prima.pdpa_register, prima.pdpa_consents, prima.pdpa_settings TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.pdpa_register, prima.pdpa_consents, prima.pdpa_settings FROM prima_app;

CREATE OR REPLACE FUNCTION prima.pdpa_register_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_TABLE_NAME = 'pdpa_register'
     AND coalesce(OLD.data->'retired', 'null'::jsonb) <> 'null'::jsonb
     AND NEW.data IS DISTINCT FROM OLD.data THEN
    RAISE EXCEPTION 'A retired register entry is kept as history and cannot be changed';
  END IF;
  IF TG_TABLE_NAME = 'pdpa_consents'
     AND coalesce(OLD.data->'withdrawn', 'null'::jsonb) <> 'null'::jsonb
     AND NEW.data IS DISTINCT FROM OLD.data THEN
    RAISE EXCEPTION 'A withdrawn consent is kept as history and cannot be changed';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pdpa_register_guard ON prima.pdpa_register;
CREATE TRIGGER pdpa_register_guard BEFORE UPDATE ON prima.pdpa_register FOR EACH ROW EXECUTE FUNCTION prima.pdpa_register_guard();
DROP TRIGGER IF EXISTS pdpa_consents_guard ON prima.pdpa_consents;
CREATE TRIGGER pdpa_consents_guard BEFORE UPDATE ON prima.pdpa_consents FOR EACH ROW EXECUTE FUNCTION prima.pdpa_register_guard();

ALTER TABLE prima.pdpa_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.pdpa_register FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dept_wall ON prima.pdpa_register;
CREATE POLICY dept_wall ON prima.pdpa_register USING (prima.has_wall('pdpa')) WITH CHECK (prima.has_wall('pdpa'));
ALTER TABLE prima.pdpa_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.pdpa_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dept_wall ON prima.pdpa_consents;
CREATE POLICY dept_wall ON prima.pdpa_consents USING (prima.has_wall('pdpa')) WITH CHECK (prima.has_wall('pdpa'));
ALTER TABLE prima.pdpa_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.pdpa_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dept_wall ON prima.pdpa_settings;
CREATE POLICY dept_wall ON prima.pdpa_settings USING (prima.has_wall('pdpa')) WITH CHECK (prima.has_wall('pdpa'));
COMMIT;
