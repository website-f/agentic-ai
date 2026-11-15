-- Arms, vault, licence and bulletproof jacket policies, the records part (Fitri package Part R1-R32, Fauzan's answers
-- R-X1..R-X11, 13-14 Nov 2026): damage reports and inspections, firearm status log, repairs, staff arms licence
-- applications, vault applications, changes, access logs and inspections, the police application pack for a buy,
-- receiving (GRN) and budget checks, jackets (register, purchases, receiving, inspections), dealer licence
-- applications and the trading readiness list.
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json: the
-- CEO-run migration (infra/run-db-migration.sh) and the combined release review add it. Nothing is deleted.
-- Walls:
--   read/insert/update: the arms wall (prima.has_wall('arms')) AND the company wall (own companies, or a group role,
--           or a group-level record with no company); jacket records also for the procurement and store team within
--           its company wall (Goodwill Empire keeps the jackets, R-X7), without the arms wall.
--           PWVSB HR also reads licence applications and damage reports (eligibility, negligence link); Finance reads
--           the purchase pack for its budget check. Neither sees the firearms or vaults themselves.
--   The service still checks who may take each step (Arms Control, the company head, HR, Finance, the stores team).
--   Identity, kind and reference never change; history only grows (append-only), checked by a trigger.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.arms_policy_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('settings','damage','inspect','statusLog','repair','licenceApp','vaultApp','vaultChange','vaultLog','vaultInspect','buyPack','armsGrn','armsBudget','jacket','jacketBuy','jacketGrn','jacketInspect','dealerApp','readiness','monthly','extinguisher')),
  CHECK (jsonb_typeof(data->'history') = 'array')
);
ALTER TABLE prima.arms_policy_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.arms_policy_recs FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION prima.arpol_visible(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT (prima.has_wall('arms')
          AND (d->>'companyId' IS NULL OR d->>'companyId' = ANY (prima.visible_companies())
               OR coalesce(current_setting('app.group_user', true), '') = 'on'))
      -- Goodwill Empire's store and procurement team keeps the jackets (R-X7), within its company wall.
      OR (d->>'kind' LIKE 'jacket%' AND d->>'companyId' = ANY (prima.visible_companies())
          AND EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true) AND u.data->>'department' = 'procurement'))
      -- PWVSB HR confirms licence eligibility and links a discipline case to possible negligence (R6, R8).
      OR (d->>'kind' IN ('licenceApp','damage') AND EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
            AND u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'hr'))
      -- The assigned Finance team records the budget check on the purchase pack (R18).
      OR (d->>'kind' = 'buyPack' AND EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
            AND (u.data->>'department' = 'finance' OR u.data->>'leadership' = 'finance_director')));
$$;

DROP POLICY IF EXISTS arpol_read ON prima.arms_policy_recs;
DROP POLICY IF EXISTS arpol_insert ON prima.arms_policy_recs;
DROP POLICY IF EXISTS arpol_update ON prima.arms_policy_recs;
CREATE POLICY arpol_read ON prima.arms_policy_recs FOR SELECT USING (prima.arpol_visible(data));
CREATE POLICY arpol_insert ON prima.arms_policy_recs FOR INSERT WITH CHECK (prima.arpol_visible(data));
CREATE POLICY arpol_update ON prima.arms_policy_recs FOR UPDATE USING (prima.arpol_visible(data)) WITH CHECK (prima.arpol_visible(data));

-- Append-only history; identity, kind, reference, company and creation never change.
CREATE OR REPLACE FUNCTION prima.arpol_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Arms policy records are never deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind' OR NEW.data->'ref' IS DISTINCT FROM OLD.data->'ref'
       OR NEW.data->'at' IS DISTINCT FROM OLD.data->'at' OR NEW.data->'byId' IS DISTINCT FROM OLD.data->'byId'
       OR NEW.data->'companyId' IS DISTINCT FROM OLD.data->'companyId' THEN
      RAISE EXCEPTION 'Arms policy record identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(NEW.data->'history') <= jsonb_array_length(OLD.data->'history')
       OR (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) IS DISTINCT FROM OLD.data->'history'
       OR (NEW.data->>'version')::int <> (OLD.data->>'version')::int + 1 THEN
      RAISE EXCEPTION 'Arms policy history is append-only' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS arpol_guard ON prima.arms_policy_recs;
CREATE TRIGGER arpol_guard BEFORE UPDATE OR DELETE ON prima.arms_policy_recs FOR EACH ROW EXECUTE FUNCTION prima.arpol_guard();

GRANT SELECT, INSERT, UPDATE ON prima.arms_policy_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.arms_policy_recs FROM prima_app;
COMMIT;
