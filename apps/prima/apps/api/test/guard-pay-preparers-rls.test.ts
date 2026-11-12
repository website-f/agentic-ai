// P100 B1 (Fauzan, 11 Nov 2026: "each Company Manager monitors the pay run and delegates the preparing to whoever they
// choose in their company"): the guard pay preparer list in the database itself. The repeat-safe office module, forced
// row-level security, only the company's own manager writes a row (with a reason), and a colleague, an OM or another
// company's manager never reads one. Then the pay run through the API: the named preparer prepares, HR is refused.
// Throwaway local database, synthetic data only.
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
const SQL = readFileSync(resolve(__dirname, '../../../../db/modules/guard-pay-preparers-v1.sql'), 'utf8');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

/** A raw statement as the runtime role, as a given sign-in (the wall the database itself keeps). */
async function asApp(sql: string, params: unknown[], userId: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', 'co-sasa,co-arsh,co-inas', true), set_config('app.user_id', $1, true), set_config('app.group_user', 'on', true)`, [userId]);
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

const row = (companyId: string, userId: string, byId: string, reason = 'Prepares the monthly guard pay (test)') => {
  const id = `gpp-${companyId}-${userId}`;
  return [id, companyId, JSON.stringify({ id, companyId, userId, userName: 'Test', title: '', active: true, named: { by: 'Test', byId, at: '2026-11-11T09:00:00+08:00', reason }, removed: null, history: [] })];
};
const INSERT = 'INSERT INTO prima.guard_pay_preparers (id, company_id, data) VALUES ($1, $2, $3::jsonb)';

describe('guard pay preparers (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    await admin(SQL);
    // Repeat-safe: the office's prima-setup runs it on every start.
    await admin(SQL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('installs one table with forced row-level security and no delete for the runtime role', async () => {
    const r = await admin(`SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'guard_pay_preparers'`);
    assert.deepEqual(r.rows, [{ relrowsecurity: true, relforcerowsecurity: true, del: false }]);
  });

  it('lets only the company manager write a row, with a reason, and never a self-naming', async () => {
    // Refused: HR, an OM, another company's manager, the person themself, an admin executive.
    for (const who of ['u-pwvsb-hr', 'u-om-klang', 'u-cm-arsh', 'u-ae-sasa', 'u-ae-sasa-2'])
      await assert.rejects(asApp(INSERT, row('co-sasa', 'u-ae-sasa-2', who), who), /row-level security/, who);
    // No reason, or naming themself: the row's own check.
    await assert.rejects(asApp(INSERT, row('co-sasa', 'u-ae-sasa-2', 'u-cm-sasa', 'ok'), 'u-cm-sasa'), /gpp_shape/);
    await assert.rejects(asApp(INSERT, row('co-sasa', 'u-cm-sasa', 'u-cm-sasa'), 'u-cm-sasa'), /gpp_shape/);
    // A row claiming someone else named it.
    await assert.rejects(asApp(INSERT, row('co-sasa', 'u-ae-sasa-2', 'u-gm-sasa'), 'u-cm-sasa'), /row-level security/);
    await asApp(INSERT, row('co-sasa', 'u-ae-sasa-2', 'u-cm-sasa'), 'u-cm-sasa');
    await assert.rejects(asApp('DELETE FROM prima.guard_pay_preparers', [], 'u-cm-sasa'), /permission denied/);
  });

  it('is read by the company managers, the person named, HR and leadership; never by a colleague, an OM or another company', async () => {
    const count = async (who: string) => Number((await asApp(`SELECT count(*)::int AS n FROM prima.guard_pay_preparers WHERE company_id = 'co-sasa'`, [], who)).rows[0].n);
    for (const who of ['u-cm-sasa', 'u-gm-sasa', 'u-ae-sasa-2', 'u-pwvsb-hr', 'u-coo', 'u-fauzan']) assert.equal(await count(who), 1, who);
    for (const who of ['u-ae-sasa-3', 'u-om-klang', 'u-cm-arsh', 'u-ae-arsh', 'u-guard-sasa-1']) assert.equal(await count(who), 0, who);
  });

  it('runs through the API: the manager names, the preparer prepares, HR and an OM are refused', async () => {
    const period = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.payAction(u, 'guard-pay-preparer', { companyId: 'co-arsh', userId: 'u-ae-arsh', action: 'name', reason: 'Test naming' })), /Not allowed/);
    await db.asUser('u-cm-arsh', (svc, u) => svc.payAction(u, 'guard-pay-preparer', { companyId: 'co-arsh', userId: 'u-ae-arsh', action: 'name', reason: 'Keeps the office records (test)' }));
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', period, [])), /Not allowed/);
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', period, [])), /Not allowed/);
    const run = (await db.asUser('u-ae-arsh', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', period, []))) as { id: string; prepared: { byId: string } };
    assert.equal(run.prepared.byId, 'u-ae-arsh');
    const board = await db.asUser('u-cm-arsh', (svc, u) => svc.guardPayroll(u));
    assert.ok(board.runs.some((r) => r.id === run.id), 'the company manager sees the run');
    assert.equal(board.preparers.find((c) => c.companyId === 'co-arsh')?.preparers.filter((p) => p.active).length, 1);
    // Removed with a reason: no longer prepares.
    await db.asUser('u-cm-arsh', (svc, u) => svc.payAction(u, 'guard-pay-preparer', { companyId: 'co-arsh', userId: 'u-ae-arsh', action: 'remove', reason: 'Moved to another desk (test)' }));
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', period, [])), /Not allowed/);
  });
});
