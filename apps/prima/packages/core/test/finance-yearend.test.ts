import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  finCapitalAllowances,
  finCloseCheck,
  finScheduleLines,
  finWhtDue,
  finWhtPenalty,
  generateDataset,
  myt,
  type FinAsset,
} from '../src';

// Withholding tax, prepayments and accruals, fixed assets and auditor requests (Fauzan, 2 Nov 2026: suggestions 18,
// 21, 22, 23). Dummy data only.
const C = 'co-09';

function setup(today: string) {
  const ds = generateDataset({ today: '2026-10-31', now: myt('2026-10-31', '10:00') });
  const store = new MemoryStore(ds);
  let now = myt(today, '10:00');
  const svc = new PrimaService(store, () => now);
  return { ds, store, svc, setDay: (d: string) => (now = myt(d, '10:00')) };
}

describe('Withholding tax', () => {
  it('works out the due day and the 10% late penalty', () => {
    expect(finWhtDue('2026-10-15')).toBe('2026-11-15');
    expect(finWhtDue('2026-01-31')).toBe('2026-02-28');
    expect(finWhtDue('2026-12-10')).toBe('2027-01-10');
    expect(finWhtPenalty({ tax: 1000, dueOn: '2026-11-15' }, '2026-11-15')).toBe(0);
    expect(finWhtPenalty({ tax: 1000, dueOn: '2026-11-15' }, '2026-11-16')).toBe(100);
  });

  it('records the tax at the published rate, pays exactly what is due, and is checked by someone else', async () => {
    const { store, svc, setDay } = setup('2026-10-20');
    const [de, dep, viewer] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-coo'].map((id) => svc.user(id)));
    await expect(
      svc.financeControls.whtAction(viewer, C, 'add', { type: 'services', payee: 'X', country: 'SG', gross: 1, paidOn: '2026-10-01' }),
    ).rejects.toThrow();
    // A treaty rate must be lower and needs the certificate of residence.
    await expect(
      svc.financeControls.whtAction(de, C, 'add', {
        type: 'services',
        payee: 'Acme Pte Ltd',
        country: 'Singapore',
        gross: 20000,
        paidOn: '2026-10-10',
        treatyRate: 12,
      }),
    ).rejects.toThrow(/lower/);
    const w = (await svc.financeControls.whtAction(de, C, 'add', {
      type: 'services',
      payee: 'Acme Pte Ltd',
      country: 'Singapore',
      gross: 20000,
      paidOn: '2026-10-10',
    })) as { id: string; tax: number; dueOn: string };
    expect(w.tax).toBe(2000);
    expect(w.dueOn).toBe('2026-11-10');
    const c = (await svc.financeControls.whtAction(de, C, 'add', {
      type: 'contract',
      payee: 'Builder Co',
      country: 'Thailand',
      gross: 10000,
      paidOn: '2026-10-01',
    })) as {
      tax: number;
    };
    expect(c.tax).toBe(1300);
    // Late: the amount must include the 10% penalty.
    setDay('2026-11-12');
    expect((await svc.financeControls.home(de)).some((t) => /withholding tax payment\(s\) to LHDN late/.test(t.title))).toBe(true);
    await expect(svc.financeControls.whtAction(de, C, 'remit', { whtId: w.id, receipt: 'LHDN-1', amount: 2000 })).rejects.toThrow(/2200/);
    await svc.financeControls.whtAction(de, C, 'remit', { whtId: w.id, receipt: 'LHDN-1', amount: 2200 });
    await expect(svc.financeControls.whtAction(de, C, 'check', { whtId: w.id, comment: 'Receipt and rate checked' })).rejects.toThrow();
    expect((await svc.financeControls.home(dep)).some((t) => /withholding tax payment\(s\) to check/.test(t.title))).toBe(true);
    await svc.financeControls.whtAction(dep, C, 'check', { whtId: w.id, comment: 'LHDN receipt and the 10% rate checked' });
    const row = (await store.get('finStatus', `fin-${C}`))!;
    expect(row.wht!.find((x) => x.id === w.id)!.remitted!.penalty).toBe(200);
    // The unpaid one keeps October's close open once its due day has passed into the period.
    const check = finCloseCheck(row, null, '2026-11', myt('2026-11-12', '10:00'));
    expect(check.exceptions.some((e) => /Builder Co/.test(e.text))).toBe(true);
    expect(check.exceptions.some((e) => /Acme/.test(e.text))).toBe(false);
  });
});

describe('Prepayments and accruals', () => {
  it('spreads the cost by month, the last month taking the cents, and a month not posted keeps the close open', async () => {
    expect(
      finScheduleLines({ total: 1000, months: 3, from: '2026-11', posted: [] } as never)
        .map((l) => [l.period, l.amount])
        .flat(),
    ).toEqual(['2026-11', 333.33, '2026-12', 333.33, '2027-01', 333.34]);
    const { store, svc } = setup('2026-11-03');
    const [de, lead] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-lead'].map((id) => svc.user(id)));
    const s = (await svc.financeControls.scheduleAction(de, C, 'add', {
      kind: 'prepayment',
      what: 'Fire insurance 2026/27',
      account: '6100 Insurance',
      total: 12000,
      from: '2026-10',
      months: 12,
    })) as { id: string };
    let row = (await store.get('finStatus', `fin-${C}`))!;
    expect(finCloseCheck(row, null, '2026-10', myt('2026-11-03', '10:00')).exceptions.some((e) => /Fire insurance/.test(e.text))).toBe(true);
    expect((await svc.financeControls.home(de)).some((t) => /prepayment or accrual month\(s\) to post/.test(t.title))).toBe(true);
    await expect(svc.financeControls.scheduleAction(de, C, 'post', { scheduleId: s.id, period: '2027-12', jv: 'JV-1' })).rejects.toThrow();
    // A journal is not money: the person who posts it records it, no second check.
    await svc.financeControls.scheduleAction(de, C, 'post', { scheduleId: s.id, period: '2026-10', jv: 'JV-00123' });
    row = (await store.get('finStatus', `fin-${C}`))!;
    expect(finCloseCheck(row, null, '2026-10', myt('2026-11-03', '10:00')).exceptions.some((e) => /Fire insurance/.test(e.text))).toBe(false);
    await expect(svc.financeControls.scheduleAction(de, C, 'stop', { scheduleId: s.id, comment: 'Policy cancelled' })).rejects.toThrow();
    await svc.financeControls.scheduleAction(lead, C, 'stop', { scheduleId: s.id, comment: 'Policy cancelled from November' });
  });
});

describe('Fixed assets and capital allowances', () => {
  const asset = (x: Partial<FinAsset>): FinAsset => ({
    id: 'a',
    companyId: C,
    name: 'x',
    sqlCode: 'x',
    cls: 'general',
    cost: 10000,
    acquiredOn: '2025-03-01',
    disposed: null,
    added: { by: 'x', byId: 'x', at: 'x', comment: '' },
    ...x,
  });

  it('works out initial and annual allowances, the motor car cap and small value assets', () => {
    const a = asset({ id: 'g' });
    expect(finCapitalAllowances([a], 2025).rows[0]).toMatchObject({ initial: 2000, annual: 1400, total: 3400, residual: 6600 });
    expect(finCapitalAllowances([a], 2026).rows[0]).toMatchObject({ initial: 0, annual: 1400, residual: 5200 });
    // Fully used: 20% + 14% x 6 = 104%, so the last year takes only what is left.
    expect(finCapitalAllowances([a], 2030).rows[0]).toMatchObject({ annual: 1000, residual: 0 });
    expect(finCapitalAllowances([a], 2031).rows[0].total).toBe(0);
    const car = asset({ id: 'c', cls: 'motor_car', cost: 180000, newCarUnder150k: false });
    expect(finCapitalAllowances([car], 2025).rows[0].qe).toBe(50000);
    const sv = finCapitalAllowances(
      Array.from({ length: 11 }, (_, i) => asset({ id: `s${i}`, cls: 'small_value', cost: 2000 })),
      2025,
    );
    expect(sv.total).toBe(22000);
    expect(sv.smallValueOverCap).toBe(2000);
  });

  it('agrees the list with SQL Account, a difference needs a reason from a reviewer', async () => {
    const { store, svc } = setup('2026-11-03');
    const [de, dep] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep'].map((id) => svc.user(id)));
    await svc.financeControls.assetAction(de, C, 'add', {
      name: 'Patrol car',
      sqlCode: 'MV-01',
      cls: 'motor_car',
      cost: 90000,
      acquiredOn: '2026-02-01',
      newCarUnder150k: 'yes',
    });
    await expect(
      svc.financeControls.assetAction(de, C, 'add', { name: 'Car', sqlCode: 'MV-01', cls: 'motor_car', cost: 1, acquiredOn: '2026-02-01' }),
    ).rejects.toThrow(/already/);
    await expect(
      svc.financeControls.assetAction(de, C, 'add', { name: 'Radio', sqlCode: 'SV-01', cls: 'small_value', cost: 2500, acquiredOn: '2026-02-01' }),
    ).rejects.toThrow();
    await expect(svc.financeControls.assetAction(de, C, 'agree', { year: 2026, sqlCost: 90000 })).rejects.toThrow();
    await expect(svc.financeControls.assetAction(dep, C, 'agree', { year: 2026, sqlCost: 95000 })).rejects.toThrow(/difference/);
    await svc.financeControls.assetAction(dep, C, 'agree', { year: 2026, sqlCost: 90000 });
    const row = (await store.get('finStatus', `fin-${C}`))!;
    expect(row.faAgreed![0]).toMatchObject({ year: 2026, diff: 0 });
    const v = await svc.financeControls.view(de, C);
    expect(v.yearEnd.allowances.rows[0].qe).toBe(90000);
  });
});

describe('Auditor requests', () => {
  it('adds each line as an item for its owner, shows it on their home, late ones to the team', async () => {
    const { svc, setDay } = setup('2026-11-03');
    const [de, dep] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep'].map((id) => svc.user(id)));
    const items = (await svc.financeControls.auditAction(dep, C, 'add', {
      year: 2025,
      item: 'Bank confirmations\nFixed asset register\n\nLoan agreements',
      ownerId: de.id,
    })) as { id: string; dueOn: string }[];
    expect(items).toHaveLength(3);
    expect(items[0].dueOn).toBe('2026-11-17');
    expect((await svc.financeControls.home(de)).some((t) => /3 auditor request\(s\) for you/.test(t.title))).toBe(true);
    await svc.financeControls.auditAction(de, C, 'sent', { requestId: items[0].id, doc: 'Bank confirmations 2025.pdf' });
    setDay('2026-11-20');
    expect((await svc.financeControls.home(dep)).some((t) => /2 auditor request\(s\) past their due day/.test(t.title))).toBe(true);
  });
});
