-- Org chart: department names chosen in the chart and departments added there (office P141, Fitri 27 Nov 2026: "add
-- more departments, edit the name of the current department, fully custom"). Separate reviewed module; never run
-- implicitly during startup. Not in db/release-manifest.json. Repeat-safe: a second run keeps every row and only
-- replaces this module's own policies and grants.
--
-- One row per unit ('unit-<key>'): a department Prima comes with (d_*, c_*) keeps its key and rights and only takes the
-- name; an added department ('x_<slug>') carries no rights and lists its own people (account ids). Rows hold the name,
-- account ids and the reason only, no personal data. Reading is open to the app role (the chart reads it for everyone
-- who may see the chart). The database keeps the boundary it can check: the writer is the signed-in account, and only
-- the CEO, the Chief of Staff or the Deputy Chief of Staff writes (the same people who name unit heads, org-lines-v1).
-- No DELETE: taking an added department away marks it removed, and the audit log keeps every change.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.org_units (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT org_units_id_matches CHECK (
    data->>'id' = id
    AND id = 'unit-' || (data->>'key')
    AND ((data->>'key') ~ '^(d|c)_[a-z_]{1,40}$' OR (data->>'key') ~ '^x_[a-z0-9_]{1,44}$')
    AND length(coalesce(data->>'label', '')) BETWEEN 2 AND 80
  )
);
ALTER TABLE prima.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.org_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_units_read ON prima.org_units;
DROP POLICY IF EXISTS org_units_insert ON prima.org_units;
DROP POLICY IF EXISTS org_units_update ON prima.org_units;
CREATE POLICY org_units_read ON prima.org_units FOR SELECT USING (true);
CREATE POLICY org_units_insert ON prima.org_units FOR INSERT
  WITH CHECK (
    data->>'byId' = current_setting('app.user_id', true)
    AND EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
      AND ((u.data->>'opsTier' = 'ceo' AND u.data->>'role' IN ('director', 'pwvsb_officer'))
        OR (u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' IN ('cos', 'deputy_cos'))))
  );
CREATE POLICY org_units_update ON prima.org_units FOR UPDATE
  USING (true)
  WITH CHECK (
    data->>'byId' = current_setting('app.user_id', true)
    AND EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
      AND ((u.data->>'opsTier' = 'ceo' AND u.data->>'role' IN ('director', 'pwvsb_officer'))
        OR (u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' IN ('cos', 'deputy_cos'))))
  );
REVOKE ALL ON prima.org_units FROM PUBLIC;
REVOKE ALL ON prima.org_units FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.org_units TO prima_app;
COMMIT;
