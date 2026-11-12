// E9 PIKM records (Fauzan, 11 Nov 2026) in the database itself: the separate module SQL installs one table with forced
// row-level security and no delete; a company sees only its own records; the steps run through the real store as the
// runtime role, with the wrong role refused. Uses the throwaway local database and resets it. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, addDays, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');
const at = (t: string) => () => t;
const MODULE = resolve(__dirname, '../../../../db/modules/quality-pikm-v1.sql');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function asApp(sql: string, params: unknown[], s: { userId: string; group: boolean; companies?: string }) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true)`, [s.companies ?? '']);
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [s.userId]);
    await c.query(`SELECT set_config('app.group_user', $1, true)`, [s.group ? 'on' : 'off']);
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

const paper = (n: number) => ({ kind: 'document' as const, name: `Paper ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 pikm-pg ${n}`).toString('base64')}` });

describe('E9 PIKM records (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says in words that the module is not installed, before the CEO-run migration', async () => {
    const b = await db.asUser('u-pwvsb-hr', (svc, u) => svc.pikm.board(u), at(NOW));
    assert.equal(b.ready, false);
    await assert.rejects(db.asUser('u-ae-sasa', (svc, u) => svc.pikm.act(u, 'pack_prepare', { companyId: 'co-sasa', clientName: 'Client (test)' }), at(NOW)), /not switched on/);
  });

  it('installs one table with forced row-level security and no delete, twice without harm', async () => {
    await admin(readFileSync(MODULE, 'utf8'));
    await admin(readFileSync(MODULE, 'utf8'));
    const r = await admin(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'qms_pikm_records'`,
    );
    assert.deepEqual(r.rows, [{ relrowsecurity: true, relforcerowsecurity: true, del: false }]);
  });

  it('runs the client pack and office CCTV steps through the real store and walls them by company', async () => {
    const pack = await db.asUser('u-ae-sasa', (svc, u) => svc.pikm.act(u, 'pack_prepare', { companyId: 'co-sasa', clientName: 'Client Test (test)', membership: 'TEST-1' }), at(NOW));
    assert.equal(pack.companyId, 'co-sasa');
    // The preparer may not approve their own pack.
    await assert.rejects(db.asUser('u-ae-sasa', (svc, u) => svc.pikm.act(u, 'pack_decide', { id: pack.id, ok: false, note: 'Mine' }), at(NOW)), (e) => e instanceof AccessDenied);
    const refused = await db.asUser('u-cm-sasa', (svc, u) => svc.pikm.act(u, 'pack_decide', { id: pack.id, ok: false, note: 'Client asked for a different format' }), at(NOW));
    assert.equal(refused.status, 'refused');
    const sys = await db.asUser('u-ae-sasa', (svc, u) => svc.pikm.act(u, 'system_record', { companyId: 'co-sasa', system: 'alarm', installer: 'Alarm Test Sdn Bhd', place: 'Sasa office (test)', nextServiceOn: addDays(TODAY, 30) }), at(NOW));
    await db.asUser('u-ae-sasa', (svc, u) => svc.pikm.act(u, 'system_visit', { id: sys.id, on: TODAY, contractor: 'Alarm Test', result: 'Sirens and sensors tested', nextServiceOn: addDays(TODAY, 180), proof: [paper(1)] }), at(NOW));
    await assert.rejects(db.asUser('u-ae-sasa', (svc, u) => svc.pikm.act(u, 'system_check', { id: sys.id, note: 'ok' }), at(NOW)), (e) => e instanceof AccessDenied);
    const checked = await db.asUser('u-audit', (svc, u) => svc.pikm.act(u, 'system_check', { id: sys.id, note: 'Report seen' }), at(NOW));
    assert.equal(checked.status, 'checked');
    // Another company's manager reads none of these rows, on the board or directly.
    const other = await db.asUser('u-cm-arsh', (svc, u) => svc.pikm.board(u), at(NOW));
    assert.ok(other.ready);
    assert.equal(other.clientPack?.rows.length ?? 0, 0);
    assert.equal(other.officeSystems?.rows.length ?? 0, 0);
    const direct = await asApp('SELECT count(*)::int AS n FROM prima.qms_pikm_records', [], { userId: 'u-cm-arsh', group: false, companies: 'co-arsh' });
    assert.equal(direct.rows[0].n, 0);
    // A company user cannot write a row for another company, nor delete one.
    await assert.rejects(
      asApp(`INSERT INTO prima.qms_pikm_records (id, company_id, data) VALUES ('x', 'co-sasa', '{"id":"x","companyId":"co-sasa","kind":"medical"}'::jsonb)`, [], { userId: 'u-cm-arsh', group: false, companies: 'co-arsh' }),
      /row-level security/,
    );
    await assert.rejects(asApp(`DELETE FROM prima.qms_pikm_records WHERE id = $1`, [sys.id], { userId: 'u-cm-sasa', group: false, companies: 'co-sasa' }), /permission denied/);
  });
});
