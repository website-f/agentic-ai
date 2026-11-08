// JV branches (Fauzan, 4 Nov 2026) through the restricted login and the company wall: Branch Manager purchases, Arms
// Control, branch staff leave, the CEO's management fee and the low profit flag. Synthetic seed data on a throwaway
// local PostgreSQL; DATABASE_URL must point at it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays } from '@prima/core';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('JV branches on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const today = () => nowMyt().slice(0, 10);
  const buy = (ref: string, over: Record<string, unknown> = {}) => ({
    on: addDays(today(), -1),
    supplier: 'Synthetic Supplier',
    item: 'Torchlights x 10',
    kind: 'equipment',
    amount: 450,
    invoiceRef: ref,
    ...over,
  });

  it('lets only the JV Branch Manager buy, refuses arms, and keeps other companies out', async () => {
    await db.asUser('u-bm-sasa-2', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'purchase', buy('INV-PG-1')));
    await assert.rejects(
      db.asUser('u-bm-sasa-2', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'purchase', buy('INV-PG-2', { item: 'Revolver .38' }))),
      /Arms Control/,
    );
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'purchase', buy('INV-PG-3'))));
    await assert.rejects(
      db.asUser('u-bm-sasa-1', (svc, u) => svc.branchAct(u, 'br-sasa-1', 'purchase', buy('INV-PG-4'))),
      /Only a JV branch/,
    );
    // Another company's people: neither the board nor the branch can be read.
    await assert.rejects(
      db.asUser('u-cm-inas', (svc, u) => svc.branchJv(u, 'br-sasa-2')),
      /not found|denied/i,
    );
    await assert.rejects(
      db.asUser('u-bm-inas-2', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'purchase', buy('INV-PG-5'))),
      /not found|denied/i,
    );
    const jv = await db.asUser('u-cm-sasa', (svc, u) => svc.branchJv(u, 'br-sasa-2'));
    assert.deepEqual(
      jv.purchases.map((p) => p.invoiceRef),
      ['INV-PG-1'],
    );
    assert.equal(jv.canQuery, true);
    const actions = await db.asUser('u-fauzan', async (_s, _u, store) =>
      (await store.list('audit', {})).filter((a) => a.entityId === 'br-sasa-2').map((a) => a.action),
    );
    assert.ok(actions.includes('branch.purchase'));
  });

  it('keeps both of two purchases recorded at once and refuses the same invoice twice', async () => {
    const r = await Promise.allSettled([
      db.asUser('u-bm-sasa-3', (svc, u) => svc.branchAct(u, 'br-sasa-3', 'purchase', buy('INV-PG-R1'))),
      db.asUser('u-bm-sasa-3', (svc, u) => svc.branchAct(u, 'br-sasa-3', 'purchase', buy('INV-PG-R2'))),
      db.asUser('u-bm-sasa-3', (svc, u) => svc.branchAct(u, 'br-sasa-3', 'purchase', buy('INV-PG-R1'))),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 2);
    const refs = await db.asUser('u-cm-sasa', async (_s, _u, store) => (await store.get('branches', 'br-sasa-3'))!.purchases!.map((p) => p.invoiceRef).sort());
    assert.deepEqual(refs, ['INV-PG-R1', 'INV-PG-R2']);
  });

  it('routes JV branch staff leave to the Branch Manager only', async () => {
    const q = await db.asUser('u-fauzan', async (_s, _u, store) => {
      const people = await store.list('people', { companyId: ['co-sasa'] });
      const ids = new Set(people.filter((p) => p.branchId === 'br-sasa-2' && p.id !== 'pr-sasa-2-bm').map((p) => p.id));
      return (await store.list('leaveRequests', { companyId: ['co-sasa'] })).find((x) => x.status === 'pending' && ids.has(x.personId)) ?? null;
    });
    assert.ok(q, 'a pending leave request on the JV branch in the seed');
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.decideLeave(u, q!.id, false, 'Company tries')));
    await assert.rejects(db.asUser('u-bm-sasa-1', (svc, u) => svc.decideLeave(u, q!.id, false, 'Other branch tries')));
    await db.asUser('u-bm-sasa-2', (svc, u) => svc.decideLeave(u, q!.id, false, 'Short of guards that week'));
    const st = await db.asUser('u-cm-sasa', async (_s, _u, store) => (await store.get('leaveRequests', q!.id))!.status);
    assert.equal(st, 'rejected');
  });

  it('lets only the CEO set the fee, and flags a month under 10% profit on the CEO home', async () => {
    const next = (() => {
      const [y, m] = today().slice(0, 7).split('-').map(Number);
      return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    })();
    const input = {
      effectiveFrom: next,
      pct: 9,
      reason: 'PG synthetic fee review',
    };
    await assert.rejects(
      db.asUser('u-cm-sasa', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'fee', input)),
      /only the CEO/,
    );
    // Two settings at once: both versions land, one after the other.
    const r = await Promise.allSettled([
      db.asUser('u-fauzan', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'fee', input)),
      db.asUser('u-fauzan', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'fee', input)),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1, 'the second must start after the first');
    const a = await db.asUser('u-cm-sasa', async (_s, _u, store) => (await store.get('branches', 'br-sasa-2'))!.agreements!.at(-1)!);
    assert.equal(a.companyBillingSharePct, 9);
    assert.equal(a.ceoSetting?.reason, 'PG synthetic fee review');
    const home = await db.asUser('u-fauzan', (svc, u) => svc.home(u));
    assert.ok((home.watch ?? []).some((x) => x.tag === 'Branch profit' && /under 10%/.test(x.title)));
    const cm = await db.asUser('u-cm-sasa', (svc, u) => svc.home(u));
    assert.ok(![...(cm.watch ?? []), ...(cm.todo ?? [])].some((x) => x.tag === 'Branch profit'));
  });
  it('lets only the JV Branch Manager set branch office staff pay, behind the company wall', async () => {
    // A synthetic branch clerk (the seed's only office person on this branch is its manager).
    const worker = await db.asUser('u-fauzan', async (_s, _u, store) => {
      const bm = (await store.get('people', 'pr-sasa-2-bm'))!;
      const w = { ...bm, id: 'pr-syn-jv-pg', name: 'Synthetic Branch Clerk', staffNo: 'SYN-JV-PG' };
      await store.insert('people', w);
      return w;
    });
    const input = { personId: worker.id, to: 2_750, effectiveOn: today(), reason: 'PG synthetic pay review' };
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'staff_pay', input)), /only the JV Branch Manager/);
    await assert.rejects(db.asUser('u-bm-inas-2', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'staff_pay', input)), /not found|denied/i);
    await assert.rejects(db.asUser('u-bm-sasa-2', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'staff_pay', { ...input, personId: 'pr-sasa-2-bm' })), /own pay/);
    await db.asUser('u-bm-sasa-2', (svc, u) => svc.branchAct(u, 'br-sasa-2', 'staff_pay', input));
    const pay = await db.asUser('u-cm-sasa', async (_s, _u, store) => (await store.get('people', worker.id))!.basicPay);
    assert.equal(pay, 2_750);
  });
  it('keeps a Branch Manager to their own branch and lets the company manager decide their leave', async () => {
    const board = await db.asUser('u-bm-sasa-2', (svc, u) => svc.branchBoard(u));
    assert.deepEqual(
      board.rows.map((r) => r.branch.id),
      ['br-sasa-2'],
    );
    await assert.rejects(db.asUser('u-bm-sasa-2', (svc, u) => svc.branchJv(u, 'br-sasa-3')), /not found/i);
    const coo = await db.asUser('u-fauzan', async (_s, _u, store) => (await store.list('users', {})).find((u) => u.opsTier === 'coo')!.id);
    assert.equal((await db.asUser(coo, (svc, u) => svc.branchJv(u, 'br-sasa-2'))).seesPay, true);
    // A synthetic leave request of the Branch Manager themself.
    const id = await db.asUser('u-fauzan', async (_s, _u, store) => {
      const any = (await store.list('leaveRequests', { companyId: ['co-sasa'] }))[0];
      const q = { ...any, id: 'lv-syn-bm-pg', personId: 'pr-sasa-2-bm', status: 'pending' as const, decidedAt: null, decidedBy: null };
      await store.insert('leaveRequests', q as never);
      return q.id;
    });
    await assert.rejects(db.asUser('u-bm-sasa-2', (svc, u) => svc.decideLeave(u, id, true, 'Own leave')));
    await db.asUser('u-cm-sasa', (svc, u) => svc.decideLeave(u, id, false, 'Branch audit that week'));
    const st = await db.asUser('u-cm-sasa', async (_s, _u, store) => (await store.get('leaveRequests', id))!.status);
    assert.equal(st, 'rejected');
  });
  it('limits a Branch Manager to their own branch leads, and keeps branch lead clashes for the company manager', async () => {
    const lead = (prospect: string, branchId: string | null) => ({ prospect, sector: 'COMMERCIAL' as const, source: 'Referral', guardsEst: 6, estMonthly: 20_000, nextOn: today(), nextWhat: 'Site survey', branchId });
    const other = await db.asUser('u-cm-sasa', (svc, u) => svc.addSalesLead(u, 'co-sasa', lead('PG Synthetic Mall', 'br-sasa-3')));
    const own = await db.asUser('u-bm-sasa-2', (svc, u) => svc.addSalesLead(u, 'co-sasa', lead('PG Synthetic Hospital', 'br-sasa-3')));
    assert.equal(own.branchId, 'br-sasa-2');
    const seen = await db.asUser('u-bm-sasa-2', (svc, u) => svc.salesLeads(u, 'co-sasa'));
    assert.ok(seen.leads.every((r) => r.lead.branchId === 'br-sasa-2'));
    assert.deepEqual(seen.quotations, []);
    await assert.rejects(db.asUser('u-bm-sasa-2', (svc, u) => svc.salesLeadStep(u, other.id, 'note', { text: 'Called them' })), /not found/i);
    await assert.rejects(db.asUser('u-bm-sasa-2', (svc, u) => svc.branchLeadClaims(u, 'co-sasa')));
    const claims = await db.asUser('u-cm-sasa', (svc, u) => svc.branchLeadClaims(u, 'co-sasa'));
    assert.equal(claims.byBranch.length, 3);
  });
});

