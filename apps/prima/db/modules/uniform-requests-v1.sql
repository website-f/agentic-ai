-- Uniform requests from Operations Managers (Fauzan, 11 Nov 2026: "Create button from om to need uniform").
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json:
-- the CEO-run migration and the release review add it. No provider, pay or billing change: the store still issues
-- through the existing stock_issues handover, and Goodwill bills only after the guard acknowledges the item.
BEGIN;
CREATE TABLE prima.stock_requests (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id)
);
CREATE INDEX stock_requests_company_idx ON prima.stock_requests (company_id);
ALTER TABLE prima.stock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.stock_requests FORCE ROW LEVEL SECURITY;
-- Same wall as stock_issues: rows of the store's company (Goodwill), visible to whoever may see that company's store.
CREATE POLICY company_wall ON prima.stock_requests
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
GRANT SELECT, INSERT, UPDATE ON prima.stock_requests TO prima_app;
COMMIT;
