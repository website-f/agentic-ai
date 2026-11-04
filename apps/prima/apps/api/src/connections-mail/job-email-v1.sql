-- Outlook emails attached to jobs, VERSION 1 (PROPOSED). A separate, versioned module migration like ledger-v1.sql:
-- not covered by the 001_init.sql schema fingerprint, so the module has its own readiness gate
-- (PgJobEmailStore.readiness) and stays NotConfigured until this exact version is migrated. Any change must become
-- job-email-v2.sql with a new marker; the SHA-256 is pinned in pg-job-email-store.ts and tested. Applied only by
-- the reviewed, CEO-run migration (never by the API).
-- Job permission is checked twice (Arisha main, 31 Oct 2026): the API checks the IT job rules (it-job-access.ts), and
-- the database checks them again here from its own prima.users and prima.it_jobs rows (prima.job_email_job_access),
-- for every read, attach and remove. RLS also shows only the one job the request is about (app.job_email_job).
-- Writes: only the person who attached a row may remove it, once. Copies are kept 30 days (Fauzan,
-- 31 Oct 2026); a privileged retention job then erases the copy and keeps the stub.

CREATE SCHEMA IF NOT EXISTS prima;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_app') THEN
    CREATE ROLE prima_app NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA prima TO prima_app;

CREATE TABLE IF NOT EXISTS prima.job_email_attachments (
  id uuid PRIMARY KEY,
  job_id text NOT NULL,
  attached_by text NOT NULL,
  internet_message_id text NOT NULL,
  attached_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  removed_at timestamptz,
  data jsonb NOT NULL,
  CHECK (expires_at <= attached_at + interval '30 days'),
  CHECK (data->>'id' = id::text AND data->>'jobId' = job_id AND data->>'attachedBy' = attached_by AND data->>'internetMessageId' = internet_message_id),
  CHECK (data ? 'snapshot'),
  CHECK (removed_at IS NULL OR data->'snapshot' = 'null'::jsonb)
);
CREATE UNIQUE INDEX IF NOT EXISTS job_email_attachments_once ON prima.job_email_attachments (job_id, internet_message_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS job_email_attachments_job ON prima.job_email_attachments (job_id, attached_at DESC);

-- The only changes ever allowed: removal (once) or erasing the copy after expiry. Nothing else can be edited.
CREATE OR REPLACE FUNCTION prima.job_email_attachments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.job_id <> OLD.job_id OR NEW.attached_by <> OLD.attached_by
     OR NEW.internet_message_id <> OLD.internet_message_id OR NEW.attached_at <> OLD.attached_at OR NEW.expires_at <> OLD.expires_at
     OR OLD.removed_at IS NOT NULL OR NEW.data->'snapshot' <> 'null'::jsonb
     OR (NEW.removed_at IS NULL AND now() < OLD.expires_at) THEN
    RAISE EXCEPTION 'An attached email can only be removed, or erased after its keep period.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS job_email_attachments_guard ON prima.job_email_attachments;
CREATE TRIGGER job_email_attachments_guard BEFORE UPDATE ON prima.job_email_attachments FOR EACH ROW EXECUTE FUNCTION prima.job_email_attachments_guard();

-- The IT job rule, as the database sees it. Must match itJobEmailRule in it-job-access.ts (a test runs both on the
-- same people and jobs). Attach: the assignee, the person who gave the job, the IT Manager, the IT Lead and the COO,
-- while the job is not cancelled. View (and remove one's own): those, plus the CEO, ACT (audit) and HR / Chief of
-- Staff, who only look. Integration accounts and closed accounts get nothing. Unknown user or job: nothing.
CREATE OR REPLACE FUNCTION prima.job_email_job_access(job text, need text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = prima, pg_temp AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN coalesce(u.data->>'integration', 'false') <> 'false' THEN false
      WHEN u.data->>'accessClosedFrom' IS NOT NULL
           AND u.data->>'accessClosedFrom' <= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') THEN false
      WHEN need = 'attach' THEN coalesce(j.data->>'status', '') <> 'cancelled' AND (
             j.data->>'assigneeId' = u.id OR j.data->>'givenById' = u.id
             OR (u.data->>'department' = 'it' AND u.data->>'itRole' IN ('manager', 'lead'))
             OR u.data->>'opsTier' = 'coo')
      WHEN need = 'view' THEN
             j.data->>'assigneeId' = u.id OR j.data->>'givenById' = u.id
             OR (u.data->>'department' = 'it' AND u.data->>'itRole' IN ('manager', 'lead'))
             OR u.data->>'opsTier' IN ('coo', 'ceo')
             OR u.data->>'department' IN ('audit', 'hr', 'chief_of_staff')
      ELSE false END
    FROM prima.users u, prima.it_jobs j
    WHERE u.id = current_setting('app.user_id', true) AND j.id = job), false)
$$;
REVOKE ALL ON FUNCTION prima.job_email_job_access(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.job_email_job_access(text, text) TO prima_app;

ALTER TABLE prima.job_email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.job_email_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_read ON prima.job_email_attachments;
DROP POLICY IF EXISTS job_attach ON prima.job_email_attachments;
DROP POLICY IF EXISTS job_remove ON prima.job_email_attachments;
CREATE POLICY job_read ON prima.job_email_attachments FOR SELECT
  USING (job_id = current_setting('app.job_email_job', true) AND prima.job_email_job_access(job_id, 'view'));
CREATE POLICY job_attach ON prima.job_email_attachments FOR INSERT
  WITH CHECK (job_id = current_setting('app.job_email_job', true) AND attached_by = current_setting('app.user_id', true)
              AND prima.job_email_job_access(job_id, 'attach'));
CREATE POLICY job_remove ON prima.job_email_attachments FOR UPDATE
  USING (job_id = current_setting('app.job_email_job', true) AND attached_by = current_setting('app.user_id', true)
         AND prima.job_email_job_access(job_id, 'view'))
  WITH CHECK (job_id = current_setting('app.job_email_job', true) AND attached_by = current_setting('app.user_id', true)
              AND prima.job_email_job_access(job_id, 'view'));
REVOKE ALL ON prima.job_email_attachments FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.job_email_attachments TO prima_app;
COMMENT ON TABLE prima.job_email_attachments IS 'prima-job-email-attachments v1';
