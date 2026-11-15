-- Office staff overtime claims (Fitri package A9, Fauzan 11 Nov 2026; rule HR-OT). Separate reviewed module; never run
-- implicitly during startup. NOT yet registered in db/release-manifest.json: the CEO-run migration and the combined
-- release review add it. Requires time-slip-v1 (the same approvers and setting). Staff claim hours already worked; the head who approves their time slips approves it; the staff
-- payroll run pays approved hours only while HR has overtime switched on for that person. No provider change.
BEGIN;
CREATE TABLE prima.staff_ot_claims (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL,
  CHECK (data->>'id' = id)
);
ALTER TABLE prima.staff_ot_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.staff_ot_claims FORCE ROW LEVEL SECURITY;
-- Same wall as time slips: the company's own rows, central staff rows for group users, and one's own claims.
CREATE POLICY staff_ot_claim_wall ON prima.staff_ot_claims
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON prima.staff_ot_claims TO prima_app;
COMMIT;
