-- Office assets (Fitri package Part S1-S84, Unit Penyelenggaraan circular and policies, Fauzan's answers S-X1..S-X35,
-- 13-14 Nov 2026): office repair requests and JMB reports, office inventory items, update requests and update rights,
-- SharePoint download log, office asset disposal, building purchase files and monthly confirmations, management
-- agreements, office tenancies and rent months, visit schedules and visits.
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json: the
-- CEO-run migration (infra/run-db-migration.sh) and the combined release review add it. Nothing is deleted.
-- Walls:
--   read:   the Asset Management read wall (prima.has_wall('asset_read'): the unit, the Asset Director, Finance and group
--           leaders); the requester's own records; a person's own update-right switch; the company's own office staff
--           (director, company manager, admin executive, supervisor) for repairs, JMB reports, inventory, updates,
--           disposals and visits of a company in their wall; PWVSB HR for inventory, updates and disposals; the buying
--           company's head for its building files and confirmations; a managing company's office staff for the office
--           tenancies and rent months of the buildings an active management agreement covers.
--   insert: the Asset Management write wall; otherwise only the requester's own new repair, JMB report, inventory
--           update or disposal for a company in their wall, and a managing company's new office tenancy.
--   update: the Asset Management write wall; otherwise the requester's own record, the buying company head's building
--           file and confirmation, the company staff's visit (access confirmation), and a managing company's tenancy
--           and rent months.
--   Prices are hidden from requesters, office heads and HR by the service (the database cannot hide one field).
--   The service still checks who may take each step. Identity, kind, reference and company never change; history only
--   grows (append-only), checked by a trigger.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.office_am_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('settings','repair','jmb','invItem','invUpdate','invAccess','spExport','disposal','buildingBuy','bldConfirm','mgmtAgreement','officeTenancy','rentMonth','visitPlan','visit')),
  CHECK (jsonb_typeof(data->'history') = 'array')
);
ALTER TABLE prima.office_am_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.office_am_recs FORCE ROW LEVEL SECURITY;

-- The signed-in person's role and department (read with definer rights so the policy does not depend on users RLS).
CREATE OR REPLACE FUNCTION prima.oam_me(field text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT u.data->>field FROM prima.users u WHERE u.id = current_setting('app.user_id', true)
    AND coalesce(u.data->'integration', 'null'::jsonb) IN ('false'::jsonb, 'null'::jsonb)
$$;
-- Is the signed-in person office staff of a company in their wall (never a PWVSB officer, a guard or a device)?
CREATE OR REPLACE FUNCTION prima.oam_staff(company text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT company IS NOT NULL AND company = ANY (prima.visible_companies())
     AND coalesce(prima.oam_me('role'), '') IN ('director','company_manager','admin_exec','supervisor')
$$;
CREATE OR REPLACE FUNCTION prima.oam_head(company text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT company IS NOT NULL AND company = ANY (prima.visible_companies())
     AND coalesce(prima.oam_me('role'), '') IN ('director','company_manager')
$$;
-- An active management agreement lets the managing company's office staff work this building's rent (S-X23).
-- Definer rights: reads the agreements without the caller's row policy (no recursion).
CREATE OR REPLACE FUNCTION prima.oam_manages(unit text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT unit IS NOT NULL AND coalesce(prima.oam_me('role'), '') IN ('company_manager','admin_exec') AND EXISTS (
    SELECT 1 FROM prima.office_am_recs a
     WHERE a.data->>'kind' = 'mgmtAgreement' AND a.data->>'status' = 'active'
       AND a.data->'d'->'unitIds' ? unit
       AND a.data->'d'->>'startOn' <= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')
       AND a.data->'d'->>'endOn' >= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')
       AND a.data->'d'->>'managingCompanyId' = ANY (prima.visible_companies()))
$$;
REVOKE ALL ON FUNCTION prima.oam_me(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION prima.oam_manages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.oam_me(text) TO prima_app;
GRANT EXECUTE ON FUNCTION prima.oam_manages(text) TO prima_app;

CREATE OR REPLACE FUNCTION prima.oam_read(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.has_wall('asset_read')
      OR d->>'requesterId' = current_setting('app.user_id', true)
      OR (d->>'kind' = 'invAccess' AND d->'d'->>'userId' = current_setting('app.user_id', true))
      OR (d->>'kind' IN ('repair','jmb','invItem','invUpdate','disposal','visit') AND prima.oam_staff(d->>'companyId'))
      OR (d->>'kind' IN ('invItem','invUpdate','disposal') AND coalesce(prima.oam_me('role'), '') = 'pwvsb_officer' AND prima.oam_me('department') = 'hr')
      OR (d->>'kind' IN ('buildingBuy','bldConfirm') AND prima.oam_head(d->>'companyId'))
      OR (d->>'kind' IN ('officeTenancy','rentMonth') AND prima.oam_manages(d->>'unitId'));
$$;
CREATE OR REPLACE FUNCTION prima.oam_insert(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.has_wall('asset_write')
      OR (d->>'kind' IN ('repair','jmb','invUpdate','disposal') AND d->>'requesterId' = current_setting('app.user_id', true)
          AND d->>'status' IN ('submitted','to_report') AND d->>'byId' = current_setting('app.user_id', true)
          AND (d->>'companyId' IS NULL OR d->>'companyId' = ANY (prima.visible_companies())))
      OR (d->>'kind' = 'officeTenancy' AND prima.oam_manages(d->>'unitId'));
$$;
CREATE OR REPLACE FUNCTION prima.oam_update(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.has_wall('asset_write')
      OR (d->>'kind' IN ('repair','invUpdate','disposal') AND d->>'requesterId' = current_setting('app.user_id', true))
      OR (d->>'kind' IN ('buildingBuy','bldConfirm') AND prima.oam_head(d->>'companyId'))
      OR (d->>'kind' = 'visit' AND prima.oam_staff(d->>'companyId'))
      OR (d->>'kind' IN ('officeTenancy','rentMonth') AND prima.oam_manages(d->>'unitId'));
$$;

DROP POLICY IF EXISTS oam_read ON prima.office_am_recs;
DROP POLICY IF EXISTS oam_insert ON prima.office_am_recs;
DROP POLICY IF EXISTS oam_update ON prima.office_am_recs;
CREATE POLICY oam_read ON prima.office_am_recs FOR SELECT USING (prima.oam_read(data));
CREATE POLICY oam_insert ON prima.office_am_recs FOR INSERT WITH CHECK (prima.oam_insert(data));
CREATE POLICY oam_update ON prima.office_am_recs FOR UPDATE USING (prima.oam_update(data)) WITH CHECK (prima.oam_update(data));

-- Append-only history; identity, kind, reference, company, requester and creation never change.
CREATE OR REPLACE FUNCTION prima.oam_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Office asset records are never deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind' OR NEW.data->'ref' IS DISTINCT FROM OLD.data->'ref'
       OR NEW.data->'at' IS DISTINCT FROM OLD.data->'at' OR NEW.data->'byId' IS DISTINCT FROM OLD.data->'byId'
       OR NEW.data->'companyId' IS DISTINCT FROM OLD.data->'companyId' OR NEW.data->'requesterId' IS DISTINCT FROM OLD.data->'requesterId' THEN
      RAISE EXCEPTION 'Office asset record identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(NEW.data->'history') <= jsonb_array_length(OLD.data->'history')
       OR (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) IS DISTINCT FROM OLD.data->'history'
       OR (NEW.data->>'version')::int <> (OLD.data->>'version')::int + 1 THEN
      RAISE EXCEPTION 'Office asset history is append-only' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS oam_guard ON prima.office_am_recs;
CREATE TRIGGER oam_guard BEFORE UPDATE OR DELETE ON prima.office_am_recs FOR EACH ROW EXECUTE FUNCTION prima.oam_guard();

GRANT SELECT, INSERT, UPDATE ON prima.office_am_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.office_am_recs FROM prima_app;
COMMIT;
