// P128: contribution files from an uploaded salary sheet (Fitri, 24 Nov 2026). Synthetic people and numbers only; the
// rate rows are PERKESO's published schedule (public figures), never a real staff file.
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  GROUP_EMPLOYER_ID,
  MemoryStore,
  PrimaService,
  ageFromIc,
  cleanName,
  contribCheckCsv,
  contribEpfCsv,
  contribPersonOf,
  contribRow,
  contribTotals,
  eisShare,
  employerCodeProblem,
  epfShare,
  generateDataset,
  guessWageTicks,
  icIn,
  lindungShare,
  myt,
  payGridFromPdf,
  payHeaderKey,
  payPeople,
  perkesoRows,
  perkesoShare,
  perkesoTextFile,
  perkesoTextFileName,
  perkesoXlsm,
  periodIn,
  readPaySheet,
  readXlsx,
  socsoShare,
  totalsCheck,
  trimContribRecords,
  wagesOf,
  type ContribFileRecord,
  type ContribRow,
  type ContribPerson,
  type PdfTextPiece,
} from '../src';

// PERKESO, "New contribution rate including SKBBK" (Appendix 1 of the text-file FAQ, June 2026), 64 bands and above
// RM6,000: First Category employer and employee (invalidity) shares; Second Category employer share; SKBBK.
const S1 = [[0.4,0.1],[0.7,0.2],[1.1,0.3],[1.5,0.4],[2.1,0.6],[2.95,0.85],[4.35,1.25],[6.15,1.75],[7.85,2.25],[9.65,2.75],[11.35,3.25],[13.15,3.75],[14.85,4.25],[16.65,4.75],[18.35,5.25],[20.15,5.75],[21.85,6.25],[23.65,6.75],[25.35,7.25],[27.15,7.75],[28.85,8.25],[30.65,8.75],[32.35,9.25],[34.15,9.75],[35.85,10.25],[37.65,10.75],[39.35,11.25],[41.15,11.75],[42.85,12.25],[44.65,12.75],[46.35,13.25],[48.15,13.75],[49.85,14.25],[51.65,14.75],[53.35,15.25],[55.15,15.75],[56.85,16.25],[58.65,16.75],[60.35,17.25],[62.15,17.75],[63.85,18.25],[65.65,18.75],[67.35,19.25],[69.15,19.75],[70.85,20.25],[72.65,20.75],[74.35,21.25],[76.15,21.75],[77.85,22.25],[79.65,22.75],[81.35,23.25],[83.15,23.75],[84.85,24.25],[86.65,24.75],[88.35,25.25],[90.15,25.75],[91.85,26.25],[93.65,26.75],[95.35,27.25],[97.15,27.75],[98.85,28.25],[100.65,28.75],[102.35,29.25],[104.15,29.75],[104.15,29.75]];
const S2 = [0.3,0.5,0.8,1.1,1.5,2.1,3.1,4.4,5.6,6.9,8.1,9.4,10.6,11.9,13.1,14.4,15.6,16.9,18.1,19.4,20.6,21.9,23.1,24.4,25.6,26.9,28.1,29.4,30.6,31.9,33.1,34.4,35.6,36.9,38.1,39.4,40.6,41.9,43.1,44.4,45.6,46.9,48.1,49.4,50.6,51.9,53.1,54.4,55.6,56.9,58.1,59.4,60.6,61.9,63.1,64.4,65.6,66.9,68.1,69.4,70.6,71.9,73.1,74.4,74.4];
const SK = [0.2,0.3,0.5,0.65,0.9,1.25,1.85,2.65,3.35,4.15,4.85,5.65,6.35,7.15,7.85,8.65,9.35,10.15,10.85,11.65,12.35,13.15,13.85,14.65,15.35,16.15,16.85,17.65,18.35,19.15,19.85,20.65,21.35,22.15,22.85,23.65,24.35,25.15,25.85,26.65,27.35,28.15,28.85,29.65,30.35,31.15,31.85,32.65,33.35,34.15,34.85,35.65,36.35,37.15,37.85,38.65,39.35,40.15,40.85,41.65,42.35,43.15,43.85,44.65,44.65];
// EIS (Act 800), each share, as PERKESO's Excel-to-text converter carries it.
const EIS = [0.05,0.1,0.15,0.2,0.25,0.35,0.5,0.7,0.9,1.1,1.3,1.5,1.7,1.9,2.1,2.3,2.5,2.7,2.9,3.1,3.3,3.5,3.7,3.9,4.1,4.3,4.5,4.7,4.9,5.1,5.3,5.5,5.7,5.9,6.1,6.3,6.5,6.7,6.9,7.1,7.3,7.5,7.7,7.9,8.1,8.3,8.5,8.7,8.9,9.1,9.3,9.5,9.7,9.9,10.1,10.3,10.5,10.7,10.9,11.1,11.3,11.5,11.7,11.9,11.9];
/** A wage inside each band (and one above the ceiling). */
const BAND_TOPS = [30, 50, 70, 100, 140, 200, 300, 400, ...Array.from({ length: 56 }, (_, i) => 500 + i * 100), 7000];
const wageIn = (i: number) => (i === 0 ? 12.34 : i === 64 ? 7000 : BAND_TOPS[i] - 3.21);

const PERIOD = '2026-11';
const person = (o: Partial<ContribPerson> = {}): ContribPerson => ({
  row: 2,
  name: 'ALI BIN ABU',
  id: '900101015555',
  nationality: 'MY',
  age: 36,
  ageFrom: 'ic',
  socsoWage: 3000,
  epfWage: 3000,
  skbbkOptOut: false,
  include: true,
  ...o,
});

describe('PERKESO shares by the published wage bands', () => {
  it('gives every row of the June 2026 schedule: First and Second Category, EIS and SKBBK', () => {
    for (let i = 0; i < 65; i++) {
      const w = wageIn(i);
      expect(perkesoShare(w, 0.0175, 0.005), `SOCSO 1 at ${w}`).toMatchObject({ er: S1[i][0], ee: S1[i][1] });
      expect(perkesoShare(w, 0.0125, 0), `SOCSO 2 at ${w}`).toMatchObject({ er: S2[i], ee: 0 });
      expect(perkesoShare(w, 0.002, 0.002), `EIS at ${w}`).toMatchObject({ er: EIS[i], ee: EIS[i] });
      expect(perkesoShare(w, 0, 0.0075), `SKBBK at ${w}`).toMatchObject({ er: 0, ee: SK[i] });
    }
    expect(perkesoRows(0.0175, 0.005)).toHaveLength(64);
    // A raised ceiling goes on in RM100 bands by the same method.
    expect(perkesoRows(0.0175, 0.005, 7000).at(-1)!.upTo).toBe(7000);
  });

  it('payroll shares follow the bands, not a straight percentage (P128 fix)', () => {
    // RM3,000 is the top of the RM2,900.01-3,000 band: 51.65 / 14.75, not 1.75% and 0.5% of 3,000 (52.50 / 15.00).
    expect(socsoShare(3000, 35)).toEqual({ er: 51.65, ee: 14.75 });
    expect(socsoShare(3149.58, 35)).toEqual({ er: 55.15, ee: 15.75 });
    expect(socsoShare(8000, 35)).toEqual({ er: 104.15, ee: 29.75 });
    expect(socsoShare(3000, 61)).toEqual({ er: 36.9, ee: 0 });
    expect(eisShare(3000, 35, 'MY')).toEqual({ er: 5.9, ee: 5.9 });
    expect(eisShare(85, 35, 'MY')).toEqual({ er: 0.2, ee: 0.2 });
    expect(eisShare(3000, 35, 'NP')).toEqual({ er: 0, ee: 0 });
    expect(lindungShare(3149.58, PERIOD, 'MY', false).ee).toBe(23.65);
    expect(lindungShare(20, PERIOD, 'NP', true).ee).toBe(0.2);
    // EPF Third Schedule: RM0.01 to RM10 pays nothing; Part F (non-citizens) 2% of the whole wage, up to the ringgit.
    expect(epfShare(8, 30, 'MY')).toEqual({ ee: 0, er: 0 });
    expect(epfShare(15, 30, 'MY')).toEqual({ ee: 3, er: 3 });
    expect(epfShare(1751, 30, 'NP')).toEqual({ ee: 36, er: 36 });
  });
});

describe('reading any salary sheet', () => {
  it('knows the headings in Malay and English, employer and employee sides, and SKBBK before SOCSO', () => {
    const k = (h: string) => payHeaderKey(h)?.key ?? null;
    expect(k('NAMA KAKITANGAN')).toBe('name');
    expect(k('NO. K/P')).toBe('id');
    expect(k('New IC Number')).toBe('id');
    expect(k('GAJI POKOK')).toBe('basic');
    expect(k('ELAUN PERJALANAN')).toBe('travel');
    expect(k('ELAUN TELEFON')).toBe('allowance');
    expect(k('YURAN PENGARAH / PENTADBIRAN')).toBe('directorFee');
    expect(k('JUMLAH KASAR')).toBe('gross');
    expect(k('KWSP (PEKERJA 11%)')).toBe('epfEe');
    expect(k('KWSP (MAJIKAN)')).toBe('epfEr');
    expect(k('EPF ER')).toBe('epfEr');
    expect(k('SOCSO BKN BENCANA KERJA (SKBBK)')).toBe('skbbk');
    expect(k('PERKESO (PEKERJA)')).toBe('socsoEe');
    expect(k('Socso Employer Share')).toBe('socsoEr');
    expect(k('SIP (MAJIKAN)')).toBe('eisEr');
    expect(k('EIS Employee Share')).toBe('eisEe');
    expect(k('OT')).toBe('ot');
    expect(k('BACK DATED')).toBe('arrears');
    expect(k('PCB (30%)')).toBe('pcb');
    expect(k('JUMLAH')).toBeNull();
  });

  it('reads values: IC anywhere in a cell, names without the K/P line, the month from a title', () => {
    expect(icIn('K/P: 900101-01-5555')).toBe('900101015555');
    expect(icIn('900101 01 5555')).toBe('900101015555');
    expect(icIn('901301015555')).toBeNull();
    expect(cleanName('3 ALI BIN ABU K/P: 900101-01-5555')).toBe('ALI BIN ABU');
    expect(cleanName('K/P: 900101-01-5555')).toBe('');
    expect(periodIn('BULAN: NOVEMBER 2026')).toBe('2026-11');
    expect(periodIn('GAJI STAFF OGOS 2026.pdf')).toBe('2026-08');
    expect(periodIn('Payroll 03/2027')).toBe('2027-03');
    expect(ageFromIc('660301085556', '2026-11')).toBe(60);
    expect(ageFromIc('050101015555', '2026-11')).toBe(21);
  });

  // A synthetic sheet laid out like a printed office payroll: a title, a two-row heading, each person over three lines
  // (name, then the figures with "K/P:", then the bank account), a totals line and a signature.
  const grid = [
    ['SYARIKAT CONTOH SDN BHD'],
    ['BULAN: NOVEMBER 2026'],
    ['BIL', 'NAMA KAKITANGAN', 'GAJI POKOK', 'ELAUN PERJALANAN', 'ELAUN SYIF', 'JUMLAH KASAR', 'KWSP', 'SOCSO', 'SOCSO BKN BENCANA KERJA', 'SIP', 'POTONGAN', '', ''],
    ['', '', '', '', '', '', '(PEKERJA)', '(PEKERJA)', '(SKBBK)', '(PEKERJA)', 'KWSP (MAJIKAN)', 'SOCSO (MAJIKAN)', 'SIP (MAJIKAN)'],
    ['', 'ALI BIN ABU', '', '', '', '', '', '', '', '', '', '', ''],
    ['1', 'K/P: 900101-01-5555', '3,000.00', '200.00', '100.00', '3,300.00', '341.00', '16.25', '24.85', '6.50', '403.00', '56.85', '6.50'],
    ['', '1234 5678 9012 (MBB)', '', '', '', '', '', '', '', '', '', '', ''],
    ['2', 'SITI BINTI DOLAH', '2,000.00', '-', '-', '2,000.00', '220.00', '9.75', '', '3.90', '260.00', '34.15', '3.90'],
    ['', 'K/P: 660301-08-5556', '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'JUMLAH', '5,000.00', '200.00', '100.00', '5,300.00', '561.00', '26.00', '24.85', '10.40', '663.00', '91.00', '10.40'],
    ['', 'Disediakan oleh,', '', '', '', '', '', '', '', '', '', '', ''],
  ];

  it('finds the two-row heading, joins each person, keeps the totals and the file figures', () => {
    const sheet = readPaySheet(grid);
    expect(sheet.headerRows).toBe(2);
    expect(sheet.titles).toEqual(['SYARIKAT CONTOH SDN BHD', 'BULAN: NOVEMBER 2026']);
    expect(sheet.columns.map((c) => c.key)).toEqual(['bil', 'name', 'basic', 'travel', 'allowance', 'gross', 'epfEe', 'socsoEe', 'skbbk', 'eisEe', 'epfEr', 'socsoEr', 'eisEr']);
    const read = payPeople(sheet, PERIOD);
    expect(read.people.map((p) => [p.name, p.id, p.age])).toEqual([
      ['ALI BIN ABU', '900101015555', 36],
      ['SITI BINTI DOLAH', '660301085556', 60],
    ]);
    // The law's wages: travel allowance is not wages for EPF or SOCSO; the shift allowance is.
    expect(read.people.map((p) => [p.socsoWage, p.epfWage])).toEqual([
      [3100, 3100],
      [2000, 2000],
    ]);
    // An SKBBK column that is blank for a Malaysian: taken as opted out.
    expect(read.people.map((p) => p.skbbkOptOut)).toEqual([false, true]);
    expect(read.totals.gross).toBe(5300);
    expect(totalsCheck(read.people, read.totals)).toEqual([]);
  });

  it('finds the file’s own way of counting wages, and the law stays the default', () => {
    const sheet = readPaySheet(grid);
    const read = payPeople(sheet, PERIOD);
    const guess = guessWageTicks(read, sheet.columns, PERIOD);
    const socso = guess.find((g) => g.scheme === 'socso')!;
    // This file counted SOCSO on gross pay, travel allowance included.
    expect(socso.ticked.map((i) => sheet.columns[i].key).sort()).toEqual(['allowance', 'basic', 'travel']);
    expect(socso.matches).toBeGreaterThan(socso.lawMatches);
    const cols = sheet.columns.map((c) => (c.key === 'travel' ? { ...c, socso: true } : c));
    expect(wagesOf(read.cells[0], cols, 'socso')).toBe(3300);
    expect(wagesOf(read.cells[0], cols, 'epf')).toBe(3100);
  });

  it('reads a PDF printed from Excel by where its text sits: wrapped headings, dashes, a name line above', () => {
    const P = (x: number, y: number, text: string, w = text.length * 1.9): PdfTextPiece => ({ x, y, right: x + w, size: 3.5, text, page: 0 });
    const pieces: PdfTextPiece[] = [
      P(18, 530, 'BULAN: NOVEMBER 2026'),
      // Heading band, wrapped over lines; neighbouring headings touch.
      P(20, 500, 'BIL'),
      P(40, 500, 'NAMA KAKITANGAN'),
      P(105, 501, 'GAJI'),
      P(105, 497, 'POKOK'),
      P(140, 501, 'KWSP'),
      P(138, 497, '(PEKERJA)'),
      P(175, 503, 'SOCSO BKN'),
      P(175, 499, 'BENCANA KERJA'),
      P(175, 495, '(SKBBK)'),
      P(212, 501, 'SOCSO'),
      P(210, 497, '(MAJIKAN)'),
      // Person 1: the name above the figures, "K/P:" with them; a nil as "-" drawn left of where the figures end.
      P(40, 480, 'ALI BIN ABU'),
      P(21, 476, '1', 2),
      P(40, 476, 'K/P: 900101-01-5555'),
      P(110, 476, '3,000.00', 14),
      P(142, 476, '330.00', 12),
      P(185, 476, '22.85', 10),
      P(212, 476, '51.65', 10),
      // Person 2: the name with the figures, "K/P:" under them, no SKBBK.
      P(21, 460, '2', 2),
      P(40, 460, 'SITI BINTI DOLAH'),
      P(110, 460, '2,000.00', 14),
      P(146, 460, '-', 1),
      P(212, 460, '34.15', 10),
      P(40, 456, 'K/P: 660301-08-5556'),
    ];
    const grid2 = payGridFromPdf(pieces);
    const sheet = readPaySheet(grid2);
    expect(sheet.columns.map((c) => [c.header, c.key])).toEqual([
      ['BIL', 'bil'],
      ['NAMA KAKITANGAN', 'name'],
      ['GAJI POKOK', 'basic'],
      ['KWSP (PEKERJA)', 'epfEe'],
      ['SOCSO BKN BENCANA KERJA (SKBBK)', 'skbbk'],
      ['SOCSO (MAJIKAN)', 'socsoEr'],
    ]);
    expect(periodIn(sheet.titles.join(' '))).toBe(PERIOD);
    const read = payPeople(sheet, PERIOD);
    expect(read.people.map((p) => [p.name, p.id, p.socsoWage, p.file?.epfEe, p.file?.skbbk])).toEqual([
      ['ALI BIN ABU', '900101015555', 3000, 330, 22.85],
      ['SITI BINTI DOLAH', '660301085556', 2000, 0, 0],
    ]);
  });
});

describe('counting a person', () => {
  it('applies the category, EIS, SKBBK and EPF rules and says why', () => {
    const a = contribRow(person(), PERIOD);
    expect([a.socsoEr, a.socsoEe, a.eisEr, a.eisEe, a.skbbk, a.epfEr, a.epfEe]).toEqual([51.65, 14.75, 5.9, 5.9, 22.15, 390, 330]);
    expect(a.category).toBe(1);
    expect(a.inPerkeso).toBe(true);
    const old = contribRow(person({ age: 61, id: '650301085556' }), PERIOD);
    expect([old.category, old.socsoEr, old.socsoEe, old.eisEr, old.skbbk, old.epfEr, old.epfEe]).toEqual([2, 36.9, 0, 0, 22.15, 120, 0]);
    expect(old.rules).toContain('No EIS: 60 and over');
    const fw = contribRow(person({ nationality: 'FOREIGN', id: 'SSFW00012345', age: null, ageFrom: 'none', socsoWage: 1751, epfWage: 1751 }), PERIOD);
    expect([fw.eisEr, fw.eisEe, fw.epfEr, fw.epfEe]).toEqual([0, 0, 36, 36]);
    expect(fw.skbbk).toBe(13.15);
    expect(fw.rules).toEqual(expect.arrayContaining(['No EIS: foreign worker', 'Age not known: under 60 taken']));
    const out = contribRow(person({ skbbkOptOut: true }), PERIOD);
    expect(out.skbbk).toBe(0);
    expect(contribRow(person({ age: 17 }), PERIOD).eisEe).toBe(0);
    // Before June 2026 there was no SKBBK.
    expect(contribRow(person(), '2026-05').skbbk).toBe(0);
    const noId = contribRow(person({ id: '' }), PERIOD);
    expect(noId.inPerkeso).toBe(false);
    expect(noId.problems).toContain('No IC or SOCSO number');
    const diff = contribRow(person({ file: { socsoEe: 15, epfEe: 330 } }), PERIOD);
    expect(diff.diffs).toEqual([{ key: 'socsoEe', file: 15, prima: 14.75 }]);
    expect(contribTotals([a, old, fw, noId])).toMatchObject({ people: 4, inPerkeso: 3, problems: 1 });
  });

  it('checks every field the device sends', () => {
    expect(() => contribPersonOf({ socsoWage: -1, epfWage: 0 }, 0)).toThrow(/Person 1: the wages/);
    expect(() => contribPersonOf({ socsoWage: 1, epfWage: 1, age: 3.5 }, 4)).toThrow(/Person 5: the age/);
    const p = contribPersonOf({ name: ' ALI\u0007 BIN ABU ', id: '900101-01-5555', socsoWage: 3000, epfWage: 2000, age: 36, nationality: 'X', skbbkOptOut: true, file: { socsoEe: 15, bad: 3 } }, 0);
    expect(p).toMatchObject({ name: 'ALI BIN ABU', id: '900101015555', nationality: 'MY', skbbkOptOut: true, include: true, file: { socsoEe: 15 } });
    expect(contribPersonOf({ socsoWage: 1, epfWage: 1, nationality: 'FOREIGN', skbbkOptOut: true }, 0).skbbkOptOut).toBe(false);
  });
});

describe('the files PERKESO takes', () => {
  const rows = [
    contribRow(person({ socsoWage: 3149.58, epfWage: 3000 }), PERIOD),
    contribRow(person({ name: 'SITI BINTI DOLAH', id: '650301085556', age: 61, socsoWage: 7000, epfWage: 7000 }), PERIOD),
    contribRow(person({ name: 'RAM BAHADUR', id: 'SSFW00012345', nationality: 'FOREIGN', age: null, ageFrom: 'none', socsoWage: 1800, epfWage: 1800 }), PERIOD),
    contribRow(person({ name: 'LEFT OUT', include: false }), PERIOD),
  ];

  it('writes the combined SOCSO + EIS text file, format v2.1: 278 characters a line, every field in its place', () => {
    expect(employerCodeProblem('')).toMatch(/Give the PERKESO employer code/);
    expect(employerCodeProblem('E1234-678901')).toMatch(/12 letters and digits/);
    expect(employerCodeProblem('E12345678901')).toBeNull();
    const text = perkesoTextFile(rows, { employerCode: 'e12345678901', mycoid: '201901000001', period: PERIOD });
    expect(text.endsWith('\r\n')).toBe(true);
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).toHaveLength(278);
    const f = (l: string, from: number, to: number) => l.slice(from - 1, to);
    const [a, b, c] = lines;
    expect(f(a, 1, 12)).toBe('E12345678901');
    expect(f(a, 13, 32)).toBe('201901000001'.padEnd(20));
    expect(f(a, 33, 44)).toBe('900101015555');
    expect(f(a, 45, 194)).toBe('ALI BIN ABU'.padEnd(150));
    expect(f(a, 195, 200)).toBe('112026');
    expect(f(a, 201, 214)).toBe('        314958');
    // Shares in sen, right-justified, at least four digits (as the converter's macro writes them).
    expect([f(a, 215, 220), f(a, 221, 226), f(a, 227, 232), f(a, 233, 238), f(a, 239, 244)]).toEqual([' 5515'.padStart(6), '  1575', '  0630', '  0630', '  2365']);
    expect(f(a, 245, 278)).toBe(' '.repeat(34));
    // 61: Second Category, no EIS; above the ceiling the last band; the wage itself as paid.
    expect([f(b, 201, 214).trim(), f(b, 215, 220), f(b, 221, 226), f(b, 227, 232), f(b, 239, 244)]).toEqual(['700000', '  7440', '  0000', '  0000', '  4465']);
    expect(f(c, 33, 44)).toBe('SSFW00012345');
    expect(perkesoTextFileName('E12345678901', new Date(2026, 10, 24, 9, 5, 7))).toBe('E12345678901-241126-090507.txt');
  });

  it('writes the converter workbook: the same sheets, table, formulas, macro and button, no data but ours', async () => {
    const bytes = perkesoXlsm(rows, { employerCode: 'E12345678901', period: PERIOD });
    const parts = unzipNames(bytes);
    for (const n of ['xl/vbaProject.bin', 'xl/tables/table1.xml', 'xl/drawings/drawing1.xml', 'xl/ctrlProps/ctrlProp1.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/worksheets/sheet2.xml'])
      expect(parts.has(n), n).toBe(true);
    expect(parts.get('[Content_Types].xml')).toContain('application/vnd.ms-excel.sheet.macroEnabled.main+xml');
    expect(parts.get('xl/workbook.xml')).toContain('<sheet name="Difference Contribution" sheetId="1" r:id="rId1"/><sheet name="Sheet1" sheetId="2" state="hidden" r:id="rId2"/>');
    expect(parts.get('xl/tables/table1.xml')).toContain('name="data" displayName="data" ref="B5:L8"');
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('macro="[0]!saveText2"');
    expect(parts.get('docProps/core.xml')).toContain('<dc:creator>Prima</dc:creator>');
    const sheets = await readXlsx(bytes, async (b) => new Uint8Array(inflateRawSync(b)));
    expect(sheets.map((s) => s.name)).toEqual(['Difference Contribution', 'Sheet1']);
    const main = sheets[0].rows;
    expect(main[0][1]).toBe('Convert Excel To Text File');
    expect(main[2].slice(1, 3)).toEqual(['Employee Code :', 'E12345678901']);
    expect(main[4].slice(1, 12)).toEqual(['New IC Number', 'Name', 'Month', 'Year (YYYY)', 'Salary', 'Socso Employer Share', 'Socso Employee Share', 'EIS Employer Share', 'EIS Employee Share', 'SKBBK', 'AGE']);
    expect(main[5].slice(1, 12)).toEqual(['900101015555', 'ALI BIN ABU', '11', '2026', '3149.58', '55.15', '15.75', '6.3', '6.3', '23.65', '36']);
    expect(main[7].slice(1, 12)).toEqual(['SSFW00012345', 'RAM BAHADUR', '11', '2026', '1800', '30.65', '8.75', '0', '0', '13.15', '0']);
    // The Malaysian with an IC keeps the converter's formulas; the foreign worker's row holds Prima's figures.
    const xml = parts.get('xl/worksheets/sheet1.xml')!;
    expect(xml).toMatch(/<c r="G6" s="23"><f>IF\(data\[\[#This Row\],\[AGE\]\]&lt;60/);
    expect(xml).toContain('<c r="I8" s="23"><v>0</v></c>');
    // The hidden rate sheet is Prima's own table, the same as PERKESO's published rows.
    const rate = sheets[1].rows;
    expect(rate[0]).toEqual(['Salary', 'Socso Employer Share (J1)', 'Socso Employee Share (J1)', 'EIS Employer Share (J1)', 'EIS Employee Share (J1)', 'Socso Employer Share (J2)', 'Socso Employee Share (J2)', 'SKBBK']);
    expect(rate).toHaveLength(66);
    rate.slice(1).forEach((r, i) => expect(r.map(Number), `rate row ${i + 1}`).toEqual([i === 0 ? 0 : i === 64 ? 6000.01 : BAND_TOPS[i - 1] + 0.01, S1[i][0], S1[i][1], EIS[i], EIS[i], S2[i], 0, SK[i]]));
  });

  it('writes the check sheet and the EPF list', () => {
    const check = contribCheckCsv(rows, PERIOD).split('\r\n');
    expect(check[0]).toContain('Wages for SOCSO, EIS, SKBBK');
    expect(check.find((l) => l.includes('TOTAL'))).toContain('3');
    const epf = contribEpfCsv(rows, PERIOD).split('\r\n');
    expect(epf[0]).toBe('﻿No. KP / Passport,Nama,Upah (RM),Caruman Majikan (RM),Caruman Pekerja (RM),Jumlah (RM),Bulan caruman');
    expect(epf[1]).toBe('900101015555,ALI BIN ABU,3000.00,390.00,330.00,720.00,2026-11');
    expect(epf).toHaveLength(6);
  });
});

/** Names and text of the parts in a stored ZIP. */
function unzipNames(bytes: Uint8Array): Map<string, string> {
  const b = Buffer.from(bytes);
  const out = new Map<string, string>();
  let i = 0;
  while (b.readUInt32LE(i) === 0x04034b50) {
    const method = b.readUInt16LE(i + 8);
    const size = b.readUInt32LE(i + 18);
    const nameLen = b.readUInt16LE(i + 26);
    const extra = b.readUInt16LE(i + 28);
    const name = b.subarray(i + 30, i + 30 + nameLen).toString();
    const data = b.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString('latin1'));
    i += 30 + nameLen + extra + size;
  }
  return out;
}

describe('the record kept with the employer', () => {
  const TODAY = '2026-11-24';
  const NOW = myt(TODAY, '10:00');
  const fresh = () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
  };
  const body = (o: Record<string, unknown> = {}) => ({
    companyId: GROUP_EMPLOYER_ID,
    period: PERIOD,
    fileName: 'Gaji November.xlsx',
    employerCode: 'E12345678901',
    mycoid: '',
    // The device's own figures are never kept: the server counts again.
    rows: [{ ...person(), socsoEr: 999 }, person({ name: 'SITI', id: '650301085556', age: 61 })],
    ...o,
  });

  it('is made by HR, the Chief of Staff, the COO or Finance; the server counts it again and audits each download', async () => {
    const { svc, ds } = fresh();
    const [hr, fin, guard] = await Promise.all(['u-pwvsb-hr', 'u-fin-t1-lead', 'u-guard-sasa-1'].map((id) => svc.user(id)));
    await expect(svc.contributionFiles(guard)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveContributionFile(guard, body())).rejects.toBeInstanceOf(AccessDenied);
    const board = await svc.contributionFiles(hr);
    expect(board.employers.map((e) => e.companyId)).toContain(GROUP_EMPLOYER_ID);
    await expect(svc.saveContributionFile(hr, body({ period: '2027-05' }))).rejects.toThrow(/later than next month/);
    await expect(svc.saveContributionFile(hr, body({ employerCode: 'E-1' }))).rejects.toThrow(/12 letters and digits/);
    await expect(svc.saveContributionFile(hr, body({ companyId: 'nope' }))).rejects.toThrow();
    const rec = await svc.saveContributionFile(hr, body());
    expect(rec.rows![0].socsoEr).toBe(51.65);
    expect(rec.rows![1]).toMatchObject({ category: 2, socsoEe: 0, eisEr: 0 });
    expect(rec.status).toBe('checked');
    const listed = await svc.contributionFiles(fin);
    expect(listed.records[0]).toMatchObject({ id: rec.id, rowsKept: true, status: 'checked' });
    expect('rows' in listed.records[0]).toBe(false);
    expect((await svc.contributionFile(fin, GROUP_EMPLOYER_ID, rec.id)).rows).toHaveLength(2);
    await expect(svc.contributionFileDownloaded(hr, GROUP_EMPLOYER_ID, rec.id, 'zip')).rejects.toThrow(/which file/);
    expect(await svc.contributionFileDownloaded(fin, GROUP_EMPLOYER_ID, rec.id, 'perkeso_txt')).toEqual({ status: 'downloaded', downloads: 1 });
    expect(ds.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['payroll.contrib_file.checked', 'payroll.contrib_file.download']));
    // The audit line says what left Prima, never a person's pay.
    expect(ds.audit.at(-1)!.summary).toBe('PERKESO text file downloaded for 2026-11 (2 people, from "Gaji November.xlsx").');
    // Without the employer code, the PERKESO files are refused (the check sheet is still fine).
    const noCode = await svc.saveContributionFile(hr, body({ employerCode: '' }));
    await expect(svc.contributionFileDownloaded(hr, GROUP_EMPLOYER_ID, noCode.id, 'perkeso_txt')).rejects.toThrow(/employer code/);
    await svc.contributionFileDownloaded(hr, GROUP_EMPLOYER_ID, noCode.id, 'check_csv');
  });

  it('keeps the newest records and lets the oldest give up their people rows first', () => {
    const one = contribRow(person(), PERIOD);
    const rec = (i: number, n: number): ContribFileRecord => ({
      id: `r${i}`,
      companyId: 'c',
      period: PERIOD,
      fileName: 'f',
      employerCode: '',
      mycoid: '',
      by: 'x',
      byId: 'x',
      at: `2026-11-${String(i).padStart(2, '0')}T00:00:00+08:00`,
      totals: contribTotals([]),
      status: 'checked',
      downloads: [],
      rows: new Array<ContribRow>(n).fill(one),
    });
    const kept = trimContribRecords([rec(1, 5000), rec(2, 2000), rec(3, 2000)]);
    expect(kept.map((r) => [r.id, r.rows?.length ?? null])).toEqual([
      ['r3', 2000],
      ['r2', 2000],
      ['r1', null],
    ]);
  });
});
