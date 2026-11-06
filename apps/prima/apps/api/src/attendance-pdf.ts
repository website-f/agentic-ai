// P81: reads the InfoTech system's monthly attendance report ("Individual Attendance Report With [Actual Clock and]
// Monthly Allowance") into structured employees and days (packages/core/src/attendance-reports.ts).
//
// The report is text, not a scan: one employee per block, a block starting at its "Emp Code ... Name : ... Designation"
// line and running across pages until the next one. Words are read with their positions (pdfjs-dist) and grouped into
// lines by height, so a column is a column wherever the text runs are cut. Each day row is checked cell by cell (date,
// times, the shift code, sixteen numbers, then the reason), and each employee's day rows are added up and compared
// with the printed totals. A page that cannot be read is listed with the reason; nothing is guessed.
//
// Memory stays bounded: one page's text at a time (released before the next page), and only the parsed rows are kept.

import {
  ATTENDANCE_ALLOWANCE_KEYS,
  type AttendanceAllowances,
  type OtHours,
  type ParsedAttendanceReport,
  type ReportDay,
  type ReportEmployee,
  type ReportMonthly,
  type ReportTotals,
} from '@prima/core';

/** The most pages read from one file (the largest monthly report so far is 516). */
export const ATTENDANCE_PDF_MAX_PAGES = 3000;

interface Word {
  s: string;
  x0: number;
  x1: number;
  /** Distance from the top of the page to the text's baseline. */
  y: number;
}
type Line = Word[];

interface TextItem {
  str?: string;
  transform?: number[];
  width?: number;
}
interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: TextItem[] }>;
  cleanup(): void;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfJs {
  getDocument(o: Record<string, unknown>): { promise: Promise<PdfDoc>; destroy?: () => Promise<void> };
}

let pdfjs: Promise<PdfJs> | null = null;
/**
 * pdfjs-dist ships as an ES module. This API compiles to CommonJS, where TypeScript would turn import() into require();
 * the indirect import keeps it a real dynamic import on every supported Node version.
 */
function loadPdfJs(): Promise<PdfJs> {
  const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<PdfJs>;
  return (pdfjs ??= dynamicImport('pdfjs-dist/legacy/build/pdf.mjs'));
}

const DATE = /^(\d{2})-(\d{2})-(\d{4})$/;
const WEEKDAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i;
const TIME = /^(\d{1,2})[.:](\d{2})$/;
const NUM = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

function isoOf(s: string): string | null {
  const m = DATE.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null;
}

function num(s: string): number | null {
  return NUM.test(s) ? Number(s.replace(/,/g, '')) : null;
}

/** "8.28" is 08:28; "0.00" is no time. Undefined when it is not a time at all. */
function timeOf(s: string): string | null | undefined {
  const m = TIME.exec(s);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 0 && min === 0) return null;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** Text runs cut into words; a run with spaces is split with its width shared out by characters. */
function wordsOf(items: TextItem[], pageHeight: number): Word[] {
  const out: Word[] = [];
  for (const it of items) {
    const str = it.str ?? '';
    if (!str.trim() || !it.transform) continue;
    const x = it.transform[4];
    const y = pageHeight - it.transform[5];
    const w = it.width ?? 0;
    const per = str.length ? w / str.length : 0;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(str))) out.push({ s: m[0], x0: x + m.index * per, x1: x + (m.index + m[0].length) * per, y });
  }
  return out;
}

/** Words on the same height (within 3 points) are one line, left to right. */
function linesOf(words: Word[]): Line[] {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const lines: Line[] = [];
  let cur: Line = [];
  let top = -Infinity;
  for (const w of sorted) {
    if (w.y - top > 3) {
      if (cur.length) lines.push(cur.sort((a, b) => a.x0 - b.x0));
      cur = [];
      top = w.y;
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur.sort((a, b) => a.x0 - b.x0));
  return lines;
}

const text = (l: Line) => l.map((w) => w.s).join(' ');
const zeroAllow = (): AttendanceAllowances => Object.fromEntries(ATTENDANCE_ALLOWANCE_KEYS.map((k) => [k, 0])) as AttendanceAllowances;

/** The sixteen numbers of a day row or the totals: normal, late, early out, actual, OT x4, then the eight allowances. */
function sixteen(ns: number[]): Omit<ReportTotals, never> {
  const allow = zeroAllow();
  ATTENDANCE_ALLOWANCE_KEYS.forEach((k, i) => (allow[k] = ns[8 + i]));
  return { normalH: ns[0], lateH: ns[1], earlyH: ns[2], actualH: ns[3], ot: [ns[4], ns[5], ns[6], ns[7]] as OtHours, allow };
}

interface Layout {
  /** Raw clock punch columns between Day and In (the "Actual Clock" report has four). */
  clocks: number;
}

/** Reads one day row; a string is the reason it could not be read. */
function dayRow(l: Line, layout: Layout, page: number): ReportDay | string {
  const date = isoOf(l[0].s);
  if (!date) return `the date ${l[0].s} is not on the calendar`;
  let rest = l.slice(1);
  if (rest[0] && WEEKDAY.test(rest[0].s)) rest = rest.slice(1);
  // The reason is printed last, after the sixteenth number: trailing words with letters.
  let end = rest.length;
  while (end > 0 && /[A-Za-z]/.test(rest[end - 1].s) && num(rest[end - 1].s) === null) end--;
  const reason = rest.slice(end).map((w) => w.s).join(' ') || null;
  const cells = rest.slice(0, end).map((w) => w.s);
  const head = layout.clocks + 2;
  if (cells.length < head + 16) return `the row for ${l[0].s} has ${cells.length} cells, fewer than the report's columns`;
  const numbers = cells.slice(-16).map(num);
  if (numbers.some((n) => n === null)) return `the row for ${l[0].s} has a value that is not a number`;
  const times = cells.slice(0, head).map(timeOf);
  if (times.some((t) => t === undefined)) return `the row for ${l[0].s} has a clock time that is not a time`;
  const shift = cells.slice(head, cells.length - 16).join(' ') || null;
  const t = sixteen(numbers as number[]);
  return {
    date,
    clocks: (times.slice(0, layout.clocks).filter((x) => x) as string[]),
    in: times[layout.clocks] ?? null,
    out: times[layout.clocks + 1] ?? null,
    shift,
    ...t,
    reason,
    page,
  };
}

/** The label words that end a field on the employee line. */
function between(l: Line, from: number, stop: RegExp): { value: string; next: number } {
  const parts: string[] = [];
  let i = from;
  for (; i < l.length; i++) {
    if (stop.test(l[i].s)) break;
    if (l[i].s !== ':') parts.push(l[i].s.replace(/^:/, ''));
  }
  return { value: parts.join(' ').trim(), next: i };
}

/** "Emp Code HR0001 Name : ... Designation : ..." (with Department / Site when the report prints them). */
function employeeLine(l: Line): Pick<ReportEmployee, 'empCode' | 'name' | 'designation' | 'department'> {
  const label = /^(Name|Designation|Department|Dept|Site|Location)$/i;
  let code: string | null = null;
  let name = '';
  let designation: string | null = null;
  let department: string | null = null;
  let i = l.findIndex((w) => /^Code$/i.test(w.s)) + 1;
  while (i > 0 && i < l.length) {
    const w = l[i].s;
    if (label.test(w)) {
      const r = between(l, i + 1, label);
      if (/^Name$/i.test(w)) name = r.value;
      else if (/^Designation$/i.test(w)) designation = r.value || null;
      else department = r.value || null;
      i = r.next;
    } else {
      if (!code) {
        const r = between(l, i, label);
        code = r.value.replace(/^:\s*/, '') || null;
        i = r.next;
      } else i++;
    }
  }
  return { empCode: code, name, designation: designation && !/^NONE$/i.test(designation) ? designation : null, department };
}

export interface ParseProgress {
  page: number;
  pages: number;
}

/**
 * Reads a whole report, page by page. onProgress is told after each page. Throws only when the file is not a PDF at all
 * (or is too long); every page problem is listed instead.
 */
export async function parseAttendancePdf(bytes: Uint8Array, onProgress?: (p: ParseProgress) => void): Promise<ParsedAttendanceReport> {
  const lib = await loadPdfJs();
  // pdfjs takes the buffer over; the caller keeps its own copy.
  const task = lib.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc: PdfDoc;
  try {
    doc = await task.promise;
  } catch {
    throw new Error('This file could not be opened as a PDF. Export the report from the attendance system again.');
  }
  try {
    if (doc.numPages > ATTENDANCE_PDF_MAX_PAGES) throw new Error(`This report has ${doc.numPages} pages; split it into files of at most ${ATTENDANCE_PDF_MAX_PAGES} pages.`);
    const out: ParsedAttendanceReport = { title: null, pages: doc.numPages, employees: [], unreadable: [], warnings: [] };
    const state: { company: string; period: [string | null, string | null]; layout: Layout | null; cur: ReportEmployee | null; monthlyWanted: number[] | null } = {
      company: '',
      period: [null, null],
      layout: null,
      cur: null,
      monthlyWanted: null,
    };
    for (let n = 1; n <= doc.numPages; n++) {
      let lines: Line[] = [];
      try {
        const page = await doc.getPage(n);
        const { height } = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        lines = linesOf(wordsOf(content.items, height));
        page.cleanup();
      } catch {
        out.unreadable.push({ page: n, reason: 'The page could not be opened (the file may be damaged).' });
        onProgress?.({ page: n, pages: doc.numPages });
        continue;
      }
      readPage(lines, n, state, out);
      onProgress?.({ page: n, pages: doc.numPages });
      // Let other requests in between pages of a long report.
      if (n % 10 === 0) await new Promise((r) => setImmediate(r));
    }
    if (state.cur) out.employees.push(state.cur);
    return out;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

type State = { company: string; period: [string | null, string | null]; layout: Layout | null; cur: ReportEmployee | null; monthlyWanted: number[] | null };

function readPage(lines: Line[], page: number, st: State, out: ParsedAttendanceReport): void {
  if (!lines.length) {
    out.unreadable.push({ page, reason: 'There is no text on this page (it may be a scanned image).' });
    return;
  }
  let recognised = false;
  let rows = 0;
  let bad = 0;
  const titleAt = lines.findIndex((l) => /Attendance/i.test(text(l)) && /Report/i.test(text(l)));
  if (titleAt >= 0) {
    recognised = true;
    out.title ??= text(lines[titleAt]);
    // The company is printed above the title.
    const above = lines.slice(0, titleAt).filter((l) => /[A-Za-z]/.test(text(l)) && !/^(Page|Date)\b/i.test(text(l)));
    if (above.length) st.company = text(above[above.length - 1]).replace(/\s+/g, ' ').trim();
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const first = l[0].s;
    const t = text(l);
    if (/\bPeriod\b/.test(t)) {
      const dates = l.map((w) => isoOf(w.s)).filter((x): x is string => !!x);
      const p = l.findIndex((w) => w.s === 'Period');
      const after = l.slice(p).map((w) => isoOf(w.s)).filter((x): x is string => !!x);
      if (after.length >= 2) st.period = [after[0], after[1]];
      else if (dates.length >= 2) st.period = [dates[dates.length - 2], dates[dates.length - 1]];
      continue;
    }
    if (/^Date$/i.test(first) && l.some((w) => /^Day$/i.test(w.s))) {
      const day = l.findIndex((w) => /^Day$/i.test(w.s));
      const inAt = l.findIndex((w, k) => k > day && /^In$/i.test(w.s));
      const clocks = inAt > day ? l.slice(day + 1, inAt).filter((w) => /[1-9]$/.test(w.s)).length : 0;
      st.layout = { clocks };
      recognised = true;
      continue;
    }
    if (/^Emp$/i.test(first) && /^Code$/i.test(l[1]?.s ?? '')) {
      if (st.cur) out.employees.push(st.cur);
      const e = employeeLine(l);
      st.cur = { company: st.company, ...e, periodFrom: st.period[0], periodTo: st.period[1], pages: [page], days: [], totals: null, monthly: null };
      st.monthlyWanted = null;
      if (!e.name && !e.empCode) out.warnings.push({ page, reason: 'An employee line has neither a name nor an employee code.' });
      recognised = true;
      continue;
    }
    if (DATE.test(first) && l.length > 3 && l[0].x0 < 80) {
      rows++;
      if (!st.cur) {
        bad++;
        continue;
      }
      const layout = st.layout ?? { clocks: 0 };
      const d = dayRow(l, layout, page);
      if (typeof d === 'string') {
        bad++;
        out.warnings.push({ page, reason: `A day row was left out: ${d}.` });
        continue;
      }
      if (!st.cur.pages.includes(page)) st.cur.pages.push(page);
      st.cur.days.push(d);
      continue;
    }
    if (/^Total$/i.test(first) || (/^Total/i.test(t) && l.findIndex((w) => /^Total$/i.test(w.s)) <= 1)) {
      const ns = l.map((w) => num(w.s)).filter((x): x is number => x !== null);
      recognised = true;
      if (!st.cur) continue;
      if (ns.length === 16) st.cur.totals = sixteen(ns);
      else out.warnings.push({ page, reason: `The totals line has ${ns.length} numbers instead of 16, so it was not checked.` });
      continue;
    }
    if (/Monthly/i.test(t) && /Allowance/i.test(t) && !/Report/i.test(t)) {
      st.monthlyWanted = [];
      recognised = true;
      continue;
    }
    if (st.monthlyWanted && st.cur && l.every((w) => num(w.s) !== null)) {
      st.monthlyWanted.push(...l.map((w) => num(w.s) as number));
      if (st.monthlyWanted.length >= 6) {
        const [attendance, health, transport, meal, other1, other2] = st.monthlyWanted;
        st.cur.monthly = { attendance, health, transport, meal, other1, other2 } satisfies ReportMonthly;
        if (!st.cur.pages.includes(page)) st.cur.pages.push(page);
        st.monthlyWanted = null;
      }
      continue;
    }
    if (/^Cont\.*$/i.test(first)) recognised = true;
  }
  if (rows > 0 && bad === rows) {
    out.unreadable.push({
      page,
      reason: st.cur ? 'The day rows on this page could not be split into the report columns.' : 'This page has day rows but no employee line before them.',
    });
    // Its warnings are summed up in the reason above.
    out.warnings = out.warnings.filter((w) => w.page !== page);
  } else if (!recognised && rows === 0) out.unreadable.push({ page, reason: 'Nothing on this page looks like the attendance report.' });
}
