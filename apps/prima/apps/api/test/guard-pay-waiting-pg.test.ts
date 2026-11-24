// Fauzan, 15 Nov 2026 ("Only that guard's pay waits"): a guard whose absence waits for the OD/OGM decision is kept out of
// the company's month; the month is submitted, approved and paid for everyone else; once decided, the guard is paid in
// a later run of the same month, never twice. Actual PostgreSQL (company walls, locks, the guard pay module), synthetic
// data, no external payment. The line-level waiting state itself is covered by the core guard-pay tests; here one
// line is marked waiting at the line builder so the run flow is exercised end to end on the database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PrimaService, RULES, generateDataset, myt, type GuardPayLine, type GuardPayRun } from '@prima/core';
import { preparePayout } from './payout-helper';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-05', '10:00');
const clock = () => NOW;
const WHY = 'Absence on 2026-10-06 waits for the OD/OGM decision (paid or unpaid): this guard is paid in a later run once it is decided.';

describe('guard pay: only the undecided guard waits (actual PostgreSQL)', () => {
  let db: Db;
  let waitingFor: string | null = null;
  type Lines = (this: PrimaService, ...a: unknown[]) => Promise<GuardPayLine[]>;
  const proto = PrimaService.prototype as unknown as { guardPayLines: Lines };
  const real = proto.guardPayLines;

  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    RULES.guardPayroll.value.primaPays = true;
    // The same closed-month synthetic attendance as the payroll repair tests (October fully worked and locked).
    const history = generateDataset({ today: '2026-11-05', now: NOW, daysBack: 40 });
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
    await db.pool.query(`DELETE FROM prima.pay_formula_uses WHERE data->>'scope' = 'site'`).catch(() => undefined);
    await db.pool.query(`INSERT INTO prima.pay_formula_uses (id, data) SELECT value->>'id', value FROM jsonb_array_elements($1::jsonb) ON CONFLICT (id) DO UPDATE SET data = excluded.data`, [JSON.stringify(history.payFormulaUses)]);
    await db.pool.query(`UPDATE prima.people SET data = jsonb_set(data, '{bank}', '{"bank":"Synthetic","accountMasked":"****9999"}'::jsonb) WHERE data->'bank' IS NULL OR data->'bank' = 'null'::jsonb`);
    // The chosen guard's absence is undecided while waitingFor names them.
    proto.guardPayLines = async function (this: PrimaService, ...a: unknown[]) {
      const lines = await real.apply(this, a);
      return lines.map((l) => (l.personId === waitingFor ? { ...l, waiting: [WHY] } : l));
    };
  });
  after(async () => {
    proto.guardPayLines = real;
    RULES.guardPayroll.value.primaPays = false;
    if (db) await db.onModuleDestroy();
  });

  const hr = <R>(fn: (svc: PrimaService, u: Parameters<Parameters<Db['asUser']>[1]>[1]) => Promise<R>) => db.asUser('u-pwvsb-hr', fn, clock);
  const step = (who: string, id: string, action: 'submit' | 'approve' | 'pay', body: Record<string, unknown> = {}) =>
    db.asUser(who, (svc, u) => svc.guardPayStep(u, id, action, body), clock);
  const payAll = async (run: GuardPayRun) => {
    await step('u-pwvsb-hr', run.id, 'submit');
    await step('u-coo', run.id, 'approve', { note: 'Synthetic approval' });
    await preparePayout(db, 'guard_pay', run.id, clock);
    return step('u-fd', run.id, 'pay', { bankRef: 'NO-TRANSFER', paidOn: '2026-11-05', pcbChecked: true });
  };

  let main: GuardPayRun;
  let held = '';

  it('keeps only the undecided guard out; the company month is submitted, approved and paid for everyone else', async () => {
    const first = await hr((svc, u) => svc.prepareGuardPay(u, 'co-arsh', '2026-10'));
    const pick = first.lines.find((l) => l.gross > 1000)!;
    assert.ok(pick);
    held = pick.personId;
    waitingFor = held;
    main = await hr((svc, u) => svc.prepareGuardPay(u, 'co-arsh', '2026-10'));
    assert.equal(main.lines.length, first.lines.length - 1);
    assert.ok(!main.lines.some((l) => l.personId === held), 'the waiting guard is not in the month');
    assert.deepEqual(main.waiting?.map((l) => l.personId), [held]);
    // Nothing decided yet: no later run.
    await assert.rejects(hr((svc, u) => svc.prepareGuardPayLater(u, main.id)), /still a draft/);
    const paid = await payAll(main);
    assert.equal(paid.stage, 'paid');
    const view = await hr((svc, u) => svc.guardPayRun(u, main.id));
    assert.deepEqual(view.waiting.map((w) => w.personId), [held]);
    assert.equal(view.can.prepareLater, true);
    const bank = await db.asUser('u-fin-t1-lead', (svc, u) => svc.guardPayExport(u, main.id, 'bank'), clock);
    assert.ok(!bank.body.includes(pick.staffNo), 'the bank file of the month leaves the waiting guard out');
    await assert.rejects(hr((svc, u) => svc.prepareGuardPayLater(u, main.id)), /has not decided the absence/);
  });

  it('pays the guard in a later run once decided, through the same steps, and never twice', async () => {
    waitingFor = null;
    const later = await hr((svc, u) => svc.prepareGuardPayLater(u, main.id));
    assert.equal(later.laterOf, main.id);
    assert.equal(later.period, '2026-10');
    assert.deepEqual(later.lines.map((l) => l.personId), [held]);
    // A COO who did not prepare it approves; Finance pays; the bank file holds only that guard.
    await step('u-pwvsb-hr', later.id, 'submit');
    await step('u-coo', later.id, 'approve', { note: 'Absence decided, synthetic approval' });
    const bank = await db.asUser('u-fin-t1-lead', (svc, u) => svc.guardPayExport(u, later.id, 'bank'), clock);
    assert.equal(bank.body.split('\n').filter((r) => r.includes('WAGES 2026-10')).length, 1);
    await preparePayout(db, 'guard_pay', later.id, clock);
    const paid = await step('u-fd', later.id, 'pay', { bankRef: 'NO-TRANSFER-2', paidOn: '2026-11-05', pcbChecked: true });
    assert.equal(paid.stage, 'paid');
    // Nobody is left to pay: a second later run is refused, and the guard is in exactly one run of the month.
    await assert.rejects(hr((svc, u) => svc.prepareGuardPayLater(u, main.id)), /No guard of this month is waiting/);
    const rows = await db.pool.query(`SELECT data FROM prima.guard_pay_runs WHERE company_id = 'co-arsh' AND data->>'period' = '2026-10'`);
    const runs = rows.rows.map((r) => r.data as GuardPayRun);
    assert.equal(runs.length, 2);
    assert.equal(runs.flatMap((r) => r.lines).filter((l) => l.personId === held).length, 1);
    const view = await hr((svc, u) => svc.guardPayRun(u, main.id));
    assert.equal(view.waiting.length, 0);
    assert.equal(view.can.prepareLater, false);
    assert.deepEqual(view.laterRuns.map((r) => r.stage), ['paid']);
    // The later run is behind the company wall like any month.
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.guardPayRun(u, later.id), clock), /not found|not allowed/i);
  });

  it('a returned and recalculated month never takes back a guard already in a later run', async () => {
    // Bypass to put the main month back to draft (as a return would before payment); its recalculation leaves the
    // guard paid in the later run out.
    await db.pool.query(`UPDATE prima.guard_pay_runs SET data = data || '{"stage":"draft","paid":null,"approved":null,"submitted":null}'::jsonb WHERE id = $1`, [main.id]);
    const again = await hr((svc, u) => svc.prepareGuardPay(u, 'co-arsh', '2026-10'));
    assert.ok(!again.lines.some((l) => l.personId === held));
    assert.equal(again.waiting?.length ?? 0, 0);
  });
});
