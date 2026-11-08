// P90: the "Import from any file" matcher on synthetic messy spreadsheets: other languages, orders, short forms, typos,
// date formats, title blocks, group headers, totals lines, combined columns. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  EXTRA_IMPORTS,
  RECORD_KINDS,
  bestAssignment,
  composeHeader,
  dateOrderOf,
  headerMatch,
  headerSignature,
  importAiBrief,
  isTotalsRow,
  isoDateOf,
  jaroWinkler,
  normIc,
  normaliseTable,
  parseImportAiAnswer,
  pickSheet,
  prepareSheet,
  profileColumn,
  smartMatch,
  valueShape,
  type AlignField,
} from '../src';

const FW = EXTRA_IMPORTS.fwWorker.fields as AlignField[];
const STAFF = RECORD_KINDS.officeStaff.fields as AlignField[];

/** A small seeded random generator, so every run sees the same "random" layouts. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    s ^= s + Math.imul(s ^ (s >>> 7), 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
function shuffle<T>(r: () => number, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const FIRST = ['Ram', 'Hari', 'Bishnu', 'Krishna', 'Suman', 'Dipak', 'Ramesh', 'Gopal', 'Binod', 'Santosh', 'Prakash', 'Arjun'];
const LAST = ['Synthetic', 'Testlama', 'Sampleshrestha', 'Demogurung', 'Mockrai', 'Fakethapa'];

/** A date as an office types it: day first, month first, ISO, "1 Mac 2027" or an Excel serial. */
function fmt(iso: string, style: 'dmy' | 'mdy' | 'iso' | 'dmy-' | 'serial'): string {
  const [y, m, d] = iso.split('-');
  if (style === 'iso') return iso;
  if (style === 'dmy') return `${d}/${m}/${y}`;
  if (style === 'dmy-') return `${+d}-${+m}-${y.slice(2)}`;
  if (style === 'mdy') return `${m}/${d}/${y}`;
  return String(Math.round((Date.UTC(+y, +m - 1, +d) - Date.UTC(1899, 11, 30)) / 86400000));
}
const isoOf = (r: () => number, y0: number, y1: number) => {
  const y = y0 + Math.floor(r() * (y1 - y0 + 1));
  const m = 1 + Math.floor(r() * 12);
  const d = 1 + Math.floor(r() * 28);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Header words each office might use for a foreign-worker field. */
const FW_HEADERS: Record<string, string[]> = {
  staffNo: ['Staff No', 'No. Pekerja', 'Worker ID', 'Emp No', 'ID Pekerja', 'Staff Number'],
  name: ['Name', 'Nama', 'Worker Name', 'Nama Pekerja', 'Full Name', 'Nama Penuh'],
  branch: ['Branch', 'Cawangan', 'Office', 'Pejabat'],
  nationality: ['Nationality', 'Warganegara', 'Citizenship', 'Negara Asal'],
  dob: ['Date of Birth', 'Tarikh Lahir', 'DOB', 'Tkh Lahir', 'Birth Date'],
  hiredOn: ['Date Joined', 'Tarikh Masuk', 'Join Date', 'Tarikh Lantikan', 'Arrival Date'],
  passportNo: ['Passport No', 'No. Pasport', 'Paspot No', 'Passport Number', 'No Passport'],
  passportExpiresOn: ['Passport Expiry', 'Tarikh Tamat Pasport', 'Tamat Paspot', 'Passport Exp. Date', 'Pasport Tamat'],
  permitNo: ['PLKS No', 'Permit No', 'No. PLKS', 'Work Permit No'],
  permitExpiresOn: ['Tamat PLKS', 'Permit expiry', 'PLKS Expiry', 'Tarikh Tamat PLKS', 'Work Permit Expiry'],
  fomemaExpiresOn: ['FOMEMA', 'Fomema Expiry', 'Tarikh Fomema', 'Tamat FOMEMA'],
  phone: ['Phone', 'No. Tel', 'H/P', 'Telefon', 'Mobile No'],
};

/** One synthetic foreign-worker sheet in a random office's layout. Returns the table and the truth (header -> field). */
function fwSheet(seed: number) {
  const r = rng(seed);
  const keys = shuffle(r, Object.keys(FW_HEADERS)).slice(0, 7 + Math.floor(r() * 5));
  for (const must of ['staffNo', 'name', 'dob', 'passportExpiresOn', 'permitExpiresOn']) if (!keys.includes(must)) keys.push(must);
  const order = shuffle(r, keys);
  const style = pick(r, ['dmy', 'mdy', 'iso', 'dmy-', 'serial'] as const);
  const header = order.map((k) => pick(r, FW_HEADERS[k]));
  const rows: string[][] = [];
  for (let i = 0; i < 25; i++) {
    const v: Record<string, string> = {
      staffNo: `NP-${String(1000 + i * 7 + Math.floor(r() * 5)).padStart(5, '0')}`,
      name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      branch: pick(r, ['Kuala Lumpur', 'Johor Bahru', 'Penang']),
      nationality: pick(r, ['Nepal', 'NEPALI', 'Nepal']),
      dob: fmt(isoOf(r, 1975, 2003), style),
      hiredOn: fmt(isoOf(r, 2017, 2026), style),
      passportNo: `P${pick(r, ['A', 'B', ''])}${String(Math.floor(r() * 9e6) + 1e6)}`,
      passportExpiresOn: fmt(isoOf(r, 2027, 2034), style),
      permitNo: `PLKS${String(Math.floor(r() * 9e5) + 1e5)}`,
      permitExpiresOn: fmt(isoOf(r, 2026, 2028), style),
      fomemaExpiresOn: fmt(isoOf(r, 2026, 2027), style),
      phone: `01${Math.floor(r() * 10)}-${Math.floor(r() * 9e6) + 1e6}`,
    };
    // Month-first sheets need one day over 12 somewhere so the order can be proved; real sheets nearly always have one.
    rows.push(order.map((k) => v[k]));
  }
  if (style === 'mdy') rows[0] = order.map((k, i) => (/On$/.test(k) || k === 'dob' ? fmt(k === 'dob' ? '1990-07-25' : k === 'hiredOn' ? '2020-07-25' : '2029-07-25', 'mdy') : rows[0][i]));
  const truth = Object.fromEntries(header.map((h, i) => [h, order[i]]));
  return { table: [header, ...rows], truth, style };
}

describe('words', () => {
  it('Jaro-Winkler reads typos and short forms as close', () => {
    expect(jaroWinkler('passport', 'passport')).toBe(1);
    expect(jaroWinkler('paspot', 'passport')).toBeGreaterThan(0.85);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });

  it('headers in Malay, English, short forms and typos name the same field', () => {
    const f = (k: string) => FW.find((x) => x.key === k)!;
    for (const h of ['No. Pasport', 'Passport No', 'Paspot', 'No Passport']) expect(headerMatch(h, f('passportNo'))?.[0], h).toBeGreaterThan(0.7);
    for (const h of ['Tarikh Lahir', 'DOB', 'Date of Birth', 'Tkh Lahir']) expect(headerMatch(h, f('dob'))?.[0], h).toBeGreaterThan(0.7);
    for (const h of ['Nama', 'Name', 'Worker Name']) expect(headerMatch(h, f('name'))?.[0], h).toBeGreaterThan(0.7);
    for (const h of ['Warganegara', 'Nationality']) expect(headerMatch(h, f('nationality'))?.[0], h).toBeGreaterThan(0.7);
    for (const h of ['Tamat PLKS', 'Permit expiry']) expect(headerMatch(h, f('permitExpiresOn'))?.[0], h).toBeGreaterThan(0.7);
    // A passport expiry is not a permit expiry.
    expect(headerMatch('Tamat PLKS', f('permitExpiresOn'))![0]).toBeGreaterThan(headerMatch('Tamat PLKS', f('passportExpiresOn'))?.[0] ?? 0);
  });
});

describe('values', () => {
  it('profiles a column: dates and their order, ICs, passports, phones, uniqueness', () => {
    expect(dateOrderOf(['03/04/2027', '12/25/2027']).order).toBe('mdy');
    expect(dateOrderOf(['25/12/2027', '03/04/2027'])).toEqual({ order: 'dmy', guessed: false });
    expect(dateOrderOf(['03/04/2027', '01/02/2027'])).toEqual({ order: 'dmy', guessed: true });
    expect(isoDateOf('03/04/2027', 'mdy')).toBe('2027-03-04');
    expect(isoDateOf('03/04/2027', 'dmy')).toBe('2027-04-03');
    expect(isoDateOf('46447')).toBe('2027-03-01');
    expect(isoDateOf('31/02/2027')).toBeNull();
    expect(profileColumn(0, 'x', ['900101-01-1234', '880202025678', '']).main).toBe('ic');
    expect(profileColumn(0, 'x', ['PA1234567', 'B7654321', 'PA7777777']).main).toBe('passport');
    expect(profileColumn(0, 'x', ['012-345 6789', '+60123456789', '0198765432']).main).toBe('phone');
    const p = profileColumn(0, 'x', ['01/02/1990', '15/06/1985', '30/11/1979']);
    expect(p.main).toBe('date');
    expect(p.medianYear).toBe(1985);
    expect(p.unique).toBe(1);
  });

  it('normalises cells: dates to ISO in the column order, ICs with dashes, countries to codes', () => {
    expect(normIc('900101011234')).toBe('900101-01-1234');
    expect(normIc('A1234567')).toBe('A1234567');
    const table = [
      ['Lahir', 'IC', 'Negara'],
      ['12/25/1990', '900101011234', 'Nepal'],
    ];
    const fields: AlignField[] = [
      { key: 'dob', label: 'Date of birth', type: 'date' },
      { key: 'idFull', label: 'IC', type: 'text' },
      { key: 'nationality', label: 'Nationality', type: 'text' },
    ];
    const m = smartMatch(table, fields);
    expect(normaliseTable(table, 0, m.columns, fields)[1]).toEqual(['1990-12-25', '900101-01-1234', 'NP']);
  });

  it('a value shape keeps nothing of the value', () => {
    expect(valueShape('PA1234567')).toBe('AA9999999');
    expect(valueShape('01/03/2027')).toBe('99/99/9999');
    expect(valueShape('Ram Bahadur')).toBe('Aa Aa');
    expect(valueShape('someone@example.com')).toBe('a@a.a');
  });
});

describe('sheets', () => {
  it('reads a group title over the header, and leaves totals and signature lines out', () => {
    const rows = [
      ['SENARAI PEKERJA ASING 2026'],
      ['', '', 'Pasport', '', 'PLKS', ''],
      ['Bil', 'Nama', 'No.', 'Tamat', 'No.', 'Tamat'],
      ['1', 'Ram Synthetic', 'PA1234567', '01/03/2030', 'PLKS100001', '15/04/2027'],
      ['2', 'Hari Testlama', 'PA7654321', '02/04/2031', 'PLKS100002', '16/05/2027'],
      ['Jumlah', '2'],
      ['Disediakan oleh:', 'Pegawai FWM'],
    ];
    expect(composeHeader(rows, 2)).toEqual(['Bil', 'Nama', 'Pasport No.', 'Pasport Tamat', 'PLKS No.', 'PLKS Tamat']);
    expect(isTotalsRow(['Jumlah', '2'])).toBe(true);
    expect(isTotalsRow(['Ram Synthetic', 'Total Security'])).toBe(false);
    const prep = prepareSheet(rows, FW);
    expect(prep.droppedRows).toEqual([6, 7]);
    const m = smartMatch(prep.table, FW, { headerRow: prep.headerRow });
    const by = Object.fromEntries(m.columns.map((c) => [c.header, c.field]));
    expect(by).toEqual({ Bil: null, Nama: 'name', 'Pasport No.': 'passportNo', 'Pasport Tamat': 'passportExpiresOn', 'PLKS No.': 'permitNo', 'PLKS Tamat': 'permitExpiresOn' });
  });

  it('splits "Name (Passport)" into two columns', () => {
    const prep = prepareSheet(
      [
        ['Nama (Passport)', 'Tarikh Lahir'],
        ['Ram Synthetic (PA1234567)', '01/01/1990'],
        ['Hari Testlama (PB7654321)', '02/02/1991'],
      ],
      FW,
    );
    expect(prep.splits).toEqual([['Nama', 'Passport']]);
    expect(prep.table[1]).toEqual(['Ram Synthetic', '01/01/1990', 'PA1234567']);
    const m = smartMatch(prep.table, FW, { headerRow: 0 });
    expect(m.columns.map((c) => c.field)).toEqual(['name', 'dob', 'passportNo']);
  });

  it('picks the sheet that holds the records', () => {
    const notes = { name: 'Nota', rows: [['Catatan'], ['Senarai ini untuk FWM sahaja']] };
    const summary = { name: 'Ringkasan', rows: [['Cawangan', 'Bilangan'], ['KL', '40']] };
    const list = { name: 'Pekerja', rows: fwSheet(7).table };
    expect(pickSheet([notes, summary, list], FW)).toBe(2);
  });

  it('remembers a layout by its header signature', () => {
    expect(headerSignature(['No. Pasport', 'Nama'])).toBe(headerSignature(['no pasport', 'NAMA']));
    expect(headerSignature(['Nama', 'No. Pasport'])).not.toBe(headerSignature(['No. Pasport', 'Nama']));
    const m = smartMatch(
      [
        ['Kod X', 'Kod Y'],
        ['NP-001', 'Ram Synthetic'],
      ],
      FW,
      { remembered: { 'kod x': 'staffNo', 'kod y': 'name' } },
    );
    expect(m.columns.map((c) => [c.field, c.how, c.level])).toEqual([
      ['staffNo', 'remembered', 'sure'],
      ['name', 'remembered', 'sure'],
    ]);
  });
});

describe('matching whole sheets', { timeout: 30000 }, () => {
  it('maps 60 synthetic foreign-worker layouts (headers in Malay or English, any order, any date format)', () => {
    let right = 0;
    let total = 0;
    const wrong: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const { table, truth, style } = fwSheet(seed);
      const m = smartMatch(table, FW);
      expect(m.headerRow).toBe(0);
      for (const c of m.columns) {
        total++;
        if (c.field === truth[c.header]) right++;
        else wrong.push(`#${seed} ${style} "${c.header}" -> ${c.field} (want ${truth[c.header]})`);
      }
      // Dates come out in the right order whatever the file used.
      const dob = m.columns.find((c) => c.field === 'dob')!;
      if (style === 'mdy') expect(dob.profile.dateOrder).toBe('mdy');
    }
    // Aim: at least 97% of the columns of every layout land on the right field.
    console.log(`P90 matcher: ${right}/${total} columns right over 60 layouts (${((100 * right) / total).toFixed(1)}%)`);
    expect(right / total, wrong.slice(0, 10).join('\n')).toBeGreaterThanOrEqual(0.97);
  });

  it('other records: IT equipment, suppliers and branches from old lists', () => {
    const it = smartMatch(
      [
        ['INVENTORI ICT 2025'],
        ['No', 'No. Aset', 'No. Siri', 'Jenis Peranti', 'Jenama/Model', 'Lokasi', 'Jabatan', 'Tarikh Beli', 'Waranti Hingga'],
        ['1', 'ICT-0001', 'SN5CG1234XYZ', 'Laptop', 'Synthetic Book 14', 'Tingkat 3', 'Kewangan', '15/03/2023', '14/03/2026'],
        ['2', 'ICT-0002', 'SN5CG5678ABC', 'Printer', 'Synthetic Jet 200', 'Bilik Server', 'IT', '02/11/2022', '01/11/2025'],
      ],
      EXTRA_IMPORTS.itAsset.fields as AlignField[],
    );
    expect(it.headerRow).toBe(1);
    expect(it.columns.map((c) => c.field)).toEqual([null, 'tag', 'serial', 'kind', 'model', 'location', 'unitLabel', 'boughtOn', 'warrantyTo']);
    const sup = smartMatch(
      [
        ['Vendor Name', 'ROC No', 'Bank', 'Acc No', 'Supplies', 'COI'],
        ['Synthetic Supplies Sdn Bhd', '202001012345', 'Synthetic Bank', '1234567890', 'Uniform, Cleaning', 'Yes'],
        ['Mock Trading', '201901054321', 'Sample Bank', '9876543210', 'IT', 'No'],
      ],
      EXTRA_IMPORTS.purSupplier.fields as AlignField[],
    );
    expect(sup.columns.map((c) => c.field)).toEqual(['name', 'ssmNo', 'bankName', 'bankAccount', 'categories', 'coiDeclared']);
    const br = smartMatch(
      [
        ['Nama Cawangan', 'Negeri', 'Model'],
        ['Synthetic Branch North', 'Kedah', 'B'],
      ],
      EXTRA_IMPORTS.branch.fields as AlignField[],
    );
    expect(br.columns.map((c) => c.field)).toEqual(['name', 'state', 'model']);
  });

  it('no column names at all: the distinctive values still place themselves, flagged for checking', () => {
    const m = smartMatch(
      [
        ['Col A', 'Col B', 'Col C', 'Col D'],
        ['Aina Synthetic', 'aina@example.com', '900101-01-1234', '012-345 6789'],
        ['Badrul Synthetic', 'badrul@example.com', '880202-02-5678', '019-876 5432'],
        ['Chandra Synthetic', 'chandra@example.com', '870303-03-9012', '011-2345 6789'],
      ],
      STAFF,
    );
    expect(m.columns.map((c) => c.field)).toEqual([null, 'email', 'idFull', 'phone']);
    expect(m.columns.slice(1).every((c) => c.how === 'values' && c.level !== 'sure')).toBe(true);
  });

  it('a date of birth and an expiry with unhelpful names are told apart by their years', () => {
    const m = smartMatch(
      [
        ['Staff No', 'Nama', 'Tarikh 1', 'Tarikh 2'],
        ['NP-1', 'Ram Synthetic', '12/03/1988', '15/09/2028'],
        ['NP-2', 'Hari Testlama', '23/07/1992', '01/02/2029'],
        ['NP-3', 'Suman Mockrai', '05/11/1985', '30/06/2028'],
      ],
      FW.filter((f) => ['staffNo', 'name', 'dob', 'passportExpiresOn'].includes(f.key)),
    );
    expect(m.columns.map((c) => c.field)).toEqual(['staffNo', 'name', 'dob', 'passportExpiresOn']);
  });

  it('day and month that cannot be told apart are read day first and flagged', () => {
    const m = smartMatch(
      [
        ['Name', 'Date of Birth'],
        ['Ram Synthetic', '01/02/1990'],
        ['Hari Testlama', '03/04/1991'],
      ],
      FW,
    );
    const dob = m.columns[1];
    expect(dob.field).toBe('dob');
    expect(dob.profile.dateOrderGuessed).toBe(true);
    expect(dob.level).not.toBe('sure');
    expect(dob.why).toMatch(/day first/);
  });

  it('runs fast: a 500-row, 20-column sheet in well under a second', () => {
    const { table } = fwSheet(3);
    const big = [table[0].concat(Array.from({ length: 20 - table[0].length }, (_, i) => `Extra ${i}`)), ...Array.from({ length: 500 }, (_, i) => table[1 + (i % 25)].concat(Array.from({ length: 20 - table[0].length }, () => 'x')))];
    const t = performance.now();
    smartMatch(big, FW);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it('the Hungarian method finds the best whole assignment, not the greedy one', () => {
    // Greedy takes 0.9 (row 0 -> col 0) and is left with 0.1; the best is 0.8 + 0.8.
    expect(bestAssignment([
      [0.9, 0.8],
      [0.8, 0.1],
    ])).toEqual([1, 0]);
    expect(bestAssignment([[0.5, 0.6, 0.1]])).toEqual([1]);
    expect(bestAssignment([[0.3], [0.9]])).toEqual([-1, 0]);
  });
});

describe('AI helper, minimised', () => {
  it('sends only column names and value shapes, and keeps only valid answers', () => {
    const brief = importAiBrief('Foreign worker', [{ index: 3, header: 'Kolum Z', sample: ['PA1234567', 'Ram Synthetic'] }], [{ key: 'passportNo', label: 'Passport number', type: 'text' }]);
    expect(brief).toContain('AA9999999');
    expect(brief).not.toContain('PA1234567');
    expect(brief).not.toContain('Ram');
    expect(parseImportAiAnswer('Sure: {"matches":[{"i":3,"key":"passportNo"},{"i":3,"key":"name"},{"i":9,"key":"dob"},{"i":4,"key":"__company"}]}', [3, 4], ['passportNo', 'name'])).toEqual([{ index: 3, field: 'passportNo' }]);
    expect(parseImportAiAnswer('no json here', [1], ['x'])).toEqual([]);
  });
});
