import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, PRIVATE_OPS_COMPANY_ID, generateDataset, myt, type Contract } from '../src';

// Private Operations (Sasa Team Sdn Bhd) monitor and the management fee bills (Fauzan, 2 Nov 2026). Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const site = ds.sites.find((s) => (s.sector ?? 'private') === 'private')!;
  // Our site is the company's only private site, so the company's Sasa Team bill depends on it alone.
  for (const s of ds.sites.filter((x) => x.companyId === site.companyId && x.id !== site.id && (x.sector ?? 'private') === 'private'))
    await store.update('sites', s.id, { sector: 'government' });
  for (const c of ds.contracts.filter((c) => c.siteIds.includes(site.id))) await store.update('contracts', c.id, { siteIds: c.siteIds.filter((x) => x !== site.id) });
  for (const a of ds.clientAccounts.filter((a) => a.siteIds.includes(site.id))) await store.update('clientAccounts', a.id, { siteIds: a.siteIds.filter((x) => x !== site.id) });
  const base = ds.contracts[0];
  const contract: Contract = {
    ...base,
    id: 'ct-synthetic-priv',
    companyId: site.companyId,
    clientAccountId: null,
    clientName: 'Synthetic mall',
    siteIds: [site.id],
    ref: 'SYN-P1',
    state: 'active',
    startOn: '2026-01-01',
    endOn: '2027-12-31',
    versions: [{ ...base.versions[0], version: 1, effectiveFrom: '2026-01-01', billingMethod: 'FIXED', fixedFee: 50_000, posts: [] }],
  };
  await store.insert('contracts', contract);
  for (const a of ds.attendance.filter((a) => a.siteId === site.id)) await store.update('attendance', a.id, { siteId: 'elsewhere' });
  const guard = ds.people.find((p) => p.companyId === site.companyId && p.role === 'guard' && p.status === 'active')!;
  await store.update('people', guard.id, { basicPay: 2080 });
  // The guard works nowhere else this month, so their whole month's pay and costs belong to this site.
  for (const a of ds.attendance.filter((a) => a.personId === guard.id)) await store.update('attendance', a.id, { personId: 'p-elsewhere' });
  for (const x of ds.shifts.filter((x) => x.personId === guard.id)) await store.update('shifts', x.id, { personId: null });
  for (let d = 1; d <= 27; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    await store.insert('attendance', {
      id: `att-synp-${d}`,
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
  return { ds, store, svc, site, guard };
}

describe('Private Operations (Sasa Team)', () => {
  it('employs the Operations Director under Sasa Team Sdn Bhd', async () => {
    const { ds } = await setup();
    const dir = ds.users.find((u) => u.id === 'u-opsdir')!;
    if (dir.personId) expect(ds.people.find((p) => p.id === dir.personId)?.companyId).toBe(PRIVATE_OPS_COMPANY_ID);
  });

  it('shows private sites only, to the Operations Director, private-side OMs and leaders, never the OGM', async () => {
    const { svc, site } = await setup();
    const r = await svc.privateOpsMonitor(await svc.user('u-opsdir'), '2026-10');
    const row = r.sites.find((x) => x.siteId === site.id)!;
    expect(row.revenue).toBe(50_000);
    expect(row.guardCost).toBe(3780);
    expect(row.managementFee).toBeNull();
    expect(row.tone).toBe('unknown');
    expect(row.notes).toContain('Management fee not entered by Finance yet');
    const gov = await svc.govOpsMonitor(await svc.user('u-ogm'), '2026-10');
    expect(gov.sites.some((x) => x.siteId === site.id)).toBe(false);
    await svc.privateOpsMonitor(await svc.user('u-fauzan'), '2026-10');
    await expect(svc.privateOpsMonitor(await svc.user('u-ogm'))).rejects.toThrow(/Private Operations/);
    const govOm = { ...(await svc.user('u-om-klang')), opsSector: 'government' as const };
    await expect(svc.privateOpsMonitor(govOm)).rejects.toThrow(/Private Operations/);
    await expect(svc.govOpsMonitor(await svc.user('u-opsdir'))).rejects.toThrow(/Government Operations/);
  });

  it('uses the Sasa Team fee for private sites and the Goodwill fee for government sites', async () => {
    const { svc, site } = await setup();
    const fd = await svc.user('u-fd');
    await svc.setManagementFee(fd, site.companyId, { chargedBy: 'goodwill', kind: 'percent', value: 5, agreementRef: 'SYN-G', reason: 'Synthetic agreement', from: '2026-10' });
    let row = (await svc.privateOpsMonitor(fd, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    expect(row.managementFee).toBeNull();
    await svc.setManagementFee(fd, site.companyId, { chargedBy: 'sasateam', kind: 'percent', value: 12, agreementRef: 'SYN-S', reason: 'Synthetic agreement', from: '2026-10' });
    row = (await svc.privateOpsMonitor(fd, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    expect(row.managementFee).toBe(6000);
    const fees = (await svc.managementFees(fd)).companies.find((x) => x.companyId === site.companyId)!;
    expect(fees.fees.find((f) => f.chargedBy === 'goodwill')?.now?.value).toBe(5);
    expect(fees.fees.find((f) => f.chargedBy === 'sasateam')?.now?.value).toBe(12);
    // A fee from any other group company (here Merdeka Network) does not touch the site profit and loss.
    await svc.setManagementFee(fd, site.companyId, { chargedBy: 'merdeka', kind: 'percent', value: 1, agreementRef: 'X', reason: 'IT services agreement', from: '2026-10' });
    row = (await svc.privateOpsMonitor(fd, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    expect(row.managementFee).toBe(6000);
  });

  it('drafts each company\'s management fee bill, Unknown until the fee and billing are known', async () => {
    const { svc, site } = await setup();
    const fd = await svc.user('u-fd');
    let bills = await svc.managementFeeBills(fd, '2026-10');
    let mine = bills.bills.find((b) => b.chargedById === 'sasateam' && b.companyId === site.companyId)!;
    expect(mine.amount).toBeNull();
    expect(mine.unknownSites).toContain(site.name);
    expect(bills.totals.map((t) => t.chargedById)).toEqual(['goodwill', 'sasateam']);
    await svc.setManagementFee(fd, site.companyId, { chargedBy: 'sasateam', kind: 'fixed', value: 4500, agreementRef: 'SYN-S', reason: 'Synthetic agreement', from: '2026-10' });
    bills = await svc.managementFeeBills(fd, '2026-10');
    mine = bills.bills.find((b) => b.chargedById === 'sasateam' && b.companyId === site.companyId)!;
    expect(mine).toMatchObject({ amount: 4500, billing: 50_000, sites: 1, unknownSites: [], chargedByName: 'Sasa Team Sdn Bhd' });
    expect(bills.notes.join(' ')).toMatch(/not an invoice/);
    // Each operations head sees only their own company's bills; an OM sees none.
    const ogm = await svc.managementFeeBills(await svc.user('u-ogm'), '2026-10');
    expect(ogm.bills.every((b) => b.chargedById === 'goodwill')).toBe(true);
    const dir = await svc.managementFeeBills(await svc.user('u-opsdir'), '2026-10');
    expect(dir.bills.every((b) => b.chargedById === 'sasateam')).toBe(true);
    await svc.managementFeeBills(await svc.user('u-coo'), '2026-10');
    await expect(svc.managementFeeBills(await svc.user('u-om-klang'))).rejects.toThrow();
  });
});
