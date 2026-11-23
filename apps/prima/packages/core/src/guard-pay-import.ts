// Guard pay: Add and Import (Fitri, 23 Nov 2026: "in prima, for guard pay, add import button, from csv, excel, pdf and
// other and auto reads the columns and add into our data for guard pay").
//
// What a preparer brings in from outside is only what the pay run already lets them key in by hand, line by line
// (setGuardPayLine): one-off pay (allowances, other pay), one-off deductions with their reason, and the PCB from LHDN's
// e-PCB. Days, hours, overtime, rest days and public holidays worked come from locked attendance, leave and the roster;
// advances and loans come only from their approved records (Advances and loans screen). Those columns are read for a
// side-by-side check only: a difference is shown so the attendance, leave or advance record is put right there, with its
// own approval, never typed over on the pay line (B1b: "the fix is the attendance or leave record, not the pay line").
//
// The file is read on the person's device (import-match.ts finds the header row and matches the columns, English and
// Malay); each row is matched to a guard in the draft run by staff number, IC or name; the server checks every row
// through the same rules as the hand-keyed line and saves the chosen rows all or none, with an audit entry for each line.

import { normHeader, similarity, type AlignField } from './import-align';
import type { GuardPayLine } from './guard-pay';

export const GUARD_PAY_IMPORT_RULE = {
  /** Rows a file may bring in one go (a company's guards in one month, with room to spare). */
  maxRows: 2000,
  /** File size read on the device. */
  maxFileBytes: 8_000_000,
  /** A name given beside a staff number or IC must be at least this close to the name in Prima (0..1). */
  nameCloseness: 0.5,
} as const;

/** The columns the guard pay import reads. */
export type GuardPayImportKey =
  | 'staffNo'
  | 'idFull'
  | 'name'
  | 'allowance'
  | 'otherPay'
  | 'deduction'
  | 'note'
  | 'uniformNo'
  | 'pcb'
  | 'daysWorked'
  | 'otHours'
  | 'restDaysWorked'
  | 'holidaysWorked'
  | 'advance'
  | 'gross'
  | 'net';

/** What a column does: finds the guard, is saved on the pay line, or is only compared with what Prima worked out. */
export type GuardPayImportUse = 'match' | 'write' | 'compare';

export interface GuardPayImportField extends AlignField {
  key: GuardPayImportKey;
  use: GuardPayImportUse;
}

export const GUARD_PAY_IMPORT_FIELDS: GuardPayImportField[] = [
  { key: 'staffNo', use: 'match', label: 'Staff number', type: 'text', words: ['no pekerja', 'employee no', 'no pengawal', 'guard no', 'no staf', 'emp code', 'kod pekerja', 'staff code'] },
  { key: 'idFull', use: 'match', label: 'IC number', type: 'text', words: ['no kp', 'no ic', 'ic', 'mykad', 'kad pengenalan', 'nric', 'ic passport'] },
  { key: 'name', use: 'match', label: 'Name', type: 'text', words: ['nama', 'nama pekerja', 'nama pengawal', 'guard name', 'employee name', 'staff name'] },
  { key: 'allowance', use: 'write', label: 'Allowance (RM)', type: 'number', words: ['elaun', 'allowance', 'allowances', 'jumlah elaun', 'elaun lain', 'elaun tetap', 'elaun syif', 'total allowance'] },
  { key: 'otherPay', use: 'write', label: 'Other pay (RM)', type: 'number', words: ['bayaran lain', 'other pay', 'other earnings', 'pendapatan lain', 'insentif', 'incentive', 'bonus', 'tunggakan', 'arrears', 'tambahan', 'additional pay'] },
  { key: 'deduction', use: 'write', label: 'Deduction (RM)', type: 'number', words: ['potongan', 'deduction', 'deductions', 'potongan lain', 'other deduction', 'other deductions', 'jumlah potongan lain'] },
  { key: 'note', use: 'write', label: 'Reason or note', type: 'text', words: ['catatan', 'sebab', 'reason', 'remarks', 'note', 'keterangan', 'butiran', 'sebab potongan', 'deduction reason'] },
  { key: 'uniformNo', use: 'write', label: 'Uniform number (4th set or later)', type: 'number', words: ['uniform no', 'no uniform', 'set uniform', 'uniform set', 'no pakaian seragam', 'seragam ke'] },
  { key: 'pcb', use: 'write', label: 'PCB (RM)', type: 'number', words: ['pcb', 'mtd', 'potongan cukai bulanan', 'cukai', 'income tax', 'tax deduction', 'potongan cukai'] },
  { key: 'daysWorked', use: 'compare', label: 'Days worked', type: 'number', words: ['hari bekerja', 'days worked', 'hari kerja', 'jumlah hari bekerja', 'working days', 'days', 'hari'] },
  { key: 'otHours', use: 'compare', label: 'Overtime hours', type: 'number', words: ['ot', 'ot hours', 'jam ot', 'lebih masa', 'jam lebih masa', 'overtime', 'overtime hours', 'kerja lebih masa'] },
  { key: 'restDaysWorked', use: 'compare', label: 'Rest days worked', type: 'number', words: ['hari rehat', 'rest day', 'rest days', 'kerja hari rehat', 'rd', 'hari rehat bekerja'] },
  { key: 'holidaysWorked', use: 'compare', label: 'Public holidays worked', type: 'number', words: ['cuti umum', 'public holiday', 'public holidays', 'ph', 'kerja cuti umum', 'hari cuti umum'] },
  { key: 'advance', use: 'compare', label: 'Advance (RM)', type: 'number', words: ['pendahuluan', 'advance', 'pendahuluan gaji', 'salary advance', 'advance salary', 'wang pendahuluan'] },
  { key: 'gross', use: 'compare', label: 'Gross pay (RM)', type: 'number', words: ['gaji kasar', 'gross', 'gross pay', 'gross salary', 'jumlah gaji kasar', 'pendapatan kasar'] },
  { key: 'net', use: 'compare', label: 'Net pay (RM)', type: 'number', words: ['gaji bersih', 'net', 'net pay', 'net salary', 'bersih', 'jumlah dibayar', 'amount paid'] },
];

export type GuardPayCompareKey = 'daysWorked' | 'otHours' | 'restDaysWorked' | 'holidaysWorked' | 'advance' | 'gross' | 'net';

/** One row of a guard pay file (or the Add form), as the device sends it to the server. */
export interface GuardPayImportRow {
  /** The row number in the file as the person sees it (Excel's own numbering), for every message. */
  row: number;
  /** Add form: the guard picked from the run. */
  personId?: string;
  staffNo?: string;
  ic?: string;
  name?: string;
  allowance?: number | null;
  otherPay?: number | null;
  deduction?: number | null;
  note?: string;
  uniformNo?: number | null;
  pcb?: number | null;
  compare?: Partial<Record<GuardPayCompareKey, number>>;
}

/** An amount or a count as offices type it: "RM 1,250.00", "(50)", "1 250", "12.5 jam". Blank and "-" are nothing. */
export function guardPayNumber(raw: unknown): number | null | 'bad' {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 'bad';
  let v = String(raw ?? '').trim();
  if (!v || /^[-–—]+$/.test(v) || /^(nil|tiada|n\/?a)$/i.test(v)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(v)) {
    neg = true;
    v = v.slice(1, -1).trim();
  }
  v = v
    .replace(/^(rm|myr)\s*/i, '')
    .replace(/\s*(rm|myr|jam|hours?|hrs?|h|hari|days?)$/i, '')
    .replace(/[,\s]/g, '');
  if (v.startsWith('-')) {
    neg = !neg;
    v = v.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(v)) return 'bad';
  const n = Number(v) * (neg ? -1 : 1);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 'bad';
}

const MONEY: GuardPayImportKey[] = ['allowance', 'otherPay', 'deduction', 'pcb'];
const COMPARE: GuardPayCompareKey[] = ['daysWorked', 'otHours', 'restDaysWorked', 'holidaysWorked', 'advance', 'gross', 'net'];
const fieldLabel = (k: GuardPayImportKey) => GUARD_PAY_IMPORT_FIELDS.find((f) => f.key === k)?.label ?? k;

/**
 * The rows of a prepared sheet (row 0 the column names, as prepareSheet gives it) with each column's field. Blank rows
 * are left out; a row whose numbers cannot be read, or that names no guard, is a problem the person sees (and may fix or
 * leave out) before anything goes to the server. `rowNo` gives the file's own row number for a body row (0-based).
 */
export function guardPayImportRows(
  table: string[][],
  mapping: (string | null)[],
  rowNo: (bodyIndex: number) => number = (i) => i + 2,
): { rows: GuardPayImportRow[]; problems: { row: number; message: string }[] } {
  const rows: GuardPayImportRow[] = [];
  const problems: { row: number; message: string }[] = [];
  const colOf = (k: GuardPayImportKey) => mapping.findIndex((m) => m === k);
  const cols = Object.fromEntries(GUARD_PAY_IMPORT_FIELDS.map((f) => [f.key, colOf(f.key)])) as Record<GuardPayImportKey, number>;
  const cell = (r: string[], k: GuardPayImportKey) => (cols[k] >= 0 ? String(r[cols[k]] ?? '').trim() : '');
  table.slice(1).forEach((r, i) => {
    const row = rowNo(i);
    if (!r.some((c) => String(c ?? '').trim())) return;
    const out: GuardPayImportRow = { row };
    const bad: string[] = [];
    const staffNo = cell(r, 'staffNo');
    const ic = cell(r, 'idFull');
    const name = cell(r, 'name');
    if (staffNo) out.staffNo = staffNo.slice(0, 40);
    if (ic) out.ic = ic.slice(0, 40);
    if (name) out.name = name.slice(0, 120);
    for (const k of MONEY) {
      const raw = cell(r, k);
      if (!raw) continue;
      const n = guardPayNumber(raw);
      if (n === 'bad') bad.push(`${fieldLabel(k)}: "${raw.slice(0, 30)}" is not an amount`);
      else if (n !== null) (out as unknown as Record<string, number>)[k] = n;
    }
    const uni = cell(r, 'uniformNo');
    if (uni) {
      const n = guardPayNumber(uni.replace(/^(no\.?|set)\s*/i, '').replace(/(st|nd|rd|th)$/i, ''));
      if (n === 'bad' || (n !== null && !Number.isInteger(n))) bad.push(`${fieldLabel('uniformNo')}: "${uni.slice(0, 30)}" is not a number`);
      else if (n !== null) out.uniformNo = n;
    }
    const note = cell(r, 'note');
    if (note) out.note = note.slice(0, 50);
    const compare: Partial<Record<GuardPayCompareKey, number>> = {};
    for (const k of COMPARE) {
      const raw = cell(r, k);
      if (!raw) continue;
      const n = guardPayNumber(raw);
      if (n === 'bad') bad.push(`${fieldLabel(k)}: "${raw.slice(0, 30)}" is not a number`);
      else if (n !== null) compare[k] = n;
    }
    if (Object.keys(compare).length) out.compare = compare;
    const hasValues = MONEY.some((k) => (out as unknown as Record<string, unknown>)[k] !== undefined) || !!out.compare;
    // A line with a name but no figure at all (a sub-heading, a signature line) is not a record.
    if (!hasValues && !bad.length) return;
    if (!out.staffNo && !out.ic && !out.name) bad.push('No staff number, IC or name to find the guard');
    if (bad.length) problems.push({ row, message: bad.join('; ') });
    else rows.push(out);
  });
  return { rows, problems };
}

/** A guard the run can take a row for, with what can identify them. */
export interface GuardPayImportPerson {
  personId: string;
  staffNo: string;
  name: string;
  /** As on the person record (900101-**-***5): matched only on the characters shown. */
  idMasked?: string;
  /** Only when this person may read full identity numbers (the HR database wall). */
  idFull?: string | null;
  /** Kept out of this run while an absence waits for the OD/OGM decision. */
  waiting?: boolean;
}

const staffKey = (s: string) => {
  const v = String(s ?? '').toUpperCase().replace(/[\s.]/g, '');
  return /^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, '') : v;
};
const idKey = (s: string) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
const nameKey = (s: string) => normHeader(String(s ?? '').replace(/\b(bin|binti|bt|b|a\/l|a\/p|al|ap)\b\.?/gi, ' '));

/** The visible characters of a masked number agree with a full one (same length, every shown character the same). */
export function idFitsMasked(full: string, masked: string): boolean {
  const f = idKey(full);
  const m = idKey(masked);
  if (!f || !m || f.length !== m.length) return false;
  let shown = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] === '*') continue;
    shown++;
    if (m[i] !== f[i]) return false;
  }
  return shown >= 4;
}

/** How close two names are (0..1), ignoring case, punctuation and bin/binti. */
export function guardNameCloseness(a: string, b: string): number {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return similarity(x, y);
}

/**
 * Which guard a row is for: the staff number first, else the IC, else the name (exact, then a single close one). When a
 * name is given beside a number it must be close to the guard's name in Prima, so a wrong number never pays the wrong
 * person.
 */
export function matchGuardPayRow(r: GuardPayImportRow, people: GuardPayImportPerson[]): { person: GuardPayImportPerson } | { error: string } {
  const pick = (p: GuardPayImportPerson, by: string): { person: GuardPayImportPerson } | { error: string } => {
    if (r.name && guardNameCloseness(r.name, p.name) < GUARD_PAY_IMPORT_RULE.nameCloseness)
      return { error: `${by} is ${p.staffNo} ${p.name} in Prima, not "${r.name}". Check the row.` };
    if (p.waiting) return { error: `${p.staffNo} ${p.name} is not in this run: their absence waits for the OD/OGM decision and they are paid in a later run.` };
    return { person: p };
  };
  if (r.personId) {
    const p = people.find((x) => x.personId === r.personId);
    return p ? pick(p, 'The guard') : { error: 'This guard is not in this run.' };
  }
  if (r.staffNo) {
    const k = staffKey(r.staffNo);
    const hits = people.filter((p) => staffKey(p.staffNo) === k);
    if (hits.length === 1) return pick(hits[0], `Staff number ${r.staffNo}`);
    if (hits.length > 1) return { error: `Staff number ${r.staffNo} belongs to more than one guard in this run.` };
    if (!r.ic && !r.name) return { error: `No guard or officer in this run has staff number ${r.staffNo}.` };
  }
  if (r.ic) {
    const full = people.filter((p) => p.idFull && idKey(p.idFull) === idKey(r.ic!));
    const hits = full.length ? full : people.filter((p) => p.idMasked && idFitsMasked(r.ic!, p.idMasked));
    if (hits.length === 1) return pick(hits[0], `IC ${r.ic}`);
    if (hits.length > 1 && r.name) {
      const named = hits.filter((p) => nameKey(p.name) === nameKey(r.name!));
      if (named.length === 1) return pick(named[0], `IC ${r.ic}`);
    }
    if (hits.length > 1) return { error: `IC ${r.ic} fits more than one guard in this run. Add the staff number.` };
    if (!r.name) return { error: `No guard or officer in this run has IC ${r.ic}.` };
  }
  if (r.name) {
    const exact = people.filter((p) => nameKey(p.name) === nameKey(r.name!));
    if (exact.length === 1) return pick(exact[0], 'The name');
    if (exact.length > 1) return { error: `More than one guard in this run is called "${r.name}". Add the staff number.` };
    const close = people.map((p) => ({ p, s: guardNameCloseness(r.name!, p.name) })).filter((x) => x.s >= 0.85).sort((a, b) => b.s - a.s);
    if (close.length === 1 || (close.length > 1 && close[0].s - close[1].s >= 0.08)) return pick(close[0].p, 'The name');
    if (close.length > 1) return { error: `"${r.name}" is close to more than one guard in this run. Add the staff number.` };
    return { error: `No guard or officer in this run is called "${r.name}".` };
  }
  return { error: 'No staff number, IC or name to find the guard.' };
}

/** A one-off item on a pay line, as setGuardPayLine keeps it. */
export interface GuardPayExtra {
  label: string;
  amount: number;
  uniformNo?: number;
}

/**
 * The one-off items a row brings: an allowance and other pay as pay, a deduction (with its reason) as a minus amount.
 * Each label says where it came from, so importing the same file again replaces the same items instead of adding them.
 */
export function guardPayImportItems(r: GuardPayImportRow): { items: GuardPayExtra[]; errors: string[] } {
  const items: GuardPayExtra[] = [];
  const errors: string[] = [];
  const note = (r.note ?? '').trim();
  const add = (kind: string, amount: number, uniformNo?: number) => items.push({ label: (note ? `${kind}: ${note}` : `${kind} (imported)`).slice(0, 60), amount, ...(uniformNo ? { uniformNo } : {}) });
  if (r.allowance != null && r.allowance !== 0) {
    if (r.allowance < 0) errors.push('An allowance is pay: put a deduction in the Deduction column.');
    else add('Allowance', r.allowance);
  }
  if (r.otherPay != null && r.otherPay !== 0) {
    if (r.otherPay < 0) errors.push('Other pay is pay: put a deduction in the Deduction column.');
    else add('Other pay', r.otherPay);
  }
  if (r.deduction != null && r.deduction !== 0) {
    // A deduction is written either way round in offices' sheets ("50" or "-50" under Potongan): it is taken off.
    if (!note) errors.push('Give the reason for the deduction (a Reason or Catatan column).');
    else add('Deduction', -Math.abs(r.deduction), r.uniformNo ?? undefined);
  }
  return { items, errors };
}

/** The line's items after the import: an item with the same label is replaced, the line's other items stay. */
export function mergeGuardPayExtras(existing: GuardPayExtra[], imported: GuardPayExtra[]): GuardPayExtra[] {
  const labels = new Set(imported.map((x) => x.label.trim().toLowerCase()));
  return [...existing.filter((x) => !labels.has(x.label.trim().toLowerCase())), ...imported];
}

/** The figures of the file Prima works out itself, side by side: a difference is fixed at its own record, not here. */
export function guardPayImportDiffs(compare: GuardPayImportRow['compare'], line: GuardPayLine): string[] {
  if (!compare) return [];
  const out: string[] = [];
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  const rm = (n: number) => `RM${n.toFixed(2)}`;
  const check = (k: GuardPayCompareKey, prima: number, money: boolean, fix: string) => {
    const v = compare[k];
    if (v === undefined || near(v, prima, money ? 0.01 : 0.05)) return;
    out.push(`${fieldLabel(k)}: file ${money ? rm(v) : v}, Prima ${money ? rm(prima) : prima}. ${fix}`);
  };
  const att = 'Correct the attendance or leave record (with its own approval), then recalculate.';
  check('daysWorked', line.daysWorked, false, att);
  check('otHours', line.otHours, false, att);
  check('restDaysWorked', line.restDaysWorked, false, att);
  check('holidaysWorked', line.holidaysWorked, false, 'Check the guard public holiday list and the attendance.');
  check('advance', line.advance ?? 0, true, 'Advances come only from the Advances screen (set by the OM, approved by the OD or OGM).');
  check('gross', line.gross, true, 'Compare the payslip item by item.');
  check('net', line.net, true, 'Compare the payslip item by item.');
  return out;
}

/** Read a row the browser sent: only the fields above, numbers as numbers, text trimmed and capped. */
export function cleanGuardPayImportRow(raw: unknown, index: number): GuardPayImportRow {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
  };
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const row = Number(o.row);
  const out: GuardPayImportRow = { row: Number.isInteger(row) && row > 0 && row < 1_000_000 ? row : index + 1 };
  const pid = text(o.personId, 120);
  if (pid) out.personId = pid;
  const s = text(o.staffNo, 40);
  if (s) out.staffNo = s;
  const ic = text(o.ic, 40);
  if (ic) out.ic = ic;
  const n = text(o.name, 120);
  if (n) out.name = n;
  for (const k of ['allowance', 'otherPay', 'deduction', 'pcb', 'uniformNo'] as const) {
    const v = num(o[k]);
    if (v !== undefined) out[k] = v;
  }
  const note = text(o.note, 50);
  if (note) out.note = note;
  if (o.compare && typeof o.compare === 'object') {
    const c: Partial<Record<GuardPayCompareKey, number>> = {};
    for (const k of COMPARE) {
      const v = num((o.compare as Record<string, unknown>)[k]);
      if (typeof v === 'number') c[k] = v;
    }
    if (Object.keys(c).length) out.compare = c;
  }
  return out;
}
