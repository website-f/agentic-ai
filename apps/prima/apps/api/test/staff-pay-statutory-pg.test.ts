// Disposable loopback PostgreSQL only; synthetic people and recorded-payment markers, never a bank call.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dataWalls, staffPayRole, myt, type StaffPayRun } from '@prima/core';
import { DEFAULT_STATUTORY } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL;
if (!URL || !['127.0.0.1', 'localhost', '[::1]'].includes(new globalThis.URL(URL).hostname))
  throw new Error('This regression requires an explicitly supplied disposable loopback DATABASE_URL.');
const NOW = myt('2026-11-07', '10:00');
let tick = Date.parse(NOW);
const clock = () => new Date(tick += 1000).toISOString();
const FINANCE = 'u-fin-t1-lead';
const settings = (rate: number) => ({ ...structuredClone(DEFAULT_STATUTORY), epf: { ...DEFAULT_STATUTORY.epf, eeRate: rate } });

describe('staff payroll statutory Finance read wall and release gate (actual PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL!, NOW);
    db = new Db();
    await db.pool.query(`UPDATE prima.staff_pay_runs SET data=data || '{"stage":"draft","paid":null}'::jsonb WHERE company_id='co-sasa'`);
    await db.pool.query(`UPDATE prima.people SET data = (data - 'leaving') ||
      '{"bank":{"bank":"Synthetic bank","accountMasked":"****1234"},"hiredOn":"2020-01-01"}'::jsonb
      WHERE company_id='co-sasa' AND data->>'role'='office'`);
  });
  after(async () => { if (db) await db.onModuleDestroy(); });
  const set = (rate: number, month = '2026-11') => db.asUser('u-fauzan', (svc, u) => svc.setStatutory(u, { effectiveFrom: month, settings: settings(rate), reason: 'Synthetic effective contribution settings' }), clock);
  const prepare = () => db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareStaffPay(u, 'co-sasa', '2026-11'), clock);
  const stage = async (run: StaffPayRun, value: string) => db.pool.query(`UPDATE prima.staff_pay_runs SET data=data || $2::jsonb WHERE id=$1`, [run.id, JSON.stringify({ stage: value })]);
  const pay = (run: StaffPayRun) => db.asUser(FINANCE, (svc, u) => svc.staffPayStep(u, run.id, 'pay', { bankRef: 'SYNTHETIC-NO-BANK-CALL', pcbChecked: true, paidOn: '2026-11-07' }), clock);

  it('gives existing payroll Finance only statutory SELECT, not ACT/formula or employee-ID access', async () => {
    const version = await set(0.12);
    await db.asUser(FINANCE, async (svc, user, store) => {
      assert.equal(staffPayRole(user), 'finance');
      const walls = dataWalls(user);
      assert.ok(walls.includes('statutory_read'));
      assert.ok(!walls.includes('act') && !walls.includes('pay_read') && !walls.includes('staff_ids'));
      assert.equal((await store.list('statutoryVersions', {})).find((v) => v.id === version.id)?.settings.epf.eeRate, 0.12);
      assert.equal((await svc.statutoryBoard(user)).inForce.epf.eeRate, 0.12);
      assert.deepEqual(await store.list('payFormulas', {}), []);
      assert.deepEqual(await store.list('staffIds', {}), []);
    }, clock);
    await assert.rejects(db.asUser(FINANCE, (svc, u) => svc.setStatutory(u, { effectiveFrom: '2026-11', settings: settings(0.13), reason: 'Forbidden synthetic rate edit' }), clock), /only the CEO/i);
    await assert.rejects(db.asUser(FINANCE, (_svc, _u, store) => store.update('statutoryVersions', version.id, { settings: settings(0.13) }), clock), /not found|row-level security/i);
    await assert.rejects(db.asUser(FINANCE, (_svc, _u, store) => store.insert('statutoryVersions', { ...version, id: 'forbidden-finance-rate' }), clock), /row-level security/i);
    assert.equal((await db.pool.query(`SELECT data->'settings'->'epf'->>'eeRate' AS rate FROM prima.statutory_versions WHERE id=$1`, [version.id])).rows[0].rate, '0.12');
    await db.asUser('u-it-mgr', async (_svc, user, store) => {
      assert.ok(!dataWalls(user).includes('statutory_read'));
      assert.deepEqual(await store.list('statutoryVersions', {}), []);
    }, clock);
  });

  it('allows Finance release with the actual effective rate, then blocks stale release and export until rebuilt', async () => {
    await set(0.12);
    const run = await prepare();
    assert.ok(run.lines.every((l) => l.statutoryInputs));
    await stage(run, 'coo_approved');
    await set(0.13);
    await assert.rejects(pay(run), /Statutory contribution settings/);
    await assert.rejects(db.asUser(FINANCE, (svc, u) => svc.staffPayExport(u, run.id, 'bank'), clock), /Statutory contribution settings/);
    const unchanged = await db.asUser(FINANCE, (svc, u) => svc.staffPayRun(u, run.id), clock);
    assert.equal(unchanged.run.stage, 'coo_approved');
    assert.equal(unchanged.run.paid, null);
    const returned = await db.asUser(FINANCE, (svc, u) => svc.staffPayStep(u, run.id, 'return', { note: 'Recalculate contribution rates (synthetic)' }), clock);
    assert.equal(returned.stage, 'draft');
    const rebuilt = await prepare();
    assert.notEqual(rebuilt.lines[0].statutoryInputs, run.lines[0].statutoryInputs);
    await stage(rebuilt, 'coo_approved');
    await set(0.14, '2026-12'); // Future settings must not invalidate November.
    assert.equal((await pay(rebuilt)).stage, 'paid');
  });
});
