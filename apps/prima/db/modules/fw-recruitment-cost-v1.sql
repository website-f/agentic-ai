-- Recruitment cost for foreign workers working under another company's or a branch's job (Fauzan, 3 Nov 2026):
-- placements recorded by FWM, the two rates set by the Finance Director or CEO, and the monthly charges.
-- NOT registered in db/release-manifest.json and NOT applied by any script. Installing it is a separate,
-- owner-authorized migration step for the release owner. Same tenant shape and company wall as 001_init.sql.
BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fw_placements','fw_placement_hosts','fw_cost_rates','fw_cost_charges']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS prima.%1$I (
        id         text PRIMARY KEY,
        company_id text NOT NULL,
        data       jsonb NOT NULL,
        CHECK (data->>'id' = id),
        CHECK (data->>'companyId' = company_id)
      );
      CREATE INDEX IF NOT EXISTS %1$s_company_idx ON prima.%1$I (company_id);
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS company_wall ON prima.%1$I;
      CREATE POLICY company_wall ON prima.%1$I
        USING (company_id = ANY (prima.visible_companies()))
        WITH CHECK (company_id = ANY (prima.visible_companies()));
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
END $$;
-- A host company sees workers placed under its own job only through fw_placement_hosts: its own rows behind its own
-- company wall, holding who and when (name, staff number, owner, dates) and nothing else. It never reads the owner's
-- fw_placements rows (FWM notes, papers, recorder) or the owner's staff records. No host policy on fw_placements.
DROP POLICY IF EXISTS host_read ON prima.fw_placements;
-- Exactly these ten fields, nothing else (an allowlist, not a denylist).
ALTER TABLE prima.fw_placement_hosts DROP CONSTRAINT IF EXISTS fw_placement_hosts_shape;
ALTER TABLE prima.fw_placement_hosts ADD CONSTRAINT fw_placement_hosts_shape CHECK (
  data ?& ARRAY['id','companyId','ownerCompanyId','ownerName','personId','workerName','staffNo','hostBranchId','from','to']
  AND (data - ARRAY['id','companyId','ownerCompanyId','ownerName','personId','workerName','staffNo','hostBranchId','from','to']) = '{}'::jsonb
);
-- Who may write host-view rows: FWM officers only (not despatch), read from the server-selected user like the IT
-- register checks in 001_init.sql. A host company's own sign-in reads its rows but cannot insert or change them.
CREATE OR REPLACE FUNCTION prima.fw_placement_writer() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $f$
  SELECT coalesce(bool_or(
    coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom','') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))
    AND u.data->>'department' = 'fwm' AND coalesce(u.data->>'fwmRole','') <> 'despatch'), false)
  FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
$f$;
REVOKE ALL ON FUNCTION prima.fw_placement_writer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.fw_placement_writer() TO prima_app;
DROP POLICY IF EXISTS company_wall ON prima.fw_placement_hosts;
DROP POLICY IF EXISTS hosts_read ON prima.fw_placement_hosts;
DROP POLICY IF EXISTS hosts_insert ON prima.fw_placement_hosts;
DROP POLICY IF EXISTS hosts_update ON prima.fw_placement_hosts;
CREATE POLICY hosts_read ON prima.fw_placement_hosts FOR SELECT USING (company_id = ANY (prima.visible_companies()));
CREATE POLICY hosts_insert ON prima.fw_placement_hosts FOR INSERT
  WITH CHECK (company_id = ANY (prima.visible_companies()) AND prima.fw_placement_writer());
CREATE POLICY hosts_update ON prima.fw_placement_hosts FOR UPDATE
  USING (company_id = ANY (prima.visible_companies()) AND prima.fw_placement_writer())
  WITH CHECK (company_id = ANY (prima.visible_companies()) AND prima.fw_placement_writer());
-- The only change ever made to a host-view row is setting its last day once, when FWM ends the placement.
CREATE OR REPLACE FUNCTION prima.fw_placement_hosts_end_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $f$
BEGIN
  IF (NEW.data - 'to') IS DISTINCT FROM (OLD.data - 'to') OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR OLD.data->'to' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'fw_placement_hosts: only the last day may be set, once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS fw_placement_hosts_end_only ON prima.fw_placement_hosts;
CREATE TRIGGER fw_placement_hosts_end_only BEFORE UPDATE ON prima.fw_placement_hosts
  FOR EACH ROW EXECUTE FUNCTION prima.fw_placement_hosts_end_only();
-- Money rows are never deleted; a wrong month is rejected with a reason and drafted again.
ALTER TABLE prima.fw_cost_charges DROP CONSTRAINT IF EXISTS fw_cost_charges_shape;
ALTER TABLE prima.fw_cost_charges ADD CONSTRAINT fw_cost_charges_shape CHECK (
  data->>'direction' IN ('host_pays_fwm','fwm_pays_owner')
  AND data->>'status' IN ('draft','approved','rejected','billed','paid')
  AND data->>'month' ~ '^\d{4}-(0[1-9]|1[0-2])$'
  AND jsonb_typeof(data->'total') = 'number' AND (data->>'total')::numeric >= 0
  AND (data->>'status' <> 'paid' OR jsonb_array_length(coalesce(data->'paidDocIds','[]'::jsonb)) > 0)
  AND (data->>'status' NOT IN ('approved','rejected','billed','paid') OR coalesce(data->>'decidedById','') <> data->>'draftedById')
);
-- At most one live (not rejected) charge per payer and month, whatever its id: a retried or racing draft can never
-- bill the same host, branch or owner twice for one month.
CREATE UNIQUE INDEX IF NOT EXISTS fw_cost_charges_one_live ON prima.fw_cost_charges
  (company_id, (data->>'direction'), (coalesce(data->>'branchId', '')), (data->>'month'))
  WHERE data->>'status' <> 'rejected';
COMMIT;
