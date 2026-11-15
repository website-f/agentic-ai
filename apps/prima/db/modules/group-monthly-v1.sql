-- Monthly JA Group meeting and staff duty checklists (Fitri package Part Y1-Y11, Fauzan's answers Y-Q1..Y-Q10,
-- 14 Nov 2026): the meeting (date, logistics, minutes), each company's and unit's monthly report (the frozen 14-item
-- report built from records and the last verified toolbox pack), the JTK register, guard pay method counts, Internal
-- Audit's accounts report tracker and Friday red/yellow/green report, and the duty checklist lines.
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json: the
-- CEO-run migration (infra/run-db-migration.sh) and the combined release review add it. Nothing is deleted.
-- Walls:
--   read:   settings and the meeting row: every signed-in person (attendees see who has sent; the service shows draft
--           minutes only to Unit HR, Internal Audit and group roles). Company rows ('co:<id>'): the company wall (own
--           companies or a group role), Unit HR, Internal Audit and the Director Office; accounts report rows also
--           Finance. Unit rows ('dept:<d>'): that unit, Unit HR, Internal Audit, the Director Office and group roles.
--           The Friday report: Internal Audit, the Director Office and group roles.
--   insert/update: the meeting by Unit HR (minutes verified by the Director Office or the CEO); company reports, JTK
--           and pay method rows by the company office; unit reports by the unit; accounts report rows by the company
--           office or Finance (sent) and Internal Audit (reviewed); the Friday report by Internal Audit; duty lines by
--           the company manager or the unit. The service still checks each step (preparer, verifier, never their own).
--   Identity, kind, scope and company never change; history only grows (append-only), checked by a trigger.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.group_month_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('settings','meeting','report','acct','jtk','payMethod','ryg','duty')),
  CHECK (jsonb_typeof(data->'history') = 'array'),
  -- Part Z2: the one settings row (the group calendar) is only ever 'gm-settings'.
  CHECK ((id = 'gm-settings') = (data->>'kind' = 'settings'))
);
ALTER TABLE prima.group_month_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.group_month_recs FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION prima.gm_me(field text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT u.data->>field FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
    AND coalesce(u.data->'integration', 'null'::jsonb) IN ('false'::jsonb, 'null'::jsonb)
$$;
CREATE OR REPLACE FUNCTION prima.gm_dept(d text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.gm_me('role') = 'pwvsb_officer' AND prima.gm_me('department') = d
$$;
CREATE OR REPLACE FUNCTION prima.gm_finance() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(prima.gm_me('leadership'), '') = 'finance_director' OR prima.gm_dept('finance')
$$;
CREATE OR REPLACE FUNCTION prima.gm_visible(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.gm_me('id') IS NOT NULL AND CASE
    WHEN d->>'kind' IN ('settings','meeting') THEN true
    WHEN d->>'kind' = 'ryg' THEN prima.gm_dept('audit') OR prima.gm_dept('director_office')
         OR coalesce(current_setting('app.group_user', true), '') = 'on'
    WHEN d->>'scope' LIKE 'dept:%' THEN prima.gm_dept(substr(d->>'scope', 6))
         OR prima.gm_dept('hr') OR prima.gm_dept('audit') OR prima.gm_dept('director_office')
         OR coalesce(current_setting('app.group_user', true), '') = 'on'
    ELSE d->>'companyId' = ANY (prima.visible_companies())
         OR coalesce(current_setting('app.group_user', true), '') = 'on'
         OR prima.gm_dept('hr') OR prima.gm_dept('audit') OR prima.gm_dept('director_office')
         OR (d->>'kind' = 'acct' AND prima.gm_finance())
  END
$$;
CREATE OR REPLACE FUNCTION prima.gm_writer(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.gm_me('id') IS NOT NULL AND CASE
    WHEN d->>'kind' = 'settings' THEN prima.gm_dept('hr') OR prima.gm_dept('director_office')
    WHEN d->>'kind' = 'meeting' THEN prima.gm_dept('hr') OR prima.gm_dept('director_office') OR prima.gm_me('opsTier') = 'ceo'
    WHEN d->>'kind' = 'ryg' THEN prima.gm_dept('audit')
    WHEN d->>'kind' = 'acct' THEN prima.gm_dept('audit') OR prima.gm_finance()
         OR (d->>'companyId' = ANY (prima.visible_companies()) AND coalesce(prima.gm_me('role'), '') IN ('company_manager','admin_exec'))
    WHEN d->>'scope' LIKE 'dept:%' THEN prima.gm_dept(substr(d->>'scope', 6))
    WHEN d->>'kind' = 'duty' THEN d->>'companyId' = ANY (prima.visible_companies()) AND coalesce(prima.gm_me('role'), '') = 'company_manager'
    ELSE d->>'companyId' = ANY (prima.visible_companies()) AND coalesce(prima.gm_me('role'), '') IN ('company_manager','admin_exec','director')
  END
$$;

DROP POLICY IF EXISTS gm_read ON prima.group_month_recs;
DROP POLICY IF EXISTS gm_insert ON prima.group_month_recs;
DROP POLICY IF EXISTS gm_update ON prima.group_month_recs;
CREATE POLICY gm_read ON prima.group_month_recs FOR SELECT USING (prima.gm_visible(data));
CREATE POLICY gm_insert ON prima.group_month_recs FOR INSERT WITH CHECK (prima.gm_writer(data));
CREATE POLICY gm_update ON prima.group_month_recs FOR UPDATE USING (prima.gm_visible(data)) WITH CHECK (prima.gm_writer(data));

CREATE OR REPLACE FUNCTION prima.gm_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Monthly meeting records are never deleted' USING ERRCODE = '23514'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind'
     OR NEW.data->'scope' IS DISTINCT FROM OLD.data->'scope' OR NEW.data->'companyId' IS DISTINCT FROM OLD.data->'companyId' THEN
    RAISE EXCEPTION 'Monthly meeting record identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(NEW.data->'history') <= jsonb_array_length(OLD.data->'history')
     OR (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) IS DISTINCT FROM OLD.data->'history' THEN
    RAISE EXCEPTION 'Monthly meeting record history is append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gm_guard ON prima.group_month_recs;
CREATE TRIGGER gm_guard BEFORE UPDATE OR DELETE ON prima.group_month_recs FOR EACH ROW EXECUTE FUNCTION prima.gm_guard();

GRANT SELECT, INSERT, UPDATE ON prima.group_month_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.group_month_recs FROM prima_app;
COMMIT;
