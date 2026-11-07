-- Foreign worker recruitment steps (Fauzan, 6 Nov 2026, IWAY answer 7): agency licence, embassy confirmation,
-- interview, age check from the passport and the bilingual contract, before travel.
-- NOT registered in db/release-manifest.json and NOT applied by any script. Installing it is a separate,
-- owner-authorized migration step for the release owner. Same tenant shape and company wall as 001_init.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.fw_recruit_files (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'status' IN ('open','cleared','arrived','stopped')),
  CHECK (length(data->>'passportLast4') = 4)
);
CREATE INDEX IF NOT EXISTS fw_recruit_files_company_idx ON prima.fw_recruit_files (company_id);
CREATE INDEX IF NOT EXISTS fw_recruit_files_person_idx ON prima.fw_recruit_files ((data->>'personId'));
ALTER TABLE prima.fw_recruit_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.fw_recruit_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.fw_recruit_files;
CREATE POLICY company_wall ON prima.fw_recruit_files
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
-- No DELETE: a file is stopped with a reason, never removed.
GRANT SELECT, INSERT, UPDATE ON prima.fw_recruit_files TO prima_app;
COMMIT;
