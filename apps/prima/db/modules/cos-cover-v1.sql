-- Chief of Staff cover (HR gap D1; Fauzan, 23 Nov 2026: "Yes and hr adminstrator. Cos can delegate what needed").
-- Separate reviewed module; never run implicitly during startup. NOT in db/release-manifest.json: run it only with
-- infra/run-db-migration.sh, staging first, with the CEO's go-ahead. Repeat-safe.
--
-- prima.cos_cover keeps each change the Chief of Staff makes to who acts for them on the items only they did (memos to
-- all staff, office requests, the advance and loan scheme, the PDPA switch, which office runs a company). The latest
-- row per item is in force. Rows are never changed or removed: no update, no delete. Every signed-in session reads them
-- (they hold item names, who and until when, never personal data); only the Chief of Staff, as themselves, adds one.
--
-- prima.cos_cover_acts(item) answers, for the signed-in person, whether they act for the Chief of Staff on that item
-- today: the Deputy while the Chief of Staff is on approved leave, or the Deputy or HR Administrator the Chief of Staff
-- named. The service checks the same rule (packages/core/src/hr.ts cosActs).
--
-- If prima.company_run_links (module company-run-links-v1) is installed, two extra policies let whoever covers
-- 'office_run_by' set the link inside their company wall, exactly as the Chief of Staff does. Run this module AFTER
-- company-run-links-v1 so those policies are added; a later re-run adds them if that module came later.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.cos_cover (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT cos_cover_id_matches CHECK (data->>'id' = id),
  CONSTRAINT cos_cover_item CHECK (data->>'item' IN ('staff_memo', 'office_requests', 'staff_loans', 'pdpa_switch', 'office_run_by')),
  CONSTRAINT cos_cover_to CHECK (jsonb_typeof(data->'to') = 'array' AND ((data->'to') - 'dcos'::text - 'hr_admin'::text) = '[]'::jsonb)
);
ALTER TABLE prima.cos_cover ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.cos_cover FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cos_cover_read ON prima.cos_cover;
DROP POLICY IF EXISTS cos_cover_add ON prima.cos_cover;
CREATE POLICY cos_cover_read ON prima.cos_cover FOR SELECT
  USING (coalesce(current_setting('app.user_id', true), '') <> '');
CREATE POLICY cos_cover_add ON prima.cos_cover FOR INSERT
  WITH CHECK (
    data->>'byId' = current_setting('app.user_id', true)
    AND EXISTS (SELECT 1 FROM prima.users u
                 WHERE u.id = current_setting('app.user_id', true)
                   AND u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' = 'cos')
  );
REVOKE ALL ON prima.cos_cover FROM PUBLIC;
REVOKE ALL ON prima.cos_cover FROM prima_app;
GRANT SELECT, INSERT ON prima.cos_cover TO prima_app;

CREATE OR REPLACE FUNCTION prima.cos_cover_acts(item text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = prima, pg_temp AS $$
  WITH me AS (
    SELECT u.data FROM prima.users u WHERE u.id = nullif(current_setting('app.user_id', true), '')
  ), today AS (
    SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS d
  ), last AS (
    SELECT c.data FROM prima.cos_cover c WHERE c.data->>'item' = item ORDER BY c.data->>'at' DESC LIMIT 1
  ), kind AS (
    SELECT CASE
             WHEN me.data->>'role' = 'pwvsb_officer' AND me.data->>'leadership' = 'deputy_cos' THEN 'dcos'
             WHEN me.data->>'role' = 'pwvsb_officer' AND me.data->>'department' = 'hr' AND coalesce(me.data->>'leadership', '') = '' THEN 'hr_admin'
           END AS k
      FROM me
  )
  SELECT coalesce((
    SELECT (kind.k = 'dcos' AND EXISTS (
              SELECT 1 FROM prima.leave_requests l, prima.users c, today
               WHERE c.data->>'role' = 'pwvsb_officer' AND c.data->>'leadership' = 'cos'
                 AND l.data->>'personId' = c.data->>'personId' AND l.data->>'status' = 'approved'
                 AND (l.data->>'from')::date <= today.d AND (l.data->>'to')::date >= today.d))
        OR EXISTS (SELECT 1 FROM last, today
                    WHERE last.data->'to' ? kind.k
                      AND (last.data->>'until' IS NULL OR (last.data->>'until')::date >= today.d))
      FROM kind WHERE kind.k IS NOT NULL), false)
$$;
REVOKE ALL ON FUNCTION prima.cos_cover_acts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.cos_cover_acts(text) TO prima_app;
-- prima.leave_requests forces row-level security on its owner too, so the module owner (who runs the function) may
-- read approved leave rows, and only those, to see whether the Chief of Staff is away today.
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS cos_cover_owner ON prima.leave_requests';
  EXECUTE format('CREATE POLICY cos_cover_owner ON prima.leave_requests FOR SELECT TO %I USING (data->>''status'' = ''approved'')', current_user);
END $$;

DO $$ BEGIN
  IF to_regclass('prima.company_run_links') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS run_links_cover_insert ON prima.company_run_links';
    EXECUTE 'DROP POLICY IF EXISTS run_links_cover_update ON prima.company_run_links';
    EXECUTE $p$CREATE POLICY run_links_cover_insert ON prima.company_run_links FOR INSERT
      WITH CHECK (prima.cos_cover_acts('office_run_by')
        AND id = ANY (prima.visible_companies())
        AND (data->>'runByCompanyId' IS NULL OR data->>'runByCompanyId' = ANY (prima.visible_companies())))$p$;
    EXECUTE $p$CREATE POLICY run_links_cover_update ON prima.company_run_links FOR UPDATE
      USING (prima.cos_cover_acts('office_run_by') AND id = ANY (prima.visible_companies()))
      WITH CHECK (prima.cos_cover_acts('office_run_by')
        AND id = ANY (prima.visible_companies())
        AND (data->>'runByCompanyId' IS NULL OR data->>'runByCompanyId' = ANY (prima.visible_companies())))$p$;
  END IF;
END $$;
COMMIT;
