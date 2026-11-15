// B1 (Fauzan, 11 Nov 2026) on PostgreSQL: before the proposed module is installed HR keeps preparing guard pay; once
// installed (here only, on the throwaway test database) the Company Manager names a company executive with a reason,
// that person prepares, HR is refused, the naming is behind the company wall and cannot be changed in place.
// Synthetic data only; the test resets the throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const lastMonth = () => {
  const d = new Date(Date.now() + 8 * 3_600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

describe('guard pay preparers on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('not installed: HR still prepares, and naming says not installed', async () => {
    const run = await db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', lastMonth(), []));
    assert.ok(run.id);
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.setGuardPayPreparers(u, 'co-arsh', { userIds: ['u-ae-arsh'], reason: 'Admin executive runs pay.' })), /not installed/);
  });

  it('installed: the Company Manager names, that executive prepares, HR is refused, the wall holds', async () => {
    const moduleSql = readFileSync(resolve(__dirname, '../../../../db/modules/guard-pay-preparers-v1.sql'), 'utf8');
    await owner.query(moduleSql);
    await owner.query(moduleSql); // repeat-safe
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', lastMonth(), [])), /named/);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.setGuardPayPreparers(u, 'co-arsh', { userIds: ['u-ae-arsh'], reason: 'HR tries.' })));
    await db.asUser('u-cm-arsh', (svc, u) => svc.setGuardPayPreparers(u, 'co-arsh', { userIds: ['u-ae-arsh'], reason: 'Admin executive runs pay.' }));
    const run = await db.asUser('u-ae-arsh', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', lastMonth(), []));
    assert.equal(run.prepared.byId, 'u-ae-arsh');
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', lastMonth(), [])), /named/);
    const board = await db.asUser('u-cm-arsh', (svc, u) => svc.guardPayroll(u));
    const row = board.employers.find((e) => e.companyId === 'co-arsh')!;
    assert.deepEqual(row.preparers?.userIds, ['u-ae-arsh']);
    assert.ok(row.canNamePreparers);
    // Another company's manager does not see Arrow Shield's naming; nobody can change a row in place.
    const seen = await db.asUser('u-cm-sasa', (_svc, _u, store) => store.list('guardPayPreparers'));
    assert.equal(seen.some((r) => r.companyId === 'co-arsh'), false);
    const grants = await owner.query("SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='prima' AND table_name='guard_pay_preparers' AND grantee='prima_app' ORDER BY 1");
    assert.deepEqual(grants.rows.map((r) => r.privilege_type), ['INSERT', 'SELECT']);
  });
});
