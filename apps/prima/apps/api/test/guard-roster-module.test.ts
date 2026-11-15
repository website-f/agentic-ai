/**
 * Guard roster engine database part (Part O; db/modules/guard-roster-v1.sql) on a throwaway local PostgreSQL only:
 * company wall, forced row security, no DELETE, published roster frozen, consent never changed, evidence never edited.
 * Synthetic rows only. Not on the release list: installing it needs the CEO's go-ahead.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { migrationSql } from '../src/schema';

const ROOT = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../..' : '.');
const SQL = readFileSync(resolve(ROOT, 'db/modules/guard-roster-v1.sql'), 'utf8');
const TABLES = ['site_coverage', 'roster_versions', 'roster_days', 'attendance_breaks', 'roster_evidence', 'guard_allowances', 'lump_sum_agreements'];
const BASE = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(BASE).hostname)) throw Error('Requires disposable localhost PostgreSQL');
const DB = 'prima_guard_roster_test';
const OWNER = 'prima_guard_roster_owner';
const url = (role?: string) => {
  const u = new URL(BASE);
  u.pathname = '/' + DB;
  if (role) {
    u.username = role;
    u.password = 'local-test-only';
  }
  return u.toString();
};
let c: Client;
/** Runs as the app role with the given visible companies (group user off). */
async function asApp<T>(companies: string, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true), set_config('app.group_user', 'off', true)`, [companies]);
    const r = await fn();
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
}

describe('guard roster database part (throwaway database)', () => {
  before(async () => {
    const a = new Client({ connectionString: BASE });
    await a.connect();
    try {
      await a.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
      if (!(await a.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount) await a.query('CREATE ROLE prima_app NOLOGIN');
      if (!(await a.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [OWNER])).rowCount) await a.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD 'local-test-only'`);
      await a.query(`GRANT prima_app TO ${OWNER}`);
      await a.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    } finally {
      await a.end();
    }
    c = new Client({ connectionString: url(OWNER) });
    await c.connect();
    await c.query(migrationSql());
    await c.query(SQL);
  });
  after(async () => {
    await c?.end();
    const a = new Client({ connectionString: BASE });
    await a.connect();
    try {
      await a.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    } finally {
      await a.end();
    }
  });

  it('every table forces row security and the app cannot delete', async () => {
    const r = await c.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND relname = ANY($1)`,
      [TABLES],
    );
    assert.equal(r.rowCount, TABLES.length);
    for (const row of r.rows) {
      assert.equal(row.relrowsecurity && row.relforcerowsecurity, true, row.relname);
      assert.equal(row.del, false, row.relname);
    }
  });

  it('the company wall hides another company and refuses writing into it', async () => {
    await asApp('co-a', () => c.query(`INSERT INTO prima.roster_versions VALUES ('rv-a', 'co-a', '{"status":"draft","siteId":"site-a"}')`));
    assert.equal((await asApp('co-b', () => c.query('SELECT id FROM prima.roster_versions'))).rowCount, 0);
    await assert.rejects(asApp('co-b', () => c.query(`INSERT INTO prima.roster_versions VALUES ('rv-x', 'co-a', '{"status":"draft"}')`)));
  });

  it('a published version is frozen; only replaced by a newer one', async () => {
    await asApp('co-a', () => c.query(`INSERT INTO prima.roster_days VALUES ('rd-1', 'co-a', '{"rosterVersionId":"rv-a","date":"2026-12-01","planned":"WORK_D","actual":null}')`));
    await asApp('co-a', () => c.query(`UPDATE prima.roster_days SET data = data || '{"planned":"OFF_REST"}' WHERE id = 'rd-1'`));
    await asApp('co-a', () => c.query(`UPDATE prima.roster_versions SET data = data || '{"status":"published"}' WHERE id = 'rv-a'`));
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.roster_versions SET data = data || '{"siteId":"site-b"}' WHERE id = 'rv-a'`)), /frozen/);
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.roster_days SET data = data || '{"planned":"WORK_D"}' WHERE id = 'rd-1'`)), /frozen/);
    // The actual is filled in once; changing it later needs evidence, a reason and a different approver.
    await asApp('co-a', () => c.query(`UPDATE prima.roster_days SET data = data || '{"actual":"OFF_REST"}' WHERE id = 'rd-1'`));
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.roster_days SET data = data || '{"actual":"WORK_D"}' WHERE id = 'rd-1'`)), /OD\/OGM/);
    await assert.rejects(
      asApp('co-a', () => c.query(`UPDATE prima.roster_days SET data = data || '{"actual":"WORK_D","actualCorrection":{"proposedById":"u-om","approvedById":"u-om","evidence":"att-1","reason":"x"}}' WHERE id = 'rd-1'`)),
      /OD\/OGM/,
    );
    await asApp('co-a', () => c.query(`UPDATE prima.roster_days SET data = data || '{"actual":"WORK_D","actualCorrection":{"proposedById":"u-om","approvedById":"u-od","evidence":"att-1","reason":"Clocked in, device was offline"}}' WHERE id = 'rd-1'`));
    await asApp('co-a', () => c.query(`UPDATE prima.roster_versions SET data = data || '{"status":"replaced","replacedById":"rv-b"}' WHERE id = 'rv-a'`));
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.roster_versions SET data = data || '{"status":"draft"}' WHERE id = 'rv-a'`)), /frozen/);
  });

  it('consent is never changed and a signed agreement can only be withdrawn; evidence is never edited', async () => {
    await asApp('co-a', () => c.query(`INSERT INTO prima.lump_sum_agreements VALUES ('ls-1', 'co-a', '{"status":"proposed","target":2300,"consent":null}')`));
    await asApp('co-a', () => c.query(`UPDATE prima.lump_sum_agreements SET data = data || '{"status":"signed","consent":{"signedAt":"2026-11-20T10:00:00Z","documentHash":"aa"}}' WHERE id = 'ls-1'`));
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.lump_sum_agreements SET data = data || '{"consent":{"signedAt":"2026-11-01T10:00:00Z","documentHash":"aa"}}' WHERE id = 'ls-1'`)), /never changed/);
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.lump_sum_agreements SET data = data || '{"target":2000}' WHERE id = 'ls-1'`)), /does not change/);
    await asApp('co-a', () => c.query(`UPDATE prima.lump_sum_agreements SET data = data || '{"status":"withdrawn","withdrawnAt":"2026-12-05T00:00:00Z"}' WHERE id = 'ls-1'`));
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.lump_sum_agreements SET data = data || '{"status":"signed"}' WHERE id = 'ls-1'`)));
    await asApp('co-a', () => c.query(`INSERT INTO prima.roster_evidence VALUES ('ev-1', 'co-a', '{"rule":"weekly_rest","documentRef":"JTK-1"}')`));
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.roster_evidence SET data = '{}' WHERE id = 'ev-1'`)));
    // Only ACT's check is added, once.
    await asApp('co-a', () => c.query(`UPDATE prima.roster_evidence SET data = data || '{"actCheck":{"byId":"u-act","result":"ok","note":"seen"}}' WHERE id = 'ev-1'`));
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.roster_evidence SET data = data || '{"actCheck":{"byId":"u-act","result":"query","note":"again"}}' WHERE id = 'ev-1'`)), /not edited/);
    await assert.rejects(asApp('co-a', () => c.query(`UPDATE prima.roster_evidence SET data = data || '{"documentRef":"OTHER"}' WHERE id = 'ev-1'`)), /not edited/);
  });
});
