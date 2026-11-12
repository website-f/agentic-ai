-- Each person's alert choices (J6, Fauzan 11 Nov 2026: "Staff choose their alerts: BUILD"; today everyone gets urgent
-- alerts plus a daily digest). One new table; nothing else changed. Separate reviewed module: NOT registered in
-- db/release-manifest.json and not run by the office prima-setup; installed only by the CEO-run migration. Repeat-safe.
-- Until it is installed everyone keeps today's alerts (urgent and digest), and the choices screen says it is not
-- installed. A row is the person's own: only they read or write it (the alert runner reads it in their own session).
-- Urgent safety alerts are sent whatever the row says (rule ALERT-SAFETY-LOCKED, packages/core/src/alert-prefs.ts).
BEGIN;
CREATE TABLE IF NOT EXISTS prima.alert_prefs (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
DO $ap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ap_shape' AND conrelid = 'prima.alert_prefs'::regclass) THEN
    ALTER TABLE prima.alert_prefs ADD CONSTRAINT ap_shape CHECK (
      data->>'id' = id AND data->>'userId' = id
      AND jsonb_typeof(data->'urgent') = 'boolean' AND jsonb_typeof(data->'digest') = 'boolean'
      AND jsonb_typeof(data->'muted') = 'array' AND jsonb_array_length(data->'muted') <= 100
    );
  END IF;
END
$ap$;
ALTER TABLE prima.alert_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.alert_prefs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON prima.alert_prefs FROM PUBLIC;
REVOKE ALL ON prima.alert_prefs FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.alert_prefs TO prima_app;
DROP POLICY IF EXISTS ap_own ON prima.alert_prefs;
CREATE POLICY ap_own ON prima.alert_prefs TO prima_app
  USING (id = current_setting('app.user_id', true))
  WITH CHECK (id = current_setting('app.user_id', true));
COMMIT;
