import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { JobEmailRecord, JobEmailStore } from './job-email-store';
import type { LedgerReadiness } from './ledger';

/** The versioned module migration. A change to the SQL must be a new version: the SHA-256 is pinned and tested. */
export const JOB_EMAIL_STORE_VERSION = 2;
export const JOB_EMAIL_STORE_MARKER = 'prima-job-email-attachments v2';
export const JOB_EMAIL_STORE_SHA256 = 'cefa0824c56a1e0f0e11c74d8929f181ed30810eef139f0116d72f27820e6e65';
export function jobEmailStoreSql(): string {
  return readFileSync(join(__dirname, '../../../src/connections-mail/job-email-v2.sql'), 'utf8');
}
export const jobEmailStoreSha256 = () => createHash('sha256').update(jobEmailStoreSql()).digest('hex');

const COLUMNS = 'attached_at:timestamp with time zone:true,attached_by:text:true,canonical_message_id:text:true,data:jsonb:true,expires_at:timestamp with time zone:true,id:uuid:true,internet_message_id:text:true,job_id:text:true,mailbox_oid:text:true,removed_at:timestamp with time zone:false,tenant_id:text:true';
const JOB = `(job_id = current_setting('app.job_email_job'::text, true))`;
const USER = `(attached_by = current_setting('app.user_id'::text, true))`;
const may = (need: 'view' | 'attach') => `prima.job_email_job_access(job_id, '${need}'::text)`;
const READ = `(${JOB} AND ${may('view')})`;
const ATTACH = `(${JOB} AND ${USER} AND ${may('attach')})`;
const REMOVE = `(${JOB} AND ${USER} AND ${may('view')})`;
/** Exactly these three public application policies, as PostgreSQL prints them; each one also asks the database's own job rule. */
const RETENTION_QUAL = '((expires_at <= statement_timestamp()) AND (removed_at IS NULL))';
const RETENTION_CHECK = `((expires_at <= statement_timestamp()) AND (removed_at IS NULL) AND ((data -> 'snapshot'::text) = 'null'::jsonb))`;
const RETENTION_POLICIES = `job_retention_read|r|${RETENTION_QUAL}|\njob_retention_update|w|${RETENTION_QUAL}|${RETENTION_CHECK}`;
const POLICIES = [`job_attach|INSERT||${ATTACH}`, `job_read|SELECT|${READ}|`, `job_remove|UPDATE|${REMOVE}|${REMOVE}`].join('\n');
/** The body of prima.job_email_job_access exactly as version 2 creates it (md5 of pg_proc.prosrc). */
export const JOB_ACCESS_FUNCTION_MD5 = '62615439b56838670860dc09f56cbf17';

const schemaBodyMd5 = (name: string) => {
  const body = jobEmailStoreSql().match(new RegExp(String.raw`FUNCTION prima\.${name}\([\s\S]*?AS \$\$([\s\S]*?)\$\$;`))?.[1];
  if (!body) throw new Error('Missing pinned schema function.');
  return createHash('md5').update(body).digest('hex');
};
const VALIDATOR_MD5 = schemaBodyMd5('job_email_row_valid');
const GUARD_MD5 = schemaBodyMd5('job_email_attachments_guard');
const ROW_CHECK = 'CHECK (prima.job_email_row_valid(id, job_id, attached_by, tenant_id, mailbox_oid, canonical_message_id, internet_message_id, attached_at, expires_at, removed_at, data))';
const UNIQUE_INDEX = 'CREATE UNIQUE INDEX job_email_attachments_once ON prima.job_email_attachments USING btree (job_id, tenant_id, mailbox_oid, canonical_message_id) WHERE (removed_at IS NULL)';

const READINESS_SQL = `
WITH t AS (SELECT c.oid, c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'prima' AND c.relname = 'job_email_attachments' AND c.relkind = 'r')
SELECT
  obj_description(t.oid, 'pg_class') AS marker,
  (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull::text, ',' ORDER BY attname) FROM pg_attribute
     WHERE attrelid = t.oid AND attnum > 0 AND NOT attisdropped) AS columns,
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = t.oid) AS rls,
  (SELECT string_agg(polname || '|' || CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END
     || '|' || coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), E'\\n' ORDER BY polname)
     FROM pg_policy WHERE polrelid = t.oid AND polpermissive AND polroles = '{0}') AS policies,
  (SELECT count(*) FROM pg_policy WHERE polrelid = t.oid) AS policy_count,
  (SELECT string_agg(polname || '|' || polcmd::text || '|' || coalesce(pg_get_expr(polqual,polrelid),'') || '|' || coalesce(pg_get_expr(polwithcheck,polrelid),''), E'\\n' ORDER BY polname)
    FROM pg_policy WHERE polrelid=t.oid AND polpermissive AND polroles=ARRAY[t.relowner]) AS retention_policies,
  pg_get_userbyid(t.relowner) <> 'prima_app' AND NOT pg_has_role('prima_app',t.relowner,'MEMBER') AS owner_isolated,
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = t.oid AND tgname = 'job_email_attachments_guard' AND tgenabled = 'O' AND NOT tgisinternal) AS guard,
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = t.oid AND NOT tgisinternal) AS trigger_count,
  (SELECT tgtype = 23 AND tgfoid = to_regprocedure('prima.job_email_attachments_guard()') FROM pg_trigger WHERE tgrelid=t.oid AND tgname='job_email_attachments_guard') AS trigger_ok,
  (SELECT string_agg(conname || '|' || pg_get_constraintdef(oid), E'\\n' ORDER BY conname) FROM pg_constraint WHERE conrelid=t.oid AND convalidated AND NOT condeferrable) AS constraints,
  (SELECT count(*) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = t.oid AND ic.relname = 'job_email_attachments_once' AND i.indisunique AND i.indisvalid AND i.indisready AND pg_get_indexdef(i.indexrelid) = '${UNIQUE_INDEX}') AS once,
  (SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = 'prima_app') AS app_role_restricted,
  has_table_privilege('prima_app', t.oid, 'SELECT') AND has_table_privilege('prima_app', t.oid, 'INSERT')
    AND has_table_privilege('prima_app', t.oid, 'UPDATE') AS app_can_use,
  has_table_privilege('prima_app', t.oid, 'DELETE') OR has_table_privilege('prima_app', t.oid, 'TRUNCATE')
    OR has_table_privilege('prima_app', t.oid, 'REFERENCES') OR has_table_privilege('prima_app', t.oid, 'TRIGGER') AS app_too_broad,
  pg_has_role(session_user, 'prima_app', 'SET') AS login_can_switch,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'prima' AND p.proname = 'job_email_job_access') AS rule_count,
  (SELECT md5(p.prosrc) = '${JOB_ACCESS_FUNCTION_MD5}' AND p.prosecdef AND p.provolatile = 's'
          AND p.proconfig = ARRAY['search_path=prima, pg_temp'] AND pg_get_userbyid(p.proowner) <> 'prima_app'
          AND has_function_privilege('prima_app', p.oid, 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'prima' AND p.proname = 'job_email_job_access' AND pg_get_function_identity_arguments(p.oid) = 'job text, need text') AS rule_ok,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND p.proname IN ('job_email_row_valid','job_email_attachments_guard')) AS helper_count,
  (SELECT md5(p.prosrc)='${VALIDATOR_MD5}' AND NOT p.prosecdef AND p.provolatile='i' AND p.proconfig=ARRAY['search_path=pg_catalog']
    AND pg_get_userbyid(p.proowner) <> 'prima_app' AND has_function_privilege('prima_app',p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
    FROM pg_proc p WHERE p.oid=to_regprocedure('prima.job_email_row_valid(uuid,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb)')) AS validator_ok,
  (SELECT md5(p.prosrc)='${GUARD_MD5}' AND NOT p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog']
    AND pg_get_userbyid(p.proowner) <> 'prima_app'
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
    FROM pg_proc p WHERE p.oid=to_regprocedure('prima.job_email_attachments_guard()')) AS guard_ok
FROM t`;

export async function jobEmailCatalogReadiness(client:Pick<PoolClient,'query'>):Promise<LedgerReadiness>{
 const no=(reason:string):LedgerReadiness=>({ready:false,reason});
 try{
 if(jobEmailStoreSha256()!==JOB_EMAIL_STORE_SHA256)return no('Pinned migration file changed.');
 const rows=(await client.query(READINESS_SQL)).rows;
 if(rows.length!==1)return no('Job email table is not migrated.');
 const r:Record<string,unknown>=rows[0];
    if (r.marker !== JOB_EMAIL_STORE_MARKER) return no(`Version marker is not '${JOB_EMAIL_STORE_MARKER}'.`);
    if (r.columns !== COLUMNS) return no('Columns do not match version 2.');
    if (r.rls !== true) return no('Row-level security is not enabled and forced.');
    if (Number(r.policy_count) !== 5 || r.policies !== POLICIES || r.retention_policies !== RETENTION_POLICIES || r.owner_isolated !== true) return no('Policies are not exactly the version 2 policies.');
    if (Number(r.guard) !== 1 || Number(r.trigger_count) !== 1 || r.trigger_ok !== true || r.guard_ok !== true) return no('The change guard trigger is missing or disabled.');
    if (Number(r.helper_count) !== 2 || r.validator_ok !== true) return no('The row validation function changed.');
    if (r.constraints !== `job_email_attachments_pkey|PRIMARY KEY (id)\njob_email_row_valid_check|${ROW_CHECK}`) return no('The primary key or CHECK constraints changed.');
    if (Number(r.once) !== 1) return no('The one-attachment-per-email index is missing.');
    if (r.app_role_restricted !== true) return no('prima_app must not be superuser or bypass row-level security.');
    if (r.app_can_use !== true) return no('prima_app lacks SELECT, INSERT or UPDATE.');
    if (r.app_too_broad !== false) return no('prima_app has more than SELECT, INSERT and UPDATE.');
    if (r.login_can_switch !== true) return no('The API login cannot switch to prima_app.');
    if (Number(r.rule_count) !== 1 || r.rule_ok !== true) return no('The database job rule (prima.job_email_job_access) is missing, changed or open to everyone.');
    return { ready: true };
 }catch{return no('Job email readiness could not be checked.');}
}

/**
 * Durable store. Every call runs in its own transaction as prima_app with app.user_id and app.job_email_job set,
 * so row-level security shows only that job, asks the database's own IT job rule again on every read, attach and
 * remove (prima.job_email_job_access), and lets only the attacher remove.
 */
export class PgJobEmailStore implements JobEmailStore {
  constructor(private readonly pool: Pool) {}

  async readiness(): Promise<LedgerReadiness> {
    try {
      const client=await this.pool.connect();
      try {await client.query('BEGIN READ ONLY');await client.query('SET LOCAL ROLE prima_app');return await jobEmailCatalogReadiness(client);}
      finally {try{await client.query('ROLLBACK');}catch(error){client.release(error as Error);throw error;}client.release();}
    } catch{return {ready:false,reason:'Job email readiness could not be checked.'};}
  }

  private async as<R>(userId: string, jobId: string, fn: (c: PoolClient) => Promise<R>): Promise<R> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE prima_app');
      await client.query(`SELECT set_config('app.user_id', $1, true), set_config('app.job_email_job', $2, true)`, [userId, jobId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async insert(userId: string, r: JobEmailRecord): Promise<'ok' | 'duplicate'> {
    try {
      await this.as(userId, r.jobId, c => c.query(
        `INSERT INTO prima.job_email_attachments (id, job_id, attached_by, tenant_id, mailbox_oid, canonical_message_id, internet_message_id, attached_at, expires_at, removed_at, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10)`, [r.id, r.jobId, r.attachedBy, r.attachedByTenantId, r.attachedByOid, r.canonicalMessageId, r.internetMessageId, r.attachedAt, r.expiresAt, JSON.stringify(r)]));
      return 'ok';
    } catch (e) {
      if ((e as { code?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'job_email_attachments_once') return 'duplicate';
      throw e;
    }
  }

  async list(userId: string, jobId: string, limit: number) {
    const r = await this.as(userId, jobId, c => c.query('SELECT data FROM prima.job_email_attachments WHERE job_id = $1 ORDER BY attached_at DESC LIMIT $2', [jobId, limit]));
    return r.rows.map(row => row.data as JobEmailRecord);
  }

  async get(userId: string, jobId: string, id: string) {
    const r = await this.as(userId, jobId, c => c.query('SELECT data FROM prima.job_email_attachments WHERE id = $1 AND job_id = $2', [id, jobId]));
    return (r.rows[0]?.data as JobEmailRecord | undefined) ?? null;
  }

  async remove(userId: string, jobId: string, id: string, next: JobEmailRecord) {
    if (next.id !== id || next.jobId !== jobId || next.attachedBy !== userId || !next.removedAt || next.snapshot !== null) return null;
    const r = await this.as(userId, jobId, c => c.query(
      'UPDATE prima.job_email_attachments SET removed_at = $3, data = $4 WHERE id = $1 AND job_id = $2 AND removed_at IS NULL RETURNING data',
      [id, jobId, next.removedAt, JSON.stringify(next)]));
    return (r.rows[0]?.data as JobEmailRecord | undefined) ?? null;
  }

  /**
   * Retention (Fauzan: 30 days), for a scheduled job authenticated as the isolated migration/table owner, not prima_app: erases the copy of every email
   * past its keep date and keeps the stub (who attached it, when, the Outlook link). Returns rows erased.
   */
  static async eraseExpired(adminPool: Pool, now: Date): Promise<number> {
    const r = await adminPool.query(
      `UPDATE prima.job_email_attachments
          SET data = jsonb_set(data, '{snapshot}', 'null'::jsonb) || jsonb_build_object('events', coalesce(data->'events', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', $1::text, 'by', 'retention', 'action', 'expired')))
        WHERE expires_at <= $1::timestamptz AND removed_at IS NULL AND data->'snapshot' <> 'null'::jsonb`, [now.toISOString()]);
    return r.rowCount ?? 0;
  }
}
