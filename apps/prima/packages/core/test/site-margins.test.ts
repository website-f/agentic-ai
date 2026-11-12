import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, eisShare, epfShare, generateDataset, hrdLevy, myt, socsoShare } from '../src';

// F2 (Fauzan, 11 Nov 2026): profit per site with a target margin, overtime from the pay law, shared costs from the rate
// book. Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');
const M = '2026-10';

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const fin = ds.finStatus.find((f) => ds.sites.some((s) => s.companyId === f.companyId) && ds.contracts.some((c) => c.companyId === f.companyId))!;
  const co = fin.companyId;
  const base = ds.sites.find((s) => s.companyId === co)!;
  ds.sites.push({ ...base, id: 'site-syn-m', name: 'Synthetic margin site' });
  const p0 = ds.people.find((p) => p.companyId === co)!;
  ds.people.push({ ...p0, id: 'p-syn-m', staffNo: 'SYN-M-1', name: 'Synthetic Guard', basicPay: 1950, nationality: 'MY', dob: '1990-01-01', status: 'active' } as typeof p0);
  const a0 = ds.attendance.find((a) => a.companyId === co) ?? ds.attendance[0];
  for (let d = 1; d <= 10; d++)
    ds.attendance.push({
      ...a0,
      id: `att-syn-m-${d}`,
      companyId: co,
      siteId: 'site-syn-m',
      personId: 'p-syn-m',
      shiftId: null,
      clockIn: `${M}-${String(d).padStart(2, '0')}T07:00:00.000+08:00`,
      clockOut: `${M}-${String(d).padStart(2, '0')}T19:00:00.000+08:00`,
    } as typeof a0);
  const c0 = ds.contracts.find((c) => c.companyId === co)!;
  const v0 = c0.versions[0];
  ds.contracts.push({
    ...c0,
    id: 'ct-syn-m',
    ref: 'SYN-M',
    siteIds: ['site-syn-m'],
    state: 'active',
    startOn: '2026-01-01',
    endOn: '2027-12-31',
    endedOn: null,
    clientAccountId: null,
    versions: [{ ...v0, effectiveFrom: '2026-01-01', billingMethod: 'M2', fixedFee: null, posts: [{ ...v0.posts[0], guards: 1, hoursPerDay: 12, contractedHours: 120, rate: 20 }] }],
  } as typeof c0);
  fin.rateLog = (['uniform', 'equipment'] as const).map((key, i) => ({ key, scope: 'group' as const, from: '2026-01', amount: [30, 20][i], reason: 'Synthetic', by: 'FD', byId: 'u-fd', at: NOW }));
  const store = new MemoryStore(ds);
  let tick = 0;
  const svc = new PrimaService(store, () => myt(TODAY, `10:${String(tick++ % 60).padStart(2, '0')}`));
  return { ds, store, svc, co, sector: (base.sector ?? 'private') as 'government' | 'private' };
}

describe('F2 profit per site', () => {
  it('matches a hand calculation with EPF, SOCSO, EIS, the rate book costs, and says "target not set" until the FD sets one', async () => {
    const { svc, co, sector } = setup();
    const fd = await svc.user('u-fd');
    // A management fee is entered (not taken off site profit), so the margin is complete.
    await svc.setManagementFee(fd, co, { chargedBy: sector === 'government' ? 'goodwill' : 'sasateam', kind: 'fixed', value: 100, agreementRef: 'SYN-FEE', reason: 'Synthetic', from: M, inSiteProfit: false });
    const r = await svc.siteMargins(fd, M);
    const s = r.sites.find((x) => x.siteId === 'site-syn-m')!;
    // 10 days of 12 hours: 80 normal, 40 overtime; hourly RM1,950 / 26 / 8 = RM9.375; overtime at 1.5x (pay law).
    const pay = 80 * 9.375 + 40 * 9.375 * 1.5;
    const gross = 1950 + 40 * 9.375 * 1.5;
    const statutory = epfShare(gross, 36, 'MY').er + socsoShare(gross, 36).er + eisShare(gross, 36, 'MY').er + hrdLevy(1950, 'MY');
    const expected = Math.round((2400 - pay - statutory - 50) * 100) / 100;
    expect(s.revenue).toBe(2400);
    expect(s.guardCost).toBe(pay);
    expect(s.sharedCost).toBe(50);
    expect(s.margin).toBeCloseTo(expected, 2);
    expect(s.targetPct).toBeNull();
    expect(s.belowTarget).toBe(false);
    expect(r.targetNotSet).toBeGreaterThan(0);
    expect(r.otRate).toBe(1.5);
    expect(r.basis).toMatch(/SQL Account is the book of record/);

    // The target needs the FD or the CEO, with a reason.
    const coo = await svc.user('u-coo');
    await expect(svc.setRate(coo, { key: 'target_margin', companyId: co, from: M, amount: 30, reason: 'Synthetic' })).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.setRate(fd, { key: 'target_margin', companyId: co, from: M, amount: 30, reason: '' })).rejects.toThrow(/reason/);
    await svc.setRate(fd, { key: 'target_margin', companyId: co, from: M, amount: 30, reason: 'Synthetic: board target' });
    const r2 = await svc.siteMargins(coo, M);
    const s2 = r2.sites.find((x) => x.siteId === 'site-syn-m')!;
    expect(s2.targetPct).toBe(30);
    expect(s2.belowTarget).toBe(true);
    expect(s2.why[0]).toMatch(/below the target 30%/);
    expect(s2.why.join(' ')).toMatch(/Hours paid 120 h against hours billed 120 h/);
  });

  it('leaves a site Unknown when a rate is not set, and refuses an OM and a company manager', async () => {
    const { ds, svc } = setup();
    for (const f of ds.finStatus) f.rateLog = [];
    const fd = await svc.user('u-fd');
    const s = (await svc.siteMargins(fd, M)).sites.find((x) => x.siteId === 'site-syn-m')!;
    expect(s.sharedCost).toBeNull();
    expect(s.tone).toBe('unknown');
    expect(s.notes.join(' ')).toMatch(/Rate not set: Uniform, per guard, Equipment, per guard/);
    const om = ds.users.find((u) => u.opsTier === 'om')!;
    await expect(svc.siteMargins(await svc.user(om.id), M)).rejects.toThrow(/profit per site/);
    const cm = ds.users.find((u) => u.role === 'company_manager')!;
    await expect(svc.siteMargins(await svc.user(cm.id), M)).rejects.toThrow(/profit per site/);
  });
});
