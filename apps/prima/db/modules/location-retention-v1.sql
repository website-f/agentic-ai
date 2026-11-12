-- Location readings kept 90 days, then deleted automatically (J5 and G9, Fauzan 11 Nov 2026: "Keep staff location
-- readings 90 days; site visitor records 7 years. Approved." and "90-day location deletion: BUILD"). One function and two
-- owner-only policies; no table is created or changed. Separate reviewed module: NOT registered in
-- db/release-manifest.json and not run by the office prima-setup; installed only by the CEO-run migration. Repeat-safe.
--
-- prima.purge_location_readings(keep_days) deletes staff clock readings (prima.location_pings) and guard phone readings
-- (prima.guard_pings) taken before the cut-off, and drops the photo of a staff check-in face photo past its keep date
-- (prima.clock_snaps, when that module is installed), keeping the row. It runs only for the retention job (the API's own
-- daily job sets app.job = 'location-retention'), never for a person's request, and refuses a keep period under 30 days.
-- The app login still has no DELETE right on these tables: only this function deletes, as the schema owner.
BEGIN;
-- The schema owner reaches these rows only through the function below (as prima.audit_owner_read does for the audit).
DROP POLICY IF EXISTS location_retention_owner ON prima.location_pings;
CREATE POLICY location_retention_owner ON prima.location_pings TO CURRENT_USER USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS guard_ping_retention_owner ON prima.guard_pings;
CREATE POLICY guard_ping_retention_owner ON prima.guard_pings TO CURRENT_USER USING (true) WITH CHECK (true);
DO $lr$
BEGIN
  IF to_regclass('prima.clock_snaps') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS clock_snap_retention_owner ON prima.clock_snaps';
    EXECUTE 'CREATE POLICY clock_snap_retention_owner ON prima.clock_snaps TO CURRENT_USER USING (true) WITH CHECK (true)';
  END IF;
END
$lr$;

CREATE OR REPLACE FUNCTION prima.purge_location_readings(keep_days int) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
DECLARE
  cutoff timestamptz;
  staff int := 0;
  guards int := 0;
  photos int := 0;
BEGIN
  IF coalesce(current_setting('app.job', true), '') <> 'location-retention' THEN RAISE EXCEPTION 'Only the location retention job deletes readings'; END IF;
  IF keep_days IS NULL OR keep_days < 30 THEN RAISE EXCEPTION 'Readings are kept at least 30 days'; END IF;
  cutoff := now() - make_interval(days => keep_days);
  DELETE FROM prima.location_pings WHERE (data->>'capturedAt')::timestamptz < cutoff;
  GET DIAGNOSTICS staff = ROW_COUNT;
  DELETE FROM prima.guard_pings WHERE (data->>'capturedAt')::timestamptz < cutoff;
  GET DIAGNOSTICS guards = ROW_COUNT;
  IF to_regclass('prima.clock_snaps') IS NOT NULL THEN
    EXECUTE $q$UPDATE prima.clock_snaps SET data = data || '{"image": null}'::jsonb
      WHERE coalesce(data->>'image', '') <> '' AND coalesce(data->>'keepUntil', '9999-12-31') < to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')$q$;
    GET DIAGNOSTICS photos = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('staff', staff, 'guards', guards, 'photos', photos, 'cutoff', cutoff);
END
$$;
REVOKE ALL ON FUNCTION prima.purge_location_readings(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.purge_location_readings(int) TO prima_app;
COMMIT;
