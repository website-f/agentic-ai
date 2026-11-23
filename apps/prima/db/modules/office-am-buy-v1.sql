-- Buying new office items and renovation (Fauzan, 23 Nov 2026: assets go to Asset Management, which supervises; then
-- the operations head approves; the CEO also above RM50,000). Needs office-am-v1 first (same table, same walls).
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json.
-- Nothing is deleted and no table is added. It only widens two walls of prima.office_am_recs:
--   read and update: the operations head named on a "buy new" office job (d.purpose = 'buy', d.hod = 'ops_director'
--   or 'ogm') may read it and record their approval. The Chief of Staff (d.hod = 'cos') already reads and writes
--   through the Asset Management walls as a group leader. Everything else is unchanged from office-am-v1.
--   The service still checks the order (Asset Director first, then the operations head, then the CEO above the limit),
--   that nobody approves their own request or pick, and that the same person does not recommend and approve.
BEGIN;
CREATE OR REPLACE FUNCTION prima.oam_buy_hod(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT d->>'kind' = 'repair' AND d->'d'->>'purpose' = 'buy' AND d->'d'->>'hod' IN ('ops_director','ogm')
     AND coalesce(prima.oam_me('role'), '') = 'pwvsb_officer' AND prima.oam_me('opsTier') = d->'d'->>'hod'
$$;

CREATE OR REPLACE FUNCTION prima.oam_read(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.has_wall('asset_read')
      OR d->>'requesterId' = current_setting('app.user_id', true)
      OR (d->>'kind' = 'invAccess' AND d->'d'->>'userId' = current_setting('app.user_id', true))
      OR (d->>'kind' IN ('repair','jmb','invItem','invUpdate','disposal','visit') AND prima.oam_staff(d->>'companyId'))
      OR (d->>'kind' IN ('invItem','invUpdate','disposal') AND coalesce(prima.oam_me('role'), '') = 'pwvsb_officer' AND prima.oam_me('department') = 'hr')
      OR (d->>'kind' IN ('buildingBuy','bldConfirm') AND prima.oam_head(d->>'companyId'))
      OR (d->>'kind' IN ('officeTenancy','rentMonth') AND prima.oam_manages(d->>'unitId'))
      OR prima.oam_buy_hod(d);
$$;
CREATE OR REPLACE FUNCTION prima.oam_update(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT prima.has_wall('asset_write')
      OR (d->>'kind' IN ('repair','invUpdate','disposal') AND d->>'requesterId' = current_setting('app.user_id', true))
      OR (d->>'kind' IN ('buildingBuy','bldConfirm') AND prima.oam_head(d->>'companyId'))
      OR (d->>'kind' = 'visit' AND prima.oam_staff(d->>'companyId'))
      OR (d->>'kind' IN ('officeTenancy','rentMonth') AND prima.oam_manages(d->>'unitId'))
      OR prima.oam_buy_hod(d);
$$;
COMMIT;
