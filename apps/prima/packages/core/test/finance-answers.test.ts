import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finCapitalAllowances, finIsSme, generateDataset, myt } from '../src';

// Fauzan's answers to the Finance questions (2 Nov 2026): the FD moves companies between teams, sets the petty cash
// limits and the budget day; credit limits by the FD or CEO only; Prima or Teams chosen per payment; company tax size
// (SME) for capital allowances; next year's budget by 10 December. Dummy data only.
const C = GROUP_EMPLOYER_ID;

function setup(today = '2026-11-03') {
  const ds = generateDataset({ today: '2026-10-31', now: myt('2026-10-31', '10:00') });
  const store = new MemoryStore(ds);
  let now = myt(today, '10:00');
  const svc = new PrimaService(store, () => now);
  return { ds, store, svc, setDay: (d: string) => (now = myt(d, '10:00')) };
}
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));

describe('Finance settings set by the Finance Director', () => {
  it('moves a company to another team with a comment; only the FD or the CEO can', async () => {
    const { store, svc } = setup();
    const [fd, lead] = await who(svc, 'u-fd', 'u-fin-t1-lead');
    const v = await svc.finance.settingsView(fd);
    const row = v.teams.find((t) => t.companyId === 'co-sasa')!;
    const to = row.team === 7 ? 6 : 7;
    expect((await svc.finance.settingsView(lead)).teams).toEqual([]);
    await expect(svc.finance.setSettings(lead, { comment: 'Move it please', values: { teams: { 'co-sasa': to } } })).rejects.toThrow();
    await expect(svc.finance.setSettings(fd, { comment: 'New year split', values: { teams: { 'co-sasa': 8 } } })).rejects.toThrow(/1 to 7/);
    await svc.finance.setSettings(fd, { comment: 'New year split for 2027', values: { teams: { 'co-sasa': to } } });
    expect((await store.get('finStatus', 'fin-co-sasa'))!.team).toBe(to);
  });

  it('uses the petty cash limits the FD sets', async () => {
    const { ds, svc } = setup();
    const [fd, de1] = await who(svc, 'u-fd', 'u-fin-t1-de1');
    await expect(svc.finance.setSettings(fd, { comment: 'Petty cash limits', values: { pettyFloatMax: -1 } })).rejects.toThrow();
    await svc.finance.setSettings(fd, { comment: 'Smaller floats for 2027', values: { pettyFloatMax: 800, pettyVoucherMax: 200 } });
    expect((await svc.finance.settingsView(fd)).values).toMatchObject({ pettyFloatMax: 800, pettyVoucherMax: 200 });
    const f = ds.finStatus.find((x) => x.companyId === C)!;
    const base = f.payees!.find((x) => x.id === 'payee-pwvsb-001')!;
    f.payees = [...f.payees!, { ...base, id: 'payee-staff-hr', name: 'PWVSB HR', kind: 'payroll', entered: { ...base.entered, byId: 'u-fin-t1-lead' } }];
    await expect(
      svc.financeControls.pettyAction(de1, C, 'add', {
        office: 'HQ (mock)',
        custodianId: 'u-pwvsb-hr',
        payeeId: 'payee-staff-hr',
        bankId: f.banks[0].id,
        float: 1000,
      }),
    ).rejects.toThrow(/RM800\.00/);
  });
});

describe('Credit limits are set by the Finance Director or the CEO only', () => {
  it('refuses the team leader', async () => {
    const { svc } = setup();
    const [lead, ceo] = await who(svc, 'u-fin-t4-lead', 'u-fauzan');
    await expect(
      svc.financeControls.creditAction(lead, 'co-sasa', 'limit', { clientAccountId: 'cl-st-sasa-002', limit: 5000, comment: 'Two months of billing' }),
    ).rejects.toThrow(/Finance Director or the CEO/);
    await svc.financeControls.creditAction(ceo, 'co-sasa', 'limit', { clientAccountId: 'cl-st-sasa-002', limit: 5000, comment: 'Two months of billing' });
  });
});

describe('Prima or Teams chosen for each payment', () => {
  const input = (ds: ReturnType<typeof generateDataset>, over: Record<string, unknown> = {}) => ({
    payeeId: 'payee-pwvsb-001',
    purpose: 'Stationery',
    amount: 300,
    dueOn: '2026-11-15',
    bankId: ds.finStatus.find((x) => x.companyId === C)!.banks[0].id,
    sqlRef: 'PI-ANS-1',
    evidence: ['invoice.pdf'],
    ...over,
  });
  it('lets the preparer pick Teams only when the connection is on', async () => {
    const { ds, svc } = setup();
    const [de1] = await who(svc, 'u-fin-t1-de1');
    await expect(svc.finance.createPayment(de1, C, { ...input(ds), approvalMethod: 'teams' })).rejects.toThrow(/not switched on/);
    svc.teamsApprovals = true;
    expect((await svc.finance.createPayment(de1, C, { ...input(ds, { sqlRef: 'PI-ANS-2', amount: 310 }), approvalMethod: 'teams' })).approvalMethod).toBe('teams');
    expect((await svc.finance.createPayment(de1, C, { ...input(ds, { sqlRef: 'PI-ANS-3', amount: 320 }), approvalMethod: 'prima' })).approvalMethod).toBe('prima');
  });
});

describe('Company tax size (SME) for capital allowances', () => {
  it('only the FD or CEO records it; an SME is not capped on small-value assets', async () => {
    expect(finIsSme({ paidUp: 1_100_000, grossIncome: 20_000_000, bigRelated: false })).toBe(true);
    expect(finIsSme({ paidUp: 5_000_000, grossIncome: 20_000_000, bigRelated: false })).toBe(false);
    expect(finIsSme({ paidUp: 1_100_000, grossIncome: 20_000_000, bigRelated: true })).toBe(false);
    const { svc } = setup();
    const [lead, fd] = await who(svc, 'u-fin-t1-lead', 'u-fd');
    const p = { paidUp: 1_100_000, grossIncome: 20_000_000, bigRelated: false, comment: 'SSM form and 2025 accounts' };
    await expect(svc.financeControls.assetAction(lead, C, 'profile', p)).rejects.toThrow(/tax size/);
    expect(await svc.financeControls.assetAction(fd, C, 'profile', p)).toMatchObject({ sme: true });
    const small = Array.from({ length: 30 }, (_, i) => ({
      id: `a${i}`,
      name: 'Chair',
      cost: 1500,
      acquiredOn: '2026-03-01',
      cls: 'small_value' as const,
    }));
    const notSme = finCapitalAllowances(small as never, 2026, false);
    const sme = finCapitalAllowances(small as never, 2026, true);
    expect(notSme.smallValueOverCap).toBe(25000);
    expect(sme.smallValueOverCap).toBe(0);
  });
});

describe("Next year's budget by 10 December", () => {
  it('reminds Finance from November, and turns red after the day', async () => {
    const { svc, setDay } = setup('2026-11-03');
    const [fd] = await who(svc, 'u-fd');
    const item = async () => (await svc.financeControls.home(fd)).find((t) => /without a 2027 budget submitted/.test(t.title));
    expect((await item())?.tone).toBe('warn');
    setDay('2026-12-11');
    expect((await item())?.tone).toBe('crit');
    setDay('2026-10-20');
    expect(await item()).toBeUndefined();
  });
});
