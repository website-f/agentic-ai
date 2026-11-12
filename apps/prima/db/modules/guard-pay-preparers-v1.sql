-- Guard pay preparers (P100 B1, Fauzan 11 Nov 2026: "each Company Manager monitors the pay run and delegates the preparing
-- to whoever they choose in their company"). One new table, nothing else changed. Repeat-safe: the office's prima-setup
-- runs this file on every start (as the schema owner, in one transaction); a second run changes nothing.
--
-- Each row says one staff sign-in prepares one company's monthly guard pay run, who named them, when and why, and any
-- removal. Only that company's Company Manager (or General Manager) writes a row; the row can never be deleted. It is read
-- by the company's managers, the named person, central HR and group leadership (the CEO, the COO, the directors), who all
-- see the guard pay run. A colleague, an OM or another company's manager never reads it, even through a fault in the app.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.guard_pay_preparers (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL
);
DO $gpp$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gpp_id' AND conrelid = 'prima.guard_pay_preparers'::regclass) THEN
    ALTER TABLE prima.guard_pay_preparers ADD CONSTRAINT gpp_id CHECK (data->>'id' = id AND id = 'gpp-' || company_id || '-' || (data->>'userId'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gpp_company' AND conrelid = 'prima.guard_pay_preparers'::regclass) THEN
    ALTER TABLE prima.guard_pay_preparers ADD CONSTRAINT gpp_company CHECK (data->>'companyId' = company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gpp_shape' AND conrelid = 'prima.guard_pay_preparers'::regclass) THEN
    -- A naming always carries who named and a reason; a removal too.
    ALTER TABLE prima.guard_pay_preparers ADD CONSTRAINT gpp_shape CHECK (
      length(coalesce(data->>'userId', '')) > 0
      AND jsonb_typeof(data->'active') = 'boolean'
      AND length(coalesce(data->'named'->>'byId', '')) > 0
      AND length(coalesce(data->'named'->>'reason', '')) >= 5
      AND (data->>'active' = 'true' OR length(coalesce(data->'removed'->>'reason', '')) >= 5)
      AND data->'named'->>'byId' <> data->>'userId'
    );
  END IF;
END
$gpp$;
CREATE INDEX IF NOT EXISTS guard_pay_preparers_company_idx ON prima.guard_pay_preparers (company_id);
CREATE INDEX IF NOT EXISTS guard_pay_preparers_user_idx ON prima.guard_pay_preparers ((data->>'userId'));
ALTER TABLE prima.guard_pay_preparers ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.guard_pay_preparers FORCE ROW LEVEL SECURITY;

-- Whether a sign-in is the Company Manager (or General Manager) of a company, read from the staff records (never from the
-- request). Only they name or remove the company's preparers.
CREATE OR REPLACE FUNCTION prima.gpp_namer(uid text, company text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(bool_or(
    coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
    AND u.data->>'role' = 'company_manager'
    AND company IS NOT NULL AND coalesce(u.data->'companyIds', '[]'::jsonb) ? company
  ), false)
  FROM prima.users u WHERE u.id = uid
$$;
-- Whether a sign-in reads a company's preparer list: its managers, central HR and group leadership.
CREATE OR REPLACE FUNCTION prima.gpp_reader(uid text, company text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT prima.gpp_namer(uid, company) OR coalesce(bool_or(
    coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
    AND (
      u.data->>'role' = 'director'
      OR (u.data->>'role' = 'pwvsb_officer' AND (
            u.data->>'opsTier' IN ('ceo', 'coo')
            OR coalesce(u.data->>'leadership', '') <> ''
            OR u.data->>'department' = 'hr'))
    )
  ), false)
  FROM prima.users u WHERE u.id = uid
$$;
REVOKE ALL ON FUNCTION prima.gpp_namer(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION prima.gpp_reader(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.gpp_namer(text, text) TO prima_app;
GRANT EXECUTE ON FUNCTION prima.gpp_reader(text, text) TO prima_app;

REVOKE ALL ON prima.guard_pay_preparers FROM PUBLIC;
REVOKE ALL ON prima.guard_pay_preparers FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.guard_pay_preparers TO prima_app;
DROP POLICY IF EXISTS gpp_read ON prima.guard_pay_preparers;
CREATE POLICY gpp_read ON prima.guard_pay_preparers FOR SELECT TO prima_app
  USING (data->>'userId' = current_setting('app.user_id', true)
         OR prima.gpp_reader(current_setting('app.user_id', true), company_id));
DROP POLICY IF EXISTS gpp_insert ON prima.guard_pay_preparers;
CREATE POLICY gpp_insert ON prima.guard_pay_preparers FOR INSERT TO prima_app
  WITH CHECK (prima.gpp_namer(current_setting('app.user_id', true), company_id)
              AND data->'named'->>'byId' = current_setting('app.user_id', true));
DROP POLICY IF EXISTS gpp_update ON prima.guard_pay_preparers;
CREATE POLICY gpp_update ON prima.guard_pay_preparers FOR UPDATE TO prima_app
  USING (prima.gpp_namer(current_setting('app.user_id', true), company_id))
  WITH CHECK (prima.gpp_namer(current_setting('app.user_id', true), company_id)
              AND (data->'named'->>'byId' = current_setting('app.user_id', true)
                   OR data->'removed'->>'byId' = current_setting('app.user_id', true)));
COMMIT;
