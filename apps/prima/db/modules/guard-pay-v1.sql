-- Prima's own guard pay run (Fauzan, 5 Nov 2026, third audit item 1): each company's monthly pay for guards, stationed
-- officers and patrolling officers, prepared by HR, approved by the COO, paid by Finance.
-- Optional module, preparation only. Apply in a separately authorized migration window to the reviewed base schema,
-- after pay-formulas-v1. Not startup SQL and not run by 001_init.sql.
-- Repeat-safe: a second run keeps every row and only replaces this module's own policy and grants.
-- Until it is applied the API shows no runs and refuses to prepare one.
-- Company-scoped like staff_pay_runs: the company wall (prima.visible_companies(), base) keeps each company's pay apart.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.guard_pay_runs (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CONSTRAINT guard_pay_runs_id_matches CHECK (data->>'id' = id),
  CONSTRAINT guard_pay_runs_company_matches CHECK (data->>'companyId' = company_id),
  CONSTRAINT guard_pay_runs_stage_known CHECK (data->>'stage' IN ('draft','submitted','approved','paid')),
  CONSTRAINT guard_pay_runs_period_shape CHECK (data->>'period' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- A trial run (JA still pays guards) is never paid from Prima.
  CONSTRAINT guard_pay_runs_trial_unpaid CHECK (NOT ((data->>'trial')::boolean AND data->>'stage' = 'paid'))
);
CREATE INDEX IF NOT EXISTS guard_pay_runs_company_idx ON prima.guard_pay_runs (company_id);
ALTER TABLE prima.guard_pay_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.guard_pay_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.guard_pay_runs;
CREATE POLICY company_wall ON prima.guard_pay_runs
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.guard_pay_runs FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.guard_pay_runs TO prima_app;
-- No DELETE: a month is returned and recalculated, never removed; the audit log keeps every step.

-- Wage advances (Fauzan, 6 Nov 2026): set by the OM, approved by the Operations Director or OGM, taken back in the
-- month's pay. Same company wall. A paid advance is never cancelled, and an amount is always above zero.
CREATE TABLE IF NOT EXISTS prima.guard_pay_advances (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CONSTRAINT guard_pay_advances_id_matches CHECK (data->>'id' = id),
  CONSTRAINT guard_pay_advances_company_matches CHECK (data->>'companyId' = company_id),
  CONSTRAINT guard_pay_advances_status_known CHECK (data->>'status' IN ('pending','approved','paid','cancelled')),
  CONSTRAINT guard_pay_advances_period_shape CHECK (data->>'period' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT guard_pay_advances_amount_positive CHECK ((data->>'amount')::numeric > 0),
  -- Paid only once approved: a paid advance carries at least one approval.
  CONSTRAINT guard_pay_advances_paid_approved CHECK (data->>'status' <> 'paid' OR jsonb_array_length(data->'approvals') > 0)
);
CREATE INDEX IF NOT EXISTS guard_pay_advances_company_idx ON prima.guard_pay_advances (company_id);
ALTER TABLE prima.guard_pay_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.guard_pay_advances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.guard_pay_advances;
CREATE POLICY company_wall ON prima.guard_pay_advances
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.guard_pay_advances FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.guard_pay_advances TO prima_app;
-- No DELETE: an advance is cancelled with a reason, never removed.

-- Advance and loan scheme (Fauzan, 6 Nov 2026, IWAY item 4): HR records it with the worker's signed agreement, the
-- Chief of Staff then the CEO approve, Finance pays out and watches the balance. Same company wall. The database keeps
-- the shape honest even if the API is bypassed: a limit, a purpose, a repayment period and a signature are required,
-- the amount lent never exceeds the limit, and nothing is paid out or settled without both approvals.
CREATE TABLE IF NOT EXISTS prima.guard_loans (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CONSTRAINT guard_loans_id_matches CHECK (data->>'id' = id),
  CONSTRAINT guard_loans_company_matches CHECK (data->>'companyId' = company_id),
  CONSTRAINT guard_loans_status_known CHECK (data->>'status' IN ('pending_cos','pending_ceo','approved','paid_out','settled','rejected','cancelled')),
  CONSTRAINT guard_loans_amount_within_limit CHECK ((data->>'amount')::numeric > 0 AND (data->>'amount')::numeric <= (data->>'limit')::numeric),
  CONSTRAINT guard_loans_period CHECK ((data->>'months')::int BETWEEN 1 AND 24),
  CONSTRAINT guard_loans_purpose CHECK (length(coalesce(data->>'purpose','')) >= 5),
  CONSTRAINT guard_loans_signed CHECK (length(coalesce(data#>>'{signature,docRef}','')) >= 3 AND (data#>>'{signature,signedOn}') IS NOT NULL),
  CONSTRAINT guard_loans_balance CHECK ((data->>'balance')::numeric >= 0 AND (data->>'balance')::numeric <= (data->>'amount')::numeric),
  CONSTRAINT guard_loans_two_approvals CHECK (
    data->>'status' NOT IN ('approved','paid_out','settled')
    OR (jsonb_typeof(data->'cos') = 'object' AND jsonb_typeof(data->'ceo') = 'object' AND data#>>'{cos,byId}' <> data#>>'{ceo,byId}')
  )
);
CREATE INDEX IF NOT EXISTS guard_loans_company_idx ON prima.guard_loans (company_id);
ALTER TABLE prima.guard_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.guard_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.guard_loans;
CREATE POLICY company_wall ON prima.guard_loans
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.guard_loans FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.guard_loans TO prima_app;
-- No DELETE: a record is rejected or cancelled with a reason, never removed.

-- Statutory rates and new contribution types the CEO sets by month (Fauzan, 6 Nov 2026). Group-wide, no company column.
-- Read by ACT/leadership (act), HR preparing pay (pay_read), and payroll Finance (statutory_read only). Written through the API, which
-- lets only the CEO set a version. A version is replaced, never deleted.
CREATE TABLE IF NOT EXISTS prima.statutory_versions (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT statutory_versions_id_matches CHECK (data->>'id' = id),
  CONSTRAINT statutory_versions_month CHECK (data->>'effectiveFrom' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT statutory_versions_reason CHECK (length(coalesce(data->>'reason','')) >= 5)
);
ALTER TABLE prima.statutory_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.statutory_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS statutory_read ON prima.statutory_versions;
CREATE POLICY statutory_read ON prima.statutory_versions FOR SELECT USING (prima.has_wall('act') OR prima.has_wall('pay_read') OR prima.has_wall('statutory_read'));
DROP POLICY IF EXISTS statutory_write ON prima.statutory_versions;
CREATE POLICY statutory_write ON prima.statutory_versions FOR INSERT WITH CHECK (prima.has_wall('act'));
DROP POLICY IF EXISTS statutory_update ON prima.statutory_versions;
CREATE POLICY statutory_update ON prima.statutory_versions FOR UPDATE USING (prima.has_wall('act')) WITH CHECK (prima.has_wall('act'));
REVOKE ALL ON prima.statutory_versions FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.statutory_versions TO prima_app;

-- HR prepares guard and staff pay from the ACT formulas and the CEO's pay law: a read-only door through the pay_read
-- wall on the pay formulas module's tables (their own act wall is unchanged).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pay_formulas', 'pay_formula_uses', 'pay_law_versions']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS pay_read ON prima.%1$I; CREATE POLICY pay_read ON prima.%1$I FOR SELECT USING (prima.has_wall(''pay_read''));', t);
  END LOOP;
END $$;
COMMIT;
