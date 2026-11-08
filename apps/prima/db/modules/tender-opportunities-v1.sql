-- Tender and quotation opportunities (Fauzan, 4 Nov 2026): what the Director Office or a company found, and which
-- companies enter each. A group list like prima.tender_groups: it holds no prices or files, and each company's bid
-- stays behind its own wall in prima.tenders and prima.evidence_docs. The service shows a company only its own entries.
-- NOT in the release manifest yet: install only through the reviewed release path with the owner's approval.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.tender_opportunities (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.tender_opportunities TO prima_app;
-- Buyer and portal sites the Director Office checks for tenders, and what each check found. Prima never visits them.
CREATE TABLE IF NOT EXISTS prima.tender_sources (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.tender_sources TO prima_app;
COMMIT;
