-- Cleaning operations and duty plans (Fauzan, 4 Nov 2026): cleaning site set-up, daily cleaning plans, cleaning stock
-- movements, site fittings, published guard duty plans and patrolling officer routes, and each guarded site's contract
-- terms (guards per shift and rate per guard-hour, for the planner's cover check and deduction estimate).
-- Optional module, preparation only. Apply in a separately authorized migration window to the reviewed base schema.
-- Not startup SQL and not run by 001_init.sql. Repeat-safe: a second run keeps every row and only replaces this
-- module's own policies and grants. Until it is applied the API reads nothing from these tables (the screens show
-- "not set up") and refuses every save with a plain message.
-- Catalogue check: apps/api/src/cleaning-ops-readiness.ts cleaningOpsProblems.
BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cleaning_sites','cleaning_days','cleaning_stock','site_kits','duty_plans','guard_terms']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS prima.%1$I (
        id         text PRIMARY KEY,
        company_id text NOT NULL,
        data       jsonb NOT NULL,
        CONSTRAINT %1$s_id_matches CHECK (data->>'id' = id),
        CONSTRAINT %1$s_company_matches CHECK (data->>'companyId' = company_id)
      );
      CREATE INDEX IF NOT EXISTS %1$s_company_idx ON prima.%1$I (company_id);
      CREATE INDEX IF NOT EXISTS %1$s_data_idx ON prima.%1$I USING gin (data jsonb_path_ops);
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS company_wall ON prima.%1$I;
      CREATE POLICY company_wall ON prima.%1$I
        USING (company_id = ANY (prima.visible_companies()))
        WITH CHECK (company_id = ANY (prima.visible_companies()));
      REVOKE ALL ON prima.%1$I FROM prima_app;
      -- No DELETE: plans and stock records are corrected by a new record; the audit log keeps every change.
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
END $$;
ALTER TABLE prima.cleaning_sites DROP CONSTRAINT IF EXISTS cleaning_sites_id_format;
ALTER TABLE prima.cleaning_sites ADD CONSTRAINT cleaning_sites_id_format CHECK (id = 'clean-' || (data->>'siteId'));
ALTER TABLE prima.cleaning_days DROP CONSTRAINT IF EXISTS cleaning_days_id_format;
ALTER TABLE prima.cleaning_days ADD CONSTRAINT cleaning_days_id_format CHECK (id = 'cday-' || (data->>'siteId') || '-' || (data->>'date'));
ALTER TABLE prima.site_kits DROP CONSTRAINT IF EXISTS site_kits_id_format;
ALTER TABLE prima.site_kits ADD CONSTRAINT site_kits_id_format CHECK (id = 'kit-' || (data->>'siteId'));
ALTER TABLE prima.duty_plans DROP CONSTRAINT IF EXISTS duty_plans_kind;
ALTER TABLE prima.duty_plans ADD CONSTRAINT duty_plans_kind CHECK (data->>'kind' IN ('post','route'));
ALTER TABLE prima.guard_terms DROP CONSTRAINT IF EXISTS guard_terms_id_format;
ALTER TABLE prima.guard_terms ADD CONSTRAINT guard_terms_id_format CHECK (id = 'gterms-' || (data->>'siteId'));
COMMIT;
