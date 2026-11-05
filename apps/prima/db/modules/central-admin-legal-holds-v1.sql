-- Central Admin legal hold (masterplan §125, Arisha main 3 Nov 2026: "hold is recorded, files are not frozen"; Fauzan
-- 3 Nov 2026: "proceed work"). A pinned module in db/release-manifest.json (id central_admin_legal_holds, no module
-- prerequisites). Not installed anywhere by this file; only an authorized owner installs it with the reviewed
-- selected-module command.
--
-- prima.legal_holds: one row per record held for a legal matter (table, record id, matter, who, when, released). It
-- holds no reason or matter detail (those stay on the legal matter behind the legal wall). Everyone inside the company
-- wall may read a hold, because the database must see it when they change the record; only people who pass the legal
-- wall add or release one.
-- prima.legal_hold_versions: append only. Before a held record changes, the trigger keeps its previous content here;
-- only the legal wall reads it; nobody updates or deletes it. A held record cannot be deleted.
-- Staff are never stopped from routine work (Fauzan 2 Nov 2026: no legal-only blocks for staff): the record still
-- changes; the earlier content is preserved. Repeat-safe.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.legal_holds (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'tbl' IN ('evidence_docs', 'evidence_photos', 'cases', 'contracts', 'corp_profiles', 'people', 'insurance_claims'))
);
CREATE INDEX IF NOT EXISTS legal_holds_record_idx ON prima.legal_holds ((data->>'tbl'), (data->>'refId'));
ALTER TABLE prima.legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.legal_holds FORCE ROW LEVEL SECURITY;
REVOKE ALL ON prima.legal_holds FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON prima.legal_holds TO prima_app;
DROP POLICY IF EXISTS company_wall ON prima.legal_holds;
CREATE POLICY company_wall ON prima.legal_holds
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
DROP POLICY IF EXISTS legal_holds_add ON prima.legal_holds;
CREATE POLICY legal_holds_add ON prima.legal_holds AS RESTRICTIVE FOR INSERT
  WITH CHECK (prima.has_wall('legal'));
DROP POLICY IF EXISTS legal_holds_change ON prima.legal_holds;
CREATE POLICY legal_holds_change ON prima.legal_holds AS RESTRICTIVE FOR UPDATE
  USING (prima.has_wall('legal'))
  WITH CHECK (prima.has_wall('legal'));

CREATE TABLE IF NOT EXISTS prima.legal_hold_versions (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id)
);
CREATE INDEX IF NOT EXISTS legal_hold_versions_hold_idx ON prima.legal_hold_versions ((data->>'holdId'));
ALTER TABLE prima.legal_hold_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.legal_hold_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON prima.legal_hold_versions FROM PUBLIC;
GRANT SELECT, INSERT ON prima.legal_hold_versions TO prima_app;
DROP POLICY IF EXISTS company_wall ON prima.legal_hold_versions;
CREATE POLICY company_wall ON prima.legal_hold_versions
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
DROP POLICY IF EXISTS legal_hold_versions_read ON prima.legal_hold_versions;
CREATE POLICY legal_hold_versions_read ON prima.legal_hold_versions AS RESTRICTIVE FOR SELECT
  USING (prima.has_wall('legal'));

-- Runs as the caller: the caller can see the hold (company wall) and add a version; nothing else is widened.
CREATE OR REPLACE FUNCTION prima.lh_preserve() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
DECLARE h jsonb; vid text;
BEGIN
  SELECT data INTO h FROM prima.legal_holds
   WHERE data->>'tbl' = TG_TABLE_NAME AND data->>'refId' = OLD.id AND coalesce(data->'released', 'null'::jsonb) = 'null'::jsonb
   ORDER BY id LIMIT 1;
  IF h IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'record % in % is on legal hold' , OLD.id, TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF NEW.data IS DISTINCT FROM OLD.data THEN
    vid := 'lhv-' || md5((h->>'id') || clock_timestamp()::text || random()::text);
    INSERT INTO prima.legal_hold_versions (id, company_id, data)
    VALUES (vid, h->>'companyId',
      jsonb_build_object('id', vid, 'companyId', h->>'companyId', 'holdId', h->>'id', 'tbl', TG_TABLE_NAME, 'refId', OLD.id,
                         'at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                         'byId', current_setting('app.user_id', true), 'before', OLD.data));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION prima.lh_preserve() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence_docs', 'evidence_photos', 'cases', 'contracts', 'corp_profiles', 'people', 'insurance_claims'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lh_preserve ON prima.%I', t);
    EXECUTE format('CREATE TRIGGER lh_preserve BEFORE UPDATE OR DELETE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.lh_preserve()', t);
  END LOOP;
END $$;
COMMIT;
