-- Asset Management extras (Fauzan, 5 Nov 2026, rule AM-EXTRAS): the contractors list, letting files for finding
-- tenants, utility meters with readings and bills, resort bookings, orchard harvests and sales, and planned maintenance.
-- Optional module, preparation only. Apply in a separately authorized migration window to the reviewed base schema.
-- Not startup SQL and not run by 001_init.sql. Repeat-safe: a second run keeps every row and only replaces this
-- module's own policies and grants. Until it is applied the API reads nothing from these tables (the screens show
-- "not set up") and refuses every save with a plain message.
-- Same wall as the other Asset Management tables: its team, group leadership and the finance staff who oversee it
-- read; the team, leadership and Finance write (the service decides who does which step); ACT reads only.
-- Catalogue check: apps/api/src/am-extras-readiness.ts amExtrasProblems.
BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['am_contractors','am_lettings','am_meters','am_bookings','am_harvests','am_pm_plans']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS prima.%1$I (
        id   text PRIMARY KEY,
        data jsonb NOT NULL,
        CONSTRAINT %1$s_id_matches CHECK (data->>'id' = id)
      );
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS dept_read ON prima.%1$I;
      DROP POLICY IF EXISTS dept_insert ON prima.%1$I;
      DROP POLICY IF EXISTS dept_update ON prima.%1$I;
      CREATE POLICY dept_read ON prima.%1$I FOR SELECT USING (prima.has_wall('asset_read'));
      CREATE POLICY dept_insert ON prima.%1$I FOR INSERT WITH CHECK (prima.has_wall('asset_write'));
      CREATE POLICY dept_update ON prima.%1$I FOR UPDATE USING (prima.has_wall('asset_write')) WITH CHECK (prima.has_wall('asset_write'));
      REVOKE ALL ON prima.%1$I FROM prima_app;
      -- No DELETE: a closed booking, a lost enquiry or a paused plan stays on record; the audit log keeps every change.
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
END $$;
ALTER TABLE prima.am_lettings DROP CONSTRAINT IF EXISTS am_lettings_id_format;
ALTER TABLE prima.am_lettings ADD CONSTRAINT am_lettings_id_format CHECK (id = 'let-' || (data->>'unitId'));
ALTER TABLE prima.am_bookings DROP CONSTRAINT IF EXISTS am_bookings_status;
ALTER TABLE prima.am_bookings ADD CONSTRAINT am_bookings_status CHECK (data->>'status' IN ('held','confirmed','checked_in','checked_out','cancelled','no_show'));
ALTER TABLE prima.am_contractors DROP CONSTRAINT IF EXISTS am_contractors_status;
ALTER TABLE prima.am_contractors ADD CONSTRAINT am_contractors_status CHECK (data->>'status' IN ('pending','active','suspended','blacklisted'));
COMMIT;
