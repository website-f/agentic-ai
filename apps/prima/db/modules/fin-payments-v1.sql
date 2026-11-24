-- Finance payments in their own table (Finance study gap B3, Fauzan 23 Nov 2026: "We doing all now").
-- Separate reviewed module; never run implicitly during startup. NOT on db/release-manifest.json: Fitri runs it with
-- infra/run-db-migration.sh, staging first, and only with Fauzan's go-ahead. Run it while nobody is paying (it moves
-- every company's payments once).
--
-- Before this module every company's payments sit inside its one Finance status row (prima.fin_status,
-- data->'payments'), so the row grows with every payment and every step rewrites it. After it, each payment is one row
-- here, under the same company wall, and the API reads and writes them through packages/core/src/finance-payment-rows.ts
-- (applied only when this table exists). A payment is never deleted: one left out of a save is marked removed.
--
-- Repeat-safe: a second run keeps every row, copies only payments not yet here, and replaces only this module's policy
-- and grants. Rollback: stop the API, copy data->'payment' back into fin_status in seq order, then drop this table.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.fin_payments (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL,
  CONSTRAINT fin_payments_id_matches CHECK (data->>'id' = id),
  CONSTRAINT fin_payments_company_matches CHECK (data->>'companyId' = company_id),
  -- The row id is the company and the payment's own id, so a payment can never move to another company's row.
  CONSTRAINT fin_payments_id_is_company_payment CHECK (id = company_id || ':' || (data#>>'{payment,id}')),
  CONSTRAINT fin_payments_seq_shape CHECK (jsonb_typeof(data->'seq') = 'number' AND (data->>'seq')::numeric >= 0),
  CONSTRAINT fin_payments_amount_positive CHECK ((data#>>'{payment,amount}')::numeric > 0)
);
CREATE INDEX IF NOT EXISTS fin_payments_company_idx ON prima.fin_payments (company_id);
CREATE INDEX IF NOT EXISTS fin_payments_data_idx ON prima.fin_payments USING gin (data jsonb_path_ops);
ALTER TABLE prima.fin_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.fin_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_wall ON prima.fin_payments;
CREATE POLICY company_wall ON prima.fin_payments
  USING (company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id = ANY (prima.visible_companies()));
REVOKE ALL ON prima.fin_payments FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.fin_payments TO prima_app;
-- No DELETE: a payment is cancelled or returned with a reason, never removed; the audit log keeps every step.

-- Copy each company's payments out of its Finance status row, in their order, then empty the array there.
INSERT INTO prima.fin_payments (id, company_id, data)
SELECT f.company_id || ':' || (p.value->>'id'), f.company_id,
       jsonb_build_object('id', f.company_id || ':' || (p.value->>'id'), 'companyId', f.company_id, 'seq', p.ord - 1, 'payment', p.value)
  FROM prima.fin_status f
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.data->'payments', '[]'::jsonb)) WITH ORDINALITY AS p(value, ord)
 WHERE jsonb_typeof(f.data->'payments') = 'array'
ON CONFLICT (id) DO NOTHING;
UPDATE prima.fin_status SET data = jsonb_set(data, '{payments}', '[]'::jsonb)
 WHERE jsonb_typeof(data->'payments') = 'array' AND jsonb_array_length(data->'payments') > 0;
COMMIT;
