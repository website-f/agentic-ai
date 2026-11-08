-- Alert sent-record, VERSION 1 (PROPOSED, staff usability rule 7, 5 Nov 2026). A separate, versioned module
-- migration like connections-mail/ledger-v1.sql. Applied only by the reviewed, CEO-run migration (never by the API).
-- Until it is applied, alerts cannot run (PgAlertLedger.ready() is false and /api/alerts/run answers 503).
-- One row per delivered alert. The id is a SHA-256 of channel, recipient and item key, so the table holds no names,
-- addresses or item text. The API (prima_app) may read, add and give back (delete) a claim; nothing else.

CREATE SCHEMA IF NOT EXISTS prima;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_app') THEN
    CREATE ROLE prima_app NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA prima TO prima_app;

CREATE TABLE IF NOT EXISTS prima.alert_deliveries (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  channel text NOT NULL CHECK (channel IN ('email', 'teams')),
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_deliveries_claimed ON prima.alert_deliveries (claimed_at);
COMMENT ON TABLE prima.alert_deliveries IS 'prima-alerts-ledger-v1';

REVOKE ALL ON prima.alert_deliveries FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON prima.alert_deliveries TO prima_app;
