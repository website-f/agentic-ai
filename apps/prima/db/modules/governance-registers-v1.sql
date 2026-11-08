-- PROPOSED, NOT APPLIED. Governance registers (Fauzan, 5 Nov 2026): related-party deals, directors' interests,
-- board committees and the risk register. Same tenant shape and company wall as every company table in
-- 001_init.sql. Install only by an explicit, reviewed, CEO-run migration; the app shows "not switched on" until then.
-- No delete grant: entries are corrected by a newer entry, never removed.
BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('prima.companies') IS NULL OR to_regprocedure('prima.has_wall(text)') IS NULL THEN RAISE EXCEPTION 'Base schema 001_init required'; END IF;
  FOREACH t IN ARRAY ARRAY['reg_related_parties','reg_interests','reg_committees','reg_risks','reg_settings']
  LOOP
    EXECUTE format($f$
      CREATE TABLE prima.%1$I (
        id         text PRIMARY KEY,
        company_id text NOT NULL,
        data       jsonb NOT NULL,
        CHECK (data->>'id' = id),
        CHECK (data->>'companyId' = company_id)
      );
      CREATE INDEX %1$s_company_idx ON prima.%1$I (company_id);
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      CREATE POLICY company_wall ON prima.%1$I
        USING (company_id = ANY (prima.visible_companies()))
        WITH CHECK (company_id = ANY (prima.visible_companies()));
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
  -- Department walls on top of the company wall (both must pass). Deals, declarations and the CEO setting: Deputy
  -- Chief of Staff, Chief of Staff and CEO only. Risks: ACT and the CEO only. Committees keep the company wall alone.
  FOREACH t IN ARRAY ARRAY['reg_related_parties','reg_interests','reg_settings']
  LOOP
    EXECUTE format($f$
      CREATE POLICY dept_wall ON prima.%1$I AS RESTRICTIVE
        USING (prima.has_wall('reg_desk')) WITH CHECK (prima.has_wall('reg_desk'));
    $f$, t);
  END LOOP;
  CREATE POLICY dept_wall ON prima.reg_risks AS RESTRICTIVE
    USING (prima.has_wall('reg_risk')) WITH CHECK (prima.has_wall('reg_risk'));
END $$;
COMMIT;
