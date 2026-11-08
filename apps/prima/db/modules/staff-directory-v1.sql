-- Staff directory (Fauzan, 4 Nov 2026). Separate reviewed module; never run implicitly during startup.
-- Holds office staff and their mailboxes as HR loads them. It never creates a sign-in, grant, staff record or Microsoft
-- link. Only central HR, the HR Director (Chief of Staff or Deputy), the CEO and IT can read it; HR and the HR Director
-- add; the HR Director or the CEO approve a batch. Nothing is ever deleted by the app.
BEGIN;
CREATE TABLE prima.staff_directory(id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE prima.staff_directory_batches(id text PRIMARY KEY, data jsonb NOT NULL);
ALTER TABLE prima.staff_directory ADD CONSTRAINT sd_group CHECK (data->>'group' IN ('company','central_unit','operations_region'));
ALTER TABLE prima.staff_directory ADD CONSTRAINT sd_name CHECK (length(coalesce(data->>'name','')) BETWEEN 1 AND 160);
ALTER TABLE prima.staff_directory ADD CONSTRAINT sd_id CHECK (data->>'id' = id);
ALTER TABLE prima.staff_directory_batches ADD CONSTRAINT sdb_status CHECK (data->>'status' IN ('waiting','approved','returned'));
ALTER TABLE prima.staff_directory_batches ADD CONSTRAINT sdb_id CHECK (data->>'id' = id);
ALTER TABLE prima.staff_directory_batches ADD CONSTRAINT sdb_not_self CHECK (data->>'status' = 'waiting' OR (data->>'decidedById' IS NOT NULL AND data->>'decidedById' <> data->>'preparedById'));
CREATE UNIQUE INDEX sdb_live_fingerprint ON prima.staff_directory_batches((data->>'fingerprint')) WHERE data->>'status' <> 'returned';

-- Who the signed-in person is, read from the staff record (never from the request).
CREATE OR REPLACE FUNCTION prima.sd_role(uid text, need text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(
   coalesce(u.data->'integration','null'::jsonb) IN ('false'::jsonb,'null'::jsonb) AND u.data->>'role' <> 'site_device'
   AND (coalesce(u.data->>'accessClosedFrom','') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))
   AND CASE need
     WHEN 'prepare' THEN u.data->>'department' = 'hr' OR u.data->>'leadership' IN ('cos','deputy_cos')
     WHEN 'approve' THEN u.data->>'leadership' IN ('cos','deputy_cos') OR (u.data->>'role' IN ('director','pwvsb_officer') AND u.data->>'opsTier' = 'ceo')
     WHEN 'read' THEN u.data->>'department' = 'hr' OR u.data->>'leadership' IN ('cos','deputy_cos')
       OR (u.data->>'role' IN ('director','pwvsb_officer') AND u.data->>'opsTier' = 'ceo')
       OR (u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'it' AND u.data->>'itRole' IN ('manager','lead','executive'))
     ELSE false END), false)
 FROM prima.users u WHERE u.id = uid
$$;
REVOKE ALL ON FUNCTION prima.sd_role(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.sd_role(text,text) TO prima_app;

DO $install$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['staff_directory','staff_directory_batches'] LOOP
  EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY sd_owner ON prima.%I FOR ALL TO %I USING (true) WITH CHECK (true)', t, current_user);
  EXECUTE format('REVOKE ALL ON prima.%I FROM PUBLIC, prima_app', t);
  EXECUTE format('CREATE POLICY sd_read ON prima.%I FOR SELECT TO prima_app USING (prima.sd_role(current_setting(''app.user_id'', true), ''read''))', t);
 END LOOP;
 -- Entries: added by HR by hand, or by the approver when a batch is approved. Never changed or removed by the app.
 GRANT SELECT, INSERT ON prima.staff_directory TO prima_app;
 CREATE POLICY sd_insert ON prima.staff_directory FOR INSERT TO prima_app WITH CHECK (
   data->>'addedById' = current_setting('app.user_id', true)
   AND (prima.sd_role(current_setting('app.user_id', true), 'prepare') AND data->'batchId' = 'null'::jsonb
        OR prima.sd_role(current_setting('app.user_id', true), 'approve') AND data->>'batchId' IS NOT NULL));
 -- Batches: HR sends one (waiting); the HR Director or the CEO, not the preparer, approves or returns it.
 GRANT SELECT, INSERT, UPDATE ON prima.staff_directory_batches TO prima_app;
 CREATE POLICY sdb_insert ON prima.staff_directory_batches FOR INSERT TO prima_app WITH CHECK (
   data->>'status' = 'waiting' AND data->>'preparedById' = current_setting('app.user_id', true)
   AND prima.sd_role(current_setting('app.user_id', true), 'prepare'));
 CREATE POLICY sdb_decide ON prima.staff_directory_batches FOR UPDATE TO prima_app
   USING (data->>'status' = 'waiting' AND prima.sd_role(current_setting('app.user_id', true), 'approve'))
   WITH CHECK (data->>'status' IN ('approved','returned') AND data->>'decidedById' = current_setting('app.user_id', true)
     AND data->>'preparedById' <> current_setting('app.user_id', true));
END
$install$;
COMMIT;
