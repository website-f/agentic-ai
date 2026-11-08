-- Nepali EPF and SOCSO recharge (Fauzan, 5 Nov 2026, rule FW-RECHARGE): the owner company holding the permit pays
-- KWSP and PERKESO; the company or branch that used the worker (FWM placements, fw-recruitment-cost-v1.sql) repays it.
-- Each debit note is kept once per company: the owner's copy (to receive) and the user's copy (to repay), each behind
-- that company's own wall. NOT registered in db/release-manifest.json and NOT applied by any script. Installing it is a
-- separate, owner-authorized migration step for the release owner. Same tenant shape and company wall as 001_init.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.fw_stat_charges (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id)
);
CREATE INDEX IF NOT EXISTS fw_stat_charges_company_idx ON prima.fw_stat_charges (company_id);
ALTER TABLE prima.fw_stat_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.fw_stat_charges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.fw_stat_charges;
CREATE POLICY company_wall ON prima.fw_stat_charges
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
GRANT SELECT, INSERT, UPDATE ON prima.fw_stat_charges TO prima_app;
-- Money rows are never deleted; a wrong debit note is cancelled with a reason and issued again.
-- The copy belongs to the owner or the user company it names; amounts are numbers; a repaid or checked note carries
-- the repayment; the person who recorded a repayment never checks it in.
ALTER TABLE prima.fw_stat_charges DROP CONSTRAINT IF EXISTS fw_stat_charges_shape;
ALTER TABLE prima.fw_stat_charges ADD CONSTRAINT fw_stat_charges_shape CHECK (
  data->>'side' IN ('owner','user')
  AND company_id = CASE data->>'side' WHEN 'owner' THEN data->>'ownerCompanyId' ELSE data->>'userCompanyId' END
  AND data->>'status' IN ('issued','paid','received','cancelled')
  AND data->>'period' ~ '^\d{4}-(0[1-9]|1[0-2])$'
  AND jsonb_typeof(data->'total') = 'number' AND (data->>'total')::numeric > 0
  AND jsonb_typeof(data->'lines') = 'array' AND jsonb_array_length(data->'lines') > 0
  AND (data->>'status' NOT IN ('paid','received') OR (jsonb_typeof(data->'paid') = 'object' AND (data#>>'{paid,amount}')::numeric = (data->>'total')::numeric))
  AND (data->>'status' <> 'received' OR (jsonb_typeof(data->'received') = 'object' AND data#>>'{received,byId}' IS DISTINCT FROM data#>>'{paid,byId}'))
);
-- At most one live (not cancelled) debit note per copy, owner, user, branch and month, whatever its id: a retried or
-- racing issue can never charge the same user twice for one month.
CREATE UNIQUE INDEX IF NOT EXISTS fw_stat_charges_one_live ON prima.fw_stat_charges
  (company_id, (data->>'side'), (data->>'ownerCompanyId'), (data->>'userCompanyId'), (coalesce(data->>'userBranchId', '')), (data->>'period'))
  WHERE data->>'status' <> 'cancelled';
-- A debit note never changes after it is issued, apart from its steps, and the steps only move forward:
-- issued -> paid -> received, issued -> received (the owner's copy when the payer could not reach it), issued -> cancelled.
-- A recorded repayment is never rewritten.
CREATE OR REPLACE FUNCTION prima.fw_stat_charges_steps() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $f$
DECLARE
  steps text[] := ARRAY['status','paid','received','cancelled'];
  o text := OLD.data->>'status';
  n text := NEW.data->>'status';
BEGIN
  IF (NEW.data - steps) IS DISTINCT FROM (OLD.data - steps) OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'fw_stat_charges: an issued debit note is not changed; cancel it and issue again' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (n = o AND NEW.data = OLD.data
          OR (o = 'issued' AND n IN ('paid','received','cancelled'))
          OR (o = 'paid' AND n = 'received')) THEN
    RAISE EXCEPTION 'fw_stat_charges: % cannot become %', o, n USING ERRCODE = 'check_violation';
  END IF;
  IF o IN ('paid','received') AND NEW.data->'paid' IS DISTINCT FROM OLD.data->'paid' THEN
    RAISE EXCEPTION 'fw_stat_charges: a recorded repayment is not rewritten' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS fw_stat_charges_steps ON prima.fw_stat_charges;
CREATE TRIGGER fw_stat_charges_steps BEFORE UPDATE ON prima.fw_stat_charges
  FOR EACH ROW EXECUTE FUNCTION prima.fw_stat_charges_steps();
COMMIT;
