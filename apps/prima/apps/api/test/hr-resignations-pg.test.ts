// E10 Staff resignation (Fauzan, 11 Nov 2026) in the database itself: the separate module SQL installs one table with
// forced row-level security and no delete; a staff member reaches their own row, another company does not; HR accepts
// through the real store and the last day lands on the staff record. Throwaway local database, reset. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');
const at = (t: string) => () => t;
const MODULE = resolve(__dirname, '../../../../db/modules/hr-resignations-v1.sql');

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

describe('E10 staff resignations (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says in words that it is not installed before the CEO-run migration', async () => {
    const mine = await db.asUser('u-ae-arsh', (svc, u) => svc.resignations.mine(u), at(NOW));
    assert.equal(mine.ready, false);
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.resignations.act(u, 'submit', {}), at(NOW)), /not switched on/);
  });

  it('installs one table with forced row-level security and no delete, twice without harm', async () => {
    await admin(readFileSync(MODULE, 'utf8'));
    await admin(readFileSync(MODULE, 'utf8'));
    const r = await admin(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'staff_resignations'`,
    );
    assert.deepEqual(r.rows, [{ relrowsecurity: true, relforcerowsecurity: true, del: false }]);
  });

  it('runs notice, refusal of the wrong role and acceptance through the real store, walled by company', async () => {
    const r = await db.asUser('u-ae-arsh', (svc, u) => svc.resignations.act(u, 'submit', { reason: 'Test' }), at(NOW));
    assert.equal(r.companyId, 'co-arsh');
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.resignations.act(u, 'accept', { id: r.id, note: 'Fine by me' }), at(NOW)), (e) => e instanceof AccessDenied);
    const ok = await db.asUser('u-pwvsb-hr', (svc, u) => svc.resignations.act(u, 'accept', { id: r.id, note: 'Handover agreed' }), at(NOW));
    assert.equal(ok.status, 'accepted');
    const p = await admin(`SELECT p.data->'leaving' AS l FROM prima.people p JOIN prima.users u ON u.data->>'personId' = p.id WHERE u.id = 'u-ae-arsh'`);
    assert.equal(p.rows[0].l.kind, 'resigned');
    assert.equal(p.rows[0].l.lastDayOn, r.earliestLastDay);
    const other = await asApp('SELECT count(*)::int AS n FROM prima.staff_resignations', [], { userId: 'u-cm-sasa', group: false, companies: 'co-sasa' });
    assert.equal(other.rows[0].n, 0);
    const own = await asApp('SELECT count(*)::int AS n FROM prima.staff_resignations', [], { userId: 'u-ae-arsh', group: false, companies: '' });
    assert.equal(own.rows[0].n, 1);
    await assert.rejects(asApp('DELETE FROM prima.staff_resignations', [], { userId: 'u-ae-arsh', group: false, companies: 'co-arsh' }), /permission denied/);
    // Audit P100: a person's own row cannot be moved, or written, under another company.
    await assert.rejects(asApp(`UPDATE prima.staff_resignations SET company_id = 'co-sasa', data = data || '{"companyId":"co-sasa"}'::jsonb WHERE id = $1`, [r.id], { userId: 'u-ae-arsh', group: false, companies: '' }), /row-level security/);
  });
});
