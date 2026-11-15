-- Equipment warranty claims (Fitri package A8, Fauzan 11 Nov 2026). Separate reviewed module; never run implicitly
-- during startup. NOT yet registered in db/release-manifest.json: the CEO-run migration and the combined release review
-- add it. A fault is reported with photo proof, the store or asset owner checks the warranty dates, the claim goes to the
-- supplier and the outcome is recorded. No provider change; nothing is sent to a supplier by Prima.
BEGIN;
CREATE TABLE prima.warranty_claims (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id)
);
ALTER TABLE prima.warranty_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.warranty_claims FORCE ROW LEVEL SECURITY;
-- The owner company's rows, central (IT, store) staff as group users, and the reporter's own claims.
CREATE POLICY warranty_claim_wall ON prima.warranty_claims
  USING (company_id = ANY (prima.visible_companies())
         OR current_setting('app.group_user', true) = 'on'
         OR data->>'reportedById' = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON prima.warranty_claims TO prima_app;
COMMIT;
