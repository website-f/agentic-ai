import { describe, expect, it } from 'vitest';
import { BRANCH_LOW_MARGIN_PCT, MemoryStore, PrimaService, branchMargin, generateDataset, myt } from '../src';

// JV branches (Fauzan, 4 Nov 2026): the Branch Manager buys from any supplier and the company watches; arms go through
// Arms Control; the Branch Manager runs branch staff HR; the CEO sets each branch's management fee and is flagged when a
// month's profit is under 10% of billing. Synthetic data only.

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

async function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  return {
    ds,
    store,
    svc,
    ceo: await svc.user('u-fauzan'),
    cm: await svc.user('u-cm-sasa'),
    bmA: await svc.user('u-bm-sasa-2'),
    bmB: await svc.user('u-bm-sasa-1'),
  };
}

const buy = (over: Record<string, unknown> = {}) => ({
  on: '2026-10-20',
  supplier: 'Synthetic Uniform Supplier',
  item: 'Raincoats x 20',
  kind: 'equipment',
  amount: 1_200,
  invoiceRef: 'INV-SYN-1',
  ...over,
});

describe('JV branch purchases', () => {
  it('only the JV Branch Manager buys, from any supplier; the company asks but never blocks', async () => {
    const { store, svc, cm, bmA, bmB } = await fresh();
    await expect(svc.branchAct(cm, 'br-sasa-2', 'purchase', buy())).rejects.toThrow();
    await expect(svc.branchAct(bmB, 'br-sasa-1', 'purchase', buy())).rejects.toThrow(/Only a JV branch/);
    await expect(svc.branchAct(bmB, 'br-sasa-2', 'purchase', buy())).rejects.toThrow();
    await svc.branchAct(bmA, 'br-sasa-2', 'purchase', buy());
    await expect(svc.branchAct(bmA, 'br-sasa-2', 'purchase', buy())).rejects.toThrow(/already/i);
    const p = (await store.get('branches', 'br-sasa-2'))!.purchases![0];
    await expect(
      svc.branchAct(bmA, 'br-sasa-2', 'purchase_query', {
        purchaseId: p.id,
        text: 'Why this supplier?',
      }),
    ).rejects.toThrow();
    await svc.branchAct(cm, 'br-sasa-2', 'purchase_query', {
      purchaseId: p.id,
      text: 'Why this supplier?',
    });
    await svc.branchAct(bmA, 'br-sasa-2', 'purchase_answer', {
      purchaseId: p.id,
      text: 'Cheapest who could deliver this week.',
    });
    const jv = await svc.branchJv(cm, 'br-sasa-2');
    expect(jv.purchases[0].queries[0].answer?.text).toMatch(/Cheapest/);
    expect(jv.openQueries).toBe(0);
  });

  it('refuses firearms and ammunition: Arms Control has full control of arms', async () => {
    const { svc, bmA } = await fresh();
    for (const item of ['Pistol 9mm', 'Ammunition 50 rounds', 'Peluru 9mm', 'Shotgun cartridges'])
      await expect(svc.branchAct(bmA, 'br-sasa-2', 'purchase', buy({ item, invoiceRef: `INV-${item}` }))).rejects.toThrow(/Arms Control/);
  });

  it('puts the month purchases and branch staff pay into the prepared JV month', async () => {
    const { ds, store, svc, bmA, cm } = await fresh();
    // A synthetic branch office worker on the company's paid September staff run.
    const run0 = (await store.get('staffPayRuns', 'sp-co-sasa-2026-09'))!;
    const worker = ds.people.find((p) => p.branchId === 'br-sasa-2' && p.role === 'office')!;
    const line = {
      ...run0.lines[0],
      personId: worker.id,
      name: worker.name,
      gross: 3_000,
      epfEr: 390,
      socsoEr: 52,
      eisEr: 6,
      hrd: 30,
    };
    await store.update('staffPayRuns', run0.id, {
      lines: [...run0.lines.filter((l) => l.personId !== worker.id), line],
    });
    await svc.branchAct(bmA, 'br-sasa-2', 'purchase', buy({ on: '2026-09-05' }));
    const [fin] = ds.users.filter((u) => u.department === 'finance' && u.financeTeam === ds.finStatus.find((f) => f.companyId === 'co-sasa')!.team);
    await svc.setBranchProjectCode(fin, 'br-sasa-2', 'BR-SYN-2');
    const site = ds.sites.find((s) => s.branchId === 'br-sasa-2')!;
    const m = await svc.prepareBranchSettlement(fin, 'br-sasa-2', {
      period: '2026-09',
      payrollRef: 'JA-PAY-2026-09',
      lines: [
        { kind: 'billing', ref: 'IV-SYN-09', siteId: site.id, amount: 100_000 },
        { kind: 'wages', ref: 'JA-PAY-2026-09', amount: 60_000 },
      ],
    });
    expect(m.lines!.some((l) => l.ref === 'INV-SYN-1' && l.amount === 1_200)).toBe(true);
    const staffPay = m.lines!.filter((l) => l.ref.startsWith('sp-co-sasa-2026-09'));
    const jv = await svc.branchJv(cm, 'br-sasa-2');
    const run = jv.pay.find((x) => x.period === '2026-09')!;
    expect(run.people).toBe(1);
    expect(run.wages).toBe(3_000);
    expect(run.statutory).toBe(478);
    expect(staffPay.reduce((t, l) => t + l.amount, 0)).toBeCloseTo(run.wages + run.statutory, 2);
  });
});

describe('JV branch staff HR', () => {
  it('the Branch Manager decides branch staff leave; the OM and company only monitor', async () => {
    const { ds, store, svc, bmA, cm } = await fresh();
    const q = ds.leaveRequests.find((x) => x.status === 'pending' && ds.people.find((p) => p.id === x.personId)?.branchId === 'br-sasa-2')!;
    const om = ds.users.find((u) => u.opsTier === 'om' && u.companyIds.includes('co-sasa'))!;
    await expect(svc.decideLeave(cm, q.id, true, 'ok')).rejects.toThrow();
    if (om) await expect(svc.decideLeave(om, q.id, true, 'ok')).rejects.toThrow();
    const list = await svc.leaveRequests(cm, { waiting: 'all' } as never);
    expect(list.rows.find((r) => r.request.id === q.id)?.waitingWith?.label).toMatch(/JV Branch Manager/);
    try {
      await svc.decideLeave(bmA, q.id, false, 'Short of guards that week');
    } catch (e) {
      expect(String(e)).not.toMatch(/AccessDenied|not allowed/i);
    }
    expect((await store.get('leaveRequests', q.id))!.status).toBe('rejected');
  });

  it('a Model B branch keeps the usual ladder', async () => {
    const { ds, svc, bmB } = await fresh();
    const q = ds.leaveRequests.find((x) => x.status === 'pending' && ds.people.find((p) => p.id === x.personId)?.branchId === 'br-sasa-1')!;
    await expect(svc.decideLeave(bmB, q.id, false, 'Not mine to decide')).rejects.toThrow();
  });
});

describe('CEO management fee and low profit flag', () => {
  it('only the CEO sets the fee, from a month after the last settled one, with a reason', async () => {
    const { store, svc, ceo, cm } = await fresh();
    const input = {
      effectiveFrom: '2026-11-01',
      pct: 12,
      reason: 'Group fee review 2026',
    };
    await expect(svc.branchAct(cm, 'br-sasa-2', 'fee', input)).rejects.toThrow(/only the CEO/);
    await expect(svc.branchAct(ceo, 'br-sasa-2', 'fee', { ...input, reason: 'x' })).rejects.toThrow(/reason/);
    await expect(
      svc.branchAct(ceo, 'br-sasa-2', 'fee', {
        ...input,
        effectiveFrom: '2026-08-01',
      }),
    ).rejects.toThrow(/settled|after/);
    await expect(svc.branchAct(ceo, 'br-sasa-2', 'fee', { ...input, pct: 120 })).rejects.toThrow(/0 to 100/);
    await expect(svc.branchAct(ceo, 'br-sasa-1', 'fee', input)).rejects.toThrow(/Model B/);
    await svc.branchAct(ceo, 'br-sasa-2', 'fee', input);
    await svc.branchAct(ceo, 'br-sasa-3', 'fee', { ...input, pct: 50 });
    const a2 = (await store.get('branches', 'br-sasa-2'))!.agreements!.at(-1)!;
    expect([a2.model, a2.companyBillingSharePct, a2.ceoSetting?.reason]).toEqual(['A', 12, 'Group fee review 2026']);
    expect((await store.get('branches', 'br-sasa-3'))!.agreements!.at(-1)!.companyNetProfitSharePct).toBe(50);
    expect((await store.list('audit', {})).filter((x) => x.action === 'branch.fee.set').length).toBe(2);
  });

  it('flags a branch month under 10% profit to the CEO only', async () => {
    expect(BRANCH_LOW_MARGIN_PCT).toBe(10);
    expect(
      branchMargin({
        billing: 100,
        costs: { wages: 85, statutory: 5, other: 0.01 },
      }).low,
    ).toBe(true);
    expect(
      branchMargin({
        billing: 100,
        costs: { wages: 85, statutory: 5, other: 0 },
      }).low,
    ).toBe(false);
    expect(
      branchMargin({
        billing: 10_000,
        costs: { wages: 9_004, statutory: 0, other: 0 },
      }).low,
    ).toBe(true);
    expect(branchMargin({ billing: 0, costs: { wages: 1, statutory: 0, other: 0 } }).low).toBe(true);
    expect(branchMargin({ billing: 0, costs: { wages: 0, statutory: 0, other: 0 } }).low).toBe(false);
    const { svc, ceo, cm } = await fresh();
    const home = await svc.home(ceo);
    const flags = home.watch.filter((x) => x.tag === 'Branch profit');
    expect(flags.some((x) => /under 10%/.test(x.title))).toBe(true);
    const board = await svc.branchBoard(cm);
    const low = board.rows.filter((r) => r.margin?.low).map((r) => r.branch.name);
    for (const f of flags.filter((x) => x.detail.includes('Sasa'))) expect(low.some((n) => f.title.startsWith(n))).toBe(true);
    const mh = await svc.home(cm);
    expect([...(mh.watch ?? []), ...(mh.todo ?? [])].some((x) => x.tag === 'Branch profit')).toBe(false);
  });
});

describe('JV branch staff pay', () => {
  it('the JV Branch Manager sets branch office staff pay, never their own, guards or another branch', async () => {
    const { ds, store, svc, cm, bmA, bmB } = await fresh();
    const worker = ds.people.find((p) => p.branchId === 'br-sasa-2' && p.role === 'office' && p.status === 'active' && p.id !== 'pr-sasa-2-bm')
      ?? (await (async () => {
        const w = { ...ds.people.find((p) => p.id === 'pr-sasa-2-bm')!, id: 'pr-syn-jv-1', name: 'Synthetic Branch Clerk', staffNo: 'SYN-JV-1' };
        await store.insert('people', w);
        return w;
      })());
    const guard = ds.people.find((p) => p.branchId === 'br-sasa-2' && p.role !== 'office')!;
    const input = { personId: worker.id, to: 2_800, effectiveOn: '2026-11-01', reason: 'Took over the site rosters' };
    await expect(svc.branchAct(cm, 'br-sasa-2', 'staff_pay', input)).rejects.toThrow(/only the JV Branch Manager/);
    await expect(svc.branchAct(bmB, 'br-sasa-1', 'staff_pay', input)).rejects.toThrow();
    await expect(svc.branchAct(bmA, 'br-sasa-2', 'staff_pay', { ...input, personId: 'pr-sasa-2-bm' })).rejects.toThrow(/own pay/);
    await expect(svc.branchAct(bmA, 'br-sasa-2', 'staff_pay', { ...input, personId: guard.id })).rejects.toThrow(/JA Group app/);
    await expect(svc.branchAct(bmA, 'br-sasa-2', 'staff_pay', { ...input, to: -5 })).rejects.toThrow(/ringgit/);
    await svc.branchAct(bmA, 'br-sasa-2', 'staff_pay', input);
    expect((await store.get('people', worker.id))!.basicPay).toBe(2_800);
    const pc = (await store.list('payChanges', {})).find((c) => c.personId === worker.id)!;
    expect([pc.status, pc.to, pc.requestedById]).toEqual(['verified', 2_800, bmA.id]);
    expect((await store.list('audit', {})).some((a) => a.action === 'branch.staff.pay' && a.entityId === worker.id)).toBe(true);
    // The company sees it.
    const jv = await svc.branchJv(cm, 'br-sasa-2');
    expect(jv.staff.find((x) => x.id === worker.id)!.basicPay).toBe(2_800);
  });
});

describe('Branch oversight and need to know (Fauzan, 4 Nov 2026)', () => {
  it('a Branch Manager sees and works only their own branch', async () => {
    const { svc, bmA } = await fresh();
    const board = await svc.branchBoard(bmA);
    expect(board.rows.map((r) => r.branch.id)).toEqual(['br-sasa-2']);
    expect(board.canAdd).toEqual([]);
    await expect(svc.branchJv(bmA, 'br-sasa-3')).rejects.toThrow(/not found/i);
    await expect(svc.branchAct(bmA, 'br-sasa-3', 'business_case', {})).rejects.toThrow(/not found/i);
  });

  it('the CEO, group leaders and Finance monitor branch staff pay; the company manager governs', async () => {
    const { ds, svc, ceo, cm } = await fresh();
    expect((await svc.branchJv(ceo, 'br-sasa-2')).seesPay).toBe(true);
    // The CEO's team (group leaders other than Finance) also monitor pay.
    for (const lead of ds.users.filter((u) => u.leadership === 'chairman' || u.leadership === 'cos' || u.opsTier === 'coo'))
      expect((await svc.branchJv(await svc.user(lead.id), 'br-sasa-2')).seesPay, lead.id).toBe(true);
    expect((await svc.branchJv(cm, 'br-sasa-2')).seesPay).toBe(true);
    expect((await svc.branchBoard(cm)).rows.filter((r) => r.branch.companyId === 'co-sasa').length).toBe(3);
  });

  it("the company manager decides a Branch Manager's own leave; HR and the Branch Manager do not", async () => {
    const { ds, store, svc, cm, bmA } = await fresh();
    const any = ds.leaveRequests.find((x) => x.companyId === 'co-sasa')!;
    const q = { ...any, id: 'lv-syn-bm-2', personId: 'pr-sasa-2-bm', status: 'pending' as const, decidedAt: null, decidedBy: null };
    await store.insert('leaveRequests', q as never);
    const hr = ds.users.find((u) => u.department === 'hr')!;
    await expect(svc.decideLeave(bmA, q.id, true, 'Own leave')).rejects.toThrow();
    await expect(svc.decideLeave(hr, q.id, true, 'HR tries')).rejects.toThrow();
    const list = await svc.leaveRequests(cm, {});
    expect(list.rows.find((r) => r.request.id === q.id)?.waitingWith?.label).toMatch(/Company Manager/);
    await svc.decideLeave(cm, q.id, false, 'Branch audit that week');
    expect((await store.get('leaveRequests', q.id))!.status).toBe('rejected');
  });
});

describe('Branch Managers and company leads (need to know, 4 Nov 2026)', () => {
  const lead = (prospect: string, branchId: string | null) => ({ prospect, sector: 'COMMERCIAL' as const, source: 'Referral', guardsEst: 6, estMonthly: 20_000, nextOn: '2026-10-30', nextWhat: 'Site survey', branchId });
  it('a Branch Manager sees and works only their own branch leads; clashes are for the company manager', async () => {
    const { svc, cm, bmA } = await fresh();
    const other = await svc.addSalesLead(cm, 'co-sasa', lead('Synthetic Mall Bhd', 'br-sasa-3'));
    const own = await svc.addSalesLead(bmA, 'co-sasa', lead('Synthetic Hospital Bhd', 'br-sasa-3'));
    expect(own.branchId).toBe('br-sasa-2');
    const seen = await svc.salesLeads(bmA, 'co-sasa');
    expect(seen.leads.every((r) => r.lead.branchId === 'br-sasa-2')).toBe(true);
    expect(seen.leads.some((r) => r.lead.id === own.id)).toBe(true);
    expect(seen.quotations).toEqual([]);
    expect((await svc.salesLeads(cm, 'co-sasa')).leads.some((r) => r.lead.id === other.id)).toBe(true);
    await expect(svc.salesLeadStep(bmA, other.id, 'note' as never, { text: 'Called them' } as never)).rejects.toThrow(/not found/i);
    await expect(svc.branchLeadClaims(bmA, 'co-sasa')).rejects.toThrow();
    expect((await svc.branchLeadClaims(cm, 'co-sasa')).byBranch.length).toBe(3);
  });
});
