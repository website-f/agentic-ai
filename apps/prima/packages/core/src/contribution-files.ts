// P128 (Fitri, 24 Nov 2026: "in staff payroll ... HR/admins can upload old / their own formatted data ... our system
// automatically calculates all SOCSO and EPF deductions based on the Prima formula ... the final result must be like
// [PERKESO's SOCSO + SKBBK + SIP converter] where all calculated things in the template are ready to be submitted").
//
// Contribution files: any salary sheet in (Excel, CSV, Word table, PDF printed from Excel, pasted text) and out comes
// what the employer submits to PERKESO, worked with Prima's own statutory engine (payroll.ts, by the published wage
// bands), and an EPF check list:
//   1. Read: find the heading row (one or two rows, English or Malay: GAJI POKOK, ELAUN, KWSP, PERKESO, SIP, NO. K/P),
//      give each column a meaning (editable on the screen), and join a person's lines into one record (a printed sheet
//      puts the name, the "K/P:" line and the bank account on separate lines).
//   2. Count: SOCSO (Act 4, First or Second Category by age), EIS (Act 800), SKBBK / LINDUNG 24 Jam and EPF (Third
//      Schedule) for each person, with the wage used and the rule applied; the file's own figures are compared.
//   3. Write: PERKESO's combined text file for ASSIST (format v2.1, 13 Feb 2026: 278 characters a line) exactly as the
//      converter's macro writes it, the converter workbook itself (.xlsm, same sheets, table, formulas and macro) filled
//      in, and a check sheet with EPF.
// Everything here is plain functions: the screen runs them on the person's device and the server runs the counting
// again before it keeps a record (no figure from the device is trusted).

import { zipFiles } from './am-bq-xlsx';
import { CTRL_PROP_XML, DRAWING_XML, STYLES_XML, THEME_XML, VBA_PROJECT_B64, VML_XML } from './contribution-xlsm-parts';
import { guardPayNumber } from './guard-pay-import';
import { normHeader } from './import-align';
import { isTotalsRow } from './import-match';
import { eisShare, epfShare, lindungShare, socsoShare } from './payroll';
import type { PdfTextPiece } from './pdf-table';
import { RULES } from './rules';
import { DEFAULT_STATUTORY, type StatutorySettings } from './statutory';
import { perkesoRows } from './statutory-tables';

export const CONTRIB_RULE = {
  /** People one file may bring in. */
  maxRows: 3000,
  /** File size read on the device. */
  maxFileBytes: 15_000_000,
  /** Records kept per employer; the oldest go first. */
  keepRecords: 36,
  /** Person rows kept with an employer's records (older records keep their totals only). */
  keepRows: 8000,
  /** Downloads remembered per record. */
  keepDownloads: 40,
} as const;

// ---------- Column meanings ----------

export type PayKey =
  | 'bil'
  | 'name'
  | 'id'
  | 'staffNo'
  | 'nationality'
  | 'dob'
  | 'age'
  | 'basic'
  | 'allowance'
  | 'travel'
  | 'ot'
  | 'bonus'
  | 'arrears'
  | 'directorFee'
  | 'unpaid'
  | 'gross'
  | 'epfEe'
  | 'epfEr'
  | 'socsoEe'
  | 'socsoEr'
  | 'eisEe'
  | 'eisEr'
  | 'skbbk'
  | 'pcb'
  | 'zakat'
  | 'otherDeduction'
  | 'net';

export type PayKeyKind = 'person' | 'earning' | 'gross' | 'statutory' | 'other';

export interface PayKeyInfo {
  key: PayKey;
  label: string;
  kind: PayKeyKind;
  /** Earnings: counted as wages for EPF and for SOCSO/EIS/SKBBK unless the person unticks it. */
  epf?: boolean;
  socso?: boolean;
  /** Unpaid leave is taken off the wages. */
  sign?: 1 | -1;
  /** Several columns may have this meaning (allowances of different kinds). */
  many?: boolean;
}

/**
 * What each meaning counts for. EPF wages leave out overtime, travelling allowance and directors' fees (EPF Act 1991
 * s.2); SOCSO wages (Act 4 s.2, used for EIS and SKBBK too) take overtime in but leave out travelling allowance, bonus
 * and directors' fees. The person can change the ticks of each column on the screen.
 */
export const PAY_KEYS: PayKeyInfo[] = [
  { key: 'bil', label: 'Row number', kind: 'other' },
  { key: 'name', label: 'Name', kind: 'person' },
  { key: 'id', label: 'IC or passport number', kind: 'person' },
  { key: 'staffNo', label: 'Staff number', kind: 'person' },
  { key: 'nationality', label: 'Nationality', kind: 'person' },
  { key: 'dob', label: 'Date of birth', kind: 'person' },
  { key: 'age', label: 'Age', kind: 'person' },
  { key: 'basic', label: 'Basic pay', kind: 'earning', epf: true, socso: true },
  { key: 'allowance', label: 'Allowance', kind: 'earning', epf: true, socso: true, many: true },
  { key: 'travel', label: 'Travel allowance (not wages)', kind: 'earning', epf: false, socso: false, many: true },
  { key: 'ot', label: 'Overtime', kind: 'earning', epf: false, socso: true, many: true },
  { key: 'bonus', label: 'Bonus', kind: 'earning', epf: true, socso: false, many: true },
  { key: 'arrears', label: 'Back pay (arrears)', kind: 'earning', epf: true, socso: true, many: true },
  { key: 'directorFee', label: "Director's fee (not wages)", kind: 'earning', epf: false, socso: false, many: true },
  { key: 'unpaid', label: 'Unpaid leave (taken off)', kind: 'earning', epf: true, socso: true, sign: -1, many: true },
  { key: 'gross', label: 'Gross pay', kind: 'gross' },
  { key: 'epfEe', label: 'EPF employee (in the file)', kind: 'statutory' },
  { key: 'epfEr', label: 'EPF employer (in the file)', kind: 'statutory' },
  { key: 'socsoEe', label: 'SOCSO employee (in the file)', kind: 'statutory' },
  { key: 'socsoEr', label: 'SOCSO employer (in the file)', kind: 'statutory' },
  { key: 'eisEe', label: 'EIS employee (in the file)', kind: 'statutory' },
  { key: 'eisEr', label: 'EIS employer (in the file)', kind: 'statutory' },
  { key: 'skbbk', label: 'SKBBK (in the file)', kind: 'statutory' },
  { key: 'pcb', label: 'PCB', kind: 'other' },
  { key: 'zakat', label: 'Zakat', kind: 'other', many: true },
  { key: 'otherDeduction', label: 'Other deduction', kind: 'other', many: true },
  { key: 'net', label: 'Net pay', kind: 'other' },
];
export const payKeyInfo = (k: PayKey) => PAY_KEYS.find((x) => x.key === k)!;

/** Employer or employee side of a statutory column: "(MAJIKAN)", "ER", "Employer Share"; "(PEKERJA)", "EE". */
function sideOf(h: string): 'er' | 'ee' | null {
  if (/\b(majikan|employer|er|syarikat|company)\b/.test(h)) return 'er';
  if (/\b(pekerja|employee|ee|kakitangan|staf|staff)\b/.test(h)) return 'ee';
  return null;
}

/** Heading words, in order: the first that fits decides (SKBBK before SOCSO, EIS before the rest). */
const HEADER_RULES: [RegExp, (h: string) => PayKey, number][] = [
  [/\bskbbk\b|bkn bencana|bukan bencana|bencana bukan|lindung|non employment injury/, () => 'skbbk', 1],
  [/\b(sip|eis)\b|insurans pekerjaan|employment insurance/, (h) => (sideOf(h) === 'er' ? 'eisEr' : 'eisEe'), 1],
  [/\b(socso|perkeso)\b|keselamatan sosial/, (h) => (sideOf(h) === 'er' ? 'socsoEr' : 'socsoEe'), 1],
  [/\b(kwsp|epf)\b|simpanan pekerja|provident/, (h) => (sideOf(h) === 'er' ? 'epfEr' : 'epfEe'), 1],
  [/\b(pcb|mtd)\b|cukai|income tax|\btax\b/, () => 'pcb', 1],
  [/zakat/, () => 'zakat', 0.9],
  [/tarikh lahir|date of birth|\bdob\b|birth|lahir/, () => 'dob', 1],
  [/^(umur|age|usia)( tahun| years)?$/, () => 'age', 1],
  [/warganegara|nationality|citizenship|kerakyatan|negara asal|bangsa/, () => 'nationality', 0.9],
  [/no pekerja|staff (no|id|code|number)|employee (no|id|code|number)|emp (no|code|id)|kod pekerja|no staf|id pekerja|payroll no|no gaji/, () => 'staffNo', 1],
  [/\b(k p|kp|ic|nric|mykad|passport|pasport|kad pengenalan|identity|ssfw|new ic)\b/, () => 'id', 1],
  [/^(bil|no|n|sn|s no|sr|item|nombor|bil no|no bil)$/, () => 'bil', 1],
  [/^(nama|name)\b|nama pekerja|nama kakitangan|nama staf|employee name|staff name|full name|nama penuh/, () => 'name', 1],
  [/yuran pengarah|director s? fees?|directors fees?|fi pengarah/, () => 'directorFee', 1],
  [/back ?dated|tunggakan|arrears|back ?pay/, () => 'arrears', 1],
  [/bonus/, () => 'bonus', 1],
  [/\bot\b|overtime|lebih masa/, () => 'ot', 1],
  [/perjalanan|travel|mileage|petrol|minyak|\btol\b|toll|pengangkutan|transport/, () => 'travel', 0.9],
  [/cuti tanpa gaji|tanpa gaji|unpaid|no pay leave|\bnpl\b/, () => 'unpaid', 1],
  [/gaji kasar|jumlah kasar|\bgross\b|pendapatan kasar|total earnings|jumlah pendapatan kasar/, () => 'gross', 1],
  [/gaji pokok|gaji asas|\bbasic\b|base (pay|salary)|\bpokok\b/, () => 'basic', 1],
  [/gaji bersih|net (pay|salary)|\bbersih\b|jumlah dibayar|amount paid|take home|^jumlah pendapatan$/, () => 'net', 0.8],
  [/elaun|allowance|insentif|incentive|komisen|commission/, () => 'allowance', 0.9],
  [/pinjaman|\bpnjm\b|\bloan\b|pendahuluan|advance|potongan lain|lain lain|\bpmtgn\b|other deductions?/, () => 'otherDeduction', 0.8],
  [/^(gaji|salary|wages?|upah|salary rm|gaji rm)$/, () => 'basic', 0.8],
];

/** The meaning of a column heading, or null (a "JUMLAH" alone, a signature, anything else). */
export function payHeaderKey(header: string): { key: PayKey; score: number } | null {
  const h = normHeader(header);
  if (!h || h.length > 120) return null;
  for (const [re, key, score] of HEADER_RULES) if (re.test(h)) return { key: key(h), score };
  // P129: a scanned sheet read with OCR may run heading words together ("GAJIKASAR", "GAJIBERSIH"): split the known
  // heading words apart and try once more.
  const split = h.replace(/\s+/g, '').replace(RUN_TOGETHER, ' $1 ').replace(/\s+/g, ' ').trim();
  if (split !== h) for (const [re, key, score] of HEADER_RULES) if (re.test(split)) return { key: key(split), score: score * 0.9 };
  return null;
}

/** Heading words a scan may join to their neighbours. */
const RUN_TOGETHER =
  /(gaji|kasar|bersih|pokok|asas|elaun|jumlah|potongan|caruman|pekerja|majikan|kwsp|epf|perkeso|socso|skbbk|pcb|zakat|cuti|tanpa|lebih|masa|yuran|pengarah|tunggakan|bonus|perjalanan|pinjaman|pendahuluan|nama|gross|basic|salary|allowance|overtime|employer|employee)/g;

// ---------- Values ----------

const IC_RE = /(?<!\d)(\d{2})(\d{2})(\d{2})\s*-?\s*(\d{2})\s*-?\s*(\d{4})(?!\d)/;
/** A Malaysian IC (12 digits, a real month and day) anywhere in a text: the 12 digits, or null. */
export function icIn(text: string): string | null {
  const m = IC_RE.exec(String(text ?? ''));
  if (!m) return null;
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return m.slice(1, 6).join('');
}

/** Age in whole years on the 1st of the wage month, from an IC, as PERKESO's converter works it (YY after the wage year is 19YY). */
export function ageFromIc(ic: string, period: string): number | null {
  const d = String(ic ?? '').replace(/\D/g, '');
  if (d.length !== 12) return null;
  const [y, m] = period.split('-').map(Number);
  const yy = Number(d.slice(0, 2));
  const birthYear = (yy > y % 100 ? 1900 : 2000) + yy;
  return ageAt(`${birthYear}-${d.slice(2, 4)}-${d.slice(4, 6)}`, `${y}-${String(m).padStart(2, '0')}-01`);
}

function ageAt(dob: string, on: string): number | null {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  if (![by, bm, bd, y, m, d].every(Number.isFinite) || bm < 1 || bm > 12 || bd < 1 || bd > 31) return null;
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
  jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, aug: 8, august: 8, ogo: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10,
  oktober: 10, october: 10, nov: 11, november: 11, dis: 12, dec: 12, disember: 12, december: 12,
};

/** The wage month a title or file name names ("BULAN: NOVEMBER 2026", "GAJI NOV 2026", "11/2026"), as YYYY-MM. */
export function periodIn(text: string): string | null {
  const t = String(text ?? '').toLowerCase();
  const word = /\b(januari|january|februari|february|march|mac|april|mei|may|june|jun|julai|july|ogos|august|september|sept|oktober|october|november|disember|december|jan|feb|mar|apr|jul|aug|sep|okt|oct|nov|dis|dec)\b[\s,.'-]*((?:19|20)\d{2})\b/.exec(t);
  if (word) return `${word[2]}-${String(MONTHS[word[1]]).padStart(2, '0')}`;
  const num = /\b(0?[1-9]|1[0-2])\s*[/.-]\s*((?:20)\d{2})\b/.exec(t) ?? null;
  if (num) return `${num[2]}-${num[1].padStart(2, '0')}`;
  const iso = /\b(20\d{2})-(0[1-9]|1[0-2])\b/.exec(t);
  return iso ? `${iso[1]}-${iso[2]}` : null;
}

const money = (raw: string): number | null => {
  const n = guardPayNumber(raw);
  return n === 'bad' ? null : n;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const MONEY_CELL = /^\(?-?\s*(?:rm\s?)?(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.\d{1,2})?\s*\)?$/i;
const isMoneyText = (s: string) => MONEY_CELL.test(s.trim()) && /\d/.test(s);
const isDash = (s: string) => /^[-–—]+$/.test(s.trim());

// ---------- PDF printed from Excel ----------

const HEADER_WORD =
  /\b(bil|nama|name|gaji|pokok|basic|elaun|allowances?|kwsp|epf|socso|perkeso|sip|eis|skbbk|pcb|mtd|zakat|jumlah|total|kasar|gross|bersih|net|potongan|deductions?|pendapatan|earnings|majikan|employer|pekerja|employee|bonus|ot|overtime|lebih|k p|ic|yuran|pengarah|tunggakan|dated|pinjaman|bencana|pentadbiran|perjalanan|pmtgn|pnjm|sumbangan|insentif|salary|wages|upah|caruman|contribution|share)\b/;

type Line = { page: number; y: number; size: number; pieces: PdfTextPiece[] };

function linesOfPieces(pieces: readonly PdfTextPiece[]): Line[] {
  const sorted = pieces.filter((p) => p.text.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const p of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === p.page && Math.abs(last.y - p.y) <= Math.max(0.8, p.size * 0.45)) {
      last.pieces.push(p);
      last.y = (last.y * (last.pieces.length - 1) + p.y) / last.pieces.length;
    } else lines.push({ page: p.page, y: p.y, size: p.size, pieces: [p] });
  }
  for (const l of lines) l.pieces.sort((a, b) => a.x - b.x);
  return lines;
}

const isDataLine = (l: Line) => {
  const t = l.pieces.map((p) => p.text.trim());
  const decimals = t.filter((s) => isMoneyText(s) && /\.\d{2}\)?$/.test(s)).length;
  const dashes = t.filter(isDash).length;
  return decimals >= 2 || (decimals >= 1 && decimals + dashes >= 3);
};
const lineText = (l: Line) => l.pieces.map((p) => p.text.trim()).join(' ');
const isHeaderLine = (l: Line) => {
  const t = normHeader(lineText(l));
  if (!t || /:/.test(lineText(l)) && l.pieces.length === 1) return false;
  return HEADER_WORD.test(t) || l.pieces.some((p) => !!payHeaderKey(p.text));
};
const punctuationOnly = (l: Line) => !/[\p{L}\d]/u.test(lineText(l));

/**
 * A salary sheet printed to PDF (from Excel, or any report), as rows and columns by where the text sits: the columns
 * are where the figures of the people's lines fall (numbers are right-aligned, so their spans overlap down a column);
 * the heading is every piece of text in the heading band above the first person, put in the column under which it is
 * centred, read top to bottom (a heading wrapped over three lines becomes one). Lines above the heading come first as
 * one-cell rows (company, month); a repeated heading on later pages is left out.
 */
export function payGridFromPdf(pieces: readonly PdfTextPiece[]): string[][] {
  const lines = linesOfPieces(pieces);
  const data = lines.filter(isDataLine);
  if (data.length < 1) return lines.map((l) => [lineText(l)]);
  // Columns: the spans of the pieces on people's lines, merged where they overlap.
  const spans = data
    .flatMap((l, li) => l.pieces.map((p) => ({ a: p.x, b: Math.max(p.right, p.x + 0.5), size: p.size, li })))
    .sort((x, y) => x.a - y.a);
  const cols: { a: number; b: number; lines: Set<number>; size: number }[] = [];
  for (const s of spans) {
    const c = cols[cols.length - 1];
    if (c && s.a <= c.b + s.size * 0.25) {
      c.b = Math.max(c.b, s.b);
      c.lines.add(s.li);
    } else cols.push({ a: s.a, b: s.b, lines: new Set([s.li]), size: s.size });
  }
  // Two neighbouring spans that never both hold something on the same person's line are one column (a "-" for nil is
  // drawn left of where the figures end, so it may not overlap them).
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i + 1 < cols.length; i++) {
      const [x, y] = [cols[i], cols[i + 1]];
      if (y.a - x.b > Math.max(x.size, y.size) * 6) continue;
      if ([...y.lines].some((li) => x.lines.has(li))) continue;
      x.b = Math.max(x.b, y.b);
      for (const li of y.lines) x.lines.add(li);
      cols.splice(i + 1, 1);
      merged = true;
      break;
    }
  }
  const bounds = cols.slice(1).map((c, i) => (cols[i].b + c.a) / 2);
  const colOf = (p: PdfTextPiece) => {
    const mid = (p.x + Math.max(p.right, p.x + 0.5)) / 2;
    let k = 0;
    while (k < bounds.length && mid > bounds[k]) k++;
    return k;
  };
  const cellsOf = (l: Line) => {
    const row: string[] = new Array(cols.length).fill('');
    for (const p of l.pieces) {
      const k = colOf(p);
      row[k] = row[k] ? `${row[k]} ${p.text.trim()}` : p.text.trim();
    }
    return row;
  };
  // The heading band of each page: from the lowest heading line above the page's first person line, upwards.
  const skip = new Set<Line>();
  let header: string[] | null = null;
  const titles: string[][] = [];
  const pages = [...new Set(lines.map((l) => l.page))];
  for (const page of pages) {
    const onPage = lines.filter((l) => l.page === page);
    const first = onPage.findIndex((l) => data.includes(l));
    if (first < 0) continue;
    const band: Line[] = [];
    let i = first - 1;
    while (i >= 0 && !isHeaderLine(onPage[i])) i--;
    for (; i >= 0; i--) {
      const l = onPage[i];
      const prev = band[band.length - 1];
      const near = !prev || l.y - prev.y <= Math.max(prev.size, l.size) * 3.2;
      if (!near) break;
      if (isHeaderLine(l) || punctuationOnly(l)) band.push(l);
      else if (/:/.test(lineText(l)) || l.pieces.length < 2) break;
      else band.push(l);
    }
    // Punctuation just under the band (a ")" wrapped from "(MAJIKAN") belongs to it.
    const low = band.length ? Math.min(...band.map((l) => l.y)) : Infinity;
    for (const l of onPage.slice(0, first)) if (!band.includes(l) && punctuationOnly(l) && low - l.y <= l.size * 1.5 && l.y < low + 0.01) band.push(l);
    band.forEach((l) => skip.add(l));
    if (!header && band.length) {
      const pcs = band.flatMap((l) => l.pieces).sort((a, b) => b.y - a.y || a.x - b.x);
      const head: string[][] = cols.map(() => []);
      for (const p of pcs) head[colOf(p)].push(p.text.trim());
      header = head.map((h) => h.join(' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim());
      const top = Math.max(...band.map((l) => l.y));
      for (const l of onPage) if (l.y > top + 0.01) {
        titles.push([lineText(l)]);
        skip.add(l);
      }
    } else if (header) for (const l of onPage.slice(0, first)) if (l.y > Math.max(...band.map((b) => b.y), -Infinity) + 0.01) skip.add(l);
  }
  const out: string[][] = [...titles];
  if (header) out.push(header);
  for (const l of lines) if (!skip.has(l)) out.push(cellsOf(l));
  return out;
}

// ---------- Reading a sheet ----------

export interface PayColumn {
  index: number;
  header: string;
  key: PayKey | null;
  /** How sure the heading made it: 1 sure, under 0.85 worth a look. */
  score: number;
  /** Earnings: counted as wages for EPF, and for SOCSO/EIS/SKBBK. */
  epf: boolean;
  socso: boolean;
}

export interface PaySheet {
  /** The heading row's index in the grid, and how many rows the heading takes (1 or 2). */
  headerRow: number;
  headerRows: number;
  columns: PayColumn[];
  /** The rows under the heading, as read (cells as text). */
  body: string[][];
  /** The file's own row numbers of the body rows (1-based, as the sheet shows them). */
  rowNos: number[];
  /** Text above the heading (company name, "BULAN: NOVEMBER 2026"). */
  titles: string[];
}

const SINGLE: PayKey[] = ['bil', 'name', 'id', 'staffNo', 'nationality', 'dob', 'age', 'basic', 'gross', 'epfEe', 'epfEr', 'socsoEe', 'socsoEr', 'eisEe', 'eisEr', 'skbbk', 'pcb', 'net'];

function headerScore(cells: string[]): number {
  const best = new Map<PayKey, number>();
  for (const c of cells) {
    const m = c ? payHeaderKey(c) : null;
    if (m && (best.get(m.key) ?? 0) < m.score) best.set(m.key, m.score);
  }
  const keys = [...best.keys()];
  const total = [...best.values()].reduce((a, b) => a + b, 0);
  // A heading names a person and some pay; a banner names one thing.
  const person = keys.some((k) => k === 'name' || k === 'id') ? 1 : 0;
  const pay = keys.some((k) => payKeyInfo(k).kind !== 'person' && k !== 'bil') ? 1 : 0;
  return keys.length >= 2 ? total + person + pay : total * 0.3;
}

const moneyCells = (r: string[]) => r.filter((c) => c && isMoneyText(c) && /\./.test(c)).length;

/** The heading: the row (or two rows read together) among the first 30 that names the most columns. */
export function findPayHeader(grid: string[][]): { row: number; rows: 1 | 2; header: string[] } {
  let best = { row: 0, rows: 1 as 1 | 2, header: grid[0] ?? [], score: -1 };
  for (let r = 0; r < Math.min(30, grid.length); r++) {
    const one = (grid[r] ?? []).map((c) => String(c ?? '').trim());
    if (moneyCells(one) >= 2) continue;
    const s1 = headerScore(one);
    if (s1 > best.score + 1e-9) best = { row: r, rows: 1, header: one, score: s1 };
    const next = (grid[r + 1] ?? []).map((c) => String(c ?? '').trim());
    if (r + 1 < grid.length && moneyCells(next) < 2 && next.some(Boolean)) {
      const width = Math.max(one.length, next.length);
      const two = Array.from({ length: width }, (_, i) => [one[i] ?? '', next[i] ?? ''].filter(Boolean).join(' '));
      const s2 = headerScore(two);
      if (s2 > best.score + 0.5) best = { row: r, rows: 2, header: two, score: s2 };
    }
  }
  return { row: best.row, rows: best.rows, header: best.header };
}

const PERSON_NAME = /^[\p{L}][\p{L}'’.@/\- ]{2,}$/u;
const nameish = (s: string) => PERSON_NAME.test(s.trim()) && s.trim().split(/\s+/).length >= 2;

/** Give each column its meaning: the heading first, then the values (an IC column, a name column) where no heading fits. */
export function payColumns(header: string[], body: string[][]): PayColumn[] {
  const width = Math.max(header.length, ...body.slice(0, 200).map((r) => r.length), 0);
  const cols: PayColumn[] = Array.from({ length: width }, (_, i) => {
    const h = String(header[i] ?? '').trim();
    const m = payHeaderKey(h);
    const info = m ? payKeyInfo(m.key) : null;
    return { index: i, header: h, key: m?.key ?? null, score: m?.score ?? 0, epf: info?.epf ?? false, socso: info?.socso ?? false };
  });
  // One column per single meaning; a second "SOCSO" with no side is the employer's when the employer's is missing.
  const pairs: [PayKey, PayKey][] = [['epfEe', 'epfEr'], ['socsoEe', 'socsoEr'], ['eisEe', 'eisEr']];
  for (const [ee, er] of pairs) {
    const both = cols.filter((c) => c.key === ee);
    if (both.length >= 2 && !cols.some((c) => c.key === er)) {
      both[1].key = er;
      both[1].score = Math.min(both[1].score, 0.7);
    }
  }
  for (const k of SINGLE) {
    const same = cols.filter((c) => c.key === k).sort((a, b) => b.score - a.score || a.index - b.index);
    for (const c of same.slice(1)) Object.assign(c, { key: null, score: 0 });
  }
  const values = (i: number) => body.slice(0, 300).map((r) => String(r[i] ?? '').trim()).filter(Boolean);
  // The IC column by its values when no heading said so.
  if (!cols.some((c) => c.key === 'id')) {
    const c = cols.filter((x) => !x.key).find((x) => {
      const v = values(x.index);
      return v.length >= 2 && v.filter((s) => icIn(s) && s.replace(/\D/g, '').length <= 14).length / v.length >= 0.6;
    });
    if (c) Object.assign(c, { key: 'id', score: 0.75 });
  }
  if (!cols.some((c) => c.key === 'name')) {
    const c = cols.filter((x) => !x.key).find((x) => {
      const v = values(x.index);
      return v.length >= 2 && v.filter(nameish).length / v.length >= 0.6;
    });
    if (c) Object.assign(c, { key: 'name', score: 0.75 });
  }
  return cols;
}

/** The sheet read: heading, column meanings, the rows under it. `grid` as the file gives it (titles first). */
export function readPaySheet(grid: string[][]): PaySheet {
  const rows = grid.map((r) => (r ?? []).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()));
  const h = findPayHeader(rows);
  const start = h.row + h.rows;
  const body = rows.slice(start);
  const titles = rows
    .slice(0, h.row)
    .map((r) => r.filter(Boolean).join(' '))
    .filter(Boolean);
  return { headerRow: h.row, headerRows: h.rows, columns: payColumns(h.header, body), body, rowNos: body.map((_, i) => start + i + 1), titles };
}

// ---------- People ----------

/** The file's own figures for a person, to compare with Prima's. */
export type FileFigures = Partial<Record<'epfEe' | 'epfEr' | 'socsoEe' | 'socsoEr' | 'eisEe' | 'eisEr' | 'skbbk' | 'gross', number>>;

/** One person as it goes to the counting (and to the server): what the file says, and the person's corrections. */
export interface ContribPerson {
  /** The file's row number (the first line of the person's record). */
  row: number;
  name: string;
  /** IC (12 digits), or the passport / SOCSO foreign worker number as written. */
  id: string;
  staffNo?: string;
  nationality: 'MY' | 'FOREIGN';
  /** Age on the 1st of the wage month; null when nothing gives it. */
  age: number | null;
  ageFrom: 'ic' | 'dob' | 'age' | 'none';
  /** Wages for SOCSO, EIS and SKBBK; and for EPF. */
  socsoWage: number;
  epfWage: number;
  /** Malaysian with the LINDUNG 24 Jam opt-out form on file. */
  skbbkOptOut: boolean;
  /** In the files (a person can be left out: a director paid fees only, someone not on this employer's books). */
  include: boolean;
  file?: FileFigures;
}

export interface ReadPeople {
  people: ContribPerson[];
  /** The file's own totals line, by meaning (the sum of each column). */
  totals: Partial<Record<PayKey, number>>;
  /** Lines the reader could not use. */
  problems: { row: number; message: string }[];
  /** Each person's figures line as read (parallel to `people`), to work the wages again when the ticks change. */
  cells: string[][];
}

const nationalityOf = (raw: string): 'MY' | 'FOREIGN' | null => {
  const v = normHeader(raw);
  if (!v) return null;
  if (/^(my|mys|malaysia|malaysian|warganegara|citizen|tempatan|local|pr|penduduk tetap|permanent resident|wn|melayu|cina|india|bumiputera)\b/.test(v)) return 'MY';
  if (/bukan warganegara|non citizen|foreign|asing|^(np|nepal|indonesia|bangladesh|myanmar|india national|pakistan|vietnam|philippines|thai)/.test(v)) return 'FOREIGN';
  return v.length >= 3 ? 'FOREIGN' : null;
};

const BANK_LINE = /\b(bank|mbb|maybank|cimb|rhb|hlb|bsn|affin|ambank|bimb|islam|muamalat|public|p\.?bank|uob|ocbc|hsbc|agro|rakyat|alliance)\b|\d{4}\s?\d{3,4}\s?\d{3,}/i;
const KP_TEXT = /\b(no\.?\s*)?(k\s*\/\s*p|kp|ic|nric|mykad)\s*[:.]?\s*/gi;

/** A name as written, without the IC, the "K/P:" label, a leading row number or a bank account. */
export function cleanName(raw: string): string {
  let s = String(raw ?? '');
  s = s.replace(/(?<!\d)\d{6}\s*-?\s*\d{2}\s*-?\s*\d{4}(?!\d)/g, ' ');
  s = s.replace(KP_TEXT, ' ');
  s = s.replace(/\(\s*(bank|mbb|maybank|cimb|rhb|hlb|bsn|affin|ambank|bimb|p\.?\s*bank|public bank|uob|ocbc|hsbc)[^)]*\)?/gi, ' ');
  s = s.replace(/^\s*\d{1,4}[.)]?\s+(?=\p{L})/u, '');
  s = s.replace(/[:]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /\p{L}{2}/u.test(s) ? s : '';
}

/**
 * The people of a read sheet. A person's record is the line with their figures; lines around it with no figures add
 * the name (a line just above with no name on the figures line), the IC ("K/P: ..." just below) or nothing (a bank
 * account, a department). A "JUMLAH" / "TOTAL" line is the file's totals. Each person's wages are the columns ticked for
 * SOCSO and for EPF (or the gross pay when no earnings column is given).
 */
export function payPeople(sheet: PaySheet, period: string): ReadPeople {
  const cols = sheet.columns.filter((c) => c.key);
  const by = (k: PayKey) => cols.filter((c) => c.key === k);
  const moneyCols = cols.filter((c) => !['name', 'id', 'staffNo', 'nationality', 'dob', 'age', 'bil'].includes(c.key!));
  const earnings = cols.filter((c) => payKeyInfo(c.key!).kind === 'earning');
  const nameCol = by('name')[0];
  const idCol = by('id')[0];
  const problems: ReadPeople['problems'] = [];
  const totals: ReadPeople['totals'] = {};
  type Rec = { row: number; cells: string[]; name: string; id: string; extra: string[] };
  const recs: Rec[] = [];
  let pending: { row: number; text: string; kind: 'ic' | 'name' | 'other' }[] = [];
  const textOf = (r: string[]) => r.filter(Boolean).join(' ');
  const settle = (next: Rec | null) => {
    const prev = recs.length ? recs[recs.length - 1] : null;
    const names = pending.filter((p) => p.kind === 'name');
    if (next && !next.name && names.length) {
      next.name = cleanName(names[names.length - 1].text);
      names.pop();
    }
    if (prev && !prev.name && names.length) prev.name = cleanName(names[0].text);
    for (const p of pending.filter((x) => x.kind === 'ic')) {
      const ic = icIn(p.text)!;
      if (prev && !prev.id) prev.id = ic;
      else if (next && !next.id) next.id = ic;
    }
    pending = [];
  };
  sheet.body.forEach((r, i) => {
    const row = sheet.rowNos[i] ?? i + 1;
    if (!r.some(Boolean)) return;
    const nameCell = nameCol ? (r[nameCol.index] ?? '') : '';
    const lead = normHeader(nameCell || r.find(Boolean) || '');
    if (isTotalsRow(r) || /^(jumlah|total|grand total|jumlah besar)\b/.test(lead)) {
      for (const c of moneyCols) {
        const v = money(r[c.index] ?? '');
        if (v != null) totals[c.key!] = r2((totals[c.key!] ?? 0) + v);
      }
      return;
    }
    const figures = moneyCols.filter((c) => {
      const v = String(r[c.index] ?? '').trim();
      return v && !isDash(v) && money(v) != null;
    });
    if (figures.length) {
      const all = textOf(r.filter((_, k) => !moneyCols.some((c) => c.index === k)));
      const idRaw = idCol ? (r[idCol.index] ?? '').trim() : '';
      const id = icIn(idRaw) ?? (idRaw ? idRaw.toUpperCase().replace(/^(K\s*\/\s*P|IC|NO)\s*[:.]?\s*/i, '').replace(/[^A-Z0-9]/g, '') : '') ?? '';
      const rec: Rec = { row, cells: r, name: cleanName(nameCell), id: id || icIn(all) || '', extra: [] };
      settle(rec);
      recs.push(rec);
      return;
    }
    const t = textOf(r);
    if (icIn(t)) pending.push({ row, text: t, kind: 'ic' });
    else if (nameish(cleanName(t)) && !BANK_LINE.test(t) && !/\d/.test(t)) pending.push({ row, text: t, kind: 'name' });
    else pending.push({ row, text: t, kind: 'other' });
  });
  settle(null);
  const sumOf = (r: string[], list: PayColumn[], pick: (c: PayColumn) => boolean) =>
    r2(list.filter(pick).reduce((n, c) => n + (money(r[c.index] ?? '') ?? 0) * (payKeyInfo(c.key!).sign ?? 1), 0));
  const one = (r: string[], k: PayKey) => {
    const c = by(k)[0];
    return c ? money(r[c.index] ?? '') : null;
  };
  const people: ContribPerson[] = [];
  const cells: string[][] = [];
  for (const rec of recs.slice(0, CONTRIB_RULE.maxRows)) {
    cells.push(rec.cells);
    const r = rec.cells;
    let socsoWage: number;
    let epfWage: number;
    if (earnings.length) {
      socsoWage = sumOf(r, earnings, (c) => c.socso);
      epfWage = sumOf(r, earnings, (c) => c.epf);
    } else {
      const g = one(r, 'gross') ?? 0;
      socsoWage = g;
      epfWage = g;
    }
    const natCol = by('nationality')[0];
    const nat = natCol ? nationalityOf(r[natCol.index] ?? '') : null;
    const ic = /^\d{12}$/.test(rec.id) ? rec.id : null;
    let age: number | null = null;
    let ageFrom: ContribPerson['ageFrom'] = 'none';
    const ageCol = by('age')[0];
    const dobCol = by('dob')[0];
    const ageVal = ageCol ? Number(String(r[ageCol.index] ?? '').replace(/[^\d.]/g, '')) : NaN;
    if (ageCol && Number.isFinite(ageVal) && ageVal > 0 && ageVal < 120 && String(r[ageCol.index] ?? '').trim()) {
      age = Math.floor(ageVal);
      ageFrom = 'age';
    } else if (dobCol && dobIso(r[dobCol.index] ?? '')) {
      age = ageAt(dobIso(r[dobCol.index] ?? '')!, `${period}-01`);
      ageFrom = age == null ? 'none' : 'dob';
    } else if (ic) {
      age = ageFromIc(ic, period);
      ageFrom = age == null ? 'none' : 'ic';
    }
    const file: FileFigures = {};
    for (const k of ['epfEe', 'epfEr', 'socsoEe', 'socsoEr', 'eisEe', 'eisEr', 'skbbk', 'gross'] as const) {
      if (!by(k).length) continue;
      file[k] = one(r, k) ?? 0;
    }
    const nationality = nat ?? (rec.id && !ic ? 'FOREIGN' : 'MY');
    // A file with an SKBBK column that shows none for a Malaysian: taken as opted out (LINDUNG 24 Jam is optional for
    // Malaysians from 9 July 2026); the person can untick it.
    const skbbkOptOut = nationality === 'MY' && by('skbbk').length > 0 && !(file.skbbk && file.skbbk > 0) && socsoWage > 0;
    const staffCol = by('staffNo')[0];
    people.push({
      row: rec.row,
      name: rec.name.slice(0, 150),
      id: rec.id.slice(0, 20),
      staffNo: staffCol ? String(r[staffCol.index] ?? '').trim().slice(0, 30) || undefined : undefined,
      nationality,
      age,
      ageFrom,
      socsoWage: Math.max(0, socsoWage),
      epfWage: Math.max(0, epfWage),
      skbbkOptOut,
      include: socsoWage > 0 || epfWage > 0,
      file: Object.keys(file).length ? file : undefined,
    });
  }
  if (recs.length > CONTRIB_RULE.maxRows) problems.push({ row: recs[CONTRIB_RULE.maxRows].row, message: `Only the first ${CONTRIB_RULE.maxRows} people are read. Split the file.` });
  return { people, totals, problems, cells };
}

/** The wages of one figures line by the columns ticked (gross pay when no earnings column is given). */
export function wagesOf(cells: string[], columns: PayColumn[], scheme: 'epf' | 'socso'): number {
  const earnings = columns.filter((c) => c.key && payKeyInfo(c.key).kind === 'earning');
  if (!earnings.length) {
    const g = columns.find((c) => c.key === 'gross');
    return g ? Math.max(0, money(cells[g.index] ?? '') ?? 0) : 0;
  }
  return Math.max(0, r2(earnings.filter((c) => c[scheme]).reduce((n, c) => n + (money(cells[c.index] ?? '') ?? 0) * (payKeyInfo(c.key!).sign ?? 1), 0)));
}

export interface WageGuess {
  scheme: 'epf' | 'socso';
  /** The earnings columns (by index) that reproduce the file's own figures best. */
  ticked: number[];
  /** People whose figure in the file this reproduces, out of `of`; with the law's ticks, `lawMatches`. */
  matches: number;
  lawMatches: number;
  of: number;
}

/**
 * Which earnings the file itself counted for EPF and for SOCSO: every choice of earnings columns is tried against the
 * file's own EPF (employee) and SOCSO (both shares) figures, and the one that reproduces the most people wins (ties go
 * to the choice closest to the law's). Shown as a suggestion only when it beats the law's ticks: the law stays the
 * default, and the person decides.
 */
export function guessWageTicks(read: ReadPeople, columns: PayColumn[], period: string, st: StatutorySettings = DEFAULT_STATUTORY): WageGuess[] {
  const earnings = columns.filter((c) => c.key && payKeyInfo(c.key).kind === 'earning').slice(0, 10);
  const out: WageGuess[] = [];
  if (!earnings.length) return out;
  const sample = read.people.map((p, i) => ({ p, cells: read.cells[i] })).filter((x) => x.p.file && x.p.include).slice(0, 400);
  for (const scheme of ['epf', 'socso'] as const) {
    const has = scheme === 'epf' ? columns.some((c) => c.key === 'epfEe') : columns.some((c) => c.key === 'socsoEe' || c.key === 'socsoEr');
    if (!has || !sample.length) continue;
    const law = earnings.map((c) => payKeyInfo(c.key!)[scheme] === true);
    const ok = (mask: boolean[]) =>
      sample.filter(({ p, cells }) => {
        const w = Math.max(0, r2(earnings.reduce((n, c, i) => n + (mask[i] ? (money(cells[c.index] ?? '') ?? 0) * (payKeyInfo(c.key!).sign ?? 1) : 0), 0)));
        const age = p.age ?? 30;
        if (scheme === 'epf') return Math.abs(epfShare(w, age, p.nationality === 'MY' ? 'MY' : 'NP', st).ee - (p.file!.epfEe ?? 0)) < 0.005;
        const s = socsoShare(w, age, st);
        return (p.file!.socsoEe == null || Math.abs(s.ee - p.file!.socsoEe) < 0.005) && (p.file!.socsoEr == null || Math.abs(s.er - p.file!.socsoEr) < 0.005);
      }).length;
    const lawMatches = ok(law);
    let best = { mask: law, n: lawMatches, change: 0 };
    for (let m = 0; m < 1 << earnings.length; m++) {
      const mask = earnings.map((_, i) => ((m >> i) & 1) === 1);
      const change = mask.filter((v, i) => v !== law[i]).length;
      const n = ok(mask);
      if (n > best.n || (n === best.n && change < best.change)) best = { mask, n, change };
    }
    out.push({ scheme, ticked: earnings.filter((_, i) => best.mask[i]).map((c) => c.index), matches: best.n, lawMatches, of: sample.length });
  }
  return out;
}

function dobIso(raw: string): string | null {
  const v = String(raw ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

// ---------- Counting ----------

export type FigureKey = 'socsoEr' | 'socsoEe' | 'eisEr' | 'eisEe' | 'skbbk' | 'epfEr' | 'epfEe';
export const FIGURE_KEYS: FigureKey[] = ['socsoEr', 'socsoEe', 'eisEr', 'eisEe', 'skbbk', 'epfEr', 'epfEe'];
export const FIGURE_LABEL: Record<FigureKey, string> = {
  socsoEr: 'SOCSO employer',
  socsoEe: 'SOCSO employee',
  eisEr: 'EIS employer',
  eisEe: 'EIS employee',
  skbbk: 'SKBBK employee',
  epfEr: 'EPF employer',
  epfEe: 'EPF employee',
};

export interface ContribRow extends ContribPerson, Record<FigureKey, number> {
  /** SOCSO category: 1 (employment injury and invalidity) under 60, 2 (employment injury only) from 60. */
  category: 1 | 2;
  /** In the PERKESO file: included, SOCSO wages above nil and an IC or SOCSO number. */
  inPerkeso: boolean;
  /** The rules applied, in plain words. */
  rules: string[];
  /** Things to fix before the file is right (an IC missing). */
  problems: string[];
  /** Where the file's own figure differs from Prima's. */
  diffs: { key: FigureKey; file: number; prima: number }[];
}

/** One person's SOCSO, EIS, SKBBK and EPF for the wage month, by the statutory settings in force for it. */
export function contribRow(p: ContribPerson, period: string, st: StatutorySettings = DEFAULT_STATUTORY): ContribRow {
  const nat = p.nationality === 'MY' ? 'MY' : 'NP';
  const age = p.age ?? 30;
  const rules: string[] = [];
  const problems: string[] = [];
  const zero = { socsoEr: 0, socsoEe: 0, eisEr: 0, eisEe: 0, skbbk: 0, epfEr: 0, epfEe: 0 };
  if (!p.include) return { ...p, ...zero, category: age >= st.socso.olderAge ? 2 : 1, inPerkeso: false, rules: ['Left out of the files'], problems, diffs: [] };
  const socso = socsoShare(p.socsoWage, age, st);
  const eis = eisShare(p.socsoWage, age, nat, st);
  const lindung = lindungShare(p.socsoWage, period, nat, p.skbbkOptOut, st);
  const epf = epfShare(p.epfWage, age, nat, st);
  const category: 1 | 2 = age >= st.socso.olderAge ? 2 : 1;
  if (p.socsoWage > 0) rules.push(category === 1 ? 'SOCSO First Category (under 60)' : 'SOCSO Second Category (60 and over): employer only');
  if (p.socsoWage > st.socso.wageCap) rules.push('SOCSO, EIS and SKBBK on the RM6,000 ceiling');
  if (p.socsoWage > 0)
    rules.push(nat !== 'MY' ? 'No EIS: foreign worker' : age < st.eis.minAge ? 'No EIS: under 18' : age >= st.eis.maxAge ? 'No EIS: 60 and over' : 'EIS 0.2% each');
  if (p.socsoWage > 0) rules.push(lindung.status === 'opted_out' ? 'SKBBK: opted out' : lindung.status === 'not_started' ? 'SKBBK: not yet started for this month' : 'SKBBK (LINDUNG 24 Jam), employee only');
  if (p.epfWage > 0) rules.push(nat !== 'MY' ? 'EPF Part F (non-citizen): 2% each' : age >= st.epf.olderAge ? 'EPF 60 and over: employer 4%' : p.epfWage <= st.epf.erLimit ? 'EPF Part A: employer 13%, employee 11%' : 'EPF Part A: employer 12%, employee 11%');
  if (p.age == null) rules.push('Age not known: under 60 taken');
  const ic = /^\d{12}$/.test(p.id);
  if (!p.id) problems.push('No IC or SOCSO number');
  else if (p.nationality === 'MY' && !ic) problems.push('The IC is not 12 digits');
  else if (p.nationality === 'FOREIGN') rules.push('Foreign worker: the PERKESO file takes the SOCSO foreign worker number (SSFW No.), not the passport');
  if (!p.name) problems.push('No name');
  const out: ContribRow = {
    ...p,
    socsoEr: socso.er,
    socsoEe: socso.ee,
    eisEr: eis.er,
    eisEe: eis.ee,
    skbbk: lindung.ee,
    epfEr: epf.er,
    epfEe: epf.ee,
    category,
    inPerkeso: p.socsoWage > 0 && !!p.id,
    rules,
    problems,
    diffs: [],
  };
  if (p.file) {
    for (const k of FIGURE_KEYS) {
      const f = p.file[k];
      if (f == null) continue;
      if (Math.abs(f - out[k]) >= 0.005) out.diffs.push({ key: k, file: r2(f), prima: out[k] });
    }
    // The old single-Act file put SKBBK into the SOCSO employee share (PERKESO FAQ, question 8).
    if (p.file.skbbk == null && p.file.socsoEe != null && Math.abs(p.file.socsoEe - (out.socsoEe + out.skbbk)) < 0.005 && out.skbbk > 0)
      out.rules.push("The file's SOCSO employee share includes SKBBK");
  }
  return out;
}

export interface ContribTotals {
  people: number;
  inPerkeso: number;
  problems: number;
  differences: number;
  socsoWage: number;
  epfWage: number;
  socsoEr: number;
  socsoEe: number;
  eisEr: number;
  eisEe: number;
  skbbk: number;
  epfEr: number;
  epfEe: number;
}

export function contribTotals(rows: ContribRow[]): ContribTotals {
  const inc = rows.filter((r) => r.include);
  const sum = (f: (r: ContribRow) => number) => r2(inc.reduce((n, r) => n + f(r), 0));
  return {
    people: rows.length,
    inPerkeso: rows.filter((r) => r.include && r.inPerkeso).length,
    problems: rows.filter((r) => r.include && r.problems.length).length,
    differences: rows.filter((r) => r.include && r.diffs.length).length,
    socsoWage: sum((r) => r.socsoWage),
    epfWage: sum((r) => r.epfWage),
    socsoEr: sum((r) => r.socsoEr),
    socsoEe: sum((r) => r.socsoEe),
    eisEr: sum((r) => r.eisEr),
    eisEe: sum((r) => r.eisEe),
    skbbk: sum((r) => r.skbbk),
    epfEr: sum((r) => r.epfEr),
    epfEe: sum((r) => r.epfEe),
  };
}

/** The file's own totals line against the sum of its people (a person the reader missed shows here). */
export function totalsCheck(people: ContribPerson[], fileTotals: ReadPeople['totals']): { key: FigureKey | 'gross'; file: number; read: number }[] {
  const out: { key: FigureKey | 'gross'; file: number; read: number }[] = [];
  for (const k of ['gross', ...FIGURE_KEYS] as const) {
    const t = fileTotals[k as PayKey];
    if (t == null) continue;
    const read = r2(people.reduce((n, p) => n + (p.file?.[k] ?? 0), 0));
    if (Math.abs(read - t) >= 0.01) out.push({ key: k, file: t, read });
  }
  return out;
}

// ---------- Checking what the device sends (server) ----------

const num = (v: unknown, max = 10_000_000): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? r2(v) : null);
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** One person row from the device, checked field by field; throws a plain message on anything that cannot be used. */
export function contribPersonOf(raw: unknown, n: number): ContribPerson {
  const x = (raw ?? {}) as Record<string, unknown>;
  const where = `Person ${n + 1}`;
  const socsoWage = num(x.socsoWage);
  const epfWage = num(x.epfWage);
  if (socsoWage == null || epfWage == null) throw new Error(`${where}: the wages must be amounts from RM0.`);
  const age = x.age == null ? null : typeof x.age === 'number' && Number.isInteger(x.age) && x.age >= 0 && x.age < 120 ? x.age : NaN;
  if (Number.isNaN(age)) throw new Error(`${where}: the age must be a whole number.`);
  const ageFrom = (['ic', 'dob', 'age', 'none'] as const).find((k) => k === x.ageFrom) ?? 'none';
  const nationality = x.nationality === 'FOREIGN' ? 'FOREIGN' : 'MY';
  const id = text(x.id, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
  let file: FileFigures | undefined;
  if (x.file && typeof x.file === 'object') {
    file = {};
    for (const k of [...FIGURE_KEYS, 'gross'] as const) {
      const v = (x.file as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10_000_000) file[k] = r2(v);
    }
  }
  return {
    row: typeof x.row === 'number' && Number.isInteger(x.row) && x.row > 0 ? Math.min(x.row, 1_000_000) : n + 1,
    name: text(x.name, 150),
    id,
    staffNo: x.staffNo ? text(x.staffNo, 30) : undefined,
    nationality,
    age: age as number | null,
    ageFrom,
    socsoWage,
    epfWage,
    skbbkOptOut: x.skbbkOptOut === true && nationality === 'MY',
    include: x.include !== false,
    file,
  };
}

// ---------- Files ----------

/** A person's name in plain letters for the fixed-width file (accents dropped; anything else outside ASCII as "?"). */
function ascii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[^\x20-\x7e]/g, '?');
}
const fit = (s: string, n: number) => ascii(s).slice(0, n).padEnd(n, ' ');
/** An amount in sen, right-justified in 6 (as the converter writes it: at least 4 digits, "  0785" for RM7.85). */
const sen6 = (v: number) => String(Math.round(v * 100)).padStart(4, '0').padStart(6, ' ');

/** The PERKESO employer code: 12 letters and digits (the check digit is PERKESO's to verify). */
export function employerCodeProblem(code: string): string | null {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return 'Give the PERKESO employer code (12 letters and digits, on the ASSIST portal).';
  if (!/^[A-Z0-9]{12}$/.test(c)) return 'The PERKESO employer code is 12 letters and digits, with no spaces or dashes.';
  return null;
}

/**
 * PERKESO's combined SOCSO + EIS contribution text file (format v2.1, 13 Feb 2026; ASSIST 2.0 from June 2026, the only
 * format accepted from 1 October 2026): one 278-character line per person. Employer code 1-12, MyCoID/SSM 13-32, IC or
 * SOCSO foreign worker number 33-44, name 45-194, month MMYYYY 195-200, wages in sen 201-214, SOCSO employer 215-220,
 * SOCSO employee 221-226, EIS employer 227-232, EIS employee 233-238, SKBBK 239-244, two blank fillers 245-278. Lines
 * end in CR LF, as the converter's macro writes them.
 */
export function perkesoTextFile(rows: ContribRow[], o: { employerCode: string; mycoid?: string; period: string }): string {
  const [y, m] = o.period.split('-');
  const lines = rows
    .filter((r) => r.include && r.inPerkeso)
    .map((r) =>
      [
        fit(o.employerCode.trim().toUpperCase(), 12),
        fit((o.mycoid ?? '').trim().toUpperCase(), 20),
        fit(r.id, 12),
        fit(r.name.toUpperCase(), 150),
        `${m}${y}`,
        String(Math.round(r.socsoWage * 100)).padStart(14, ' '),
        sen6(r.socsoEr),
        sen6(r.socsoEe),
        sen6(r.eisEr),
        sen6(r.eisEe),
        sen6(r.skbbk),
        ' '.repeat(14),
        ' '.repeat(20),
      ].join(''),
    );
  return lines.map((l) => `${l}\r\n`).join('');
}

/** The converter's own name for the text file: the employer code, the day and the time. */
export function perkesoTextFileName(employerCode: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${employerCode.trim().toUpperCase() || 'PERKESO'}-${p(at.getDate())}${p(at.getMonth() + 1)}${String(at.getFullYear()).slice(2)}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.txt`;
}

const xmlEsc = (s: string) => ascii(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colLetter = (i: number) => String.fromCharCode(65 + i);
const n2 = (v: number) => String(r2(v));

/** The rate sheet of the converter (hidden "Sheet1"): from each band's lower edge, the shares by Prima's tables. */
function rateSheetRows(period: string, st: StatutorySettings): number[][] {
  const s1 = perkesoRows(st.socso.erRate, st.socso.eeRate, st.socso.wageCap);
  const s2 = perkesoRows(st.socso.olderErRate, 0, st.socso.wageCap);
  const eis = perkesoRows(st.eis.erRate, st.eis.eeRate, st.eis.wageCap);
  const rule = RULES.lindung.value;
  const rate = st.lindung.rate ?? [...rule.rates].reverse().find((r) => r.from <= period)?.rate ?? rule.rates[0].rate;
  const sk = perkesoRows(0, rate, st.lindung.rate != null ? st.lindung.wageCap : rule.wageCeiling);
  const rows = s1.map((r, i) => [i === 0 ? 0 : r2(s1[i - 1].upTo + 0.01), r.er, r.ee, eis[i]?.er ?? 0, eis[i]?.ee ?? 0, s2[i]?.er ?? 0, 0, sk[i]?.ee ?? 0]);
  const last = rows[rows.length - 1];
  rows.push([r2(s1[s1.length - 1].upTo + 0.01), ...last.slice(1)]);
  return rows;
}

/**
 * The converter workbook (.xlsm) filled in, as PERKESO's "Convert Excel To Text File" sheet: "Difference Contribution"
 * with the employer code in C3 and the table "data" (New IC Number, Name, Month, Year, Salary, the four shares, SKBBK,
 * AGE) with the converter's own formulas and their values; the hidden rate sheet "Sheet1"; the Convert button and its
 * macro. Where Prima's answer is not what the converter's formula would give (a foreign worker has no EIS, an opt-out
 * pays no SKBBK, an age not read from an IC), the cell holds Prima's figure instead of the formula.
 */
export function perkesoXlsm(rows: ContribRow[], o: { employerCode: string; period: string; statutory?: StatutorySettings }): Uint8Array {
  const st = o.statutory ?? DEFAULT_STATUTORY;
  const [year, month] = o.period.split('-').map(Number);
  const people = rows.filter((r) => r.include && r.inPerkeso);
  const strings: string[] = [];
  const sIndex = new Map<string, number>();
  const s = (v: string) => {
    if (!sIndex.has(v)) {
      sIndex.set(v, strings.length);
      strings.push(v);
    }
    return sIndex.get(v)!;
  };
  const head = ['New IC Number', 'Name', 'Month', 'Year (YYYY)', 'Salary', 'Socso Employer Share', 'Socso Employee Share', 'EIS Employer Share', 'EIS Employee Share', 'SKBBK', 'AGE'];
  const headStyle = [18, 18, 18, 18, 19, 20, 20, 20, 20, 20, 18];
  const F = {
    G: 'IF(data[[#This Row],[AGE]]&lt;60,(VLOOKUP(data[[#This Row],[Salary]],Sheet1!A:H,2)),(VLOOKUP(data[[#This Row],[Salary]],Sheet1!A:H,6)))',
    H: 'IF(data[[#This Row],[AGE]]&lt;60,(VLOOKUP(data[[#This Row],[Salary]],Sheet1!A:H,3)),(VLOOKUP(data[[#This Row],[Salary]],Sheet1!A:H,7)))',
    I: (r: number) => `IF(DATE('Difference Contribution'!E${r},'Difference Contribution'!D${r},1)&gt;DATE(2017,12,1),IF(data[[#This Row],[AGE]]&lt;18,0,IF(data[[#This Row],[AGE]]&lt;60,(VLOOKUP(data[[#This Row],[Salary]],Sheet1!A:H,4)),0)),0)`,
    J: (r: number) => `IF(DATE('Difference Contribution'!E${r},'Difference Contribution'!D${r},1)&gt;DATE(2017,12,1),IF(data[[#This Row],[AGE]]&lt;18,0,IF(data[[#This Row],[AGE]]&lt;60,(VLOOKUP(data[[#This Row],[Salary]],Sheet1!A:H,5)),0)),0)`,
    K: (r: number) => `IF(DATE('Difference Contribution'!E${r},'Difference Contribution'!D${r},1)&gt;DATE(2026,5,1),VLOOKUP(data[[#This Row],[Salary]],Sheet1!A:H,8),0)`,
    L: (r: number) =>
      `DATEDIF(DATE(IF(LEFT(data[[#This Row],[New IC Number]],2)&gt;TEXT(DATE('Difference Contribution'!E${r},'Difference Contribution'!D${r},1),"YY"),"19"&amp;LEFT(data[[#This Row],[New IC Number]],2),"20"&amp;LEFT(data[[#This Row],[New IC Number]],2)),MID(data[[#This Row],[New IC Number]],3,2),MID(data[[#This Row],[New IC Number]],5,2)),DATE('Difference Contribution'!E${r},'Difference Contribution'!D${r},1),"y")`,
  };
  const calcCols = { G: (_r: number) => F.G, H: (_r: number) => F.H, I: F.I, J: F.J, K: F.K };
  const rowXml: string[] = [];
  rowXml.push(`<row r="1" spans="2:23" s="1" customFormat="1" ht="40.15" customHeight="1" x14ac:dyDescent="0.25"><c r="B1" s="2" t="s"><v>${s('Convert Excel To Text File')}</v></c><c r="F1" s="10"/><c r="S1" s="7"/></row>`);
  rowXml.push(`<row r="3" spans="2:23" x14ac:dyDescent="0.25"><c r="B3" s="3" t="s"><v>${s('Employee Code :')}</v></c><c r="C3" s="4" t="s"><v>${s(o.employerCode.trim().toUpperCase())}</v></c><c r="D3" s="4"/><c r="E3" s="4"/><c r="F3" s="11"/></row>`);
  rowXml.push(`<row r="4" spans="2:23" x14ac:dyDescent="0.25"><c r="S4" s="26"/><c r="T4" s="26"/><c r="U4" s="26"/><c r="V4" s="12"/><c r="W4" s="12"/></row>`);
  rowXml.push(`<row r="5" spans="2:23" ht="45" x14ac:dyDescent="0.25">${head.map((h, i) => `<c r="${colLetter(i + 1)}5" s="${headStyle[i]}" t="s"><v>${s(h)}</v></c>`).join('')}</row>`);
  const last = 5 + Math.max(1, people.length);
  people.forEach((p, i) => {
    const r = 6 + i;
    // The converter's formula gives Prima's answer for a Malaysian with a 12-digit IC whose age is read from it and who
    // pays SKBBK when it is due; for anyone else the cell keeps Prima's figure.
    const icAge = /^\d{12}$/.test(p.id) ? ageFromIc(p.id, o.period) : null;
    const sameAsFormula = p.nationality === 'MY' && icAge != null && icAge === p.age && !p.skbbkOptOut && p.ageFrom === 'ic';
    const cell = (col: keyof typeof calcCols, v: number, style: number) => (sameAsFormula ? `<c r="${col}${r}" s="${style}"><f>${calcCols[col](r)}</f><v>${n2(v)}</v></c>` : `<c r="${col}${r}" s="${style}"><v>${n2(v)}</v></c>`);
    rowXml.push(
      `<row r="${r}" spans="2:12" x14ac:dyDescent="0.25">` +
        `<c r="B${r}" s="31" t="s"><v>${s(p.id)}</v></c>` +
        `<c r="C${r}" s="5" t="s"><v>${s(p.name.toUpperCase())}</v></c>` +
        `<c r="D${r}" s="5"><v>${month}</v></c>` +
        `<c r="E${r}" s="5"><v>${year}</v></c>` +
        `<c r="F${r}" s="13"><v>${n2(p.socsoWage)}</v></c>` +
        cell('G', p.socsoEr, 23) +
        cell('H', p.socsoEe, 23) +
        cell('I', p.eisEr, 23) +
        cell('J', p.eisEe, 23) +
        cell('K', p.skbbk, 24) +
        (sameAsFormula ? `<c r="L${r}" s="25"><f>${F.L(r)}</f><v>${p.age}</v></c>` : `<c r="L${r}" s="25"><v>${p.age ?? 0}</v></c>`) +
        `</row>`,
    );
  });
  if (!people.length) rowXml.push(`<row r="6" spans="2:12" x14ac:dyDescent="0.25"><c r="B6" s="31"/><c r="C6" s="5"/><c r="D6" s="5"/><c r="E6" s="5"/><c r="F6" s="13"/><c r="G6" s="23"/><c r="H6" s="23"/><c r="I6" s="23"/><c r="J6" s="23"/><c r="K6" s="24"/><c r="L6" s="25"/></row>`);
  const NS =
    'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"';
  const sheet1 =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet ${NS}><sheetPr codeName="Sheet1"/><dimension ref="B1:W${last}"/>` +
    '<sheetViews><sheetView showGridLines="0" tabSelected="1" zoomScaleNormal="100" workbookViewId="0"><selection activeCell="B6" sqref="B6"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>' +
    '<cols><col min="1" max="1" width="4.28515625" customWidth="1"/><col min="2" max="2" width="18.7109375" customWidth="1"/><col min="3" max="3" width="30.28515625" customWidth="1"/><col min="4" max="4" width="14.42578125" customWidth="1"/><col min="5" max="5" width="12.5703125" customWidth="1"/><col min="6" max="6" width="12.28515625" style="6" bestFit="1" customWidth="1"/><col min="7" max="11" width="10" customWidth="1"/><col min="12" max="12" width="8.85546875" hidden="1" customWidth="1"/><col min="13" max="13" width="8.85546875" customWidth="1"/><col min="19" max="19" width="8.85546875" style="8"/><col min="23" max="23" width="8.85546875" customWidth="1"/></cols>' +
    `<sheetData>${rowXml.join('')}</sheetData>` +
    '<mergeCells count="1"><mergeCell ref="S4:U4"/></mergeCells><phoneticPr fontId="7" type="noConversion"/>' +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait"/>' +
    '<drawing r:id="rId2"/><legacyDrawing r:id="rId3"/>' +
    '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x14"><controls><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x14"><control shapeId="1026" r:id="rId4" name="Button 2"><controlPr defaultSize="0" print="0" autoFill="0" autoPict="0" macro="[0]!saveText2"><anchor moveWithCells="1" sizeWithCells="1"><from><xdr:col>12</xdr:col><xdr:colOff>600075</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>95250</xdr:rowOff></from><to><xdr:col>15</xdr:col><xdr:colOff>333375</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></to></anchor></controlPr></control></mc:Choice></mc:AlternateContent></controls></mc:Choice></mc:AlternateContent>' +
    '<tableParts count="1"><tablePart r:id="rId5"/></tableParts></worksheet>';
  const rates = rateSheetRows(o.period, st);
  const rateHead = ['Salary', 'Socso Employer Share (J1)', 'Socso Employee Share (J1)', 'EIS Employer Share (J1)', 'EIS Employee Share (J1)', 'Socso Employer Share (J2)', 'Socso Employee Share (J2)', 'SKBBK'];
  const rateHeadStyle = [15, 15, 16, 16, 21, 21, 21, 21];
  const sheet2 =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">' +
    `<sheetPr codeName="Sheet2"/><dimension ref="A1:H${rates.length + 1}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/><cols><col min="1" max="2" width="10.7109375" style="6" customWidth="1"/><col min="3" max="7" width="10.7109375" customWidth="1"/></cols><sheetData>' +
    `<row r="1" spans="1:8" s="14" customFormat="1" ht="45" x14ac:dyDescent="0.25">${rateHead.map((h, i) => `<c r="${colLetter(i)}1" s="${rateHeadStyle[i]}" t="s"><v>${s(h)}</v></c>`).join('')}</row>` +
    rates.map((r, i) => `<row r="${i + 2}" spans="1:8" x14ac:dyDescent="0.25">${r.map((v, k) => `<c r="${colLetter(k)}${i + 2}" s="${k === 0 && i === 0 ? 17 : k === 7 ? 22 : 6}"><v>${n2(v)}</v></c>`).join('')}</row>`).join('') +
    '</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="portrait"/></worksheet>';
  const tableCols = head.map((h, i) => {
    const ids = [11, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
    const dxf = [0, 1, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const formula = i >= 5 ? `<calculatedColumnFormula>${[F.G, F.H, F.I(6), F.J(6), F.K(6), F.L(6)][i - 5]}</calculatedColumnFormula>` : '';
    return `<tableColumn id="${ids[i]}" name="${h}" dataDxfId="${dxf[i]}"${formula ? `>${formula}</tableColumn>` : '/>'}`;
  });
  const table =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="data" displayName="data" ' +
    `ref="B5:L${last}" totalsRowShown="0" headerRowDxfId="11"><tableColumns count="11">${tableCols.join('')}</tableColumns>` +
    '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>';
  const sst =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((v) => `<si><t xml:space="preserve">${xmlEsc(v)}</t></si>`).join('') +
    '</sst>';
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<fileVersion appName="xl" lastEdited="6" lowestEdited="6" rupBuild="14420" codeName="{7A2D7E96-6E34-419A-AE5F-296B3A7E7977}"/><workbookPr codeName="ThisWorkbook"/>' +
    '<bookViews><workbookView xWindow="-105" yWindow="-105" windowWidth="23250" windowHeight="12720"/></bookViews>' +
    '<sheets><sheet name="Difference Contribution" sheetId="1" r:id="rId1"/><sheet name="Sheet1" sheetId="2" state="hidden" r:id="rId2"/></sheets>' +
    `<definedNames><definedName name="myRange">'Difference Contribution'!$B$3:$C$7</definedName></definedNames><calcPr calcId="152511"/></workbook>`;
  const ct =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
    '<Override PartName="/xl/ctrlProps/ctrlProp1.xml" ContentType="application/vnd.ms-excel.controlproperties+xml"/>' +
    '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>' +
    '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = (inner: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
  const enc = new TextEncoder();
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const files: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: enc.encode(ct) },
    {
      name: '_rels/.rels',
      data: enc.encode(rels(rel('rId3', `${R}/extended-properties`, 'docProps/app.xml') + rel('rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml') + rel('rId1', `${R}/officeDocument`, 'xl/workbook.xml'))),
    },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        rels(
          rel('rId1', `${R}/worksheet`, 'worksheets/sheet1.xml') +
            rel('rId2', `${R}/worksheet`, 'worksheets/sheet2.xml') +
            rel('rId3', `${R}/theme`, 'theme/theme1.xml') +
            rel('rId4', `${R}/styles`, 'styles.xml') +
            rel('rId5', `${R}/sharedStrings`, 'sharedStrings.xml') +
            rel('rId7', 'http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin'),
        ),
      ),
    },
    { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
    { name: 'xl/theme/theme1.xml', data: enc.encode(THEME_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet1) },
    { name: 'xl/worksheets/sheet2.xml', data: enc.encode(sheet2) },
    {
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: enc.encode(
        rels(rel('rId3', `${R}/vmlDrawing`, '../drawings/vmlDrawing1.vml') + rel('rId2', `${R}/drawing`, '../drawings/drawing1.xml') + rel('rId5', `${R}/table`, '../tables/table1.xml') + rel('rId4', `${R}/ctrlProp`, '../ctrlProps/ctrlProp1.xml')),
      ),
    },
    { name: 'xl/tables/table1.xml', data: enc.encode(table) },
    { name: 'xl/sharedStrings.xml', data: enc.encode(sst) },
    { name: 'xl/drawings/drawing1.xml', data: enc.encode(DRAWING_XML) },
    { name: 'xl/drawings/vmlDrawing1.vml', data: enc.encode(VML_XML) },
    { name: 'xl/ctrlProps/ctrlProp1.xml', data: enc.encode(CTRL_PROP_XML) },
    { name: 'xl/vbaProject.bin', data: base64Bytes(VBA_PROJECT_B64) },
    {
      name: 'docProps/core.xml',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          `<dc:creator>Prima</dc:creator><cp:lastModifiedBy>Prima</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
      ),
    },
    {
      name: 'docProps/app.xml',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="4" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>2</vt:i4></vt:variant><vt:variant><vt:lpstr>Named Ranges</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="3" baseType="lpstr"><vt:lpstr>Difference Contribution</vt:lpstr><vt:lpstr>Sheet1</vt:lpstr><vt:lpstr>myRange</vt:lpstr></vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>15.0300</AppVersion></Properties>',
      ),
    },
  ];
  return zipFiles(files);
}

function base64Bytes(b64: string): Uint8Array {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (abc.indexOf(clean[i]) << 18) | (abc.indexOf(clean[i + 1]) << 12) | ((abc.indexOf(clean[i + 2]) & 63) << 6) | (abc.indexOf(clean[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const csvCell = (v: string | number) => {
  const t = String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const f2 = (v: number) => v.toFixed(2);

/** Every person with the wages used, each share, the rules applied and the file's own figures: for checking. */
export function contribCheckCsv(rows: ContribRow[], period: string): string {
  const head = ['Row in file', 'Name', 'IC / SOCSO no.', 'Nationality', 'Age', 'In the files', 'In the PERKESO file', 'SOCSO category', 'Wages for SOCSO, EIS, SKBBK', 'SOCSO employer', 'SOCSO employee', 'EIS employer', 'EIS employee', 'SKBBK employee', 'Wages for EPF', 'EPF employer', 'EPF employee', 'Rules applied', 'To fix', 'File differs', 'Wage month'];
  const body = rows.map((r) => [
    r.row,
    r.name,
    r.id,
    r.nationality === 'MY' ? 'Malaysian' : 'Foreign',
    r.age ?? '',
    r.include ? 'Yes' : 'No',
    r.include && r.inPerkeso ? 'Yes' : 'No',
    r.category,
    f2(r.socsoWage),
    f2(r.socsoEr),
    f2(r.socsoEe),
    f2(r.eisEr),
    f2(r.eisEe),
    f2(r.skbbk),
    f2(r.epfWage),
    f2(r.epfEr),
    f2(r.epfEe),
    r.rules.join('; '),
    r.problems.join('; '),
    r.diffs.map((d) => `${FIGURE_LABEL[d.key]}: file ${f2(d.file)}, Prima ${f2(d.prima)}`).join('; '),
    period,
  ]);
  const t = contribTotals(rows);
  body.push(['', 'TOTAL', '', '', '', '', String(t.inPerkeso), '', f2(t.socsoWage), f2(t.socsoEr), f2(t.socsoEe), f2(t.eisEr), f2(t.eisEe), f2(t.skbbk), f2(t.epfWage), f2(t.epfEr), f2(t.epfEe), '', '', '', period]);
  return '﻿' + csv([head, ...body]);
}

/** The EPF list in Form A's columns (IC, name, wages, employer and employee shares): to key in or check on i-Akaun. */
export function contribEpfCsv(rows: ContribRow[], period: string): string {
  const head = ['No. KP / Passport', 'Nama', 'Upah (RM)', 'Caruman Majikan (RM)', 'Caruman Pekerja (RM)', 'Jumlah (RM)', 'Bulan caruman'];
  const list = rows.filter((r) => r.include && r.epfWage > 0);
  const body = list.map((r) => [r.id, r.name, f2(r.epfWage), f2(r.epfEr), f2(r.epfEe), f2(r.epfEr + r.epfEe), period]);
  const t = contribTotals(list);
  body.push(['', 'JUMLAH', f2(t.epfWage), f2(t.epfEr), f2(t.epfEe), f2(t.epfEr + t.epfEe), period]);
  return '﻿' + csv([head, ...body]);
}

// ---------- The record kept (staff payroll, per employer) ----------

export type ContribDownloadKind = 'perkeso_txt' | 'perkeso_xlsm' | 'check_csv' | 'epf_csv';

export interface ContribFileRecord {
  id: string;
  companyId: string;
  /** Wage month, YYYY-MM. */
  period: string;
  fileName: string;
  employerCode: string;
  mycoid: string;
  by: string;
  byId: string;
  at: string;
  totals: ContribTotals;
  status: 'checked' | 'downloaded';
  downloads: { kind: ContribDownloadKind; by: string; byId: string; at: string }[];
  /** The people as counted by the server; null once older records give way to newer ones (totals stay). */
  rows: ContribRow[] | null;
}

/** Keep the newest records, and the people rows of as many of them as fit (oldest give theirs up first). */
export function trimContribRecords(list: ContribFileRecord[]): ContribFileRecord[] {
  const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, CONTRIB_RULE.keepRecords);
  let kept = 0;
  return sorted.map((r) => {
    const n = r.rows?.length ?? 0;
    if (r.rows && kept + n <= CONTRIB_RULE.keepRows) {
      kept += n;
      return r;
    }
    return r.rows ? { ...r, rows: null } : r;
  });
}
