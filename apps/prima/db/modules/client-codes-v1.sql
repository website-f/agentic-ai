-- Client requirements, client inspections and the yearly self-audit (Fauzan, 6 Nov 2026, after the IKEA IWAY audit,
-- rule CLIENT-CODE). PROPOSED module: not in db/release-manifest.json and not installed anywhere. Installing it needs
-- the CEO's go-ahead and the reviewed release path (infra/run-db-migration.sh pattern); until then the API answers
-- these screens with "not installed in this database yet". Repeat-safe; changes no existing table and moves no money.
--
-- Four tenant tables behind the same company wall as every other company record:
--   client_codes        a client's code of conduct for one site (IWAY or custom), kept by the covering OM or ACT.
--   client_code_checks  one check of one requirement (met / not met / n/a) with proof or a note; never edited.
--   client_inspections  a site or hostel inspection against the client's form, with room sizes; fixes appended.
--   self_audits         the company's yearly self-audit (company office, one site, or everything); fixes appended.
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_codes','client_code_checks','client_inspections','self_audits']
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
COMMIT;
