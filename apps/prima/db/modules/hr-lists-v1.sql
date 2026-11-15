-- Group HR lists (Fitri package N17, 14 Nov 2026). Separate reviewed module; never run implicitly during startup. NOT
-- yet registered in db/release-manifest.json: the CEO-run migration and the combined release review add it. The HR
-- Administrator (the hr_lists wall) keys in each version of the guard course list, the medical claim clauses and the
-- discipline steps, from a date with a reason. Every signed-in person reads the version in force (it shows on records).
-- Old versions are kept: no update and no delete.
BEGIN;
CREATE TABLE prima.hr_lists (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('guard_courses', 'claim_clauses', 'discipline_steps'))
);
ALTER TABLE prima.hr_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.hr_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY hr_list_read ON prima.hr_lists FOR SELECT
  USING (coalesce(current_setting('app.user_id', true), '') <> '');
CREATE POLICY hr_list_add ON prima.hr_lists FOR INSERT
  WITH CHECK (prima.has_wall('hr_lists') AND data->>'byId' = current_setting('app.user_id', true));
GRANT SELECT, INSERT ON prima.hr_lists TO prima_app;
COMMIT;
