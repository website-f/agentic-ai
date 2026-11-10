-- Staff clock face photos (P97, Fitri 11 Nov 2026: "In Prima clock-in I can clock in, but where is the face scan/snap?").
-- One new table, nothing else changed. Repeat-safe: the office's prima-setup runs this file on every start (as the schema
-- owner, in one transaction); a second run changes nothing.
--
-- Each staff check-in and check-out keeps a compressed face photo (or, with no camera, the person's reason) for the
-- person's manager or HR to look at (rule HR-STAFF-SNAP). Face is biometric data under the PDPA, so the wall here is
-- narrower than the staff clock's company wall: a row is readable only by the person it belongs to and by those who see
-- that person's staff clock (the Director, the CEO, the COO, the leadership and central HR everyone; a company manager
-- their own company's staff; the IT Manager the IT team). A colleague in the same company never reads it, even through
-- a fault in the app. Only the person adds their own row; only they (to drop an old picture) or a reader (to record the
-- review) change one; nothing is ever deleted by the app. The picture is dropped after the location retention.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.clock_snaps (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
DO $cs$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cs_id' AND conrelid = 'prima.clock_snaps'::regclass) THEN
    ALTER TABLE prima.clock_snaps ADD CONSTRAINT cs_id CHECK (data->>'id' = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cs_company' AND conrelid = 'prima.clock_snaps'::regclass) THEN
    ALTER TABLE prima.clock_snaps ADD CONSTRAINT cs_company CHECK (coalesce(data->>'companyId', '') = coalesce(company_id, ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cs_shape' AND conrelid = 'prima.clock_snaps'::regclass) THEN
    ALTER TABLE prima.clock_snaps ADD CONSTRAINT cs_shape CHECK (
      length(coalesce(data->>'userId', '')) > 0
      AND data->>'kind' IN ('in', 'out')
      AND data->>'mode' IN ('face', 'photo', 'none')
      AND length(coalesce(data->>'image', '')) <= 400000
    );
  END IF;
END
$cs$;
CREATE INDEX IF NOT EXISTS clock_snaps_data_idx ON prima.clock_snaps USING gin (data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS clock_snaps_user_idx ON prima.clock_snaps ((data->>'userId'));
ALTER TABLE prima.clock_snaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.clock_snaps FORCE ROW LEVEL SECURITY;

-- Whether a sign-in sees the staff clock of the person who owns a photo, read from the staff records (never from the
-- request). Mirrors the service's staff clock scope (service.ts staffClockScope and seesItTeamClock).
CREATE OR REPLACE FUNCTION prima.cs_reader(uid text, company text, owner text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(bool_or(
    coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
    AND (
      u.data->>'role' = 'director'
      OR (u.data->>'role' = 'pwvsb_officer' AND (
            u.data->>'opsTier' IN ('ceo', 'coo')
            OR coalesce(u.data->>'leadership', '') <> ''
            OR u.data->>'department' = 'hr'
            OR (u.data->>'department' = 'audit' AND u.data->>'actRole' = 'lead')
            OR (u.data->>'department' = 'it' AND u.data->>'itRole' = 'manager'
                AND EXISTS (SELECT 1 FROM prima.users o WHERE o.id = owner AND o.data->>'department' = 'it'))))
      OR (u.data->>'role' = 'company_manager' AND company IS NOT NULL AND coalesce(u.data->'companyIds', '[]'::jsonb) ? company)
    )
  ), false)
  FROM prima.users u WHERE u.id = uid
$$;
REVOKE ALL ON FUNCTION prima.cs_reader(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.cs_reader(text, text, text) TO prima_app;

REVOKE ALL ON prima.clock_snaps FROM PUBLIC;
REVOKE ALL ON prima.clock_snaps FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.clock_snaps TO prima_app;
DROP POLICY IF EXISTS cs_read ON prima.clock_snaps;
CREATE POLICY cs_read ON prima.clock_snaps FOR SELECT TO prima_app
  USING (data->>'userId' = current_setting('app.user_id', true)
         OR prima.cs_reader(current_setting('app.user_id', true), company_id, data->>'userId'));
DROP POLICY IF EXISTS cs_insert ON prima.clock_snaps;
CREATE POLICY cs_insert ON prima.clock_snaps FOR INSERT TO prima_app
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true));
DROP POLICY IF EXISTS cs_update ON prima.clock_snaps;
CREATE POLICY cs_update ON prima.clock_snaps FOR UPDATE TO prima_app
  USING (data->>'userId' = current_setting('app.user_id', true)
         OR prima.cs_reader(current_setting('app.user_id', true), company_id, data->>'userId'))
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true)
              OR prima.cs_reader(current_setting('app.user_id', true), company_id, data->>'userId'));
COMMIT;
