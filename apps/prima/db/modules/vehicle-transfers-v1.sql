-- Moving vehicles between group companies (E6, Fauzan 11 Nov 2026: "BUILD. Managed by the Transport department; the COO
-- monitors."). One new table, nothing else changed. Separate reviewed module: NOT registered in db/release-manifest.json
-- and not run by the office prima-setup; it is installed only by the CEO-run migration. Repeat-safe (IF NOT EXISTS,
-- CREATE OR REPLACE, DROP POLICY IF EXISTS).
--
-- Each row is one move: the Transport department asks (with the reason), a second Transport member or the COO approves
-- or returns it with a comment (never the person who asked), then Transport records the handover. The vehicle itself
-- (prima.vehicles, its own wall) moves only at the handover, in the same transaction. Readable by the Transport
-- department, the COO, the OGM and the group leaders; written by Transport and the COO; never deleted by the app.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.vehicle_transfers (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
DO $vt$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vt_id' AND conrelid = 'prima.vehicle_transfers'::regclass) THEN
    ALTER TABLE prima.vehicle_transfers ADD CONSTRAINT vt_id CHECK (data->>'id' = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vt_company' AND conrelid = 'prima.vehicle_transfers'::regclass) THEN
    ALTER TABLE prima.vehicle_transfers ADD CONSTRAINT vt_company CHECK (coalesce(data->>'companyId', '') = coalesce(company_id, ''));
  END IF;
  -- The shape the app writes, and nobody approves their own request, even through a fault in the app.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vt_shape' AND conrelid = 'prima.vehicle_transfers'::regclass) THEN
    ALTER TABLE prima.vehicle_transfers ADD CONSTRAINT vt_shape CHECK (
      data->>'status' IN ('requested', 'approved', 'returned', 'cancelled', 'handed_over')
      AND length(coalesce(data->>'vehicleId', '')) > 0
      AND length(coalesce(data->>'requestedById', '')) > 0
      AND length(trim(coalesce(data->>'reason', ''))) >= 5
      AND data->>'fromCompanyId' IS DISTINCT FROM data->>'toCompanyId'
      AND (coalesce(data->'decision', 'null'::jsonb) = 'null'::jsonb
           OR (data#>>'{decision,byId}' IS DISTINCT FROM data->>'requestedById' AND length(trim(coalesce(data#>>'{decision,note}', ''))) >= 3))
      AND (data->>'status' NOT IN ('approved', 'handed_over') OR (data#>>'{decision,approve}') = 'true')
      AND (data->>'status' <> 'handed_over' OR coalesce(data->'handover', 'null'::jsonb) <> 'null'::jsonb)
    );
  END IF;
END
$vt$;
CREATE INDEX IF NOT EXISTS vehicle_transfers_vehicle_idx ON prima.vehicle_transfers ((data->>'vehicleId'));
ALTER TABLE prima.vehicle_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.vehicle_transfers FORCE ROW LEVEL SECURITY;

-- The signed-in person's part in vehicle moves, read from the staff records (never from the request). Mirrors
-- vehicleTransferRole in packages/core/src/vehicle-transfer.ts.
CREATE OR REPLACE FUNCTION prima.vt_role(uid text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT CASE
    WHEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'transport' THEN 'transport'
    WHEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'opsTier' = 'coo' THEN 'coo'
    WHEN u.data->>'role' = 'director'
      OR (u.data->>'role' = 'pwvsb_officer' AND (u.data->>'opsTier' IN ('ceo', 'ogm') OR coalesce(u.data->>'leadership', '') <> ''
          OR (u.data->>'department' = 'audit' AND u.data->>'actRole' = 'lead'))) THEN 'monitor'
    ELSE NULL END
  FROM prima.users u
  WHERE u.id = uid
    AND coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
$$;
REVOKE ALL ON FUNCTION prima.vt_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.vt_role(text) TO prima_app;

REVOKE ALL ON prima.vehicle_transfers FROM PUBLIC;
REVOKE ALL ON prima.vehicle_transfers FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.vehicle_transfers TO prima_app;
DROP POLICY IF EXISTS vt_read ON prima.vehicle_transfers;
CREATE POLICY vt_read ON prima.vehicle_transfers FOR SELECT TO prima_app
  USING (prima.vt_role(current_setting('app.user_id', true)) IS NOT NULL);
-- Only the Transport department asks, and only in its own name.
DROP POLICY IF EXISTS vt_insert ON prima.vehicle_transfers;
CREATE POLICY vt_insert ON prima.vehicle_transfers FOR INSERT TO prima_app
  WITH CHECK (prima.vt_role(current_setting('app.user_id', true)) = 'transport'
              AND data->>'requestedById' = current_setting('app.user_id', true)
              AND data->>'status' = 'requested');
-- Transport and the COO move a request on (the no-self-approval check is the vt_shape constraint above).
DROP POLICY IF EXISTS vt_update ON prima.vehicle_transfers;
CREATE POLICY vt_update ON prima.vehicle_transfers FOR UPDATE TO prima_app
  USING (prima.vt_role(current_setting('app.user_id', true)) IN ('transport', 'coo'))
  WITH CHECK (prima.vt_role(current_setting('app.user_id', true)) IN ('transport', 'coo'));
COMMIT;
