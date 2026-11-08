-- RBA readiness (Fauzan, 8 Nov 2026, rule RBA-READY; stacked on client-codes-v1). PROPOSED module: not in
-- db/release-manifest.json and not installed anywhere. Installing it needs the CEO's go-ahead and the reviewed release
-- path (infra/run-db-migration.sh pattern); until then the API answers these screens with "not installed in this
-- database yet". Repeat-safe; changes no existing table and moves no money.
--
-- Three tenant tables behind the same company wall as every other company record:
--   rba_trace_reviews    ACT's month trace of a worker sample (roster, clock, overtime, pay, bank); outcomes appended.
--   ethics_declarations  a person's ethics declaration, signed once on entering service (company of the signer, PWVSB for central staff).
--   rba_committees       the yearly RBA committee the Chief of Staff names (kept on PWVSB's record).
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
      CREATE POLICY company_wall ON prima.%1$I
        USING (company_id = ANY (prima.visible_companies()))
        WITH CHECK (company_id = ANY (prima.visible_companies()));
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
END $$;
-- Who sits on the yearly committee is shown to every office sign-in (names and seats only), so company heads see it.
DROP POLICY IF EXISTS committee_read ON prima.rba_committees;
CREATE POLICY committee_read ON prima.rba_committees FOR SELECT USING (true);
COMMIT;
