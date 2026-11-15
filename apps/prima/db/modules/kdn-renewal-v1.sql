-- KDN private agency licence renewal 2027 (Fitri package Part W1-W14, Fauzan's answers W-X1..W-X13, 14 Nov 2026):
-- the group-level KDN checklist template and session window settings, Finance's no-SST-arrears tick per company,
-- FWM's eSIMS mark per Nepali guard and the company's anti-corruption pledge (kept for ACT). The renewal itself lives on
-- the existing licences table (licence.renewal.kdn), so this module adds one table only.
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json: the
-- CEO-run migration (infra/run-db-migration.sh) and the combined release review add it. Nothing is deleted.
-- Walls:
--   read:   template and window: every signed-in person (not a device). SST, eSIMS and pledge rows: the company wall
--           (own companies or a group role), Finance, FWM, ACT and Central Admin (the Deputy CoS).
--   insert/update: template and window only Central Admin (the Deputy CoS); SST only Finance; eSIMS only FWM; pledge
--           only the company's own office staff (director, company manager, admin executive) of a company in their wall.
--   The service still checks each step. Identity, kind, company and year never change; history only grows
--   (append-only), checked by a trigger.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.kdn_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('template','window','sst','esims','pledge')),
  CHECK (jsonb_typeof(data->'history') = 'array')
);
ALTER TABLE prima.kdn_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.kdn_recs FORCE ROW LEVEL SECURITY;

-- The signed-in person's field (definer rights so the policy does not depend on the users row policy).
CREATE OR REPLACE FUNCTION prima.kdn_me(field text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT u.data->>field FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
    AND coalesce(u.data->'integration', 'null'::jsonb) IN ('false'::jsonb, 'null'::jsonb)
$$;

CREATE OR REPLACE FUNCTION prima.kdn_visible(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.kdn_me('id') IS NOT NULL AND (
    d->>'kind' IN ('template','window')
    OR d->>'companyId' = ANY (prima.visible_companies())
    OR coalesce(current_setting('app.group_user', true), '') = 'on'
    OR coalesce(prima.kdn_me('department'), '') IN ('finance','fwm','audit')
    OR coalesce(prima.kdn_me('leadership'), '') IN ('finance_director','deputy_cos','cos'))
$$;

CREATE OR REPLACE FUNCTION prima.kdn_writer(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT CASE d->>'kind'
    WHEN 'template' THEN prima.kdn_me('role') = 'pwvsb_officer' AND prima.kdn_me('leadership') = 'deputy_cos'
    WHEN 'window'   THEN prima.kdn_me('role') = 'pwvsb_officer' AND prima.kdn_me('leadership') = 'deputy_cos'
    WHEN 'sst'      THEN prima.kdn_me('leadership') = 'finance_director'
                         OR (prima.kdn_me('role') = 'pwvsb_officer' AND prima.kdn_me('department') = 'finance')
    WHEN 'esims'    THEN prima.kdn_me('role') = 'pwvsb_officer' AND prima.kdn_me('department') = 'fwm'
                         AND coalesce(prima.kdn_me('fwmRole'), '') <> 'despatch'
    WHEN 'pledge'   THEN d->>'companyId' = ANY (prima.visible_companies())
                         AND coalesce(prima.kdn_me('role'), '') IN ('director','company_manager','admin_exec')
    ELSE false END
$$;

DROP POLICY IF EXISTS kdn_read ON prima.kdn_recs;
DROP POLICY IF EXISTS kdn_insert ON prima.kdn_recs;
DROP POLICY IF EXISTS kdn_update ON prima.kdn_recs;
CREATE POLICY kdn_read ON prima.kdn_recs FOR SELECT USING (prima.kdn_visible(data));
CREATE POLICY kdn_insert ON prima.kdn_recs FOR INSERT WITH CHECK (prima.kdn_writer(data));
CREATE POLICY kdn_update ON prima.kdn_recs FOR UPDATE USING (prima.kdn_visible(data)) WITH CHECK (prima.kdn_writer(data));

-- Append-only history; identity, kind, company and year never change.
CREATE OR REPLACE FUNCTION prima.kdn_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'KDN records are never deleted' USING ERRCODE = '23514'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind'
     OR NEW.data->'companyId' IS DISTINCT FROM OLD.data->'companyId' OR NEW.data->'year' IS DISTINCT FROM OLD.data->'year' THEN
    RAISE EXCEPTION 'KDN record identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(NEW.data->'history') <= jsonb_array_length(OLD.data->'history')
     OR (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) IS DISTINCT FROM OLD.data->'history' THEN
    RAISE EXCEPTION 'KDN record history is append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kdn_guard ON prima.kdn_recs;
CREATE TRIGGER kdn_guard BEFORE UPDATE OR DELETE ON prima.kdn_recs FOR EACH ROW EXECUTE FUNCTION prima.kdn_guard();

GRANT SELECT, INSERT, UPDATE ON prima.kdn_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.kdn_recs FROM prima_app;
COMMIT;
