-- E10 Staff resignation (Fauzan, 11 Nov 2026: "Tell Fitri to build"; handover A6 / E10). Separate reviewed module;
-- never run implicitly during startup.
-- NOT registered in db/release-manifest.json and not in the office prima-setup list: installing it on the live database
-- needs the CEO-run migration (approved to build, not yet approved to install).
-- An office staff member resigns in Prima (or HR enters the signed letter); HR accepts and confirms the last day; a
-- shorter notice needs the HR Director. Notice: 1 month under 1 year of service, 3 months for 1 year or more, never
-- shorter than Employment Act s.12 (rule HR-RESIGN-NOTICE).
-- Same wall as time slips: the company's own rows, central staff rows (company_id NULL) for group users, and a staff
-- member's own resignation. No delete grant: a resignation is withdrawn by a step, never removed.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.staff_resignations (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'status' IN ('submitted', 'waiver_waiting', 'accepted', 'withdrawn'))
);
CREATE INDEX IF NOT EXISTS staff_resignations_company_idx ON prima.staff_resignations (company_id);
CREATE INDEX IF NOT EXISTS staff_resignations_data_idx ON prima.staff_resignations USING gin (data jsonb_path_ops);
ALTER TABLE prima.staff_resignations ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.staff_resignations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_resignation_wall ON prima.staff_resignations;
CREATE POLICY staff_resignation_wall ON prima.staff_resignations
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true))
  -- A person's own resignation is written only under their own employer (or none): audit P100, the own-row rule alone
  -- would let a row be written under any company.
  WITH CHECK (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR (data->>'userId' = current_setting('app.user_id', true)
             AND (company_id IS NULL OR EXISTS (
               SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
                 AND (u.data->>'homeCompanyId' = company_id OR coalesce(u.data->'companyIds', '[]'::jsonb) ? company_id)))));
REVOKE ALL ON prima.staff_resignations FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.staff_resignations TO prima_app;
COMMIT;
