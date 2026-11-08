-- Owner test check-in (P90, Fitri 9 Nov 2026: "for owner make it can check in and checkout as well to test the function,
-- so they can check in and then check out and then see the movements from check-in until check-out").
-- One new table, nothing else changed. Repeat-safe: the office's prima-setup runs this file on every start (as the schema
-- owner, in one transaction); a second run changes nothing.
--
-- The owner (the CEO's own sign-in: role director or pwvsb_officer with opsTier ceo, not a system connection, access not
-- closed) has no staff clock. Their TEST sessions live here, apart from staff_clocks, checkin_events, location_pings and
-- attendance, so no clock board, attendance report, KPI or pay run can ever read them. Each row is readable and changeable
-- only by the person it belongs to; only the owner can add one; nothing is ever deleted by the app.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.owner_test_checkins (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
DO $otc$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'otc_id' AND conrelid = 'prima.owner_test_checkins'::regclass) THEN
    ALTER TABLE prima.owner_test_checkins ADD CONSTRAINT otc_id CHECK (data->>'id' = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'otc_test_only' AND conrelid = 'prima.owner_test_checkins'::regclass) THEN
    ALTER TABLE prima.owner_test_checkins ADD CONSTRAINT otc_test_only CHECK (data->>'purpose' = 'test' AND length(coalesce(data->>'userId', '')) > 0);
  END IF;
END
$otc$;
CREATE INDEX IF NOT EXISTS owner_test_checkins_user_idx ON prima.owner_test_checkins ((data->>'userId'));
ALTER TABLE prima.owner_test_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.owner_test_checkins FORCE ROW LEVEL SECURITY;

-- Whether a sign-in is the owner, read from the staff record (never from the request).
CREATE OR REPLACE FUNCTION prima.otc_owner(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(bool_or(
    coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND u.data->>'role' IN ('director', 'pwvsb_officer')
    AND u.data->>'opsTier' = 'ceo'
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
  ), false)
  FROM prima.users u WHERE u.id = uid
$$;
REVOKE ALL ON FUNCTION prima.otc_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.otc_owner(text) TO prima_app;

REVOKE ALL ON prima.owner_test_checkins FROM PUBLIC;
REVOKE ALL ON prima.owner_test_checkins FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.owner_test_checkins TO prima_app;
DROP POLICY IF EXISTS otc_read ON prima.owner_test_checkins;
CREATE POLICY otc_read ON prima.owner_test_checkins FOR SELECT TO prima_app
  USING (data->>'userId' = current_setting('app.user_id', true));
DROP POLICY IF EXISTS otc_insert ON prima.owner_test_checkins;
CREATE POLICY otc_insert ON prima.owner_test_checkins FOR INSERT TO prima_app
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true) AND prima.otc_owner(current_setting('app.user_id', true)));
DROP POLICY IF EXISTS otc_update ON prima.owner_test_checkins;
CREATE POLICY otc_update ON prima.owner_test_checkins FOR UPDATE TO prima_app
  USING (data->>'userId' = current_setting('app.user_id', true) AND prima.otc_owner(current_setting('app.user_id', true)))
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true) AND prima.otc_owner(current_setting('app.user_id', true)));
COMMIT;
