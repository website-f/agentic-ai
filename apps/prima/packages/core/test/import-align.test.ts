// P81: any spreadsheet, auto-aligned to the record's fields. Synthetic data only.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  COMPANY_FIELD,
  MemoryStore,
  PrimaService,
  RECORD_KINDS,
  alignColumns,
  cleanGrid,
  columnShape,
  findHeaderRow,
  generateDataset,
  matchCompany,
  matchOption,
  myt,
  normBool,
  normDate,
  normMoney,
  parseCsv,
  readXlsx,
  similarity,
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
  // A company manager and the company they run, whatever the seed's companies are called.
  const cm = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.length === 1)!;
  const co = ds.companies.find((c) => c.id === cm.companyIds[0])!;
  const other = ds.companies.find((c) => c.id !== co.id && !cm.companyIds.includes(c.id))!;
  return { ds, svc, user, cm, co, other };
}

const fieldsOf = (kind: keyof typeof RECORD_KINDS) => RECORD_KINDS[kind].fields as AlignField[];

describe('matching', () => {
  it('similarity is difflib ratio', () => {
    expect(similarity('abcd', 'bcde')).toBeCloseTo(0.75);
    expect(similarity('tarikh tamat', 'tarikh tamat')).toBe(1);
    expect(similarity('', 'x')).toBe(0);
  });

  it('finds the header row under a title block, in Malay', () => {
    const table = [
      ['SENARAI KENDERAAN SYARIKAT 2026'],
      ['Disediakan oleh: Unit Pengangkutan'],
      ['Bil', 'No. Plat', 'Jenama / Model', 'Jenis', 'Cukai Jalan', 'Insurans', 'Bacaan Meter'],
      ['1', 'WXY 1234', 'Proton Saga', 'Kereta', '01/03/2027', '15-04-27', '45,210'],
    ];
    const f = fieldsOf('vehicle');
    expect(findHeaderRow(table, f)).toBe(2);
    const cols = alignColumns(table[2], table.slice(3), f);
    const by = Object.fromEntries(cols.filter((c) => c.field).map((c) => [c.header, c.field]));
    expect(by).toMatchObject({ 'No. Plat': 'plate', 'Jenama / Model': 'model', Jenis: 'kind', 'Cukai Jalan': 'roadTax', Insurans: 'insurance', 'Bacaan Meter': 'odometerKm' });
    expect(cols.find((c) => c.header === 'Bil')!.field).toBeNull();
  });

  it('matches close spellings and, with no header, what the values look like', () => {
    const f = fieldsOf('officeStaff');
    const cols = alignColumns(
      ['Staf Name', 'Col B', 'Col C', 'Tarikh Lahr'],
      [
        ['Aina Synthetic', 'aina@example.com', '900101-01-1234', '01/01/1990'],
        ['Badrul Synthetic', 'badrul@example.com', '880202-02-5678', '02/02/1988'],
      ],
      f,
    );
    expect(cols.map((c) => [c.field, c.how])).toEqual([
      ['name', 'synonym'],
      ['email', 'shape'],
      ['idFull', 'shape'],
      ['dob', 'fuzzy'],
    ]);
    expect(columnShape(['RM 1,200.00', 'RM 950', 'RM12.50'])).toBe('money');
    expect(columnShape(['ya', 'tidak', 'Ya'])).toBe('bool');
  });

  it('offers a Company column when the record belongs to a company', () => {
    const cols = alignColumns(['Syarikat', 'No. Lesen'], [['X', 'Y']], [...fieldsOf('licence'), { key: COMPANY_FIELD, label: 'Company', type: 'text' }]);
    expect(cols.map((c) => c.field)).toEqual([COMPANY_FIELD, 'reference']);
  });
});

describe('values', () => {
  it('reads dates as Malaysia types them, and Excel serials', () => {
    expect(normDate('01/03/2027').iso).toBe('2027-03-01');
    expect(normDate('1-3-27').iso).toBe('2027-03-01');
    expect(normDate('15.04.1965').iso).toBe('1965-04-15');
    expect(normDate('2027-03-01').iso).toBe('2027-03-01');
    expect(normDate('1 Mac 2027').iso).toBe('2027-03-01');
    expect(normDate('01-Ogos-27').iso).toBe('2027-08-01');
    expect(normDate('46082').iso).toBe('2026-03-01');
    expect(normDate('01/03/2027 09:30').iso).toBe('2027-03-01');
    expect(normDate('30/02/2027')).toEqual({ iso: null, matched: true });
    expect(normDate('next week')).toEqual({ iso: null, matched: false });
    expect(normDate('12').matched).toBe(false);
  });

  it('reads yes and no, money and choices in English or Malay', () => {
    expect([normBool('Ya'), normBool('tidak'), normBool('Y'), normBool('maybe')]).toEqual([true, false, true, null]);
    expect([normMoney('RM 1,234.50'), normMoney('(500.00)'), normMoney('MYR2,000'), normMoney('abc')]).toEqual(['1234.5', '-500', '2000', null]);
    const gender: [string, string][] = [
      ['F', 'Female'],
      ['M', 'Male'],
    ];
    expect(matchOption('Lelaki', gender)).toBe('M');
    expect(matchOption('perempuan', gender)).toBe('F');
    const emp = RECORD_KINDS.officeStaff.fields.find((f) => f.key === 'employmentType')!.options!;
    expect(matchOption('Tetap', emp)).toBe('permanent');
    expect(matchOption('Percubaan', emp)).toBe('probation');
    expect(matchOption('Permanent staff', emp)).toBe('permanent');
    expect(matchOption('Nonsense', emp)).toBeNull();
  });

  it('matches company names loosely, but never between two', () => {
    const cos = [
      { id: 'c1', name: 'Arrow Shield Security Sdn Bhd', code: 'ARSH' },
      { id: 'c2', name: 'Synthetic Guard Services Sdn Bhd', code: 'SYN' },
      { id: 'c3', name: 'Synthetic Guard Sdn Bhd', code: 'SYG' },
    ];
    expect(matchCompany('ARSH', cos)).toEqual({ id: 'c1', exact: true });
    expect(matchCompany('ARROW SHIELD SECURITY SN BHD', cos)).toEqual({ id: 'c1', exact: true });
    expect(matchCompany('Arrow Shield Securty', cos)).toEqual({ id: 'c1', exact: false });
    expect(matchCompany('Synthetic Guard Services', cos)?.id).toBe('c2');
    expect(matchCompany('Unknown Holdings', cos)).toBeNull();
  });

  it('CSV out and back is the same grid', () => {
    const grid = cleanGrid([['a', 'b, c', 'he said "hi"'], [], ['', ' x', 'line\nbreak', '', ''], [null, undefined, 3]]);
    expect(grid).toEqual([
      ['a', 'b, c', 'he said "hi"'],
      ['', ' x', 'line\nbreak'],
      ['', '', '3'],
    ]);
    expect(parseCsv(toCsv(grid))).toEqual(grid);
  });
});

/** A minimal .xlsx: the zip container written here, the parts as Excel writes them. */
function xlsx(parts: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, xml] of Object.entries(parts)) {
    const raw = enc.encode(xml);
    const data = deflateRawSync(raw);
    const n = enc.encode(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, Buffer.from(n), data);
    centrals.push(ch, Buffer.from(n));
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

describe('Excel', () => {
  it('reads shared strings, rich text, numbers, booleans and date-styled serials', async () => {
    const file = xlsx({
      'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Senarai &amp; Lesen" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>No. Lesen</t></si><si><r><t>Tarikh </t></r><r><t>Tamat</t></r></si><si><t>KDN/2026/0001</t></si></sst>',
      'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>0.30000000000000004</v></c><c r="C3" s="1"><v>46082</v></c><c r="D3" t="b"><v>1</v></c><c r="E3" t="inlineStr"><is><t>Ya &lt;ok&gt;</t></is></c><c r="F3" s="2"><v>23847</v></c></row></sheetData></worksheet>',
    });
    const sheets = await readXlsx(file, async (b) => new Uint8Array(inflateRawSync(b)));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Senarai & Lesen');
    expect(sheets[0].rows).toEqual([[], ['No. Lesen', '', 'Tarikh Tamat'], ['KDN/2026/0001', '0.3', '2026-03-01', 'TRUE', 'Ya <ok>', '1965-04-15']]);
  });

  it('says plainly when the file is not an .xlsx', async () => {
    await expect(readXlsx(new TextEncoder().encode('a,b\n1,2'), async (b) => b)).rejects.toThrow(/not an Excel/);
  });
});

// Each row is saved and rolled back on a fresh dataset: over a second each, slower when the whole suite runs at once.
describe('import from any sheet', { timeout: 30000 }, () => {
  it('clients: Malay headers under a banner, a row skipped, then all chosen rows or none', async () => {
    const { ds, svc, cm, co } = fresh();
    const site = ds.sites.find((s) => s.companyId === co.id)!;
    const csv = toCsv([
      ['SENARAI PELANGGAN (SISTEM LAMA)'],
      ['Bil', 'Nama Pelanggan', 'Tapak', 'Tarikh Tamat Kontrak', 'Catatan'],
      ['1', 'Synthetic Client Alpha', site.code, '31/12/2027', 'lama'],
      ['2', 'Synthetic Client Beta', 'NO-SUCH-SITE', '30/06/2027', ''],
      ['3', 'Synthetic Client Gamma', '', '45900', ''],
    ]);
    const before = ds.clientAccounts.length;
    const p = await svc.orgImport.preview(cm, 'client', co.id, csv);
    expect(p.headerRow).toBe(1);
    expect(p.columns.map((c) => c.field)).toEqual([null, 'name', 'sites', 'contractEndsOn', null]);
    expect(p.rows.map((r) => [r.row, r.ok])).toEqual([
      [3, true],
      [4, false],
      [5, true],
    ]);
    expect(p.rows[1].problems.join(' ')).toMatch(/NO-SUCH-SITE.*not a site of this company/);
    expect(p.canImport).toBe(false);
    expect(ds.clientAccounts.length).toBe(before);
    // Commit refuses while a chosen row is bad.
    // A row the real save refuses stops the whole commit: nothing of the file is kept.
    await expect(svc.orgImport.commit(cm, 'client', co.id, csv, p.fingerprint)).rejects.toThrow(/Row 4: Site "NO-SUCH-SITE".*Nothing was imported/);
    expect(ds.clientAccounts.length).toBe(before);
    const p2 = await svc.orgImport.preview(cm, 'client', co.id, csv, { skip: [4] });
    expect(p2.canImport).toBe(true);
    expect(p2.skippedRows).toBe(1);
    expect(p2.fingerprint).not.toBe(p.fingerprint);
    // The skip list is part of what was previewed.
    await expect(svc.orgImport.commit(cm, 'client', co.id, csv, p2.fingerprint)).rejects.toThrow(/changed since the preview/);
    const r = await svc.orgImport.commit(cm, 'client', co.id, csv, p2.fingerprint, { skip: [4] });
    expect(r.rows).toBe(2);
    expect(r.skippedRows).toEqual([4]);
    expect(r.recordIds).toHaveLength(2);
    const added = ds.clientAccounts.filter((a) => a.name.startsWith('Synthetic Client'));
    expect(added.map((a) => a.name).sort()).toEqual(['Synthetic Client Alpha', 'Synthetic Client Gamma']);
    expect(added.find((a) => a.name.endsWith('Alpha'))!.siteIds).toEqual([site.id]);
    expect(added.find((a) => a.name.endsWith('Gamma'))!.contractEndsOn).toBe('2025-08-31');
    expect(ds.audit.at(-1)!.action).toBe('org.import');
    await expect(svc.orgImport.commit(cm, 'client', co.id, csv, p2.fingerprint, { skip: [4] })).rejects.toThrow(/already imported/);
  });

  it('the person can change a column and fix a row before importing', async () => {
    const { svc, cm, co } = fresh();
    // "Remarks" is not a client field, and the end date column has a header Prima cannot place.
    const grid = [
      ['Customer', 'Remarks', 'Habis'],
      ['Synthetic Client Delta', 'x', '31/02/2027'],
    ];
    const p = await svc.orgImport.preview(cm, 'client', co.id, toCsv(grid));
    expect(p.columns.map((c) => c.field)).toEqual(['name', null, null]);
    expect(p.ignoredColumns).toEqual(['Remarks', 'Habis']);
    const mapping = ['name', '', 'contractEndsOn'];
    const bad = await svc.orgImport.preview(cm, 'client', co.id, toCsv(grid), { mapping });
    expect(bad.columns[2]).toMatchObject({ field: 'contractEndsOn', how: 'manual' });
    expect(bad.rows[0].problems.join(' ')).toMatch(/not a real date/);
    grid[1][2] = '28/02/2027';
    const ok = await svc.orgImport.preview(cm, 'client', co.id, toCsv(grid), { mapping });
    expect(ok.canImport).toBe(true);
    await expect(svc.orgImport.preview(cm, 'client', co.id, toCsv(grid), { mapping: ['name', 'name', ''] })).rejects.toThrow(/Two columns are set to "Client"/);
    await expect(svc.orgImport.preview(cm, 'client', co.id, toCsv(grid), { mapping: ['name', 'bogus', ''] })).rejects.toThrow(/field this record does not have/);
  });

  it('a Company column sends each row to its company, and refuses companies the person does not keep', async () => {
    const { ds, svc, cm, co, other } = fresh();
    const before = ds.licences.length;
    const csv = toCsv([
      ['Syarikat', 'Jenis', 'No. Rujukan', 'Tarikh Tamat'],
      [co.name.toUpperCase().replace('SDN BHD', 'SN BHD'), 'Lesen KDN', 'SYN-KDN-1', '01/01/2028'],
      [other.name, 'KDN licence', 'SYN-KDN-2', '01/01/2028'],
    ]);
    const p = await svc.orgImport.preview(cm, 'licence', null, csv);
    expect(p.rows[0]).toMatchObject({ ok: true, company: { id: co.id } });
    expect(p.rows[1].ok).toBe(false);
    expect(p.rows[1].problems.join(' ')).toMatch(/not one of the companies you keep/);
    const r = await svc.orgImport.commit(cm, 'licence', null, csv, (await svc.orgImport.preview(cm, 'licence', null, csv, { skip: [3] })).fingerprint, { skip: [3] });
    expect(r.companyId).toBe(co.id);
    expect(ds.licences.length).toBe(before + 1);
    expect(ds.licences.at(-1)).toMatchObject({ companyId: co.id, type: 'KDN_LICENCE', reference: 'SYN-KDN-1', expiresOn: '2028-01-01' });
  });

  it('insurance claims name their policy by its number; a contract links its client', async () => {
    const { ds, svc, cm, co } = fresh();
    const pol = ds.insurancePolicies.find((x) => x.companyId === co.id)!;
    const claims = toCsv([
      ['No. Polisi', 'No. Tuntutan', 'Butiran Kejadian', 'Tarikh Kejadian', 'Jumlah Tuntutan'],
      [pol.policyNo, 'SYN-CLM-1', 'Synthetic incident', '03/05/2026', 'RM 12,500.00'],
    ]);
    const p = await svc.orgImport.preview(cm, 'insuranceClaim', co.id, claims);
    expect(p.columns.map((c) => c.field)).toEqual(['policyId', 'ref', 'what', 'incidentOn', 'amountClaimed']);
    expect(p.rows[0].problems.join(' ')).toBe('');
    expect(p.rows[0].values).toMatchObject({ policyId: pol.id, amountClaimed: '12500', incidentOn: '2026-05-03' });

    const site = ds.sites.find((s) => s.companyId === co.id)!;
    const contracts = toCsv([
      ['Pelanggan', 'Tapak', 'No. Kontrak', 'Tarikh Mula', 'Tarikh Tamat', 'Kaedah Bil', 'Yuran Bulanan'],
      ['Synthetic Client Epsilon', site.code, 'SYN-CT-001', '01/01/2026', '31/12/2027', 'Fixed monthly fee', 'RM 18,000'],
    ]);
    await svc.orgImport.commit(cm, 'client', co.id, toCsv([['Client'], ['Synthetic Client Epsilon']]), (await svc.orgImport.preview(cm, 'client', co.id, toCsv([['Client'], ['Synthetic Client Epsilon']]))).fingerprint);
    const cp = await svc.orgImport.preview(cm, 'contract', co.id, contracts);
    expect(cp.missingColumns).toEqual([]);
    expect(cp.rows[0].problems).toEqual([]);
    const r = await svc.orgImport.commit(cm, 'contract', co.id, contracts, cp.fingerprint);
    const ct = ds.contracts.find((c) => c.id === r.recordIds[0])!;
    expect(ct).toMatchObject({ ref: 'SYN-CT-001', clientName: 'Synthetic Client Epsilon', siteIds: [site.id], startOn: '2026-01-01', endOn: '2027-12-31' });
    expect(ct.clientAccountId).toBe(ds.clientAccounts.find((a) => a.name === 'Synthetic Client Epsilon')!.id);
    expect(ct.versions[0].fixedFee).toBe(18000);
    // The sheet cannot carry the signed copy: it is still asked for on the first mobilisation item.
    expect(ct.mobilisation[0].status).toBe('open');
    expect(ct.paper?.docId ?? null).toBeNull();
  });

  it('kinds kept on their own reviewed path stay out', async () => {
    const { svc, cm } = fresh();
    for (const k of ['firearm', 'vault', 'company', 'dealerLicence', 'armsAgreement'])
      await expect(svc.orgImport.preview(cm, k as never, null, 'a\n1\n')).rejects.toThrow(/not imported in bulk/);
  });
});
