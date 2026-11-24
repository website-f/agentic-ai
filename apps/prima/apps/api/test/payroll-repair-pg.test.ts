// Actual PostgreSQL transactions and company walls, with synthetic data and no external payment.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { RULES, generateDataset, myt, type GuardPayRun } from '@prima/core';
import { preparePayout } from './payout-helper';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55438/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-05', '10:00');
const clock = () => NOW;

describe('payroll repair release gates (actual PostgreSQL)', () => {
  let db: Db;
  beforeEach(async () => {
    if (db) await db.onModuleDestroy();
    await resetDb(URL, NOW);
    db = new Db();
    RULES.guardPayroll.value.primaPays = true;
    // resetDb's default roster history does not reach October; add explicit synthetic closed-month
    // attendance rather than weakening the payroll's empty/negative-line checks for the fixture.
    const history = generateDataset({ today: '2026-11-05', now: NOW, daysBack: 40 });
    // B1b: hours paid must match hours recorded. Put each synthetic shift on its shift times, and a guard's odd-length
    // shifts at the guard's usual length, so these release-gate tests are not held by the hours check.
    const shiftById = new Map(history.shifts.map((s) => [s.id, s]));
    const len = (s: { start: string; end: string }) => Date.parse(s.end) - Date.parse(s.start);
    const usual = new Map<string, number>();
    for (const pid of new Set(history.attendance.map((a) => a.personId))) {
      const c = new Map<number, number>();
      for (const a of history.attendance) if (a.personId === pid && a.shiftId && shiftById.get(a.shiftId)) c.set(len(shiftById.get(a.shiftId)!), (c.get(len(shiftById.get(a.shiftId)!)) ?? 0) + 1);
      const top = [...c.entries()].sort((x, y) => y[1] - x[1])[0];
      if (top) usual.set(pid, top[0]);
    }
    for (const a of history.attendance) {
      const sh = a.shiftId ? shiftById.get(a.shiftId) : undefined;
      if (!sh || !a.clockIn || !a.clockOut) continue;
      const want = usual.get(a.personId) ?? len(sh);
      if (len(sh) !== want) Object.assign(a, { shiftId: null, clockIn: sh.start, clockOut: new Date(Date.parse(sh.start) + want).toISOString() });
      else Object.assign(a, { clockIn: sh.start, clockOut: sh.end });
    }
    for (const table of ['shifts', 'attendance'] as const) {
      await db.pool.query(`DELETE FROM prima.${table} WHERE company_id = 'co-arsh'`);
      const rows = history[table].filter((row) => row.companyId === 'co-arsh');
      await db.pool.query(`INSERT INTO prima.${table} (id, company_id, data)
        SELECT value->>'id', value->>'companyId', value FROM jsonb_array_elements($1::jsonb)
        ON CONFLICT (id) DO UPDATE SET data = excluded.data`, [JSON.stringify(rows)]);
    }
    // The site formulas that go with these shifts (8-hour and office-hours sites, B1b).
    await db.pool.query(`DELETE FROM prima.pay_formula_uses WHERE data->>'scope' = 'site'`).catch(() => undefined);
    await db.pool.query(`INSERT INTO prima.pay_formula_uses (id, data) SELECT value->>'id', value FROM jsonb_array_elements($1::jsonb) ON CONFLICT (id) DO UPDATE SET data = excluded.data`, [JSON.stringify(history.payFormulaUses)]);
    await db.pool.query(`UPDATE prima.people SET data = jsonb_set(data, '{bank}', '{"bank":"Synthetic","accountMasked":"****9999"}'::jsonb) WHERE data->'bank' IS NULL OR data->'bank' = 'null'::jsonb`);
  });
  after(async () => { RULES.guardPayroll.value.primaPays = false; if (db) await db.onModuleDestroy(); });
  const prepare = () => db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', '2026-10'), clock);
  const submit = (run: GuardPayRun) => db.asUser('u-pwvsb-hr', (svc, u) => svc.guardPayStep(u, run.id, 'submit'), clock);
  const approve = (run: GuardPayRun) => db.asUser('u-coo', (svc, u) => svc.guardPayStep(u, run.id, 'approve', { note: 'Synthetic approval' }), clock);
  const save = (run: GuardPayRun) => {
    const { id, companyId: _companyId, ...patch } = run;
    return db.asUser('u-pwvsb-hr', (_svc, _u, store) => store.update('guardPayRuns', id, patch), clock);
  };

  for (const kind of ['cap', 'missing-formula', 'leave', 'legacy'] as const) {
    it(`refuses ${kind} snapshots at every release boundary and rolls back`, async () => {
      const run = await prepare();
      const line = run.lines.find((l) => l.gross > 1000)!;
      assert.ok(line);
      const expected = kind === 'cap' ? /50%/ : kind === 'missing-formula' ? /no pay formula/ : kind === 'leave' ? /dates are unclear/ : /recalculate/;
      if (kind === 'cap') line.otherDeductions = line.gross * 0.6;
      if (kind === 'missing-formula') line.missingFormulaSites = ['synthetic-secondary-site'];
      if (kind === 'leave') line.holds = ['Leave dates are unclear'];
      if (kind === 'legacy') delete line.calculationVersion;
      await save(run);
      await assert.rejects(submit(run), expected);
      run.stage = 'submitted'; await save(run);
      await assert.rejects(approve(run), expected);
      run.stage = 'approved'; await save(run);
      await assert.rejects(db.asUser('u-fin-t1-lead', (svc, u) => svc.guardPayStep(u, run.id, 'pay', { bankRef: 'NO-TRANSFER', paidOn: '2026-11-05', pcbChecked: true }), clock), expected);
      await assert.rejects(db.asUser('u-fin-t1-lead', (svc, u) => svc.guardPayExport(u, run.id, 'bank'), clock), expected);
      const stored = await db.asUser('u-pwvsb-hr', (svc, u) => svc.guardPayRun(u, run.id), clock);
      assert.equal(stored.run.stage, 'approved'); assert.equal(stored.run.paid, null);
      const audit = await db.pool.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'entityId'=$1 AND data->>'action' IN ('guardpay.submit','guardpay.approve','guardpay.pay')`, [run.id]);
      assert.equal(audit.rows[0].n, 0);
    });
  }

  async function approvedAdvance() {
    const at = () => myt('2026-10-19', '10:00');
    const board = await db.asUser('u-om-klang', (svc, u) => svc.guardAdvances(u, { companyId: 'co-arsh' }), at);
    const personId = board.choices.guards[0].id;
    await db.asUser('u-om-klang', (svc, u) => svc.setGuardAdvances(u, { companyId: 'co-arsh', period: '2026-10', basis: 'guard', ref: personId, amount: 100, payOn: '2026-10-20', reason: 'Synthetic advance' }), at);
    const a = (await db.asUser('u-om-klang', (svc, u) => svc.guardAdvances(u, { companyId: 'co-arsh', period: '2026-10' }), at)).advances.find((a) => a.personId === personId)!;
    await db.asUser(a.approverTier === 'ogm' ? 'u-ogm' : 'u-opsdir', (svc, u) => svc.approveGuardAdvances(u, [a.id], 'Synthetic approval'), at);
    return a;
  }

  it('recovers only a paid advance and rejects stale stored IDs and totals until recalculated', async () => {
    const advance = await approvedAdvance();
    const run = await prepare();
    assert.equal(run.lines.find((l) => l.personId === advance.personId)?.advance, 0);
    await preparePayout(db, 'guard_advance', advance.id, clock);
    await db.asUser('u-fd', (svc, u) => svc.payGuardAdvance(u, advance.id, { bankRef: 'NO-TRANSFER', paidOn: '2026-10-20' }), clock);
    await assert.rejects(submit(run), /Paid advances have changed/);
    const fresh = await prepare();
    assert.equal(fresh.lines.find((l) => l.personId === advance.personId)?.advance, 100);
    await submit(fresh); await approve(fresh);
    await preparePayout(db, 'guard_pay', fresh.id, clock);
    const paid = await db.asUser('u-fd', (svc, u) => svc.guardPayStep(u, fresh.id, 'pay', { bankRef: 'NO-TRANSFER', paidOn: '2026-11-05', pcbChecked: true }), clock);
    assert.equal(paid.stage, 'paid');
    assert.equal(paid.lines.find((l) => l.personId === advance.personId)?.advance, 100);
  });

  it('serializes advance payout with monthly submission on the same PostgreSQL lock', async () => {
    const advance = await approvedAdvance();
    const run = await prepare();
    let locked!: () => void, release!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const submitting = db.asUser('u-pwvsb-hr', async (svc, u, store) => {
      await store.lock!('guardPayRuns', run.id); locked(); await released;
      return svc.guardPayStep(u, run.id, 'submit');
    }, clock);
    await acquired;
    let payoutSettled = false;
    const payout = db.asUser('u-fin-t1-lead', (svc, u) => svc.payGuardAdvance(u, advance.id, { bankRef: 'NO-TRANSFER', paidOn: '2026-10-20' }), clock)
      .then(() => ({ error: null as unknown }), (error: unknown) => ({ error })).finally(() => { payoutSettled = true; });
    try { await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(payoutSettled, false); }
    finally { release(); }
    assert.equal((await submitting).stage, 'submitted');
    assert.match(String((await payout).error), /already submitted or paid/);
    const after = await db.asUser('u-om-klang', (svc, u) => svc.guardAdvances(u, { companyId: 'co-arsh', period: '2026-10' }), clock);
    assert.equal(after.advances.find((a) => a.id === advance.id)?.status, 'approved');
    assert.equal(after.advances.find((a) => a.id === advance.id)?.paid, null);
  });
});
