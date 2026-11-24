-- Monthly reports Prima makes by itself (Fauzan, 23 Nov 2026: "Let system automaticly create every month report needed";
-- decision card the same day: the owner checks, Prima sends on the due day if the owner has not, client reports always
-- wait for a person). Separate reviewed module; never run implicitly during startup. NOT on db/release-manifest.json:
-- run with infra/run-db-migration.sh at go-live with the other modules, only with Fauzan's go-ahead. Needs only the base
-- schema.
--
-- One row per report per month: a company's report and a client's service report stay behind the company wall; a
-- central department's report and the group report for the CEO have no company and are read only by group sign-ins
-- (the service narrows further to the department, the Director Office, ACT and group leadership). The report's papers
-- (PDF) are made from the row when downloaded or sent; a sent report goes into report_submissions / evidence_docs as
-- before. Nothing is deleted. Once sent, a report is not changed.
BEGIN;
CREATE TABLE prima.auto_reports (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (company_id IS NOT DISTINCT FROM data->>'companyId'),
  CHECK (data->>'kind' IN ('company', 'department', 'client', 'group')),
  CHECK ((data->>'kind' IN ('company', 'client')) = (company_id IS NOT NULL)),
  CHECK (data->>'period' ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CHECK (data->>'status' IN ('made', 'sent'))
);
CREATE INDEX auto_reports_company_idx ON prima.auto_reports (company_id);
CREATE INDEX auto_reports_period_idx ON prima.auto_reports ((data->>'period'));
ALTER TABLE prima.auto_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.auto_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY auto_report_wall ON prima.auto_reports
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on'))
  WITH CHECK (company_id = ANY (prima.visible_companies())
              OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on'));
-- No DELETE.
GRANT SELECT, INSERT, UPDATE ON prima.auto_reports TO prima_app;

-- A sent report is not changed, and what it is for never changes.
CREATE OR REPLACE FUNCTION prima.auto_report_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog, prima AS $$
BEGIN
  IF OLD.data->>'status' = 'sent' THEN
    RAISE EXCEPTION 'A sent monthly report is not changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.data->>'kind' IS DISTINCT FROM OLD.data->>'kind'
     OR NEW.data->>'period' IS DISTINCT FROM OLD.data->>'period'
     OR NEW.data->>'defId' IS DISTINCT FROM OLD.data->>'defId'
     OR NEW.data->>'department' IS DISTINCT FROM OLD.data->>'department'
     OR NEW.data->>'clientId' IS DISTINCT FROM OLD.data->>'clientId' THEN
    RAISE EXCEPTION 'What a monthly report is for is not changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auto_report_guard BEFORE UPDATE ON prima.auto_reports FOR EACH ROW EXECUTE FUNCTION prima.auto_report_guard();

-- What each report must have and what is added to it, set by the Director Office (Fauzan, 23 Nov 2026: "At director
-- office adminstrator can set what must have and what need added in each report"). One row per report; it holds part
-- titles and hints only, no figures. Every sign-in reads it (the owner's report is made from it); only group sign-ins
-- write it (the service narrows to the Director Office). No DELETE: a part is switched off, not removed.
CREATE TABLE prima.auto_report_layouts (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (jsonb_typeof(data->'parts') = 'array' AND jsonb_typeof(data->'added') = 'array')
);
ALTER TABLE prima.auto_report_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.auto_report_layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY auto_report_layout_read ON prima.auto_report_layouts FOR SELECT USING (true);
CREATE POLICY auto_report_layout_add ON prima.auto_report_layouts FOR INSERT
  WITH CHECK (current_setting('app.group_user', true) = 'on');
CREATE POLICY auto_report_layout_change ON prima.auto_report_layouts FOR UPDATE
  USING (current_setting('app.group_user', true) = 'on')
  WITH CHECK (current_setting('app.group_user', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON prima.auto_report_layouts TO prima_app;
COMMIT;
