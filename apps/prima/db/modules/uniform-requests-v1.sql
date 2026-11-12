-- Uniform requests from Operations Managers (I1, Fauzan, 11 Nov 2026: "Create button from om to need uniform").
-- Built and tested, but NOT on the release list until the CEO says so: it is not in db/release-manifest.json and not in
-- the office prima-setup's OFFICE_MODULES, so no start runs it. Until it is installed the screens say "Uniform requests
-- are not installed in this database yet". Repeat-safe (CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS), so once the
-- CEO approves it can join OFFICE_MODULES unchanged. No provider, pay or billing change: the store still issues through
-- the existing stock_issues handover, and Goodwill bills only after the guard acknowledges the item.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.stock_requests (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL
);
DO $ur$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ur_id' AND conrelid = 'prima.stock_requests'::regclass) THEN
    ALTER TABLE prima.stock_requests ADD CONSTRAINT ur_id CHECK (data->>'id' = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ur_company' AND conrelid = 'prima.stock_requests'::regclass) THEN
    ALTER TABLE prima.stock_requests ADD CONSTRAINT ur_company CHECK (data->>'companyId' = company_id);
  END IF;
  -- 1 to 3 pieces a request; a known status; a paid piece always carries its receipt and amount (never from pay).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ur_shape' AND conrelid = 'prima.stock_requests'::regclass) THEN
    ALTER TABLE prima.stock_requests ADD CONSTRAINT ur_shape CHECK (
      (data->>'qty') ~ '^[1-3]$'
      AND data->>'status' IN ('open', 'issued', 'refused', 'cancelled')
      AND (jsonb_typeof(data->'guardPays') IS DISTINCT FROM 'object'
           OR (length(coalesce(data->'guardPays'->>'receiptNo', '')) > 0 AND (data->'guardPays'->>'amount')::numeric > 0)));
  END IF;
END
$ur$;
CREATE INDEX IF NOT EXISTS stock_requests_company_idx ON prima.stock_requests (company_id);
ALTER TABLE prima.stock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.stock_requests FORCE ROW LEVEL SECURITY;
-- Same wall as stock_issues: rows of the store's company (Goodwill), visible to whoever may see that company's store;
-- for the API's role only, so a role given SELECT cannot open it by setting app.company_ids itself.
DROP POLICY IF EXISTS company_wall ON prima.stock_requests;
CREATE POLICY company_wall ON prima.stock_requests TO prima_app
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.stock_requests FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON prima.stock_requests TO prima_app;
COMMIT;
