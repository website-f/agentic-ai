-- Staff Mail send ledger, VERSION 1 (PROPOSED). A separate, versioned module migration: it is not covered by the
-- 001_init.sql schema fingerprint, so Mail has its own readiness gate (PgEmailLedger.readiness) that checks this
-- table's version marker, columns, row-level security, policy and the API role's exact privileges before Mail can
-- show as configured. Any change to this file must become ledger-v2.sql with a new marker; the file's SHA-256 is
-- pinned in pg-ledger.ts and tested. Applied only by the reviewed, CEO-run migration (never by the API).
-- One row per draft. The API (prima_app) reads and changes only the signed-in user's own rows and can never
-- delete; retention is a privileged job that never removes a Sending or Uncertain row.

CREATE SCHEMA IF NOT EXISTS prima;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_app') THEN
    CREATE ROLE prima_app NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA prima TO prima_app;

CREATE TABLE IF NOT EXISTS prima.staff_email_drafts (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('Draft', 'Sending', 'Accepted', 'Failed', 'Uncertain', 'Discarded')),
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id::text AND data->>'ownerUserId' = owner_user_id AND data->>'state' = state AND (data->>'version')::int = version)
);
CREATE INDEX IF NOT EXISTS staff_email_drafts_owner ON prima.staff_email_drafts (owner_user_id, updated_at DESC);

ALTER TABLE prima.staff_email_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.staff_email_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_drafts ON prima.staff_email_drafts;
CREATE POLICY own_drafts ON prima.staff_email_drafts
  USING (owner_user_id = current_setting('app.user_id', true))
  WITH CHECK (owner_user_id = current_setting('app.user_id', true));
REVOKE ALL ON prima.staff_email_drafts FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.staff_email_drafts TO prima_app;
COMMENT ON TABLE prima.staff_email_drafts IS 'prima-staff-email-ledger v1';
