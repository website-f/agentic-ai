// P100 C12 + J3 (Fauzan, 11 Nov 2026): staff overtime lines in the database itself. Repeat-safe office module, forced
// row-level security: the person and HR read; the person adds only their own pending claim; only HR decides; a colleague
// or a company manager reads nothing; nothing is deleted. Throwaway local database, synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const SQL = readFileSync(resolve(__dirname, '../../../../db/modules/staff-ot-v1.sql'), 'utf8');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}
async function asApp(sql: string, params: unknown[], userId: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.group_user', 'on', true)`, [userId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}
const claim = (id: string, userId: string, by: string) => [
  id,
  'pwvsb',
  JSON.stringify({ id, companyId: 'pwvsb', personId: 'p-x', userId, name: 'Test', date: '2026-10-20', hours: 2, kind: 'normal', source: 'claim', cmsShiftId: null, reason: 'Test overtime', status: 'pending', raised: { by: 'Test', byId: by, at: '2026-10-20T20:00:00+08:00' }, decided: null }),
];
const INSERT = 'INSERT INTO prima.staff_ot_lines (id, company_id, data) VALUES ($1, $2, $3::jsonb)';

describe('staff overtime lines (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    await admin(SQL);
    await admin(SQL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('installs one table with forced row-level security and no delete', async () => {
    const r = await admin(`SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'staff_ot_lines'`);
    assert.deepEqual(r.rows, [{ relrowsecurity: true, relforcerowsecurity: true, del: false }]);
  });

  it('the person adds only their own claim; a colleague cannot add one for them; only HR reads all and decides', async () => {
    await assert.rejects(asApp(INSERT, claim('ot-a', 'u-cms-head', 'u-cms-head-b'), 'u-cms-head-b'), /row-level security/);
    await asApp(INSERT, claim('ot-a', 'u-cms-head', 'u-cms-head'), 'u-cms-head');
    const n = async (who: string) => Number((await asApp('SELECT count(*)::int AS n FROM prima.staff_ot_lines', [], who)).rows[0].n);
    assert.equal(await n('u-cms-head'), 1);
    assert.equal(await n('u-pwvsb-hr'), 1);
    for (const who of ['u-cms-head-b', 'u-cm-sasa', 'u-ae-sasa']) assert.equal(await n(who), 0, who);
    // The claimant cannot approve it; HR can, with a note; HR deciding a line it raised for itself is refused by the row check.
    const approve = (by: string) => asApp(`UPDATE prima.staff_ot_lines SET data = data || jsonb_build_object('status','approved','decided', jsonb_build_object('by','T','byId',$1::text,'at','2026-10-21T09:00:00+08:00','note','Checked')) WHERE id = 'ot-a'`, [by], by);
    assert.equal((await approve('u-cms-head')).rowCount, 0);
    await assert.rejects(asApp(`UPDATE prima.staff_ot_lines SET data = data || '{"status":"approved","decided":{"by":"T","byId":"u-cms-head","at":"x","note":"Mine"}}'::jsonb WHERE id = 'ot-a'`, [], 'u-pwvsb-hr'), /sot_shape/);
    assert.equal((await approve('u-pwvsb-hr')).rowCount, 1);
    await assert.rejects(asApp('DELETE FROM prima.staff_ot_lines', [], 'u-pwvsb-hr'), /permission denied/);
  });

  it('through the API: the overtime board for HR, refused for a guard', async () => {
    const v = (await db.asUser('u-pwvsb-hr', (svc, u) => svc.payView(u, 'staff-ot', {}))) as { canDecide: boolean; lines: unknown[] };
    assert.equal(v.canDecide, true);
    assert.ok(v.lines.length >= 1);
    await assert.rejects(db.asUser('u-guard-sasa-1', (svc, u) => svc.payAction(u, 'ot-claim', { date: '2026-10-20', hours: 2, kind: 'normal', reason: 'Guard (test)' })), /Not allowed/);
  });
});
