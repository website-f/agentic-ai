// P90 (Fitri, 9 Nov 2026): "when I upload this report (from another third-party software they're migrating from) make it
// so I can upload these timesheets and record the whole record from it and summarise it; check the columns, the dates
// must be correct."
//
// Three pieces beside the monthly PDF reader (apps/api/src/attendance-pdf.ts and attendance-reports.ts):
//  1. attendanceChecks: what to look at before saving: a date outside the report's period, the same day twice, a printed
//     weekday that is not that date's weekday (the sign of a day and month swapped), an out time earlier than the in time
//     (read as a night shift ending the next day), a clock-in with no clock-out, days of the period with no row.
//  2. attendanceFromTable: the same timesheet as an Excel or CSV export (one row per person per day), read in the browser.
//     The columns are found by their headings (English and Malay); the date column's order is worked out from the whole
//     column (a day above 12 settles it) and never guessed row by row, so 03-04 is never read as 4 March in one row and
//     3 April in the next.
//  3. parsedReportFromJson: the server's strict check of a timesheet read in the browser, before it is previewed or saved.
import {
  ATTENDANCE_ALLOWANCE_KEYS,
  totalsAddUp,
  type AttendanceAllowances,
  type OtHours,
  type ParsedAttendanceReport,
  type ReportDay,
  type ReportEmployee,
} from './attendance-reports';
import { excelSerialDate } from './import-align';
import type { IsoDate } from './types';

// ---------------------------------------------------------------- 1. checks before saving

export type AttendanceCheckKind = 'outside_period' | 'duplicate_day' | 'weekday_mismatch' | 'overnight' | 'missing_out' | 'missing_in' | 'missing_days' | 'totals_mismatch';

/** What each check means, in plain words; 'info' checks are normal on some reports, 'warn' ones need a look. */
export const ATTENDANCE_CHECK_LABEL: Record<AttendanceCheckKind, { label: string; tone: 'warn' | 'info' }> = {
  outside_period: { label: 'Dates outside the report period', tone: 'warn' },
  duplicate_day: { label: 'Same day twice for one person', tone: 'warn' },
  weekday_mismatch: { label: 'Printed day does not match the date', tone: 'warn' },
  totals_mismatch: { label: 'Printed totals do not add up', tone: 'warn' },
  missing_out: { label: 'Clock-in with no clock-out', tone: 'info' },
  missing_in: { label: 'Clock-out with no clock-in', tone: 'info' },
  overnight: { label: 'Out earlier than in (night shift ending the next day)', tone: 'info' },
  missing_days: { label: 'Days of the period with no row (joined or left in the month?)', tone: 'info' },
};

export interface AttendanceCheckExample {
  kind: AttendanceCheckKind;
  name: string;
  empCode: string | null;
  date: IsoDate | null;
  detail: string;
}

export interface AttendanceChecks {
  /** The first and last date on any row. */
  from: IsoDate | null;
  to: IsoDate | null;
  /** The printed period (the most common one), when the report prints one. */
  periodFrom: IsoDate | null;
  periodTo: IsoDate | null;
  counts: Record<AttendanceCheckKind, number>;
  /** A few rows of each kind to look at (at most 8 per kind). */
  examples: AttendanceCheckExample[];
  /** No 'warn' check found anything. */
  clean: boolean;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** Weekday of an ISO date, as the reports print it (Mon .. Sun). */
export function weekdayOfIso(iso: IsoDate): string {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}
const WEEKDAY_WORDS: Record<string, string> = {
  SUN: 'SUN', SUNDAY: 'SUN', AHAD: 'SUN', AHD: 'SUN',
  MON: 'MON', MONDAY: 'MON', ISNIN: 'MON', ISN: 'MON',
  TUE: 'TUE', TUES: 'TUE', TUESDAY: 'TUE', SELASA: 'TUE', SEL: 'TUE',
  WED: 'WED', WEDNESDAY: 'WED', RABU: 'WED', RAB: 'WED',
  THU: 'THU', THUR: 'THU', THURS: 'THU', THURSDAY: 'THU', KHAMIS: 'THU', KHA: 'THU',
  FRI: 'FRI', FRIDAY: 'FRI', JUMAAT: 'FRI', JUMAT: 'FRI', JUM: 'FRI',
  SAT: 'SAT', SATURDAY: 'SAT', SABTU: 'SAT', SAB: 'SAT',
};
/** A printed weekday word as MON..SUN, or null when it is not one. */
export function weekdayWord(s: string | null | undefined): string | null {
  return WEEKDAY_WORDS[(s ?? '').trim().toUpperCase().replace(/\.$/, '')] ?? null;
}

function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function attendanceChecks(parsed: Pick<ParsedAttendanceReport, 'employees'>): AttendanceChecks {
  const counts = Object.fromEntries(Object.keys(ATTENDANCE_CHECK_LABEL).map((k) => [k, 0])) as Record<AttendanceCheckKind, number>;
  const examples: AttendanceCheckExample[] = [];
  const add = (kind: AttendanceCheckKind, e: ReportEmployee, date: IsoDate | null, detail: string) => {
    counts[kind]++;
    if (examples.filter((x) => x.kind === kind).length < 8) examples.push({ kind, name: e.name, empCode: e.empCode, date, detail });
  };
  let from: IsoDate | null = null;
  let to: IsoDate | null = null;
  const periods = new Map<string, number>();
  for (const e of parsed.employees) {
    if (e.periodFrom && e.periodTo) periods.set(`${e.periodFrom}|${e.periodTo}`, (periods.get(`${e.periodFrom}|${e.periodTo}`) ?? 0) + 1);
    const seen = new Map<IsoDate, number>();
    for (const d of e.days) {
      if (!from || d.date < from) from = d.date;
      if (!to || d.date > to) to = d.date;
      seen.set(d.date, (seen.get(d.date) ?? 0) + 1);
      if (e.periodFrom && e.periodTo && (d.date < e.periodFrom || d.date > e.periodTo)) add('outside_period', e, d.date, `${d.date} is outside ${e.periodFrom} to ${e.periodTo}`);
      const wd = weekdayWord(d.weekday);
      if (wd && wd !== weekdayOfIso(d.date)) add('weekday_mismatch', e, d.date, `printed ${d.weekday}, but ${d.date} is a ${weekdayOfIso(d.date)}`);
      if (d.in && d.out && d.out < d.in) add('overnight', e, d.date, `in ${d.in}, out ${d.out}`);
      if (d.in && !d.out && !d.reason) add('missing_out', e, d.date, `in ${d.in}, no out`);
      if (!d.in && d.out && !d.reason) add('missing_in', e, d.date, `out ${d.out}, no in`);
    }
    for (const [date, n] of seen) if (n > 1) add('duplicate_day', e, date, `${n} rows for ${date}`);
    if (e.periodFrom && e.periodTo && e.days.length) {
      const missing = datesBetween(e.periodFrom, e.periodTo).filter((d) => !seen.has(d));
      if (missing.length) add('missing_days', e, missing[0], `${missing.length} day${missing.length === 1 ? '' : 's'} with no row, from ${missing[0]}`);
    }
    if (totalsAddUp(e) === false) add('totals_mismatch', e, null, 'the printed totals differ from the sum of the day rows');
  }
  const period = [...periods.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split('|') ?? [null, null];
  const clean = (Object.keys(counts) as AttendanceCheckKind[]).every((k) => ATTENDANCE_CHECK_LABEL[k].tone !== 'warn' || counts[k] === 0);
  return { from, to, periodFrom: period[0] ?? null, periodTo: period[1] ?? null, counts, examples, clean };
}

// ---------------------------------------------------------------- 2. Excel or CSV timesheets

export type TimesheetField =
  | 'company' | 'empCode' | 'name' | 'department' | 'designation' | 'date' | 'weekday' | 'in' | 'out' | 'shift' | 'normal' | 'actual' | 'late' | 'early'
  | 'ot10' | 'ot15' | 'ot20' | 'ot30' | 'flat' | 'attendance' | 'shiftAllowance' | 'meal' | 'transport' | 'other1' | 'other2' | 'health' | 'reason';

/** Headings each field is known by (lower case, spaces squeezed), English and Malay. "Shift" is the shift code; the money is "Shift allowance". */
const HEADINGS: [TimesheetField, string[]][] = [
  ['company', ['company', 'syarikat', 'company name', 'nama syarikat']],
  ['empCode', ['emp code', 'empcode', 'employee code', 'emp no', 'employee no', 'employee number', 'staff no', 'staff number', 'staff id', 'employee id', 'emp id', 'no pekerja', 'nombor pekerja', 'id pekerja', 'kod pekerja', 'badge', 'badge no']],
  ['name', ['name', 'nama', 'employee name', 'staff name', 'nama pekerja', 'full name']],
  ['department', ['department', 'dept', 'jabatan', 'bahagian', 'site', 'location', 'lokasi']],
  ['designation', ['designation', 'jawatan', 'position', 'job title']],
  ['date', ['date', 'tarikh', 'work date', 'attendance date', 'tarikh kehadiran']],
  ['weekday', ['day', 'hari', 'weekday']],
  ['in', ['in', 'time in', 'clock in', 'check in', 'masuk', 'waktu masuk', 'masa masuk', 'in time']],
  ['out', ['out', 'time out', 'clock out', 'check out', 'keluar', 'waktu keluar', 'masa keluar', 'out time']],
  ['shiftAllowance', ['shift allowance', 'shift allow', 'elaun syif']],
  ['shift', ['shift', 'syif', 'shift code']],
  ['normal', ['normal', 'normal hours', 'normal hrs', 'jam normal', 'normal h']],
  ['actual', ['actual', 'actual hours', 'actual hrs', 'worked', 'worked hours', 'hours worked', 'jam bekerja', 'jam kerja', 'total hours']],
  ['late', ['late', 'lewat', 'late hours', 'late hrs', 'late min', 'late mins', 'late minutes', 'minit lewat']],
  ['early', ['early out', 'earlyout', 'early', 'balik awal', 'early hours', 'early min', 'early mins', 'early minutes', 'early leave']],
  ['ot10', ['ot 1.0', 'ot1.0', 'ot 1', 'ot x1.0', '1.0']],
  ['ot15', ['ot 1.5', 'ot1.5', 'ot x1.5', '1.5']],
  ['ot20', ['ot 2.0', 'ot2.0', 'ot 2', 'ot x2.0', '2.0']],
  ['ot30', ['ot 3.0', 'ot3.0', 'ot 3', 'ot x3.0', '3.0']],
  ['flat', ['flat', 'flat allowance', 'flat allow']],
  ['attendance', ['attd', 'attendance allowance', 'attd allowance', 'attd allow', 'elaun kehadiran']],
  ['meal', ['meal', 'meal allowance', 'meal allow', 'elaun makan']],
  ['transport', ['tran', 'transport', 'transport allowance', 'tran allow', 'elaun pengangkutan']],
  ['other1', ['other', 'other allowance', 'other 1', 'other1', 'elaun lain']],
  ['other2', ['other 2', 'other2']],
  ['health', ['health', 'health allowance', 'elaun kesihatan']],
  ['reason', ['reason', 'remark', 'remarks', 'catatan', 'sebab', 'code', 'leave code', 'status', 'kod']],
];

const squeeze = (s: string) => s.toLowerCase().replace(/[_\-()/:]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();

export interface TimesheetColumn {
  index: number;
  heading: string;
  field: TimesheetField;
}

/** Which column holds what, from one heading row. Unknown headings are left out. */
export function timesheetColumns(header: string[]): TimesheetColumn[] {
  const out: TimesheetColumn[] = [];
  const used = new Set<string>();
  header.forEach((h, index) => {
    const k = squeeze(h ?? '');
    if (!k) return;
    let field: TimesheetField | null = null;
    for (const [f, names] of HEADINGS)
      if (names.includes(k) && !used.has(f)) {
        field = f;
        break;
      }
    // "Late (min)", "OT 1.5 (hrs)": try again without the unit.
    if (!field) {
      const bare = squeeze(k.replace(/\b(hrs?|hours?|mins?|minutes?|minit|jam|rm)\b/g, ''));
      for (const [f, names] of HEADINGS)
        if (bare && names.includes(bare) && !used.has(f)) {
          field = f;
          break;
        }
    }
    if (!field || used.has(field)) return;
    used.add(field);
    out.push({ index, heading: h, field });
  });
  return out;
}

export type DateOrder = 'dmy' | 'mdy';

/** Whether a column of a/b/yyyy dates is day first or month first, from the whole column. 'mixed' when it says both. */
export function timesheetDateOrderOf(values: string[]): { order: DateOrder; assumed: boolean } | { order: 'mixed'; assumed: false } {
  let dayFirst = false;
  let monthFirst = false;
  for (const v of values) {
    const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(v ?? '');
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst = true;
    if (b > 12 && a <= 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) return { order: 'mixed', assumed: false };
  if (monthFirst) return { order: 'mdy', assumed: false };
  // Malaysia writes the day first; with no day above 12 in the whole column it is assumed, and the preview says so.
  return { order: 'dmy', assumed: !dayFirst };
}

const MONTH_WORDS: Record<string, number> = { jan: 1, feb: 2, mar: 3, mac: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogo: 8, ogos: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12 };

function iso(y: number, m: number, d: number): IsoDate | null {
  if (y < 100) y += 2000;
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

/** One date cell to ISO, with the column's order. Null when it is not a real date. */
export function timesheetDate(raw: string, order: DateOrder): IsoDate | null {
  const v = String(raw ?? '').trim().replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(\s?[ap]m)?(Z|[+-]\d{2}:?\d{2})?$/i, '');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(v);
  if (m) return order === 'mdy' ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s\-/.]*([a-z]{3,9})[\s\-/.,]*(\d{2}|\d{4})$/i.exec(v);
  if (m) {
    const mo = MONTH_WORDS[m[2].toLowerCase().slice(0, 4)] ?? MONTH_WORDS[m[2].toLowerCase().slice(0, 3)];
    return mo ? iso(+m[3], mo, +m[1]) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(v)) return excelSerialDate(Number(v));
  return null;
}

/** A clock time to HH:MM: "8.28", "08:28", "8:28 PM", an Excel day fraction (0.35). "0.00" and blanks are no time. */
export function timesheetTime(raw: string): string | null | undefined {
  const v = String(raw ?? '').trim();
  if (!v || v === '-' || v === '--') return null;
  let m = /^(\d{1,2})[.:](\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(v);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[3]?.toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h === 0 && min === 0 && !ap) return null;
    if (h > 23 || min > 59) return undefined;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = /^0?\.(\d+)$/.exec(v);
  if (m) {
    const total = Math.round(Number(`0.${m[1]}`) * 24 * 60);
    if (total <= 0 || total >= 24 * 60) return null;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  // A full date and time in one cell (an Excel export): the time part.
  m = /[T\s](\d{1,2}):(\d{2})/.exec(v);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) return Number(m[1]) === 0 && Number(m[2]) === 0 ? null : `${m[1].padStart(2, '0')}:${m[2]}`;
  return undefined;
}

function number(raw: string): number | null {
  const v = String(raw ?? '').trim().replace(/^RM\s*/i, '').replace(/,/g, '');
  if (!v || v === '-') return 0;
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
}

export interface TimesheetRead {
  report: ParsedAttendanceReport;
  columns: TimesheetColumn[];
  headerRow: number;
  rows: number;
  /** Data rows left out, with the reason (the first 50). */
  skipped: { row: number; reason: string }[];
  skippedCount: number;
  dateOrder: DateOrder;
  /** True when no date in the file had a day above 12, so day first was assumed (Malaysia's way). */
  dateOrderAssumed: boolean;
}

export class TimesheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimesheetError';
  }
}

const zeroAllow = (): AttendanceAllowances => Object.fromEntries(ATTENDANCE_ALLOWANCE_KEYS.map((k) => [k, 0])) as AttendanceAllowances;
const MAX_ROWS = 60_000;

/**
 * A timesheet export (one row per person per day) to the same shape the PDF reader gives. `company` names the company
 * when the file has no company column. Throws TimesheetError when the columns cannot be found or the dates disagree.
 */
export function attendanceFromTable(grid: string[][], opts: { company?: string; title?: string } = {}): TimesheetRead {
  // The heading row: the first of the top 20 with a date column and a name or employee code column.
  let headerRow = -1;
  let columns: TimesheetColumn[] = [];
  for (let r = 0; r < Math.min(20, grid.length); r++) {
    const c = timesheetColumns(grid[r]);
    if (c.some((x) => x.field === 'date') && c.some((x) => x.field === 'name' || x.field === 'empCode') && c.length >= 3) {
      headerRow = r;
      columns = c;
      break;
    }
  }
  if (headerRow < 0)
    throw new TimesheetError('No heading row with a Date column and a Name or Employee number column was found in the first 20 rows. Export the timesheet with its column headings.');
  const col = (f: TimesheetColumn['field']) => columns.find((c) => c.field === f)?.index ?? -1;
  const at = (row: string[], f: TimesheetColumn['field']) => {
    const i = col(f);
    return i >= 0 ? String(row[i] ?? '').trim() : '';
  };
  const lateMinutes = /min|minit/i.test(columns.find((c) => c.field === 'late')?.heading ?? '');
  const earlyMinutes = /min|minit/i.test(columns.find((c) => c.field === 'early')?.heading ?? '');
  const body = grid.slice(headerRow + 1, headerRow + 1 + MAX_ROWS);
  if (grid.length - headerRow - 1 > MAX_ROWS) throw new TimesheetError(`This file has more than ${MAX_ROWS.toLocaleString('en-MY')} rows. Export one month at a time.`);
  const order = timesheetDateOrderOf(body.map((r) => at(r, 'date')));
  if (order.order === 'mixed')
    throw new TimesheetError('The Date column has dates written day first in some rows and month first in others, so no date can be trusted. Export the dates in one format (for example 31-01-2026).');
  const skipped: TimesheetRead['skipped'] = [];
  let skippedCount = 0;
  const skip = (row: number, reason: string) => {
    skippedCount++;
    if (skipped.length < 50) skipped.push({ row, reason });
  };
  const byKey = new Map<string, ReportEmployee>();
  body.forEach((row, i) => {
    const line = headerRow + 2 + i;
    const rawDate = at(row, 'date');
    const name = at(row, 'name');
    const code = at(row, 'empCode') || null;
    if (!rawDate && !name && !code) return;
    if (/^(total|jumlah|grand total|sub ?total)\b/i.test(name || code || rawDate)) return;
    const date = timesheetDate(rawDate, order.order as DateOrder);
    if (!date) return skip(line, rawDate ? `"${rawDate.slice(0, 20)}" is not a date on the calendar` : 'no date');
    if (!name && !code) return skip(line, 'no name or employee number');
    const tin = timesheetTime(at(row, 'in'));
    const tout = timesheetTime(at(row, 'out'));
    if (tin === undefined || tout === undefined) return skip(line, 'a clock time that is not a time');
    const nums: Record<string, number | null> = {};
    for (const f of ['normal', 'actual', 'late', 'early', 'ot10', 'ot15', 'ot20', 'ot30', 'flat', 'attendance', 'shiftAllowance', 'meal', 'transport', 'other1', 'other2', 'health'] as const) {
      nums[f] = col(f) >= 0 ? number(at(row, f)) : 0;
      if (nums[f] === null) return skip(line, `the ${columns.find((c) => c.field === f)?.heading ?? f} value is not a number`);
    }
    const allow = zeroAllow();
    for (const k of ATTENDANCE_ALLOWANCE_KEYS) allow[k] = (k === 'shift' ? nums.shiftAllowance : nums[k])!;
    const company = at(row, 'company') || opts.company || '';
    const key = `${company}\u0000${(code ?? '').toUpperCase() || name.toUpperCase()}`;
    let e = byKey.get(key);
    if (!e) {
      e = { company, empCode: code, name, designation: at(row, 'designation') || null, department: at(row, 'department') || null, periodFrom: null, periodTo: null, pages: [], days: [], totals: null, monthly: null };
      byKey.set(key, e);
    }
    if (!e.name && name) e.name = name;
    const day: ReportDay = {
      date,
      weekday: at(row, 'weekday') || null,
      clocks: [],
      in: tin,
      out: tout,
      shift: at(row, 'shift') || null,
      normalH: nums.normal!,
      lateH: lateMinutes ? Math.round((nums.late! / 60) * 100) / 100 : nums.late!,
      earlyH: earlyMinutes ? Math.round((nums.early! / 60) * 100) / 100 : nums.early!,
      actualH: nums.actual!,
      ot: [nums.ot10!, nums.ot15!, nums.ot20!, nums.ot30!] as OtHours,
      allow,
      reason: at(row, 'reason') || null,
      page: line,
    };
    e.days.push(day);
  });
  const employees = [...byKey.values()];
  if (!employees.length) throw new TimesheetError('No timesheet rows could be read from this file.');
  // The period: the whole months the rows fall in (a timesheet export prints no period line).
  const all = employees.flatMap((e) => e.days.map((d) => d.date)).sort();
  const first = all[0];
  const last = all[all.length - 1];
  const periodFrom = `${first.slice(0, 7)}-01`;
  const [y, m] = last.slice(0, 7).split('-').map(Number);
  const periodTo = `${last.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  for (const e of employees) {
    e.periodFrom = periodFrom;
    e.periodTo = periodTo;
    e.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  return {
    report: { title: opts.title ?? 'Timesheet (Excel or CSV)', pages: 0, employees, unreadable: [], warnings: skipped.map((s) => ({ page: s.row, reason: `Row ${s.row} was left out: ${s.reason}.` })) },
    columns,
    headerRow: headerRow + 1,
    rows: body.length,
    skipped,
    skippedCount,
    dateOrder: order.order as DateOrder,
    dateOrderAssumed: order.assumed,
  };
}

// ---------------------------------------------------------------- 3. the server's check of a timesheet read in the browser

const LIMITS = { employees: 5000, days: 400, text: 200, reason: 60, rows: 200_000 };

function str(v: unknown, max: number, what: string, nullable: true): string | null;
function str(v: unknown, max: number, what: string, nullable?: false): string;
function str(v: unknown, max: number, what: string, nullable = false): string | null {
  if (v == null || v === '') {
    if (nullable) return null;
    if (v === '') return '';
    throw new TimesheetError(`${what} is missing.`);
  }
  if (typeof v !== 'string' || v.length > max) throw new TimesheetError(`${what} is not valid.`);
  return v;
}
function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 100_000) throw new TimesheetError(`${what} is not a number.`);
  return Math.round(v * 100) / 100;
}
function isoDate(v: unknown, what: string, nullable = false): IsoDate | null {
  if (v == null && nullable) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new TimesheetError(`${what} is not a date.`);
  const t = Date.parse(`${v}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v) throw new TimesheetError(`${what} is not on the calendar.`);
  return v;
}
function hhmm(v: unknown, what: string): string | null {
  if (v == null) return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new TimesheetError(`${what} is not a time.`);
  return v;
}

/** A timesheet read in the browser, checked field by field. Anything unexpected is refused, never repaired. */
export function parsedReportFromJson(x: unknown): ParsedAttendanceReport {
  const o = (x && typeof x === 'object' ? x : null) as Record<string, unknown> | null;
  if (!o || !Array.isArray(o.employees)) throw new TimesheetError('The timesheet did not arrive in the expected shape. Choose the file again.');
  if (o.employees.length > LIMITS.employees) throw new TimesheetError(`At most ${LIMITS.employees} people in one file.`);
  let rows = 0;
  const employees: ReportEmployee[] = o.employees.map((raw, i) => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const at = `Person ${i + 1}`;
    if (!Array.isArray(e.days) || e.days.length > LIMITS.days) throw new TimesheetError(`${at}: the days are not valid.`);
    rows += e.days.length;
    if (rows > LIMITS.rows) throw new TimesheetError('Too many rows in one file. Export one month at a time.');
    const days: ReportDay[] = e.days.map((rd, j) => {
      const d = (rd && typeof rd === 'object' ? rd : {}) as Record<string, unknown>;
      const w = `${at}, row ${j + 1}`;
      const ot = Array.isArray(d.ot) && d.ot.length === 4 ? (d.ot.map((h, k) => num(h, `${w} OT ${k}`)) as OtHours) : null;
      if (!ot) throw new TimesheetError(`${w}: the overtime is not valid.`);
      const a = (d.allow && typeof d.allow === 'object' ? d.allow : null) as Record<string, unknown> | null;
      if (!a) throw new TimesheetError(`${w}: the allowances are not valid.`);
      const allow = zeroAllow();
      for (const k of ATTENDANCE_ALLOWANCE_KEYS) allow[k] = num(a[k] ?? 0, `${w} ${k}`);
      const clocks = Array.isArray(d.clocks) ? d.clocks.slice(0, 8).map((c, k) => hhmm(c, `${w} clock ${k}`)).filter((c): c is string => !!c) : [];
      return {
        date: isoDate(d.date, `${w} date`)!,
        weekday: str(d.weekday, 12, `${w} day`, true),
        clocks,
        in: hhmm(d.in, `${w} in`),
        out: hhmm(d.out, `${w} out`),
        shift: str(d.shift, 40, `${w} shift`, true),
        normalH: num(d.normalH, `${w} normal`),
        lateH: num(d.lateH, `${w} late`),
        earlyH: num(d.earlyH, `${w} early out`),
        actualH: num(d.actualH, `${w} actual`),
        ot,
        allow,
        reason: str(d.reason, LIMITS.reason, `${w} reason`, true),
        page: Number.isSafeInteger(d.page) && (d.page as number) >= 0 ? (d.page as number) : 0,
      };
    });
    return {
      company: str(e.company ?? '', LIMITS.text, `${at} company`) ?? '',
      empCode: str(e.empCode, 60, `${at} employee number`, true),
      name: str(e.name ?? '', LIMITS.text, `${at} name`) ?? '',
      designation: str(e.designation, LIMITS.text, `${at} designation`, true),
      department: str(e.department, LIMITS.text, `${at} department`, true),
      periodFrom: isoDate(e.periodFrom, `${at} period start`, true),
      periodTo: isoDate(e.periodTo, `${at} period end`, true),
      pages: [],
      days,
      totals: null,
      monthly: null,
    };
  });
  const warnings = Array.isArray(o.warnings)
    ? o.warnings.slice(0, 200).map((w) => {
        const v = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>;
        return { page: Number.isSafeInteger(v.page) ? (v.page as number) : 0, reason: str(v.reason ?? '', 300, 'A warning') ?? '' };
      })
    : [];
  return { title: str(o.title, 120, 'The title', true), pages: 0, employees, unreadable: [], warnings };
}
