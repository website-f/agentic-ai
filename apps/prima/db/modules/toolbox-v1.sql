-- Company and department toolbox meetings (Fitri package Part X1-X19, Fauzan's answers X-Q1..X-Q11, 14 Nov 2026):
-- toolbox settings (agenda versions, director rotation), minutes with the frozen status pack, status lines, own
-- sections, KDN state branch offices, MOF nominees, PGM claims, client payment deductions, SULIT items in one person's
-- name and the OM's site safety and operations talks. The meeting itself stays on the existing meetings table.
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json: the
-- CEO-run migration (infra/run-db-migration.sh) and the combined release review add it. Nothing is deleted.
-- Walls:
--   read:   settings: every signed-in person. Company records ('co:<id>'): the company wall (own companies or a group
--           role), the Director Office, ACT and Finance (receipts, PGM, SULIT). SULIT rows only for a director of the
--           company, the CEO, the Finance Director and ACT. Department records ('dept:<d>'): that department, the
--           Director Office, ACT and group roles.
--   insert/update: minutes, lines and sections by the company office of a visible company or the department's own
--           members; minutes also by a central management director (verifying a visited meeting); branch and nominee
--           rows by the company office or Central Admin; PGM by the company office or Finance; receipts and SULIT only
--           Finance; site talks only an OM; settings only Central Admin or the Director Office.
--   The service still checks each step (preparer, verifier, never their own). Identity, kind, scope and company never
--   change; history only grows (append-only), checked by a trigger.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.toolbox_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('settings','minutes','line','section','branch','nominee','pgm','receipt','personal','siteTalk')),
  CHECK (jsonb_typeof(data->'history') = 'array')
);
ALTER TABLE prima.toolbox_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.toolbox_recs FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION prima.tbx_me(field text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT u.data->>field FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
    AND coalesce(u.data->'integration', 'null'::jsonb) IN ('false'::jsonb, 'null'::jsonb)
$$;
CREATE OR REPLACE FUNCTION prima.tbx_central() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(prima.tbx_me('opsTier'), '') IN ('ceo','coo','ops_director','ogm')
      OR coalesce(prima.tbx_me('leadership'), '') IN ('cos','deputy_cos','finance_director')
$$;
CREATE OR REPLACE FUNCTION prima.tbx_finance() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(prima.tbx_me('leadership'), '') = 'finance_director'
      OR (prima.tbx_me('role') = 'pwvsb_officer' AND prima.tbx_me('department') = 'finance')
$$;
CREATE OR REPLACE FUNCTION prima.tbx_visible(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.tbx_me('id') IS NOT NULL AND CASE
    WHEN d->>'kind' = 'settings' THEN true
    WHEN d->>'kind' = 'personal' THEN prima.tbx_me('opsTier') = 'ceo' OR prima.tbx_me('leadership') = 'finance_director'
         OR prima.tbx_me('department') = 'audit'
         OR (prima.tbx_me('role') = 'director' AND d->>'companyId' = ANY (prima.visible_companies()))
    WHEN d->>'scope' LIKE 'dept:%' THEN prima.tbx_me('department') = substr(d->>'scope', 6)
         OR prima.tbx_me('department') IN ('director_office','audit')
         OR coalesce(current_setting('app.group_user', true), '') = 'on'
    ELSE d->>'companyId' = ANY (prima.visible_companies())
         OR coalesce(current_setting('app.group_user', true), '') = 'on'
         OR prima.tbx_me('department') IN ('director_office','audit')
         OR (d->>'kind' IN ('receipt','pgm','minutes') AND prima.tbx_finance())
         OR (d->>'kind' = 'siteTalk' AND prima.tbx_me('department') = 'operations')
  END
$$;
CREATE OR REPLACE FUNCTION prima.tbx_writer(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.tbx_me('id') IS NOT NULL AND CASE
    WHEN d->>'kind' = 'settings' THEN prima.tbx_me('leadership') = 'deputy_cos' OR prima.tbx_me('department') = 'director_office'
    WHEN d->>'kind' IN ('receipt','personal') THEN prima.tbx_finance()
    WHEN d->>'kind' = 'siteTalk' THEN prima.tbx_me('opsTier') = 'om'
    WHEN d->>'kind' IN ('branch','nominee','pgm') THEN
         (d->>'companyId' = ANY (prima.visible_companies()) AND coalesce(prima.tbx_me('role'), '') IN ('company_manager','admin_exec'))
         OR (d->>'kind' <> 'pgm' AND prima.tbx_me('leadership') = 'deputy_cos')
         OR (d->>'kind' = 'pgm' AND prima.tbx_finance())
    WHEN d->>'scope' LIKE 'dept:%' THEN prima.tbx_me('department') = substr(d->>'scope', 6)
         OR (d->>'kind' IN ('minutes','line') AND prima.tbx_central())
    ELSE (d->>'companyId' = ANY (prima.visible_companies()) AND coalesce(prima.tbx_me('role'), '') IN ('company_manager','admin_exec','director'))
         OR (d->>'kind' IN ('minutes','line') AND prima.tbx_central())
  END
$$;

DROP POLICY IF EXISTS tbx_read ON prima.toolbox_recs;
DROP POLICY IF EXISTS tbx_insert ON prima.toolbox_recs;
DROP POLICY IF EXISTS tbx_update ON prima.toolbox_recs;
CREATE POLICY tbx_read ON prima.toolbox_recs FOR SELECT USING (prima.tbx_visible(data));
CREATE POLICY tbx_insert ON prima.toolbox_recs FOR INSERT WITH CHECK (prima.tbx_writer(data));
CREATE POLICY tbx_update ON prima.toolbox_recs FOR UPDATE USING (prima.tbx_visible(data)) WITH CHECK (prima.tbx_writer(data));

CREATE OR REPLACE FUNCTION prima.tbx_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Toolbox records are never deleted' USING ERRCODE = '23514'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind'
     OR NEW.data->'scope' IS DISTINCT FROM OLD.data->'scope' OR NEW.data->'companyId' IS DISTINCT FROM OLD.data->'companyId' THEN
    RAISE EXCEPTION 'Toolbox record identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(NEW.data->'history') <= jsonb_array_length(OLD.data->'history')
     OR (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) IS DISTINCT FROM OLD.data->'history' THEN
    RAISE EXCEPTION 'Toolbox record history is append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tbx_guard ON prima.toolbox_recs;
CREATE TRIGGER tbx_guard BEFORE UPDATE OR DELETE ON prima.toolbox_recs FOR EACH ROW EXECUTE FUNCTION prima.tbx_guard();

GRANT SELECT, INSERT, UPDATE ON prima.toolbox_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.toolbox_recs FROM prima_app;
COMMIT;
