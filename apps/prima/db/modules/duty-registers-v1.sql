-- Duty map registers (Fitri package Part Z4-Z13, Fauzan 14 Nov 2026 "Add any that still missing in prima app"): the
-- records the companies' and central units' checklists keep (factoring, school contributions, contract notices, HRDF,
-- PTPTN, Protégé, SME Corp, new company set-up, manager payback, OM meetings and welfare visits, KBK grass schedule,
-- welfare fund, kuliah dhuha, annual events, Nepal unit records, audit NCR and tests, key log, repair budget).
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json: the
-- CEO-run migration (infra/run-db-migration.sh) and the combined release review add it. Nothing is deleted.
-- Walls:
--   read:   settings: every signed-in person. Company rows: the company wall (own companies or a group role), Internal
--           Audit, Finance, HR and Central Admin; PTPTN rows (confidential) only the company office, HR, Internal Audit
--           and the CEO. Group rows: the keeping unit, Internal Audit, group roles and Finance; the absconder list
--           (confidential) only FWM, Internal Audit and the CEO.
--   insert: company rows by the company office or the OM of a visible company; group rows by the keeping unit; the
--           settings row by the CoS or DCoS. update: whoever may read the row (the service checks the keeper and the
--           checker, never the preparer). Identity, kind, scope and company never change; history is append-only.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.duty_register_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (jsonb_typeof(data->'history') = 'array'),
  -- The one settings row (the welfare fund approver) is only ever 'reg-settings', and nothing else can pose as it.
  CHECK ((id = 'reg-settings') = (data->>'kind' = 'settings')),
  CHECK ((data->>'kind' = 'settings') = (data->>'status' = 'settings'))
);
ALTER TABLE prima.duty_register_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.duty_register_recs FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION prima.reg_me(field text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT u.data->>field FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
    AND coalesce(u.data->'integration', 'null'::jsonb) IN ('false'::jsonb, 'null'::jsonb)
$$;
CREATE OR REPLACE FUNCTION prima.reg_dept(d text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.reg_me('role') = 'pwvsb_officer' AND prima.reg_me('department') = d
$$;
CREATE OR REPLACE FUNCTION prima.reg_keeper_dept(kind text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN kind IN ('clubFund','kuliahDhuha','annualEvent') THEN 'hr'
    WHEN kind IN ('fwBlacklist','kliaIntake','translation','fwAgent','merchantrade','fwSiteAudit') THEN 'fwm'
    WHEN kind IN ('ncr','noDeleteTest','hostelRound','agingReview') THEN 'audit'
    WHEN kind IN ('keyLog','repairBudget') THEN 'asset'
    ELSE NULL END
$$;
CREATE OR REPLACE FUNCTION prima.reg_visible(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.reg_me('id') IS NOT NULL AND CASE
    WHEN d->>'status' = 'settings' THEN true
    WHEN d->>'kind' = 'ptptn' THEN (d->>'companyId' = ANY (prima.visible_companies()) AND coalesce(prima.reg_me('role'), '') IN ('company_manager','admin_exec'))
         OR prima.reg_dept('hr') OR prima.reg_dept('audit') OR prima.reg_me('opsTier') = 'ceo'
    WHEN d->>'kind' = 'fwBlacklist' THEN prima.reg_dept('fwm') OR prima.reg_dept('audit') OR prima.reg_me('opsTier') = 'ceo'
    WHEN d->>'scope' = 'group' THEN prima.reg_dept(prima.reg_keeper_dept(d->>'kind')) OR prima.reg_dept('audit') OR prima.reg_dept('finance')
         OR coalesce(current_setting('app.group_user', true), '') = 'on'
         OR coalesce(prima.reg_me('assetRole'), '') = 'director'
    ELSE d->>'companyId' = ANY (prima.visible_companies())
         OR coalesce(current_setting('app.group_user', true), '') = 'on'
         OR prima.reg_dept('audit') OR prima.reg_dept('finance') OR prima.reg_dept('hr')
         OR coalesce(prima.reg_me('leadership'), '') IN ('cos','deputy_cos','finance_director')
  END
$$;
CREATE OR REPLACE FUNCTION prima.reg_inserter(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.reg_me('id') IS NOT NULL AND CASE
    WHEN d->>'status' = 'settings' THEN coalesce(prima.reg_me('leadership'), '') IN ('cos','deputy_cos')
    WHEN d->>'scope' = 'group' THEN prima.reg_dept(prima.reg_keeper_dept(d->>'kind'))
    ELSE d->>'companyId' = ANY (prima.visible_companies())
         AND (coalesce(prima.reg_me('role'), '') IN ('company_manager','admin_exec') OR prima.reg_me('opsTier') = 'om')
  END
$$;

DROP POLICY IF EXISTS reg_read ON prima.duty_register_recs;
DROP POLICY IF EXISTS reg_insert ON prima.duty_register_recs;
DROP POLICY IF EXISTS reg_update ON prima.duty_register_recs;
CREATE POLICY reg_read ON prima.duty_register_recs FOR SELECT USING (prima.reg_visible(data));
CREATE POLICY reg_insert ON prima.duty_register_recs FOR INSERT WITH CHECK (prima.reg_inserter(data));
CREATE POLICY reg_update ON prima.duty_register_recs FOR UPDATE USING (prima.reg_visible(data)) WITH CHECK (prima.reg_visible(data));

CREATE OR REPLACE FUNCTION prima.reg_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Register records are never deleted' USING ERRCODE = '23514'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind'
     OR NEW.data->'scope' IS DISTINCT FROM OLD.data->'scope' OR NEW.data->'companyId' IS DISTINCT FROM OLD.data->'companyId' THEN
    RAISE EXCEPTION 'Register record identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(NEW.data->'history') <= jsonb_array_length(OLD.data->'history')
     OR (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) IS DISTINCT FROM OLD.data->'history' THEN
    RAISE EXCEPTION 'Register record history is append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reg_guard ON prima.duty_register_recs;
CREATE TRIGGER reg_guard BEFORE UPDATE OR DELETE ON prima.duty_register_recs FOR EACH ROW EXECUTE FUNCTION prima.reg_guard();

GRANT SELECT, INSERT, UPDATE ON prima.duty_register_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.duty_register_recs FROM prima_app;
COMMIT;
