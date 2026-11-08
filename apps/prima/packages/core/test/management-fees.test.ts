import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, feeInEffect, generateDataset, myt } from '../src';

// Management fees between any PWVSB group companies, set by the Finance Director or the CEO with a reason (Fauzan,
// 5 Nov 2026, audit decision 5). Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const fd = await svc.user('u-fd');
  const ceo = await svc.user('u-fauzan');
  const co = ds.companies.find((c) => ds.finStatus.some((f) => f.companyId === c.id))!;
  const other = ds.companies.find((c) => c.id !== co.id && ds.finStatus.some((f) => f.companyId === c.id))!;
  return { ds, store, svc, fd, ceo, co, other };
}
const fin = async (svc: PrimaService, store: MemoryStore, companyId: string) => (await store.list('finStatus', { companyId: [companyId] }))[0];

describe('management fees between any group companies', () => {
  it('lets the FD or the CEO set a fee from any group company, including PWVSB and licensed companies, with a reason', async () => {
    const { svc, store, fd, ceo, co, other } = await setup();
    await svc.setManagementFee(fd, co.id, { chargedBy: 'pwvsb', kind: 'percent', value: 3, agreementRef: 'SYN-PW-1', reason: 'Group management agreement' });
    await svc.setManagementFee(ceo, other.id, { chargedBy: co.id, kind: 'fixed', value: 2500, agreementRef: 'SYN-CO-1', reason: 'Shared admin services' });
    // PWVSB itself can pay a fee too (it has a Finance record).
    await svc.setManagementFee(fd, 'pwvsb', { chargedBy: 'merdeka', kind: 'fixed', value: 3000, agreementRef: 'SYN-IT-1', reason: 'IT services' });
    expect(feeInEffect(await fin(svc, store, co.id), 'pwvsb', '2026-11')).toMatchObject({ kind: 'percent', value: 3, reason: 'Group management agreement', from: '2026-11' });
    expect(feeInEffect(await fin(svc, store, other.id), co.id, '2026-11')).toMatchObject({ kind: 'fixed', value: 2500, by: ceo.name });
    expect(feeInEffect(await fin(svc, store, 'pwvsb'), 'merdeka', '2026-11')).toMatchObject({ value: 3000 });

    const list = await svc.managementFees(fd);
    expect(list.chargers.map((c) => c.id)).toEqual(expect.arrayContaining(['pwvsb', 'merdeka', 'goodwill', 'sasateam', co.id, other.id]));
    expect(list.chargers.find((c) => c.id === 'pwvsb')?.basis).toBe('all');
    expect(list.chargers.find((c) => c.id === 'goodwill')?.basis).toBe('government');
    const row = list.companies.find((c) => c.companyId === co.id)!;
    expect(row.fees).toEqual([expect.objectContaining({ chargedBy: 'pwvsb', chargedByName: 'PWVSB', now: expect.objectContaining({ value: 3 }) })]);
    expect(row.history[0]).toMatchObject({ chargedBy: 'pwvsb', reason: 'Group management agreement', by: fd.name });

    const audit = (await store.list('audit', {})).filter((a) => a.action === 'fin.management_fee');
    expect(audit).toHaveLength(3);
    expect(audit[0].summary).toBe(`Management fee PWVSB bills ${co.name} set to 3% of billing (agreement SYN-PW-1), not taken off site profit and loss, from 2026-11, was no fee. Reason: Group management agreement`);
    expect(audit[0].actor).toBe(fd.name);
  });

  it('refuses anyone but the FD or the CEO, a missing reason, self-billing and unknown companies', async () => {
    const { ds, svc, fd, co } = await setup();
    const input = { chargedBy: 'pwvsb', kind: 'percent' as const, value: 3, agreementRef: 'SYN', reason: 'Synthetic' };
    const others = ['u-coo', 'u-ogm', 'u-opsdir', 'u-chair', 'u-om-klang', ds.users.find((u) => u.role === 'company_manager')?.id].filter(Boolean) as string[];
    for (const id of others) {
      const u = await svc.user(id).catch(() => null);
      if (!u) continue;
      await expect(svc.setManagementFee(u, co.id, input), id).rejects.toThrow(/Finance Director or the CEO/);
      await expect(svc.managementFees(u), id).rejects.toThrow();
    }
    await expect(svc.setManagementFee(fd, co.id, { ...input, reason: '  ' })).rejects.toThrow(/reason/);
    await expect(svc.setManagementFee(fd, co.id, { ...input, reason: undefined as unknown as string })).rejects.toThrow(/reason/);
    await expect(svc.setManagementFee(fd, co.id, { ...input, chargedBy: co.id })).rejects.toThrow(/itself/);
    await expect(svc.setManagementFee(fd, co.id, { ...input, chargedBy: 'co-nope' })).rejects.toThrow(/bills the fee/);
    await expect(svc.setManagementFee(fd, 'co-nope', input)).rejects.toThrow(/Choose a company/);
    // A licensed company with no Finance record cannot be billed until Finance sets it up.
    await expect(svc.setManagementFee(fd, 'co-nofin', input)).rejects.toThrow(/Choose a company|no Finance record/);
    await expect(svc.setManagementFee(fd, co.id, { ...input, kind: 'end' })).rejects.toThrow(/no fee/);
  });

  it('bills a central company with no Finance record (Merdeka, Perfect Global Logistics) by opening one, and PGL bills too', async () => {
    const { svc, store, fd, co } = await setup();
    expect(await fin(svc, store, 'merdeka')).toBeUndefined();
    await svc.setManagementFee(fd, 'merdeka', { chargedBy: 'pgl', kind: 'fixed', value: 800, agreementRef: 'SYN-PGL-1', reason: 'Vehicle rental agreement' });
    const opened = (await fin(svc, store, 'merdeka'))!;
    expect(opened).toMatchObject({ companyId: 'merdeka', fyEnd: '12-31', sqlLastAt: null, closedTo: null, banks: [] });
    expect(feeInEffect(opened, 'pgl', '2026-11')).toMatchObject({ value: 800, inSiteProfit: false });
    await svc.setManagementFee(fd, co.id, { chargedBy: 'pgl', kind: 'fixed', value: 1500, agreementRef: 'SYN-PGL-2', reason: 'Vehicle rental agreement' });
    const audit = (await store.list('audit', {})).map((a) => a.action);
    expect(audit).toContain('fin.record_opened');
    const list = await svc.managementFees(fd);
    expect(list.chargers.find((c) => c.id === 'pgl')?.name).toBe('Perfect Global Logistics Sdn Bhd');
    expect(list.companies.find((c) => c.companyId === 'merdeka')?.fees[0]).toMatchObject({ chargedBy: 'pgl', now: expect.objectContaining({ value: 800 }) });
    // The Finance board still opens with the new record in it.
    await svc.finBoard(fd);
    const bills = await svc.managementFeeBills(fd, '2026-11');
    expect(bills.bills.find((b) => b.chargedById === 'pgl' && b.companyId === 'merdeka')?.chargedByName).toBe('Perfect Global Logistics Sdn Bhd');
  });

  it('lets the FD or the CEO put any fee into site profit and loss or take it out, with a reason', async () => {
    const { ds, store, svc, fd, ceo } = await setup();
    const site = ds.sites.find((s) => (s.sector ?? 'private') === 'private' && ds.finStatus.some((f) => f.companyId === s.companyId))!;
    const row = async () => (await svc.privateOpsMonitor(fd, '2026-10')).sites.find((x) => x.siteId === site.id)!;
    await svc.setManagementFee(fd, site.companyId, { chargedBy: 'sasateam', kind: 'fixed', value: 1000, agreementRef: 'SYN-S', reason: 'Ops agreement', from: '2026-10' });
    const base = await row();
    expect(base.managementFeeInProfit).toBe(true);
    expect(base.otherFees).toBe(0);
    // A PWVSB fee is not in site profit and loss unless the FD or the CEO puts it in.
    await svc.setManagementFee(fd, site.companyId, { chargedBy: 'pwvsb', kind: 'fixed', value: 2000, agreementRef: 'SYN-P', reason: 'Group fee', from: '2026-10' });
    expect((await row()).margin).toBe(base.margin);
    await svc.setManagementFee(ceo, site.companyId, { chargedBy: 'pwvsb', kind: 'fixed', value: 2000, agreementRef: 'SYN-P', reason: 'Put group fee into site P&L', from: '2026-10', inSiteProfit: true });
    const withPw = await row();
    expect(withPw.otherFees).toBeGreaterThan(0);
    expect(withPw.margin!).toBeCloseTo(base.margin! - withPw.otherFees!, 1);
    // Taking Sasa Team's fee out of site profit and loss keeps the fee bill the same.
    await svc.setManagementFee(fd, site.companyId, { chargedBy: 'sasateam', kind: 'fixed', value: 1000, agreementRef: 'SYN-S', reason: 'Take ops fee out of site P&L', from: '2026-10', inSiteProfit: false });
    const noOps = await row();
    expect(noOps.managementFeeInProfit).toBe(false);
    expect(noOps.managementFee).toBe(withPw.managementFee);
    expect(noOps.margin!).toBeCloseTo(withPw.margin! + withPw.managementFee!, 1);
    // Only the switch changed: still needs a reason and is logged.
    const log = (await fin(svc, store, site.companyId))!.managementFeeLog!;
    expect(log.at(-1)).toMatchObject({ chargedBy: 'sasateam', reason: 'Take ops fee out of site P&L', fee: expect.objectContaining({ inSiteProfit: false }) });
    await expect(svc.setManagementFee(fd, site.companyId, { chargedBy: 'sasateam', kind: 'fixed', value: 1000, agreementRef: 'SYN-S', reason: 'Again', from: '2026-10', inSiteProfit: false })).rejects.toThrow(/already the fee/);
  });

  it('applies a change from the chosen month, keeps earlier months, and ends a fee', async () => {
    const { svc, store, fd, ceo, co } = await setup();
    const base = { chargedBy: 'pwvsb', agreementRef: 'SYN-PW-2' };
    await expect(svc.setManagementFee(fd, co.id, { ...base, kind: 'percent', value: 5, reason: 'Too early', from: '2026-09' })).rejects.toThrow(/last month at the earliest/);
    await expect(svc.setManagementFee(fd, co.id, { ...base, kind: 'percent', value: 5, reason: 'Bad month', from: '2026-13' })).rejects.toThrow(/month the fee applies/);
    await svc.setManagementFee(fd, co.id, { ...base, kind: 'percent', value: 5, reason: 'Agreement signed in October', from: '2026-10' });
    await expect(svc.setManagementFee(fd, co.id, { ...base, kind: 'percent', value: 5, reason: 'Same again', from: '2026-11' })).rejects.toThrow(/already the fee/);
    await svc.setManagementFee(ceo, co.id, { ...base, kind: 'percent', value: 7, agreementRef: 'SYN-PW-3', reason: 'Addendum 1', from: '2026-12' });
    let f = await fin(svc, store, co.id);
    expect(feeInEffect(f, 'pwvsb', '2026-10')?.value).toBe(5);
    expect(feeInEffect(f, 'pwvsb', '2026-11')?.value).toBe(5);
    expect(feeInEffect(f, 'pwvsb', '2027-01')?.value).toBe(7);
    let row = (await svc.managementFees(fd)).companies.find((c) => c.companyId === co.id)!;
    expect(row.fees[0].now?.value).toBe(5);
    expect(row.fees[0].later).toEqual([expect.objectContaining({ from: '2026-12', reason: 'Addendum 1', fee: expect.objectContaining({ value: 7 }) })]);

    await svc.setManagementFee(fd, co.id, { chargedBy: 'pwvsb', kind: 'end', reason: 'Agreement terminated', from: '2027-02' });
    f = await fin(svc, store, co.id);
    expect(feeInEffect(f, 'pwvsb', '2027-01')?.value).toBe(7);
    expect(feeInEffect(f, 'pwvsb', '2027-02')).toBeNull();
    row = (await svc.managementFees(fd)).companies.find((c) => c.companyId === co.id)!;
    expect(row.history.map((h) => h.reason)).toEqual(['Agreement terminated', 'Addendum 1', 'Agreement signed in October']);
    const audit = (await store.list('audit', {})).filter((a) => a.action === 'fin.management_fee').at(-1)!;
    expect(audit.summary).toBe(`Management fee PWVSB bills ${co.name} ended from 2027-02, was 7% of billing (not taken off site profit). Reason: Agreement terminated`);
  });

  it('keeps a fee entered before changes were kept for earlier months', async () => {
    const { svc, store, fd, co } = await setup();
    const f0 = await fin(svc, store, co.id);
    await store.update('finStatus', f0.id, { managementFees: { goodwill: { kind: 'percent', value: 4, agreementRef: 'OLD', by: 'Synthetic', at: NOW } } });
    expect(feeInEffect(await fin(svc, store, co.id), 'goodwill', '2026-01')?.value).toBe(4);
    await svc.setManagementFee(fd, co.id, { chargedBy: 'goodwill', kind: 'percent', value: 6, agreementRef: 'NEW', reason: 'New agreement', from: '2026-11' });
    const f = await fin(svc, store, co.id);
    expect(feeInEffect(f, 'goodwill', '2026-10')?.value).toBe(4);
    expect(feeInEffect(f, 'goodwill', '2026-11')?.value).toBe(6);
    expect(f.managementFeeLog?.[0]).toMatchObject({ chargedBy: 'goodwill', from: '0000-01', reason: '(entered before reasons were kept)' });
  });

  it('drafts bills for fees from other group companies for the FD, the CEO and the COO only', async () => {
    const { svc, fd, co } = await setup();
    await svc.setManagementFee(fd, co.id, { chargedBy: 'pwvsb', kind: 'fixed', value: 4000, agreementRef: 'SYN-PW-4', reason: 'Group services', from: '2026-10' });
    const bills = await svc.managementFeeBills(fd, '2026-10');
    const mine = bills.bills.find((b) => b.chargedById === 'pwvsb' && b.companyId === co.id)!;
    expect(mine).toMatchObject({ basis: 'all', amount: 4000, chargedByName: 'PWVSB' });
    expect(bills.totals.map((t) => t.chargedById)).toEqual(expect.arrayContaining(['goodwill', 'sasateam', 'pwvsb']));
    // A fee set later from November does not change October's bill.
    await svc.setManagementFee(fd, co.id, { chargedBy: 'pwvsb', kind: 'fixed', value: 9000, agreementRef: 'SYN-PW-5', reason: 'Addendum', from: '2026-11' });
    expect((await svc.managementFeeBills(fd, '2026-10')).bills.find((b) => b.chargedById === 'pwvsb' && b.companyId === co.id)?.amount).toBe(4000);
    const coo = await svc.managementFeeBills(await svc.user('u-coo'), '2026-10');
    expect(coo.bills.some((b) => b.chargedById === 'pwvsb')).toBe(true);
    const ogm = await svc.managementFeeBills(await svc.user('u-ogm'), '2026-10');
    expect(ogm.bills.every((b) => b.chargedById === 'goodwill')).toBe(true);
    // A percentage fee from a non-operations company is on the payer's billing at all its sites.
    await svc.setManagementFee(fd, co.id, { chargedBy: 'merdeka', kind: 'percent', value: 2, agreementRef: 'SYN-IT-2', reason: 'IT services', from: '2026-10' });
    const b = (await svc.managementFeeBills(fd, '2026-10')).bills.find((x) => x.chargedById === 'merdeka' && x.companyId === co.id)!;
    if (b.billing != null && b.sites > 0) expect(b.amount).toBeCloseTo((b.billing * 2) / 100, 2);
    else expect(b.amount).toBeNull();
  });
});
