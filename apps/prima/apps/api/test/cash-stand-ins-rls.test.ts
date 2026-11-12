// P100 B2 (Fauzan, 11 Nov 2026: "the FD can stand in for the CEO when needed"): the cash stand-in table in the database
// itself. Repeat-safe office module, forced row-level security, only the CEO turns one on, only the CEO and the FD read
// it, the FD only adds a decision to one that is on. Then the service through Db.asUser. Synthetic data only.
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
const SQL = readFileSync(resolve(__dirname, '../../../../db/modules/cash-stand-ins-v1.sql'), 'utf8');

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
const row = (id: string, byId: string) => [id, JSON.stringify({ id, kind: 'dates', from: '2026-11-20', to: '2026-11-22', request: null, reason: 'Away (test)', set: { by: 'Test', byId, at: '2026-11-12T09:00:00+08:00' }, ended: null, uses: [] })];
const INSERT = 'INSERT INTO prima.cash_stand_ins (id, data) VALUES ($1, $2::jsonb)';

describe('cash stand-ins (database, row-level security)', () => {
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
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'cash_stand_ins'`);
    assert.deepEqual(r.rows, [{ relrowsecurity: true, relforcerowsecurity: true, del: false }]);
  });

  it('only the CEO turns one on; only the CEO and the FD read it', async () => {
    for (const who of ['u-fd', 'u-coo', 'u-pwvsb-hr', 'u-fin-t1-lead']) await assert.rejects(asApp(INSERT, row(`x-${who}`, who), who), /row-level security/, who);
    await asApp(INSERT, row('csi-test', 'u-fauzan'), 'u-fauzan');
    const n = async (who: string) => Number((await asApp('SELECT count(*)::int AS n FROM prima.cash_stand_ins', [], who)).rows[0].n);
    assert.equal(await n('u-fauzan'), 1);
    assert.equal(await n('u-fd'), 1);
    for (const who of ['u-coo', 'u-pwvsb-hr', 'u-fin-t1-lead', 'u-cm-sasa']) assert.equal(await n(who), 0, who);
    await assert.rejects(asApp('DELETE FROM prima.cash_stand_ins', [], 'u-fauzan'), /permission denied/);
  });

  it('the FD only adds their own decision, and never to an ended stand-in', async () => {
    const use = (byId: string) => JSON.stringify([{ at: '2026-11-21T10:00:00+08:00', area: 'arrival', companyId: 'co-sasa', ref: 'r1', byId, by: 'FD', decision: 'approved', amount: 100, reason: 'Test', seen: false }]);
    await assert.rejects(asApp(`UPDATE prima.cash_stand_ins SET data = jsonb_set(data, '{uses}', $1::jsonb) WHERE id = 'csi-test'`, [use('u-fauzan')], 'u-fd'), /row-level security/);
    await asApp(`UPDATE prima.cash_stand_ins SET data = jsonb_set(data, '{uses}', $1::jsonb) WHERE id = 'csi-test'`, [use('u-fd')], 'u-fd');
    await asApp(`UPDATE prima.cash_stand_ins SET data = jsonb_set(data, '{ended}', '{"by":"CEO","byId":"u-fauzan","at":"2026-11-21T11:00:00+08:00","reason":"Back"}'::jsonb) WHERE id = 'csi-test'`, [], 'u-fauzan');
    const r = await asApp(`UPDATE prima.cash_stand_ins SET data = jsonb_set(data, '{uses}', $1::jsonb) WHERE id = 'csi-test'`, [use('u-fd')], 'u-fd');
    assert.equal(r.rowCount, 0, 'an ended stand-in is not changed by the FD');
  });

  it('through the API: the CEO sets, the FD sees it, the COO is refused', async () => {
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.payAction(u, 'cash-stand-in-set', { kind: 'dates', from: today, to: today, reason: 'Not mine (test)' })), /Not allowed/);
    await db.asUser('u-fauzan', (svc, u) => svc.payAction(u, 'cash-stand-in-set', { kind: 'dates', from: today, to: today, reason: 'Away today (test)' }));
    const v = (await db.asUser('u-fd', (svc, u) => svc.payView(u, 'cash-stand-in', {}))) as { onNow: boolean; standsIn: boolean };
    assert.equal(v.onNow, true);
    assert.equal(v.standsIn, true);
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.payView(u, 'cash-stand-in', {})), /Not allowed/);
  });
});
