-- Guard roster engine (Part O, Fauzan 13 Nov 2026; roster and pay pack v3, 14 Nov 2026). Separate reviewed module;
-- never run implicitly during startup and NOT in db/release-manifest.json: installing it needs the CEO's go-ahead
-- (Part O O1 "Install = CEO go-ahead"). Guard pay stays TRIAL until 1 Aug 2027 (rule PAY-GUARD).
-- Five ledgers stay apart: contract coverage, planned roster, actual attendance and breaks, pay agreements, and
-- compliance evidence. Every table sits behind the company wall, forces row security and gives the app no DELETE.
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_coverage','roster_versions','roster_days','attendance_breaks','roster_evidence','guard_allowances','lump_sum_agreements'] LOOP
    EXECUTE format('CREATE TABLE prima.%I (id text PRIMARY KEY, company_id text NOT NULL, data jsonb NOT NULL)', t);
    EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY roster_wall ON prima.%I USING (company_id = ANY (prima.visible_companies()) OR current_setting(''app.group_user'', true) = ''on'') WITH CHECK (company_id = ANY (prima.visible_companies()) OR current_setting(''app.group_user'', true) = ''on'')', t);
  END LOOP;
END $$;

-- A published roster version is frozen: it may only be marked replaced by a newer version (O4).
CREATE FUNCTION prima.roster_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.data->>'status' IN ('published','replaced') THEN
    IF NEW.data->>'status' <> 'replaced' OR (NEW.data - 'status' - 'replacedById') IS DISTINCT FROM (OLD.data - 'status' - 'replacedById') OR OLD.data->>'status' = 'replaced' THEN
      RAISE EXCEPTION 'A published roster is frozen; make a new version with a reason' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'Company cannot change' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roster_version_guard BEFORE UPDATE ON prima.roster_versions FOR EACH ROW EXECUTE FUNCTION prima.roster_version_guard();

-- Planned status never changes once its version is published; only the actual status is filled in (once, or corrected
-- with a recorded approval). Planned and actual stay separate fields.
CREATE FUNCTION prima.roster_day_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT v.data->>'status' INTO st FROM prima.roster_versions v WHERE v.id = OLD.data->>'rosterVersionId';
  IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.data->>'rosterVersionId' IS DISTINCT FROM OLD.data->>'rosterVersionId' THEN
    RAISE EXCEPTION 'Roster day cannot move' USING ERRCODE = '23514';
  END IF;
  IF st IN ('published','replaced') THEN
    IF (NEW.data - 'actual' - 'actualById' - 'actualCorrection' - 'absDecision') IS DISTINCT FROM (OLD.data - 'actual' - 'actualById' - 'actualCorrection' - 'absDecision') THEN
      RAISE EXCEPTION 'The planned roster is frozen once published' USING ERRCODE = '23514';
    END IF;
    -- The OD/OGM decision on an ABS day is made once (PO-5).
    IF jsonb_typeof(OLD.data->'absDecision') = 'object' AND NEW.data->'absDecision' IS DISTINCT FROM OLD.data->'absDecision' THEN
      RAISE EXCEPTION 'An absence decision is made once' USING ERRCODE = '23514';
    END IF;
    IF OLD.data->>'actual' IS NOT NULL AND NEW.data->>'actual' IS DISTINCT FROM OLD.data->>'actual'
       AND (NEW.data->'actualCorrection'->>'approvedById' IS NULL OR NEW.data->'actualCorrection'->>'approvedById' = NEW.data->'actualCorrection'->>'proposedById'
            OR coalesce(NEW.data->'actualCorrection'->>'evidence','') = '' OR coalesce(NEW.data->'actualCorrection'->>'reason','') = '') THEN
      RAISE EXCEPTION 'A locked actual day changes only with evidence, a reason and the OD/OGM approval' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roster_day_guard BEFORE UPDATE ON prima.roster_days FOR EACH ROW EXECUTE FUNCTION prima.roster_day_guard();

-- Compliance evidence (O12) is a scoped record that is never edited after saving; only ACT's check is added, once.
CREATE FUNCTION prima.roster_no_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(OLD.data->'actCheck') = 'object' OR jsonb_typeof(NEW.data->'actCheck') IS DISTINCT FROM 'object'
     OR (NEW.data - 'actCheck') IS DISTINCT FROM (OLD.data - 'actCheck') OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Saved records are not edited; record a new one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roster_evidence_no_edit BEFORE UPDATE ON prima.roster_evidence FOR EACH ROW EXECUTE FUNCTION prima.roster_no_edit();

-- Lump-sum agreements: the guard's consent is set once and never changed or backdated; a signed agreement can only be
-- withdrawn (v3 section 7).
CREATE FUNCTION prima.lump_sum_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.data->'consent' IS NOT NULL AND jsonb_typeof(OLD.data->'consent') = 'object' AND NEW.data->'consent' IS DISTINCT FROM OLD.data->'consent' THEN
    RAISE EXCEPTION 'Consent is never changed after it is given' USING ERRCODE = '23514';
  END IF;
  IF OLD.data->>'status' IN ('signed','refused','withdrawn') AND (NEW.data - 'status' - 'withdrawnAt') IS DISTINCT FROM (OLD.data - 'status' - 'withdrawnAt') THEN
    RAISE EXCEPTION 'A decided agreement does not change' USING ERRCODE = '23514';
  END IF;
  IF OLD.data->>'status' = 'signed' AND NEW.data->>'status' NOT IN ('signed','withdrawn') THEN
    RAISE EXCEPTION 'A signed agreement can only be withdrawn' USING ERRCODE = '23514';
  END IF;
  IF OLD.data->>'status' IN ('refused','withdrawn') AND NEW.data IS DISTINCT FROM OLD.data THEN
    RAISE EXCEPTION 'A closed agreement does not change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lump_sum_guard BEFORE UPDATE ON prima.lump_sum_agreements FOR EACH ROW EXECUTE FUNCTION prima.lump_sum_guard();

REVOKE ALL ON FUNCTION prima.roster_version_guard(), prima.roster_day_guard(), prima.roster_no_edit(), prima.lump_sum_guard() FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON prima.site_coverage, prima.roster_versions, prima.roster_days, prima.attendance_breaks, prima.roster_evidence, prima.guard_allowances, prima.lump_sum_agreements TO prima_app;
COMMIT;
