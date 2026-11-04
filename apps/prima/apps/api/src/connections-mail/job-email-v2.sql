-- Job-email module v2. Fresh installation only; v1 is deliberately not altered or stamped.
-- Existing data requires a separately reviewed migration. Never run this from the API.
BEGIN;
DO $$ BEGIN
  IF to_regclass('prima.job_email_attachments') IS NOT NULL THEN
    RAISE EXCEPTION 'Job-email v2 requires a fresh table; existing installations need a reviewed upgrade.';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS prima;
GRANT USAGE ON SCHEMA prima TO prima_app;

CREATE OR REPLACE FUNCTION prima.job_email_row_valid(rid uuid, job text, owner_id text, tenant text, mailbox text, message text,
  internet_id text, attached timestamptz, expires timestamptz, removed timestamptz, d jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR
     NOT (d ?& ARRAY['id','jobId','attachedBy','attachedByName','attachedByTenantId','attachedByOid','canonicalMessageId',
       'attachedAt','expiresAt','removedAt','internetMessageId','webLink','snapshotHash','snapshot','events']) OR
     (SELECT count(*) FROM jsonb_object_keys(d)) <> 15 THEN RETURN false; END IF;
  RETURN coalesce(
    d->>'id' = rid::text AND d->>'jobId' = job AND d->>'attachedBy' = owner_id
    AND d->>'attachedByTenantId' = tenant AND d->>'attachedByOid' = mailbox AND d->>'canonicalMessageId' = message
    AND d->>'internetMessageId' = internet_id
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['id','jobId','attachedBy','attachedByName','attachedByTenantId','attachedByOid','canonicalMessageId','internetMessageId','webLink','snapshotHash']) AS k WHERE jsonb_typeof(d->k) IS DISTINCT FROM 'string')
    AND jsonb_typeof(d->'attachedAt') = 'string' AND jsonb_typeof(d->'expiresAt') = 'string'
    AND (d->>'attachedAt')::timestamptz = attached AND (d->>'expiresAt')::timestamptz = expires
    AND ((removed IS NULL AND d->'removedAt' = 'null'::jsonb)
      OR (removed IS NOT NULL AND jsonb_typeof(d->'removedAt') = 'string' AND (d->>'removedAt')::timestamptz = removed))
    AND attached < expires AND expires <= attached + interval '30 days'
    AND tenant ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND mailbox ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND length(message) BETWEEN 16 AND 400 AND message ~ '^[A-Za-z0-9+/=_-]+$'
    AND length(internet_id) BETWEEN 1 AND 998 AND length(job) BETWEEN 1 AND 120 AND length(owner_id) BETWEEN 1 AND 120
    AND jsonb_typeof(d->'attachedByName') = 'string' AND length(d->>'attachedByName') <= 200
    AND jsonb_typeof(d->'webLink') = 'string' AND length(d->>'webLink') <= 4096
    AND d->>'snapshotHash' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(d->'snapshot') IN ('object','null') AND (removed IS NULL OR d->'snapshot' = 'null'::jsonb)
    AND jsonb_typeof(d->'events') = 'array' AND jsonb_array_length(d->'events') BETWEEN 1 AND 3,
    false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION prima.job_email_row_valid(uuid,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.job_email_row_valid(uuid,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb) TO prima_app;

CREATE TABLE prima.job_email_attachments (
  id uuid PRIMARY KEY,
  job_id text NOT NULL,
  attached_by text NOT NULL,
  tenant_id text NOT NULL,
  mailbox_oid text NOT NULL,
  canonical_message_id text NOT NULL,
  internet_message_id text NOT NULL,
  attached_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  removed_at timestamptz,
  data jsonb NOT NULL,
  CONSTRAINT job_email_row_valid_check CHECK (prima.job_email_row_valid(id,job_id,attached_by,tenant_id,mailbox_oid,canonical_message_id,internet_message_id,attached_at,expires_at,removed_at,data))
);
CREATE UNIQUE INDEX job_email_attachments_once ON prima.job_email_attachments (job_id, tenant_id, mailbox_oid, canonical_message_id) WHERE removed_at IS NULL;
CREATE INDEX job_email_attachments_job ON prima.job_email_attachments (job_id, attached_at DESC);

CREATE OR REPLACE FUNCTION prima.job_email_attachments_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE event jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.removed_at IS NOT NULL OR jsonb_typeof(NEW.data->'snapshot') IS DISTINCT FROM 'object'
      OR NEW.data->'events' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('at',NEW.data->>'attachedAt','by',NEW.attached_by,'action','attached')) THEN
      RAISE EXCEPTION 'An attached email must begin with its original snapshot and attachment event.';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.job_id,NEW.attached_by,NEW.tenant_id,NEW.mailbox_oid,NEW.canonical_message_id,NEW.internet_message_id,NEW.attached_at,NEW.expires_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.job_id,OLD.attached_by,OLD.tenant_id,OLD.mailbox_oid,OLD.canonical_message_id,OLD.internet_message_id,OLD.attached_at,OLD.expires_at)
     OR OLD.removed_at IS NOT NULL OR NEW.data->'snapshot' IS DISTINCT FROM 'null'::jsonb
     OR (NEW.data - ARRAY['snapshot','removedAt','events']) IS DISTINCT FROM (OLD.data - ARRAY['snapshot','removedAt','events'])
     OR jsonb_typeof(NEW.data->'events') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.data->'events') <> jsonb_array_length(OLD.data->'events') + 1
     OR ((NEW.data->'events') - (jsonb_array_length(NEW.data->'events') - 1)) IS DISTINCT FROM OLD.data->'events' THEN
    RAISE EXCEPTION 'An attached email can only be removed, or erased after its keep period.';
  END IF;
  event := NEW.data->'events'->-1;
  IF NEW.removed_at IS NOT NULL THEN
    IF event IS DISTINCT FROM jsonb_build_object('at',NEW.data->>'removedAt','by',OLD.attached_by,'action','removed')
       OR NEW.removed_at < OLD.attached_at OR NEW.removed_at > statement_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'Removal must append exactly its attacher and removal time.';
    END IF;
  ELSE
    IF OLD.data->'snapshot' = 'null'::jsonb OR statement_timestamp() < OLD.expires_at
       OR (event - 'at') IS DISTINCT FROM jsonb_build_object('by','retention','action','expired')
       OR jsonb_typeof(event->'at') IS DISTINCT FROM 'string'
       OR (event->>'at')::timestamptz < OLD.expires_at
       OR (event->>'at')::timestamptz > statement_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'Expiry must append exactly one retention event after the keep period.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION prima.job_email_attachments_guard() FROM PUBLIC;
CREATE TRIGGER job_email_attachments_guard BEFORE INSERT OR UPDATE ON prima.job_email_attachments FOR EACH ROW EXECUTE FUNCTION prima.job_email_attachments_guard();

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
-- FORCE RLS also applies to Azure's non-superuser migration owner. Only that
-- exact role gets the expired-row maintenance path; prima_app never inherits it.
DO $$ BEGIN
  IF current_user = 'prima_app' OR pg_has_role('prima_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'The migration owner must be isolated from prima_app.';
  END IF;
  EXECUTE format('CREATE POLICY job_retention_read ON prima.job_email_attachments FOR SELECT TO %I USING (expires_at <= statement_timestamp() AND removed_at IS NULL)', current_user);
  EXECUTE format('CREATE POLICY job_retention_update ON prima.job_email_attachments FOR UPDATE TO %I USING (expires_at <= statement_timestamp() AND removed_at IS NULL) WITH CHECK (expires_at <= statement_timestamp() AND removed_at IS NULL AND data->''snapshot'' = ''null''::jsonb)', current_user);
END $$;
REVOKE ALL ON prima.job_email_attachments FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.job_email_attachments TO prima_app;
COMMENT ON TABLE prima.job_email_attachments IS 'prima-job-email-attachments v2';

COMMIT;
