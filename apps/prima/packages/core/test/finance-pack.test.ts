import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';
type FinPlan = import('../src').FinPlan;

// Group 5 (Fauzan, 2 Nov 2026: yes to suggestions 25 and 27, "bring out the key important data in a dashboard"): the
// monthly pack per company filled by Prima, one review once the close is approved, and the dashboard. Dummy data only.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const C = 'co-09';
const months = (v: number) => Array.from({ length: 12 }, () => v);

describe('Monthly pack and dashboard (suggestions 25 and 27)', () => {
  it('fills profit against budget, cash, invoices over 90 days, loans, collateral and health numbers, and is reviewed once', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const [de1, dep, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd'].map((id) => svc.user(id)));
    const f = ds.finStatus.find((x) => x.companyId === C)!;
    const P = '2026-09';
    const sign = { by: 'Mock', byId: 'u-x', at: NOW, comment: '' };
    const actual = (v: number) => [...Array.from({ length: 9 }, () => v), null, null, null];
    f.plans = [
      {
        year: 2026,
        budget: {
          months: { revenue: months(100000), guard_cost: months(60000), staff_cost: months(10000), statutory: months(8000) },
          assumptions: '',
          status: 'approved',
          prepared: sign,
          approved: sign,
          returned: null,
        },
        actuals: {
          revenue: actual(90000),
          guard_cost: actual(61000),
          staff_cost: actual(10000),
          statutory: actual(8000),
          premises: actual(0),
          vehicles: actual(0),
          equipment: actual(0),
          insurance: actual(0),
          other_opex: actual(1000),
          finance_cost: actual(0),
          tax: actual(0),
        },
        forecasts: [],
        variances: [],
      } as unknown as FinPlan,
    ];
    f.statements = [{ id: 'st-p', bankId: f.banks[0].id, period: P, opening: 0, closing: 250000, lines: [], loaded: { ...sign, source: 't' } }];
    f.ageing = [
      {
        period: P,
        ar: { current: 90000, d1to30: 40000, d31to60: 20000, d61to90: 10000, over90: 20000 },
        ap: { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 },
        glAr: 180000,
        glAp: 0,
        source: 'x',
        note: '',
        prepared: sign,
        reviewed: sign,
      },
    ];

    const p = await svc.financeControls.pack(de1, C, P);
    expect(p.data.profit!.month).toMatchObject({ revenue: 90000, costs: 80000, profit: 10000, budgetProfit: 22000 });
    expect(p.data.profit!.ytd.profit).toBe(90000);
    expect(p.data.cash.total).toBe(250000);
    expect(p.data.ar).toMatchObject({ over90: 20000, total: 180000 });
    // Days to collect: RM180,000 owed against RM90,000 a month = about 61 days. Payroll 79,000 / 90,000 = 87.78%.
    expect(p.data.health.daysToCollect).toBe(61);
    expect(p.data.health.payrollPct).toBe(87.78);
    // Reviewed only once the close is approved, by a reviewer, with a comment.
    expect(p.mayReview).toBe(false);
    await expect(svc.financeControls.packAction(dep, C, 'review', { period: P, comment: 'ok' })).rejects.toThrow(/after the month is closed/);
    f.closes = [{ id: `close-${C}-${P}`, period: P, status: 'approved', bankRecRefs: [], explanations: [], steps: [] } as never];
    await expect(svc.financeControls.packAction(de1, C, 'review', { period: P, comment: 'ok' })).rejects.toThrow();
    await expect(svc.financeControls.packAction(dep, C, 'review', { period: P })).rejects.toThrow(/comment/);
    await svc.financeControls.packAction(dep, C, 'review', { period: P, comment: 'Read through; revenue below budget is the Klang site ending' });
    await expect(svc.financeControls.packAction(fd, C, 'review', { period: P, comment: 'again' })).rejects.toThrow(/already reviewed/);
    // The reviewed figures are kept even if a statement changes later.
    f.statements[0].closing = 1;
    expect((await svc.financeControls.pack(de1, C, P)).data.cash.total).toBe(250000);
    // The dashboard: one row per company the person sees.
    const d = await svc.financeControls.dashboard(fd);
    expect(d.rows.length).toBeGreaterThan(30);
    const mine = await svc.financeControls.dashboard(de1);
    expect(mine.rows.every((r) => ['pwvsb', 'co-09', 'co-16', 'co-23', 'co-30', 'co-37'].includes(r.companyId))).toBe(true);
  });
  it('accepts miscellaneous payroll as a separate budget expense without altering ordinary guard/staff costs', async()=>{
    const ds=generateDataset({today:TODAY,now:NOW}),svc=new PrimaService(new MemoryStore(ds),()=>NOW);const de=await svc.user('u-fin-t1-de1');
    const f=ds.finStatus.find(f=>f.companyId===C)!;const sign={by:'Synthetic',byId:'test',at:NOW,comment:''};
    f.plans=[{year:2026,budget:{months:{revenue:months(1000),guard_cost:months(200),misc_payroll:months(50)},assumptions:'Additional support',status:'approved',prepared:sign,approved:sign,returned:null},actuals:Object.fromEntries(['revenue','guard_cost','staff_cost','statutory','premises','vehicles','equipment','insurance','other_opex','finance_cost','tax'].map(k=>[k,months(k==='revenue'?1000:k==='guard_cost'?200:0)])),forecast:null} as unknown as FinPlan];
    const before=await svc.financeControls.pack(de,C,'2026-09');f.plans[0].actuals.misc_payroll=months(40);const after=await svc.financeControls.pack(de,C,'2026-09');
    expect(after.data.profit!.month.profit).toBe(before.data.profit!.month.profit!-40);expect(after.data.profit!.month.budgetProfit).toBe(750);expect(f.plans[0].actuals.guard_cost).toEqual(months(200));
  });

});
