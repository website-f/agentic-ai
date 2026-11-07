import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

// Allowances HR sets, on PostgreSQL (synthetic data; Fauzan, 3 Nov 2026).
describe('allowances under PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('HR adds a type and sets a staff allowance; the change waits on PostgreSQL and the record is unchanged', async () => {
    const personId = await db.asUser('u-it-ex2', async (_svc, u) => u.personId!);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.saveAllowanceType(u, { name: 'Shift (synthetic)', frequency: 'monthly', usualAmount: null, cap: 400, epf: true, socso: true, pcb: true, hrd: true, basis: 'Synthetic basis', active: true, note: '' })));
    const t = await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.saveAllowanceType(u, { name: 'Shift (synthetic)', frequency: 'monthly', usualAmount: null, cap: 400, epf: true, socso: true, pcb: true, hrd: true, basis: 'Synthetic basis', active: true, note: '' }),
    );
    assert.equal((await admin(`SELECT 1 FROM prima.allowance_types WHERE id = $1`, [t.id])).length, 1);
    const before = (await admin<{ data: { allowances?: unknown } }>(`SELECT data FROM prima.people WHERE id = $1`, [personId]))[0].data.allowances ?? null;
    const c = await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.requestAllowanceChange(u, personId, { allowances: [{ typeId: t.id, amount: 300 }], effectiveOn: '2026-12-01', reason: 'New shift post (synthetic)' }),
    );
    await assert.rejects(db.asUser('u-it-ex2', (svc, u) => svc.decidePayChange(u, c.id, true, 'Saya setuju (synthetic)')));
    // The Vice Chairman's consent (the CEO in the pilot) cannot come before the HR Director's check; the full chain is in
    // core hr-allowances.test.ts with a synthetic Chief of Staff and Vice Chairman.
    await assert.rejects(db.asUser('u-fauzan', (svc, u) => svc.decidePayChange(u, c.id, true, 'Setuju (synthetic)')));
    const [row] = await admin<{ data: { kind: string; status: string; allowancesTo: { typeId: string; amount: number }[] } }>(`SELECT data FROM prima.pay_changes WHERE id = $1`, [c.id]);
    assert.deepEqual([row.data.kind, row.data.status, row.data.allowancesTo[0].amount], ['ALLOWANCE', 'pending', 300]);
    const now = (await admin<{ data: { allowances?: unknown } }>(`SELECT data FROM prima.people WHERE id = $1`, [personId]))[0].data.allowances ?? null;
    assert.deepEqual(now, before);
  });

  it('a change consented for a later date waits on PostgreSQL: the record keeps its allowances until applied on the day', async () => {
    const personId = await db.asUser('u-it-ex3', async (_svc, u) => u.personId!);
    const before = (await admin<{ data: { allowances?: unknown } }>(`SELECT data FROM prima.people WHERE id = $1`, [personId]))[0].data.allowances ?? null;
    const c = await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.requestAllowanceChange(u, personId, { allowances: [{ typeId: 'alw-phone', amount: 80 }], effectiveOn: '2099-01-01', reason: 'Future post (synthetic)' }),
    );
    // The seed's Chief of Staff verifies; the CEO consents for the Vice Chairman (pilot).
    await db.asUser('u-cos', (svc, u) => svc.decidePayChange(u, c.id, true, 'Semak (synthetic)'));
    const done = await db.asUser('u-fauzan', (svc, u) => svc.decidePayChange(u, c.id, true, 'Setuju (synthetic)'));
    assert.deepEqual([done.status, done.applied], ['verified', null]);
    const now = (await admin<{ data: { allowances?: unknown } }>(`SELECT data FROM prima.people WHERE id = $1`, [personId]))[0].data.allowances ?? null;
    assert.deepEqual(now, before);
    const r = await db.asUser('u-pwvsb-hr', (svc, u) => svc.applyDueStaffMovements(u));
    assert.ok(!r.applied.includes(c.id));
    await assert.rejects(
      db.asUser('u-pwvsb-hr', (svc, u) => svc.requestAllowanceChange(u, personId, { allowances: [{ typeId: 'alw-phone', amount: 70 }], effectiveOn: '2099-02-01', reason: 'Again (synthetic)' })),
      /already waiting/,
    );
  });

  it('a consent after the start date waits on PostgreSQL while that payroll month is submitted, and impossible dates are refused', async () => {
    const personId = await db.asUser('u-it-ex4', async (_svc, u) => u.personId!);
    const [{ company_id: companyId }] = await admin<{ company_id: string }>(`SELECT company_id FROM prima.people WHERE id = $1`, [personId]);
    const month = nowMyt().slice(0, 7);
    await admin(`UPDATE prima.staff_pay_runs SET data = jsonb_set(data, '{stage}', '"submitted"') WHERE company_id = $1 AND data->>'period' = $2`, [companyId, month]);
    await assert.rejects(
      db.asUser('u-pwvsb-hr', (svc, u) => svc.requestAllowanceChange(u, personId, { allowances: [{ typeId: 'alw-phone', amount: 55 }], effectiveOn: `${month}-32`, reason: 'Bad date (synthetic)' })),
      /real date/,
    );
    const before = (await admin<{ data: { allowances?: unknown } }>(`SELECT data FROM prima.people WHERE id = $1`, [personId]))[0].data.allowances ?? null;
    const c = await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.requestAllowanceChange(u, personId, { allowances: [{ typeId: 'alw-phone', amount: 55 }], effectiveOn: `${month}-01`, reason: 'Late consent (synthetic)' }),
    );
    await db.asUser('u-cos', (svc, u) => svc.decidePayChange(u, c.id, true, 'Semak (synthetic)'));
    const done = await db.asUser('u-fauzan', (svc, u) => svc.decidePayChange(u, c.id, true, 'Setuju (synthetic)'));
    assert.equal(done.applied, null);
    assert.match(done.note ?? '', /already submitted/);
    const now = (await admin<{ data: { allowances?: unknown } }>(`SELECT data FROM prima.people WHERE id = $1`, [personId]))[0].data.allowances ?? null;
    assert.deepEqual(now, before);
  });

  it('submission and a same-month consent racing on PostgreSQL never leave a submitted month with unpaid new allowances', async () => {
    const personId = await db.asUser('u-it-ex1', async (_svc, u) => u.personId!);
    const [{ company_id: companyId }] = await admin<{ company_id: string }>(`SELECT company_id FROM prima.people WHERE id = $1`, [personId]);
    const month = nowMyt().slice(0, 7);
    await admin(`UPDATE prima.staff_pay_runs SET data = jsonb_set(data, '{stage}', '"draft"') WHERE company_id = $1 AND data->>'period' = $2`, [companyId, month]);
    await admin(
      `UPDATE prima.people SET data = jsonb_set(data, '{bank}', '{"bank":"Test Bank","accountMasked":"****0000"}') WHERE company_id = $1 AND data->>'role' = 'office' AND (data->'bank' IS NULL OR data->'bank' = 'null'::jsonb)`,
      [companyId],
    );
    // The earlier test's change waited while the month was submitted; with the month back with HR it is applied now.
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.applyDueStaffMovements(u));
    const run = await db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareStaffPay(u, companyId, month));
    const blockers = (await db.asUser('u-pwvsb-hr', (svc, u) => svc.staffPayRun(u, run.id))).blockers;
    assert.deepEqual(blockers, []);
    const c = await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.requestAllowanceChange(u, personId, { allowances: [{ typeId: 'alw-phone', amount: 66 }], effectiveOn: `${month}-01`, reason: 'Race (synthetic)' }),
    );
    await db.asUser('u-cos', (svc, u) => svc.decidePayChange(u, c.id, true, 'Semak (synthetic)'));
    const [submit, consent] = await Promise.allSettled([
      db.asUser('u-pwvsb-hr', (svc, u) => svc.staffPayStep(u, run.id, 'submit', { note: 'Hantar (synthetic)' })),
      db.asUser('u-fauzan', (svc, u) => svc.decidePayChange(u, c.id, true, 'Setuju (synthetic)')),
    ]);
    assert.equal(consent.status, 'fulfilled');
    const stage = (await admin<{ data: { stage: string } }>(`SELECT data FROM prima.staff_pay_runs WHERE id = $1`, [run.id]))[0].data.stage;
    const change = (await admin<{ data: { applied: unknown } }>(`SELECT data FROM prima.pay_changes WHERE id = $1`, [c.id]))[0].data;
    const amounts = ((await admin<{ data: { allowances?: { amount: number }[] } }>(`SELECT data FROM prima.people WHERE id = $1`, [personId]))[0].data.allowances ?? []).map((a) => a.amount);
    if (submit.status === 'fulfilled') {
      // Submitted first: the consent saw the submitted month under the lock and waits; the record is unchanged.
      assert.equal(stage, 'submitted');
      assert.equal(change.applied, null);
      assert.ok(!amounts.includes(66));
    } else {
      // Consented first: the submission rechecked under the lock and found the draft stale.
      assert.equal(stage, 'draft');
      assert.match(String(submit.reason?.message ?? submit.reason), /changed|Recalculate/);
      assert.ok(amounts.includes(66));
    }
  });
});
