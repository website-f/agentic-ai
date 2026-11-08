import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, fwCostRateFor, fwCostSplit, generateDataset, monthBounds, myt, placementInMonth } from '../src';

// Recruitment cost (Fauzan, 3 Nov 2026): a foreign worker of one company working under another company's or a
// branch's job. The host pays FWM each month, FWM pays the owner back. Full month per worker; both rates set by the
// FD or CEO. Dummy data only.
const TODAY = '2026-11-03';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  const nps = ds.people.filter((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard' && p.status !== 'left');
  return { ds, svc, a: nps[0], b: nps[1], my: ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'MY')! };
};
const pdf = (name: string) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString('base64')}` });

describe('month helpers', () => {
  it('counts any day in the month as the month, and picks the rate in force', () => {
    expect(monthBounds('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(placementInMonth({ from: '2026-10-31', to: null }, '2026-10')).toBe(true);
    expect(placementInMonth({ from: '2026-09-01', to: '2026-10-01' }, '2026-10')).toBe(true);
    expect(placementInMonth({ from: '2026-09-01', to: '2026-09-30' }, '2026-10')).toBe(false);
    const step = (monthlyPerWorker: number, from: string) => ({ monthlyPerWorker, from, note: 'x', by: 'x', byId: 'x', at: `${from}-01T00:00:00+08:00` });
    expect(fwCostRateFor([], '2026-10')).toBeNull();
    expect(fwCostRateFor([step(100, '2026-09'), step(150, '2026-11')], '2026-10')).toBe(100);
    expect(fwCostRateFor([step(100, '2026-09'), step(150, '2026-11')], '2026-11')).toBe(150);
    // Two hosts split half; leftover sen go to the first host so the shares add up exactly.
    expect([...fwCostSplit(250, ['a', 'b']).values()]).toEqual([{ share: 0.5, amount: 125 }, { share: 0.5, amount: 125 }]);
    expect([...fwCostSplit(100, ['a', 'b', 'c']).values()].map((x) => x.amount)).toEqual([33.34, 33.33, 33.33]);
  });
});

describe('placements, rates and the monthly run', () => {
  it('FWM records placements; rules on host, branch, overlap and Malaysians', async () => {
    const { svc, a, my } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    await expect(svc.recordFwPlacement(fwm, my.id, { hostCompanyId: 'co-arsh', from: '2026-10-05' }, [])).rejects.toThrow(/foreign workers only/);
    await expect(svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-sasa', from: '2026-10-05' }, [])).rejects.toThrow(/already works for this company/);
    await expect(svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-arsh', hostBranchId: 'br-sasa-1', from: '2026-10-05' }, [])).rejects.toThrow(/not part of the chosen company/);
    await expect(svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-arsh', from: '2026-02-30' }, [])).rejects.toThrow(/first day/);
    const p = await svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-arsh', from: '2026-10-28', note: 'UAT synthetic' }, [pdf('uat-letter.pdf')]);
    expect(p).toMatchObject({ companyId: 'co-sasa', hostCompanyId: 'co-arsh', to: null });
    await expect(svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-inas', from: '2026-11-01' }, [])).rejects.toThrow(/End it first/);
    await expect(svc.endFwPlacement(fwm, p.id, { to: '2026-10-01', note: 'Back home' })).rejects.toThrow(/last day/);
    await svc.endFwPlacement(fwm, p.id, { to: '2026-11-02', note: 'UAT back to Sasa' });
    // The owner's own branch is a host too (branch profits are kept apart).
    const br = await svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-sasa', hostBranchId: 'br-sasa-1', from: '2026-11-03' }, []);
    expect(br.hostBranchId).toBe('br-sasa-1');
    for (const id of ['u-fwm-desp', 'u-om-klang', 'u-cm-sasa', 'u-fin-t1-lead']) {
      await expect(svc.recordFwPlacement(await svc.user(id), a.id, { hostCompanyId: 'co-arsh', from: '2026-12-01' }, [])).rejects.toBeInstanceOf(AccessDenied);
    }
  });

  it('only the FD or CEO sets rates, with a reason; a past month only before it is charged', async () => {
    const { svc } = fresh();
    await expect(svc.setFwCostRate(await svc.user('u-fin-t1-lead'), { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: 'Synthetic rate' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setFwCostRate(await svc.user('u-fwm-mgr'), { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: 'Synthetic rate' })).rejects.toBeInstanceOf(AccessDenied);
    const fd = await svc.user('u-fd');
    await expect(svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 100, from: '2024-10', note: 'Synthetic rate' })).rejects.toThrow(/24 months/);
    // The first month before any rate existed can still be priced, as long as nothing is charged for it yet.
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 90, from: '2026-10', note: 'Synthetic backdated rate' });
    await expect(svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 0, from: '2026-11', note: 'Synthetic rate' })).rejects.toThrow(/RM per worker/);
    await expect(svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: '' })).rejects.toThrow(/reason/);
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: 'Synthetic charge rate' });
    await svc.setFwCostRate(await svc.user('u-fauzan'), { kind: 'payback', monthlyPerWorker: 80, from: '2026-11', note: 'Synthetic payback rate' });
    const board = await svc.fwCostBoard(fd);
    expect(board.rates).toMatchObject({ charge: 100, payback: 80 });
    expect(board.rates?.history?.charge.map((x) => x.from)).toEqual(['2026-10', '2026-11']);
  });

  it('a charged month is never repriced: backdating stops once a live charge exists for it or later', async () => {
    const { svc, ds, a } = fresh();
    await svc.recordFwPlacement(await svc.user('u-fwm-ex1'), a.id, { hostCompanyId: 'co-arsh', from: '2026-10-20' }, []);
    const fd = await svc.user('u-fd');
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 100, from: '2026-10', note: 'Synthetic charge rate' });
    await svc.setFwCostRate(fd, { kind: 'payback', monthlyPerWorker: 70, from: '2026-10', note: 'Synthetic payback rate' });
    await svc.draftFwCostMonth(await svc.user('u-fin-t1-lead'), '2026-10');
    await expect(svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 150, from: '2026-10', note: 'Try to reprice' })).rejects.toThrow(/already charged/);
    await svc.decideFwCostCharges(await svc.user('u-fauzan'), { month: '2026-10', approve: false, note: 'Rate to be revised' });
    // Once rejected, the month can be priced again and redrafted.
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 150, from: '2026-10', note: 'Revised synthetic rate' });
    const again = await svc.draftFwCostMonth(await svc.user('u-fin-t1-lead'), '2026-10');
    expect(again.find((c) => c.direction === 'host_pays_fwm')?.total).toBe(150);
    expect(ds.fwCostCharges.filter((c) => c.status !== 'rejected')).toHaveLength(2);
  });

  it('drafts a full month per worker in both directions, approval by someone else, then invoice and paid with slip', async () => {
    const { svc, ds, a, b } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    // Worker a: with Arsh until 1 December (one day counts as the month); worker b: with a Sasa branch all December.
    const p1 = await svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-arsh', from: '2026-11-03' }, []);
    await svc.recordFwPlacement(fwm, b.id, { hostCompanyId: 'co-sasa', hostBranchId: 'br-sasa-2', from: '2026-11-03' }, []);
    const fd = await svc.user('u-fd');
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 120, from: '2026-11', note: 'Synthetic charge rate' });
    // Move the clock to January: November and December are finished.
    const later = new PrimaService(new MemoryStore(ds), () => myt('2027-01-05', '10:00'));
    const fin = await later.user('u-fin-t1-de1');
    await expect(later.draftFwCostMonth(fin, '2026-12')).rejects.toThrow(/not set both/);
    await later.setFwCostRate(await later.user('u-fauzan'), { kind: 'payback', monthlyPerWorker: 90, from: '2027-01', note: 'Synthetic payback rate' });
    await expect(later.draftFwCostMonth(fin, '2026-12')).rejects.toThrow(/not set both/);
    await expect(later.draftFwCostMonth(fin, '2027-01')).rejects.toThrow(/finished month/);
    await later.endFwPlacement(await later.user('u-fwm-ex1'), p1.id, { to: '2026-12-01', note: 'UAT one day in December' });
    await expect(later.draftFwCostMonth(fin, '2026-11')).rejects.toThrow(/not set both/);
    // Rates start in Nov (charge) and Jan (payback): set payback for Nov via a fresh store to test the run.
    ds.fwCostRates[0].payback.push({ monthlyPerWorker: 90, from: '2026-11', note: 'Synthetic', by: 'x', byId: 'x', at: '2026-11-01T00:00:00+08:00' });
    const rows = await later.draftFwCostMonth(fin, '2026-12');
    const host = rows.filter((r) => r.direction === 'host_pays_fwm');
    const owner = rows.filter((r) => r.direction === 'fwm_pays_owner');
    expect(host.map((r) => [r.companyId, r.branchId, r.lines.length, r.total]).sort()).toEqual([['co-arsh', null, 1, 120], ['co-sasa', 'br-sasa-2', 1, 120]].sort());
    expect(owner.map((r) => [r.companyId, r.lines.length, r.total])).toEqual([['co-sasa', 2, 180]]);
    await expect(later.draftFwCostMonth(fin, '2026-12')).rejects.toThrow(/Nothing new/);
    // Approval: not the drafter; a reason is needed.
    await expect(later.decideFwCostCharges(fin, { month: '2026-12', approve: true, note: 'ok ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(later.decideFwCostCharges(await later.user('u-fd'), { month: '2026-12', approve: true, note: '' })).rejects.toThrow(/reason/);
    const fdl = await later.user('u-fd');
    const board = await later.fwCostBoard(fdl);
    expect(board.charges.every((c) => c.canDecide)).toBe(true);
    await later.decideFwCostCharges(fdl, { month: '2026-12', approve: true, note: 'Checked against FWM placements' });
    const arsh = (await later.fwCostBoard(fdl)).charges.find((c) => c.companyId === 'co-arsh')!;
    const pay = (await later.fwCostBoard(fdl)).charges.find((c) => c.direction === 'fwm_pays_owner')!;
    await expect(later.bookFwCostCharge(fin, arsh.id, { step: 'paid', ref: 'PAY-1', on: '2027-01-04' }, [pdf('slip.pdf')])).rejects.toThrow(/invoice before/);
    await expect(later.bookFwCostCharge(fin, pay.id, { step: 'billed', ref: 'IV-1', on: '2027-01-04' }, [])).rejects.toThrow(/approved host charge/);
    await later.bookFwCostCharge(fin, arsh.id, { step: 'billed', ref: 'IV-00123', on: '2027-01-04' }, []);
    await expect(later.bookFwCostCharge(fin, arsh.id, { step: 'paid', ref: 'PAY-1', on: '2027-01-04' }, [])).rejects.toThrow(/payment slip/);
    expect((await later.bookFwCostCharge(fin, arsh.id, { step: 'paid', ref: 'PAY-778', on: '2027-01-05' }, [pdf('uat-slip.pdf')])).status).toBe('paid');
    // The approver does not also record the payment.
    await expect(later.bookFwCostCharge(fdl, pay.id, { step: 'paid', ref: 'PAY-779', on: '2027-01-05' }, [pdf('uat-advice.pdf')])).rejects.toThrow(/another Finance member/);
    expect((await later.fwCostBoard(fdl)).charges.find((c) => c.id === pay.id)?.canRecordPaid).toBe(false);
    expect((await later.bookFwCostCharge(fin, pay.id, { step: 'paid', ref: 'PAY-779', on: '2027-01-05' }, [pdf('uat-advice.pdf')])).status).toBe('paid');
    expect(await later.fwCostDocs(fin, arsh.id)).toHaveLength(1);
  });

  it('a rejected month can be drafted again; the FD cannot approve their own draft', async () => {
    const { svc, ds, a } = fresh();
    await svc.recordFwPlacement(await svc.user('u-fwm-ex1'), a.id, { hostCompanyId: 'co-arsh', from: '2026-11-03' }, []);
    const fd = await svc.user('u-fd');
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: 'Synthetic charge rate' });
    await svc.setFwCostRate(fd, { kind: 'payback', monthlyPerWorker: 70, from: '2026-11', note: 'Synthetic payback rate' });
    const later = new PrimaService(new MemoryStore(ds), () => myt('2026-12-02', '10:00'));
    await later.draftFwCostMonth(await later.user('u-fd'), '2026-11');
    await expect(later.decideFwCostCharges(await later.user('u-fd'), { month: '2026-11', approve: true, note: 'Looks right' })).rejects.toThrow(/Nobody approves what they drafted/);
    await later.decideFwCostCharges(await later.user('u-fauzan'), { month: '2026-11', approve: false, note: 'Wrong placement date' });
    const again = await later.draftFwCostMonth(await later.user('u-fin-t1-lead'), '2026-11');
    expect(again).toHaveLength(2);
    expect(again.every((r) => r.id.includes('-r'))).toBe(true);
    // Drafting again after the redraft (a retry) never duplicates the redrafted charges.
    await expect(later.draftFwCostMonth(await later.user('u-fin-t1-dep'), '2026-11')).rejects.toThrow(/Nothing new/);
    expect(ds.fwCostCharges.filter((c) => c.month === '2026-11' && c.status !== 'rejected')).toHaveLength(2);
  });

  it('who sees what: company manager sees own bills and paybacks, FWM sees placements but no money, OM nothing', async () => {
    const { svc, ds, a } = fresh();
    await svc.recordFwPlacement(await svc.user('u-fwm-ex1'), a.id, { hostCompanyId: 'co-arsh', from: '2026-11-03' }, []);
    const fd = await svc.user('u-fd');
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: 'Synthetic charge rate' });
    await svc.setFwCostRate(fd, { kind: 'payback', monthlyPerWorker: 70, from: '2026-11', note: 'Synthetic payback rate' });
    const later = new PrimaService(new MemoryStore(ds), () => myt('2026-12-02', '10:00'));
    await later.draftFwCostMonth(await later.user('u-fin-t1-lead'), '2026-11');
    const arsh = await later.fwCostBoard(await later.user('u-cm-arsh'));
    expect(arsh.charges.map((c) => [c.direction, c.companyId])).toEqual([['host_pays_fwm', 'co-arsh']]);
    expect(arsh.rates).toBeNull();
    const sasa = await later.fwCostBoard(await later.user('u-cm-sasa'));
    expect(sasa.charges.map((c) => [c.direction, c.companyId])).toEqual([['fwm_pays_owner', 'co-sasa']]);
    expect(sasa.placements).toHaveLength(1);
    const fwm = await later.fwCostBoard(await later.user('u-fwm-mgr'));
    expect(fwm.charges).toEqual([]);
    expect(fwm.rates).toBeNull();
    await expect(later.fwCostBoard(await later.user('u-om-klang'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(later.fwCostDocs(await later.user('u-fwm-mgr'), 'fwcc-host-co-arsh-2026-11')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('two hosts in one month split the worker half each; the owner is paid back once', async () => {
    const { svc, ds, a, b } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const p1 = await svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-arsh', from: '2026-10-01' }, []);
    await svc.endFwPlacement(fwm, p1.id, { to: '2026-10-14', note: 'UAT moved to a branch' });
    await svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-sasa', hostBranchId: 'br-sasa-1', from: '2026-10-15' }, []);
    await svc.recordFwPlacement(fwm, b.id, { hostCompanyId: 'co-arsh', from: '2026-10-01' }, []);
    const fd = await svc.user('u-fd');
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 250, from: '2026-10', note: 'Synthetic charge rate' });
    await svc.setFwCostRate(fd, { kind: 'payback', monthlyPerWorker: 200, from: '2026-10', note: 'Synthetic payback rate' });
    const rows = await svc.draftFwCostMonth(await svc.user('u-fin-t1-lead'), '2026-10');
    const arsh = rows.find((r) => r.companyId === 'co-arsh')!;
    const branch = rows.find((r) => r.branchId === 'br-sasa-1')!;
    const owner = rows.find((r) => r.direction === 'fwm_pays_owner')!;
    expect(arsh.lines.map((l) => [l.personId, l.share, l.amount]).sort()).toEqual([[a.id, 0.5, 125], [b.id, 1, 250]].sort());
    expect(arsh.total).toBe(375);
    expect(branch.lines).toHaveLength(1);
    expect(branch.total).toBe(125);
    expect(owner.lines.map((l) => [l.personId, l.amount]).sort()).toEqual([[a.id, 200], [b.id, 200]].sort());
    expect(owner.total).toBe(400);
    expect(ds.fwCostCharges.length).toBe(3);
  });

  it('the legal flag goes to the CEO log only, never blocks, and only the CEO adds details', async () => {
    const { svc, a } = fresh();
    await svc.recordFwPlacement(await svc.user('u-fwm-ex1'), a.id, { hostCompanyId: 'co-arsh', from: '2026-11-03' }, []);
    const ceo = await svc.user('u-fauzan');
    const flag = (await svc.fwCostBoard(ceo)).legal!;
    expect(flag.status).toBe('open');
    expect(flag.running).toBe(1);
    expect(flag.text).toMatch(/uniform/);
    for (const id of ['u-fd', 'u-fin-t1-lead', 'u-fwm-mgr', 'u-cm-arsh']) {
      const u = await svc.user(id);
      expect((await svc.fwCostBoard(u)).legal).toBeNull();
      expect(JSON.stringify(await svc.fwCostBoard(u))).not.toMatch(/Private Agencies Act/);
      await expect(svc.addFwCostLegalNote(u, { note: 'Not my log' })).rejects.toBeInstanceOf(AccessDenied);
    }
    await expect(svc.addFwCostLegalNote(ceo, { note: ' ' })).rejects.toThrow(/details/);
    await svc.addFwCostLegalNote(ceo, { note: 'UAT synthetic: counsel to advise' });
    const after = (await svc.fwCostBoard(ceo)).legal!;
    expect(after.status).toBe('noted');
    expect(after.notes[0].note).toBe('UAT synthetic: counsel to advise');
    // Every other role's whole board response is free of the CEO's note and the legal text (rates.history included).
    for (const id of ['u-fd', 'u-fin-t1-lead', 'u-fin-t1-de1', 'u-fwm-mgr', 'u-cm-arsh', 'u-cm-sasa']) {
      const text = JSON.stringify(await svc.fwCostBoard(await svc.user(id)));
      expect(text, id).not.toMatch(/counsel to advise|legalNotes|Private Agencies Act/);
    }
    // Rates can still be set after the note (the note shares the row and keeps it), and the FD's response carries no note.
    const res = await svc.setFwCostRate(await svc.user('u-fd'), { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: 'Synthetic charge rate' });
    expect(JSON.stringify(res)).not.toMatch(/counsel to advise|legalNotes/);
    expect((await svc.fwCostBoard(ceo)).legal!.notes).toHaveLength(1);
  });

  it('a charged month is locked: back-dated placement changes are refused until the month is rejected; settled months never change', async () => {
    const { svc, ds, a, b } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const fd = await svc.user('u-fd');
    const ceo = await svc.user('u-fauzan');
    const fin = await svc.user('u-fin-t1-lead');
    const pa = await svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-arsh', from: '2026-09-10' }, []);
    await svc.setFwCostRate(fd, { kind: 'charge', monthlyPerWorker: 250, from: '2026-09', note: 'Synthetic charge rate' });
    await svc.setFwCostRate(fd, { kind: 'payback', monthlyPerWorker: 200, from: '2026-09', note: 'Synthetic payback rate' });
    await svc.draftFwCostMonth(fin, '2026-10');
    const before = JSON.stringify(ds.fwCostCharges);
    // Back-dated: a new worker added into drafted October, and a transfer that would remove October.
    await expect(svc.recordFwPlacement(fwm, b.id, { hostCompanyId: 'co-arsh', from: '2026-10-05' }, [])).rejects.toThrow(/2026-10 is already drafted.*reject that month first/);
    await expect(svc.endFwPlacement(fwm, pa.id, { to: '2026-09-30', note: 'UAT back-dated transfer' })).rejects.toThrow(/already drafted/);
    // September is not charged yet, but ending in September also removes charged October: refused.
    expect(JSON.stringify(ds.fwCostCharges)).toBe(before);
    // A retry of the same month changes nothing.
    await expect(svc.draftFwCostMonth(fin, '2026-10')).rejects.toThrow(/Nothing new/);
    // Changes in the current (unfinished) month are fine: they touch no finished month.
    await svc.recordFwPlacement(fwm, b.id, { hostCompanyId: 'co-arsh', from: '2026-11-01' }, []);
    // Reject October, then the back-dated transfer goes through and the redraft reflects it.
    await svc.decideFwCostCharges(ceo, { month: '2026-10', approve: false, note: 'Transfer date was wrong' });
    await svc.endFwPlacement(fwm, pa.id, { to: '2026-10-10', note: 'UAT corrected transfer date' });
    await svc.recordFwPlacement(fwm, a.id, { hostCompanyId: 'co-inas', from: '2026-10-11' }, []);
    const redraft = await svc.draftFwCostMonth(fin, '2026-10');
    expect(redraft.filter((r) => r.direction === 'host_pays_fwm').map((r) => [r.companyId, r.total]).sort()).toEqual([['co-arsh', 125], ['co-inas', 125]]);
    // Approve and bill: now settled. No change, and the message says so.
    await svc.decideFwCostCharges(ceo, { month: '2026-10', approve: true, note: 'Checked the corrected dates' });
    const arsh = ds.fwCostCharges.find((c) => c.companyId === 'co-arsh' && c.month === '2026-10' && c.status === 'approved')!;
    await svc.bookFwCostCharge(fin, arsh.id, { step: 'billed', ref: 'IV-UAT-9', on: '2026-11-02' }, []);
    const settled = JSON.stringify(ds.fwCostCharges.filter((c) => c.status !== 'rejected'));
    const inas = ds.fwPlacements.find((p) => p.hostCompanyId === 'co-inas')!;
    // Ending inside October keeps October whole (any day counts), so it is allowed and changes no amount.
    await svc.endFwPlacement(fwm, inas.id, { to: '2026-10-20', note: 'UAT late correction inside the month' });
    await expect(svc.recordFwPlacement(fwm, ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.id !== a.id && p.id !== b.id && p.status !== 'left')!.id, { hostCompanyId: 'co-arsh', from: '2026-10-01' }, [])).rejects.toThrow(/approved or billed.*not changed/);
    expect(JSON.stringify(ds.fwCostCharges.filter((c) => c.status !== 'rejected'))).toBe(settled);
    // Rejecting a settled month is not possible either (only drafts are decided).
    await expect(svc.decideFwCostCharges(ceo, { month: '2026-10', approve: false, note: 'Try to undo' })).rejects.toThrow();
  });

  it('the host company manager sees who works under its job, without FWM notes or papers', async () => {
    const { svc, a } = fresh();
    await svc.recordFwPlacement(await svc.user('u-fwm-ex1'), a.id, { hostCompanyId: 'co-arsh', from: '2026-11-03', note: 'UAT internal FWM note' }, []);
    const host = await svc.fwCostBoard(await svc.user('u-cm-arsh'));
    expect(host.placements).toHaveLength(1);
    expect(host.placements[0].person).toMatchObject({ name: a.name, staffNo: a.staffNo });
    expect(host.placements[0].note).toBe('');
    expect(JSON.stringify(host)).not.toMatch(/UAT internal FWM note/);
    const owner = await svc.fwCostBoard(await svc.user('u-cm-sasa'));
    expect(owner.placements[0].note).toBe('UAT internal FWM note');
    expect((await svc.fwCostBoard(await svc.user('u-cm-inas'))).placements).toHaveLength(0);
  });
});
