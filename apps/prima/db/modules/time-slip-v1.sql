-- Time slip (Fauzan, 4 Nov 2026, rule HR-TIME-SLIP). Separate reviewed module; never run implicitly during startup.
-- NOT yet registered in db/release-manifest.json: the CEO-run migration and the combined release review add it.
-- Staff ask to leave the office for a few hours; the company or department head approves (HR may set HR instead);
-- HR is told; the hours are worked back within 30 days or taken from annual leave. No pay or provider change.
BEGIN;
CREATE TABLE prima.time_slips (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.time_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.time_slips FORCE ROW LEVEL SECURITY;
-- Same wall as working from home: the company's own rows, central staff rows for group users, and one's own slips.
CREATE POLICY time_slip_wall ON prima.time_slips
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
-- One setting row (who approves). Everyone reads it to route their own slip; only group users write it, and the
-- service allows only HR (HR administrator, Chief of Staff or Deputy) to change it.
CREATE TABLE prima.time_slip_settings (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.time_slip_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.time_slip_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY time_slip_settings_read ON prima.time_slip_settings FOR SELECT USING (true);
CREATE POLICY time_slip_settings_insert ON prima.time_slip_settings FOR INSERT
  WITH CHECK (current_setting('app.group_user', true) = 'on');
CREATE POLICY time_slip_settings_update ON prima.time_slip_settings FOR UPDATE
  USING (current_setting('app.group_user', true) = 'on')
  WITH CHECK (current_setting('app.group_user', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON prima.time_slips, prima.time_slip_settings TO prima_app;
COMMIT;
