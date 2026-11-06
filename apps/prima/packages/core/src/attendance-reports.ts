// P81: the group's past attendance, from the InfoTech system's monthly PDF reports ("Individual Attendance Report With
// [Actual Clock and] Monthly Allowance"). The API reads the PDF page by page (apps/api/src/attendance-pdf.ts); this file
// matches each employee to a Prima staff record, keeps each month per company and adds it up for the attendance view.
//
//  - One import per file and company (attendanceImports), each day one row (attendanceDays), both under the employee's
//    company, so the company wall (row-level security) applies. A remembered "this name is this person" is kept per
//    company (attendanceMatches) and used by every later import.
//  - Who imports: HR, the company's own manager and the owner (isOwnerAdmin), for companies they can see.
//  - The same file twice is refused. The same month and company again replaces the earlier import only when the person
//    confirms; the earlier rows stay in the database marked replaced (nothing is deleted).
//  - What the report does not say stays unknown: a leave code the report does not explain is shown as its code, an
//    employee nobody matched stays unmatched until HR picks the person.

import { sha256Hex } from './audit';
import { AccessDenied, CENTRAL_EMPLOYER_IDS, can, isGroupRole, isOwnerAdmin, visibleCompanyIds } from './access';
import { hrKeeps } from './hr';
import type { Store } from './store';
import { dateOf } from './time';
import type { AuthorityGrant, Company, Id, IsoDate, IsoDateTime, Person, User } from './types';

// ---------------------------------------------------------------- what the parser hands over

export const ATTENDANCE_ALLOWANCE_KEYS = ['flat', 'attendance', 'shift', 'meal', 'transport', 'other1', 'other2', 'health'] as const;
export type AttendanceAllowanceKey = (typeof ATTENDANCE_ALLOWANCE_KEYS)[number];
export type AttendanceAllowances = Record<AttendanceAllowanceKey, number>;
/** Overtime hours at rate 1.0, 1.5, 2.0 and 3.0, in that order. */
export type OtHours = [number, number, number, number];

/** One printed day row, as read. Times are HH:MM (null when the report shows 0.00); hours are decimal hours. */
export interface ReportDay {
  date: IsoDate;
  /** The raw clock punches, when the report prints them ("Actual Clock" layout). */
  clocks: string[];
  in: string | null;
  out: string | null;
  shift: string | null;
  normalH: number;
  lateH: number;
  earlyH: number;
  actualH: number;
  ot: OtHours;
  allow: AttendanceAllowances;
  reason: string | null;
  /** 1-based page number the row was printed on. */
  page: number;
}

export interface ReportTotals {
  normalH: number;
  lateH: number;
  earlyH: number;
  actualH: number;
  ot: OtHours;
  allow: AttendanceAllowances;
}

/** The "Monthly Allowance" block under an employee (RM). */
export interface ReportMonthly {
  attendance: number;
  health: number;
  transport: number;
  meal: number;
  other1: number;
  other2: number;
}

export interface ReportEmployee {
  /** The company named at the top of the employee's pages, as printed. */
  company: string;
  empCode: string | null;
  name: string;
  designation: string | null;
  department: string | null;
  periodFrom: IsoDate | null;
  periodTo: IsoDate | null;
  pages: number[];
  days: ReportDay[];
  totals: ReportTotals | null;
  monthly: ReportMonthly | null;
}

export interface ParsedAttendanceReport {
  title: string | null;
  pages: number;
  employees: ReportEmployee[];
  /** Pages nothing could be read from, with the reason in plain English. */
  unreadable: { page: number; reason: string }[];
  /** Pages that were read but need a look (a total that does not add up, a row skipped). */
  warnings: { page: number; reason: string }[];
}

// ---------------------------------------------------------------- what Prima keeps

export type AttendanceDayKind = 'present' | 'absent' | 'rest' | 'leave' | 'holiday' | 'none';

export interface AttendanceTotals {
  /** Day rows in the report. */
  days: number;
  present: number;
  absent: number;
  rest: number;
  leave: number;
  holiday: number;
  lateCount: number;
  lateMin: number;
  earlyCount: number;
  earlyMin: number;
  ot: OtHours;
  /** Allowances on the day rows (RM). */
  dayAllowances: number;
  /** The monthly allowance block (RM); null when the report printed none. */
  monthlyAllowances: number | null;
  normalH: number;
  actualH: number;
}

export type AttendanceMatchHow = 'remembered' | 'staff_no' | 'name';

export interface AttendanceEmployee {
  /** Position in the import: part of each day row's id. */
  idx: number;
  /** The match key: the employee code when printed, else the normalised name. */
  key: string;
  empCode: string | null;
  name: string;
  designation: string | null;
  department: string | null;
  personId: Id | null;
  how: AttendanceMatchHow | null;
  totals: AttendanceTotals;
  /** One letter per day of the month (attendanceStrip). */
  strip: string;
  /** Most rows printed for one date (normally 1): day row ids run to this. */
  seqs: number;
  /** Whether the printed totals equal the sum of the day rows; null when no totals were printed. */
  totalsMatch: boolean | null;
}

export interface AttendanceImport {
  id: Id;
  companyId: Id;
  /** YYYY-MM */
  month: string;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  fileName: string;
  fileSha256: string;
  fileBytes: number;
  pages: number;
  /** The company as printed on the report. */
  sourceCompany: string;
  status: 'active' | 'replaced';
  replacesId: Id | null;
  replacedById: Id | null;
  byId: Id;
  by: string;
  at: IsoDateTime;
  counts: { employees: number; days: number; matched: number; unmatched: number; unreadablePages: number; warnings: number };
  unreadable: { page: number; reason: string }[];
  warnings: { page: number; reason: string }[];
  employees: AttendanceEmployee[];
}

export interface AttendanceDayRow {
  id: Id;
  companyId: Id;
  importId: Id;
  month: string;
  date: IsoDate;
  seq: number;
  key: string;
  personId: Id | null;
  empCode: string | null;
  name: string;
  kind: AttendanceDayKind;
  in: string | null;
  out: string | null;
  clocks?: string[];
  shift: string | null;
  normalH: number;
  lateMin: number;
  earlyMin: number;
  actualH: number;
  ot: OtHours;
  allow: AttendanceAllowances;
  reason: string | null;
  page: number;
}

/** "This employee on the reports is this staff record", remembered per company for later imports. */
export interface AttendanceMatch {
  id: Id;
  companyId: Id;
  key: string;
  personId: Id;
  personName: string;
  byId: Id;
  by: string;
  at: IsoDateTime;
}

export class AttendanceReportError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code: string = 'refused',
  ) {
    super(message);
    this.name = 'AttendanceReportError';
  }
}

// ---------------------------------------------------------------- pure helpers

/** What the report's reason codes mean, where the report system is known to use them. Anything else shows as its code. */
export const ATTENDANCE_REASON_LABEL: Record<string, string> = {
  RES: 'Rest day',
  ABS: 'Absent',
  AL: 'Annual leave',
  ALAM: 'Annual leave, morning',
  ALPM: 'Annual leave, afternoon',
  ML: 'Medical leave',
  MC: 'Medical leave',
  EL: 'Emergency leave',
  UL: 'Unpaid leave',
  ULAM: 'Unpaid leave, morning',
  ULPM: 'Unpaid leave, afternoon',
  MATN: 'Maternity leave',
  HOSP: 'Hospitalisation leave',
  PH: 'Public holiday',
};
const HOLIDAY_CODES = new Set(['PH', 'PHOL', 'HOL', 'PUB', 'CUTIUMUM']);

export function reasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return ATTENDANCE_REASON_LABEL[code.toUpperCase()] ?? `Code ${code} (not explained on the report)`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const minutes = (h: number) => Math.max(0, Math.round(h * 60));
const sumAllow = (a: AttendanceAllowances) => ATTENDANCE_ALLOWANCE_KEYS.reduce((s, k) => s + (a[k] || 0), 0);

/**
 * Present when hours were worked (or, with no reason printed, when both clock times are there); otherwise what the
 * reason says, because the attendance system marks a day ABS even with stray punches. A day with neither is 'none'.
 */
export function dayKind(d: Pick<ReportDay, 'in' | 'out' | 'actualH' | 'reason'>): AttendanceDayKind {
  const code = (d.reason ?? '').toUpperCase().replace(/\s+/g, '');
  const worked = d.actualH > 0 || (!code && !!d.in && !!d.out);
  if (worked) return 'present';
  if (!code) return 'none';
  if (code === 'RES' || code === 'OFF') return 'rest';
  if (code.startsWith('ABS')) return 'absent';
  if (HOLIDAY_CODES.has(code)) return 'holiday';
  return 'leave';
}

/**
 * One letter per day of the month, for the heat strips: P present, L late, E left early, A absent, R rest day, V leave,
 * H public holiday, '.' nothing printed.
 */
export function attendanceStrip(month: string, days: Pick<ReportDay, 'date' | 'in' | 'out' | 'actualH' | 'reason' | 'lateH' | 'earlyH'>[]): string {
  const [y, m] = month.split('-').map(Number);
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = Array.from({ length: len }, () => '.');
  const rank: Record<string, number> = { '.': 0, R: 1, H: 2, V: 3, A: 4, P: 5, E: 6, L: 7 };
  for (const d of days) {
    if (d.date.slice(0, 7) !== month) continue;
    const i = Number(d.date.slice(8, 10)) - 1;
    const k = dayKind(d);
    const c = k === 'present' ? (d.lateH > 0 ? 'L' : d.earlyH > 0 ? 'E' : 'P') : k === 'absent' ? 'A' : k === 'rest' ? 'R' : k === 'leave' ? 'V' : k === 'holiday' ? 'H' : '.';
    if (rank[c] > rank[out[i]]) out[i] = c;
  }
  return out.join('');
}

function zeroTotals(): AttendanceTotals {
  return { days: 0, present: 0, absent: 0, rest: 0, leave: 0, holiday: 0, lateCount: 0, lateMin: 0, earlyCount: 0, earlyMin: 0, ot: [0, 0, 0, 0], dayAllowances: 0, monthlyAllowances: null, normalH: 0, actualH: 0 };
}

export function employeeTotals(e: Pick<ReportEmployee, 'days' | 'monthly'>): AttendanceTotals {
  const t = zeroTotals();
  for (const d of e.days) {
    t.days++;
    const k = dayKind(d);
    if (k === 'present') {
      t.present++;
      if (d.lateH > 0) {
        t.lateCount++;
        t.lateMin += minutes(d.lateH);
      }
      if (d.earlyH > 0) {
        t.earlyCount++;
        t.earlyMin += minutes(d.earlyH);
      }
    } else if (k !== 'none') t[k]++;
    d.ot.forEach((h, i) => (t.ot[i] += h));
    t.dayAllowances += sumAllow(d.allow);
    t.normalH += d.normalH;
    t.actualH += d.actualH;
  }
  t.ot = t.ot.map(round2) as OtHours;
  t.dayAllowances = round2(t.dayAllowances);
  t.normalH = round2(t.normalH);
  t.actualH = round2(t.actualH);
  if (e.monthly) t.monthlyAllowances = round2(Object.values(e.monthly).reduce((s, v) => s + (v || 0), 0));
  return t;
}

/** Allowances (RM) one employee's month adds up to: the day rows plus the monthly block. */
export function allowancesOf(t: AttendanceTotals): number {
  return round2(t.dayAllowances + (t.monthlyAllowances ?? 0));
}

/** Whether the printed totals equal the day rows (to the cent); null when none were printed. */
export function totalsAddUp(e: Pick<ReportEmployee, 'days' | 'totals'>): boolean | null {
  if (!e.totals) return null;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.051;
  const s = (f: (d: ReportDay) => number) => e.days.reduce((n, d) => n + f(d), 0);
  if (!near(s((d) => d.normalH), e.totals.normalH) || !near(s((d) => d.lateH), e.totals.lateH)) return false;
  if (!near(s((d) => d.earlyH), e.totals.earlyH) || !near(s((d) => d.actualH), e.totals.actualH)) return false;
  for (let i = 0; i < 4; i++) if (!near(s((d) => d.ot[i]), e.totals.ot[i])) return false;
  for (const k of ATTENDANCE_ALLOWANCE_KEYS) if (!near(s((d) => d.allow[k]), e.totals.allow[k])) return false;
  return true;
}

/** A person's name as compared: capitals, letters and digits only, "binti/bt" and "bin/b." written one way. */
export function normalisePersonName(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[@'`’]/g, ' ')
    .replace(/A\/L/g, ' AL ')
    .replace(/A\/P/g, ' AP ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === 'BT' || w === 'BTE' || w === 'BINTI' ? 'BINTI' : w === 'B' || w === 'BIN' ? 'BIN' : w));
  return words.join(' ');
}

/** A company's name as compared: "SN BHD" and "SDN. BHD." are "SDN BHD", notes in brackets dropped. */
export function normaliseCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bSN\.?\s+BHD\b/g, 'SDN BHD')
    .replace(/\bSDN\.\s*BHD\.?/g, 'SDN BHD')
    .replace(/\bBHD\./g, 'BHD')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normaliseStaffNo(code: string | null | undefined): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function employeeKey(e: Pick<ReportEmployee, 'empCode' | 'name'>): string {
  const code = normaliseStaffNo(e.empCode);
  return code ? `code:${code}` : `name:${normalisePersonName(e.name)}`;
}

/** The month a report covers: its printed period, else the month most of its days fall in. */
export function reportMonth(employees: ReportEmployee[]): string | null {
  const count = new Map<string, number>();
  for (const e of employees) {
    const m = (e.periodFrom ?? e.days[0]?.date ?? '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) count.set(m, (count.get(m) ?? 0) + Math.max(1, e.days.length));
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export interface MatchCandidate {
  id: Id;
  name: string;
  staffNo: string;
}

/**
 * The staff record for one employee on a report, within the company: a remembered choice first, then the same staff
 * number, then exactly the same name (only when one person has it). Anything else stays unmatched.
 */
export function matchEmployee(
  e: Pick<ReportEmployee, 'empCode' | 'name'>,
  people: MatchCandidate[],
  remembered: Map<string, Id>,
): { personId: Id | null; how: AttendanceMatchHow | null } {
  const key = employeeKey(e);
  const known = remembered.get(key) ?? remembered.get(`name:${normalisePersonName(e.name)}`);
  if (known && people.some((p) => p.id === known)) return { personId: known, how: 'remembered' };
  const code = normaliseStaffNo(e.empCode);
  if (code) {
    const hit = people.filter((p) => normaliseStaffNo(p.staffNo) === code);
    if (hit.length === 1) return { personId: hit[0].id, how: 'staff_no' };
  }
  const name = normalisePersonName(e.name);
  if (name) {
    const hit = people.filter((p) => normalisePersonName(p.name) === name);
    if (hit.length === 1) return { personId: hit[0].id, how: 'name' };
  }
  return { personId: null, how: null };
}

const AUTO_PAGES_CAP = 200;

export function dayRowId(importId: Id, idx: number, date: IsoDate, seq: number): Id {
  return `ad-${importId.slice(3)}-${idx}-${date.replace(/-/g, '')}-${seq}`;
}

function datesOfMonth(month: string): IsoDate[] {
  const [y, m] = month.split('-').map(Number);
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: len }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

// ---------------------------------------------------------------- views

export interface AttendanceKpi {
  employees: number;
  present: number;
  absent: number;
  leave: number;
  lateCount: number;
  lateMin: number;
  earlyCount: number;
  earlyMin: number;
  ot: OtHours;
  /** Day-row allowances plus the monthly allowance block (RM); the two parts are kept too, so the screen shows both. */
  allowances: number;
  dayAllowances: number;
  monthlyAllowances: number;
  /** Employees whose monthly allowance block was not printed (their allowance total is the day rows only). */
  noMonthlyBlock: number;
}

export interface AttendancePreviewCompany {
  source: string;
  companyId: Id | null;
  companyName: string | null;
  how: 'name' | 'chosen' | null;
  canImport: boolean;
  employees: number;
  days: number;
  matched: number;
  unmatched: number;
  existing: { id: Id; fileName: string; at: IsoDateTime; by: string } | null;
}

export interface AttendancePreview {
  month: string | null;
  periodFrom: IsoDate | null;
  periodTo: IsoDate | null;
  pages: number;
  title: string | null;
  employees: number;
  days: number;
  companies: AttendancePreviewCompany[];
  rows: {
    source: string;
    key: string;
    empCode: string | null;
    name: string;
    designation: string | null;
    days: number;
    present: number;
    absent: number;
    lateCount: number;
    personId: Id | null;
    personName: string | null;
    how: AttendanceMatchHow | null;
    totalsMatch: boolean | null;
  }[];
  unreadable: { page: number; reason: string }[];
  warnings: { page: number; reason: string }[];
  alreadyImported: { at: IsoDateTime; by: string; companyName: string; month: string } | null;
  choices: { id: Id; name: string }[];
  canSave: boolean;
}

function kpiOf(rows: { t: AttendanceTotals }[]): AttendanceKpi {
  const k: AttendanceKpi = { employees: rows.length, present: 0, absent: 0, leave: 0, lateCount: 0, lateMin: 0, earlyCount: 0, earlyMin: 0, ot: [0, 0, 0, 0], allowances: 0, dayAllowances: 0, monthlyAllowances: 0, noMonthlyBlock: 0 };
  for (const { t } of rows) {
    k.dayAllowances += t.dayAllowances;
    k.monthlyAllowances += t.monthlyAllowances ?? 0;
    k.present += t.present;
    k.absent += t.absent;
    k.leave += t.leave;
    k.lateCount += t.lateCount;
    k.lateMin += t.lateMin;
    k.earlyCount += t.earlyCount;
    k.earlyMin += t.earlyMin;
    t.ot.forEach((h, i) => (k.ot[i] += h));
    k.allowances += allowancesOf(t);
    if (t.monthlyAllowances === null) k.noMonthlyBlock++;
  }
  k.ot = k.ot.map(round2) as OtHours;
  k.allowances = round2(k.allowances);
  k.dayAllowances = round2(k.dayAllowances);
  k.monthlyAllowances = round2(k.monthlyAllowances);
  return k;
}

/** One person's month, as the attendance view lists it. */
export interface AttendanceListRow {
  importId: Id;
  key: string;
  companyId: Id;
  companyName: string;
  month: string;
  name: string;
  empCode: string | null;
  designation: string | null;
  department: string;
  personId: Id | null;
  personName: string | null;
  totals: AttendanceTotals;
  allowances: number;
  strip: string;
  totalsMatch: boolean | null;
}

export interface AttendanceOverview {
  months: string[];
  month: string | null;
  companies: { id: Id; name: string }[];
  departments: string[];
  filters: { companyId: Id | null; department: string | null; q: string };
  kpi: AttendanceKpi;
  trend: ({ month: string } & AttendanceKpi)[];
  byCompany: ({ id: Id; name: string } & AttendanceKpi)[];
  byDepartment: ({ name: string } & AttendanceKpi)[];
  oftenLate: AttendanceListRow[];
  rows: AttendanceListRow[];
  imports: {
    id: Id;
    companyId: Id;
    companyName: string;
    month: string;
    fileName: string;
    at: IsoDateTime;
    by: string;
    counts: AttendanceImport['counts'];
    unreadable: AttendanceImport['unreadable'];
  }[];
  unmatched: number;
  canImport: boolean;
  importCompanies: { id: Id; name: string }[];
}

const NO_DEPARTMENT = 'Not recorded';

// ---------------------------------------------------------------- the service

export class AttendanceReportService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
  ) {}

  private today(): IsoDate {
    return dateOf(this.now());
  }

  private grantsP: Promise<AuthorityGrant[]> | null = null;
  private grants(): Promise<AuthorityGrant[]> {
    return (this.grantsP ??= this.store.list('grants'));
  }

  /** Companies this person can see at all (their grants, their own company, and PWVSB's central employers for group roles). */
  private async seenIds(user: User): Promise<Id[]> {
    const g = await this.grants();
    const ids = new Set(visibleCompanyIds(user, g, this.today()));
    if (isGroupRole(user)) for (const c of CENTRAL_EMPLOYER_IDS) ids.add(c);
    return [...ids].filter((id) => can(user, g, this.today(), 'view', id));
  }

  /** HR, the company's own manager and the owner import, for a company they can see. */
  canImportFor(user: User, grants: AuthorityGrant[], companyId: Id): boolean {
    if (user.integration) return false;
    if (!can(user, grants, this.today(), 'view', companyId)) return false;
    if (isOwnerAdmin(user) || hrKeeps(user)) return true;
    return user.role === 'company_manager' && user.companyIds.includes(companyId);
  }

  /** Importers, plus whoever sees the company's pay (allowances are money): the company team, HR and group leaders. */
  private canViewFor(user: User, grants: AuthorityGrant[], companyId: Id): boolean {
    return this.canImportFor(user, grants, companyId) || can(user, grants, this.today(), 'hr.pay', companyId);
  }

  async importCompanies(user: User): Promise<Company[]> {
    const g = await this.grants();
    const ids = (await this.seenIds(user)).filter((id) => this.canImportFor(user, g, id));
    return ids.length ? (await this.store.list('companies', { id: ids })).sort((a, b) => a.name.localeCompare(b.name)) : [];
  }

  async viewCompanies(user: User): Promise<Company[]> {
    const g = await this.grants();
    const ids = (await this.seenIds(user)).filter((id) => this.canViewFor(user, g, id));
    return ids.length ? (await this.store.list('companies', { id: ids })).sort((a, b) => a.name.localeCompare(b.name)) : [];
  }

  /** Refuses anyone who imports for no company, before a file is even sent. */
  async assertMayImport(user: User): Promise<void> {
    if (!(await this.importCompanies(user)).length)
      throw new AttendanceReportError('Importing attendance reports is for HR, the company manager and the owner.', 403, 'not_allowed');
  }

  private async activeImports(companyIds: Id[]): Promise<AttendanceImport[]> {
    if (!companyIds.length) return [];
    return (await this.store.list('attendanceImports', { companyId: companyIds })).filter((i) => i.status === 'active');
  }

  /** An active import of exactly this file, in a company this person can see. */
  async fileKnown(user: User, sha256: string): Promise<AttendancePreview['alreadyImported']> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new AttendanceReportError('The file fingerprint is not valid. Choose the file again.', 400, 'bad_sha');
    const companies = await this.viewCompanies(user);
    const hit = (await this.activeImports(companies.map((c) => c.id))).find((i) => i.fileSha256 === sha256);
    if (!hit) return null;
    return { at: hit.at, by: hit.by, month: hit.month, companyName: companies.find((c) => c.id === hit.companyId)?.name ?? hit.companyId };
  }

  private async remembered(companyId: Id): Promise<Map<string, Id>> {
    const rows = await this.store.list('attendanceMatches', { companyId });
    return new Map(rows.map((r) => [r.key, r.personId]));
  }

  private async candidates(companyId: Id): Promise<MatchCandidate[]> {
    return (await this.store.list('people', { companyId })).map((p) => ({ id: p.id, name: p.name, staffNo: p.staffNo }));
  }

  /** Each company printed on the report, with the Prima company it goes to: the person's choice, else the same name. */
  private resolveCompanies(sources: string[], visible: Company[], choice: Record<string, Id | null | undefined>) {
    return sources.map((source) => {
      const chosen = choice[source];
      if (chosen) {
        const c = visible.find((x) => x.id === chosen);
        if (!c) throw new AttendanceReportError('That company is not one you can see.', 403, 'company_hidden');
        return { source, company: c, how: 'chosen' as const };
      }
      const want = normaliseCompanyName(source);
      const hits = visible.filter((c) => normaliseCompanyName(c.name) === want);
      return { source, company: hits.length === 1 ? hits[0] : null, how: hits.length === 1 ? ('name' as const) : null };
    });
  }

  async preview(user: User, parsed: ParsedAttendanceReport, file: { sha256: string }, choice: Record<string, Id | null | undefined> = {}): Promise<AttendancePreview> {
    await this.assertMayImport(user);
    const g = await this.grants();
    const visible = await this.viewCompanies(user);
    const importable = await this.importCompanies(user);
    const month = reportMonth(parsed.employees);
    const sources = [...new Set(parsed.employees.map((e) => e.company))];
    const resolved = this.resolveCompanies(sources, visible, choice);
    const active = await this.activeImports(resolved.map((r) => r.company?.id).filter((x): x is Id => !!x));
    const rows: AttendancePreview['rows'] = [];
    const companies: AttendancePreviewCompany[] = [];
    for (const r of resolved) {
      const emps = parsed.employees.filter((e) => e.company === r.source);
      const people = r.company ? await this.candidates(r.company.id) : [];
      const names = new Map(people.map((p) => [p.id, p.name]));
      const memory = r.company ? await this.remembered(r.company.id) : new Map<string, Id>();
      let matched = 0;
      for (const e of emps) {
        const m = r.company ? matchEmployee(e, people, memory) : { personId: null, how: null };
        if (m.personId) matched++;
        const t = employeeTotals(e);
        rows.push({
          source: r.source,
          key: employeeKey(e),
          empCode: e.empCode,
          name: e.name,
          designation: e.designation,
          days: t.days,
          present: t.present,
          absent: t.absent,
          lateCount: t.lateCount,
          personId: m.personId,
          personName: m.personId ? (names.get(m.personId) ?? null) : null,
          how: m.how,
          totalsMatch: totalsAddUp(e),
        });
      }
      const existing = r.company && month ? active.find((i) => i.companyId === r.company!.id && i.month === month) : undefined;
      companies.push({
        source: r.source,
        companyId: r.company?.id ?? null,
        companyName: r.company?.name ?? null,
        how: r.how,
        canImport: !!r.company && this.canImportFor(user, g, r.company.id),
        employees: emps.length,
        days: emps.reduce((n, e) => n + e.days.length, 0),
        matched,
        unmatched: emps.length - matched,
        existing: existing ? { id: existing.id, fileName: existing.fileName, at: existing.at, by: existing.by } : null,
      });
    }
    const periods = parsed.employees.filter((e) => e.periodFrom && e.periodTo);
    const alreadyImported = await this.fileKnown(user, file.sha256);
    return {
      month,
      periodFrom: periods[0]?.periodFrom ?? (month ? `${month}-01` : null),
      periodTo: periods[0]?.periodTo ?? (month ? datesOfMonth(month).at(-1)! : null),
      pages: parsed.pages,
      title: parsed.title,
      employees: parsed.employees.length,
      days: parsed.employees.reduce((n, e) => n + e.days.length, 0),
      companies,
      rows: rows.slice(0, 2000),
      unreadable: parsed.unreadable.slice(0, AUTO_PAGES_CAP),
      warnings: parsed.warnings.slice(0, AUTO_PAGES_CAP),
      alreadyImported,
      choices: importable.map((c) => ({ id: c.id, name: c.name })),
      canSave: !alreadyImported && !!month && parsed.employees.length > 0 && companies.some((c) => c.canImport),
    };
  }

  /**
   * Save the report: one import per company printed on it (companies the person may import for; others are left out and
   * named). Refused when this file is already in; an earlier import of the same month and company is replaced only with
   * replace = true.
   */
  async save(
    user: User,
    parsed: ParsedAttendanceReport,
    file: { name: string; size: number; sha256: string },
    choice: Record<string, Id | null | undefined>,
    replace: boolean,
  ): Promise<{ imports: { id: Id; companyId: Id; companyName: string; employees: number; days: number; matched: number; unmatched: number; replacedId: Id | null }[]; skipped: { source: string; reason: string }[] }> {
    await this.assertMayImport(user);
    const month = reportMonth(parsed.employees);
    if (!month || !parsed.employees.length) throw new AttendanceReportError('Nothing on this report could be read, so there is nothing to save.', 400, 'empty');
    const g = await this.grants();
    const visible = await this.viewCompanies(user);
    const sources = [...new Set(parsed.employees.map((e) => e.company))];
    const resolved = this.resolveCompanies(sources, visible, choice);
    const skipped: { source: string; reason: string }[] = [];
    const targets = resolved.filter((r) => {
      if (!r.company) skipped.push({ source: r.source, reason: 'No Prima company chosen for it.' });
      else if (!this.canImportFor(user, g, r.company.id)) skipped.push({ source: r.source, reason: `You do not import for ${r.company.name}.` });
      else return true;
      return false;
    });
    if (!targets.length) throw new AttendanceReportError('Choose a company you import for before saving.', 400, 'no_company');
    // Two spellings of one company on the report (or two printed names set to one Prima company) are one import.
    const byCompany = new Map<Id, { company: Company; sources: string[] }>();
    for (const t of targets) {
      const g = byCompany.get(t.company!.id) ?? { company: t.company!, sources: [] };
      g.sources.push(t.source);
      byCompany.set(t.company!.id, g);
    }
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const out: Awaited<ReturnType<AttendanceReportService['save']>>['imports'] = [];
      for (const t of byCompany.values()) {
        const company = t.company;
        await tx.lock?.('attendanceImports', `attendance-import:${company.id}:${month}`);
        const active = (await tx.list('attendanceImports', { companyId: company.id })).filter((i) => i.status === 'active');
        if (active.some((i) => i.fileSha256 === file.sha256))
          throw new AttendanceReportError(`This file is already imported for ${company.name}. The same file is never imported twice.`, 409, 'same_file');
        const earlier = active.find((i) => i.month === month) ?? null;
        if (earlier && !replace)
          throw new AttendanceReportError(
            `${company.name} already has attendance for ${month} (${earlier.fileName}, imported by ${earlier.by}). Confirm to replace it.`,
            409,
            'needs_replace',
          );
        const id = `ai-${sha256Hex(`${file.sha256}:${company.id}:${at}`).slice(0, 20)}`;
        const emps = mergeByKey(parsed.employees.filter((e) => t.sources.includes(e.company)));
        const people = await this.candidatesIn(tx, company.id);
        const memory = new Map((await tx.list('attendanceMatches', { companyId: company.id })).map((r) => [r.key, r.personId]));
        const employees: AttendanceEmployee[] = [];
        const days: AttendanceDayRow[] = [];
        emps.forEach((e, idx) => {
          const key = employeeKey(e);
          const m = matchEmployee(e, people, memory);
          const seqOf = new Map<string, number>();
          for (const d of e.days) {
            const seq = seqOf.get(d.date) ?? 0;
            seqOf.set(d.date, seq + 1);
            days.push({
              id: dayRowId(id, idx, d.date, seq),
              companyId: company.id,
              importId: id,
              month,
              date: d.date,
              seq,
              key,
              personId: m.personId,
              empCode: e.empCode,
              name: e.name,
              kind: dayKind(d),
              in: d.in,
              out: d.out,
              ...(d.clocks.length ? { clocks: d.clocks } : {}),
              shift: d.shift,
              normalH: d.normalH,
              lateMin: minutes(d.lateH),
              earlyMin: minutes(d.earlyH),
              actualH: d.actualH,
              ot: d.ot,
              allow: d.allow,
              reason: d.reason,
              page: d.page,
            });
          }
          employees.push({
            idx,
            key,
            empCode: e.empCode,
            name: e.name,
            designation: e.designation,
            department: e.department,
            personId: m.personId,
            how: m.how,
            totals: employeeTotals(e),
            strip: attendanceStrip(month, e.days),
            seqs: Math.max(1, ...seqOf.values()),
            totalsMatch: totalsAddUp(e),
          });
        });
        const matched = employees.filter((e) => e.personId).length;
        const periods = emps.find((e) => e.periodFrom && e.periodTo);
        const row: AttendanceImport = {
          id,
          companyId: company.id,
          month,
          periodFrom: periods?.periodFrom ?? `${month}-01`,
          periodTo: periods?.periodTo ?? datesOfMonth(month).at(-1)!,
          fileName: file.name.slice(0, 200),
          fileSha256: file.sha256,
          fileBytes: file.size,
          pages: parsed.pages,
          sourceCompany: t.sources.join(' / ').slice(0, 200),
          status: 'active',
          replacesId: earlier?.id ?? null,
          replacedById: null,
          byId: user.id,
          by: user.name,
          at,
          counts: { employees: employees.length, days: days.length, matched, unmatched: employees.length - matched, unreadablePages: parsed.unreadable.length, warnings: parsed.warnings.length },
          unreadable: parsed.unreadable.slice(0, AUTO_PAGES_CAP),
          warnings: parsed.warnings.slice(0, AUTO_PAGES_CAP),
          employees,
        };
        if (earlier) await tx.update('attendanceImports', earlier.id, { status: 'replaced', replacedById: id });
        await tx.insert('attendanceImports', row);
        if (tx.insertMany) await tx.insertMany('attendanceDays', days);
        else for (const d of days) await tx.insert('attendanceDays', d);
        await tx.audit({
          at,
          actor: user.name,
          companyId: company.id,
          action: 'attendance.report.import',
          entity: 'attendance_import',
          entityId: id,
          summary: `Attendance for ${month} imported from a report (${employees.length} employees, ${days.length} days, ${matched} matched to staff${earlier ? `; replaces ${earlier.id}` : ''}; file ${file.sha256.slice(0, 12)}).`,
        });
        out.push({ id, companyId: company.id, companyName: company.name, employees: employees.length, days: days.length, matched, unmatched: employees.length - matched, replacedId: earlier?.id ?? null });
      }
      return { imports: out, skipped };
    });
  }

  private async candidatesIn(store: Store, companyId: Id): Promise<MatchCandidate[]> {
    return (await store.list('people', { companyId })).map((p) => ({ id: p.id, name: p.name, staffNo: p.staffNo }));
  }

  /** Every month's rows for the companies this person sees, with matches resolved and filters applied. */
  async overview(user: User, f: { month?: string | null; companyId?: Id | null; department?: string | null; q?: string | null } = {}): Promise<AttendanceOverview> {
    const companies = await this.viewCompanies(user);
    const importCompanies = await this.importCompanies(user);
    const nameOf = new Map(companies.map((c) => [c.id, c.name]));
    if (f.companyId && !nameOf.has(f.companyId)) throw new AccessDenied('hr.pay', f.companyId);
    const scope = f.companyId ? [f.companyId] : companies.map((c) => c.id);
    const imports = await this.activeImports(scope);
    const matches = scope.length ? await this.store.list('attendanceMatches', { companyId: scope }) : [];
    const memory = new Map(matches.map((m) => [`${m.companyId}|${m.key}`, m]));
    const personIds = new Set<Id>();
    for (const i of imports) for (const e of i.employees) {
      const pid = e.personId ?? memory.get(`${i.companyId}|${e.key}`)?.personId;
      if (pid) personIds.add(pid);
    }
    const people = personIds.size ? await this.store.list('people', { id: [...personIds] }) : [];
    const personOf = new Map<Id, Person>(people.map((p) => [p.id, p]));
    const all: AttendanceListRow[] = [];
    for (const i of imports)
      for (const e of i.employees) {
        const pid = e.personId ?? memory.get(`${i.companyId}|${e.key}`)?.personId ?? null;
        const p = pid ? personOf.get(pid) : undefined;
        all.push({
          importId: i.id,
          key: e.key,
          companyId: i.companyId,
          companyName: nameOf.get(i.companyId) ?? i.companyId,
          month: i.month,
          name: e.name,
          empCode: e.empCode,
          designation: e.designation,
          department: p?.department || e.department || e.designation || NO_DEPARTMENT,
          personId: pid,
          personName: p?.name ?? null,
          totals: e.totals,
          allowances: allowancesOf(e.totals),
          strip: e.strip,
          totalsMatch: e.totalsMatch,
        });
      }
    const q = (f.q ?? '').trim().toUpperCase();
    const filtered = all.filter(
      (r) =>
        (!f.department || r.department === f.department) &&
        (!q || r.name.toUpperCase().includes(q) || (r.personName ?? '').toUpperCase().includes(q) || (r.empCode ?? '').toUpperCase().includes(q)),
    );
    const months = [...new Set(all.map((r) => r.month))].sort().reverse();
    const month = f.month && months.includes(f.month) ? f.month : (months[0] ?? null);
    const inMonth = filtered.filter((r) => r.month === month);
    const withT = (rs: AttendanceListRow[]) => rs.map((r) => ({ t: r.totals }));
    const group = <K extends string>(rs: AttendanceListRow[], by: (r: AttendanceListRow) => K) => {
      const m = new Map<K, AttendanceListRow[]>();
      for (const r of rs) m.set(by(r), [...(m.get(by(r)) ?? []), r]);
      return m;
    };
    const trend = [...group(filtered, (r) => r.month).entries()].map(([m, rs]) => ({ month: m, ...kpiOf(withT(rs)) })).sort((a, b) => a.month.localeCompare(b.month));
    const byCompany = [...group(inMonth, (r) => r.companyId).entries()]
      .map(([id, rs]) => ({ id, name: nameOf.get(id) ?? id, ...kpiOf(withT(rs)) }))
      .sort((a, b) => b.employees - a.employees);
    const byDepartment = [...group(inMonth, (r) => r.department).entries()].map(([name, rs]) => ({ name, ...kpiOf(withT(rs)) })).sort((a, b) => b.employees - a.employees);
    const oftenLate = inMonth
      .filter((r) => r.totals.lateCount > 0)
      .sort((a, b) => b.totals.lateCount - a.totals.lateCount || b.totals.lateMin - a.totals.lateMin)
      .slice(0, 15);
    const unmatched = imports
      .filter((i) => !month || i.month === month)
      .reduce((n, i) => n + i.employees.filter((e) => !e.personId && !memory.has(`${i.companyId}|${e.key}`)).length, 0);
    return {
      months,
      month,
      companies: companies.filter((c) => imports.some((i) => i.companyId === c.id) || f.companyId === c.id).map((c) => ({ id: c.id, name: c.name })),
      departments: [...new Set(all.filter((r) => r.month === month).map((r) => r.department))].sort(),
      filters: { companyId: f.companyId ?? null, department: f.department ?? null, q: f.q ?? '' },
      kpi: kpiOf(withT(inMonth)),
      trend,
      byCompany,
      byDepartment,
      oftenLate,
      rows: inMonth.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 3000),
      imports: imports
        .filter((i) => !month || i.month === month)
        .map((i) => ({ id: i.id, companyId: i.companyId, companyName: nameOf.get(i.companyId) ?? i.companyId, month: i.month, fileName: i.fileName, at: i.at, by: i.by, counts: i.counts, unreadable: i.unreadable })),
      unmatched,
      canImport: importCompanies.length > 0,
      importCompanies: importCompanies.map((c) => ({ id: c.id, name: c.name })),
    };
  }

  private async importFor(user: User, importId: Id): Promise<AttendanceImport> {
    const i = await this.store.get('attendanceImports', importId);
    const g = await this.grants();
    if (!i || !this.canViewFor(user, g, i.companyId)) throw new AttendanceReportError('That attendance import was not found.', 404, 'not_found');
    return i;
  }

  /** One employee's month day by day, and their other months, for the calendar and drill-down. */
  async person(user: User, importId: Id, key: string) {
    const i = await this.importFor(user, importId);
    const e = i.employees.find((x) => x.key === key);
    if (!e) throw new AttendanceReportError('That employee is not on this import.', 404, 'not_found');
    const ids: Id[] = [];
    for (const d of datesOfMonth(i.month)) for (let s = 0; s < (e.seqs || 1); s++) ids.push(dayRowId(i.id, e.idx, d, s));
    const days = (await this.store.list('attendanceDays', { id: ids, companyId: i.companyId })).sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
    const memory = (await this.store.list('attendanceMatches', { companyId: i.companyId })).find((m) => m.key === key) ?? null;
    const personId = e.personId ?? memory?.personId ?? null;
    const person = personId ? await this.store.get('people', personId) : undefined;
    const history = (await this.activeImports([i.companyId]))
      .map((x) => ({ x, emp: x.employees.find((y) => y.key === key || (!!personId && y.personId === personId)) }))
      .filter((h): h is { x: AttendanceImport; emp: AttendanceEmployee } => !!h.emp)
      .map(({ x, emp }) => ({ month: x.month, importId: x.id, key: emp.key, totals: emp.totals, allowances: allowancesOf(emp.totals), strip: emp.strip }))
      .sort((a, b) => a.month.localeCompare(b.month));
    return {
      importId: i.id,
      companyId: i.companyId,
      month: i.month,
      fileName: i.fileName,
      employee: { ...e, allowances: allowancesOf(e.totals) },
      person: person ? { id: person.id, name: person.name, staffNo: person.staffNo, department: person.department ?? null, jobTitle: person.jobTitle ?? null } : null,
      days: days.map((d) => ({ ...d, reasonLabel: reasonLabel(d.reason) })),
      history,
    };
  }

  /** Employees on active imports that no staff record is matched to yet, newest month first. */
  async unmatched(user: User) {
    const companies = await this.importCompanies(user);
    const nameOf = new Map(companies.map((c) => [c.id, c.name]));
    const ids = companies.map((c) => c.id);
    const imports = await this.activeImports(ids);
    const matches = ids.length ? await this.store.list('attendanceMatches', { companyId: ids }) : [];
    const known = new Set(matches.map((m) => `${m.companyId}|${m.key}`));
    const out = new Map<string, { companyId: Id; companyName: string; key: string; empCode: string | null; name: string; designation: string | null; months: string[]; days: number }>();
    for (const i of imports)
      for (const e of i.employees) {
        if (e.personId || known.has(`${i.companyId}|${e.key}`)) continue;
        const k = `${i.companyId}|${e.key}`;
        const row = out.get(k) ?? { companyId: i.companyId, companyName: nameOf.get(i.companyId) ?? i.companyId, key: e.key, empCode: e.empCode, name: e.name, designation: e.designation, months: [], days: 0 };
        row.months.push(i.month);
        row.days += e.totals.days;
        out.set(k, row);
      }
    return [...out.values()].map((r) => ({ ...r, months: r.months.sort().reverse() })).sort((a, b) => a.companyName.localeCompare(b.companyName) || a.name.localeCompare(b.name));
  }

  /** Staff of one company to pick from: name or staff number contains the words typed. */
  async staffSearch(user: User, companyId: Id, q: string) {
    const g = await this.grants();
    if (!this.canImportFor(user, g, companyId)) throw new AccessDenied('hr.profile', companyId);
    const words = normalisePersonName(q).split(' ').filter(Boolean);
    const people = await this.store.list('people', { companyId });
    return people
      .filter((p) => {
        const hay = `${normalisePersonName(p.name)} ${normaliseStaffNo(p.staffNo)}`;
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20)
      .map((p) => ({ id: p.id, name: p.name, staffNo: p.staffNo, jobTitle: p.jobTitle ?? null, department: p.department ?? null }));
  }

  /** Remember (or forget, personId null) which staff record an employee on the reports is, for this and later imports. */
  async match(user: User, companyId: Id, key: string, personId: Id | null) {
    const g = await this.grants();
    if (!this.canImportFor(user, g, companyId)) throw new AccessDenied('hr.profile', companyId);
    if (!/^(code|name):[A-Z0-9 ]{1,160}$/.test(key)) throw new AttendanceReportError('That employee key is not valid.', 400, 'bad_key');
    const id = `am-${sha256Hex(`${companyId}|${key}`).slice(0, 24)}`;
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('attendanceMatches', id);
      const before = await tx.get('attendanceMatches', id);
      if (personId === null) {
        if (!before) return { ok: true, personId: null };
        throw new AttendanceReportError('A remembered match is changed by picking another person; it is never left empty.', 400, 'pick_person');
      }
      const p = await tx.get('people', personId);
      if (!p || p.companyId !== companyId) throw new AttendanceReportError('Pick a staff member of the same company.', 400, 'other_company');
      if (before) await tx.update('attendanceMatches', id, { personId, personName: p.name, byId: user.id, by: user.name, at });
      else await tx.insert('attendanceMatches', { id, companyId, key, personId, personName: p.name, byId: user.id, by: user.name, at });
      await tx.audit({
        at,
        actor: user.name,
        companyId,
        action: 'attendance.report.match',
        entity: 'attendance_match',
        entityId: id,
        summary: `An employee on the attendance reports was matched to staff record ${personId}${before ? ` (was ${before.personId})` : ''}.`,
      });
      return { ok: true, personId };
    });
  }
}

/** The same employee printed twice in one report (a reprinted page): one employee, every day kept. */
function mergeByKey(emps: ReportEmployee[]): ReportEmployee[] {
  const out = new Map<string, ReportEmployee>();
  for (const e of emps) {
    const k = employeeKey(e);
    const had = out.get(k);
    if (!had) out.set(k, { ...e, days: [...e.days], pages: [...e.pages] });
    else {
      had.days.push(...e.days);
      had.pages.push(...e.pages);
      had.totals = null;
      had.monthly = had.monthly ?? e.monthly;
    }
  }
  return [...out.values()];
}
