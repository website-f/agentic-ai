-- Company walls on business tables that had none (Fitri package N10, 13 Nov 2026). Separate reviewed module; never
-- run implicitly during startup. NOT yet registered in db/release-manifest.json: the CEO-run migration and the combined
-- release review add it. Until now these tables relied only on checks in the application. After this, a company person
-- (company head, admin executive, supervisor, guard) reads and writes only rows of the companies they work for; group
-- (PWVSB) staff keep reading the group, as the application already decides. Rows with no company (group records) stay
-- open to the people the application shows them to. prima.memos is left as it is: a memo has no company (it goes to all
-- staff or all guards), so a company wall does not apply; prima.whistle_reports has its own wall (speak-up-wall-v1).
BEGIN;
CREATE OR REPLACE FUNCTION prima.bw_company_ok(cid text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.group_user', true) = 'on' OR cid IS NULL OR cid = ANY (prima.visible_companies())
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_accounts', 'expense_requests', 'vehicle_requests', 'gift_entries', 'report_submissions'] LOOP
    EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS bw_wall ON prima.%I', t);
    EXECUTE format('CREATE POLICY bw_wall ON prima.%I USING (prima.bw_company_ok(data->>''companyId'')) WITH CHECK (prima.bw_company_ok(data->>''companyId''))', t);
  END LOOP;
END $$;

-- A vehicle stays with its owner company; a company it is lent to (usedBy) also sees it.
ALTER TABLE prima.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.vehicles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bw_wall ON prima.vehicles;
CREATE POLICY bw_wall ON prima.vehicles
  USING (prima.bw_company_ok(data->>'companyId')
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(data->'usedBy', '[]'::jsonb)) e WHERE e->>'companyId' = ANY (prima.visible_companies())))
  WITH CHECK (prima.bw_company_ok(data->>'companyId')
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(data->'usedBy', '[]'::jsonb)) e WHERE e->>'companyId' = ANY (prima.visible_companies())));

-- Joint tenders and tender opportunities list several companies; a company sees a row it has an entry in. The tender
-- sources the Director Office checks are group records only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tender_groups', 'tender_opportunities'] LOOP
    IF to_regclass('prima.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS bw_wall ON prima.%I', t);
    EXECUTE format($p$CREATE POLICY bw_wall ON prima.%I
      USING (current_setting('app.group_user', true) = 'on'
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(data->'entries', '[]'::jsonb)) e WHERE e->>'companyId' = ANY (prima.visible_companies())))
      WITH CHECK (current_setting('app.group_user', true) = 'on'
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(data->'entries', '[]'::jsonb)) e WHERE e->>'companyId' = ANY (prima.visible_companies())))$p$, t);
  END LOOP;
  IF to_regclass('prima.tender_sources') IS NOT NULL THEN
    ALTER TABLE prima.tender_sources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prima.tender_sources FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS bw_wall ON prima.tender_sources;
    CREATE POLICY bw_wall ON prima.tender_sources USING (current_setting('app.group_user', true) = 'on') WITH CHECK (current_setting('app.group_user', true) = 'on');
  END IF;
END $$;
COMMIT;
