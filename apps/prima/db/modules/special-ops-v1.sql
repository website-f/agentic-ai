-- Special Operations walls, Phase 4 slice 4A (Fauzan, 2 Nov 2026). PROPOSED: not in db/release-manifest.json, not
-- installed anywhere. It stays out of the base schema so the reviewed IT pilot base (001_init.sql) is unchanged and the
-- department PRs stop colliding on one file; the release owner packages it as a pinned module before the Special Ops
-- rollout (PRIMA_ROLLOUTS=special_ops), and only an authorized owner installs it. Repeat-safe: it replaces its own
-- policies only. It narrows access (RESTRICTIVE walls) and adds INSERT/UPDATE on three group tables.
--
-- Slices 4B-4H add no table: their records are fields on existing arms, vehicle and asset rows, so this one file is
-- the whole database change for Phase 4 so far.
-- Special Operations walls (Phase 4, slice 4A, Fauzan 2 Nov 2026). Arms records sit behind the company wall AND an
-- arms wall: a RESTRICTIVE policy, so a Finance, HR or IT sign-in with a company grant still reads no vault, firearm,
-- movement, ammunition, armed job, arms agreement, arms request or dealer licence. Arms suppliers and their price list
-- (group-wide, no company column) and the CMS roster and staff list get their own walls. The API sets the walls from
-- access.ts (holdsArmsWall, holdsCmsWall). Arms suppliers, supplier items and CMS staff were read-only for the API, so
-- their forms could not save; Arms Control may now add and edit them (the service still checks who may).
BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vaults', 'firearms', 'arms_movements', 'armed_jobs', 'dealer_licences', 'vault_watches',
                           'vault_events', 'ammo_stocks', 'arms_agreements', 'arms_requests']
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS arms_wall ON prima.%1$I;
      CREATE POLICY arms_wall ON prima.%1$I AS RESTRICTIVE
        USING (prima.has_wall('arms')) WITH CHECK (prima.has_wall('arms'));
    $f$, t);
  END LOOP;
  FOR t IN SELECT * FROM (VALUES ('arms_suppliers'), ('supplier_items'), ('cms_staff'), ('cms_shifts')) AS v(tbl)
  LOOP
    EXECUTE format($f$
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS dept_wall ON prima.%1$I;
      CREATE POLICY dept_wall ON prima.%1$I USING (prima.has_wall(%2$L)) WITH CHECK (prima.has_wall(%2$L));
    $f$, t, CASE WHEN t LIKE 'cms_%' THEN 'cms' ELSE 'arms' END);
  END LOOP;
END $$;
GRANT INSERT, UPDATE ON prima.arms_suppliers, prima.supplier_items, prima.cms_staff TO prima_app;
COMMIT;
