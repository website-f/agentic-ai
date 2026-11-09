// P93 (Fitri, 9 Nov 2026: "for Pekerja asing, where do I add the old records, where is the Add button? And these foreign
// workers might get their own login just for guard kind of things"). Who may add a foreign worker, old paper dates as
// opening records that keep the copy rule, the board's phone sign-in state, and a foreign worker on the guard phone.
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  EXTRA_IMPORTS,
  MemoryStore,
  PrimaService,
  fwPaperFromWords,
  generateDataset,
  myt,
  normaliseTable,
  prepareSheet,
  smartMatch,
  toCsv,
  withOrgLinks,
  type AlignField,
  type ProofInput,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const pdf = (name: string): ProofInput => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString('base64')}` });

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(withOrgLinks(new MemoryStore(ds)), () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user };
}

const base = { companyId: 'co-sasa', branchId: 'br-sasa-1', name: 'Synthetic Owner Added', dob: '1990-01-01', hiredOn: '2022-01-01' };

describe('P93 adding foreign workers', { timeout: 60000 }, () => {
  it('the owner may add, as FWM may (P78); leaders, the COO, company managers, HR and despatch may not', async () => {
    const { ds, svc, user } = fresh();
    for (const id of ['u-cos', 'u-coo', 'u-cm-sasa', 'u-pwvsb-hr', 'u-fwm-desp']) {
      await expect(svc.addFwWorker(user(id), { ...base, staffNo: `P93-NO-${id}` }), id).rejects.toBeInstanceOf(AccessDenied);
    }
    const r = await svc.addFwWorker(user('u-fauzan'), { ...base, staffNo: 'P93-OWN-1', permitExpiresOn: '2027-06-30' });
    expect(r.papers).toBe(1);
    expect(ds.people.find((p) => p.staffNo === 'P93-OWN-1')?.role).toBe('guard');
    expect(ds.audit.some((a) => a.action === 'fwm.worker.add' && a.actor === user('u-fauzan').name)).toBe(true);
  });

  it('the board gives the worker list and branches to whoever may add; paper numbers and recording from a copy stay with FWM', async () => {
    const { svc, user } = fresh();
    const fwm = await svc.fwmBoard(user('u-fwm-ex1'));
    expect(fwm.canWork && fwm.canRecordPaper).toBe(true);
    expect(fwm.workers.length).toBeGreaterThan(0);
    const owner = await svc.fwmBoard(user('u-fauzan'));
    expect(owner.canWork).toBe(true);
    expect(owner.canRecordPaper).toBe(false);
    expect(owner.branches.length).toBeGreaterThan(0);
    expect(owner.workers.length).toBeGreaterThan(0);
    expect(owner.workers.every((w) => w.papers.every((p) => p.number === null))).toBe(true);
    const cos = await svc.fwmBoard(user('u-cos'));
    expect([cos.canWork, cos.workers.length, cos.branches.length]).toEqual([false, 0, 0]);
    // Recording a paper from its copy stays FWM's, the owner included (the real-use rule).
    const w = fwm.workers[0];
    await expect(
      svc.recordFwPaper(user('u-fauzan'), w.id, 'FOMEMA', { mode: 'new', number: 'P93-F-1', issuedOn: TODAY, expiresOn: '2027-10-01' }, [pdf('f.pdf')]),
    ).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('P93 old paper dates as opening records', { timeout: 60000 }, () => {
  async function workerWithout(svc: PrimaService, fwmId: string) {
    const fwm = (await svc.user(fwmId))!;
    await svc.addFwWorker(fwm, { ...base, staffNo: 'P93-OPEN-1', name: 'Synthetic Opening Worker' });
    return fwm;
  }

  it('reads the paper from English or Malay words', () => {
    expect(fwPaperFromWords('PLKS')).toBe('PLKS_PERMIT');
    expect(fwPaperFromWords('Permit Kerja')).toBe('PLKS_PERMIT');
    expect(fwPaperFromWords('Pasport')).toBe('PASSPORT');
    expect(fwPaperFromWords('Insurans Hospital SPIKPA')).toBe('SPIKPA');
    expect(fwPaperFromWords('Insurans pekerja asing')).toBe('FW_INSURANCE');
    expect(fwPaperFromWords('Surat kelulusan KDN')).toBe('KDN_LETTER');
    expect(fwPaperFromWords('FOMEMA')).toBe('FOMEMA');
    expect(fwPaperFromWords('Lesen memandu')).toBeNull();
  });

  it('adds a date only where Prima has none, typed and without a copy; the next paper still needs its copy', async () => {
    const { ds, svc, user } = fresh();
    const fwm = await workerWithout(svc, 'u-fwm-ex1');
    const c = await svc.importFwPaper(fwm, { companyId: 'co-sasa', staffNo: 'p93-open-1', paper: 'Permit Kerja', number: 'PLKS-P93-1', issuedOn: '2025-07-01', expiresOn: '2026-12-31' });
    expect([c.type, c.source, c.docIds.length, c.number]).toEqual(['PLKS_PERMIT', 'typed', 0, 'PLKS-P93-1']);
    expect(ds.audit.some((a) => a.action === 'fwm.paper.opening' && /copy not yet attached/.test(a.summary))).toBe(true);
    // Never twice, never over a paper on record.
    await expect(svc.importFwPaper(fwm, { companyId: 'co-sasa', staffNo: 'P93-OPEN-1', paper: 'PLKS', expiresOn: '2028-01-01' })).rejects.toThrow(/already has/);
    // A passport keeps only its last 4.
    const pp = await svc.importFwPaper(fwm, { companyId: 'co-sasa', staffNo: 'P93-OPEN-1', paper: 'Pasport', number: 'PZ1234567', expiresOn: '2031-01-31' });
    expect(pp.number).toBe('****4567');
    expect(pp.issuedOn).toBe(TODAY);
    // Bad rows.
    await expect(svc.importFwPaper(fwm, { companyId: 'co-sasa', staffNo: 'NOBODY-9', paper: 'FOMEMA', expiresOn: '2027-01-01' })).rejects.toThrow(/No worker/);
    await expect(svc.importFwPaper(fwm, { companyId: 'co-sasa', staffNo: 'P93-OPEN-1', paper: 'Lesen', expiresOn: '2027-01-01' })).rejects.toThrow(/not a paper/);
    await expect(svc.importFwPaper(fwm, { companyId: 'co-sasa', staffNo: 'P93-OPEN-1', paper: 'FOMEMA', expiresOn: '2027-02-30' })).rejects.toThrow(/expiry/);
    const local = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'MY' && p.role === 'guard')!;
    await expect(svc.importFwPaper(fwm, { companyId: 'co-sasa', staffNo: local.staffNo, paper: 'FOMEMA', expiresOn: '2027-01-01' })).rejects.toThrow(/not a foreign worker/);
    // Others are refused at the server.
    for (const id of ['u-cos', 'u-coo', 'u-cm-sasa', 'u-pwvsb-hr', 'u-fwm-desp'])
      await expect(svc.importFwPaper(user(id), { companyId: 'co-sasa', staffNo: 'P93-OPEN-1', paper: 'FOMEMA', expiresOn: '2027-01-01' }), id).rejects.toBeInstanceOf(AccessDenied);
    // The copy rule is unchanged: the next permit needs its copy; with it, it is recorded from the paper.
    const person = ds.people.find((p) => p.staffNo === 'P93-OPEN-1')!;
    const next = { mode: 'new' as const, number: 'PLKS-P93-2', issuedOn: TODAY, expiresOn: '2027-12-31' };
    await expect(svc.recordFwPaper(fwm, person.id, 'PLKS_PERMIT', next, [])).rejects.toThrow(/Attach a copy/);
    const saved = await svc.recordFwPaper(fwm, person.id, 'PLKS_PERMIT', next, [pdf('plks.pdf')]);
    expect([saved.source, saved.docIds.length > 0]).toEqual(['prima', true]);
    // A correction moving the typed passport expiry later needs the copy too.
    await expect(
      svc.recordFwPaper(fwm, person.id, 'PASSPORT', { mode: 'correct', number: 'PZ1234567', issuedOn: TODAY, expiresOn: '2032-01-31', reason: 'Typed wrong from the old list' }, []),
    ).rejects.toThrow(/needs a copy/);
  });

  it('imports from a file all or none, through the same check; others cannot import', async () => {
    const { ds, svc, user } = fresh();
    const fwm = await workerWithout(svc, 'u-fwm-ex1');
    const sheet = [
      ['DOKUMEN PEKERJA ASING (SISTEM LAMA)'],
      ['ID Pekerja', 'Jenis Dokumen', 'No. Dokumen', 'Tarikh Dikeluarkan', 'Tarikh Tamat'],
      ['P93-OPEN-1', 'FOMEMA', '', '', '15/03/2027'],
      ['P93-OPEN-1', 'Insurans', 'INS-P93-9', '01/01/2026', '31/12/2026'],
      ['P93-OPEN-1', 'FOMEMA', '', '', '15/03/2028'],
    ];
    const fields = EXTRA_IMPORTS.fwPaper.fields as AlignField[];
    const prep = prepareSheet(sheet, fields);
    const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
    const csv = toCsv(normaliseTable(prep.table, 0, m.columns, fields));
    const mapping = m.columns.map((c) => c.field ?? '');
    const p = await svc.orgImport.preview(fwm, 'fwPaper', 'co-sasa', csv, { mapping });
    // The second FOMEMA row repeats a paper the first row adds: refused in the same check.
    expect(p.rows.map((r) => r.ok)).toEqual([true, true, false]);
    expect(p.rows[2].problems.join(' ')).toMatch(/already has/);
    for (const id of ['u-cos', 'u-cm-sasa', 'u-fwm-desp']) {
      const q = await svc.orgImport.preview(user(id), 'fwPaper', 'co-sasa', csv, { mapping, skip: [4] });
      expect(q.canImport, id).toBe(false);
    }
    const ok = await svc.orgImport.preview(fwm, 'fwPaper', 'co-sasa', csv, { mapping, skip: [4] });
    expect(ok.canImport).toBe(true);
    const receipt = await svc.orgImport.commit(fwm, 'fwPaper', 'co-sasa', csv, ok.fingerprint, { mapping, skip: [4] });
    expect(receipt.rows).toBe(2);
    const person = ds.people.find((x) => x.staffNo === 'P93-OPEN-1')!;
    const creds = ds.credentials.filter((c) => c.personId === person.id);
    expect(creds.map((c) => [c.type, c.source, c.expiresOn]).sort()).toEqual([
      ['FOMEMA', 'typed', '2027-03-15'],
      ['FW_INSURANCE', 'typed', '2026-12-31'],
    ]);
    const board = await svc.fwmBoard(fwm);
    expect(board.workers.find((w) => w.staffNo === 'P93-OPEN-1')?.papers.find((x) => x.paper === 'FOMEMA')?.source).toBe('typed');
  });
});

describe('P93 foreign workers on the guard phone', { timeout: 60000 }, () => {
  it('a foreign worker with a guard sign-in enrols like any guard; the FWM board shows each step', async () => {
    const { ds, svc, user } = fresh();
    const np = ds.users.find((u) => {
      const p = ds.people.find((x) => x.id === u.personId);
      return u.role === 'guard' && p?.nationality === 'NP' && p.companyId === 'co-sasa' && p.status === 'active';
    })!;
    expect(np).toBeTruthy();
    const person = ds.people.find((p) => p.id === np.personId)!;
    person.pinHash = null;
    const fwm = user('u-fwm-ex1');
    const row = async () => (await svc.fwmBoard(fwm)).workers.find((w) => w.id === person.id)!;
    expect((await row()).phone).toMatchObject({ login: true, pin: false, state: 'none', canEnrol: false });
    // FWM does not set PINs or enrol phones; the company office does.
    await expect(svc.guardPhone.issueCode(fwm, person.id)).rejects.toBeInstanceOf(AccessDenied);
    const cm = user('u-cm-sasa');
    await svc.setStaffPin(cm, person.id, '4826');
    const code = await svc.guardPhone.issueCode(cm, person.id);
    expect((await row()).phone).toMatchObject({ pin: true, state: 'issued' });
    const r = await svc.guardPhone.enrol(np, { phoneId: code.phoneId, code: code.code, staffNo: person.staffNo, deviceLabel: 'Android test' });
    expect(r.ok).toBe(true);
    const ready = (await row()).phone;
    expect(ready.state).toBe('active');
    expect(JSON.stringify(ready)).not.toContain(code.code.replace('-', ''));
    // Own duty, view only, with the worker's papers among the reminders when one runs out.
    const duty = await svc.myDuty(np);
    expect(duty.person.id).toBe(person.id);
    // A worker added without a guard sign-in shows that plainly.
    await svc.addFwWorker(fwm, { ...base, staffNo: 'P93-NOLOGIN-1' });
    const added = (await svc.fwmBoard(fwm)).workers.find((w) => w.staffNo === 'P93-NOLOGIN-1')!;
    expect(added.phone).toMatchObject({ login: false, pin: false, state: 'none' });
  });
});
