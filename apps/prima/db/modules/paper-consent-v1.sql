-- Paper PDPA consent gate for face and location (Fitri package N18, 14 Nov 2026). Separate reviewed module; never run
-- implicitly during startup. NOT yet registered in db/release-manifest.json: the CEO-run migration and the combined
-- release review add it. Needs pdpa-register-v1 first (the paper consent itself is a row in prima.pdpa_consents, behind
-- the PDPA wall). This table holds only one on/off line per person and scope (no name, no paper reference) so the
-- sign-in check works for the person under the database walls, plus one 'switch' row. Nothing is deleted.
BEGIN;
CREATE TABLE prima.consent_gates (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (id = 'switch' OR data->>'scope' IN ('face', 'location'))
);
ALTER TABLE prima.consent_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.consent_gates FORCE ROW LEVEL SECURITY;
-- Everyone signed in reads the switch; a person's own company (and group users, and the PDPA wall) reads its gate lines.
CREATE POLICY consent_gate_read ON prima.consent_gates FOR SELECT
  USING (id = 'switch' AND coalesce(current_setting('app.user_id', true), '') <> ''
         OR prima.has_wall('pdpa')
         OR current_setting('app.group_user', true) = 'on'
         OR data->>'companyId' = ANY (prima.visible_companies()));
-- Only the PDPA wall writes (the service lets only the PDPA officer record, and the officer or the Chief of Staff
-- switch the gate).
CREATE POLICY consent_gate_add ON prima.consent_gates FOR INSERT WITH CHECK (prima.has_wall('pdpa'));
CREATE POLICY consent_gate_change ON prima.consent_gates FOR UPDATE USING (prima.has_wall('pdpa')) WITH CHECK (prima.has_wall('pdpa'));
GRANT SELECT, INSERT, UPDATE ON prima.consent_gates TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.consent_gates FROM prima_app;
COMMIT;
