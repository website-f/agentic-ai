// Masterplan chapter 03 (Fauzan, 3 Nov 2026): the branch lifecycle and month ledger through the restricted database
// login and the company wall. Synthetic seed data on a throwaway local PostgreSQL; DATABASE_URL must point at it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

/** The seed's Branch Manager of a branch: they prepare only their own branch's months (Fauzan, 4 Nov 2026). */
const bmOf = (branchId: string) => `u-bm-${branchId.slice(3)}`;

describe('branch ledger on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('runs propose, prepare, return, correct, approve, validate and pay under the company wall', async () => {
    const today = nowMyt().slice(0, 10);
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const period = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    // Who keeps Sasa's books, read as the CEO.
    const setup = await db.asUser('u-fauzan', async (_svc, _u, store) => {
      const fin = (await store.list('finStatus', { companyId: ['co-sasa'] }))[0];
      const users = await store.list('users', {});
      const team = users.filter((x) => x.department === 'finance' && x.financeTeam === fin.team).map((x) => x.id);
      const fd = users.find((x) => x.leadership === 'finance_director')!.id;
      const contracts = await store.list('contracts', { companyId: ['co-sasa'] });
      const sites = await store.list('sites', { companyId: ['co-sasa'] });
      const c = contracts.find((k) => k.state === 'active' && sites.some((s) => k.siteIds.includes(s.id) && s.branchId))!;
      const site = sites.find((s) => c.siteIds.includes(s.id) && s.branchId)!;
      const ag = ((await store.get('branches', site.branchId!))?.agreements ?? []).at(-1);
      // A Model B (salaried) branch's month carries the Branch Manager's salary line at the signed amount.
      return { fin1: team[0], fin2: team[1] ?? fd, site, salary: ag?.model === 'B' ? ag.managerSalary : null };
    });
    const branchId = setup.site.branchId!;

    // A new branch is inserted through the restricted login; another company's manager cannot see it.
    const proposed = await db.asUser('u-cm-sasa', (svc, u) => svc.addBranch(u, 'co-sasa', { name: 'PG test branch', state: 'Pahang', model: 'C' }));
    assert.equal(proposed.status, 'proposed');
    const inasView = await db.asUser('u-cm-inas', (svc, u) => svc.branchBoard(u));
    assert.ok(!inasView.rows.some((r) => r.branch.id === proposed.id));
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.setBranchSetup(u, proposed.id, { kdnRef: 'x' })), /not found/i);

    await db.asUser(setup.fin1, (svc, u) => svc.setBranchProjectCode(u, branchId, 'BR-PG-01'));
    const lines = [
      { kind: 'billing', ref: 'IV-PG-1', siteId: setup.site.id, amount: 50_000 },
      { kind: 'wages', ref: 'PAY-PG', amount: 30_000 },
      { kind: 'statutory', ref: 'EPF-PG', amount: 4_000 },
      ...(setup.salary != null ? [{ kind: 'manager_salary', ref: 'PAY-PG-BM', amount: setup.salary }] : []),
    ];
    const prepared = await db.asUser(bmOf(branchId), (svc, u) => svc.prepareBranchSettlement(u, branchId, { period, payrollRef: 'JA-PAY-PG', lines }));
    assert.equal(prepared.status, 'draft');
    // Two returns at once: exactly one goes through (row lock, Arisha main 3 Nov 2026).
    const returns = await Promise.allSettled([
      db.asUser('u-cm-sasa', (svc, u) => svc.returnBranchSettlement(u, prepared.id, 'Statutory figure is last month')),
      db.asUser('u-cm-sasa', (svc, u) => svc.returnBranchSettlement(u, prepared.id, 'Statutory figure is last month again')),
    ]);
    assert.equal(returns.filter((r) => r.status === 'fulfilled').length, 1);
    const corrected = await db.asUser(bmOf(branchId), (svc, u) =>
      svc.prepareBranchSettlement(u, branchId, { period, payrollRef: 'JA-PAY-PG', lines: lines.map((l) => (l.kind === 'statutory' ? { ...l, amount: 4_100 } : l)) }),
    );
    assert.deepEqual(
      corrected.steps!.map((s) => s.what),
      ['prepared', 'returned', 'corrected'],
    );

    // Two approvals at once: exactly one succeeds.
    const both = await Promise.allSettled([
      db.asUser('u-cm-sasa', (svc, u) => svc.approveBranchSettlement(u, prepared.id, 'Checked once')),
      db.asUser('u-cm-sasa', (svc, u) => svc.approveBranchSettlement(u, prepared.id, 'Checked twice')),
    ]);
    assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);

    const validations = await Promise.allSettled([
      db.asUser(setup.fin1, (svc, u) => svc.validateBranchSettlement(u, prepared.id, 'Agreed to SQL project BR-PG-01')),
      db.asUser(setup.fin1, (svc, u) => svc.validateBranchSettlement(u, prepared.id, 'Agreed to SQL project BR-PG-01 again')),
    ]);
    assert.equal(validations.filter((r) => r.status === 'fulfilled').length, 1);
    await assert.rejects(db.asUser(setup.fin1, (svc, u) => svc.recordBranchPayout(u, prepared.id, { bankRef: 'TT-PG', note: 'Paid' })), /another person/);
    // A Model B month's payout is determined by the Finance Director (Fauzan, 5 Nov 2026); here a payout of zero.
    const payer = setup.salary != null ? 'u-fd' : setup.fin2;
    const payouts = await Promise.allSettled([
      db.asUser(payer, (svc, u) => svc.recordBranchPayout(u, prepared.id, { bankRef: 'TT-PG', note: 'Paid', amount: 0 })),
      db.asUser(payer, (svc, u) => svc.recordBranchPayout(u, prepared.id, { bankRef: 'TT-PG-2', note: 'Paid twice', amount: 0 })),
    ]);
    assert.equal(payouts.filter((r) => r.status === 'fulfilled').length, 1);
    const paid = (payouts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ status: string }>).value;
    assert.equal(paid.status, 'paid');

    // The audit chain carries every step.
    const actions = await db.asUser('u-fauzan', async (_svc, _u, store) =>
      (await store.list('audit', {})).filter((a) => a.entityId === prepared.id).map((a) => a.action),
    );
    // A Model B month closed by the Finance Director with no payout is audited as branch.closed.
    const last = setup.salary != null ? 'branch.closed' : 'branch.paid';
    for (const a of ['branch.prepare', 'branch.return', 'branch.settlement', 'branch.validate', last]) assert.ok(actions.includes(a), a);
    // Exactly one audit entry for each step that was raced.
    for (const a of ['branch.return', 'branch.settlement', 'branch.validate', last]) assert.equal(actions.filter((x) => x === a).length, 1, a);
  });

  it('lets exactly one of many concurrent approvals win, with one audit entry (Arisha main, 3 Nov 2026)', async () => {
    // Re-run the race on fresh months so a lucky schedule cannot hide a missing lock.
    const ctx = await db.asUser('u-cm-sasa', async (svc, u) => {
      const row = (await svc.branchBoard(u)).rows.find((r) => r.status === 'active' && r.settlement && r.settlement.status === 'draft' && !r.holds.length);
      return row ? { id: row.settlement!.id } : null;
    });
    assert.ok(ctx, 'the synthetic seed has a draft month ready to approve');
    const tries = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => db.asUser('u-cm-sasa', (svc, u) => svc.approveBranchSettlement(u, ctx.id, `Concurrent approval ${i}`))),
    );
    assert.equal(tries.filter((r) => r.status === 'fulfilled').length, 1);
    const n = await db.asUser('u-fauzan', async (_svc, _u, store) => (await store.list('audit', {})).filter((a) => a.entityId === ctx.id && a.action === 'branch.settlement').length);
    assert.equal(n, 1);
  });

  it('keeps business case reviews and treasury figures behind the company wall and the no-self-review rule', async () => {
    const today = nowMyt().slice(0, 10);
    const fin = await db.asUser('u-fauzan', async (_svc, _u, store) => {
      const st = (await store.list('finStatus', { companyId: ['co-sasa'] }))[0];
      const users = await store.list('users', {});
      return users.filter((x) => x.department === 'finance' && x.financeTeam === st.team).map((x) => x.id)[0];
    });
    const b = await db.asUser('u-cm-sasa', (svc, u) => svc.addBranch(u, 'co-sasa', { name: 'PG treasury branch', state: 'Perak', model: 'A' }));
    const cash13 = Array.from({ length: 13 }, (_, i) => ({ week: i + 1, inflow: 10_000, outflow: 9_000 }));
    const input = { sites: 2, guards: 20, monthlyBilling: 40_000, monthlyCosts: 36_000, startupCost: 5_000, openingCash: 20_000, fundingSource: 'Company cash (test)', assumptions: 'Synthetic assumptions for PG test', cash13 };
    await db.asUser('u-cm-sasa', (svc, u) => svc.setBranchBusinessCase(u, b.id, input));
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.reviewBranchBusinessCase(u, b.id, 'Checked')), /not found/i);
    const reviewed = await db.asUser(fin, (svc, u) => svc.reviewBranchBusinessCase(u, b.id, 'Checked against tender'));
    assert.equal(reviewed.businessCases!.at(-1)!.reviewedById, fin);
    // Treasury on an existing working branch.
    const working = await db.asUser('u-cm-sasa', async (svc, u) => (await svc.branchBoard(u)).rows.find((r) => r.status === 'active')!.branch.id);
    await assert.rejects(
      db.asUser('u-bm-sasa-1', (svc, u) => svc.recordBranchTreasury(u, working, { on: today, bankBalance: 1, statementRef: 'ST-PG', floatHeld: 0, paymentsDue7d: 0 })),
      /denied|not allowed|cannot|not found/i,
    );
    const v = await db.asUser(fin, (svc, u) => svc.recordBranchTreasury(u, working, { on: today, bankBalance: 9_000, statementRef: 'ST-PG-1', floatHeld: 0, paymentsDue7d: 10_000 }));
    assert.equal(v.state, 'attention');
    const actions = await db.asUser('u-fauzan', async (_svc, _u, store) => (await store.list('audit', {})).filter((a) => a.entityId === b.id || a.entityId === working).map((a) => a.action));
    for (const a of ['branch.business_case', 'branch.business_case.review', 'branch.treasury']) assert.ok(actions.includes(a), a);
  });
});
