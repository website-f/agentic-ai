// P90: the new importable kinds go through the screen's own add, with its own permission. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  EXTRA_IMPORTS,
  MemoryStore,
  PrimaService,
  generateDataset,
  myt,
  normaliseTable,
  prepareSheet,
  smartMatch,
  toCsv,
  withOrgLinks,
  type AlignField,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = withOrgLinks(new MemoryStore(ds));
  const svc = new PrimaService(store, () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user };
}

/** What the browser does before sending: prepare the sheet, match it, normalise the cells. */
function browserSide(rows: string[][], kind: 'fwWorker' | 'purSupplier' | 'publicHoliday' | 'branch' | 'itAsset') {
  const fields = EXTRA_IMPORTS[kind].fields as AlignField[];
  const prep = prepareSheet(rows, fields);
  const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
  const table = normaliseTable(prep.table, 0, m.columns, fields);
  return { csv: toCsv(table), mapping: m.columns.map((c) => c.field ?? ''), match: m, prep };
}

const FW_SHEET = [
  ['SENARAI PEKERJA ASING (SISTEM LAMA)'],
  ['', '', '', '', 'Pasport', '', 'PLKS'],
  ['Bil', 'ID Pekerja', 'Nama', 'Tkh Lahir', 'No.', 'Tamat', 'Tamat', 'Cawangan', 'Warganegara'],
  ['1', 'NP-90001', 'Ram Synthetic', '12/25/1990', 'PA1234567', '03/15/2031', '07/30/2027', 'Sasa Selangor', 'Nepal'],
  ['2', 'NP-90002', 'Hari Testlama', '01/02/1994', 'PB7654321', '11/02/2030', '01/20/2027', 'Kuala Lumpur', 'NEPALI'],
  ['Jumlah', '2'],
];

describe('P90 foreign workers from an old list', { timeout: 60000 }, () => {
  it('FWM imports workers with their papers; month-first dates read right; passport kept to the last 4', async () => {
    const { ds, svc, user } = fresh();
    const fwm = user('u-fwm-ex1');
    const { csv, mapping, match, prep } = browserSide(FW_SHEET, 'fwWorker');
    expect(prep.droppedRows).toEqual([6]);
    // The joined date is not in this sheet: the person adds the column or the import says what is missing.
    expect(match.missing).toEqual(['hiredOn']);
    const withJoin = FW_SHEET.map((r, i) => (i === 2 ? [...r, 'Tarikh Masuk'] : i === 3 ? [...r, '06/01/2020'] : i === 4 ? [...r, '09/15/2021'] : r));
    const b = browserSide(withJoin, 'fwWorker');
    expect(b.match.missing).toEqual([]);
    const p = await svc.orgImport.preview(fwm, 'fwWorker', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => [r.row, r.ok, r.problems])).toEqual([
      [2, true, []],
      [3, true, []],
    ]);
    // The preview never echoes a full passport number.
    expect(JSON.stringify(p)).not.toContain('PA1234567');
    expect(p.canImport).toBe(true);
    expect(ds.people.some((x) => x.staffNo === 'NP-90001')).toBe(false);
    const r = await svc.orgImport.commit(fwm, 'fwWorker', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping });
    expect(r.rows).toBe(2);
    const ram = ds.people.find((x) => x.staffNo === 'NP-90001')!;
    expect(ram).toMatchObject({ name: 'Ram Synthetic', nationality: 'NP', dob: '1990-12-25', hiredOn: '2020-06-01', companyId: 'co-sasa', branchId: 'br-sasa-1', role: 'guard' });
    expect(ram.idMasked.endsWith('4567')).toBe(true);
    expect(JSON.stringify(ds.people)).not.toContain('PA1234567');
    const hari = ds.people.find((x) => x.staffNo === 'NP-90002')!;
    expect(hari.branchId).toBe('br-sasa-2');
    const papers = ds.credentials.filter((c) => c.personId === ram.id);
    expect(papers.map((c) => [c.type, c.expiresOn, c.source, c.number]).sort()).toEqual([
      ['PASSPORT', '2031-03-15', 'typed', '****4567'],
      ['PLKS_PERMIT', '2027-07-30', 'typed', ''],
    ]);
    expect(ds.audit.some((a) => a.action === 'fwm.worker.add')).toBe(true);
    expect(ds.audit.at(-1)!.action).toBe('org.import');
    expect(ds.orgImports.at(-1)!.recordIds).toHaveLength(2);
    // On the FWM board at once, with the typed source shown.
    const board = await svc.fwmBoard(fwm);
    const row = board.workers.find((w) => w.staffNo === 'NP-90001')!;
    expect(row.papers.find((x) => x.paper === 'PASSPORT')!.source).toBe('typed');
  });

  it('only FWM staff may add: despatch, a company manager and HR are refused, row by row and at commit', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide(
      [
        ['Staff No', 'Name', 'Branch', 'DOB', 'Joined'],
        ['NP-90003', 'Suman Mockrai', 'Sasa Selangor', '01/01/1990', '01/01/2022'],
      ],
      'fwWorker',
    );
    for (const id of ['u-fwm-desp', 'u-cm-sasa', 'u-pwvsb-hr']) {
      const p = await svc.orgImport.preview(user(id), 'fwWorker', 'co-sasa', b.csv, { mapping: b.mapping });
      expect(p.canImport, id).toBe(false);
      await expect(svc.orgImport.commit(user(id), 'fwWorker', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping }), id).rejects.toThrow();
      await expect(svc.addFwWorker(user(id), { companyId: 'co-sasa', branchId: 'br-sasa-1', staffNo: 'NP-1', name: 'X Synthetic', dob: '1990-01-01', hiredOn: '2022-01-01' }), id).rejects.toThrow();
    }
    expect(ds.people.some((x) => x.staffNo === 'NP-90003')).toBe(false);
  });

  it('the add keeps its own checks: Nepali only, age 18 to 60, own branch, staff number once, real dates', async () => {
    const { svc, user } = fresh();
    const fwm = user('u-fwm-ex1');
    const base = { companyId: 'co-sasa', branchId: 'br-sasa-1', staffNo: 'NP-90010', name: 'Gopal Synthetic', dob: '1990-01-01', hiredOn: '2022-01-01' };
    await expect(svc.addFwWorker(fwm, { ...base, nationality: 'Indonesia' })).rejects.toThrow(/Nepali/);
    await expect(svc.addFwWorker(fwm, { ...base, dob: '2015-01-01' })).rejects.toThrow(/age/);
    await expect(svc.addFwWorker(fwm, { ...base, branchId: 'br-arsh-1' })).rejects.toThrow(/branch/);
    await expect(svc.addFwWorker(fwm, { ...base, permitExpiresOn: '2027-02-30' })).rejects.toThrow(/not a real date/);
    await expect(svc.addFwWorker(fwm, { ...base, passportIssuedOn: '2020-01-01' })).rejects.toThrow(/expiry date with its issue date/);
    const ok = await svc.addFwWorker(fwm, { ...base, nationality: 'Nepal', permitExpiresOn: '2027-06-30', fomemaExpiresOn: '2027-01-31' });
    expect(ok.papers).toBe(2);
    await expect(svc.addFwWorker(fwm, base)).rejects.toThrow(/already in Prima/);
  });
});

describe('P90 other kinds through their own add', { timeout: 60000 }, () => {
  it('branches: the company manager imports; FWM may not', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide(
      [
        ['Nama Cawangan', 'Negeri', 'Model'],
        ['Sasa Synthetic North', 'Kedah', 'Model B'],
        ['Sasa Synthetic East', 'Pahang', 'a'],
      ],
      'branch',
    );
    const denied = await svc.orgImport.preview(user('u-fwm-ex1'), 'branch', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(denied.canImport).toBe(false);
    const p = await svc.orgImport.preview(user('u-cm-sasa'), 'branch', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => r.problems)).toEqual([[], []]);
    await svc.orgImport.commit(user('u-cm-sasa'), 'branch', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping });
    expect(ds.branches.filter((x) => x.name.startsWith('Sasa Synthetic')).map((x) => [x.name, x.state, x.model, x.status])).toEqual([
      ['Sasa Synthetic North', 'Kedah', 'B', 'proposed'],
      ['Sasa Synthetic East', 'Pahang', 'A', 'proposed'],
    ]);
  });

  it('public holidays: HR imports; a company manager may not', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide(
      [
        ['Tarikh', 'Cuti', 'Negeri'],
        ['2027-12-26', 'Synthetic Holiday One', ''],
        ['27/12/2027', 'Synthetic Holiday Two', 'Johor, Kedah'],
      ],
      'publicHoliday',
    );
    const denied = await svc.orgImport.preview(user('u-cm-sasa'), 'publicHoliday', null, b.csv, { mapping: b.mapping });
    expect(denied.canImport).toBe(false);
    const p = await svc.orgImport.preview(user('u-pwvsb-hr'), 'publicHoliday', null, b.csv, { mapping: b.mapping });
    expect(p.canImport).toBe(true);
    const r = await svc.orgImport.commit(user('u-pwvsb-hr'), 'publicHoliday', null, b.csv, p.fingerprint, { mapping: b.mapping });
    expect(r.recordIds).toHaveLength(2);
    expect(ds.publicHolidays.filter((h) => h.name.startsWith('Synthetic Holiday')).map((h) => [h.date, h.states])).toEqual([
      ['2027-12-26', null],
      ['2027-12-27', ['Johor', 'Kedah']],
    ]);
  });

  it('suppliers: Procurement imports, the bank account is never echoed; a company manager may not', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide(
      [
        ['Vendor Name', 'ROC No', 'Bank', 'Acc No', 'Supplies'],
        ['Synthetic Supplies Sdn Bhd', 'SSM-90001', 'Synthetic Bank', '1234 5678 90', 'Uniform, Cleaning'],
      ],
      'purSupplier',
    );
    const denied = await svc.orgImport.preview(user('u-cm-sasa'), 'purSupplier', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(denied.canImport).toBe(false);
    const p = await svc.orgImport.preview(user('u-proc-exec'), 'purSupplier', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(p.rows[0].problems).toEqual([]);
    expect(JSON.stringify(p)).not.toContain('1234567890');
    await svc.orgImport.commit(user('u-proc-exec'), 'purSupplier', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping });
    const s = ds.purSuppliers.find((x) => x.ssmNo === 'SSM-90001')!;
    expect(s.categories).toEqual(['UNIFORM', 'CLEANING']);
    expect(s.bank.verifiedBy).toBeNull();
    expect(s.reviewedOn).toBeNull();
  });

  it('IT equipment: IT imports through the manual record; others may not; a duplicate tag stops the whole file', async () => {
    const { ds, svc, user } = fresh();
    const rows = [
      ['No. Aset', 'No. Siri', 'Jenis', 'Model', 'Lokasi', 'Tarikh Beli'],
      ['SYN-IT-0001', 'SYNSERIAL0001', 'Laptop', 'Synthetic Book 14', 'HQ level 3', '15/03/2023'],
      ['SYN-IT-0002', 'SYNSERIAL0002', 'Printer', 'Synthetic Jet 200', 'HQ store', '02/11/2022'],
    ];
    const b = browserSide(rows, 'itAsset');
    const denied = await svc.orgImport.preview(user('u-fwm-ex1'), 'itAsset', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(denied.canImport).toBe(false);
    const it = user('u-it-ex1');
    const p = await svc.orgImport.preview(it, 'itAsset', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => r.problems)).toEqual([[], []]);
    const before = ds.itAssets.length;
    await svc.orgImport.commit(it, 'itAsset', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping });
    expect(ds.itAssets.length).toBe(before + 2);
    expect(ds.itAssets.find((a) => a.tag === 'SYN-IT-0001')).toMatchObject({ kind: 'LAPTOP', boughtOn: '2023-03-15', status: 'spare', ownerId: 'co-sasa' });
    // The same tags again: refused, nothing kept.
    const again = browserSide([rows[0], ['SYN-IT-0003', 'SYNSERIAL0003', 'Laptop', 'Synthetic Book 15', 'HQ', ''], rows[1]], 'itAsset');
    const p2 = await svc.orgImport.preview(it, 'itAsset', 'co-sasa', again.csv, { mapping: again.mapping });
    expect(p2.rows[1].problems.join(' ')).toMatch(/already recorded/);
    await expect(svc.orgImport.commit(it, 'itAsset', 'co-sasa', again.csv, p2.fingerprint, { mapping: again.mapping })).rejects.toThrow(/already recorded.*Nothing was imported/);
    expect(ds.itAssets.some((a) => a.tag === 'SYN-IT-0003')).toBe(false);
  });
});
