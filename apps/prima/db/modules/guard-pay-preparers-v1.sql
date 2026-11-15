-- Who prepares each company's guard pay run (Fauzan, 11 Nov 2026, item B1). PROPOSED module: not in
-- db/release-manifest.json and not installed anywhere. Installing it needs the CEO's go-ahead and the reviewed release
-- path (infra/run-db-migration.sh pattern). Until it is installed, HR keeps preparing guard pay (the earlier rule).
-- Once installed, only the company executives the Company Manager names (with a reason) prepare and submit; HR and
-- Operations Managers no longer do. Repeat-safe; changes no existing table.
--
-- One tenant table behind the company wall. Append only: every naming is kept, the newest is in force.
-- No UPDATE or DELETE grant.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.guard_pay_preparers (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (length(coalesce(data->>'reason', '')) >= 5),
  CHECK (jsonb_typeof(data->'userIds') = 'array')
);
CREATE INDEX IF NOT EXISTS guard_pay_preparers_company_idx ON prima.guard_pay_preparers (company_id);
ALTER TABLE prima.guard_pay_preparers ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.guard_pay_preparers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.guard_pay_preparers;
CREATE POLICY company_wall ON prima.guard_pay_preparers
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.guard_pay_preparers FROM prima_app;
GRANT SELECT, INSERT ON prima.guard_pay_preparers TO prima_app;
COMMIT;
