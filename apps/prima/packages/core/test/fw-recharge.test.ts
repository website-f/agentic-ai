import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, chargedShare, expectedContribution, generateDataset, myt, placementDaysIn, type Dataset, type User } from '../src';

// Nepali EPF and SOCSO recharge (Fauzan, 5 Nov 2026): the company holding the permit pays KWSP and PERKESO; the company
// or branch that used the worker repays it. Who used the worker comes from FWM placements (recruitment cost). Synthetic
// data only; TODAY is fixed so September 2026 is a finished month.

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function financeOf(ds: Dataset, companyId: string): User[] {
  const team = ds.finStatus.find((f) => f.companyId === companyId)!.team;
  return ds.users.filter((u) => u.department === 'finance' && u.financeTeam === team);
}

async function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const u = (id: string) => svc.user(id);
  const nepali = ds.people.filter((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.status === 'active' && p.role === 'guard');
  const fwm = await u('u-fwm-ex1');
  // Sasa holds the permits. Two workers with Arrow Shield from 1 September, one with Inas's branch from 16 September
  // (the branch pays the salary), one with Sasa's own branch br-sasa-2 for September.
  await svc.recordFwPlacement(fwm, nepali[0].id, { hostCompanyId: 'co-arsh', from: '2026-09-01' }, []);
  await svc.recordFwPlacement(fwm, nepali[1].id, { hostCompanyId: 'co-arsh', from: '2026-09-01' }, []);
  await svc.recordFwPlacement(fwm, nepali[2].id, { hostCompanyId: 'co-inas', hostBranchId: 'br-inas-2', from: '2026-09-16' }, []);
  await svc.recordFwPlacement(fwm, nepali[3].id, { hostCompanyId: 'co-sasa', hostBranchId: 'br-sasa-2', from: '2026-09-01', salaryPaidBy: 'company' }, []);
  return {
    ds,
    store,
    svc,
    nepali,
    fwm,
    sasaFin: financeOf(ds, 'co-sasa')[0],
    arshFin: financeOf(ds, 'co-arsh')[0],
    fd: await u('u-fd'),
    despatch: await u('u-fwm-desp'),
    cmSasa: await u('u-cm-sasa'),
    cmArsh: await u('u-cm-arsh'),
    cmInas: await u('u-cm-inas'),
    bmInas2: await u('u-bm-inas-2'),
    bmInas1: await u('u-bm-inas-1'),
  };
}

type Ctx = Awaited<ReturnType<typeof fresh>>;

/** Finance fills the form from the draft: the published-rate figures on the mock wage, with receipt references. */
async function issue(c: Ctx, fin: User, userCompanyId: string, userBranchId: string | null, period = '2026-09') {
  const draft = await c.svc.fwStatDraft(fin, { ownerCompanyId: 'co-sasa', userCompanyId, userBranchId, period });
  const lines = draft.map((w) => ({ personId: w.personId, wage: w.wage, paid: w.expected, kwspRef: `KWSP-SYN-${period}`, perkesoRef: `PERKESO-SYN-${period}` }));
  return { lines, charge: () => c.svc.issueFwStatCharge(fin, { ownerCompanyId: 'co-sasa', userCompanyId, userBranchId, period, lines }) };
}

describe('recharge sums', () => {
  it('counts the days of the month a placement covers and shares the paid figures by them', () => {
    expect(placementDaysIn({ from: '2026-09-11', to: null }, '2026-09')).toBe(20);
    expect(placementDaysIn({ from: '2026-08-01', to: '2026-09-10' }, '2026-09')).toBe(10);
    expect(placementDaysIn({ from: '2026-10-01', to: null }, '2026-09')).toBe(0);
    const paid = { epfEr: 34, epfEe: 34, socsoEr: 29.75, socsoEe: 8.5, lindungEe: 12.75 };
    expect(chargedShare(paid, 15, 30)).toEqual({ epfEr: 17, epfEe: 17, socsoEr: 14.88, socsoEe: 4.25, lindungEe: 6.38 });
    // Foreign workers: EPF 2% + 2%, SOCSO 1.75% + 0.5%, LINDUNG 24 Jam 0.75% from June 2026 wages.
    expect(expectedContribution(1_700, 30, '2026-09')).toEqual(paid);
  });
});

describe('placements', () => {
  it('FWM records who pays the salary: the branch only when a branch uses the worker', async () => {
    const c = await fresh();
    const p = c.ds.fwPlacements.filter((x) => c.nepali.slice(0, 4).some((n) => n.id === x.personId));
    expect(p.map((x) => x.salaryPaidBy)).toEqual(['company', 'company', 'branch', 'company']);
    await expect(c.svc.recordFwPlacement(c.fwm, c.nepali[4].id, { hostCompanyId: 'co-arsh', from: '2026-10-01', salaryPaidBy: 'branch' }, [])).rejects.toThrow(/branch/);
  });

  it('a recharged month is locked: the placement cannot be cut short or back-filled until Finance cancels', async () => {
    const c = await fresh();
    const { charge } = await issue(c, c.sasaFin, 'co-arsh', null);
    const debit = await charge();
    const p = c.ds.fwPlacements.find((x) => x.personId === c.nepali[0].id)!;
    await expect(c.svc.endFwPlacement(c.fwm, p.id, { to: '2026-09-20', note: 'Back to Sasa' })).rejects.toThrow(/already recharged/);
    await c.svc.endFwPlacement(c.fwm, p.id, { to: '2026-10-05', note: 'Back to Sasa' });
    await expect(c.svc.recordFwPlacement(c.fwm, c.nepali[0].id, { hostCompanyId: 'co-arsh', from: '2026-10-20' }, [])).resolves.toBeTruthy();
    await c.svc.cancelFwStatCharge(c.fd, debit.pairId, 'Correcting the September figures');
  });
});

describe('months to charge', () => {
  it('lists every uncharged month back to the oldest one a debit note may still cover (two years)', async () => {
    const c = await fresh();
    const p = (await c.store.list('fwPlacements', {})).find((x) => x.personId === c.nepali[0].id)!;
    await c.store.update('fwPlacements', p.id, { from: '2024-09-01' });
    const months = (await c.svc.fwStatBoard(c.sasaFin)).toCharge.filter((r) => r.userCompanyId === 'co-arsh' && !r.userBranchId).map((r) => r.period);
    expect(months[0]).toBe('2024-10');
    expect(months.at(-1)).toBe('2026-09');
    expect(months).toHaveLength(24);
    // The oldest listed month can be issued; the month before it cannot.
    await expect((await issue(c, c.sasaFin, 'co-arsh', null, '2024-09')).charge()).rejects.toThrow(/two years/);
    await (await issue(c, c.sasaFin, 'co-arsh', null, '2024-10')).charge();
    expect((await c.svc.fwStatBoard(c.sasaFin)).toCharge.some((r) => r.userCompanyId === 'co-arsh' && r.period === '2024-10')).toBe(false);
  });
});

describe('who sees what', () => {
  it('each company sees its own copy; a Branch Manager sees only their own branch; the despatch sees nothing', async () => {
    const c = await fresh();
    await (await issue(c, c.sasaFin, 'co-arsh', null)).charge();
    await (await issue(c, c.sasaFin, 'co-inas', 'br-inas-2')).charge();
    expect((await c.svc.fwStatBoard(c.cmSasa)).charges.map((x) => x.names.user).sort()).toEqual(['Arrow Shield Security Sdn Bhd', 'Inas Security and Consultancy Sdn Bhd']);
    const arsh = await c.svc.fwStatBoard(c.cmArsh);
    expect(arsh.charges.map((x) => [x.ref, x.canRepay, x.canReceive])).toEqual([['FWS-SASA-ARSH-2026-09-1', true, false]]);
    const bm2 = await c.svc.fwStatBoard(c.bmInas2);
    expect(bm2.charges.map((x) => [x.ref, x.names.branch, x.canRepay])).toEqual([['FWS-SASA-INAS-B2-2026-09-1', 'Inas Negeri Sembilan', true]]);
    expect((await c.svc.fwStatBoard(c.bmInas1)).charges).toEqual([]);
    await expect(c.svc.fwStatBoard(c.despatch)).rejects.toThrow();
    // FWM sees the placed workers and who pays the salary, but no money.
    const fwm = await c.svc.fwStatBoard(c.fwm);
    expect(fwm.charges).toEqual([]);
    expect(fwm.placed.find((p) => p.branchName === 'Inas Negeri Sembilan')?.salaryPaidBy).toBe('branch');
    // The owner's Finance sees what is still to charge: Sasa's own branch for September.
    const fin = await c.svc.fwStatBoard(c.sasaFin);
    expect(fin.toCharge.map((t) => [t.userCompanyId, t.userBranchId, t.period, t.workers])).toEqual([['co-sasa', 'br-sasa-2', '2026-09', 1]]);
  });
});

describe('recharge cycle', () => {
  it('owner Finance issues, the user repays the full amount, another person at the owner checks it in', async () => {
    const c = await fresh();
    const { lines, charge } = await issue(c, c.sasaFin, 'co-arsh', null);
    expect(lines).toHaveLength(2);
    const input = { ownerCompanyId: 'co-sasa', userCompanyId: 'co-arsh', period: '2026-09', lines };
    // Only the owner company's Finance team (or the FD) issues; not the user's Finance, not the company manager.
    await expect(c.svc.issueFwStatCharge(c.arshFin, input)).rejects.toThrow(/owner company/);
    await expect(c.svc.issueFwStatCharge(c.cmSasa, input)).rejects.toThrow(/owner company/);
    await expect(c.svc.issueFwStatCharge(c.sasaFin, { ...input, period: '2026-10' })).rejects.toThrow(/finished month/);
    await expect(c.svc.issueFwStatCharge(c.sasaFin, { ...input, lines: lines.slice(1) })).rejects.toThrow(/Add the line/);
    await expect(c.svc.issueFwStatCharge(c.sasaFin, { ...input, lines: lines.map((l) => ({ ...l, kwspRef: '' })) })).rejects.toThrow(/KWSP/);
    const off = lines.map((l, i) => (i ? l : { ...l, paid: { ...l.paid, epfEr: l.paid.epfEr + 10 } }));
    await expect(c.svc.issueFwStatCharge(c.sasaFin, { ...input, lines: off })).rejects.toThrow(/published rate/);
    await expect(c.svc.issueFwStatCharge(c.sasaFin, { ...input, lines: off.map((l, i) => (i ? l : { ...l, note: 'Arrears from August paid with September' })) })).resolves.toBeTruthy();
    const all = c.ds.fwStatCharges.filter((x) => x.period === '2026-09');
    await c.svc.cancelFwStatCharge(c.sasaFin, all[0].pairId, 'Issued with the arrears by mistake');
    const debit = await charge();
    expect(debit.ref).toBe('FWS-SASA-ARSH-2026-09-2');
    expect(debit.dueOn).toBe('2026-11-25');
    const expected = lines.reduce((t, l) => t + l.paid.epfEr + l.paid.epfEe + l.paid.socsoEr + l.paid.socsoEe + l.paid.lindungEe, 0);
    expect(debit.total).toBeCloseTo(expected, 2);
    expect(debit.lines.every((l) => l.daysUsed === 30 && l.salaryPaidBy === 'company')).toBe(true);
    await expect(charge()).rejects.toThrow(/already charges/);

    // The user company repays the whole amount; a Branch Manager of another company cannot.
    await expect(c.svc.recordFwStatRepayment(c.bmInas2, debit.pairId, { bankRef: 'IBG-SYN-1', paidOn: TODAY, amount: debit.total })).rejects.toThrow();
    await expect(c.svc.recordFwStatRepayment(c.cmArsh, debit.pairId, { bankRef: 'IBG-SYN-1', paidOn: TODAY, amount: debit.total - 1 })).rejects.toThrow(/full/);
    await expect(c.svc.confirmFwStatRepayment(c.sasaFin, debit.pairId, 'Statement line 14')).rejects.toThrow(/No repayment/);
    expect((await c.svc.recordFwStatRepayment(c.cmArsh, debit.pairId, { bankRef: 'IBG-SYN-1', paidOn: TODAY, amount: debit.total })).status).toBe('paid');
    await expect(c.svc.cancelFwStatCharge(c.sasaFin, debit.pairId, 'Wrong figures')).rejects.toThrow(/no longer be cancelled/);
    await expect(c.svc.confirmFwStatRepayment(c.cmSasa, debit.pairId, 'Statement line 14')).rejects.toThrow(/Finance/);
    expect((await c.svc.confirmFwStatRepayment(c.fd, debit.pairId, 'Sasa statement line 14')).status).toBe('received');
    expect(c.ds.fwStatCharges.filter((x) => x.pairId === debit.pairId).map((x) => x.status)).toEqual(['received', 'received']);
    const actions = c.ds.audit.filter((a) => a.entityId === debit.pairId).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['fw.epf_socso.issue', 'fw.epf_socso.repaid', 'fw.epf_socso.received']));
  });

  it('a part month is charged by days; nobody checks in a repayment they recorded', async () => {
    const c = await fresh();
    const debit = await (await issue(c, c.sasaFin, 'co-inas', 'br-inas-2')).charge();
    const l = debit.lines[0];
    expect([l.daysUsed, l.daysInMonth, l.salaryPaidBy]).toEqual([15, 30, 'branch']);
    expect(debit.total).toBeCloseTo(Object.values(l.charged).reduce((t, n) => t + n, 0), 2);
    expect(l.charged.epfEr).toBeCloseTo(l.paid.epfEr / 2, 2);
    // The FD reaches both companies, records the transfer, and so cannot check it in.
    await c.svc.recordFwStatRepayment(c.fd, debit.pairId, { bankRef: 'IBG-SYN-2', paidOn: TODAY, amount: debit.total });
    await expect(c.svc.confirmFwStatRepayment(c.fd, debit.pairId, 'Statement line 3')).rejects.toThrow(/another person/);
    expect((await c.svc.confirmFwStatRepayment(c.sasaFin, debit.pairId, 'Statement line 3')).status).toBe('received');
  });

  it("the Branch Manager repays their own branch's debit note; a branch of the owner company keeps one copy and a month line", async () => {
    const c = await fresh();
    const debit = await (await issue(c, c.sasaFin, 'co-inas', 'br-inas-2')).charge();
    await expect(c.svc.recordFwStatRepayment(c.bmInas1, debit.pairId, { bankRef: 'IBG-SYN-B2', paidOn: TODAY, amount: debit.total })).rejects.toThrow();
    expect((await c.svc.recordFwStatRepayment(c.bmInas2, debit.pairId, { bankRef: 'IBG-SYN-B2', paidOn: TODAY, amount: debit.total })).status).toBe('paid');
    // Sasa's own branch: one copy only, and the branch month gets one statutory line citing the debit note.
    const own = await (await issue(c, c.sasaFin, 'co-sasa', 'br-sasa-2')).charge();
    expect(c.ds.fwStatCharges.filter((x) => x.pairId === own.pairId).map((x) => x.id)).toEqual([`${own.pairId}-o`]);
    expect(await c.svc.fwStatBranchLines('co-sasa', 'br-sasa-2', '2026-09')).toEqual([
      { kind: 'statutory', ref: own.ref, siteId: null, amount: own.total, note: 'Nepali EPF and SOCSO repaid to Sasa Security Services Sdn Bhd' },
    ]);
    expect(await c.svc.fwStatBranchLines('co-inas', 'br-inas-2', '2026-09')).toHaveLength(1);
  });
});
