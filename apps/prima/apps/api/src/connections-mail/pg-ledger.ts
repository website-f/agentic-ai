import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { EmailDraft, LedgerReadiness, StaffEmailLedger } from './ledger';

/** The versioned module migration. A change to the SQL must be a new version: the SHA-256 is pinned and tested. */
export const STAFF_EMAIL_LEDGER_VERSION = 1;
export const STAFF_EMAIL_LEDGER_MARKER = 'prima-staff-email-ledger v1';
export const STAFF_EMAIL_LEDGER_SHA256 = '5c5e11cdb5a9ed69ef4bf99fd0de497c6800dbc32e9ba48f29bd98e05cb39f6e';
const LEDGER_FILE = 'ledger-v1.sql';

/** The proposed DDL (kept beside the compiled file's source). Applied only by the reviewed, CEO-run migration or by tests. */
export function staffEmailLedgerSql(): string {
  return readFileSync(join(__dirname, `../../../src/connections-mail/${LEDGER_FILE}`), 'utf8');
}
export const staffEmailLedgerSha256 = () => createHash('sha256').update(staffEmailLedgerSql()).digest('hex');

const COLUMNS = 'data:jsonb,id:uuid,owner_user_id:text,state:text,updated_at:timestamp with time zone,version:integer';
/**
 * One catalog read; every condition must hold or Mail stays NotConfigured. Reads metadata only, never drafts, and
 * works from the restricted API login (pg_catalog only: no schema USAGE or information_schema visibility needed).
 */
const READINESS_SQL = `
WITH t AS (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'prima' AND c.relname = 'staff_email_drafts' AND c.relkind = 'r')
SELECT
  obj_description(t.oid, 'pg_class') AS marker,
  (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attname) FROM pg_attribute
     WHERE attrelid = t.oid AND attnum > 0 AND NOT attisdropped) AS columns,
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = t.oid) AS rls,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'prima' AND tablename = 'staff_email_drafts') AS policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'prima' AND tablename = 'staff_email_drafts' AND policyname = 'own_drafts'
     AND cmd = 'ALL' AND permissive = 'PERMISSIVE' AND roles = '{public}'
     AND qual = '(owner_user_id = current_setting(''app.user_id''::text, true))'
     AND with_check = '(owner_user_id = current_setting(''app.user_id''::text, true))') AS own_policy,
  (SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = 'prima_app') AS app_role_restricted,
  has_table_privilege('prima_app', t.oid, 'SELECT') AND has_table_privilege('prima_app', t.oid, 'INSERT')
    AND has_table_privilege('prima_app', t.oid, 'UPDATE') AS app_can_use,
  has_table_privilege('prima_app', t.oid, 'DELETE') OR has_table_privilege('prima_app', t.oid, 'TRUNCATE')
    OR has_table_privilege('prima_app', t.oid, 'REFERENCES') OR has_table_privilege('prima_app', t.oid, 'TRIGGER') AS app_too_broad,
  pg_has_role(current_user, 'prima_app', 'SET') AS login_can_switch
FROM t`;

/**
 * Durable PostgreSQL ledger. Every call runs in its own transaction as prima_app with app.user_id set to the
 * owner, so row-level security keeps each person to their own drafts. The compare-and-set UPDATE makes one
 * Send claim win across retries, concurrent workers, replicas and restarts.
 */
export class PgEmailLedger implements StaffEmailLedger {
  constructor(private readonly pool: Pool) {}

  /** The readiness gate: migrated version 1 table, exact columns, forced RLS, one owner policy, least privilege. */
  async readiness(): Promise<LedgerReadiness> {
    const no = (reason: string): LedgerReadiness => ({ ready: false, reason });
    let r: Record<string, unknown>;
    try {
      const rows = (await this.pool.query(READINESS_SQL)).rows;
      if (rows.length !== 1) return no('Ledger table is not migrated.');
      r = rows[0];
    } catch { return no('Ledger readiness could not be checked.'); }
    if (r.marker !== STAFF_EMAIL_LEDGER_MARKER) return no(`Ledger version marker is not '${STAFF_EMAIL_LEDGER_MARKER}'.`);
    if (r.columns !== COLUMNS) return no('Ledger columns do not match version 1.');
    if (r.rls !== true) return no('Ledger row-level security is not enabled and forced.');
    if (Number(r.policies) !== 1 || Number(r.own_policy) !== 1) return no('Ledger policy is not exactly the owner policy.');
    if (r.app_role_restricted !== true) return no('prima_app must not be superuser or bypass row-level security.');
    if (r.app_can_use !== true) return no('prima_app lacks SELECT, INSERT or UPDATE on the ledger.');
    if (r.app_too_broad !== false) return no('prima_app has more than SELECT, INSERT and UPDATE on the ledger.');
    if (r.login_can_switch !== true) return no('The API login cannot switch to prima_app.');
    return { ready: true };
  }

  private async as<R>(owner: string, fn: (c: PoolClient) => Promise<R>): Promise<R> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE prima_app');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [owner]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async create(draft: EmailDraft) {
    await this.as(draft.ownerUserId, c => c.query(
      'INSERT INTO prima.staff_email_drafts (id, owner_user_id, state, version, updated_at, data) VALUES ($1, $2, $3, $4, $5, $6)',
      [draft.id, draft.ownerUserId, draft.state, draft.version, draft.updatedAt, JSON.stringify(draft)]));
  }

  async get(owner: string, id: string) {
    const r = await this.as(owner, c => c.query('SELECT data FROM prima.staff_email_drafts WHERE id = $1', [id]));
    return (r.rows[0]?.data as EmailDraft | undefined) ?? null;
  }

  async list(owner: string, limit: number) {
    const r = await this.as(owner, c => c.query(`SELECT data FROM prima.staff_email_drafts WHERE state <> 'Discarded' ORDER BY updated_at DESC LIMIT $1`, [limit]));
    return r.rows.map(row => row.data as EmailDraft);
  }

  async transition(owner: string, id: string, expectedVersion: number, next: EmailDraft) {
    if (next.ownerUserId !== owner || next.id !== id || next.version !== expectedVersion + 1) return null;
    const r = await this.as(owner, c => c.query(
      'UPDATE prima.staff_email_drafts SET state = $3, version = $4, updated_at = $5, data = $6 WHERE id = $1 AND version = $2 RETURNING data',
      [id, expectedVersion, next.state, next.version, next.updatedAt, JSON.stringify(next)]));
    return (r.rows[0]?.data as EmailDraft | undefined) ?? null;
  }

  /**
   * Retention, for a privileged scheduled job (not prima_app): removes settled drafts last changed before `before`.
   * Sending and Uncertain rows are never removed, so a lock cannot expire by deletion.
   */
  static async purge(adminPool: Pool, before: Date): Promise<number> {
    const r = await adminPool.query(`DELETE FROM prima.staff_email_drafts WHERE state IN ('Draft', 'Accepted', 'Failed', 'Discarded') AND updated_at < $1`, [before.toISOString()]);
    return r.rowCount ?? 0;
  }
}
