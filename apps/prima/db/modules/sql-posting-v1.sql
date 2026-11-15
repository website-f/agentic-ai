-- SQL Account posting link, Build 1 (Fauzan, 13 Nov 2026, rule FIN-SQLPOST). PROPOSED module: not in
-- db/release-manifest.json and not installed anywhere. Installing it needs the CEO's go-ahead and the reviewed release
-- path (infra/run-db-migration.sh pattern); until then Prima makes no posting jobs and the screen says
-- "not installed in this database yet". Repeat-safe; changes no existing table; never moves money and never
-- connects to SQL Account (the sender is off unless SQL_POSTING_ENABLED=true and an adapter is installed).
--
-- Two tenant tables behind the same company wall as fin_status (a company's Finance team, the Finance Director and
-- the CEO; the service narrows further by team):
--   sql_postings            one row per document Prima posts (or will post) into one company's own SQL Account book.
--                           Written in the same transaction that finishes the Prima record. One row per key.
--   sql_posting_exceptions  the daily check's list: explained by Finance, checked by someone else. Never deleted.
-- No DELETE grant: nobody removes a posting job or an exception, by hand or by the application.
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sql_postings','sql_posting_exceptions']
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
      REVOKE ALL ON prima.%1$I FROM prima_app;
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
END $$;
-- One document per company, book, type, source and revision; one open exception per key.
CREATE UNIQUE INDEX IF NOT EXISTS sql_postings_key_unique ON prima.sql_postings ((data->>'key'));
CREATE UNIQUE INDEX IF NOT EXISTS sql_posting_exceptions_key_unique ON prima.sql_posting_exceptions ((data->>'key'));
-- The key names the row's own company (a job can never point at another company's book).
ALTER TABLE prima.sql_postings DROP CONSTRAINT IF EXISTS sql_postings_key_company;
ALTER TABLE prima.sql_postings ADD CONSTRAINT sql_postings_key_company CHECK (split_part(data->>'key', '|', 1) = company_id);
ALTER TABLE prima.sql_postings DROP CONSTRAINT IF EXISTS sql_postings_status;
ALTER TABLE prima.sql_postings ADD CONSTRAINT sql_postings_status CHECK (data->>'status' IN ('not_ready','ready','sending','posted','rejected','retryable_error','outcome_unknown','manual_review','checked_ok','check_failed'));
ALTER TABLE prima.sql_postings DROP CONSTRAINT IF EXISTS sql_postings_doc_type;
ALTER TABLE prima.sql_postings ADD CONSTRAINT sql_postings_doc_type CHECK (data->>'docType' IN ('GL_PV','AR_PM','AP_PI'));
COMMIT;
