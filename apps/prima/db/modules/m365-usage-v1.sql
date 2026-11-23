-- Microsoft use board, VERSION 1 (rule M365-USE; Fauzan, 23 Nov 2026). NOT in db/release-manifest.json: an off-list
-- module, installed only with Fauzan's go-ahead through infra/run-db-migration.sh, staging first. Until it is
-- installed the board answers "not installed" and the daily run refuses to start (PgUsageStore.ready() is false).
-- One row per day: each office staff member's Prima id and their checklist (ok, missing or unknown per check).
-- No names, sign-in names, e-mail addresses or content are stored. Kept 90 days; the API deletes older rows.
-- The API (prima_app) may read, add or replace a day, and delete days older than 90; nothing else.

CREATE SCHEMA IF NOT EXISTS prima;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_app') THEN
    CREATE ROLE prima_app NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA prima TO prima_app;

CREATE TABLE IF NOT EXISTS prima.m365_usage_days (
  as_of date PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND jsonb_typeof(data -> 'people') = 'array'),
  fetched_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE prima.m365_usage_days IS 'prima-m365-usage-v1';

REVOKE ALL ON prima.m365_usage_days FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON prima.m365_usage_days TO prima_app;
