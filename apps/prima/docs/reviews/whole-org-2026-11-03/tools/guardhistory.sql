-- Synthetic history for growth testing on the disposable prima_stress database only: 12 earlier months copied from
-- the current month with dates moved back 30 days per month and new ids. All copies are closed (no open clock-ins).
\set ON_ERROR_STOP on
SELECT current_database() = 'prima_stress' AS ok \gset
\if :ok
\else
  \quit
\endif
CREATE OR REPLACE FUNCTION pg_temp.mv(t text, k int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN t IS NULL THEN NULL ELSE ((substr(t,1,10)::date - 30*k)::text || substr(t,11)) END $$;
INSERT INTO prima.shifts (id, company_id, data)
SELECT s.id||'-h'||k, s.company_id,
  s.data || jsonb_build_object('id', s.id||'-h'||k, 'date', pg_temp.mv(s.data->>'date',k), 'start', pg_temp.mv(s.data->>'start',k), 'end', pg_temp.mv(s.data->>'end',k))
FROM prima.shifts s, generate_series(1,12) k WHERE s.id NOT LIKE '%-h%';
INSERT INTO prima.attendance (id, company_id, data)
SELECT a.id||'-h'||k, a.company_id,
  a.data || jsonb_build_object('id', a.id||'-h'||k, 'shiftId', (a.data->>'shiftId')||'-h'||k, 'clockIn', pg_temp.mv(a.data->>'clockIn',k),
    'clockOut', pg_temp.mv(coalesce(a.data->>'clockOut', a.data->>'clockIn'),k))
FROM prima.attendance a, generate_series(1,12) k WHERE a.id NOT LIKE '%-h%' AND a.data->>'clockIn' IS NOT NULL;
INSERT INTO prima.scans (id, company_id, data)
SELECT c.id||'-h'||k, c.company_id, c.data || jsonb_build_object('id', c.id||'-h'||k, 'at', pg_temp.mv(c.data->>'at',k))
FROM prima.scans c, generate_series(1,12) k WHERE c.id NOT LIKE '%-h%';
ANALYZE prima.shifts; ANALYZE prima.attendance; ANALYZE prima.scans;
