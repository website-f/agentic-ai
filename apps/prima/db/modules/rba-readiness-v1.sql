-- RBA readiness (Fauzan, 8 Nov 2026, rule RBA-READY; stacked on client-codes-v1). PROPOSED module: not in
-- db/release-manifest.json and not installed anywhere. Installing it needs the CEO's go-ahead and the reviewed release
-- path (infra/run-db-migration.sh pattern); until then the API answers these screens with "not installed in this
-- database yet". Repeat-safe; changes no existing table and moves no money.
--
-- Three tenant tables behind the same company wall as every other company record:
--   rba_trace_reviews    ACT's month trace of a worker sample (roster, clock, overtime, pay, bank); outcomes appended.
--   ethics_declarations  a person's ethics declaration, signed once on entering service (company of the signer, PWVSB for central staff).
--   rba_committees       the yearly RBA committee the Chief of Staff names (kept on PWVSB's record).
-- and one narrow table that every office sign-in may read (Fauzan, 11 Nov 2026):
--   rba_committee_rosters  this year's committee as names and seats only, copied from the naming.
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rba_trace_reviews','ethics_declarations','rba_committees']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS prima.%1$I (
        id         text PRIMARY KEY,
        company_id text NOT NULL,
        data       jsonb NOT NULL,
        CHECK (data->>'id' = id),
        CHECK (data->>'companyId' = company_id)
      );
      CREATE INDEX IF NOT EXISTS %1$s_company_idx ON prima.%1$I (company_id);
      CREATE INDEX IF NOT EXISTS %1$s_data_idx ON prima.%1$I USING gin (data jsonb_path_ops);
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS company_wall ON prima.%1$I;
      -- TO prima_app (Fauzan, 11 Nov 2026): a role given SELECT for reporting cannot open the wall by setting
      -- app.company_ids in its own session; only the API's role, which Db.asUser sets up from the signed-in user, can.
      CREATE POLICY company_wall ON prima.%1$I TO prima_app
        USING (company_id = ANY (prima.visible_companies()))
        WITH CHECK (company_id = ANY (prima.visible_companies()));
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
END $$;
-- The full committee naming (sign-in ids, member companies, the Chief of Staff's note, earlier namings) stays behind the
-- company wall on PWVSB's record. An earlier draft of this module opened it to every role with SELECT (committee_read
-- USING (true)); that policy is removed (Fauzan, 11 Nov 2026).
DROP POLICY IF EXISTS committee_read ON prima.rba_committees;
-- Who sits on the committee is shown to every office sign-in through a separate roster holding names and seats only.
-- The CHECKs keep anything else out of it, whatever the application writes.
CREATE TABLE IF NOT EXISTS prima.rba_committee_rosters (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CONSTRAINT rba_roster_fields CHECK ((data - ARRAY['id','companyId','year','committeeId','at','namedBy','members']) = '{}'::jsonb),
  CONSTRAINT rba_roster_members CHECK (
    jsonb_typeof(data->'members') = 'array'
    AND NOT jsonb_path_exists(data, '$.members[*].keyvalue() ? (@.key != "name" && @.key != "seat")'))
);
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
