-- Guard sign-ins made in bulk with a review step (J5, Fauzan 11 Nov 2026: "Guard phone bulk sign-ins and 90-day location
-- deletion: BUILD"). One new table and one function; nothing else changed. Separate reviewed module: NOT registered in
-- db/release-manifest.json and not run by the office prima-setup; installed only by the CEO-run migration. Repeat-safe.
--
-- HR, the company office or the Operations Manager prepares a batch of the company's active guards without a sign-in;
-- another person approves it with a comment (never the preparer). The API login may only read prima.users, by design,
-- so the sign-ins are made here, by prima.gsb_create, which re-checks everything from the database itself: the batch is
-- approved, by the person calling, who is an approver for that company and not the preparer; each row is an active
-- guard of that company with no sign-in yet. Each sign-in is role guard for that one company, linked to the person,
-- with no grant, department or other field. The guard phone itself stays switched off (GUARD_PHONE).
BEGIN;
CREATE TABLE IF NOT EXISTS prima.guard_signin_batches (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL
);
DO $gsb$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gsb_id' AND conrelid = 'prima.guard_signin_batches'::regclass) THEN
    ALTER TABLE prima.guard_signin_batches ADD CONSTRAINT gsb_id CHECK (data->>'id' = id AND data->>'companyId' = company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gsb_shape' AND conrelid = 'prima.guard_signin_batches'::regclass) THEN
    ALTER TABLE prima.guard_signin_batches ADD CONSTRAINT gsb_shape CHECK (
      data->>'status' IN ('prepared', 'approved', 'created', 'returned', 'cancelled')
      AND jsonb_typeof(data->'rows') = 'array' AND jsonb_array_length(data->'rows') BETWEEN 1 AND 500
      AND length(coalesce(data->>'preparedById', '')) > 0
      AND (coalesce(data->'decision', 'null'::jsonb) = 'null'::jsonb
           OR (data#>>'{decision,byId}' IS DISTINCT FROM data->>'preparedById' AND length(trim(coalesce(data#>>'{decision,note}', ''))) >= 3))
    );
  END IF;
END
$gsb$;
ALTER TABLE prima.guard_signin_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.guard_signin_batches FORCE ROW LEVEL SECURITY;

-- Who prepares and who approves for a company, from the staff records (mirrors guardSignInRole in guard-signins.ts).
-- 'approve' implies 'prepare' only where the service says so; this answers 'approve', 'prepare' or NULL.
CREATE OR REPLACE FUNCTION prima.gsb_role(uid text, company text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT CASE
    WHEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'hr' THEN 'approve'
    WHEN u.data->>'role' = 'company_manager' AND coalesce(u.data->'companyIds', '[]'::jsonb) ? company THEN 'approve'
    WHEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'opsTier' IN ('ogm', 'ops_director') THEN 'approve'
    WHEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' IN ('cos', 'deputy_cos') THEN 'approve'
    WHEN u.data->>'role' = 'admin_exec' AND coalesce(u.data->'companyIds', '[]'::jsonb) ? company THEN 'prepare'
    WHEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'operations' AND u.data->>'opsTier' IN ('om', 'regional') THEN 'prepare'
    ELSE NULL END
  FROM prima.users u
  WHERE u.id = uid
    AND coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
$$;
REVOKE ALL ON FUNCTION prima.gsb_role(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.gsb_role(text, text) TO prima_app;

REVOKE ALL ON prima.guard_signin_batches FROM PUBLIC;
REVOKE ALL ON prima.guard_signin_batches FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.guard_signin_batches TO prima_app;
-- The company wall, and only those who prepare or approve for that company.
DROP POLICY IF EXISTS gsb_read ON prima.guard_signin_batches;
CREATE POLICY gsb_read ON prima.guard_signin_batches FOR SELECT TO prima_app
  USING (company_id = ANY (prima.visible_companies()) AND prima.gsb_role(current_setting('app.user_id', true), company_id) IS NOT NULL);
DROP POLICY IF EXISTS gsb_insert ON prima.guard_signin_batches;
CREATE POLICY gsb_insert ON prima.guard_signin_batches FOR INSERT TO prima_app
  WITH CHECK (company_id = ANY (prima.visible_companies()) AND prima.gsb_role(current_setting('app.user_id', true), company_id) IS NOT NULL
              AND data->>'preparedById' = current_setting('app.user_id', true) AND data->>'status' = 'prepared');
DROP POLICY IF EXISTS gsb_update ON prima.guard_signin_batches;
CREATE POLICY gsb_update ON prima.guard_signin_batches FOR UPDATE TO prima_app
  USING (company_id = ANY (prima.visible_companies()) AND prima.gsb_role(current_setting('app.user_id', true), company_id) IS NOT NULL)
  WITH CHECK (company_id = ANY (prima.visible_companies()) AND prima.gsb_role(current_setting('app.user_id', true), company_id) IS NOT NULL
              AND data->>'status' <> 'created');

-- The schema owner (only ever reached through prima.gsb_create below) reads and finishes a batch; as on prima.audit.
DROP POLICY IF EXISTS gsb_owner ON prima.guard_signin_batches;
CREATE POLICY gsb_owner ON prima.guard_signin_batches TO CURRENT_USER USING (true) WITH CHECK (true);

-- Makes the sign-ins of one approved batch, as the schema owner. Returns how many were made and which were skipped.
CREATE OR REPLACE FUNCTION prima.gsb_create(batch_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
DECLARE
  me text := current_setting('app.user_id', true);
  b jsonb;
  co text;
  r jsonb;
  p jsonb;
  made int := 0;
  skipped jsonb := '[]'::jsonb;
BEGIN
  SELECT data, company_id INTO b, co FROM prima.guard_signin_batches WHERE id = batch_id FOR UPDATE;
  IF b IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF b->>'status' <> 'approved' OR b#>>'{decision,approve}' <> 'true' THEN RAISE EXCEPTION 'The batch is not approved'; END IF;
  IF coalesce(me, '') = '' OR b#>>'{decision,byId}' IS DISTINCT FROM me OR me = b->>'preparedById' THEN RAISE EXCEPTION 'Only the approver, who is not the preparer, makes the sign-ins'; END IF;
  IF prima.gsb_role(me, co) IS DISTINCT FROM 'approve' OR NOT (co = ANY (prima.visible_companies())) THEN RAISE EXCEPTION 'Not an approver for this company'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(b->'rows') LOOP
    SELECT data INTO p FROM prima.people WHERE id = r->>'personId' AND company_id = co;
    IF p IS NULL OR p->>'role' <> 'guard' OR p->>'status' <> 'active' THEN
      skipped := skipped || jsonb_build_object('personId', r->>'personId', 'why', 'no longer an active guard');
    ELSIF EXISTS (SELECT 1 FROM prima.users WHERE data->>'personId' = p->>'id' OR id = 'u-g-' || (p->>'id')) THEN
      skipped := skipped || jsonb_build_object('personId', r->>'personId', 'why', 'already has a sign-in');
    ELSE
      INSERT INTO prima.users (id, data) VALUES ('u-g-' || (p->>'id'), jsonb_build_object(
        'id', 'u-g-' || (p->>'id'), 'name', p->>'name', 'title', 'Guard ' || (p->>'staffNo') || ', own view only',
        'role', 'guard', 'companyIds', jsonb_build_array(co), 'siteIds', '[]'::jsonb, 'personId', p->>'id'));
      made := made + 1;
    END IF;
  END LOOP;
  UPDATE prima.guard_signin_batches SET data = data || jsonb_build_object('status', 'created', 'created',
    jsonb_build_object('count', made, 'skipped', skipped, 'at', to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"')))
  WHERE id = batch_id;
  RETURN jsonb_build_object('count', made, 'skipped', skipped);
END
$$;
REVOKE ALL ON FUNCTION prima.gsb_create(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.gsb_create(text) TO prima_app;
COMMIT;
