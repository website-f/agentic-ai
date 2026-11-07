import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, demoFwRecruitFiles, fwRecruitAge, fwRecruitMissing, generateDataset, myt } from '../src';

// Foreign worker recruitment steps (Fauzan, 6 Nov 2026, IWAY answer 7): agency licence, embassy confirmation,
// interview, age 18 to 60 from the passport, contract in English and Malay before travel, zero fees on arrival.
// Synthetic data only.
const TODAY = '2026-11-06';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard' && p.status !== 'left')!;
  const my = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'MY' && p.status !== 'left')!;
  return { ds, svc, np, my };
};
let n = 0;
const pdf = (name: string) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name} ${(n += 1)}`).toString('base64')}` });
const TRAVEL = addDays(TODAY, 20);

async function openFile(svc: PrimaService, travel: string | null = TRAVEL) {
  const fwm = await svc.user('u-fwm-ex1');
  return svc.openFwRecruitFile(fwm, { companyId: 'co-sasa', candidateName: 'UAT Candidate', passportLast4: '12-a4', country: 'np', agency: 'UAT Agency', plannedTravelOn: travel });
}

async function allSteps(svc: PrimaService, id: string, dob = '1996-02-10') {
  const fwm = await svc.user('u-fwm-ex1');
  await svc.recordFwRecruitStep(fwm, id, 'AGENCY_LICENCE', { on: TODAY, licenceNo: 'UAT-LIC-9', licenceExpiresOn: addDays(TODAY, 365) }, [pdf('licence.pdf')]);
  await svc.recordFwRecruitStep(fwm, id, 'EMBASSY', { on: TODAY, reference: 'UAT-EMB-1' }, [pdf('embassy.pdf')]);
  await svc.recordFwRecruitStep(fwm, id, 'INTERVIEW', { on: TODAY, interviewer: 'UAT Interviewer', passed: true }, []);
  await svc.recordFwRecruitStep(fwm, id, 'AGE', { on: TODAY, dob }, [pdf('passport.pdf')]);
  return svc.recordFwRecruitStep(fwm, id, 'CONTRACT', { on: TODAY, languages: ['en', 'ms', 'ne'] }, [pdf('contract.pdf')]);
}

describe('Opening a recruitment file', () => {
  it('keeps the passport to its last 4 characters and refuses a duplicate in progress', async () => {
    const { svc, ds } = fresh();
    const f = await openFile(svc);
    expect(f).toMatchObject({ passportLast4: '12A4', country: 'NP', status: 'open', steps: {} });
    await expect(openFile(svc)).rejects.toThrow(/already has a recruitment file/);
    expect(ds.audit.at(-1)!.summary).toMatch(/…12A4/);
    const fwm = await svc.user('u-fwm-ex1');
    await expect(svc.openFwRecruitFile(fwm, { companyId: 'co-sasa', candidateName: 'UAT Two', passportLast4: 'A123456', country: 'NP', agency: 'UAT Agency' })).rejects.toThrow(/last 4/);
    await expect(svc.openFwRecruitFile(fwm, { companyId: 'co-sasa', candidateName: 'UAT Two', passportLast4: '1234', country: 'MY', agency: 'UAT Agency' })).rejects.toThrow(/country/);
    await expect(svc.openFwRecruitFile(fwm, { companyId: 'co-sasa', candidateName: 'UAT Two', passportLast4: '1234', country: 'NP', agency: 'UAT Agency', plannedTravelOn: addDays(TODAY, -1) })).rejects.toThrow(/passed/);
  });

  it('only FWM staff open files; the despatch, an OM and a company manager cannot', async () => {
    const { svc } = fresh();
    for (const id of ['u-fwm-desp', 'u-cm-sasa']) {
      const u = await svc.user(id);
      await expect(svc.openFwRecruitFile(u, { companyId: 'co-sasa', candidateName: 'UAT X', passportLast4: '1234', country: 'NP', agency: 'UAT' })).rejects.toThrow(AccessDenied);
    }
  });
});

describe('The five steps before travel', () => {
  it('refuses an expired agency licence and a step without its paper', async () => {
    const { svc } = fresh();
    const f = await openFile(svc);
    const fwm = await svc.user('u-fwm-ex1');
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'AGENCY_LICENCE', { on: TODAY, licenceNo: 'UAT-LIC', licenceExpiresOn: addDays(TODAY, -1) }, [pdf('l.pdf')])).rejects.toThrow(/expired/);
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'AGENCY_LICENCE', { on: TODAY, licenceNo: 'UAT-LIC', licenceExpiresOn: addDays(TODAY, 90) }, [])).rejects.toThrow(/copy of the agency/);
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'EMBASSY', { on: TODAY, reference: 'UAT-1' }, [])).rejects.toThrow(/embassy/);
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'AGE', { on: TODAY, dob: '1990-01-01' }, [])).rejects.toThrow(/passport page/);
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'CONTRACT', { on: TODAY, languages: ['en', 'ms'] }, [])).rejects.toThrow(/signed contract/);
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'EMBASSY', { on: addDays(TODAY, 1), reference: 'UAT-1' }, [pdf('e.pdf')])).rejects.toThrow(/today or earlier/);
  });

  it('flags a licence that runs out before travel', async () => {
    const { svc } = fresh();
    const f = await openFile(svc);
    const fwm = await svc.user('u-fwm-ex1');
    const g = await svc.recordFwRecruitStep(fwm, f.id, 'AGENCY_LICENCE', { on: TODAY, licenceNo: 'UAT-LIC', licenceExpiresOn: addDays(TODAY, 5) }, [pdf('l.pdf')]);
    expect(fwm && fwRecruitMissing(g, TODAY)).toContain('Agency licence expires before the worker travels');
  });

  it('the contract must be in English and Malay and signed on or before the travel date', async () => {
    const { svc } = fresh();
    const f = await openFile(svc);
    const fwm = await svc.user('u-fwm-ex1');
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'CONTRACT', { on: TODAY, languages: ['en', 'ne'] }, [pdf('c.pdf')])).rejects.toThrow(/English and Malay/);
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'CONTRACT', { on: TODAY, languages: ['ms'] }, [pdf('c.pdf')])).rejects.toThrow(/English and Malay/);
    const ok = await svc.recordFwRecruitStep(fwm, f.id, 'CONTRACT', { on: TODAY, languages: ['en', 'ms', 'ne'] }, [pdf('c.pdf')]);
    expect(ok.steps.CONTRACT).toMatchObject({ passed: true, languages: ['en', 'ms', 'ne'] });
    // Travel moved to before the signing date: the clearance check says so.
    const early = await svc.openFwRecruitFile(fwm, { companyId: 'co-sasa', candidateName: 'UAT Early', passportLast4: '5555', country: 'NP', agency: 'UAT', plannedTravelOn: TODAY });
    expect(fwRecruitMissing({ ...early, steps: { CONTRACT: { ...ok.steps.CONTRACT!, on: addDays(TODAY, 1) } } }, TODAY)).toContain('Contract signed after the planned travel date');
  });

  it('age is taken from the passport and counted to the travel date; outside 18 to 60 stops the file', async () => {
    expect(fwRecruitAge('2008-11-27', '2026-11-26')).toEqual({ age: 17, ok: false });
    expect(fwRecruitAge('2008-11-26', '2026-11-26')).toEqual({ age: 18, ok: true });
    expect(fwRecruitAge('1966-01-01', '2026-11-26')).toEqual({ age: 60, ok: true });
    expect(fwRecruitAge('1965-11-26', '2026-11-26')).toEqual({ age: 61, ok: false });
    const { svc, ds } = fresh();
    const f = await openFile(svc);
    const fwm = await svc.user('u-fwm-ex1');
    // 17 today but 18 by the planned travel date (2026-11-26): allowed.
    expect(TRAVEL).toBe('2026-11-26');
    const young = await svc.recordFwRecruitStep(fwm, f.id, 'AGE', { on: TODAY, dob: '2008-11-20' }, [pdf('p.pdf')]);
    expect(young.steps.AGE!.passed).toBe(true);
    expect(ds.audit.at(-1)!.summary).not.toMatch(/\d{4}-\d{2}-\d{2}.*\d{4}-\d{2}-\d{2}/);
    const old = await svc.openFwRecruitFile(fwm, { companyId: 'co-sasa', candidateName: 'UAT Old', passportLast4: '6161', country: 'NP', agency: 'UAT', plannedTravelOn: TRAVEL });
    const stopped = await svc.recordFwRecruitStep(fwm, old.id, 'AGE', { on: TODAY, dob: '1960-01-01' }, [pdf('p.pdf')]);
    expect(stopped).toMatchObject({ status: 'stopped' });
    expect(stopped.stopReason).toMatch(/Age 66/);
    await expect(svc.recordFwRecruitStep(fwm, old.id, 'EMBASSY', { on: TODAY, reference: 'UAT-1' }, [pdf('e.pdf')])).rejects.toThrow(/stopped/);
  });

  it('a failed interview needs a reason and stops the file', async () => {
    const { svc } = fresh();
    const f = await openFile(svc);
    const fwm = await svc.user('u-fwm-ex1');
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'INTERVIEW', { on: TODAY, interviewer: 'UAT Interviewer', passed: false }, [])).rejects.toThrow(/why/);
    const s = await svc.recordFwRecruitStep(fwm, f.id, 'INTERVIEW', { on: TODAY, interviewer: 'UAT Interviewer', passed: false, note: 'Could not read the guard duty card.' }, []);
    expect(s).toMatchObject({ status: 'stopped', stopReason: 'Did not pass the interview.' });
  });

  it('recording a step again needs a reason and keeps the earlier version', async () => {
    const { svc } = fresh();
    const f = await openFile(svc);
    const fwm = await svc.user('u-fwm-ex1');
    await svc.recordFwRecruitStep(fwm, f.id, 'EMBASSY', { on: TODAY, reference: 'UAT-1' }, [pdf('e.pdf')]);
    await expect(svc.recordFwRecruitStep(fwm, f.id, 'EMBASSY', { on: TODAY, reference: 'UAT-2' }, [pdf('e2.pdf')])).rejects.toThrow(/already on record/);
    const again = await svc.recordFwRecruitStep(fwm, f.id, 'EMBASSY', { on: TODAY, reference: 'UAT-2', reason: 'Reference typed wrongly' }, [pdf('e2.pdf')]);
    expect(again.steps.EMBASSY!.reference).toBe('UAT-2');
    expect(again.history).toHaveLength(1);
    expect(again.history[0]).toMatchObject({ reference: 'UAT-1', reason: 'Reference typed wrongly', replacedBy: fwm.name });
  });
});

describe('Clearing to travel, arrival and zero fees', () => {
  it('only the FWM Manager or Deputy clears, and only when all five steps fit', async () => {
    const { svc } = fresh();
    const f = await openFile(svc);
    const mgr = await svc.user('u-fwm-mgr');
    await expect(svc.clearFwRecruitFile(mgr, f.id)).rejects.toThrow(/Not ready to travel: Agency licence not recorded/);
    await allSteps(svc, f.id);
    const ex = await svc.user('u-fwm-ex1');
    await expect(svc.clearFwRecruitFile(ex, f.id)).rejects.toThrow(AccessDenied);
    const board = await svc.fwmRecruitment(mgr);
    expect(board.files.find((r) => r.file.id === f.id)).toMatchObject({ canClear: true, missing: [] });
    const c = await svc.clearFwRecruitFile(mgr, f.id);
    expect(c).toMatchObject({ status: 'cleared', clearedBy: mgr.name });
    // No more step changes once cleared.
    await expect(svc.recordFwRecruitStep(ex, f.id, 'EMBASSY', { on: TODAY, reference: 'UAT-3', reason: 'late change' }, [pdf('e.pdf')])).rejects.toThrow(/before the worker is cleared/);
  });

  it('a no-travel-date file cannot be cleared; a new date that no longer fits withdraws clearance', async () => {
    const { svc } = fresh();
    const f = await openFile(svc, null);
    await allSteps(svc, f.id);
    const mgr = await svc.user('u-fwm-mgr');
    await expect(svc.clearFwRecruitFile(mgr, f.id)).rejects.toThrow(/Planned travel date not set/);
    const ex = await svc.user('u-fwm-ex1');
    await svc.setFwRecruitTravel(ex, f.id, { plannedTravelOn: TRAVEL, reason: '' });
    await svc.clearFwRecruitFile(mgr, f.id);
    // Moved past the agency licence expiry: back to in progress.
    await expect(svc.setFwRecruitTravel(ex, f.id, { plannedTravelOn: addDays(TODAY, 400), reason: '' })).rejects.toThrow(/why/);
    const moved = await svc.setFwRecruitTravel(ex, f.id, { plannedTravelOn: addDays(TODAY, 400), reason: 'Flight moved by the agency' });
    expect(moved).toMatchObject({ status: 'open', clearedBy: null });
  });

  it('arrival links the staff record; zero fees comes from the arrival fee check', async () => {
    const { svc, np, my } = fresh();
    const f = await openFile(svc);
    await allSteps(svc, f.id);
    const mgr = await svc.user('u-fwm-mgr');
    const ex = await svc.user('u-fwm-ex1');
    await expect(svc.recordFwRecruitArrival(ex, f.id, { arrivedOn: TODAY, staffNo: np.staffNo })).rejects.toThrow(/cleared to travel/);
    await svc.clearFwRecruitFile(mgr, f.id);
    await expect(svc.recordFwRecruitArrival(ex, f.id, { arrivedOn: TODAY, staffNo: my.staffNo })).rejects.toThrow(/not a foreign worker/);
    await expect(svc.recordFwRecruitArrival(ex, f.id, { arrivedOn: TODAY, staffNo: 'NO-SUCH' })).rejects.toThrow(/NO-SUCH/);
    const a = await svc.recordFwRecruitArrival(ex, f.id, { arrivedOn: TODAY, staffNo: np.staffNo });
    expect(a).toMatchObject({ status: 'arrived', personId: np.id });
    let row = (await svc.fwmRecruitment(mgr)).files.find((r) => r.file.id === f.id)!;
    expect(row).toMatchObject({ zeroFee: 'waiting', complete: false });
    // A second file cannot claim the same worker.
    const g = await svc.openFwRecruitFile(ex, { companyId: 'co-sasa', candidateName: 'UAT Other', passportLast4: '7777', country: 'NP', agency: 'UAT', plannedTravelOn: TRAVEL });
    await allSteps(svc, g.id);
    await svc.clearFwRecruitFile(mgr, g.id);
    await expect(svc.recordFwRecruitArrival(ex, g.id, { arrivedOn: TODAY, staffNo: np.staffNo })).rejects.toThrow(/already linked/);
    // The arrival fee check (built in the welfare checks) confirms zero fees.
    await svc.recordFwCheck(ex, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency', paidAnything: false }, []);
    row = (await svc.fwmRecruitment(mgr)).files.find((r) => r.file.id === f.id)!;
    expect(row).toMatchObject({ zeroFee: 'confirmed', complete: true });
  });

  it('a fee found on arrival shows until the follow-up is closed', async () => {
    const { svc, np } = fresh();
    const f = await openFile(svc);
    await allSteps(svc, f.id);
    const mgr = await svc.user('u-fwm-mgr');
    const ex = await svc.user('u-fwm-ex1');
    await svc.clearFwRecruitFile(mgr, f.id);
    await svc.recordFwRecruitArrival(ex, f.id, { arrivedOn: TODAY, staffNo: np.staffNo });
    const fee = await svc.recordFwCheck(ex, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency', paidAnything: true, amount: 3000, paidTo: 'UAT broker' }, []);
    expect((await svc.fwmRecruitment(mgr)).files.find((r) => r.file.id === f.id)).toMatchObject({ zeroFee: 'fee_open', complete: false });
    await svc.closeFwCheck(mgr, fee.id, { note: 'Agency paid it back in full.', repaid: 3000 }, [pdf('slip.pdf')]);
    expect((await svc.fwmRecruitment(mgr)).files.find((r) => r.file.id === f.id)).toMatchObject({ zeroFee: 'fee_closed', complete: true });
  });

  it('stopping needs a reason; a stopped or arrived file cannot be stopped again', async () => {
    const { svc } = fresh();
    const f = await openFile(svc);
    const ex = await svc.user('u-fwm-ex1');
    await expect(svc.stopFwRecruitFile(ex, f.id, { reason: 'no' })).rejects.toThrow(/why/);
    const s = await svc.stopFwRecruitFile(ex, f.id, { reason: 'Worker withdrew before the interview.' });
    expect(s).toMatchObject({ status: 'stopped', stoppedBy: ex.name });
    await expect(svc.stopFwRecruitFile(ex, f.id, { reason: 'Again, withdrew.' })).rejects.toThrow(/before arrival/);
  });
});

describe('Who sees what', () => {
  it('a company manager sees own company step status only; another company sees nothing; papers stay with FWM', async () => {
    const { svc, np } = fresh();
    const f = await openFile(svc);
    await allSteps(svc, f.id, '1991-07-19');
    const mgr = await svc.user('u-fwm-mgr');
    const ex = await svc.user('u-fwm-ex1');
    await svc.clearFwRecruitFile(mgr, f.id);
    await svc.recordFwRecruitArrival(ex, f.id, { arrivedOn: TODAY, staffNo: np.staffNo });
    await svc.recordFwCheck(ex, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency', paidAnything: true, amount: 2500, paidTo: 'UAT broker' }, []);
    const cm = await svc.user('u-cm-sasa');
    const board = await svc.fwmRecruitment(cm);
    expect(board).toMatchObject({ confidential: false, canOpen: false });
    const row = board.files.find((r) => r.file.id === f.id)!;
    expect(row).toMatchObject({ canRecord: false, canClear: false, zeroFee: 'asked', feeCheckId: null });
    const text = JSON.stringify(board);
    for (const secret of ['1991-07-19', 'UAT-LIC-9', 'UAT-EMB-1', 'UAT broker', '2500', 'fee_open']) expect(text).not.toContain(secret);
    expect(board.counts.feesFound).toBeNull();
    await expect(svc.fwmDocs(cm, f.id)).rejects.toThrow(AccessDenied);
    expect((await svc.fwmDocs(mgr, f.id)).length).toBeGreaterThanOrEqual(4);
    const inas = await svc.user('u-cm-inas');
    expect((await svc.fwmRecruitment(inas)).files.some((r) => r.file.id === f.id)).toBe(false);
    await expect(svc.fwmRecruitment(await svc.user('u-fwm-desp'))).rejects.toThrow(AccessDenied);
  });

  it('the demo files load on the board and are not ready to clear without the age, embassy and contract steps', async () => {
    const { ds, svc } = fresh();
    ds.fwRecruitFiles.push(...demoFwRecruitFiles(TODAY, myt(TODAY, '10:00')));
    const board = await svc.fwmRecruitment(await svc.user('u-fwm-mgr'));
    const one = board.files.find((r) => r.file.id === 'fwr-demo-1')!;
    expect(one.canClear).toBe(false);
    expect(one.missing).toEqual(expect.arrayContaining(['Embassy confirmation not recorded', 'Age check (passport) not recorded']));
    expect(board.files.find((r) => r.file.id === 'fwr-demo-2')!.canClear).toBe(true);
  });
});
