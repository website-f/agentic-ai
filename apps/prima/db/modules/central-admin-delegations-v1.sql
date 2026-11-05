-- Central Admin emergency delegation and succession register (masterplan §243, Fauzan 3 Nov 2026: "build all not
-- build"). A pinned module in db/release-manifest.json (id central_admin_delegations, no module prerequisites).
-- Not installed anywhere by this file; only an authorized owner installs it with the reviewed selected-module command.
--
-- One row per delegation line. company_id is the company the post belongs to, or 'pwvsb' for group posts. The company
-- wall applies as on every tenant table; on top of it a RESTRICTIVE wall lets in only people who see mandates (PWVSB
-- legal, group leaders, the company manager) or the delegate named on the line. The service decides who records,
-- approves or ends a line. Rows are never deleted: an ended line stays with its reason. A register only: no access or
-- approval right in Prima comes from a row here. Repeat-safe.
--
-- prima.critical_roles (Arisha main round 5, 3 Nov 2026): the critical-role inventory a delegation line covers. Same
-- company wall; a RESTRICTIVE wall lets in only people who see mandates, for reading and writing.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.delegations (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id)
);
CREATE INDEX IF NOT EXISTS delegations_company_idx ON prima.delegations (company_id);
ALTER TABLE prima.delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.delegations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON prima.delegations FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON prima.delegations TO prima_app;
DROP POLICY IF EXISTS company_wall ON prima.delegations;
CREATE POLICY company_wall ON prima.delegations
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
DROP POLICY IF EXISTS delegations_wall ON prima.delegations;
CREATE POLICY delegations_wall ON prima.delegations AS RESTRICTIVE
  USING (prima.has_wall('mandates') OR data->>'delegateId' = current_setting('app.user_id', true))
  WITH CHECK (prima.has_wall('mandates'));
CREATE TABLE IF NOT EXISTS prima.critical_roles (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id)
);
CREATE INDEX IF NOT EXISTS critical_roles_company_idx ON prima.critical_roles (company_id);
ALTER TABLE prima.critical_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.critical_roles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON prima.critical_roles FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON prima.critical_roles TO prima_app;
DROP POLICY IF EXISTS company_wall ON prima.critical_roles;
CREATE POLICY company_wall ON prima.critical_roles
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
DROP POLICY IF EXISTS critical_roles_wall ON prima.critical_roles;
CREATE POLICY critical_roles_wall ON prima.critical_roles AS RESTRICTIVE
  USING (prima.has_wall('mandates'))
  WITH CHECK (prima.has_wall('mandates'));
COMMIT;
