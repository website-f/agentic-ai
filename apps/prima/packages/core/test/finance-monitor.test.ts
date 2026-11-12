import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// F1 (Fauzan, 11 Nov 2026): every site with guards is billed, starting from the month's attendance. Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');
const P = '2026-10';

function setup(opts: { invoice?: number | null; invoiceBy?: string } = {}) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const fin = ds.finStatus.find((f) => ds.sites.some((s) => s.companyId === f.companyId) && ds.contracts.some((c) => c.companyId === f.companyId))!;
  // Team 1 has a deputy and data entry in the test data: it keeps this company's books here.
  fin.team = 1;
  const co = fin.companyId;
  const base = ds.sites.find((s) => s.companyId === co)!;
  const siteA = { ...base, id: 'site-syn-a', name: 'Synthetic site A' };
  const siteB = { ...base, id: 'site-syn-b', name: 'Synthetic site B' };
  ds.sites.push(siteA, siteB);
  const a0 = ds.attendance.find((a) => a.companyId === co) ?? ds.attendance[0];
  const shift = (siteId: string, day: number, n: number) => ({
    ...a0,
    id: `att-syn-${siteId}-${day}-${n}`,
    companyId: co,
    siteId,
    personId: `p-syn-${n}`,
    shiftId: null,
    clockIn: `${P}-${String(day).padStart(2, '0')}T07:00:00.000+08:00`,
    clockOut: `${P}-${String(day).padStart(2, '0')}T19:00:00.000+08:00`,
  });
  for (let d = 1; d <= 10; d++) ds.attendance.push(shift('site-syn-b', d, 1) as typeof a0);
  for (let d = 1; d <= 2; d++) ds.attendance.push(shift('site-syn-a', d, 2) as typeof a0);
  const c0 = ds.contracts.find((c) => c.companyId === co)!;
  const v0 = c0.versions[0];
  ds.contracts.push({
    ...c0,
    id: 'ct-syn-b',
    ref: 'SYN-B',
    siteIds: ['site-syn-b'],
    state: 'active',
    startOn: '2026-01-01',
    endOn: '2027-12-31',
    endedOn: null,
    clientAccountId: null,
    versions: [{ ...v0, effectiveFrom: '2026-01-01', billingMethod: 'M1', fixedFee: null, posts: [{ ...v0.posts[0], guards: 1, hoursPerDay: 12, rate: 10 }] }],
  } as typeof c0);
  if (opts.invoice != null)
    fin.billing = [
      ...(fin.billing ?? []),
      {
        id: `bill-ct-syn-b-${P}`,
        contractId: 'ct-syn-b',
        contractRef: 'SYN-B',
        client: c0.clientName,
        period: P,
        expected: null,
        invoice: { no: 'INV-SYN-1', date: '2026-10-31', amount: opts.invoice, note: '', by: 'Synthetic', byId: opts.invoiceBy ?? 'u-fin-t1-de1', at: NOW },
        none: null,
        history: [],
      },
    ];
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  return { ds, store, svc, co };
}

const site = (r: Awaited<ReturnType<PrimaService['unbilledSites']>>, co: string, id: string) => r.companies.find((c) => c.companyId === co)!.rows.find((x) => x.siteId === id)!;

describe('F1 unbilled sites', () => {
  it('flags guards on a site with no contract, and a contract with no invoice; an invoice clears that flag', async () => {
    const { svc, co } = setup();
    const fd = await svc.user('u-fd');
    const r = await svc.unbilledSites(fd, P);
    expect(r.period).toBe(P);
    expect(site(r, co, 'site-syn-a').flags.map((f) => f.kind)).toEqual(['no_contract']);
    const b = site(r, co, 'site-syn-b');
    expect(b.hoursWorked).toBe(120);
    expect(b.flags.map((f) => f.kind)).toContain('not_invoiced');
    const billed = setup({ invoice: 1200 });
    const r2 = await billed.svc.unbilledSites(await billed.svc.user('u-fd'), P);
    expect(site(r2, billed.co, 'site-syn-b').flags.map((f) => f.kind)).not.toContain('not_invoiced');
    expect(site(r2, billed.co, 'site-syn-b').flags.map((f) => f.kind)).not.toContain('below_hours');
  });

  it('flags a Method 1 invoice below hours worked x the contract rate, with the difference', async () => {
    const { svc, co } = setup({ invoice: 500 });
    const r = await svc.unbilledSites(await svc.user('u-fd'), P);
    const b = site(r, co, 'site-syn-b');
    expect(b.expected).toBe(1200);
    const f = b.flags.find((x) => x.kind === 'below_hours')!;
    expect(f.text).toMatch(/RM500\.00 is RM700\.00 below 120 hours worked x RM10\.00 = RM1,200\.00/);
    expect(b.hoursBilled).toBe(366);
    expect(b.hoursDifference).toBe(246);
  });

  it('clears a flag only with a reason, by a Finance reviewer who did not record the invoice', async () => {
    const { svc, co } = setup({ invoice: 500, invoiceBy: 'u-fin-t1-dep' });
    const [de1, dep, lead] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead'].map((id) => svc.user(id)));
    const r = await svc.unbilledSites(lead, P);
    const below = site(r, co, 'site-syn-b').flags.find((x) => x.kind === 'below_hours')!;
    const none = site(r, co, 'site-syn-a').flags[0];
    await expect(svc.clearUnbilledFlag(lead, co, { key: none.key, reason: '' })).rejects.toThrow(/reason/);
    await expect(svc.clearUnbilledFlag(de1, co, { key: none.key, reason: 'Synthetic: trial week' })).rejects.toThrow(/Finance reviewer/);
    await expect(svc.clearUnbilledFlag(dep, co, { key: below.key, reason: 'Synthetic: discount agreed' })).rejects.toThrow(/recorded this invoice/);
    await svc.clearUnbilledFlag(lead, co, { key: below.key, reason: 'Synthetic: discount agreed in writing' });
    const after = site(await svc.unbilledSites(lead, P), co, 'site-syn-b').flags.find((x) => x.kind === 'below_hours')!;
    expect(after.cleared).toMatchObject({ reason: 'Synthetic: discount agreed in writing', byId: 'u-fin-t1-lead' });
    await expect(svc.clearUnbilledFlag(lead, co, { key: below.key, reason: 'again again' })).rejects.toThrow(/already cleared/);
  });

  it('shows a company manager their own company only, and refuses an OM', async () => {
    const { ds, svc, co } = setup();
    const own = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(co))!;
    const other = ds.users.find((u) => u.role === 'company_manager' && !u.companyIds.includes(co))!;
    const mine = await svc.unbilledSites(await svc.user(own.id), P);
    expect(mine.companies.map((c) => c.companyId)).toEqual([co]);
    expect(mine.companies[0].canClear).toBe(false);
    const theirs = await svc.unbilledSites(await svc.user(other.id), P);
    expect(theirs.companies.map((c) => c.companyId)).not.toContain(co);
    const om = ds.users.find((u) => u.opsTier === 'om')!;
    await expect(svc.unbilledSites(await svc.user(om.id), P)).rejects.toThrow(/unbilled sites/);
  });
});
