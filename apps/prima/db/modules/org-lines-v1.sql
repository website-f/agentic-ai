-- Org chart: reporting lines and named unit heads (Fauzan, 23 Nov 2026: "Make sure every head can put who staff under
-- it. So every task can be set correctly."). Separate reviewed module; never run implicitly during startup. NOT yet
-- registered in db/release-manifest.json: Fauzan runs it with infra/run-db-migration.sh after the combined review.
-- Repeat-safe: a second run keeps every row and only replaces this module's own policies and grants.
--
-- One row per placed staff member ('line-<userId>': who they report to) and one per named unit head
-- ('head-<unit>': head and deputy of a central department or central company). Rows hold account ids and the reason
-- only, no personal data. They are read whenever users are read (org-structure.ts withOrgChart), so reading is open to
-- the app role. The service decides who may set what (a head inside their own line or unit; the CEO or the HR Director
-- for anyone; only the CEO or the HR Director names heads). The database keeps the boundaries it can check here: the
-- writer is the signed-in account, nobody places themselves, nobody names themselves head or deputy, and head rows are
-- written only by the CEO, the Chief of Staff or the Deputy Chief of Staff. No DELETE: going back to the standard line
-- writes managerId null, and the audit log keeps every change.
-- Until it is applied the chart shows the standard lines from each job and every change is refused with a clear message.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.org_lines (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT org_lines_id_matches CHECK (
    data->>'id' = id
    AND ((data->>'kind' = 'line' AND id = 'line-' || (data->>'userId'))
      OR (data->>'kind' = 'head' AND id = 'head-' || (data->>'unit')))
  ),
  CONSTRAINT org_lines_not_self CHECK (data->>'managerId' IS NULL OR data->>'managerId' <> data->>'userId'),
  CONSTRAINT org_lines_head_not_deputy CHECK (data->>'headId' IS NULL OR data->>'deputyId' IS NULL OR data->>'headId' <> data->>'deputyId')
);
ALTER TABLE prima.org_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.org_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_lines_read ON prima.org_lines;
DROP POLICY IF EXISTS org_lines_insert ON prima.org_lines;
DROP POLICY IF EXISTS org_lines_update ON prima.org_lines;
CREATE POLICY org_lines_read ON prima.org_lines FOR SELECT USING (true);
CREATE POLICY org_lines_insert ON prima.org_lines FOR INSERT
  WITH CHECK (
    data->>'byId' = current_setting('app.user_id', true)
    AND (data->>'kind' = 'line' AND data->>'userId' <> current_setting('app.user_id', true)
      OR data->>'kind' = 'head'
        AND coalesce(data->>'headId', '') <> current_setting('app.user_id', true)
        AND coalesce(data->>'deputyId', '') <> current_setting('app.user_id', true)
        AND EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
          AND ((u.data->>'opsTier' = 'ceo' AND u.data->>'role' IN ('director', 'pwvsb_officer'))
            OR (u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' IN ('cos', 'deputy_cos')))))
  );
CREATE POLICY org_lines_update ON prima.org_lines FOR UPDATE
  USING (true)
  WITH CHECK (
    data->>'byId' = current_setting('app.user_id', true)
    AND (data->>'kind' = 'line' AND data->>'userId' <> current_setting('app.user_id', true)
      OR data->>'kind' = 'head'
        AND coalesce(data->>'headId', '') <> current_setting('app.user_id', true)
        AND coalesce(data->>'deputyId', '') <> current_setting('app.user_id', true)
        AND EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
          AND ((u.data->>'opsTier' = 'ceo' AND u.data->>'role' IN ('director', 'pwvsb_officer'))
            OR (u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' IN ('cos', 'deputy_cos')))))
  );
REVOKE ALL ON prima.org_lines FROM PUBLIC;
REVOKE ALL ON prima.org_lines FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.org_lines TO prima_app;
COMMIT;
