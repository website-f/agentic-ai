import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, ageOn, generateDataset, myt, type Contract } from '../src';
import { eisShare, epfShare, hrdLevy, socsoShare } from '../src/payroll';

// Government Operations monitor (Fauzan, 2 Nov 2026): site profit and loss, salary check and guards on leave.
// Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');

async function setup(fee: number, mgmt: { kind: 'percent' | 'fixed'; value: number } | null = { kind: 'percent', value: 10 }) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const om = await svc.user('u-om-klang');
  // A government site in the OM's area (Selangor or Kuala Lumpur).
  const branches = new Map(ds.branches.map((b) => [b.id, b.state]));
  const site = ds.sites.find(
    (s) => s.sector === 'government' && ['Selangor', 'Kuala Lumpur'].includes(s.state ?? branches.get(s.branchId) ?? ''),
  )!;
  for (const c of ds.contracts.filter((c) => c.siteIds.includes(site.id))) await store.update('contracts', c.id, { siteIds: c.siteIds.filter((x) => x !== site.id) });
  const base = ds.contracts[0];
  const contract: Contract = {
    ...base,
    id: 'ct-synthetic-gov',
    companyId: site.companyId,
    clientAccountId: null,
    clientName: 'Synthetic ministry',
    siteIds: [site.id],
    ref: 'SYN-1',
    state: 'active',
    startOn: '2026-01-01',
    endOn: '2027-12-31',
    versions: [{ ...base.versions[0], version: 1, effectiveFrom: '2026-01-01', billingMethod: 'FIXED', fixedFee: fee, posts: [] }],
  };
  await store.insert('contracts', contract);
  // Only our synthetic guard works this site in October: 27 days of 12 hours (4 h overtime a day = 108 h).
  for (const a of ds.attendance.filter((a) => a.siteId === site.id)) await store.update('attendance', a.id, { siteId: 'elsewhere' });
  const guard = ds.people.find((p) => p.companyId === site.companyId && p.role === 'guard' && p.status === 'active')!;
  await store.update('people', guard.id, { basicPay: 2080 });
  // The guard works nowhere else this month, so their whole month's pay and costs belong to this site.
  for (const a of ds.attendance.filter((a) => a.personId === guard.id)) await store.update('attendance', a.id, { personId: 'p-elsewhere' });
  for (const x of ds.shifts.filter((x) => x.personId === guard.id)) await store.update('shifts', x.id, { personId: null });
  for (let d = 1; d <= 27; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    await store.insert('attendance', {
      id: `att-syn-${d}`,
      companyId: site.companyId,
      siteId: site.id,
      shiftId: null,
      personId: guard.id,
      deviceId: 'synthetic',
      clockIn: myt(day, '07:00'),
      clockOut: myt(day, '19:00'),
      lat: null,
      lng: null,
      distanceM: null,
      photo: true,
      flags: [],
      locked: true,
    });
  }
  // Management fee as Finance would enter it from the (synthetic) agreement.
  await store.update('finStatus', `fin-${site.companyId}`, {
    managementFees: { goodwill: mgmt ? { ...mgmt, agreementRef: 'SYN-MA-1', by: 'Synthetic', at: NOW } : null },
  });
  // Our guard stays in no hostel unless a test puts them in one.
  for (const h of ds.hostelStays.filter((x) => x.personId === guard.id)) await store.update('hostelStays', h.id, { personId: 'elsewhere' });
  return { ds, store, svc, om, site, guard };
}

describe('Government Operations monitor', () => {
  it('works out site profit and loss from the contract, guard hours and pay', async () => {
    const { svc, om, site, guard } = await setup(100_000);
    const r = await svc.govOpsMonitor(om, '2026-10');
    const row = r.sites.find((x) => x.siteId === site.id)!;
    // 2080 / 26 / 8 = 10 an hour: 27 x 8 normal = 2160, 27 x 4 OT x 15 = 1620.
    expect(row.revenue).toBe(100_000);
    expect(row.revenueBasis).toBe('contract');
    expect(row.guardCost).toBe(3780);
    // Employer EPF, SOCSO, EIS and levy on the expected pay (basic 2080 + OT 1620), from Prima's statutory tables.
    const age = guard.dob ? ageOn(guard.dob, '2026-10-31') : 30;
    const wage = 3700;
    const levy = guard.nationality === 'MY' ? hrdLevy(2080, guard.nationality) : 1850 / 12;
    const er = epfShare(wage, age, guard.nationality).er + socsoShare(wage, age).er + eisShare(wage, age, guard.nationality).er + levy;
    expect(row.statutory).toBeCloseTo(er, 2);
    expect(row.statutory).toBeGreaterThan(0);
    expect(row.hostel).toBe(0);
    expect(row.managementFee).toBe(10_000);
    expect(row.margin).toBeCloseTo(100_000 - 3780 - row.statutory - row.itemCharges - 10_000, 2);
    expect(row.tone).toBe('ok');
    expect(row.notes).toContain('No invoice recorded for the month, so the contract value is used');
    expect(r.notes.join(' ')).toMatch(/employer EPF, SOCSO and EIS/);
  });

  it('is Unknown until Finance enters the management fee, and a fixed fee is shared across the company\'s government sites', async () => {
    const { svc, store, om, site, ds } = await setup(100_000, null);
    let row = (await svc.govOpsMonitor(om, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    expect(row.managementFee).toBeNull();
    expect(row.tone).toBe('unknown');
    expect(row.notes).toContain('Management fee not entered by Finance yet');
    await store.update('finStatus', `fin-${site.companyId}`, {
      managementFees: { goodwill: { kind: 'fixed', value: 6000, agreementRef: 'SYN-MA-2', by: 'Synthetic', at: NOW } },
    });
    row = (await svc.govOpsMonitor(om, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    expect(row.managementFee).not.toBeNull();
    expect(row.managementFee!).toBeGreaterThan(0);
    expect(row.managementFee!).toBeLessThanOrEqual(6000);
    // Only this site has clocked hours among the company's government sites in our setup? Then it carries the share by hours.
    const govIds = ds.sites.filter((s) => s.companyId === site.companyId && s.sector === 'government').map((s) => s.id);
    if (govIds.length === 1) expect(row.managementFee).toBe(6000);
  });

  it('uses the invoice for the month when Finance has recorded it, and shares hostel bills by the people staying', async () => {
    const { svc, store, om, site, guard, ds } = await setup(100_000);
    for (const a of ds.clientAccounts.filter((a) => a.siteIds.includes(site.id))) await store.update('clientAccounts', a.id, { siteIds: a.siteIds.filter((x) => x !== site.id) });
    const acc = ds.clientAccounts[0];
    await store.insert('clientAccounts', {
      ...acc,
      id: 'ca-synthetic-gov',
      companyId: site.companyId,
      name: 'Synthetic ministry',
      siteIds: [site.id],
      invoices: [
        { period: '2026-10', amount: 95_000, at: myt('2026-11-01', '09:00'), by: 'Synthetic', hand: null, email: null, portal: null },
        { period: '2026-09', amount: 1, at: myt('2026-10-01', '09:00'), by: 'Synthetic', hand: null, email: null, portal: null },
      ],
    });
    const hostel = ds.hostels[0];
    for (const h of ds.hostelStays.filter((x) => x.hostelId === hostel.id)) await store.update('hostelStays', h.id, { hostelId: 'elsewhere' });
    for (const b of ds.hostelBills.filter((x) => x.hostelId === hostel.id)) await store.update('hostelBills', b.id, { hostelId: 'elsewhere' });
    await store.insert('hostelStays', { id: 'hst-syn-1', companyId: site.companyId, hostelId: hostel.id, personId: guard.id, personName: guard.name, from: '2026-01-01', to: null });
    await store.insert('hostelStays', { id: 'hst-syn-2', companyId: site.companyId, hostelId: hostel.id, personId: 'p-synthetic-other', personName: 'Other', from: '2026-01-01', to: null });
    const bill = {
      id: 'hb-syn-1',
      companyId: site.companyId,
      hostelId: hostel.id,
      kind: 'RENT' as const,
      period: '2026-10',
      amount: 4000,
      dueOn: '2026-10-07',
      status: 'paid' as const,
      billDocIds: [],
      request: null,
      fwmCheck: null,
      sectorApproval: null,
      cooApproval: null,
      slip: null,
      returned: null,
      createdBy: 'Synthetic',
      createdAt: NOW,
    };
    await store.insert('hostelBills', bill);
    // A returned bill is not a cost.
    await store.insert('hostelBills', { ...bill, id: 'hb-syn-2', amount: 999, status: 'returned' as const });
    const row = (await svc.govOpsMonitor(om, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    expect(row.revenue).toBe(95_000);
    expect(row.revenueBasis).toBe('invoice');
    expect(row.notes).not.toContain('No invoice recorded for the month, so the contract value is used');
    // RM4,000 shared by two people staying: RM2,000 for our guard, all of it on this site.
    expect(row.hostel).toBe(2000);
    expect(row.managementFee).toBe(9500);
    expect(row.margin).toBeCloseTo(95_000 - 3780 - row.statutory - 2000 - row.itemCharges - 9500, 2);
  });

  it('lets only the Finance Director or the CEO enter a management fee, with the agreement reference, and audits it', async () => {
    const { svc, store, site } = await setup(100_000, null);
    const fd = await svc.user('u-fd');
    const ceo = await svc.user('u-fauzan');
    for (const id of ['u-om-klang', 'u-ogm', 'u-coo', 'u-chair']) {
      const u = await svc.user(id).catch(() => null);
      if (!u) continue;
      await expect(svc.setManagementFee(u, site.companyId, { chargedBy: 'goodwill', kind: 'percent', value: 10, agreementRef: 'SYN', reason: 'Synthetic reason' })).rejects.toThrow();
      await expect(svc.managementFees(u)).rejects.toThrow();
    }
    await expect(svc.setManagementFee(fd, site.companyId, { chargedBy: 'goodwill', kind: 'percent', value: 120, agreementRef: 'SYN', reason: 'Synthetic reason' })).rejects.toThrow(/between 0 and 100/);
    await expect(svc.setManagementFee(fd, site.companyId, { chargedBy: 'goodwill', kind: 'fixed', value: 0, agreementRef: 'SYN', reason: 'Synthetic reason' })).rejects.toThrow(/monthly amount/);
    await expect(svc.setManagementFee(fd, site.companyId, { chargedBy: 'goodwill', kind: 'percent', value: 8, agreementRef: '  ', reason: 'Synthetic reason' })).rejects.toThrow(/agreement reference/);
    await expect(svc.setManagementFee(fd, site.companyId, { chargedBy: 'goodwill', kind: 'other' as 'fixed', value: 8, agreementRef: 'SYN', reason: 'Synthetic reason' })).rejects.toThrow(/percentage of billing/);
    await expect(svc.setManagementFee(fd, 'co-nope', { chargedBy: 'goodwill', kind: 'percent', value: 8, agreementRef: 'SYN', reason: 'Synthetic reason' })).rejects.toThrow(/Choose a company/);
    const f = await svc.setManagementFee(fd, site.companyId, { chargedBy: 'goodwill', kind: 'percent', value: 8, agreementRef: 'SYN-MA-9', reason: 'Synthetic reason' });
    expect(f.managementFees?.goodwill).toMatchObject({ kind: 'percent', value: 8, agreementRef: 'SYN-MA-9', by: fd.name });
    await svc.setManagementFee(ceo, site.companyId, { chargedBy: 'goodwill', kind: 'fixed', value: 5000, agreementRef: 'SYN-MA-10', reason: 'Synthetic reason' });
    const list = await svc.managementFees(fd);
    expect(list.companies.find((x) => x.companyId === site.companyId)?.fees.find((x) => x.chargedBy === 'goodwill')?.now).toMatchObject({ kind: 'fixed', value: 5000 });
    const audit = (await store.list('audit', {})).filter((a) => a.action === 'fin.management_fee');
    const payer = (await store.get('companies', site.companyId))!.name;
    expect(audit.map((a) => a.summary)).toEqual([
      `Management fee Goodwill Empire Sdn Bhd bills ${payer} set to 8% of billing (agreement SYN-MA-9), taken off site profit and loss, from 2026-11, was no fee. Reason: Synthetic reason`,
      `Management fee Goodwill Empire Sdn Bhd bills ${payer} set to RM5000.00 a month (agreement SYN-MA-10), taken off site profit and loss, from 2026-11, was 8% of billing (taken off site profit). Reason: Synthetic reason`,
    ]);
  });

  it('marks a loss, and shows Unknown when there is no contract', async () => {
    const { svc, store, om, site } = await setup(1000);
    let row = (await svc.govOpsMonitor(om, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    expect(row.tone).toBe('crit');
    expect(row.margin).toBeLessThan(0);
    await store.update('contracts', 'ct-synthetic-gov', { siteIds: [] });
    row = (await svc.govOpsMonitor(om, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    expect(row.tone).toBe('unknown');
    expect(row.revenue).toBeNull();
    expect(row.notes).toContain('No contract recorded for this site');
  });

  it('checks each guard\'s pay from the hours worked and flags overtime over 104 hours', async () => {
    const { svc, store, om, guard } = await setup(100_000);
    let p = (await svc.govOpsMonitor(om, '2026-10')).pay.find((x) => x.personId === guard.id)!;
    expect(p.overtimeHours).toBe(108);
    expect(p.overtimePay).toBe(1620);
    expect(p.expectedGross).toBe(2080 + 1620);
    expect(p.jaGross).toBeNull();
    expect(p.flags.join(' ')).toMatch(/over the 104 h monthly limit/);
    await store.update('people', guard.id, { basicPay: undefined });
    p = (await svc.govOpsMonitor(om, '2026-10')).pay.find((x) => x.personId === guard.id)!;
    expect(p.tone).toBe('unknown');
    expect(p.expectedGross).toBeNull();
  });

  it('compares each guard\'s pay from the JA Group app feed with the hours clocked', async () => {
    const { svc, store, om, guard, ds } = await setup(100_000);
    const ja = await svc.user('u-ja-sync');
    const code = ds.companies.find((c) => c.id === guard.companyId)!.code;
    const record = (over: Record<string, unknown>) => ({
      externalId: `ps-${guard.staffNo}-2026-10`,
      company: code,
      updatedAt: '2026-11-01T02:00:00Z',
      staffNo: guard.staffNo,
      period: '2026-10',
      basic: 2080,
      otHours: 108,
      otPay: 1620,
      allowances: 150,
      deductions: [{ kind: 'EPF', amount: 407 }],
      gross: 3850,
      net: 3443,
      paidOn: '2026-11-07',
      ...over,
    });
    // Bad records are refused with a reason, never kept.
    const bad = await svc.jaIngest(ja, 'paySummary', [record({ externalId: 'ps-bad', otHours: -1 }), record({ externalId: 'ps-bad2', period: '2026-13' })]);
    expect(bad.accepted).toBe(0);
    expect(bad.rejected.map((r) => r.reason)).toEqual(['otHours must be a number of hours.', 'period must be a month like 2026-10.']);
    // Only the JA feed may send it.
    await expect(svc.jaIngest(om, 'paySummary', [record({})])).rejects.toThrow(/JA Group app feed/);
    await svc.jaIngest(ja, 'paySummary', [record({})]);
    let p = (await svc.govOpsMonitor(om, '2026-10')).pay.find((x) => x.personId === guard.id)!;
    expect(p.jaGross).toBe(3850);
    expect(p.difference).toBe(0);
    expect(p.flags.join(' ')).not.toMatch(/JA/);
    // JA paid less overtime than the hours clocked give.
    await svc.jaIngest(ja, 'paySummary', [record({ updatedAt: '2026-11-01T03:00:00Z', otHours: 100, otPay: 1500, gross: 3730 })]);
    p = (await svc.govOpsMonitor(om, '2026-10')).pay.find((x) => x.personId === guard.id)!;
    expect(p.difference).toBe(-120);
    expect(p.flags).toContain('JA basic and overtime RM120.00 less than the hours clocked give');
    expect(p.flags).toContain('JA paid 100 h overtime, Prima has 108 h clocked');
    expect((await store.list('jaSyncs', {})).some((x) => x.dataset === 'paySummary')).toBe(true);
  });

  it('lists guards of these sites on leave today', async () => {
    const { svc, store, om, guard } = await setup(100_000);
    await store.insert('leaveRequests', {
      id: 'lv-syn-1',
      companyId: guard.companyId,
      personId: guard.id,
      kind: 'ANNUAL',
      from: '2026-11-01',
      to: '2026-11-03',
      days: 3,
      reason: 'Synthetic',
      proofIds: [],
      requestedAt: myt('2026-10-20', '09:00'),
      requestedBy: 'Synthetic',
      via: 'company',
      status: 'approved',
      decidedBy: 'Synthetic OM',
      decidedAt: myt('2026-10-21', '09:00'),
      decisionNote: null,
    });
    const r = await svc.govOpsMonitor(om, '2026-10');
    const l = r.leave.find((x) => x.id === 'lv-syn-1')!;
    expect(l).toMatchObject({ onLeaveToday: true, status: 'approved', kind: 'ANNUAL', companyId: guard.companyId });
    expect(r.totals!.onLeaveToday).toBeGreaterThanOrEqual(1);
    // Leave of someone who never worked or was rostered on these sites is not listed.
    const rostered = new Set((await store.list('shifts', {})).map((x) => x.personId));
    const worked = new Set((await store.list('attendance', {})).map((x) => x.personId));
    const other = (await store.list('people', {})).find((p) => p.companyId === guard.companyId && !rostered.has(p.id) && !worked.has(p.id))!;
    await store.insert('leaveRequests', { ...(await store.get('leaveRequests', 'lv-syn-1'))!, id: 'lv-syn-2', personId: other.id, companyId: other.companyId });
    const r2 = await svc.govOpsMonitor(om, '2026-10');
    expect(r2.leave.find((x) => x.id === 'lv-syn-2')).toBeUndefined();
  });

  it('is for the OGM, government OMs and group leaders only, each in their own area', async () => {
    const { svc, store, om, site } = await setup(100_000);
    const ogm = await svc.user('u-ogm');
    const all = await svc.govOpsMonitor(ogm, '2026-10');
    const mine = await svc.govOpsMonitor(om, '2026-10');
    expect(all.sites.length).toBeGreaterThan(mine.sites.length);
    expect(mine.sites.some((x) => x.siteId === site.id)).toBe(true);
    // A Johor OM does not see a Selangor site.
    expect((await svc.govOpsMonitor(await svc.user('u-om-johor'), '2026-10')).sites.some((x) => x.siteId === site.id)).toBe(false);
    // Private-sector sites never appear.
    const sites = await store.list('sites', {});
    expect(all.sites.every((x) => sites.find((s) => s.id === x.siteId)?.sector === 'government')).toBe(true);
    await svc.govOpsMonitor(await svc.user('u-fauzan'), '2026-10');
    await expect(svc.govOpsMonitor(await svc.user('u-proc-store1'))).rejects.toThrow(/Government Operations/);
    const priv = { ...(await svc.user('u-om-johor')), opsSector: 'private' as const };
    await expect(svc.govOpsMonitor(priv)).rejects.toThrow(/Government Operations/);
    await expect(svc.govOpsMonitor(ogm, '2027-01')).rejects.toThrow(/this month or an earlier one/);
  });
});
