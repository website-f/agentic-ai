import { describe, expect, it } from 'vitest';
import { FIN_DEFAULT_YEAR_END, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, RULES, finRegularUnusual, generateDataset, myt } from '../src';

// Finance 27 Part M (Fauzan, 2 Nov 2026): lighter check L3 on varying bills and every year ending 31 December.
// Synthetic data only.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const [de1, dep, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd'].map((id) => svc.user(id)));
  const F = () => ds.finStatus.find((x) => x.companyId === T1)!;
  const reg = (u: typeof de1, action: string, input: Record<string, unknown>) => svc.financeControls.regularAction(u, T1, action, input) as Promise<any>;
  return { ds, svc, de1, dep, fd, F, reg };
}

describe('M1: a varying bill is explained only when more than 10% off the last three', () => {
  it('the limit works in cents: exactly 10% needs none', () => {
    expect(finRegularUnusual(1100, 1000)).toBe(false);
    expect(finRegularUnusual(900, 1000)).toBe(false);
    expect(finRegularUnusual(1100.01, 1000)).toBe(true);
    expect(finRegularUnusual(899.99, 1000)).toBe(true);
    expect(RULES.financeRegularBills.label).toBe('Policy');
    expect(RULES.financeRegularBills.source).toMatch(/lighter check L3/);
  });

  it('RM1,000, RM1,100 and RM900: RM1,100 needs none, RM1,100.01 and RM899.99 do; after the FD sets 15%, RM1,150 needs none', async () => {
    const { svc, de1, dep, fd, reg, F } = await setup();
    const bankId = F().banks[0].id;
    const r = await reg(de1, 'add', { kind: 'bill', name: 'Office water (mock)', payeeId: 'payee-pwvsb-004', reference: 'AIR 1-22 (mock)', method: 'transfer', bankId, every: 'monthly', dueDay: 20, firstDue: '2026-07-20' });
    await reg(dep, 'check', { regularId: r.id, comment: 'Agreed to the water account letter (mock)' });
    const why = 'Set-up bill (mock).';
    await reg(de1, 'bill', { regularId: r.id, period: '2026-07', amount: 1000, doc: 'jul.pdf', unusual: why });
    await reg(de1, 'bill', { regularId: r.id, period: '2026-08', amount: 1100, doc: 'aug.pdf', unusual: why });
    await reg(de1, 'bill', { regularId: r.id, period: '2026-09', amount: 900, doc: 'sep.pdf', unusual: why });
    const bill = (amount: number, unusual?: string) => reg(de1, 'bill', { regularId: r.id, period: '2026-10', amount, doc: 'oct.pdf', ...(unusual ? { unusual } : {}) });
    expect((await bill(1100)).dues.find((d: any) => d.period === '2026-10').bill.unusual).toBeNull();
    expect((await bill(900)).dues.find((d: any) => d.period === '2026-10').bill.unusual).toBeNull();
    await expect(bill(1100.01)).rejects.toThrow(/explain why/);
    await expect(bill(899.99)).rejects.toThrow(/explain why/);
    await expect(bill(1150)).rejects.toThrow(/explain why/);
    // A Finance team member cannot change the limit; the FD can, with a reason.
    await expect(svc.finance.setSettings(de1, { values: { regularHighPct: 15 }, comment: 'Try' })).rejects.toThrow();
    await svc.finance.setSettings(fd, { values: { regularHighPct: 15 }, comment: 'Water tariffs vary more (mock).' });
    expect((await bill(1150)).dues.find((d: any) => d.period === '2026-10').bill.unusual).toBeNull();
    await expect(bill(1150.01)).rejects.toThrow(/explain why/);
    await expect(bill(899.99)).rejects.toThrow(/explain why/);
    const view = await svc.finance.settingsView(fd);
    expect(view.values.regularHighPct).toBe(15);
    expect(view.defaults.regularLowPct).toBe(10);
  });
});

describe('M2: every financial year ends 31 December unless the FD or the CEO changes it', () => {
  it('made-up companies end on 31 December; the FD changes one with a reason and history; a team member cannot', async () => {
    const { ds, svc, de1, fd } = await setup();
    expect(FIN_DEFAULT_YEAR_END).toBe('12-31');
    expect(ds.finStatus.every((f) => f.fyEnd === '12-31')).toBe(true);
    const co = ds.finStatus.find((f) => f.companyId !== T1)!;
    await expect(svc.finance.setSettings(de1, { values: { yearEnds: { [co.companyId]: '06-30' } }, comment: 'Try' })).rejects.toThrow();
    await expect(svc.finance.setSettings(fd, { values: { yearEnds: { [co.companyId]: '02-30' } }, comment: 'Wrong' })).rejects.toThrow(/MM-DD/);
    await expect(svc.finance.setSettings(fd, { values: { yearEnds: { [co.companyId]: '06-30' } } })).rejects.toThrow(/comment/i);
    await svc.finance.setSettings(fd, { values: { yearEnds: { [co.companyId]: '06-30' } }, comment: 'Acquired company keeps its June year end (mock).' });
    const after = ds.finStatus.find((f) => f.id === co.id)!;
    expect(after.fyEnd).toBe('06-30');
    expect(after.fyEndHistory?.[0]).toMatchObject({ from: '12-31', to: '06-30', comment: expect.stringMatching(/June/) });
    const row = (await svc.finance.settingsView(fd)).teams.find((t) => t.companyId === co.companyId)!;
    expect(row.fyEnd).toBe('06-30');
  });
});
