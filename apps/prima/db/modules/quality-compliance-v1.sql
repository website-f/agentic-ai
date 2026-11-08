-- PROPOSED, NOT APPLIED. Quality and compliance (Fauzan, 5 Nov 2026): one requirements and evidence register for
-- ISO 9001:2015 and the SIRIM/PIKM code, and the role competency matrix.
--   qms_requirements, qms_foundation, comp_profiles: group-wide reference lists (no company), readable by every signed-in app user so
--     a company manager sees the same requirement list and role profiles; who may change them is checked in the
--     service (ACT for requirements, HR proposes and the HR Director approves role profiles).
--   qms_items (quality objectives, controlled document versions, management review records): group-wide list too,
--     changes checked in the service (ACT or the Chief of Staff keep; a second person or the CEO decides).
--   qms_nonconformities (service faults): per company.
--   qms_entries, comp_assessments: per company, behind the same company wall as every company table in 001_init.sql.
-- Install only by an explicit, reviewed, CEO-run migration; the app shows "not switched on" until then.
-- No delete grant: entries are corrected by a newer entry, never removed.
BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('prima.companies') IS NULL THEN RAISE EXCEPTION 'Base schema 001_init required'; END IF;
  FOREACH t IN ARRAY ARRAY['qms_requirements','qms_foundation','comp_profiles','qms_items']
  LOOP
    EXECUTE format($f$
      CREATE TABLE prima.%1$I (
        id   text PRIMARY KEY,
        data jsonb NOT NULL,
        CHECK (data->>'id' = id)
      );
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      CREATE POLICY group_list ON prima.%1$I USING (true) WITH CHECK (true);
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['qms_entries','comp_assessments','qms_nonconformities']
  LOOP
    EXECUTE format($f$
      CREATE TABLE prima.%1$I (
        id         text PRIMARY KEY,
        company_id text NOT NULL,
        data       jsonb NOT NULL,
        CHECK (data->>'id' = id),
        CHECK (data->>'companyId' = company_id)
      );
      CREATE INDEX %1$s_company_idx ON prima.%1$I (company_id);
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      CREATE POLICY company_wall ON prima.%1$I
        USING (company_id = ANY (prima.visible_companies()))
        WITH CHECK (company_id = ANY (prima.visible_companies()));
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
END $$;
COMMIT;
