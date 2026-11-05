-- Companies run by another company's office (Fauzan, 3 Nov 2026: a Company Manager also manages and monitors companies
-- that sit under him, usually companies without a licence or without enough work of their own, and delegates their
-- work to his staff). One row per run company: which licensed company's office runs it. Only the Chief of Staff (Fauzan,
-- 3 Nov 2026: "cos will set") and the CEO write it.
-- Optional module, preparation only. Apply after db/modules/company-office-v1.sql, in a separately authorized
-- migration window. Not startup SQL and not run by 001_init.sql.
-- Repeat-safe: a second run keeps every row and only replaces this module's own policies and grants.
-- Until it is applied no company is run by another office: every office works only for its own company, and the
-- setting is refused with a clear message.
-- The links hold company ids only (no personal data). They are read for every request before the company wall is set
-- (apps/api/src/db.ts), so reading is open to the app role; writing is the Chief of Staff's or the CEO's, inside their company wall.
-- Catalogue check: apps/api/src/company-office-readiness.ts companyRunLinkProblems.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.company_run_links (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT company_run_links_id_matches CHECK (data->>'id' = id AND data->>'companyId' = id),
  CONSTRAINT company_run_links_not_self CHECK (data->>'runByCompanyId' IS NULL OR data->>'runByCompanyId' <> id)
);
ALTER TABLE prima.company_run_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.company_run_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS run_links_read ON prima.company_run_links;
DROP POLICY IF EXISTS run_links_setter_insert ON prima.company_run_links;
DROP POLICY IF EXISTS run_links_setter_update ON prima.company_run_links;
-- Names used by an earlier review draft of this module (751a045); dropped so a run over that draft leaves only the
-- reviewed policies (Arisha main review, 3 Nov 2026).
DROP POLICY IF EXISTS run_links_ceo_insert ON prima.company_run_links;
DROP POLICY IF EXISTS run_links_ceo_update ON prima.company_run_links;
CREATE POLICY run_links_read ON prima.company_run_links FOR SELECT USING (true);
CREATE POLICY run_links_setter_insert ON prima.company_run_links FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true) AND ((u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' = 'cos') OR (u.data->>'role' = 'director' AND u.data->>'opsTier' = 'ceo')))
    AND id = ANY (prima.visible_companies())
    AND (data->>'runByCompanyId' IS NULL OR data->>'runByCompanyId' = ANY (prima.visible_companies()))
  );
CREATE POLICY run_links_setter_update ON prima.company_run_links FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true) AND ((u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' = 'cos') OR (u.data->>'role' = 'director' AND u.data->>'opsTier' = 'ceo')))
    AND id = ANY (prima.visible_companies())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true) AND ((u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' = 'cos') OR (u.data->>'role' = 'director' AND u.data->>'opsTier' = 'ceo')))
    AND id = ANY (prima.visible_companies())
    AND (data->>'runByCompanyId' IS NULL OR data->>'runByCompanyId' = ANY (prima.visible_companies()))
  );
-- No DELETE: ending the arrangement sets runByCompanyId to null, and the audit log keeps every change.
REVOKE ALL ON prima.company_run_links FROM PUBLIC;
REVOKE ALL ON prima.company_run_links FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.company_run_links TO prima_app;
COMMIT;
