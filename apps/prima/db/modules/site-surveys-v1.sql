-- Offline site survey form (Fauzan, 4 Nov 2026). PROPOSED module: not in db/release-manifest.json and not installed
-- anywhere. Installing it needs the CEO's go-ahead and the reviewed release path; until then the API answers survey
-- requests with "storage not installed" (503) and phones keep their surveys and try again later.
--
-- Two tenant tables behind the same company wall as every other company record:
--   site_surveys        one survey as sent from the phone; the content fingerprint, surveyor, company and photo list
--                        never change after it arrives, and its status only moves forward.
--   site_survey_photos  one photo file per row; written once, never changed or removed by the app.
BEGIN;

CREATE TABLE IF NOT EXISTS prima.site_surveys (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (id ~ '^svy-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CHECK (data->>'status' IN ('receiving_photos', 'submitted', 'accepted', 'returned')),
  CHECK (data->>'contentSha256' ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS site_surveys_company_idx ON prima.site_surveys (company_id);
CREATE INDEX IF NOT EXISTS site_surveys_data_idx ON prima.site_surveys USING gin (data jsonb_path_ops);

CREATE TABLE IF NOT EXISTS prima.site_survey_photos (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'sha256' ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS site_survey_photos_company_idx ON prima.site_survey_photos (company_id);
CREATE INDEX IF NOT EXISTS site_survey_photos_survey_idx ON prima.site_survey_photos ((data->>'surveyId'));
CREATE INDEX IF NOT EXISTS site_survey_photos_sha_idx ON prima.site_survey_photos (company_id, (data->>'sha256'));

ALTER TABLE prima.site_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.site_surveys FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.site_survey_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.site_survey_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.site_surveys;
CREATE POLICY company_wall ON prima.site_surveys
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
DROP POLICY IF EXISTS company_wall ON prima.site_survey_photos;
CREATE POLICY company_wall ON prima.site_survey_photos
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));

-- A survey arrives as the signed-in person; the database holds the app to the same fixed content the server checked.
CREATE OR REPLACE FUNCTION prima.site_survey_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
DECLARE
  rank_old int;
  rank_new int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.data->>'surveyorId' IS DISTINCT FROM current_setting('app.user_id', true) THEN
      RAISE EXCEPTION 'A survey is recorded only as the person who made it.';
    END IF;
    -- A new survey waits for its photos; only a survey with none (photography not allowed, with a reason) starts submitted.
    IF NEW.data->'review' <> 'null'::jsonb
       OR NOT (NEW.data->>'status' = 'receiving_photos'
               OR (NEW.data->>'status' = 'submitted' AND jsonb_array_length(NEW.data->'photos') = 0 AND length(coalesce(NEW.data->>'noPhotoReason', '')) >= 5)) THEN
      RAISE EXCEPTION 'A new survey starts with its photos still coming.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.company_id <> OLD.company_id
     OR NEW.data->>'contentSha256' IS DISTINCT FROM OLD.data->>'contentSha256'
     OR NEW.data->>'surveyorId' IS DISTINCT FROM OLD.data->>'surveyorId'
     OR NEW.data->>'receivedAt' IS DISTINCT FROM OLD.data->>'receivedAt'
     OR (SELECT array_agg(p->>'sha256' ORDER BY (p->>'n')::int) FROM jsonb_array_elements(NEW.data->'photos') p)
        IS DISTINCT FROM (SELECT array_agg(p->>'sha256' ORDER BY (p->>'n')::int) FROM jsonb_array_elements(OLD.data->'photos') p)
     OR ((NEW.data - ARRAY['photos', 'status', 'review', 'leadNote', 'log']) IS DISTINCT FROM (OLD.data - ARRAY['photos', 'status', 'review', 'leadNote', 'log'])) THEN
    RAISE EXCEPTION 'A sent survey cannot be changed.';
  END IF;
  IF OLD.data->'review' <> 'null'::jsonb AND NEW.data->'review' IS DISTINCT FROM OLD.data->'review' THEN
    RAISE EXCEPTION 'A decided survey cannot be decided again.';
  END IF;
  rank_old := CASE OLD.data->>'status' WHEN 'receiving_photos' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END;
  rank_new := CASE NEW.data->>'status' WHEN 'receiving_photos' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END;
  IF rank_new < rank_old OR (rank_old = 2 AND NEW.data->>'status' <> OLD.data->>'status') THEN
    RAISE EXCEPTION 'A survey status only moves forward.';
  END IF;
  IF rank_new = 2 AND NEW.data->'review'->>'byId' IS NOT DISTINCT FROM NEW.data->>'surveyorId' THEN
    RAISE EXCEPTION 'The surveyor does not decide their own survey.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS site_survey_guard ON prima.site_surveys;
CREATE TRIGGER site_survey_guard BEFORE INSERT OR UPDATE ON prima.site_surveys FOR EACH ROW EXECUTE FUNCTION prima.site_survey_guard();

GRANT SELECT, INSERT, UPDATE ON prima.site_surveys TO prima_app;
-- Photos are written once.
GRANT SELECT, INSERT ON prima.site_survey_photos TO prima_app;
REVOKE UPDATE, DELETE, TRUNCATE ON prima.site_survey_photos FROM prima_app;
REVOKE DELETE, TRUNCATE ON prima.site_surveys FROM prima_app;

COMMIT;
