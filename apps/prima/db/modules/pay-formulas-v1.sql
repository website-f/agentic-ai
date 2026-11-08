-- Pay formulas set by ACT (Fauzan, 5 Nov 2026): the guard salary formula for the whole group, a region, a company or a
-- site, and the driver overtime formula, with the amounts ACT sets.
-- Optional module, preparation only. Apply in a separately authorized migration window to the reviewed base schema,
-- after the release-manifest modules. Not startup SQL and not run by 001_init.sql.
-- Repeat-safe: a second run keeps every row and only replaces this module's own policies and grants.
-- Until it is applied the API reads no formulas (the screen says none are set) and refuses to save one.
-- Group-wide, no company column: the ACT wall (prima.has_wall('act'), base) lets through ACT and group leadership only.
-- Site man-hours approvals (Fauzan, 6 Nov 2026) are per company, behind the company wall like the shifts they cover.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.pay_formulas (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT pay_formulas_id_matches CHECK (data->>'id' = id),
  CONSTRAINT pay_formulas_kind_known CHECK (data->>'kind' IN ('guard_shift','driver_ot','staff_ot')),
  CONSTRAINT pay_formulas_status_known CHECK (data->>'status' IN ('draft','live','rejected','withdrawn'))
);
CREATE TABLE IF NOT EXISTS prima.pay_formula_uses (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT pay_formula_uses_id_matches CHECK (data->>'id' = id),
  CONSTRAINT pay_formula_uses_kind_known CHECK (data->>'kind' IN ('guard_shift','driver_ot','staff_ot')),
  CONSTRAINT pay_formula_uses_scope_known CHECK (data->>'scope' IN ('group','region','company','site'))
);
-- Pay law settings (Fauzan, 6 Nov 2026): the CEO sets the day divisor, minimum wage and overtime minimums by month.
CREATE TABLE IF NOT EXISTS prima.pay_law_versions (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT pay_law_versions_id_matches CHECK (data->>'id' = id),
  CONSTRAINT pay_law_versions_month CHECK (data->>'effectiveFrom' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pay_formulas', 'pay_formula_uses', 'pay_law_versions']
  LOOP
    EXECUTE format($f$
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS dept_wall ON prima.%1$I;
      CREATE POLICY dept_wall ON prima.%1$I USING (prima.has_wall('act')) WITH CHECK (prima.has_wall('act'));
      REVOKE ALL ON prima.%1$I FROM prima_app;
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
    -- Read-only salary-calculator/HR access. The ACT write wall is unchanged.
    EXECUTE format('DROP POLICY IF EXISTS pay_read ON prima.%1$I; CREATE POLICY pay_read ON prima.%1$I FOR SELECT USING (prima.has_wall(''pay_read''));', t);
  END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS prima.site_hours_approvals (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CONSTRAINT site_hours_approvals_id_matches CHECK (data->>'id' = id),
  CONSTRAINT site_hours_approvals_company_matches CHECK (data->>'companyId' = company_id),
  CONSTRAINT site_hours_approvals_tier_known CHECK (data->>'approverTier' IN ('ops_director','ogm')),
  CONSTRAINT site_hours_approvals_hours_positive CHECK ((data->>'extraHours')::numeric > 0),
  CONSTRAINT site_hours_approvals_reason CHECK (length(coalesce(data->>'reason','')) >= 5)
);
CREATE INDEX IF NOT EXISTS site_hours_approvals_company_idx ON prima.site_hours_approvals (company_id);
ALTER TABLE prima.site_hours_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.site_hours_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.site_hours_approvals;
CREATE POLICY company_wall ON prima.site_hours_approvals
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.site_hours_approvals FROM prima_app;
-- An approval is added, never changed or removed: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON prima.site_hours_approvals TO prima_app;
-- Public holiday lists (Fauzan, 6 Nov 2026): 11 days per company and year (or per state), set by the Operations Director or the OGM.
CREATE TABLE IF NOT EXISTS prima.public_holiday_lists (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CONSTRAINT public_holiday_lists_id_matches CHECK (data->>'id' = id),
  CONSTRAINT public_holiday_lists_company_matches CHECK (data->>'companyId' = company_id),
  CONSTRAINT public_holiday_lists_tier_known CHECK (data->>'setByTier' IN ('ops_director','ogm')),
  CONSTRAINT public_holiday_lists_eleven CHECK (jsonb_array_length(data->'days') >= 11)
);
CREATE INDEX IF NOT EXISTS public_holiday_lists_company_idx ON prima.public_holiday_lists (company_id);
ALTER TABLE prima.public_holiday_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.public_holiday_lists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.public_holiday_lists;
CREATE POLICY company_wall ON prima.public_holiday_lists
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.public_holiday_lists FROM prima_app;
-- A changed list is a new version; the old one is only marked replaced. No DELETE.
GRANT SELECT, INSERT, UPDATE ON prima.public_holiday_lists TO prima_app;
-- No DELETE: a formula version or a place choice is replaced, never removed, and the audit log keeps every change.
COMMIT;
