-- Bulk load records (K8, Fauzan 11 Nov 2026: "AI data manager and file manager, so it sends to correct places when bulk
-- data are loaded"). One new table, nothing else changed. Repeat-safe: the office's prima-setup runs this file on every
-- start (as the schema owner, in one transaction); a second run changes nothing.
--
-- Every bulk load keeps a record: who loaded it, the plan they confirmed (column headings and fields only, never a value
-- from the file), the rows saved and the rows left out with their reasons, which receipt or staff directory batch it
-- was, and for many files which document went to whose HR file. The data itself goes in through each record's own
-- import or the staff directory, with their own walls. A record is added only by the person who loaded, as themselves;
-- it is read by that person and by oversight (directors, the CEO and COO, group leadership and ACT); it is never changed
-- or deleted by the app.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.bulk_loads (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
DO $bl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bl_id' AND conrelid = 'prima.bulk_loads'::regclass) THEN
    ALTER TABLE prima.bulk_loads ADD CONSTRAINT bl_id CHECK (data->>'id' = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bl_shape' AND conrelid = 'prima.bulk_loads'::regclass) THEN
    ALTER TABLE prima.bulk_loads ADD CONSTRAINT bl_shape CHECK (
      data->>'kind' IN ('data', 'files')
      AND length(coalesce(data->>'loadedById', '')) > 0
      AND length(coalesce(data->>'target', '')) > 0
      AND jsonb_typeof(data->'plan') = 'array'
      AND jsonb_typeof(data->'refused') = 'array'
      AND jsonb_typeof(data->'placed') = 'array'
      AND length(data::text) <= 600000
    );
  END IF;
END
$bl$;
CREATE INDEX IF NOT EXISTS bulk_loads_by_idx ON prima.bulk_loads ((data->>'loadedById'));
ALTER TABLE prima.bulk_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.bulk_loads FORCE ROW LEVEL SECURITY;

-- Oversight, read from the staff record (never from the request). Mirrors bulkLoadOverseer in bulk-manager-service.ts.
CREATE OR REPLACE FUNCTION prima.bl_overseer(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(bool_or(
    coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
    AND (
      u.data->>'role' = 'director'
      OR u.data->>'opsTier' IN ('ceo', 'coo')
      OR coalesce(u.data->>'leadership', '') <> ''
      OR u.data->>'department' = 'audit'
    )
  ), false)
  FROM prima.users u WHERE u.id = uid
$$;
REVOKE ALL ON FUNCTION prima.bl_overseer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.bl_overseer(text) TO prima_app;

-- Who may add a record at all: an open sign-in of a person (not a feed, site device, guard or site officer).
CREATE OR REPLACE FUNCTION prima.bl_loader(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(bool_or(
    coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND u.data->>'role' NOT IN ('site_device', 'guard', 'supervisor')
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
  ), false)
  FROM prima.users u WHERE u.id = uid
$$;
REVOKE ALL ON FUNCTION prima.bl_loader(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.bl_loader(text) TO prima_app;

REVOKE ALL ON prima.bulk_loads FROM PUBLIC;
REVOKE ALL ON prima.bulk_loads FROM prima_app;
GRANT SELECT, INSERT ON prima.bulk_loads TO prima_app;
DROP POLICY IF EXISTS bl_read ON prima.bulk_loads;
CREATE POLICY bl_read ON prima.bulk_loads FOR SELECT TO prima_app
  USING (data->>'loadedById' = current_setting('app.user_id', true)
         OR prima.bl_overseer(current_setting('app.user_id', true)));
DROP POLICY IF EXISTS bl_insert ON prima.bulk_loads;
CREATE POLICY bl_insert ON prima.bulk_loads FOR INSERT TO prima_app
  WITH CHECK (data->>'loadedById' = current_setting('app.user_id', true)
              AND prima.bl_loader(current_setting('app.user_id', true)));
COMMIT;
