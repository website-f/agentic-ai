import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, fwLevyFor, fwLevyShare, fwListDate, fwListPaper, generateDataset, myt } from '../src';

// FWM department check gaps (Fauzan, 23 Nov 2026: "Do the gap"): bulk paper dates, hostel certificate reminders, levy on
// the work permit renewal and its share on the EPF/SOCSO debit note, exit files, absconding cases raised by the OM (never
// automatic), quotas and the caseload. Synthetic data only.
const TODAY = '2026-11-23';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  const nps = ds.people.filter((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.status !== 'left');
  const my = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'MY' && p.status !== 'left')!;
  return { ds, svc, np: nps[0], np2: nps[1], my };
};
let n = 0;
const pdf = (name: string) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name} ${(n += 1)}`).toString('base64')}` });
const act = async (svc: PrimaService, uid: string, op: string, i: Record<string, unknown> = {}) => svc.fwGapsAct(await svc.user(uid), op, i);

describe('List helpers', () => {
  it('reads Malaysian day-first dates and paper names', () => {
    expect(fwListDate('31/03/2027')).toBe('2027-03-31');
    expect(fwListDate('2027-03-31')).toBe('2027-03-31');
    expect(fwListDate('31/02/2027')).toBeNull();
    expect(fwListPaper('Permit (PLKS)')).toBe('PLKS_PERMIT');
    expect(fwListPaper('pasport')).toBe('PASSPORT');
    expect(fwListPaper('FWIG')).toBe('FW_INSURANCE');
    expect(fwListPaper('SPIKPA')).toBe('SPIKPA');
    expect(fwListPaper('KDN letter')).toBe('KDN_LETTER');
    expect(fwListPaper('lunch')).toBeNull();
  });
  it('levy share is levy / 12 x days used / days in month, from a levy paid within the last 12 months', () => {
    expect(fwLevyShare(1850, 30, 30)).toBe(154.17);
    expect(fwLevyShare(1850, 15, 30)).toBe(77.08);
    const r = [{ id: 'a', paper: 'PLKS_PERMIT' as const, levy: { amount: 1850, paidOn: '2026-03-10', ref: 'x', docIds: [], by: 'x', at: 'x' } }];
    expect(fwLevyFor(r, '2026-10')).toEqual({ yearly: 1850, renewalId: 'a' });
    expect(fwLevyFor(r, '2027-04')).toBeNull();
    expect(fwLevyFor(r, '2026-02')).toBeNull();
  });
});

describe('B1 loading paper dates from FWM list', () => {
  it('previews, loads as "list", never replaces a copy, and a copy with the same dates confirms it', async () => {
    const { svc, ds, np, my } = fresh();
    const rows = [
      { company: 'SASA', staffNo: np.staffNo, paper: 'FOMEMA', number: 'FM-1', issuedOn: '20/11/2026', expiresOn: '31/12/2030' },
      { company: 'SASA', staffNo: my.staffNo, paper: 'PLKS', number: 'X', issuedOn: '01/01/2026', expiresOn: '31/12/2026' },
      { company: 'NOPE', staffNo: np.staffNo, paper: 'PLKS', issuedOn: '01/01/2026', expiresOn: '31/12/2026' },
      { company: 'SASA', staffNo: np.staffNo, paper: 'FOMEMA', issuedOn: '20/11/2026', expiresOn: '31/12/2030' },
      { company: 'SASA', staffNo: np.staffNo, paper: 'Passport', number: 'PA9912345', issuedOn: '01/01/2020', expiresOn: '01/01/2000' },
    ];
    const p = (await act(svc, 'u-fwm-ex1', 'bulkPreview', { rows })) as { rows: { status: string; why: string }[]; counts: { load: number; error: number } };
    expect(p.counts.load).toBe(1);
    expect(p.rows[1].why).toMatch(/Malaysian/);
    expect(p.rows[2].why).toMatch(/not one you can see/);
    expect(p.rows[3].why).toMatch(/twice/);
    expect(p.rows[4].why).toMatch(/after the issue/);
    const before = ds.credentials.length;
    const r = (await act(svc, 'u-fwm-ex1', 'bulkSave', { rows })) as { loaded: number; ref: string };
    expect(r.loaded).toBe(1);
    expect(ds.credentials.length).toBe(before + 1);
    const c = ds.credentials.at(-1)!;
    expect(c).toMatchObject({ source: 'list', expiresOn: '2030-12-31', type: 'FOMEMA' });
    expect(ds.audit.at(-1)!.action).toBe('fwm.paper.list');
    // A second load of the same date is skipped.
    const again = (await act(svc, 'u-fwm-ex1', 'bulkPreview', { rows: [rows[0]] })) as { rows: { status: string }[] };
    expect(again.rows[0].status).toBe('skip');
    // The copy with the same dates confirms the list date.
    const fwm = await svc.user('u-fwm-ex1');
    await svc.recordFwPaper(fwm, np.id, 'FOMEMA', { mode: 'new', number: 'FM-1', issuedOn: '2026-11-20', expiresOn: '2030-12-31' }, [pdf('fomema.pdf')]);
    expect(ds.credentials.find((x) => x.id === c.id)!.source).toBe('prima');
    const third = (await act(svc, 'u-fwm-ex1', 'bulkPreview', { rows: [{ ...rows[0], expiresOn: '31/12/2031' }] })) as { rows: { status: string; why: string }[] };
    expect(third.rows[0]).toMatchObject({ status: 'skip' });
    expect(third.rows[0].why).toMatch(/from a copy/);
  });
  it('only FWM staff load; the despatch and a company manager cannot', async () => {
    const { svc, np } = fresh();
    const rows = [{ company: 'SASA', staffNo: np.staffNo, paper: 'FOMEMA', issuedOn: '01/01/2026', expiresOn: '31/12/2030' }];
    for (const uid of ['u-fwm-desp', 'u-cm-sasa']) await expect(act(svc, uid, 'bulkSave', { rows })).rejects.toThrow(AccessDenied);
  });
});

describe('B3 levy and D1 recharge share', () => {
  it('records levy on the PLKS renewal with a receipt; a change needs a reason; never on another paper', async () => {
    const { svc, ds, np } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    await svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', { mode: 'new', number: 'PL-123', issuedOn: '2026-11-20', expiresOn: '2028-11-19' }, [pdf('plks.pdf')]);
    const r = await svc.submitFwRenewal(fwm, np.id, 'PLKS_PERMIT', { submittedOn: TODAY, channel: 'FWCMS', levy: { amount: 1850, paidOn: TODAY, ref: 'LEVY-1' } }, [pdf('receipt.pdf')]);
    expect(r.levy).toMatchObject({ amount: 1850, ref: 'LEVY-1' });
    await expect(act(svc, 'u-fwm-ex1', 'recordLevy', { renewalId: r.id, amount: 1900, paidOn: TODAY, ref: 'LEVY-2', proof: [pdf('l.pdf')] })).rejects.toThrow(/why it changes/);
    await act(svc, 'u-fwm-ex1', 'recordLevy', { renewalId: r.id, amount: 1900, paidOn: TODAY, ref: 'LEVY-2', reason: 'Typed wrong amount', proof: [pdf('l.pdf')] });
    expect(ds.fwRenewals.find((x) => x.id === r.id)!.levy!.amount).toBe(1900);
    await expect(act(svc, 'u-cm-sasa', 'recordLevy', { renewalId: r.id, amount: 1, paidOn: TODAY, ref: 'X12', proof: [pdf('l.pdf')] })).rejects.toThrow(AccessDenied);
    await svc.recordFwPaper(fwm, np.id, 'FOMEMA', { mode: 'new', number: 'FM-2', issuedOn: '2026-11-21', expiresOn: '2029-11-20' }, [pdf('f.pdf')]);
    const f = await svc.submitFwRenewal(fwm, np.id, 'FOMEMA', { submittedOn: TODAY, channel: 'FOMEMA' }, [pdf('r.pdf')]);
    await expect(act(svc, 'u-fwm-ex1', 'recordLevy', { renewalId: f.id, amount: 10, paidOn: TODAY, ref: 'X12', proof: [pdf('l.pdf')] })).rejects.toThrow(/work permit/);
  });
});

describe('D2 missing workers and B4 exit files', () => {
  it('the OM raises after 3 days, FWM reports with proof, an exit file opens and closes only when complete', async () => {
    const { svc, ds, np } = fresh();
    await expect(act(svc, 'u-cm-sasa', 'raiseAbscond', { personId: np.id, lastSeenOn: addDays(TODAY, -2), contactTried: 'Called twice and asked at the hostel' })).rejects.toThrow(/after 3 days/);
    const c = (await act(svc, 'u-cm-sasa', 'raiseAbscond', { personId: np.id, lastSeenOn: addDays(TODAY, -4), contactTried: 'Called twice and asked at the hostel' })) as { id: string; status: string };
    expect(c.status).toBe('raised');
    await expect(act(svc, 'u-cm-sasa', 'raiseAbscond', { personId: np.id, lastSeenOn: addDays(TODAY, -4), contactTried: 'Called twice and asked at the hostel' })).rejects.toThrow(/already open/);
    // Nothing is automatic: the person stays active until people act.
    expect(ds.people.find((p) => p.id === np.id)!.status).not.toBe('left');
    await expect(act(svc, 'u-cm-sasa', 'abscondStep', { id: c.id, step: 'report', policeRef: 'RPT1', policeOn: TODAY, immigrationRef: 'JIM1', immigrationOn: TODAY, policeProof: [pdf('p.pdf')], immigrationProof: [pdf('i.pdf')] })).rejects.toThrow(AccessDenied);
    await expect(act(svc, 'u-fwm-ex1', 'abscondStep', { id: c.id, step: 'report', policeRef: 'RPT1', policeOn: TODAY, immigrationRef: 'JIM1', immigrationOn: TODAY, policeProof: [pdf('p.pdf')] })).rejects.toThrow(/Attach/);
    const rep = (await act(svc, 'u-fwm-ex1', 'abscondStep', { id: c.id, step: 'report', policeRef: 'RPT1', policeOn: TODAY, immigrationRef: 'JIM1', immigrationOn: TODAY, policeProof: [pdf('p.pdf')], immigrationProof: [pdf('i.pdf')] })) as { exitId: string };
    const exit = ds.fwGapRecs.find((r) => r.id === rep.exitId)!;
    expect(exit).toMatchObject({ kind: 'exit', reason: 'ABSCONDED', reportDue: addDays(addDays(TODAY, -4), 14) });
    await expect(act(svc, 'u-fwm-ex1', 'exitStep', { id: exit.id, step: 'close' })).rejects.toThrow(/Labour Department/);
    await act(svc, 'u-fwm-ex1', 'exitStep', { id: exit.id, step: 'labour', ref: 'JTK-1', on: TODAY, proof: [pdf('jtk.pdf')] });
    await act(svc, 'u-fwm-ex1', 'exitStep', { id: exit.id, step: 'close' });
    expect(ds.fwGapRecs.find((r) => r.id === exit.id)).toMatchObject({ status: 'closed' });
  });
  it('a contract-end exit needs the memo, the flight and both reports; an absconding exit cannot be opened by hand', async () => {
    const { svc, np2 } = fresh();
    await expect(act(svc, 'u-fwm-ex1', 'openExit', { personId: np2.id, reason: 'ABSCONDED', lastDay: TODAY })).rejects.toThrow(/absconding case/);
    const x = (await act(svc, 'u-fwm-ex1', 'openExit', { personId: np2.id, reason: 'END', lastDay: TODAY })) as { id: string; reportDue: string };
    expect(x.reportDue).toBe(addDays(TODAY, 30));
    await expect(act(svc, 'u-fwm-ex1', 'openExit', { personId: np2.id, reason: 'END', lastDay: TODAY })).rejects.toThrow(/already has an open/);
    await expect(act(svc, 'u-fwm-ex1', 'exitStep', { id: x.id, step: 'close' })).rejects.toThrow(/check-out memo, flight/);
    for (const step of ['memo', 'labour', 'immigration']) await act(svc, 'u-fwm-ex1', 'exitStep', { id: x.id, step, ref: `${step}-1`, on: TODAY, proof: [pdf(`${step}.pdf`)] });
    await act(svc, 'u-fwm-ex1', 'exitStep', { id: x.id, step: 'flight', ref: 'MH100', on: TODAY });
    await act(svc, 'u-fwm-ex1', 'exitStep', { id: x.id, step: 'close' });
    await expect(act(svc, 'u-cm-sasa', 'openExit', { personId: np2.id, reason: 'END', lastDay: TODAY })).rejects.toThrow(AccessDenied);
  });
});

describe('D3 quotas, B5 caseload, B2 hostel certificates', () => {
  it('quota needs the letter to approve and reminds while places are unused', async () => {
    const { svc } = fresh();
    const q = (await act(svc, 'u-fwm-ex1', 'addQuota', { companyId: 'co-sasa', ref: 'KESUMA-1', appliedOn: '2026-01-10', placesAsked: 50 })) as { id: string };
    await expect(act(svc, 'u-fwm-ex1', 'quotaStep', { id: q.id, step: 'approve', approvedOn: '2026-01-20', places: 40 })).rejects.toThrow(/Attach/);
    const a = (await act(svc, 'u-fwm-ex1', 'quotaStep', { id: q.id, step: 'approve', approvedOn: '2026-01-20', places: 40, proof: [pdf('letter.pdf')] })) as { validTo: string };
    expect(a.validTo).toBe('2027-01-19');
    const board = (await act(svc, 'u-fwm-ex1', 'board')) as { todo: { title: string }[] };
    expect(board.todo.some((t) => /quota/.test(t.title))).toBe(true);
    await expect(act(svc, 'u-fwm-ex1', 'quotaStep', { id: q.id, step: 'used', used: 41 })).rejects.toThrow(/0 to 40/);
  });
  it('only the FWM Manager sets the owner; the board then names the owner on each paper', async () => {
    const { svc } = fresh();
    await expect(act(svc, 'u-fwm-dep', 'setCaseload', { companyId: 'co-sasa', execId: 'u-fwm-ex1' })).rejects.toThrow(AccessDenied);
    await expect(act(svc, 'u-fwm-mgr', 'setCaseload', { companyId: 'co-sasa', execId: 'u-fwm-desp' })).rejects.toThrow(/Executive/);
    await act(svc, 'u-fwm-mgr', 'setCaseload', { companyId: 'co-sasa', execId: 'u-fwm-ex1' });
    await act(svc, 'u-fwm-mgr', 'setCaseload', { companyId: 'co-sasa', execId: 'u-fwm-ex2' });
    const b = await svc.fwmBoard(await svc.user('u-fwm-ex2'));
    const sasa = b.items.filter((i) => i.person.companyId === 'co-sasa');
    expect(sasa.length).toBeGreaterThan(0);
    expect(sasa.every((i) => i.owner?.execId === 'u-fwm-ex2')).toBe(true);
    expect(b.counts.mine).toBe(sasa.length);
  });
  it('reminds FWM and the company manager of a hostel certificate expiring within 90 days', async () => {
    const { svc, ds } = fresh();
    const h = ds.hostels.find((x) => x.companyId === 'co-sasa')!;
    h.cert = { number: 'CERT-446-1', issuedOn: '2025-12-01', expiresOn: addDays(TODAY, 45), doc: null, by: 'x', at: 'x' };
    const fwm = (await act(svc, 'u-fwm-ex1', 'board')) as { todo: { tag: string; title: string }[]; certs: unknown[] };
    expect(fwm.todo.some((t) => t.tag === 'Hostel certificate' && /45 days/.test(t.title))).toBe(true);
    expect(fwm.certs).toHaveLength(1);
    const cm = await svc.home(await svc.user('u-cm-sasa'));
    expect(cm.todo.some((t) => t.tag === 'Hostel certificate')).toBe(true);
    const other = await svc.home(await svc.user('u-cm-arsh'));
    expect(other.todo.some((t) => t.tag === 'Hostel certificate')).toBe(false);
  });
  it('FWM records the certificate from the Hostels screen button; only FWM may, and the reminder follows it', async () => {
    const { svc, ds } = fresh();
    const h = ds.hostels.find((x) => x.companyId === 'co-sasa')!;
    const body = { id: h.id, cert: { number: 'CERT-446-2', issuedOn: '2025-12-01', expiresOn: addDays(TODAY, 20) }, reason: 'New certificate from the council' };
    await expect(svc.fwMoves.act(await svc.user('u-cm-sasa'), 'hostelDetails', body)).rejects.toThrow(AccessDenied);
    await svc.fwMoves.act(await svc.user('u-fwm-ex1'), 'hostelDetails', body);
    const b = (await act(svc, 'u-fwm-ex1', 'board')) as { certs: { certNo: string; daysLeft: number }[] };
    expect(b.certs.find((c) => c.certNo === 'CERT-446-2')?.daysLeft).toBe(20);
  });
});
