-- J2 Equipment warranty claims (Fauzan, 11 Nov 2026: "Tell Fitri to build"; handover A8 / J2). Separate reviewed
-- module; never run implicitly during startup. Needs the item register module (item-register-v1.sql) first: it uses
-- that module's prima.item_parties() wall so a claim is seen by the companies that see the item's owner.
-- NOT registered in db/release-manifest.json and not in the office prima-setup list: installing it on the live database
-- needs the CEO-run migration (approved to build, not yet approved to install).
-- A claim to the supplier for an item of the register: raised with the warranty card, approved by the company manager,
-- sent, repaired / replaced / refused by the supplier with their report, and closed. No delete grant.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.item_warranty_claims (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'companyId' = company_id),
  CHECK (data->>'status' IN ('raised', 'approved', 'refused', 'sent', 'outcome', 'closed'))
);
CREATE INDEX IF NOT EXISTS item_warranty_claims_company_idx ON prima.item_warranty_claims (company_id);
CREATE INDEX IF NOT EXISTS item_warranty_claims_data_idx ON prima.item_warranty_claims USING gin (data jsonb_path_ops);
ALTER TABLE prima.item_warranty_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.item_warranty_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_warranty_wall ON prima.item_warranty_claims;
CREATE POLICY item_warranty_wall ON prima.item_warranty_claims
  USING (company_id = ANY (prima.item_parties()) AND company_id <> '*')
  WITH CHECK (company_id = ANY (prima.item_parties()) AND company_id <> '*');
REVOKE ALL ON prima.item_warranty_claims FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.item_warranty_claims TO prima_app;
COMMIT;
