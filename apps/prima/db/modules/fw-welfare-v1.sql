-- Section 240: responsible recruitment and worker welfare checks (arrival fee, passport custody, welfare talks).
-- NOT registered in db/release-manifest.json and NOT applied by any script. Installing it is a separate,
-- owner-authorized migration step for the release owner. Same tenant shape and company wall as 001_init.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.fw_welfare_checks (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'kind' IN ('ARRIVAL_FEE','PASSPORT','WELFARE')),
  CHECK (data->>'status' IN ('clear','open','closed'))
);
CREATE INDEX IF NOT EXISTS fw_welfare_checks_company_idx ON prima.fw_welfare_checks (company_id);
CREATE INDEX IF NOT EXISTS fw_welfare_checks_person_idx ON prima.fw_welfare_checks ((data->>'personId'));
ALTER TABLE prima.fw_welfare_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.fw_welfare_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.fw_welfare_checks;
CREATE POLICY company_wall ON prima.fw_welfare_checks
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
-- No DELETE: a check is closed with a reason, never removed.
GRANT SELECT, INSERT, UPDATE ON prima.fw_welfare_checks TO prima_app;
COMMIT;
