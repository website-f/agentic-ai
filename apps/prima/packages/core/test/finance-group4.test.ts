import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, finCash13, finCloseCheck, finIcExceptions, finWeekStart, generateDataset, myt } from '../src';

// Group 4 (Fauzan, 2 Nov 2026: yes to suggestions 12 and 13): intercompany balances agreed on both sides every month,
// and the 13-week cash forecast per company. Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const F = (id: string) => ds.finStatus.find((x) => x.companyId === id)!;
  return { ds, svc, F };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));

describe('Intercompany balances agreed on both sides (suggestion 12)', () => {
  it('pairs both sides, shows the missing side and the difference, and stops both closes until agreed or explained', async () => {
    const { svc, F } = fresh();
    const [de1, de2, dep, t2] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fin-t2-lead');
    const P = '2026-09';
    // PWVSB charges co-09 a management fee: PWVSB is owed RM5,000.
    await svc.financeControls.icAction(de1, 'pwvsb', 'record', {
      period: P,
      withId: 'co-09',
      kind: 'management_fee',
      balance: 5000,
      sqlRef: 'IC-CO09 / IV-MF-0926',
    });
    let ex = finIcExceptions(F('pwvsb'), 'co-09', P);
    expect(ex).toHaveLength(1);
    expect(ex[0].text).toMatch(/record this company/);
    // A team that does not act on co-09 cannot record its side.
    await expect(
      svc.financeControls.icAction(t2, 'co-09', 'record', { period: P, withId: 'pwvsb', kind: 'management_fee', balance: -5000, sqlRef: 'x' }),
    ).rejects.toThrow();
    // co-09 books only RM4,800: the sides differ by RM200.
    await svc.financeControls.icAction(de2, 'co-09', 'record', { period: P, withId: 'pwvsb', kind: 'management_fee', balance: -4800, sqlRef: 'IC-PWVSB' });
    ex = finIcExceptions(F('pwvsb'), 'pwvsb', P);
    expect(ex[0].text).toMatch(/differ by RM200.00/);
    // The close of either company shows it.
    const check = finCloseCheck(F('co-09'), null, P, NOW, undefined, null, F('pwvsb'));
    expect(JSON.stringify(check)).toMatch(/Intercompany management fee/);
    // Nobody who entered a side explains it; a reviewer who entered neither does.
    await expect(
      svc.financeControls.icAction(de1, 'co-09', 'explain', { period: P, withId: 'pwvsb', kind: 'management_fee', comment: 'Timing difference' }),
    ).rejects.toThrow();
    await svc.financeControls.icAction(dep, 'co-09', 'explain', {
      period: P,
      withId: 'pwvsb',
      kind: 'management_fee',
      comment: 'Credit note for RM200 issued 30 Sept, booked by co-09 in October',
    });
    expect(finIcExceptions(F('pwvsb'), 'co-09', P)).toHaveLength(0);
    // Correcting a side changes the difference: the old explanation no longer covers it; agreeing clears it.
    await svc.financeControls.icAction(de2, 'co-09', 'record', {
      period: P,
      withId: 'pwvsb',
      kind: 'management_fee',
      balance: -5000,
      sqlRef: 'IC-PWVSB corrected',
    });
    expect(finIcExceptions(F('pwvsb'), 'co-09', P)).toHaveLength(0);
    const v = await svc.financeControls.view(de1, 'co-09');
    const row = v.intercompany.pairs.find((x) => x.period === P && x.withId === 'pwvsb')!;
    expect(row).toMatchObject({ status: 'agreed', mine: { balance: -5000 }, theirs: { balance: 5000 } });
    // A balance last month must be recorded again this month.
    const next = finIcExceptions(F('pwvsb'), 'co-09', '2026-10');
    expect(next.map((e) => e.text).join()).toMatch(/balance last month/);
  });
});

describe('13-week cash forecast (suggestion 13)', () => {
  it('fills the weeks from statements, payments, regular payments, payroll and government claims, and takes Finance lines', async () => {
    const { svc, F } = fresh();
    const [de1, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    expect(finWeekStart('2026-10-31')).toBe('2026-10-26');
    const f = F('pwvsb');
    // A known opening: a loaded statement for September.
    const bankId = f.banks[0].id;
    const sign = { by: de1.name, byId: de1.id, at: NOW, comment: '', source: 'test' };
    f.statements = [{ id: 'st-c13', bankId, period: '2026-09', opening: 0, closing: 100000, lines: [], loaded: sign }];
    let v = (await svc.financeControls.view(de1, 'pwvsb')).cash13;
    expect(v.weeks).toHaveLength(13);
    expect(v.weeks[0].from).toBe('2026-10-26');
    // The staff payroll is in the forecast on the usual pay day (October's run, paid in November).
    const payroll = v.weeks.flatMap((w) => w.outs).filter((x) => x.source === 'payroll');
    expect(payroll.some((x) => x.label.includes('2026-10'))).toBe(true);
    // Finance adds a client collection it expects.
    await svc.financeControls.cash13Action(de1, 'pwvsb', 'add', {
      direction: 'in',
      on: '2026-11-20',
      amount: 250000,
      label: 'Client collections (mock)',
      every: 'month',
      until: '2027-01-20',
    });
    v = (await svc.financeControls.view(de1, 'pwvsb')).cash13;
    expect(v.weeks.flatMap((w) => w.ins).filter((x) => x.source === 'manual')).toHaveLength(3);
    // Closing balances run on week by week.
    for (let i = 1; i < 13; i++) expect(v.weeks[i].opening).toBe(v.weeks[i - 1].closing);
    // A large payment due makes a week short, shown to the FD.
    const big = finCash13({ ...f, cash13: [], payments: [] }, [], TODAY);
    expect(big.opening).toBe(100000);
    await svc.financeControls.cash13Action(de1, 'pwvsb', 'add', { direction: 'out', on: '2026-11-03', amount: 5000000, label: 'Mock land deposit' });
    expect((await svc.financeControls.home(fd)).some((t) => /short of cash within 13 weeks/.test(t.title))).toBe(true);
    // Reviewing needs a reviewer and a comment.
    await expect(svc.financeControls.cash13Action(de1, 'pwvsb', 'review', { comment: 'ok' })).rejects.toThrow();
    await expect(svc.financeControls.cash13Action(dep, 'pwvsb', 'review', {})).rejects.toThrow(/comment/);
    await svc.financeControls.cash13Action(dep, 'pwvsb', 'review', { comment: 'Deposit to be moved to January; FD told' });
    expect(F('pwvsb').cash13Reviews![0].firstShortWeek).toBe(1); // the mock EPF payment overdue in week 1
  });
});
