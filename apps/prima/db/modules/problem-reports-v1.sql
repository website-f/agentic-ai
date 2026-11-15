-- Report a problem (Fitri package N8, 13 Nov 2026). Separate reviewed module; never run implicitly during startup. NOT
-- yet registered in db/release-manifest.json: the CEO-run migration and the combined release review add it. A person
-- reads only their own reports and the replies; IT support (the it_support wall: the IT department) reads every report
-- and writes the replies. Nothing is deleted.
BEGIN;
CREATE TABLE prima.problem_reports (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id)
);
ALTER TABLE prima.problem_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.problem_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY problem_report_read ON prima.problem_reports FOR SELECT
  USING (prima.has_wall('it_support') OR data->>'reporterId' = current_setting('app.user_id', true));
CREATE POLICY problem_report_add ON prima.problem_reports FOR INSERT
  WITH CHECK (data->>'reporterId' = current_setting('app.user_id', true) AND data->>'status' = 'open');
CREATE POLICY problem_report_reply ON prima.problem_reports FOR UPDATE
  USING (prima.has_wall('it_support') AND data->>'reporterId' IS DISTINCT FROM current_setting('app.user_id', true))
  WITH CHECK (prima.has_wall('it_support'));
GRANT SELECT, INSERT, UPDATE ON prima.problem_reports TO prima_app;
COMMIT;
