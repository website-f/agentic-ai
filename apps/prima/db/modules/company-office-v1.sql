-- Company office desks (Fauzan, 2 Nov 2026: 1 Company Manager or GM and 2 to 8 executives per company).
-- Optional module, preparation only. Apply in a separately authorized migration window to the reviewed base schema,
-- after the five release-manifest modules. Not startup SQL and not run by 001_init.sql.
-- Repeat-safe: a second run keeps every row and only replaces this module's own policy and grants.
-- Until it is applied the API reads no desks (every desk shows as not shared out) and refuses to save a split.
-- Catalogue check: apps/api/src/company-office-readiness.ts companyOfficeProblems.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.company_desks (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CONSTRAINT company_desks_id_matches CHECK (data->>'id' = id),
  CONSTRAINT company_desks_company_matches CHECK (data->>'companyId' = company_id),
  CONSTRAINT company_desks_id_format CHECK (id = 'desk-' || company_id || '-' || (data->>'desk')),
  CONSTRAINT company_desks_desk_known CHECK (data->>'desk' IN ('people','clients','tenders','licences','cases','office'))
);
CREATE INDEX IF NOT EXISTS company_desks_company_idx ON prima.company_desks (company_id);
ALTER TABLE prima.company_desks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.company_desks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.company_desks;
CREATE POLICY company_wall ON prima.company_desks
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
-- No DELETE: a desk is reassigned or cleared, never removed, and the audit log keeps every change.
REVOKE ALL ON prima.company_desks FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.company_desks TO prima_app;
COMMIT;
