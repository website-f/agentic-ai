// K8 / N1 (Fauzan, 11 Nov 2026): the bulk load helper. Synthetic data only: made-up names, made-up IC and passport numbers.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  STAFF_DIRECTORY_TARGET,
  bulkAiRequest,
  bulkTargetOf,
  docTypeOf,
  fileAiRequest,
  flagRows,
  generateDataset,
  maskFileName,
  myt,
  normaliseTable,
  parseBulkAiAnswer,
  parseFileAiAnswer,
  placeFile,
  planColumns,
  prepareSheet,
  rankDestinations,
  smartMatch,
  staffDirectoryCsv,
  toCsv,
  withOrgLinks,
  type AlignField,
} from '../src';

const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');
function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = withOrgLinks(new MemoryStore(ds));
  const svc = new PrimaService(store, () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user };
}

// A foreign worker list as an office keeps it (Malay headings, month-first dates), one bad row and one repeated row.
const FW = [
  ['Bil', 'ID Pekerja', 'Nama', 'Tkh Lahir', 'No. Pasport', 'Tarikh Masuk', 'Cawangan', 'Warganegara'],
  ['1', 'NP-91001', 'Ram Synthetic', '12/25/1990', 'PA1234567', '06/01/2020', 'Sasa Selangor', 'Nepal'],
  ['2', 'NP-91002', 'Hari Testlama', '01/02/1994', 'PB7654321', '09/15/2021', 'Sasa Selangor', 'Nepal'],
  ['3', 'NP-91003', '', 'not a date', 'PC1112223', '09/15/2021', 'Sasa Selangor', 'Nepal'],
  ['4', 'NP-91002', 'Hari Testlama', '01/02/1994', 'PB7654321', '09/15/2021', 'Sasa Selangor', 'Nepal'],
];
// An office staff list in the staff directory's own words; the IC column is extra and is never sent anywhere.
const STAFF = [
  ['Kumpulan', 'Syarikat', 'Nama Kakitangan', 'Jawatan', 'Emel', 'No KP'],
  ['company', 'Synthetic Guarding Sdn Bhd', 'Siti Contoh Satu', 'PENGURUS', 'siti.satu@example.test', '900101-14-5678'],
  ['central_unit', 'UNIT IT', 'Ahmad Contoh Dua', 'EKSEKUTIF IT', 'ahmad.dua@example.test', '880202-10-1234'],
  ['operations_region', 'OPERASI JOHOR', 'Lim Contoh Tiga', 'PEGAWAI OPERASI', 'not-an-email', '870303-01-4321'],
];

describe('K8 data manager: where a bulk file goes', () => {
  it('proposes the foreign worker record for a worker list and the staff directory for a staff list', () => {
    const targets = [bulkTargetOf('fwWorker'), bulkTargetOf('site'), bulkTargetOf('client'), STAFF_DIRECTORY_TARGET];
    const fw = prepareSheet(FW, targets[0].fields);
    const g = rankDestinations(fw.table, targets, 'senarai pekerja asing.xlsx');
    expect(g[0].kind).toBe('fwWorker');
    expect(g[0].fit).toBeGreaterThan(g[1].fit);
    expect(g[0].why).toMatch(/columns match Foreign worker/);
    const st = prepareSheet(STAFF, STAFF_DIRECTORY_TARGET.fields);
    const s = rankDestinations(st.table, targets, 'staff.csv');
    expect(s[0].kind).toBe('staffDirectory');
    expect(s[0].requiredMatched).toBe(s[0].required);
  });

  it('holds a column it is unsure of for the person, with its suggestion', () => {
    const t = bulkTargetOf('fwWorker');
    const table = [['Kolum Z', 'Nama', 'ID Pekerja'], ['NP-1', 'Ram Synthetic', 'NP-91001'], ['NP-2', 'Hari Testlama', 'NP-91002']];
    const plan = planColumns(table, t);
    for (const c of plan) if (c.held) expect(c.field).toBeNull();
    expect(plan.find((c) => c.header === 'Nama')?.field).toBe('name');
  });

  it('flags rows that look wrong or repeated, naming the field and never the value', () => {
    const t = bulkTargetOf('fwWorker');
    const prep = prepareSheet(FW, t.fields);
    const m = smartMatch(prep.table, t.fields, { headerRow: 0 });
    const flags = flagRows(prep.table, m.columns.map((c) => c.field), t);
    const wrong = flags.find((f) => f.row === 4 && f.kind === 'wrong')!;
    expect(wrong.reasons.join(' ')).toMatch(/Name is empty/);
    expect(wrong.reasons.join(' ')).toMatch(/not a date/);
    expect(flags.find((f) => f.row === 5 && f.kind === 'duplicate')?.reasons[0]).toBe('Same as row 3.');
    expect(JSON.stringify(flags)).not.toMatch(/PB7654321|Hari|NP-91002/);
    // An email that is not one is wrong for the staff directory too.
    const st = prepareSheet(STAFF, STAFF_DIRECTORY_TARGET.fields);
    const sm = smartMatch(st.table, STAFF_DIRECTORY_TARGET.fields, { headerRow: 0 });
    expect(flagRows(st.table, sm.columns.map((c) => c.field), STAFF_DIRECTORY_TARGET).map((f) => [f.row, f.reasons])).toEqual([[4, ['Email (mailbox) is not an email address.']]]);
  });
});

describe('K8 file manager: what each file is and whose it is', () => {
  const people = [
    { id: 'p1', label: 'Siti Contoh Satu (SG-0001)', name: 'Siti Contoh Satu', keys: ['SG-0001', '900101-14-5678'] },
    { id: 'p2', label: 'Ahmad Contoh Dua (SG-0002)', name: 'Ahmad bin Contoh Dua', keys: ['SG-0002'] },
    { id: 'p3', label: 'Ahmad Contoh Lain (SG-0003)', name: 'Ahmad Contoh Lain', keys: ['SG-0003'] },
  ];
  it('reads the document type from the name and the file type', () => {
    expect(docTypeOf('SG-0001_sijil_spm.pdf', 'application/pdf')).toMatchObject({ type: 'certificate', level: 'sure' });
    expect(docTypeOf('permit kerja ram.pdf', 'application/pdf').type).toBe('permit');
    expect(docTypeOf('kontrak-ahmad.pdf', 'application/pdf').type).toBe('contract');
    expect(docTypeOf('IMG_2041.jpg', 'image/jpeg')).toMatchObject({ type: 'photo', level: 'sure' });
    expect(docTypeOf('DSC2041.jpg', 'image/jpeg')).toMatchObject({ type: 'photo', level: 'likely' });
    expect(docTypeOf('scan001.pdf', 'application/pdf')).toMatchObject({ type: 'other', level: 'check' });
  });
  it('places a file by staff or IC number for sure, by a whole name as likely, and holds the rest', () => {
    expect(placeFile('SG-0001 sijil.pdf', people)).toMatchObject({ personId: 'p1', level: 'sure' });
    expect(placeFile('900101145678_ic.pdf', people)).toMatchObject({ personId: 'p1', level: 'sure' });
    expect(placeFile('Ahmad Contoh Dua - kontrak.pdf', people)).toMatchObject({ personId: 'p2', level: 'likely' });
    const both = placeFile('ahmad contoh.pdf', people);
    expect(both.personId).toBeNull();
    expect(both.level).toBe('check');
    expect(placeFile('scan001.pdf', people)).toMatchObject({ personId: null, level: 'check' });
  });
});

describe('K8 the AI sees no IC number, name or whole record', () => {
  it('the data file request carries masked headings and value shapes only', () => {
    const targets = [STAFF_DIRECTORY_TARGET, bulkTargetOf('fwWorker')];
    // A file with no header row: the "headings" are a person's line. Nothing of it may reach the AI.
    const req = bulkAiRequest(
      {
        fileName: 'Siti Contoh Satu 900101-14-5678.xlsx',
        columns: [
          { index: 0, header: 'Siti Contoh Satu', samples: ['Ahmad Contoh Dua', 'Lim Contoh Tiga'] },
          { index: 1, header: '900101-14-5678', samples: ['880202-10-1234', '870303014321'] },
          { index: 2, header: 'Emel', samples: ['siti.satu@example.test'] },
          { index: 3, header: 'No. Pasport', samples: ['PA1234567'] },
        ],
      },
      targets,
    );
    expect(req.tools).toBeNull();
    expect(req.history).toEqual([]);
    const sent = JSON.stringify(req);
    for (const secret of ['Siti', 'Contoh', 'Ahmad', 'Lim', '900101', '5678', '880202', '870303014321', 'PA1234567', 'siti.satu', 'example.test']) expect(sent).not.toContain(secret);
    // Every digit of the file became a 9: an IC can never be rebuilt from it (column indexes aside).
    expect(req.brief.replace(/"i":\d+/g, '')).not.toMatch(/[0-8]/);
    // The known heading words are kept, so the AI can still help.
    expect(req.brief).toContain('emel');
    expect(req.brief).toContain('pasport');
    expect(req.brief.length).toBeLessThan(20_000);
  });
  it('the many-files request carries masked names and types only, and never asks who', () => {
    const req = fileAiRequest([
      { name: 'Siti Contoh Satu_900101-14-5678_sijil.pdf', mime: 'application/pdf' },
      { name: 'Ram Synthetic permit PA1234567.jpg', mime: 'image/jpeg' },
    ]);
    const sent = JSON.stringify(req);
    for (const secret of ['Siti', 'Contoh', 'Ram', 'Synthetic', '900101', '5678', 'PA1234567']) expect(sent).not.toContain(secret);
    expect(sent).toContain('sijil');
    expect(sent).toContain('permit');
    expect(maskFileName('Ram_permit_2027.pdf')).toBe('aa permit 9999.pdf');
  });
  it("the AI's answers are checked: listed kinds, known columns and fields only", () => {
    const targets = [STAFF_DIRECTORY_TARGET];
    expect(parseBulkAiAnswer('{"kind":"staffDirectory","matches":[{"i":0,"key":"name"},{"i":0,"key":"email"},{"i":9,"key":"title"},{"i":1,"key":"salary"}]}', targets, [0, 1])).toEqual({ kind: 'staffDirectory', matches: [{ index: 0, field: 'name' }] });
    expect(parseBulkAiAnswer('{"kind":"payroll","matches":[]}', targets, [0]).kind).toBeNull();
    expect(parseFileAiAnswer('{"types":[{"i":0,"type":"permit"},{"i":0,"type":"photo"},{"i":5,"type":"permit"},{"i":1,"type":"bank"}]}', 2)).toEqual([{ index: 0, type: 'permit' }]);
  });
});

describe('K8 service: destinations, permissions and the load record', { timeout: 60000 }, () => {
  it('offers only the destinations a role may write; the staff directory only to HR', async () => {
    const { svc, user } = fresh();
    const hr = (await svc.bulkManager.targets(user('u-pwvsb-hr'))).map((t) => t.kind);
    expect(hr[0]).toBe('staffDirectory');
    expect(hr).toContain('publicHoliday');
    expect(hr).not.toContain('fwWorker');
    const fwm = (await svc.bulkManager.targets(user('u-fwm-ex1'))).map((t) => t.kind);
    expect(fwm).toContain('fwWorker');
    expect(fwm).not.toContain('staffDirectory');
    const fin = (await svc.bulkManager.targets(user('u-fin-t1-lead'))).map((t) => t.kind);
    expect(fin).not.toContain('staffDirectory');
    expect(fin).not.toContain('fwWorker');
  });

  it('refuses a site officer, a feed login and a despatch at the door', async () => {
    const { svc, user } = fresh();
    await expect(svc.bulkManager.board(user('u-sv-sasa'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.bulkManager.board(user('u-ja-sync'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.bulkManager.placeFiles(user('u-fwm-desp'), [{ name: 'x.pdf', mime: 'application/pdf' }])).rejects.toBeInstanceOf(AccessDenied);
  });

  it('a worker list goes to Foreign workers after FWM confirms; the bad and repeated rows are left out with reasons', async () => {
    const { ds, svc, user } = fresh();
    const fwm = user('u-fwm-ex1');
    const targets = await svc.bulkManager.targets(fwm);
    const fwSheet = FW.map((r, i) => (i === 0 ? r : r)); // as read on the device
    const target = targets.find((t) => t.kind === rankDestinations(prepareSheet(fwSheet, targets[0].fields).table, targets, 'pekerja asing.xlsx')[0].kind)!;
    expect(target.kind).toBe('fwWorker');
    const prep = prepareSheet(fwSheet, target.fields);
    const plan = planColumns(prep.table, target);
    const mapping = plan.map((c) => c.field ?? c.suggested ?? '');
    const flags = flagRows(prep.table, mapping, target);
    const skip = [...new Set(flags.map((f) => f.row))];
    expect(skip).toEqual([4, 5]);
    const m = smartMatch(prep.table, target.fields as AlignField[], { headerRow: 0 });
    const csv = toCsv(normaliseTable(prep.table, 0, m.columns.map((c, i) => ({ ...c, field: mapping[i] || null })), target.fields));
    const p = await svc.orgImport.preview(fwm, 'fwWorker', 'co-sasa', csv, { mapping, headerRow: 0, skip });
    expect(p.canImport).toBe(true);
    const receipt = await svc.orgImport.commit(fwm, 'fwWorker', 'co-sasa', csv, p.fingerprint, { mapping, headerRow: 0, skip });
    expect(ds.people.filter((x) => x.staffNo === 'NP-91002')).toHaveLength(1);
    // Someone else cannot claim this load; the loader records it once, with counts from the receipt.
    const refused = flags.map((f) => ({ row: f.row, reasons: f.reasons }));
    const input = { via: 'import', receiptId: receipt.id, fileName: 'pekerja asing.xlsx', rowsInFile: 4, plan: plan.map((c, i) => ({ header: c.header, field: mapping[i] || null })), refused, loaded: 999 };
    await expect(svc.bulkManager.recordData(user('u-fwm-ex2'), input)).rejects.toThrow(/not one you made/);
    const load = await svc.bulkManager.recordData(fwm, input);
    expect(load).toMatchObject({ target: 'fwWorker', loaded: 2, rowsInFile: 4, loadedBy: fwm.name, confirmedBy: fwm.name, receiptId: receipt.id });
    expect(load.refused.map((r) => r.row)).toEqual([4, 5]);
    expect(load.refused[0].reasons.join(' ')).toMatch(/Name is empty/);
    expect(JSON.stringify(load)).not.toMatch(/PA1234567|PB7654321|Ram Synthetic/);
    await expect(svc.bulkManager.recordData(fwm, input)).rejects.toThrow(/already recorded/);
    // The loader and oversight see it; another FWM executive does not.
    expect((await svc.bulkManager.loads(fwm)).map((l) => l.id)).toEqual([load.id]);
    expect((await svc.bulkManager.loads(user('u-audit'))).map((l) => l.id)).toEqual([load.id]);
    expect(await svc.bulkManager.loads(user('u-fwm-ex2'))).toEqual([]);
  });

  it('a staff list goes to the staff directory through HR, and the record shows the HR Director’s approval', async () => {
    const { ds, svc, user } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const prep = prepareSheet(STAFF, STAFF_DIRECTORY_TARGET.fields);
    const plan = planColumns(prep.table, STAFF_DIRECTORY_TARGET);
    const mapping = plan.map((c) => c.field);
    expect(mapping.slice(0, 5)).toEqual(['group', 'org_unit', 'name', 'title', 'email']);
    const flags = flagRows(prep.table, mapping, STAFF_DIRECTORY_TARGET);
    const text = staffDirectoryCsv(prep.table, mapping, flags.map((f) => f.row));
    // The IC column has no field: it never reaches the staff directory.
    expect(text).not.toContain('900101');
    const p = await svc.staffDirectory.preview(hr, { text, source: 'staff.csv' });
    const sent = await svc.staffDirectory.submit(hr, { text, source: 'staff.csv', fingerprint: p.fingerprint });
    const load = await svc.bulkManager.recordData(hr, { via: 'staffDirectory', batchId: sent.id, fileName: 'staff.csv', rowsInFile: 3, plan: plan.map((c) => ({ header: c.header, field: c.field })), refused: flags.map((f) => ({ row: f.row, reasons: f.reasons })) });
    expect(load).toMatchObject({ target: 'staffDirectory', loaded: 2, refused: [{ row: 4, reasons: ['Email (mailbox) is not an email address.'] }] });
    expect((await svc.bulkManager.loads(hr))[0].approval).toMatchObject({ status: 'waiting' });
    await expect(svc.bulkManager.recordData(user('u-cos'), { via: 'staffDirectory', batchId: sent.id, fileName: 'x.csv', rowsInFile: 3 })).rejects.toThrow(/not one you sent/);
    await svc.staffDirectory.decide(await svc.user('u-cos'), { batchId: sent.id, approve: true, comment: 'Checked against the synthetic list.' });
    const seen = (await svc.bulkManager.loads(user('u-cos')))[0];
    expect(seen.approval).toMatchObject({ status: 'approved', by: user('u-cos').name });
    expect(ds.staffDirectory.map((e) => e.name).sort()).toEqual(['Ahmad Contoh Dua', 'Siti Contoh Satu']);
  });

  it('files many documents only on people whose file this person keeps, and records what went where', async () => {
    const { ds, svc, user } = fresh();
    const hr = user('u-pwvsb-hr');
    const office = ds.people.find((p) => p.role === 'office' && p.status !== 'left')!;
    const guard = ds.people.find((p) => p.role === 'guard' && p.companyId === 'co-sasa' && p.status !== 'left')!;
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic').toString('base64')}`;
    const proposals = await svc.bulkManager.placeFiles(hr, [
      { name: `${office.staffNo} sijil.pdf`, mime: 'application/pdf' },
      { name: 'scan001.pdf', mime: 'application/pdf' },
    ]);
    expect(proposals.files[0].who).toMatchObject({ personId: office.id, level: 'sure' });
    expect(proposals.files[0].doc.type).toBe('certificate');
    expect(proposals.files[1].who.personId).toBeNull();
    // The company manager keeps guards' files, never office staff's (HR governs those): refused.
    await expect(svc.bulkManager.fileOne(user('u-cm-sasa'), { personId: office.id, docType: 'certificate', name: 'a.pdf', data: pdf })).rejects.toBeInstanceOf(AccessDenied);
    const filed = await svc.bulkManager.fileOne(hr, { personId: office.id, docType: 'certificate', name: `${office.staffNo} sijil.pdf`, data: pdf });
    expect((await svc.personDocs(hr, office.id)).map((d) => d.caption)).toContain('Certificate (bulk load)');
    await expect(svc.bulkManager.recordFiles(hr, { placed: [{ file: 'x.pdf', personId: guard.id, docType: 'certificate', docId: filed.docId }] })).rejects.toThrow(/not on that person/);
    const load = await svc.bulkManager.recordFiles(hr, { placed: [{ file: `${office.staffNo} sijil.pdf`, personId: office.id, docType: 'certificate', docId: filed.docId }], held: [{ file: 'scan001.pdf', reason: 'No staff number or name in the file name.' }] });
    expect(load).toMatchObject({ kind: 'files', loaded: 1, rowsInFile: 2, held: [{ file: 'scan001.pdf' }], placed: [{ personId: office.id, docType: 'certificate' }] });
  });
});
