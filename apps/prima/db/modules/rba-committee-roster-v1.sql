-- RBA committee: names and seats only for other offices (H1, Fauzan, 11 Nov 2026; he closed PR #139 and asked for the
-- same fix here). Upstream changed rba-readiness-v1.sql itself; the office never edits an installed module (pinned
-- hashes, and an installed module is never re-run), so the fix is this separate file. Repeat-safe: the office's
-- prima-setup runs it on every start (as the schema owner, in one transaction); a second run changes nothing.
--
-- 1. rba-readiness-v1 had committee_read USING (true) on prima.rba_committees: any role with SELECT (a read-only or
--    reporting account) and any API session (a guard's included) could read the full naming: sign-in ids, member
--    companies, the Chief of Staff's note and earlier namings. That policy is dropped.
-- 2. The company wall on the three RBA tables is TO prima_app only, so a role given SELECT cannot open it by setting
--    app.company_ids in its own session; only the API's role, which Db.asUser sets up from the signed-in user, can.
-- 3. New table prima.rba_committee_rosters: this year's committee as names and seats only. Its CHECKs refuse any other
--    field, whatever writes it. Readable only by the API's role for a signed-in office user (never a guard, a site
--    device or an empty session); written only by a session that sees PWVSB's record (the Chief of Staff naming it).
-- Steps 1 and 2 run only where rba-readiness-v1 is installed; the roster table is created either way.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.rba_committee_rosters (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL
);
DO $rr$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rba_roster_id' AND conrelid = 'prima.rba_committee_rosters'::regclass) THEN
    ALTER TABLE prima.rba_committee_rosters ADD CONSTRAINT rba_roster_id CHECK (data->>'id' = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rba_roster_company' AND conrelid = 'prima.rba_committee_rosters'::regclass) THEN
    ALTER TABLE prima.rba_committee_rosters ADD CONSTRAINT rba_roster_company CHECK (data->>'companyId' = company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rba_roster_fields' AND conrelid = 'prima.rba_committee_rosters'::regclass) THEN
    ALTER TABLE prima.rba_committee_rosters ADD CONSTRAINT rba_roster_fields
      CHECK ((data - ARRAY['id','companyId','year','committeeId','at','namedBy','members']) = '{}'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rba_roster_members' AND conrelid = 'prima.rba_committee_rosters'::regclass) THEN
    ALTER TABLE prima.rba_committee_rosters ADD CONSTRAINT rba_roster_members CHECK (
      jsonb_typeof(data->'members') = 'array'
      AND NOT jsonb_path_exists(data, '$.members[*].keyvalue() ? (@.key != "name" && @.key != "seat")'));
  END IF;
  -- The full naming stays behind the company wall on PWVSB's record, and only for the API's role.
  IF to_regclass('prima.rba_committees') IS NOT NULL THEN
    DROP POLICY IF EXISTS committee_read ON prima.rba_committees;
  END IF;
  IF to_regclass('prima.rba_trace_reviews') IS NOT NULL THEN
    DROP POLICY IF EXISTS company_wall ON prima.rba_trace_reviews;
    CREATE POLICY company_wall ON prima.rba_trace_reviews TO prima_app
      USING (company_id = ANY (prima.visible_companies())) WITH CHECK (company_id = ANY (prima.visible_companies()));
  END IF;
  IF to_regclass('prima.ethics_declarations') IS NOT NULL THEN
    DROP POLICY IF EXISTS company_wall ON prima.ethics_declarations;
    CREATE POLICY company_wall ON prima.ethics_declarations TO prima_app
      USING (company_id = ANY (prima.visible_companies())) WITH CHECK (company_id = ANY (prima.visible_companies()));
  END IF;
  IF to_regclass('prima.rba_committees') IS NOT NULL THEN
    DROP POLICY IF EXISTS company_wall ON prima.rba_committees;
    CREATE POLICY company_wall ON prima.rba_committees TO prima_app
      USING (company_id = ANY (prima.visible_companies())) WITH CHECK (company_id = ANY (prima.visible_companies()));
  END IF;
END
$rr$;
ALTER TABLE prima.rba_committee_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.rba_committee_rosters FORCE ROW LEVEL SECURITY;
-- Read: the application role with a signed-in office user (not a guard, not a site device, not an empty session).
-- No other role has a policy, so a role given SELECT for reporting or inspection reads nothing.
DROP POLICY IF EXISTS roster_read ON prima.rba_committee_rosters;
CREATE POLICY roster_read ON prima.rba_committee_rosters FOR SELECT TO prima_app
  USING (coalesce(current_setting('app.user_id', true), '') <> ''
         AND coalesce(current_setting('app.user_role', true), '') NOT IN ('', 'guard', 'site_device'));
-- Write: only a session that can see PWVSB's record (the Chief of Staff naming the committee).
DROP POLICY IF EXISTS roster_add ON prima.rba_committee_rosters;
CREATE POLICY roster_add ON prima.rba_committee_rosters FOR INSERT TO prima_app
  WITH CHECK (company_id = ANY (prima.visible_companies()));
DROP POLICY IF EXISTS roster_change ON prima.rba_committee_rosters;
CREATE POLICY roster_change ON prima.rba_committee_rosters FOR UPDATE TO prima_app
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.rba_committee_rosters FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON prima.rba_committee_rosters TO prima_app;
COMMIT;
