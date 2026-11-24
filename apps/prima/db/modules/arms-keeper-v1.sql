-- Vault keepers (Fauzan, 23 Nov 2026, Arms Control check B1). PROPOSED: not in db/release-manifest.json; Fauzan runs it
-- with infra/run-db-migration.sh after db/modules/special-ops-v1.sql (it replaces that module's arms_wall policy on four
-- tables, so run it again whenever special-ops-v1.sql is run again). Repeat-safe.
--
-- The Amra of a vault, usually an admin executive, issues and receives firearms there (Fauzan, 25 Oct 2026). An admin
-- executive does not hold the arms wall, so until now the database hid every vault from them. A company sign-in with a
-- person record now holds the wall `arms_keeper` (packages/core/src/special-ops.ts, holdsArmsKeeperWall); with it, a
-- person reads and writes only the rows of the vaults they keep: where they are the named Amra (custodianPersonId) or
-- on the vault's written authorised list (authorisedStaff, not removed), matched by their own person record. Everyone
-- who held the arms wall before keeps exactly what they had. The company wall still applies on top.
BEGIN;

-- Both functions run as the caller (no SECURITY DEFINER): the vault lookup below goes through the vaults policies, which
-- test the vault row itself and never look up another table's arms rows, so nothing loops.
CREATE OR REPLACE FUNCTION prima.keeps_vault_row(cid text, d jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT prima.has_wall('arms_keeper') AND cid = ANY (prima.visible_companies()) AND EXISTS (
    SELECT 1
      FROM prima.users u
     WHERE u.id = current_setting('app.user_id', true)
       AND coalesce(u.data->>'personId', '') <> ''
       AND (d->>'custodianPersonId' = u.data->>'personId'
            OR EXISTS (SELECT 1
                         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'authorisedStaff') = 'array'
                                                        THEN d->'authorisedStaff' ELSE '[]'::jsonb END) a
                        WHERE a->>'personId' = u.data->>'personId'
                          AND coalesce(a->>'removedOn', '') = ''))
  )
$$;
CREATE OR REPLACE FUNCTION prima.keeps_vault(vid text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT prima.has_wall('arms_keeper') AND vid IS NOT NULL
     AND EXISTS (SELECT 1 FROM prima.vaults v WHERE v.id = vid AND prima.keeps_vault_row(v.company_id, v.data))
$$;
GRANT EXECUTE ON FUNCTION prima.keeps_vault_row(text, jsonb) TO prima_app;
GRANT EXECUTE ON FUNCTION prima.keeps_vault(text) TO prima_app;

DROP POLICY IF EXISTS arms_wall ON prima.vaults;
CREATE POLICY arms_wall ON prima.vaults AS RESTRICTIVE
  USING (prima.has_wall('arms') OR prima.keeps_vault_row(company_id, data))
  WITH CHECK (prima.has_wall('arms') OR prima.keeps_vault_row(company_id, data));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['firearms', 'arms_movements', 'ammo_stocks']
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS arms_wall ON prima.%1$I;
      CREATE POLICY arms_wall ON prima.%1$I AS RESTRICTIVE
        USING (prima.has_wall('arms') OR prima.keeps_vault(data->>'vaultId'))
        WITH CHECK (prima.has_wall('arms') OR prima.keeps_vault(data->>'vaultId'));
    $f$, t);
  END LOOP;
END $$;

COMMIT;
