// Guard pay run (Fauzan, 5 Nov 2026) on PostgreSQL: the optional module's company wall, no DELETE, a trial never paid,
// the API through Db.asUser, and a database without the module (nothing shown, preparing refused plainly).
// Throwaway local database, synthetic data.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { guardPayModuleSql } from '../src/schema';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const ROOT = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../..' : '.');

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = [], companies?: string): Promise<{ rows: T[]; rowCount: number }> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (companies !== undefined) {
      await c.query('SET LOCAL ROLE prima_app');
      await c.query(`SELECT set_config('app.company_ids', $1, true)`, [companies]);
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

const proposal = JSON.parse(readFileSync(resolve(ROOT, 'db/proposed/guard-pay-module.json'), 'utf8')) as {
  base: { sha256: string };
  modules: { id: string; path: string; sha256: string }[];
};
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'db/release-manifest.json'), 'utf8')) as { base: { sha256: string }; modules: { id: string }[] };

describe('guard pay module (files)', () => {
  it('pins the module bytes on the release base and stays out of the release manifest', () => {
    assert.equal(proposal.base.sha256, manifest.base.sha256);
    const m = proposal.modules[0];
    assert.equal(createHash('sha256').update(readFileSync(resolve(ROOT, m.path))).digest('hex'), m.sha256);
    assert.ok(!manifest.modules.some((x) => x.id === m.id), 'proposed only');
    assert.equal(readFileSync(resolve(ROOT, m.path), 'utf8'), guardPayModuleSql());
  });
});

describe('guard pay run (database)', () => {
  let db: Db;
  let runId = '';
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('lets HR prepare a company month through the API and keeps other companies out', async () => {
    const period = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    const run = (await db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareGuardPay(u, 'co-sasa', period, []))) as { id: string; lines: { daysWorked: number; formulaCode: string | null }[]; trial: boolean };
    runId = run.id;
    assert.ok(run.lines.length > 200);
    // HR reads the ACT formulas through the pay_read wall: every line with days worked has its formula.
    assert.ok(run.lines.filter((l) => l.daysWorked > 0).every((l) => l.formulaCode), 'HR sees the pay formulas');
    assert.equal(run.trial, true);
    // The company wall: Sasa's run is seen through Sasa only.
    const own = await sql(`SELECT count(*)::int AS n FROM prima.guard_pay_runs`, [], 'co-sasa');
    assert.equal((own.rows[0] as { n: number }).n, 1);
    const other = await sql(`SELECT count(*)::int AS n FROM prima.guard_pay_runs`, [], 'co-arsh,co-inas');
    assert.equal((other.rows[0] as { n: number }).n, 0);
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.guardPayRun(u, runId)), /not found/i);
    await assert.rejects(db.asUser('u-guard-sasa-1', (svc, u) => svc.guardPayroll(u)), /Not allowed/);
    const cm = await db.asUser('u-cm-sasa', (svc, u) => svc.guardPayRun(u, runId));
    assert.equal(cm.can.approve, false);
  });

  it('never deletes a run, and a trial run cannot be stored as paid', async () => {
    await assert.rejects(sql(`DELETE FROM prima.guard_pay_runs`, [], 'co-sasa'), /permission denied/);
    await assert.rejects(
      sql(`UPDATE prima.guard_pay_runs SET data = data || '{"stage":"paid"}'::jsonb WHERE id = $1`, [runId], 'co-sasa'),
      /guard_pay_runs_trial_unpaid/,
    );
    await assert.rejects(
      sql(`INSERT INTO prima.guard_pay_runs (id, company_id, data) VALUES ('x', 'co-sasa', '{"id":"x","companyId":"co-sasa","stage":"draft","period":"2026-10"}')`, [], 'co-arsh'),
      /row-level security/,
    );
  });

  it('keeps advances behind the company wall: the OM sets, the OD or OGM approves, nothing is deleted', async () => {
    const board = await db.asUser('u-om-klang', (svc, u) => svc.guardAdvances(u, {}));
    const companyId = board.companyId;
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    const period = today.slice(0, 7);
    const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const payOn = today > `${period}-20` ? last : `${period}-20`;
    const set = await db.asUser('u-om-klang', (svc, u) => svc.setGuardAdvances(u, { companyId, basis: 'zone', ref: board.choices.zones[0].id, amount: 100, payOn, reason: 'Test advance' }));
    assert.ok(set.made > 0);
    const after = await db.asUser('u-om-klang', (svc, u) => svc.guardAdvances(u, { companyId }));
    const a = after.advances.find((x) => x.status === 'pending')!;
    const approver = a.approverTier === 'ogm' ? 'u-ogm' : 'u-opsdir';
    await db.asUser(approver, (svc, u) => svc.approveGuardAdvances(u, [a.id], 'Approved for the test'));
    const own = await sql(`SELECT count(*)::int AS n FROM prima.guard_pay_advances`, [], companyId);
    assert.ok((own.rows[0] as { n: number }).n >= set.made);
    const others = await sql(`SELECT count(*)::int AS n FROM prima.guard_pay_advances WHERE company_id = $1`, [companyId], 'co-none');
    assert.equal((others.rows[0] as { n: number }).n, 0);
    await assert.rejects(sql(`DELETE FROM prima.guard_pay_advances`, [], companyId), /permission denied/);
    await assert.rejects(
      sql(`UPDATE prima.guard_pay_advances SET data = data || '{"amount":0}'::jsonb WHERE id = $1`, [a.id], companyId),
      /guard_pay_advances_amount_positive/,
    );
  });

  it('keeps the advance and loan scheme behind the company wall: CoS then CEO, both approvals checked in the database', async () => {
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    const board = await db.asUser('u-pwvsb-hr', (svc, u) => svc.guardLoans(u, {}));
    const companyId = board.companyId;
    const rec = await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.recordGuardLoan(u, { companyId, personId: board.guards[0].id, kind: 'loan', limit: 500, amount: 300, purpose: 'Test loan (synthetic)', months: 3, docRef: 'LOAN-PG-1', signedOn: today }),
    );
    await assert.rejects(db.asUser('u-fauzan', (svc, u) => svc.decideGuardLoan(u, rec.id, { decision: 'approve', note: 'okay' })), /Chief of Staff first/);
    await db.asUser('u-cos', (svc, u) => svc.decideGuardLoan(u, rec.id, { decision: 'approve', note: 'Within the scheme' }));
    const done = await db.asUser('u-fauzan', (svc, u) => svc.decideGuardLoan(u, rec.id, { decision: 'approve', note: 'Approved' }));
    assert.equal(done.status, 'approved');
    const fin = await db.asUser('u-fin-t1-lead', (svc, u) => svc.guardLoans(u, { companyId }));
    assert.ok(fin.loans.some((l) => l.id === rec.id && l.financeNotices.length === 3));
    const others = await sql(`SELECT count(*)::int AS n FROM prima.guard_loans WHERE company_id = $1`, [companyId], 'co-none');
    assert.equal((others.rows[0] as { n: number }).n, 0);
    await assert.rejects(sql(`DELETE FROM prima.guard_loans`, [], companyId), /permission denied/);
    // Bypassing the API: a record cannot be approved without the CEO's step, nor lend more than its limit.
    await assert.rejects(sql(`UPDATE prima.guard_loans SET data = data || '{"ceo":null}'::jsonb WHERE id = $1`, [rec.id], companyId), /guard_loans_two_approvals/);
    await assert.rejects(sql(`UPDATE prima.guard_loans SET data = data || '{"amount":900}'::jsonb WHERE id = $1`, [rec.id], companyId), /guard_loans_amount_within_limit/);
  });

  it('lets only the CEO set statutory rates, HR reads them, and nobody else writes the table', async () => {
    const month = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    const board = await db.asUser('u-pwvsb-hr', (svc, u) => svc.statutoryBoard(u));
    assert.equal(board.canSet, false);
    const settings = { ...board.inForce, socso: { ...board.inForce.socso, wageCap: 7000 }, lawRef: 'Test gazette (synthetic)' };
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.setStatutory(u, { effectiveFrom: month, settings, reason: 'Test change' })), /Not allowed|CEO/);
    await db.asUser('u-fauzan', (svc, u) => svc.setStatutory(u, { effectiveFrom: month, settings, reason: 'New SOCSO cap (test)' }));
    const seen = await db.asUser('u-pwvsb-hr', (svc, u) => svc.statutoryBoard(u));
    assert.equal(seen.inForce.socso.wageCap, 7000);
    await assert.rejects(
      sql(`INSERT INTO prima.statutory_versions (id, data) VALUES ('x', '{"id":"x","effectiveFrom":"2026-11","reason":"sneaky"}')`, [], 'co-sasa'),
      /row-level security/,
    );
  });

  it('shows nothing and refuses preparing plainly before the module is installed', async () => {
    await sql('DROP TABLE prima.guard_pay_runs;');
    const fresh = new Db();
    try {
      const board = await fresh.asUser('u-pwvsb-hr', (svc, u) => svc.guardPayroll(u));
      assert.equal(board.on, false);
      assert.equal(board.runs.length, 0);
      await assert.rejects(fresh.asUser('u-pwvsb-hr', (svc, u) => svc.prepareGuardPay(u, 'co-sasa', board.period, [])), /not switched on/);
      const mine = await fresh.asUser('u-guard-sasa-1', (svc, u) => svc.myGuardPayslips(u));
      assert.equal(mine.payslips.length, 0);
    } finally {
      await fresh.onModuleDestroy();
      await sql(guardPayModuleSql());
    }
  });
});
