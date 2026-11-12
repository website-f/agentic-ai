-- FD stands in for the CEO on cash decisions (P100 B2, Fauzan 11 Nov 2026: "the FD can stand in for the CEO when needed").
-- One new table, nothing else changed. Repeat-safe: the office's prima-setup runs this file on every start (as the schema
-- owner, in one transaction); a second run changes nothing.
--
-- Each row is one stand-in the CEO turned on: for set dates while away, or for one named request, with the reason; and
-- every decision the Finance Director then made in the CEO's place (the CEO's notices). Group-wide, no company column.
-- Only the CEO turns one on or ends it; the FD may only add a decision to a stand-in that is on. Read by the CEO and the FD
-- only. Nothing is ever deleted by the app.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.cash_stand_ins (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
DO $csi$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csi_id' AND conrelid = 'prima.cash_stand_ins'::regclass) THEN
    ALTER TABLE prima.cash_stand_ins ADD CONSTRAINT csi_id CHECK (data->>'id' = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csi_shape' AND conrelid = 'prima.cash_stand_ins'::regclass) THEN
    ALTER TABLE prima.cash_stand_ins ADD CONSTRAINT csi_shape CHECK (
      data->>'kind' IN ('dates', 'request')
      AND length(coalesce(data->>'reason', '')) >= 5
      AND length(coalesce(data->'set'->>'byId', '')) > 0
      AND (data->>'kind' <> 'dates' OR (data->>'from' ~ '^\d{4}-\d{2}-\d{2}$' AND data->>'to' >= data->>'from'))
      AND (data->>'kind' <> 'request' OR length(coalesce(data->'request'->>'ref', '')) > 0)
      AND jsonb_typeof(data->'uses') = 'array'
    );
  END IF;
END
$csi$;
ALTER TABLE prima.cash_stand_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.cash_stand_ins FORCE ROW LEVEL SECURITY;

-- Who a sign-in is, read from the staff records (never from the request): 'ceo', 'fd' or nothing.
CREATE OR REPLACE FUNCTION prima.csi_role(uid text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT CASE
    WHEN u.data->>'opsTier' = 'ceo' AND u.data->>'role' IN ('director', 'pwvsb_officer') THEN 'ceo'
    WHEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' = 'finance_director' THEN 'fd'
  END
  FROM prima.users u
  WHERE u.id = uid
    AND coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
$$;
REVOKE ALL ON FUNCTION prima.csi_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.csi_role(text) TO prima_app;

REVOKE ALL ON prima.cash_stand_ins FROM PUBLIC;
REVOKE ALL ON prima.cash_stand_ins FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.cash_stand_ins TO prima_app;
DROP POLICY IF EXISTS csi_read ON prima.cash_stand_ins;
CREATE POLICY csi_read ON prima.cash_stand_ins FOR SELECT TO prima_app
  USING (prima.csi_role(current_setting('app.user_id', true)) IN ('ceo', 'fd'));
DROP POLICY IF EXISTS csi_insert ON prima.cash_stand_ins;
CREATE POLICY csi_insert ON prima.cash_stand_ins FOR INSERT TO prima_app
  WITH CHECK (prima.csi_role(current_setting('app.user_id', true)) = 'ceo'
              AND data->'set'->>'byId' = current_setting('app.user_id', true)
              AND jsonb_array_length(data->'uses') = 0);
DROP POLICY IF EXISTS csi_update ON prima.cash_stand_ins;
-- The CEO ends a stand-in or marks notices seen; the FD only adds a decision to one that is not ended.
CREATE POLICY csi_update ON prima.cash_stand_ins FOR UPDATE TO prima_app
  USING (prima.csi_role(current_setting('app.user_id', true)) = 'ceo'
         OR (prima.csi_role(current_setting('app.user_id', true)) = 'fd' AND coalesce(data->'ended', 'null'::jsonb) = 'null'::jsonb))
  WITH CHECK (prima.csi_role(current_setting('app.user_id', true)) = 'ceo'
              OR (prima.csi_role(current_setting('app.user_id', true)) = 'fd'
                  AND coalesce(data->'ended', 'null'::jsonb) = 'null'::jsonb
                  AND data->'uses'->(jsonb_array_length(data->'uses') - 1)->>'byId' = current_setting('app.user_id', true)));
COMMIT;
