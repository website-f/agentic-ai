-- Company paper library for tenders (Fauzan, 22-23 Nov 2026: Marketing tender desk item AH7, "Build" on 23 Nov 2026).
-- Separate reviewed module; never run implicitly during startup. NOT on db/release-manifest.json: Fitri runs it with
-- infra/run-db-migration.sh, staging first, only with Fauzan's go-ahead. It needs only the base schema.
--
-- One row per paper a company keeps for bids (SSM forms and search, company profile, bank statements by month,
-- audited accounts by year, bank letter, EPF/SOCSO/SST registration, PPKKM membership, experience letters, organisation
-- chart). The files stay in prima.evidence_docs behind the same company wall. Licences stay in prima.licences.
-- Nothing is deleted: a newer copy marks the older one replaced. No identity-card copies are kept here.
BEGIN;
CREATE TABLE prima.company_papers (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'kind' IN ('SSM_FORMS','SSM_PROFILE','COMPANY_PROFILE','BANK_STATEMENT','AUDITED_ACCOUNTS','BANK_LETTER',
                           'EPF_REGISTRATION','SOCSO_REGISTRATION','SST_REGISTRATION','PPKKM_MEMBERSHIP','EXPERIENCE_LETTER',
                           'ORG_CHART','OTHER')),
  CHECK (jsonb_typeof(data->'docIds') = 'array' AND jsonb_array_length(data->'docIds') >= 1)
);
CREATE INDEX company_papers_company_idx ON prima.company_papers (company_id);
ALTER TABLE prima.company_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.company_papers FORCE ROW LEVEL SECURITY;
CREATE POLICY company_wall ON prima.company_papers
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
-- No DELETE: a paper is replaced, never removed.
GRANT SELECT, INSERT, UPDATE ON prima.company_papers TO prima_app;

-- Only the replaced mark may change once a paper is saved.
CREATE OR REPLACE FUNCTION prima.company_paper_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog, prima AS $$
BEGIN
  IF (NEW.data - 'replacedBy') IS DISTINCT FROM (OLD.data - 'replacedBy')
     OR (coalesce(OLD.data->>'replacedBy','') <> '' AND NEW.data->>'replacedBy' IS DISTINCT FROM OLD.data->>'replacedBy') THEN
    RAISE EXCEPTION 'A saved company paper is not changed; add a newer copy' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_paper_guard BEFORE UPDATE ON prima.company_papers FOR EACH ROW EXECUTE FUNCTION prima.company_paper_guard();
COMMIT;
