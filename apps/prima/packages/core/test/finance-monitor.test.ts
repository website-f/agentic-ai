import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  RULES,
  finCeoRow,
  finRetentionUpdateBy,
  finSettingsOf,
  finSiteBelowTarget,
  finSiteTargetFor,
  finUnbilledSites,
  generateDataset,
  myt,
  staffPartMonthPay,
  staffWorkingDays,
  epfShare,
  socsoShare,
  eisShare,
  hrdLevy,
} from '../src';
type Contract = import('../src').Contract;
type ClientAccount = import('../src').ClientAccount;
type FinClientDeposit = import('../src').FinClientDeposit;

// Finance rules confirmed by Fauzan (11 Nov 2026) and the monitoring builds F1-F3. Synthetic data only.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const C = 'co-09'; // Finance team 1

const sign = (byId = 'u-x', at = '2026-10-01T02:00:00.000Z') => ({ by: byId, byId, at, comment: '' });

const contract = (id: string, siteIds: string[], method: 'M1' | 'M2' | 'M3' | 'FIXED', over: Partial<Contract> = {}): Contract => ({
  id,
  companyId: C,
  clientAccountId: null,
  clientName: `Mock client ${id}`,
  siteIds,
  ref: id.toUpperCase(),
  state: 'active',
  startOn: '2025-01-01',
  endOn: '2027-12-31',
  versions: [
    {
      version: 1,
      effectiveFrom: '2025-01-01',
      billingMethod: method,
      posts: [{ postId: null, label: 'Main gate', guards: 1, hoursPerDay: 12, armed: false, rate: 10, ...(method === 'M2' ? { contractedHours: 300 } : {}) }],
      fixedFee: method === 'FIXED' ? 9000 : null,
      sla: { replaceAbsentMinutes: 30, incidentReportHours: 2, monthlyReportByDay: 10 },
      penalties: '',
      signedRef: 'SYNTH',
      reason: 'Synthetic',
      by: 'Test',
      at: '2025-01-01T00:00:00.000Z',
    },
  ],
  mobilisation: [],
  rtoCert: null,
  reviews: [],
  history: [],
  ...over,
});

describe('Finance rules confirmed by Fauzan, 11 Nov 2026', () => {
  it('carries the confirmed values as Policy', () => {
    expect(RULES.financePayments.value.ceoNoticeFrom).toBe(200_000);
    expect(RULES.financeIntercompany.value.explainMax).toBe(1000);
    expect(RULES.financeCash.value.pettyFloatMax).toBe(500);
    expect(RULES.financeCash.value.pettyVoucherMax).toBe(50);
    expect(RULES.staffPayroll.value.payDay).toBe(29);
    expect(RULES.financeForecast13.value.payDay).toBe(29);
    expect(RULES.insurancePremiumDays.value).toEqual({ firstDays: 30, secondDays: 14 });
    expect('maxDailyRate' in RULES.financeDailyCash.value).toBe(false);
    for (const r of [RULES.financePayments, RULES.financeControls, RULES.financeMoneyIn, RULES.financeYearEnd, RULES.financeDailyCash, RULES.financeIntercompany, RULES.financeForecast13, RULES.financeCash, RULES.insurancePremiumDays]) {
      expect(r.label).toBe('Policy');
      expect(r.source).toContain('Fauzan, 11 Nov 2026');
    }
  });

  it("part-month staff pay: (basic and fixed allowances) / the month's working days x working days employed, never more than the month", () => {
    // Fauzan, 14 Nov 2026: divide by that month's working days. November 2026 has 21 (Monday to Friday).
    expect(staffWorkingDays('2026-11-01', '2026-11-30')).toBe(21);
    // 2026-11-16 (Monday) to 2026-11-30 (Monday): 11 working days, no holidays given.
    expect(staffWorkingDays('2026-11-16', '2026-11-30')).toBe(11);
    const p = staffPartMonthPay(2600, 210, '2026-11-16', '2026-11-30', 21);
    expect(p.basic).toBe(1361.9);
    expect(p.allowances).toBe(110);
    expect(p.auto).toBe(true);
    expect(p.note).toMatch(/21 working days this month/);
    // A public holiday is not a working day.
    expect(staffPartMonthPay(2100, 0, '2026-11-16', '2026-11-30', 21, new Set(['2026-11-17'])).basic).toBe(1000);
    // A whole December (23 working days) pays the whole basic, never 23/26 of it.
    expect(staffWorkingDays('2026-12-01', '2026-12-31')).toBe(23);
    expect(staffPartMonthPay(2600, 0, '2026-12-01', '2026-12-31', 23).basic).toBe(2600);
  });

  it('settings take effect from a date, never backdated, and only the FD or the CEO sets them', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const [fd, lead] = await Promise.all([svc.user('u-fd'), svc.user('u-fin-t1-lead')]);
    await expect(svc.finance.setSettings(lead, { values: { icExplainMax: 2000 }, comment: 'Try' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.finance.setSettings(fd, { values: { icExplainMax: 2000 }, comment: 'Backdated', effectiveFrom: '2026-10-01' })).rejects.toThrow(/backdated/);
    await svc.finance.setSettings(fd, { values: { icExplainMax: 2000, ceoNoticeFrom: 150000 }, comment: 'From December', effectiveFrom: '2026-12-01' });
    expect((await svc.finance.settings()).icExplainMax).toBe(1000);
    const view = await svc.finance.settingsView(fd);
    expect(view.upcoming?.set.effectiveFrom).toBe('2026-12-01');
    expect(view.upcoming?.values.icExplainMax).toBe(2000);
    // A later change cannot take effect before the one already set.
    await expect(svc.finance.setSettings(fd, { values: { staffPayDay: 28 }, comment: 'Earlier' })).rejects.toThrow(/already takes effect on 2026-12-01/);
    const row = ds.finStatus.find((f) => f.companyId === 'pwvsb')!;
    expect(finSettingsOf(row, '2026-12-01').icExplainMax).toBe(2000);
    expect(finSettingsOf(row, '2026-11-30').icExplainMax).toBe(1000);
  });

  it('retention held by a client asks for a status update every 2 months until it is back', () => {
    const d: FinClientDeposit = {
      id: 'dep-1',
      companyId: C,
      contractId: null,
      client: 'Mock agency',
      kind: 'retention',
      amount: 5000,
      heldSince: '2026-01-10',
      dueBackOn: null,
      status: 'held',
      added: { ...sign('u-a', '2026-01-10T02:00:00.000Z'), doc: 'Clause 9' },
      checked: sign('u-b', '2026-01-12T02:00:00.000Z'),
      claim: null,
      refund: null,
      writtenOff: null,
    };
    expect(finRetentionUpdateBy(d)).toBe('2026-03-12');
    expect(finRetentionUpdateBy({ ...d, updates: [{ ...sign('u-a', '2026-05-02T02:00:00.000Z'), note: 'Final account with JKR' }] })).toBe('2026-07-02');
    expect(finRetentionUpdateBy({ ...d, status: 'refunded' })).toBeNull();
    expect(finRetentionUpdateBy({ ...d, kind: 'deposit' })).toBeNull();
  });
});

describe('F1 unbilled sites', () => {
  const sites = ['s-a', 's-b', 's-c', 's-d'].map((id) => ({ id, name: `Site ${id}`, companyId: C }));
  const base = {
    companyId: C,
    period: '2026-09',
    sites,
    contracts: [contract('ct-b', ['s-b'], 'M1'), contract('ct-c', ['s-c'], 'M1'), contract('ct-d', ['s-d'], 'FIXED')],
    clients: [] as ClientAccount[],
    clears: [],
  };
  const inv = (contractId: string, amount: number) => ({
    id: `bill-${contractId}-2026-09`,
    contractId,
    contractRef: contractId,
    client: 'x',
    period: '2026-09',
    expected: null,
    invoice: { no: `IV-${contractId}`, date: '2026-09-30', amount, note: '', by: 'DE1', byId: 'u-fin-t1-de1', at: '2026-10-01T02:00:00.000Z' },
    none: null,
    history: [],
  });

  it('starts from attendance: no contract, worked but not invoiced, no sign-off, and an invoice under hours worked', () => {
    const r = finUnbilledSites({
      ...base,
      hours: [
        { siteId: 's-a', hours: 120, guards: 2 },
        { siteId: 's-b', hours: 300, guards: 1 },
        { siteId: 's-c', hours: 300, guards: 1 },
        { siteId: 's-d', hours: 300, guards: 1 },
      ],
      billing: [inv('ct-c', 2500), inv('ct-d', 9000)],
    });
    const by = (id: string) => r.rows.find((x) => x.siteId === id)!;
    expect(by('s-a').flags.map((f) => f.kind)).toEqual(['no_contract']);
    expect(by('s-b').flags.map((f) => f.kind)).toEqual(['not_invoiced', 'no_signoff']);
    // Method 1: 300 hours x RM10 = RM3,000 expected; invoiced RM2,500.
    expect(by('s-c').expected).toBe(3000);
    expect(by('s-c').flags.find((f) => f.kind === 'under_billed')?.text).toContain('RM500.00 under');
    expect(by('s-c').hoursBilled).toBe(250);
    expect(by('s-c').hoursDifference).toBe(-50);
    expect(by('s-d').flags.map((f) => f.kind)).toEqual(['no_signoff']);
  });

  it('a site with guard hours and an invoice and a sign-off is not flagged; a cleared flag shows as cleared', () => {
    const clients = [{ id: 'acc-b', companyId: C, siteIds: ['s-b'], name: 'Mock client', workAcks: [{ period: '2026-09', at: NOW, by: 'OM', docId: 'd1', signer: 'Client admin', signedOn: '2026-10-02', outcome: 'satisfied', comment: 'No comment written', action: '' }] }] as unknown as ClientAccount[];
    const r = finUnbilledSites({ ...base, sites: [sites[1]], hours: [{ siteId: 's-b', hours: 300, guards: 1 }], billing: [inv('ct-b', 3000)], clients });
    expect(r.rows[0].flags).toEqual([]);
    const r2 = finUnbilledSites({ ...base, sites: [sites[1]], hours: [{ siteId: 's-b', hours: 300, guards: 1 }], billing: [], clients, clears: [{ key: '2026-09:s-b:not_invoiced', reason: 'Free month in contract', sign: sign('u-fin-t1-dep') }] });
    expect(r2.rows[0].flags[0].cleared?.reason).toBe('Free month in contract');
    expect(r2.open).toBe(0);
  });

  it('clearing needs a reason and a reviewer who did not record the invoice; an OM and another company are refused', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const site = { ...ds.sites.find((s) => s.companyId === 'co-sasa')!, id: 's-synth-1', companyId: C, name: 'Synthetic site' };
    ds.sites.push(site);
    ds.contracts.push(contract('ct-synth', [site.id], 'M1'));
    ds.attendance.push({ id: 'att-synth-1', companyId: C, siteId: site.id, shiftId: null, personId: 'p-synth', deviceId: 'dev', clockIn: '2026-09-05T00:00:00.000Z', clockOut: '2026-09-05T12:00:00.000Z', lat: null, lng: null, distanceM: null, photo: false, flags: [], locked: true });
    const f = ds.finStatus.find((x) => x.companyId === C)!;
    f.billing = [inv('ct-synth', 50)];
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const [de1, dep, om, cmSasa, lead2] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-om-klang', 'u-cm-sasa', 'u-fin-t2-lead'].map((id) => svc.user(id)));
    const view = await svc.unbilledSites(dep, '2026-09');
    const row = view.companies.find((c) => c.companyId === C)!.rows.find((r) => r.siteId === site.id)!;
    expect(row.flags.map((x) => x.kind)).toContain('under_billed');
    const input = { companyId: C, period: '2026-09', siteId: site.id, kind: 'under_billed' as const };
    await expect(svc.clearUnbilledFlag(dep, { ...input, reason: 'short' })).rejects.toThrow(/Say why/);
    await expect(svc.clearUnbilledFlag(de1, { ...input, reason: 'Agreed discount for September' })).rejects.toBeInstanceOf(AccessDenied);
    // Team 2 does not see team 1's company.
    await expect(svc.clearUnbilledFlag(lead2, { ...input, reason: 'Agreed discount for September' })).rejects.toThrow();
    expect((await svc.unbilledSites(lead2, '2026-09')).companies.some((c) => c.companyId === C)).toBe(false);
    await expect(svc.unbilledSites(om, '2026-09')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.unbilledSites(cmSasa, '2026-09')).companies.every((c) => c.companyId === 'co-sasa')).toBe(true);
    await svc.clearUnbilledFlag(dep, { ...input, reason: 'Agreed discount for September' });
    const after = (await svc.unbilledSites(dep, '2026-09')).companies.find((c) => c.companyId === C)!.rows.find((r) => r.siteId === site.id)!;
    expect(after.flags.find((x) => x.kind === 'under_billed')?.cleared?.sign.byId).toBe('u-fin-t1-dep');
    await expect(svc.clearUnbilledFlag(dep, { ...input, reason: 'Agreed discount for September' })).rejects.toThrow(/already cleared/);
  });

  it('refuses the recorder of the invoice', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const site = { ...ds.sites.find((s) => s.companyId === 'co-sasa')!, id: 's-synth-2', companyId: C, name: 'Synthetic site 2' };
    ds.sites.push(site);
    ds.contracts.push(contract('ct-synth2', [site.id], 'M1'));
    ds.attendance.push({ id: 'att-synth-2', companyId: C, siteId: site.id, shiftId: null, personId: 'p-synth', deviceId: 'dev', clockIn: '2026-09-05T00:00:00.000Z', clockOut: '2026-09-05T12:00:00.000Z', lat: null, lng: null, distanceM: null, photo: false, flags: [], locked: true });
    ds.finStatus.find((x) => x.companyId === C)!.billing = [{ ...inv('ct-synth2', 50), invoice: { ...inv('ct-synth2', 50).invoice, byId: 'u-fin-t1-dep' } }];
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const dep = await svc.user('u-fin-t1-dep');
    await expect(svc.clearUnbilledFlag(dep, { companyId: C, period: '2026-09', siteId: site.id, kind: 'under_billed', reason: 'Agreed discount for September' })).rejects.toThrow(/recorded the invoice/);
  });
});

describe('F2 profit per site against a target', () => {
  it('no target set: nothing flagged; a site under target is flagged with why', () => {
    expect(finSiteTargetFor(undefined, C)).toBeNull();
    const s = { revenue: 10000, marginPct: 8, clockedHours: 400, contractedHours: 366, costs: [{ label: 'Guard pay', amount: 8000 }, { label: 'Uniform', amount: null }] };
    expect(finSiteBelowTarget(s, null)).toBeNull();
    const t = { group: { pct: 15, set: sign() }, companies: { [C]: { pct: 10, set: sign() } }, history: [] };
    expect(finSiteTargetFor(t, C)).toEqual({ pct: 10, from: 'company' });
    expect(finSiteTargetFor(t, 'co-other')).toEqual({ pct: 15, from: 'group' });
    const b = finSiteBelowTarget(s, 10)!;
    expect(b.gap).toBe(2);
    expect(b.why[0]).toBe('400 hours paid against 366 hours billed');
    expect(finSiteBelowTarget({ ...s, marginPct: 12 }, 10)).toBeNull();
  });

  it('the site margin matches a hand calculation including employer EPF, SOCSO and EIS; only the FD or the CEO sets the target', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const tpl = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const site = { ...tpl, id: 's-synth-p', companyId: C, name: 'Synthetic profit site', sector: 'private' as const };
    ds.sites.push(site);
    ds.contracts.push(contract('ct-synth-p', [site.id], 'FIXED'));
    const ptpl = ds.people.find((p) => p.role === 'guard')!;
    const guard = { ...ptpl, id: 'p-synth-g', companyId: C, staffNo: 'SYN-001', basicPay: 2600, nationality: 'MY' as const, dob: '1990-01-01' };
    ds.people.push(guard);
    // 10 days of 8 hours in September (no overtime).
    for (let d = 1; d <= 10; d++) {
      const day = `2026-09-${String(d).padStart(2, '0')}`;
      ds.attendance.push({ id: `att-p-${d}`, companyId: C, siteId: site.id, shiftId: null, personId: guard.id, deviceId: 'dev', clockIn: `${day}T00:00:00.000Z`, clockOut: `${day}T08:00:00.000Z`, lat: null, lng: null, distanceM: null, photo: false, flags: [], locked: true });
    }
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const [fd, lead, coo, om] = await Promise.all(['u-fd', 'u-fin-t1-lead', 'u-coo', 'u-om-klang'].map((id) => svc.user(id)));
    await expect(svc.setSiteTarget(lead, { companyId: null, pct: 12, reason: 'Group target for the year' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setSiteTarget(fd, { companyId: null, pct: 12, reason: 'short' })).rejects.toThrow(/Say why/);
    await expect(svc.siteProfit(om, '2026-09')).rejects.toBeInstanceOf(AccessDenied);
    let v = await svc.siteProfit(fd, '2026-09');
    let s = v.sites.find((x) => x.siteId === site.id)!;
    expect(s.target).toBeNull();
    expect(s.belowTarget).toBeNull();
    // Hand calculation: revenue RM9,000; guard pay 80 h x 2600/26/8 = RM1,000; employer shares on the month's pay.
    const statutory = epfShare(2600, 36, 'MY').er + socsoShare(2600, 36).er + eisShare(2600, 36, 'MY').er + hrdLevy(2600, 'MY');
    expect(s.revenue).toBe(9000);
    expect(s.guardCost).toBe(1000);
    expect(s.statutory).toBeCloseTo(statutory, 1);
    const fee = s.managementFeeInProfit ? (s.managementFee ?? 0) : 0;
    expect(s.margin).toBeCloseTo(9000 - 1000 - statutory - s.hostel - s.itemCharges - fee - (s.otherFees ?? 0), 1);
    // Uniform and equipment rates not entered: "rate not set", never zero.
    expect(s.sharedCosts.find((x) => x.kind === 'uniform')?.amount).toBeNull();
    expect(s.notes.some((n) => /Uniform: rate not set/.test(n))).toBe(true);
    await svc.setSiteCostRates(fd, { rates: { uniform: 26, equipment: 0 }, reason: 'Store issue price list 2026' });
    await svc.setSiteTarget(fd, { companyId: C, pct: 95, reason: 'Synthetic high target to test the flag' });
    v = await svc.siteProfit(coo, '2026-09');
    s = v.sites.find((x) => x.siteId === site.id)!;
    expect(s.sharedCosts.find((x) => x.kind === 'uniform')?.amount).toBe(26);
    expect(s.target).toEqual({ pct: 95, from: 'company' });
    expect(s.belowTarget?.target).toBe(95);
    expect(v.belowTarget).toBeGreaterThan(0);
  });
});

describe('F3 one page a month for the CEO', () => {
  it('a SQL figure older than 48 hours is Unknown; red only for the five things', () => {
    const x = { companyId: C, company: 'Mock', sqlLastAt: '2026-10-28T00:00:00.000Z', cash: 1000, firstShortWeek: '2026-11-16', due30: 10, over90: 5, daysToCollect: 40, banks: [{ reconciledTo: '2026-09-30' }, { reconciledTo: null }], closeStatus: 'open', openExceptions: 3, unbilledSites: 0, belowTarget: 0, packReviewed: null };
    const stale = finCeoRow(x, '2026-09', TODAY, NOW);
    expect(stale.cash).toBeNull();
    expect(stale.over90).toBeNull();
    expect(stale.daysToCollect).toBeNull();
    expect(stale.red.sort()).toEqual(['bankRec', 'cash', 'close']);
    const fresh = finCeoRow({ ...x, sqlLastAt: '2026-10-31T00:00:00.000Z', firstShortWeek: '2027-01-04', banks: [{ reconciledTo: '2026-09-30' }], closeStatus: 'approved', unbilledSites: 2 }, '2026-09', TODAY, NOW);
    expect(fresh.cash).toBe(1000);
    expect(fresh.red).toEqual(['unbilled']);
  });

  it('the CEO, the FD and the Chairman see the group; a team its own; an OM and a company manager are refused', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const [ceo, chair, lead1, om, cm] = await Promise.all(['u-fauzan', 'u-chair', 'u-fin-t1-lead', 'u-om-klang', 'u-cm-sasa'].map((id) => svc.user(id)));
    const all = await svc.ceoFinanceSummary(ceo);
    expect(all.rows.length).toBeGreaterThan(3);
    expect((await svc.ceoFinanceSummary(chair)).rows.length).toBe(all.rows.length);
    const t1 = await svc.ceoFinanceSummary(lead1);
    const team1 = ds.finStatus.filter((f) => f.team === 1 && f.companyId !== 'pwvsb').map((f) => f.companyId);
    expect(t1.rows.every((r) => team1.includes(r.companyId))).toBe(true);
    await expect(svc.ceoFinanceSummary(om)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.ceoFinanceSummary(cm)).rejects.toBeInstanceOf(AccessDenied);
    // The counts match F1 for the same data.
    const f1 = await svc.unbilledSites(ceo, all.period);
    expect(all.totals.unbilledSites).toBe(f1.sitesFlagged);
  });
});
