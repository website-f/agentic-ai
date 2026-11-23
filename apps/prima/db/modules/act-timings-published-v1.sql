-- ACT workflow step timings, published read-only (ACT Director gap B3; Fauzan, 23 Nov 2026: "Do the gap").
-- The ACT Director sets how long each workflow step may take (rows of prima.act_audits with data->>'kind' = 'timing',
-- Fauzan 2 Nov 2026). Those rows sit behind the 'act' wall, so before this module a session outside ACT and group
-- leadership read no timings at all and other screens could not time work against them (PrimaService
-- workStandardHours returned {}). This function returns only the timing rows, and of each only the id, area, date and
-- the timing itself: never investigations, workflow audits, report reviews, field checks, notes or who set it. Any
-- signed-in session may call it; nothing is written. Repeat-safe. Run only with infra/run-db-migration.sh, staging
-- first, with the CEO's go-ahead.
BEGIN;
CREATE OR REPLACE FUNCTION prima.act_work_timings() RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = prima, pg_temp AS $$
  SELECT jsonb_build_object(
           'id', id,
           'kind', 'timing',
           'area', data->'area',
           'doneOn', data->'doneOn',
           'timing', jsonb_build_object(
             'auditMonths', data->'timing'->'auditMonths',
             'segments', coalesce((SELECT jsonb_agg(jsonb_build_object('step', s->'step', 'target', s->'target', 'unit', s->'unit', 'key', s->'key'))
                                     FROM jsonb_array_elements(coalesce(data->'timing'->'segments', '[]'::jsonb)) s), '[]'::jsonb)))
    FROM prima.act_audits
   WHERE nullif(current_setting('app.user_id', true), '') IS NOT NULL
     AND data->>'kind' = 'timing'
     AND jsonb_typeof(data->'timing') = 'object'
$$;
-- prima.act_audits forces row-level security on its owner too, so the module owner (who runs the function) may read
-- the timing rows, and only those.
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS act_timings_owner ON prima.act_audits';
  EXECUTE format('CREATE POLICY act_timings_owner ON prima.act_audits FOR SELECT TO %I USING (data->>''kind'' = ''timing'')', current_user);
END $$;
REVOKE ALL ON FUNCTION prima.act_work_timings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.act_work_timings() TO prima_app;
COMMIT;
