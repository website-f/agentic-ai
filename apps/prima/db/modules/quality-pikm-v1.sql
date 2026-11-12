-- E9 Quality (PIKM / ISO) records (Fauzan, 11 Nov 2026: "Tell Fitri to build"; handover A5 / E9). Separate reviewed
-- module next to quality-compliance-v1.sql; never run implicitly during startup.
-- NOT registered in db/release-manifest.json and not in the office prima-setup list: installing it on the live database
-- needs the CEO-run migration (approved to build, not yet approved to install).
-- One table for the five PIKM Part 1 records Prima did not keep (docs/QUALITY_AND_COMPLIANCE.md gap list):
--   medical    yearly medical for guards aged 56 and over (7.1)
--   briefing   site risk briefing before deployment (9.4)
--   retention  personnel records kept 7 years after employment ends, and the reviewed clearance after that
--   client_pack the client information pack on request (9.3: licence, registration, membership, insurance)
--   office_system office alarm and CCTV: installer and maintenance records (6.3)
-- Rows carry the company they belong to; the same company wall as 001_init.sql. Records of the group's own office
-- (company 'pwvsb') are readable and writable by group users only. No delete grant: a record is corrected by a later
-- step with a reason, never removed.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.qms_pikm_records (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'kind' IN ('medical', 'briefing', 'retention', 'client_pack', 'office_system'))
);
CREATE INDEX IF NOT EXISTS qms_pikm_records_company_idx ON prima.qms_pikm_records (company_id);
CREATE INDEX IF NOT EXISTS qms_pikm_records_data_idx ON prima.qms_pikm_records USING gin (data jsonb_path_ops);
ALTER TABLE prima.qms_pikm_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.qms_pikm_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qms_pikm_wall ON prima.qms_pikm_records;
CREATE POLICY qms_pikm_wall ON prima.qms_pikm_records
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id = 'pwvsb' AND current_setting('app.group_user', true) = 'on'))
  WITH CHECK (company_id = ANY (prima.visible_companies())
         OR (company_id = 'pwvsb' AND current_setting('app.group_user', true) = 'on'));
REVOKE ALL ON prima.qms_pikm_records FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.qms_pikm_records TO prima_app;
COMMIT;
