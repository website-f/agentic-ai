-- Staff overtime lines for the staff payroll (P100 C12 + J3, Fauzan 11 Nov 2026: staff overtime inside the staff payroll
-- run with an on/off switch HR controls, CMS control-room overtime from the CMS roster included). One new table, nothing
-- else changed. Repeat-safe: the office's prima-setup runs this file on every start (as the schema owner, in one
-- transaction); a second run changes nothing.
--
-- Each row is one day's overtime hours for one office staff member: claimed by the person, or brought in by HR from a
-- completed CMS seat. HR approves or refuses it with a reason; nobody decides their own. The row is readable by the person
-- it belongs to and by HR and group leadership (who see payroll); written by the person (their own claim, pending only)
-- and by HR. The company wall applies too. A CMS seat gives at most one row (its id is the seat's). Never deleted.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.staff_ot_lines (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL
);
DO $sot$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sot_id' AND conrelid = 'prima.staff_ot_lines'::regclass) THEN
    ALTER TABLE prima.staff_ot_lines ADD CONSTRAINT sot_id CHECK (data->>'id' = id AND data->>'companyId' = company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sot_shape' AND conrelid = 'prima.staff_ot_lines'::regclass) THEN
    ALTER TABLE prima.staff_ot_lines ADD CONSTRAINT sot_shape CHECK (
      data->>'status' IN ('pending', 'approved', 'refused')
      AND data->>'kind' IN ('normal', 'restDay', 'publicHoliday')
      AND data->>'source' IN ('claim', 'cms')
      AND (data->>'hours')::numeric > 0 AND (data->>'hours')::numeric <= 24
      AND (data->>'source' <> 'cms' OR id = 'ot-cms-' || (data->>'cmsShiftId'))
      AND (data->>'status' = 'pending' OR (length(coalesce(data->'decided'->>'note', '')) >= 3
           AND data->'decided'->>'byId' <> coalesce(data->>'userId', '')
           AND data->'decided'->>'byId' <> coalesce(data->'raised'->>'byId', '')))
    );
  END IF;
END
$sot$;
CREATE INDEX IF NOT EXISTS staff_ot_lines_company_idx ON prima.staff_ot_lines (company_id);
CREATE INDEX IF NOT EXISTS staff_ot_lines_person_idx ON prima.staff_ot_lines ((data->>'personId'));
ALTER TABLE prima.staff_ot_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.staff_ot_lines FORCE ROW LEVEL SECURITY;

-- Whether a sign-in keeps HR (central HR, the HR Director) or leads the group, read from the staff records.
CREATE OR REPLACE FUNCTION prima.sot_hr(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT coalesce(bool_or(
    coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
    AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
    AND (u.data->>'role' = 'director'
         OR (u.data->>'role' = 'pwvsb_officer' AND (u.data->>'department' = 'hr' OR coalesce(u.data->>'leadership', '') <> '' OR u.data->>'opsTier' IN ('ceo', 'coo'))))
  ), false)
  FROM prima.users u WHERE u.id = uid
$$;
REVOKE ALL ON FUNCTION prima.sot_hr(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.sot_hr(text) TO prima_app;

REVOKE ALL ON prima.staff_ot_lines FROM PUBLIC;
REVOKE ALL ON prima.staff_ot_lines FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.staff_ot_lines TO prima_app;
DROP POLICY IF EXISTS sot_read ON prima.staff_ot_lines;
CREATE POLICY sot_read ON prima.staff_ot_lines FOR SELECT TO prima_app
  USING (data->>'userId' = current_setting('app.user_id', true) OR prima.sot_hr(current_setting('app.user_id', true)));
DROP POLICY IF EXISTS sot_insert ON prima.staff_ot_lines;
CREATE POLICY sot_insert ON prima.staff_ot_lines FOR INSERT TO prima_app
  WITH CHECK (data->>'status' = 'pending'
              AND data->'raised'->>'byId' = current_setting('app.user_id', true)
              AND (data->>'userId' = current_setting('app.user_id', true) OR prima.sot_hr(current_setting('app.user_id', true))));
DROP POLICY IF EXISTS sot_update ON prima.staff_ot_lines;
CREATE POLICY sot_update ON prima.staff_ot_lines FOR UPDATE TO prima_app
  USING (prima.sot_hr(current_setting('app.user_id', true)))
  WITH CHECK (prima.sot_hr(current_setting('app.user_id', true)));
COMMIT;
