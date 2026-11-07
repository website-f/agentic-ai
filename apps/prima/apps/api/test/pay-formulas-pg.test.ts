// Pay formulas (Fauzan, 5 Nov 2026) on PostgreSQL: the optional module's ACT wall, no DELETE, the API through Db.asUser,
// and a database without the module (nothing shown, saving refused plainly). Throwaway local database, synthetic data.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { payFormulasModuleSql } from '../src/schema';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const ROOT = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../..' : '.');

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = [], app?: { walls: string; userId?: string }): Promise<{ rows: T[]; rowCount: number }> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (app) {
      await c.query('SET LOCAL ROLE prima_app');
      await c.query(`SELECT set_config('app.walls', $1, true), set_config('app.user_id', $2, true)`, [app.walls, app.userId ?? 'u-nobody']);
    }
    const r = await c.query(text, params);
    await c.query('COMMIT');
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

const proposal = JSON.parse(readFileSync(resolve(ROOT, 'db/proposed/pay-formulas-module.json'), 'utf8')) as {
  base: { sha256: string };
  modules: { id: string; path: string; sha256: string }[];
};
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'db/release-manifest.json'), 'utf8')) as { base: { sha256: string }; modules: { id: string }[] };

describe('pay formulas module (files)', () => {
  it('pins the module bytes on the release base and stays out of the release manifest', () => {
    assert.equal(proposal.base.sha256, manifest.base.sha256);
    const m = proposal.modules[0];
    assert.equal(createHash('sha256').update(readFileSync(resolve(ROOT, m.path))).digest('hex'), m.sha256);
    assert.ok(!manifest.modules.some((x) => x.id === m.id), 'proposed only');
    assert.equal(readFileSync(resolve(ROOT, m.path), 'utf8'), payFormulasModuleSql());
  });
});

describe('pay formulas (database)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('shows the formulas only through the ACT wall and never deletes them', async () => {
    for (const t of ['pay_formulas', 'pay_formula_uses']) {
      const none = await sql(`SELECT count(*)::int AS n FROM prima.${t}`, [], { walls: '' });
      assert.equal((none.rows[0] as { n: number }).n, 0, `${t} with no wall`);
      const other = await sql(`SELECT count(*)::int AS n FROM prima.${t}`, [], { walls: 'asset_read,pdpa,bcm,offboard' });
      assert.equal((other.rows[0] as { n: number }).n, 0, `${t} through another wall`);
      const act = await sql(`SELECT count(*)::int AS n FROM prima.${t}`, [], { walls: 'act' });
      assert.ok((act.rows[0] as { n: number }).n > 0, `${t} through the ACT wall`);
      await assert.rejects(sql(`DELETE FROM prima.${t}`, [], { walls: 'act' }), /permission denied/);
      await assert.rejects(sql(`INSERT INTO prima.${t} (id, data) VALUES ('x', '{"id":"x","kind":"guard_shift","status":"live","scope":"group"}')`, [], { walls: '' }), /row-level security/);
    }
  });

  it('keeps man-hours approvals behind the company wall, add-only', async () => {
    const none = await sql(`SELECT count(*)::int AS n FROM prima.site_hours_approvals`, [], { walls: 'act' });
    assert.equal((none.rows[0] as { n: number }).n, 0, 'no company visible, no rows');
    await assert.rejects(sql(`DELETE FROM prima.site_hours_approvals`, [], { walls: '' }), /permission denied/);
    await assert.rejects(sql(`UPDATE prima.site_hours_approvals SET data = data`, [], { walls: '' }), /permission denied/);
  });

  it('lets the Operations Director approve extra man-hours through the API; others are refused', async () => {
    const board = await db.asUser('u-opsdir', (svc, u) => svc.siteHoursBoard(u, { companyId: 'co-sasa' }));
    const site = board.rows.find((r) => r.sector === 'private')!;
    const input = { siteId: site.siteId, month: board.month, extraHours: 24, cause: 'training' as const, reason: 'UAT synthetic: guard on training' };
    await assert.rejects(db.asUser('u-ogm', (svc, u) => svc.approveSiteHours(u, input)), /Operations Director/);
    const row = await db.asUser('u-opsdir', (svc, u) => svc.approveSiteHours(u, input));
    assert.equal(row.approverTier, 'ops_director');
    const again = await db.asUser('u-opsdir', (svc, u) => svc.approveSiteHours(u, { ...input, extraHours: 12 }));
    assert.notEqual(again.id, row.id);
    const seen = await db.asUser('u-coo', async (svc, u) => (await svc.siteHoursBoard(u, { companyId: 'co-sasa' })).rows.find((r) => r.siteId === site.siteId)!);
    assert.ok(seen.check.approvedExtra >= 36);
    assert.equal(seen.canApprove, false);
  });

  it('lets the OGM set a public holiday list through the API; the COO cannot; versions keep the old list', async () => {
    const days = [
      ['01-01', "New Year's Day"], ['02-01', 'Federal Territory Day'], ['02-06', 'Chinese New Year (test)'], ['02-07', 'Chinese New Year 2 (test)'],
      ['03-10', 'Hari Raya (test)'], ['03-11', 'Hari Raya 2 (test)'], ['05-01', 'Labour Day'], ['06-07', "Agong's birthday (test)"],
      ['08-31', 'National Day'], ['09-16', 'Malaysia Day'], ['12-25', 'Christmas Day'],
    ].map(([md, label]) => ({ date: `2099-${md}`, label }));
    const input = { companyId: 'co-sasa', year: 2099, state: null, days, reason: 'UAT synthetic list' };
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.setPublicHolidays(u, input)), /Not allowed/);
    const v1 = await db.asUser('u-ogm', (svc, u) => svc.setPublicHolidays(u, input));
    const v2 = await db.asUser('u-ogm', (svc, u) => svc.setPublicHolidays(u, { ...input, reason: 'UAT synthetic change' }));
    assert.equal(v2.version, 2);
    const board = await db.asUser('u-pwvsb-hr', (svc, u) => svc.publicHolidayBoard(u, { companyId: 'co-sasa', year: 2099 }));
    assert.equal(board.company.list?.id, v2.id);
    assert.ok(board.history.some((l) => l.id === v1.id));
    await assert.rejects(sql(`DELETE FROM prima.public_holiday_lists`, [], { walls: '' }), /permission denied/);
  });

  it('lets only the CEO set the pay law settings through the API', async () => {
    const input = { effectiveFrom: '2099-01', settings: { ordinaryRateDivisor: 26, minimumWage: 2000 }, reason: 'UAT synthetic law change' };
    await assert.rejects(db.asUser('u-audit', (svc, u) => svc.savePayLaw(u, input)), /Not allowed/);
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.savePayLaw(u, input)), /Not allowed/);
    const v = await db.asUser('u-fauzan', (svc, u) => svc.savePayLaw(u, input));
    assert.equal(v.settings.minimumWage, 2000);
    const seen = await db.asUser('u-coo', async (svc, u) => (await svc.payFormulaBoard(u)).lawVersions.some((x) => x.id === v.id));
    assert.equal(seen, true);
    await assert.rejects(sql(`DELETE FROM prima.pay_law_versions`, [], { walls: 'act' }), /permission denied/);
  });

  it('lets the OM and above read formulas and the pay law for the salary calculator, read only', async () => {
    for (const t of ['pay_formulas', 'pay_formula_uses', 'pay_law_versions']) {
      const r = await sql(`SELECT count(*)::int AS n FROM prima.${t}`, [], { walls: 'pay_read' });
      const act = await sql(`SELECT count(*)::int AS n FROM prima.${t}`, [], { walls: 'act' });
      assert.equal((r.rows[0] as { n: number }).n, (act.rows[0] as { n: number }).n, `${t} read through pay_read`);
      await assert.rejects(sql(`INSERT INTO prima.${t} (id, data) VALUES ('x', '{"id":"x"}')`, [], { walls: 'pay_read' }), /row-level security|violates check/);
      const upd = await sql(`UPDATE prima.${t} SET data = data`, [], { walls: 'pay_read' });
      assert.equal(upd.rowCount, 0, `${t} not changed through pay_read`);
    }
    for (const id of ['u-om-klang', 'u-ogm', 'u-opsdir']) {
      const d = await db.asUser(id, (svc, u) => svc.salaryCalcData(u));
      assert.equal(d.ready, true);
      assert.ok(d.formulas.some((f) => f.code === 'STD-12H-R2'), `${id} sees the live guard formulas`);
      assert.equal(d.law.ordinaryRateDivisor, 26);
      await assert.rejects(db.asUser(id, (svc, u) => svc.payFormulaBoard(u)), /Not allowed/);
    }
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.savePayLaw(u, { effectiveFrom: '2099-02', settings: {}, reason: 'UAT try' })), /Not allowed/);
  });

  it('lets the ACT Director set a formula through the API and keeps leaders read-only', async () => {
    const row = (await db.asUser('u-audit', (svc, u) =>
      svc.savePayFormula(u, {
        code: null,
        kind: 'driver_ot',
        name: 'UAT driver overtime',
        effectiveFrom: '2099-01',
        amounts: { basicMonthly: 1700, normalHoursPerDay: 8, workDaysPerWeek: 5.5, otNormalRate: 1.5, otRestDayRate: 2, otPublicHolidayRate: 3, restDayDays: 1, publicHolidayDays: 2, fixedAllowances: [] },
        reason: 'UAT synthetic',
      }),
    )) as { id: string; status: string };
    assert.equal(row.status, 'live');
    const seen = await db.asUser('u-coo', async (svc, u) => (await svc.payFormulaBoard(u)).formulas.some((r) => r.formula.id === row.id));
    assert.equal(seen, true);
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.decidePayFormula(u, row.id, true, 'UAT try')), /ACT Director/);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.payFormulaBoard(u)), /Not allowed/);
  });

  it('shows nothing and refuses saving plainly before the module is installed', async () => {
    await sql('DROP TABLE prima.pay_law_versions; DROP TABLE prima.public_holiday_lists; DROP TABLE prima.site_hours_approvals; DROP TABLE prima.pay_formula_uses; DROP TABLE prima.pay_formulas;');
    const fresh = new Db();
    try {
      const board = await fresh.asUser('u-audit', (svc, u) => svc.payFormulaBoard(u));
      assert.equal(board.ready, false);
      assert.equal(board.formulas.length, 0);
      await assert.rejects(
        fresh.asUser('u-audit', (svc, u) => svc.setPayFormulaUse(u, { kind: 'guard_shift', scope: 'group', formulaCode: 'STD-12H-R2', effectiveFrom: '2099-01', reason: 'UAT try' })),
        /not switched on/,
      );
      const hours = await fresh.asUser('u-opsdir', (svc, u) => svc.siteHoursBoard(u, { companyId: 'co-sasa' }));
      assert.equal(hours.ready, false);
      assert.ok(hours.rows.length > 0, 'hours still counted from shifts and attendance');
      await assert.rejects(
        fresh.asUser('u-opsdir', (svc, u) => svc.approveSiteHours(u, { siteId: hours.rows[0].siteId, month: hours.month, extraHours: 1, cause: 'other', reason: 'UAT try' })),
        /not switched on/,
      );
    } finally {
      await fresh.onModuleDestroy();
      // Put the module back so later suites in this run see the database they expect.
      await sql(payFormulasModuleSql());
    }
  });
});
