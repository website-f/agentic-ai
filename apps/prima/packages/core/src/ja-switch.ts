import { AccessDenied } from "./access";
import { GROUP_EMPLOYER_ID } from "./access";
import { isActHead } from "./access";
import { isGroupLeader } from "./access";
import { isGroupRole } from "./access";
import { visibleCompanyIds } from "./access";
import { sha256Hex } from "./audit";
import { RULES } from "./rules";
import { BadRequest as BadInput } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import { daysBetween } from "./time";
import { dateOf } from "./time";
import { fromMs } from "./time";
import { toMs } from "./time";
import type { AuthorityGrant } from "./types";
import type { Company } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { JaRecord } from "./types";
import type { Severity } from "./types";
import type { User } from "./types";


// ---------- Types ----------

/** Areas that move from JA to Prima one at a time, in the recommended order. FWM lives in both apps, so it never switches. */
export type JaSwitchArea = 'incidents' | 'attendance' | 'patrol' | 'payroll' | 'hostels';
export const JA_SWITCH_AREAS: JaSwitchArea[] = ['incidents', 'attendance', 'patrol', 'payroll', 'hostels'];
export const JA_SWITCH_AREA_LABEL: Record<JaSwitchArea, string> = {
  incidents: 'Incidents',
  attendance: 'Attendance',
  patrol: 'Patrol',
  payroll: 'Guard pay',
  hostels: 'Hostels',
};

/** What a JA export file holds. One file is one kind for one company. */
export type JaImportKind = 'attendance' | 'patrol' | 'incidents' | 'payslips' | 'hostels' | 'guards';
export const JA_IMPORT_KINDS: JaImportKind[] = ['attendance', 'patrol', 'incidents', 'payslips', 'hostels', 'guards'];
/** The columns kept for each kind; every other column in the file is ignored and listed. */
export const JA_IMPORT_COLUMNS: Record<JaImportKind, string[]> = {
  attendance: ['staffNo', 'date', 'status', 'hours', 'siteCode'],
  patrol: ['siteCode', 'date', 'scans'],
  incidents: ['externalId', 'occurredAt', 'siteCode', 'category', 'severity', 'status', 'summary'],
  payslips: ['staffNo', 'period', 'gross', 'net', 'epf', 'socso', 'eis', 'pcb'],
  hostels: ['staffNo', 'month', 'hostel'],
  guards: ['staffNo', 'name', 'nationality', 'status', 'joinedOn', 'leftOn', 'siteCode', 'rank'],
};
/** The area whose side-by-side check an import kind feeds; guard records are history only. */
export const JA_IMPORT_AREA: Record<JaImportKind, JaSwitchArea | null> = {
  attendance: 'attendance',
  patrol: 'patrol',
  incidents: 'incidents',
  payslips: 'payroll',
  hostels: 'hostels',
  guards: null,
};

export type JaAttendanceRow = { kind: 'attendance'; staffNo: string; date: IsoDate; status: 'present' | 'absent' | 'leave' | 'off'; hours: number | null; siteCode: string | null };
export type JaPatrolRow = { kind: 'patrol'; siteCode: string; date: IsoDate; scans: number };
export type JaIncidentRow = {
  kind: 'incidents';
  externalId: string;
  occurredAt: IsoDateTime;
  siteCode: string | null;
  category: string;
  severity: Severity;
  status: 'open' | 'closed';
  summary: string;
};
export type JaPayslipRow = { kind: 'payslips'; staffNo: string; period: string; gross: number; net: number; epf: number; socso: number; eis: number; pcb: number };
export type JaHostelRow = { kind: 'hostels'; staffNo: string; month: string; hostel: string | null };
export type JaGuardRow = {
  kind: 'guards';
  staffNo: string;
  name: string;
  nationality: string;
  status: 'active' | 'left' | 'suspended' | 'other';
  joinedOn: IsoDate | null;
  leftOn: IsoDate | null;
  siteCode: string | null;
  rank: string | null;
};
export type JaHistoryRow = JaAttendanceRow | JaPatrolRow | JaIncidentRow | JaPayslipRow | JaHostelRow | JaGuardRow;

/** One staged JA export. Nothing is written until a second person approves it. */
export interface JaImportBatch {
  id: Id;
  companyId: Id;
  kind: JaImportKind;
  /** The days the file covers in full, as the person staging it says. A day with no row inside it means none in JA. */
  from: IsoDate;
  to: IsoDate;
  fileName: string;
  /** SHA-256 of the kept rows; the approver confirms this exact content. */
  fileHash: string;
  rowsInFile: number;
  ignoredColumns: string[];
  refused: { line: number; reason: string }[];
  /** Against what Prima already holds when staged: new records, the same, or different figures that will replace them. */
  counts: { new: number; same: number; changed: number };
  /** Staff numbers in the file that are not on Prima's people list for the company (HR adds them; the import never creates people). */
  unknownStaff: string[];
  rows: JaHistoryRow[];
  staged: { by: string; byId: Id; at: IsoDateTime };
  decision: { decision: 'approved' | 'rejected'; by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /** Records written when approved. */
  written: number;
}

export type JaSwitchState = 'ja' | 'side_by_side' | 'prima';

export interface JaSwitchExplanation {
  key: string;
  kind: 'explained' | 'fixed';
  note: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

/** Where one area stands for one company. */
export interface JaSwitchRecord {
  companyId: Id;
  area: JaSwitchArea;
  state: JaSwitchState;
  run: { from: IsoDate; to: IsoDate; by: string; byId: Id; at: IsoDateTime; note: string; settings?: JaSwitchSettings } | null;
  explanations: JaSwitchExplanation[];
  /** ACT's check of the finished run, bound to the exact report it saw. */
  check: { by: string; byId: Id; at: IsoDateTime; reportHash: string; differences: number; note: string } | null;
  switched: { by: string; byId: Id; at: IsoDateTime; on: IsoDate; reason: string; jaReadOnlyUntil: IsoDate } | null;
  history: { at: IsoDateTime; by: string; byId: Id; action: 'start' | 'check' | 'switch' | 'undo' | 'cancel'; note: string }[];
}

export interface JaDifference {
  key: string;
  date: IsoDate;
  /** Who or where: a staff number, a site code or an incident. */
  subject: string;
  what: string;
  ja: string;
  prima: string;
}

export interface JaComparison {
  area: JaSwitchArea;
  from: IsoDate;
  /** Last day compared: the run's end, or yesterday while it runs. */
  to: IsoDate | null;
  /** False while Prima's side of this area is not built on this branch; nothing can be checked then. */
  primaReady: boolean;
  primaNote: string | null;
  /** Days in the window with no approved JA data: compared as unknown, never as matching. */
  jaMissingDays: IsoDate[];
  matched: number;
  differences: JaDifference[];
}

// ---------- Rule values and the ACT Director's settings ----------

export function jaSwitchRule() {
  return RULES.jaSwitch.value;
}

/**
 * The numbers a side-by-side run uses. The ACT Director sets them (Fauzan, 5 Nov 2026: "Every formula can set by act
 * director"); each run keeps the values it started with, so a later change never moves a report already being checked.
 */
export interface JaSwitchSettings {
  sideBySideDays: number;
  hoursTolerance: number;
  incidentMatchMin: number;
  jaReadOnlyDays: number;
  /** Pay may differ by up to this many ringgit per figure; 0 means to the sen. */
  payToleranceRm: number;
}
export const JA_SETTINGS_LIMITS: Record<keyof JaSwitchSettings, { min: number; max: number; label: string }> = {
  sideBySideDays: { min: 7, max: 92, label: 'Days side by side' },
  hoursTolerance: { min: 0, max: 2, label: 'Attendance hours may differ by (hours)' },
  incidentMatchMin: { min: 5, max: 240, label: 'Incidents match within (minutes)' },
  jaReadOnlyDays: { min: 30, max: 365, label: 'JA read-only after a switch (days)' },
  payToleranceRm: { min: 0, max: 10, label: 'Pay may differ by (RM)' },
};
export const JA_SETTINGS_ID = 'ja:settings';

export function jaDefaultSettings(): JaSwitchSettings {
  const r = jaSwitchRule();
  return { sideBySideDays: r.sideBySideDays, hoursTolerance: r.hoursTolerance, incidentMatchMin: r.incidentMatchMin, jaReadOnlyDays: r.jaReadOnlyDays, payToleranceRm: r.payToleranceRm };
}

/** The group-wide settings record: the current values and every change, with who and why. */
export interface JaSettingsRecord {
  values: JaSwitchSettings;
  history: { at: IsoDateTime; by: string; byId: Id; reason: string; values: JaSwitchSettings }[];
}

// ---------- Who may do what ----------

const isCeo = (u: User) => u.opsTier === 'ceo';
const isCoo = (u: User) => u.opsTier === 'coo';
const isAct = (u: User) => u.role === 'pwvsb_officer' && u.department === 'audit' && !!u.actRole;
/**
 * Who checks the difference report and approves imports. C6 (Fauzan, 11 Nov 2026): the ACT Manager is the second checker;
 * the ACT Director (head) may also check. Never someone who explained a difference in the report or staged the import.
 */
const isActChecker = (u: User) => isAct(u) && (u.actRole === 'manager' || u.actRole === 'lead');
const OPS_EXPLAINERS = ['om', 'regional', 'ogm', 'ops_director'];

/** Who sees the switch-over screen. */
export function canSeeJaSwitch(u: User): boolean {
  if (u.integration || u.role === 'site_device' || u.role === 'guard' || u.role === 'supervisor' || u.role === 'admin_exec') return false;
  if (isGroupLeader(u) || u.role === 'director' || u.role === 'company_manager') return true;
  if (u.role !== 'pwvsb_officer') return false;
  if (isAct(u)) return true;
  if (u.department === 'operations') return OPS_EXPLAINERS.includes(u.opsTier ?? '');
  if (u.department === 'hr') return true;
  if (u.department === 'fwm') return u.fwmRole !== 'despatch';
  return false;
}

/** Who may stage a JA export: anyone in ACT (proposed); the ACT Lead approves it. */
export function canStageJaImport(u: User): boolean {
  return !u.integration && isAct(u);
}

/** Who explains a difference: the people who run that area, the company manager and the COO or CEO. */
export function canExplainJaDifference(u: User, area: JaSwitchArea, companyId: Id): boolean {
  if (u.integration) return false;
  if (isCeo(u) || isCoo(u)) return true;
  if (u.role === 'company_manager') return u.companyIds.includes(companyId);
  if (u.role !== 'pwvsb_officer') return false;
  if (area === 'payroll') return u.department === 'hr';
  if (area === 'hostels') return u.department === 'fwm' && u.fwmRole !== 'despatch';
  return u.department === 'operations' && OPS_EXPLAINERS.includes(u.opsTier ?? '');
}

// ---------- Small helpers ----------

const canon = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(canon)
    : x && typeof x === 'object'
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canon((x as Record<string, unknown>)[k])]),
        )
      : x;
export const jaHash = (x: unknown) => sha256Hex(JSON.stringify(canon(x)));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
/** A full Malaysian IC number. JA keeps the full IC (Fauzan, 2 Nov 2026); Prima refuses it in any column. */
const FULL_IC = /\b\d{6}-?\d{2}-?\d{4}\b/;
const SEVERITIES: Severity[] = ['P1', 'P2', 'P3', 'P4'];

function validDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

function days(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to && out.length < 4000; d = addDays(d, 1)) out.push(d);
  return out;
}

const money = (n: number) => `RM${n.toFixed(2)}`;
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const monthEnd = (month: string) => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);

/** The key a history row is stored under, so a later file for the same thing replaces it. */
export function jaRowKey(r: JaHistoryRow): string {
  switch (r.kind) {
    case 'attendance':
      return `${r.staffNo}:${r.date}`;
    case 'patrol':
      return `${r.siteCode}:${r.date}`;
    case 'incidents':
      return r.externalId;
    case 'payslips':
      return `${r.staffNo}:${r.period}`;
    case 'hostels':
      return `${r.staffNo}:${r.month}`;
    case 'guards':
      return r.staffNo;
  }
}

/** The date a history row belongs to, for the import's covered days. */
function rowDate(r: JaHistoryRow): IsoDate | null {
  switch (r.kind) {
    case 'attendance':
    case 'patrol':
      return r.date;
    case 'incidents':
      return dateOf(r.occurredAt);
    case 'payslips':
      return monthEnd(r.period);
    case 'hostels':
      return monthEnd(r.month);
    case 'guards':
      return null;
  }
}

/** A record without its id and company, which a database update never changes. */
function patchOf(r: JaRecord): Partial<JaRecord> {
  const { id: _id, companyId: _companyId, ...rest } = r;
  return rest;
}

export const jaRecordId = (companyId: Id, kind: JaImportKind, key: string) => `ja:hist:${kind}:${companyId}:${key}`.slice(0, 200);
/** The values a run was started with (runs from before the ACT Director's settings use the rule's). */
export const runSettings = (rec: JaSwitchRecord): JaSwitchSettings => rec.run?.settings ?? jaDefaultSettings();
export const jaSwitchId = (companyId: Id, area: JaSwitchArea) => `ja:switch:${companyId}:${area}`;

// ---------- Reading one JA export ----------

/**
 * Check every row of a JA export and keep only the columns Prima uses. A row with a problem is refused with its line
 * number and reason, never dropped silently. Duplicates inside the file are refused too.
 */
export function parseJaImportRows(
  kind: JaImportKind,
  raw: unknown[],
): { rows: JaHistoryRow[]; lines: number[]; refused: { line: number; reason: string }[]; ignoredColumns: string[] } {
  const keep = JA_IMPORT_COLUMNS[kind];
  const ignored = new Set<string>();
  const rows: JaHistoryRow[] = [];
  const lines: number[] = [];
  const refused: { line: number; reason: string }[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const line = i + 1;
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Not a row.');
      const it = item as Record<string, unknown>;
      for (const k of Object.keys(it)) if (!keep.includes(k)) ignored.add(k.slice(0, 40));
      for (const k of keep) {
        const v = it[k];
        if (typeof v === 'string' && FULL_IC.test(v)) throw new Error(`${k} holds what looks like a full IC number; JA keeps full IC numbers, Prima does not.`);
      }
      const row = parseRow(kind, it);
      const key = jaRowKey(row);
      if (seen.has(key)) throw new Error(`The same ${kind === 'incidents' ? 'incident' : 'record'} (${key}) is in the file twice.`);
      seen.add(key);
      rows.push(row);
      lines.push(line);
    } catch (e) {
      refused.push({ line, reason: e instanceof Error ? e.message : 'Not valid.' });
    }
  });
  return { rows, lines, refused, ignoredColumns: [...ignored].sort() };
}

function parseRow(kind: JaImportKind, it: Record<string, unknown>): JaHistoryRow {
  const text = (k: string, max: number, required = true): string | null => {
    const v = it[k];
    if (v == null || (typeof v === 'string' && !v.trim())) {
      if (required) throw new Error(`${k} is missing.`);
      return null;
    }
    const s = String(v).trim();
    if (s.length > max) throw new Error(`${k} is longer than ${max} characters.`);
    if (/[\u0000-\u001f\u007f]/.test(s)) throw new Error(`${k} has control characters.`);
    return s;
  };
  const date = (k: string, required = true): IsoDate | null => {
    const s = text(k, 10, required);
    if (s == null) return null;
    if (!validDate(s)) throw new Error(`${k} must be a date like 2026-10-26.`);
    return s;
  };
  const month = (k: string): string => {
    const s = text(k, 7)!;
    if (!MONTH.test(s) || Number(s.slice(5)) < 1 || Number(s.slice(5)) > 12) throw new Error(`${k} must be a month like 2026-10.`);
    return s;
  };
  const num = (k: string, max: number, required = true): number | null => {
    const v = it[k];
    if (v == null || v === '') {
      if (required) throw new Error(`${k} is missing.`);
      return null;
    }
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').replace(/^RM\s*/i, ''));
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${k} must be a number from 0 to ${max}.`);
    return n;
  };
  const rm = (k: string) => Math.round(num(k, 1_000_000)! * 100) / 100;
  switch (kind) {
    case 'attendance': {
      const status = norm(text('status', 20));
      if (!['present', 'absent', 'leave', 'off'].includes(status)) throw new Error('status must be present, absent, leave or off.');
      const hours = num('hours', 24, status === 'present');
      return {
        kind,
        staffNo: text('staffNo', 40)!,
        date: date('date')!,
        status: status as JaAttendanceRow['status'],
        hours: hours == null ? null : Math.round(hours * 100) / 100,
        siteCode: text('siteCode', 40, false),
      };
    }
    case 'patrol': {
      const scans = num('scans', 10_000)!;
      if (!Number.isInteger(scans)) throw new Error('scans must be a whole number.');
      return { kind, siteCode: text('siteCode', 40)!, date: date('date')!, scans };
    }
    case 'incidents': {
      const at = text('occurredAt', 40)!;
      const ms = Date.parse(at);
      if (Number.isNaN(ms) || !/[T ]\d{2}:\d{2}/.test(at)) throw new Error('occurredAt must be a date and time.');
      const severity = String(it.severity ?? '').trim().toUpperCase() as Severity;
      if (!SEVERITIES.includes(severity)) throw new Error('severity must be P1 to P4.');
      const status = norm(text('status', 10));
      if (status !== 'open' && status !== 'closed') throw new Error('status must be open or closed.');
      return {
        kind,
        externalId: text('externalId', 80)!,
        occurredAt: fromMs(ms),
        siteCode: text('siteCode', 40, false),
        category: text('category', 80)!,
        severity,
        status,
        summary: text('summary', 2000)!,
      };
    }
    case 'payslips': {
      const row: JaPayslipRow = {
        kind,
        staffNo: text('staffNo', 40)!,
        period: month('period'),
        gross: rm('gross'),
        net: rm('net'),
        epf: rm('epf'),
        socso: rm('socso'),
        eis: rm('eis'),
        pcb: rm('pcb'),
      };
      if (row.net > row.gross) throw new Error('net is more than gross.');
      return row;
    }
    case 'hostels':
      return { kind, staffNo: text('staffNo', 40)!, month: month('month'), hostel: text('hostel', 120, false) };
    case 'guards': {
      const status = norm(text('status', 20));
      const joinedOn = date('joinedOn', false);
      const leftOn = date('leftOn', false);
      if (joinedOn && leftOn && leftOn < joinedOn) throw new Error('leftOn is before joinedOn.');
      return {
        kind,
        staffNo: text('staffNo', 40)!,
        name: text('name', 200)!,
        nationality: text('nationality', 60)!,
        status: (['active', 'left', 'suspended'].includes(status) ? status : 'other') as JaGuardRow['status'],
        joinedOn,
        leftOn,
        siteCode: text('siteCode', 40, false),
        rank: text('rank', 60, false),
      };
    }
  }
}

// ---------- Side-by-side comparisons (pure) ----------

export interface PrimaAttendanceDay {
  staffNo: string;
  date: IsoDate;
  /** Hours on duty that day; null while still clocked in. */
  hours: number | null;
  present: boolean;
}

/** Attendance per guard per day. Hours may differ by up to the rule's tolerance. */
export function compareAttendance(ja: JaAttendanceRow[], prima: PrimaAttendanceDay[], toleranceHours: number): { matched: number; differences: JaDifference[] } {
  const p = new Map(prima.map((r) => [`${r.staffNo}:${r.date}`, r]));
  const j = new Map(ja.map((r) => [`${r.staffNo}:${r.date}`, r]));
  const keys = [...new Set([...p.keys(), ...j.keys()])].sort();
  const differences: JaDifference[] = [];
  let matched = 0;
  for (const k of keys) {
    const a = j.get(k);
    const b = p.get(k);
    const [staffNo, date] = [a?.staffNo ?? b!.staffNo, a?.date ?? b!.date];
    const jaPresent = a?.status === 'present';
    const primaPresent = !!b?.present;
    const diff = (what: string, jaText: string, primaText: string) =>
      differences.push({ key: `attendance:${k}`, date, subject: staffNo, what, ja: jaText, prima: primaText });
    if (jaPresent && primaPresent) {
      if (a!.hours != null && b!.hours != null && Math.abs(a!.hours - b!.hours) > toleranceHours)
        diff('Hours differ', `${a!.hours} h`, `${b!.hours} h`);
      else matched++;
    } else if (jaPresent) diff('Present in JA, no clock-in in Prima', `present ${a!.hours ?? '?'} h`, 'no clock-in');
    else if (primaPresent) diff(a ? `JA says ${a.status}, Prima has a clock-in` : 'Clock-in in Prima, nothing in JA', a ? a.status : 'no row', `present ${b!.hours ?? 'still on duty'}${b!.hours == null ? '' : ' h'}`);
    else matched++;
  }
  return { matched, differences };
}

/** Patrol tag scans per site per day. */
export function comparePatrol(ja: JaPatrolRow[], prima: { siteCode: string; date: IsoDate; scans: number }[]): { matched: number; differences: JaDifference[] } {
  const p = new Map(prima.map((r) => [`${r.siteCode}:${r.date}`, r]));
  const j = new Map(ja.map((r) => [`${r.siteCode}:${r.date}`, r]));
  const differences: JaDifference[] = [];
  let matched = 0;
  for (const k of [...new Set([...p.keys(), ...j.keys()])].sort()) {
    const a = j.get(k)?.scans ?? 0;
    const b = p.get(k)?.scans ?? 0;
    const r = j.get(k) ?? p.get(k)!;
    if (a === b) matched++;
    else differences.push({ key: `patrol:${k}`, date: r.date, subject: r.siteCode, what: 'Tag scans differ', ja: String(a), prima: String(b) });
  }
  return { matched, differences };
}

export interface PrimaIncident {
  ref: string;
  siteCode: string | null;
  at: IsoDateTime;
  severity: Severity;
  closed: boolean;
}

/**
 * Incidents matched by site and time (within the rule's minutes), nearest first. Unmatched incidents on either side,
 * and matched ones whose severity or open/closed state differ, are differences.
 */
export function compareIncidents(ja: JaIncidentRow[], prima: PrimaIncident[], windowMin: number): { matched: number; differences: JaDifference[] } {
  const pairs: { j: number; p: number; gap: number }[] = [];
  ja.forEach((a, ji) =>
    prima.forEach((b, pi) => {
      if (norm(a.siteCode) !== norm(b.siteCode)) return;
      const gap = Math.abs(toMs(a.occurredAt) - toMs(b.at)) / 60_000;
      if (gap <= windowMin) pairs.push({ j: ji, p: pi, gap });
    }),
  );
  pairs.sort((x, y) => x.gap - y.gap || x.j - y.j || x.p - y.p);
  const usedJ = new Set<number>();
  const usedP = new Set<number>();
  const differences: JaDifference[] = [];
  let matched = 0;
  for (const pr of pairs) {
    if (usedJ.has(pr.j) || usedP.has(pr.p)) continue;
    usedJ.add(pr.j);
    usedP.add(pr.p);
    const a = ja[pr.j];
    const b = prima[pr.p];
    const notes: string[] = [];
    if (a.severity !== b.severity) notes.push('severity');
    if ((a.status === 'closed') !== b.closed) notes.push('open or closed');
    if (notes.length)
      differences.push({
        key: `incidents:${a.externalId}`,
        date: dateOf(a.occurredAt),
        subject: `${a.siteCode ?? 'no site'} · ${a.externalId} / ${b.ref}`,
        what: `Same incident, ${notes.join(' and ')} differ`,
        ja: `${a.severity}, ${a.status}`,
        prima: `${b.severity}, ${b.closed ? 'closed' : 'open'}`,
      });
    else matched++;
  }
  ja.forEach((a, i) => {
    if (!usedJ.has(i))
      differences.push({
        key: `incidents:${a.externalId}`,
        date: dateOf(a.occurredAt),
        subject: `${a.siteCode ?? 'no site'} · ${a.externalId}`,
        what: 'In JA, not in Prima',
        ja: `${a.severity} ${a.category} at ${a.occurredAt.slice(11, 16)}`,
        prima: 'none',
      });
  });
  prima.forEach((b, i) => {
    if (!usedP.has(i))
      differences.push({
        key: `incidents:prima:${b.ref}`,
        date: dateOf(b.at),
        subject: `${b.siteCode ?? 'no site'} · ${b.ref}`,
        what: 'In Prima, not in JA',
        ja: 'none',
        prima: `${b.severity} at ${b.at.slice(11, 16)}`,
      });
  });
  differences.sort((x, y) => x.date.localeCompare(y.date) || x.key.localeCompare(y.key));
  return { matched, differences };
}

/** Guard pay per guard per month, to the sen. */
export function comparePayroll(ja: JaPayslipRow[], prima: Omit<JaPayslipRow, 'kind'>[], toleranceRm = 0): { matched: number; differences: JaDifference[] } {
  const p = new Map(prima.map((r) => [`${r.staffNo}:${r.period}`, r]));
  const j = new Map(ja.map((r) => [`${r.staffNo}:${r.period}`, r]));
  const differences: JaDifference[] = [];
  let matched = 0;
  const fields = ['gross', 'net', 'epf', 'socso', 'eis', 'pcb'] as const;
  for (const k of [...new Set([...p.keys(), ...j.keys()])].sort()) {
    const a = j.get(k);
    const b = p.get(k);
    const r = (a ?? b)!;
    const date = monthEnd(r.period);
    if (!a || !b) {
      differences.push({
        key: `payroll:${k}`,
        date,
        subject: r.staffNo,
        what: a ? `Paid in JA for ${r.period}, no Prima payslip` : `Prima payslip for ${r.period}, none in JA`,
        ja: a ? `net ${money(a.net)}` : 'none',
        prima: b ? `net ${money(b.net)}` : 'none',
      });
      continue;
    }
    const off = fields.filter((f) => Math.abs(Math.round(a[f] * 100) - Math.round(b[f] * 100)) > Math.round(toleranceRm * 100));
    if (!off.length) matched++;
    else
      differences.push({
        key: `payroll:${k}`,
        date,
        subject: r.staffNo,
        what: `${off.join(', ')} differ for ${r.period}`,
        ja: off.map((f) => `${f} ${money(a[f])}`).join(', '),
        prima: off.map((f) => `${f} ${money(b[f])}`).join(', '),
      });
  }
  return { matched, differences };
}

/** Which hostel each worker is in at each month end (or the run's last day). */
export function compareHostels(ja: JaHostelRow[], prima: { staffNo: string; month: string; hostel: string | null }[]): { matched: number; differences: JaDifference[] } {
  const p = new Map(prima.map((r) => [`${r.staffNo}:${r.month}`, r]));
  const j = new Map(ja.map((r) => [`${r.staffNo}:${r.month}`, r]));
  const differences: JaDifference[] = [];
  let matched = 0;
  for (const k of [...new Set([...p.keys(), ...j.keys()])].sort()) {
    const a = j.get(k)?.hostel ?? null;
    const b = p.get(k)?.hostel ?? null;
    const r = (j.get(k) ?? p.get(k))!;
    if (norm(a) === norm(b)) matched++;
    else differences.push({ key: `hostels:${k}`, date: monthEnd(r.month), subject: r.staffNo, what: 'Hostel differs', ja: a ?? 'no hostel', prima: b ?? 'no hostel' });
  }
  return { matched, differences };
}

/** The report a check is bound to: the window, the missing days, every difference and every explanation. */
export function jaReportHash(c: JaComparison, explanations: JaSwitchExplanation[], settings?: JaSwitchSettings): string {
  const open = new Set(c.differences.map((d) => d.key));
  return jaHash({
    settings: settings ?? null,
    area: c.area,
    from: c.from,
    to: c.to,
    primaReady: c.primaReady,
    missing: c.jaMissingDays,
    differences: c.differences.map((d) => [d.key, d.what, d.ja, d.prima]),
    explanations: explanations.filter((e) => open.has(e.key)).map((e) => [e.key, e.kind, e.note, e.byId]),
  });
}

// ---------- The service ----------

type Ctx = { user: User; companyIds: Id[]; companies: Company[] };

function str(v: unknown, name: string, min: number, max: number): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new BadInput(`Give ${name} (${min} to ${max} characters).`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) throw new BadInput(`${name} has control characters.`);
  return v.trim();
}


export class JaSwitchService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private grants: () => Promise<AuthorityGrant[]>,
  ) {}

  private today(): IsoDate {
    return dateOf(this.clock());
  }

  private async ctx(user: User): Promise<Ctx> {
    if (!canSeeJaSwitch(user)) throw new AccessDenied('view', '(switch-over from JA)');
    const companyIds = visibleCompanyIds(user, await this.grants(), this.today());
    const companies = (await this.store.list('companies', {})).filter((c) => companyIds.includes(c.id));
    return { user, companyIds: companies.map((c) => c.id), companies };
  }

  private company(ctx: Ctx, companyId: unknown): Company {
    const c = ctx.companies.find((x) => x.id === companyId);
    if (!c) throw new AccessDenied('view', String(companyId).slice(0, 40));
    return c;
  }

  private area(area: unknown): JaSwitchArea {
    if (!JA_SWITCH_AREAS.includes(area as JaSwitchArea)) throw new BadInput(`Area must be one of: ${JA_SWITCH_AREAS.join(', ')}.`);
    return area as JaSwitchArea;
  }

  private async switchRecord(companyId: Id, area: JaSwitchArea, store = this.store): Promise<JaSwitchRecord> {
    const row = await store.get('jaRecords', jaSwitchId(companyId, area));
    return (
      row?.jaSwitch ?? { companyId, area, state: 'ja', run: null, explanations: [], check: null, switched: null, history: [] }
    );
  }

  private async saveSwitch(store: Store, rec: JaSwitchRecord): Promise<void> {
    const id = jaSwitchId(rec.companyId, rec.area);
    const at = this.clock();
    const row: JaRecord = { id, companyId: rec.companyId, dataset: 'switch', externalId: rec.area, sourceUpdatedAt: at, receivedAt: at, jaSwitch: rec };
    if (await store.get('jaRecords', id)) await store.update('jaRecords', id, patchOf(row));
    else await store.insert('jaRecords', row);
  }

  /** Which system is the record for an area at a company today. */
  async systemOfRecord(companyId: Id, area: JaSwitchArea): Promise<'ja' | 'prima'> {
    return (await this.switchRecord(companyId, area)).state === 'prima' ? 'prima' : 'ja';
  }

  // ----- Data on each side -----

  private async jaRows<K extends JaImportKind>(companyId: Id, kind: K): Promise<Extract<JaHistoryRow, { kind: K }>[]> {
    return (await this.store.list('jaRecords', { companyId, dataset: `hist_${kind}` as JaRecord['dataset'] }))
      .map((r) => r.jaRow)
      .filter((r): r is Extract<JaHistoryRow, { kind: K }> => r?.kind === kind);
  }

  /** Days covered by approved JA files (and, for incidents, live feed deliveries that covered the company). */
  private async jaCoveredDays(companyId: Id, kind: JaImportKind): Promise<Set<IsoDate>> {
    const covered = new Set<IsoDate>();
    for (const r of await this.store.list('jaRecords', { companyId, dataset: 'import' })) {
      const b = r.jaImport;
      if (b && b.kind === kind && b.decision?.decision === 'approved') for (const d of days(b.from, b.to)) covered.add(d);
    }
    if (kind === 'incidents')
      for (const s of await this.store.list('jaSyncs', {})) if (s.dataset === 'incident' && s.covered?.includes(companyId)) covered.add(dateOf(s.at));
    return covered;
  }

  /** The difference report for one company and area over its run (or a given window). */
  async compare(companyId: Id, area: JaSwitchArea, from: IsoDate, to: IsoDate, rule: JaSwitchSettings = jaDefaultSettings()): Promise<JaComparison> {
    const end = to < addDays(this.today(), -1) ? to : addDays(this.today(), -1);
    const base: JaComparison = { area, from, to: end >= from ? end : null, primaReady: true, primaNote: null, jaMissingDays: [], matched: 0, differences: [] };
    if (base.to == null) return base;
    const window = days(from, base.to);
    const kind = (Object.keys(JA_IMPORT_AREA) as JaImportKind[]).find((k) => JA_IMPORT_AREA[k] === area)!;
    const covered = await this.jaCoveredDays(companyId, kind);
    const wanted = area === 'payroll' || area === 'hostels' ? window.filter((d) => d === monthEnd(d.slice(0, 7)) || d === base.to) : window;
    base.jaMissingDays = wanted.filter((d) => !covered.has(d));
    const inWindow = (d: IsoDate) => d >= from && d <= base.to! && covered.has(d);
    const people = await this.store.list('people', { companyId });
    const staffNo = new Map(people.map((p) => [p.id, p.staffNo]));
    const sites = await this.store.list('sites', { companyId });
    const siteCode = new Map(sites.map((s) => [s.id, s.code]));

    let result: { matched: number; differences: JaDifference[] };
    if (area === 'attendance') {
      const byKey = new Map<string, PrimaAttendanceDay>();
      for (const a of await this.store.list('attendance', { companyId })) {
        if (!a.clockIn) continue;
        const date = dateOf(a.clockIn);
        const sn = staffNo.get(a.personId);
        if (!sn || !inWindow(date)) continue;
        const k = `${sn}:${date}`;
        const h = a.clockOut ? Math.round(((toMs(a.clockOut) - toMs(a.clockIn)) / 3_600_000) * 100) / 100 : null;
        const old = byKey.get(k);
        byKey.set(k, { staffNo: sn, date, present: true, hours: old ? (old.hours == null || h == null ? null : Math.round((old.hours + h) * 100) / 100) : h });
      }
      const ja = (await this.jaRows(companyId, 'attendance')).filter((r) => inWindow(r.date));
      result = compareAttendance(ja, [...byKey.values()], rule.hoursTolerance);
    } else if (area === 'patrol') {
      const count = new Map<string, { siteCode: string; date: IsoDate; scans: number }>();
      for (const s of await this.store.list('scans', { companyId })) {
        const date = dateOf(s.at);
        const code = siteCode.get(s.siteId);
        if (!code || !inWindow(date)) continue;
        const k = `${code}:${date}`;
        const c = count.get(k) ?? { siteCode: code, date, scans: 0 };
        c.scans++;
        count.set(k, c);
      }
      const ja = (await this.jaRows(companyId, 'patrol')).filter((r) => inWindow(r.date));
      result = comparePatrol(ja, [...count.values()]);
    } else if (area === 'incidents') {
      const prima: PrimaIncident[] = (await this.store.list('cases', { companyId }))
        .filter((c) => (c.type === 'INCIDENT' || c.type === 'SOS') && inWindow(dateOf(c.openedAt)))
        .map((c) => ({ ref: c.ref, siteCode: c.siteId ? (siteCode.get(c.siteId) ?? null) : null, at: c.openedAt, severity: c.severity, closed: c.status === 'resolved' || c.status === 'closed' }));
      const fromFile = (await this.jaRows(companyId, 'incidents')).filter((r) => inWindow(dateOf(r.occurredAt)));
      const ids = new Set(fromFile.map((r) => r.externalId));
      const fromFeed: JaIncidentRow[] = (await this.store.list('jaRecords', { companyId, dataset: 'incident' }))
        .filter((r) => r.incident && !ids.has(r.externalId) && inWindow(dateOf(r.incident.occurredAt)))
        .map((r) => ({ kind: 'incidents', externalId: r.externalId, occurredAt: r.incident!.occurredAt, siteCode: r.incident!.siteCode ?? null, category: r.incident!.category, severity: r.incident!.severity, status: r.incident!.status, summary: r.incident!.summary }));
      result = compareIncidents([...fromFile, ...fromFeed], prima, rule.incidentMatchMin);
    } else if (area === 'payroll') {
      // Prima's own guard pay runs (PR #120): the COO-approved (or paid) run of each month, against JA's payslips.
      if (this.store.guardPayReady && !(await this.store.guardPayReady()))
        return { ...base, primaReady: false, primaNote: "The guard pay run's database part is not installed, so guard pay cannot be compared yet." };
      const months = [...new Set(wanted.map((d) => d.slice(0, 7)))];
      const runs = await this.store.list('guardPayRuns', { companyId });
      const prima: Omit<JaPayslipRow, 'kind'>[] = [];
      const missing: string[] = [];
      for (const m of months) {
        const run = runs
          .filter((r) => r.period === m && (r.stage === 'approved' || r.stage === 'paid'))
          .sort((a, b) => b.prepared.at.localeCompare(a.prepared.at))[0];
        if (!run) {
          missing.push(m);
          continue;
        }
        // A guard with nothing to pay gets no payslip in JA either, so only paid lines are compared.
        for (const l of run.lines.filter((x) => x.gross > 0 || x.net !== 0)) prima.push({ staffNo: l.staffNo, period: m, gross: l.gross, net: l.net, epf: l.epfEe, socso: l.socsoEe, eis: l.eisEe, pcb: l.pcb });
      }
      if (missing.length)
        return { ...base, primaReady: false, primaNote: `No COO-approved Prima guard pay run yet for ${missing.join(', ')}. HR prepares it and the COO approves it first.` };
      const ja = (await this.jaRows(companyId, 'payslips')).filter((r) => months.includes(r.period));
      result = comparePayroll(ja, prima, rule.payToleranceRm);
    } else {
      const hostels = new Map((await this.store.list('hostels', { companyId })).map((h) => [h.id, h.name]));
      const stays = await this.store.list('hostelStays', { companyId });
      const months = [...new Set(wanted.filter((d) => covered.has(d)).map((d) => d.slice(0, 7)))];
      const prima: { staffNo: string; month: string; hostel: string | null }[] = [];
      for (const m of months) {
        const on = monthEnd(m) <= base.to ? monthEnd(m) : base.to;
        for (const s of stays) {
          const sn = staffNo.get(s.personId);
          if (sn && s.from <= on && (!s.to || s.to >= on)) prima.push({ staffNo: sn, month: m, hostel: hostels.get(s.hostelId) ?? null });
        }
      }
      const ja = (await this.jaRows(companyId, 'hostels')).filter((r) => months.includes(r.month));
      result = compareHostels(ja, prima);
    }
    return { ...base, ...result };
  }

  // ----- The ACT Director's settings -----

  /** The current group values; anyone who cannot read the group record gets the rule's values. */
  async settings(store = this.store): Promise<JaSwitchSettings> {
    const row = await store.get('jaRecords', JA_SETTINGS_ID).catch(() => undefined);
    return { ...jaDefaultSettings(), ...(row?.jaSettings?.values ?? {}) };
  }

  /** Only the ACT Director changes the numbers, with a reason. Runs already started keep theirs. */
  async setSettings(user: User, body: Record<string, unknown>) {
    if (user.integration || !isActHead(user)) throw new AccessDenied('view', '(only the ACT Director sets the switch-over numbers)');
    const reason = str(body.reason, 'the reason', 10, 1000);
    return this.store.transaction(async (tx) => {
      await tx.lock?.('jaRecords', JA_SETTINGS_ID);
      const row = await tx.get('jaRecords', JA_SETTINGS_ID);
      const values = { ...(row?.jaSettings?.values ?? jaDefaultSettings()) };
      const input = (body.values ?? {}) as Record<string, unknown>;
      for (const [k, lim] of Object.entries(JA_SETTINGS_LIMITS) as [keyof JaSwitchSettings, (typeof JA_SETTINGS_LIMITS)[keyof JaSwitchSettings]][]) {
        if (input[k] == null || input[k] === '') continue;
        const n = Number(input[k]);
        if (!Number.isFinite(n) || n < lim.min || n > lim.max) throw new BadInput(`${lim.label} must be from ${lim.min} to ${lim.max}.`);
        if ((k === 'sideBySideDays' || k === 'jaReadOnlyDays' || k === 'incidentMatchMin') && !Number.isInteger(n)) throw new BadInput(`${lim.label} must be a whole number.`);
        values[k] = Math.round(n * 100) / 100;
      }
      const at = this.clock();
      const rec: JaSettingsRecord = { values, history: [...(row?.jaSettings?.history ?? []), { at, by: user.name, byId: user.id, reason, values }].slice(-50) };
      if (row) await tx.update('jaRecords', JA_SETTINGS_ID, { sourceUpdatedAt: at, receivedAt: at, jaSettings: rec });
      else
        await tx.insert('jaRecords', { id: JA_SETTINGS_ID, companyId: GROUP_EMPLOYER_ID, dataset: 'settings', externalId: 'settings', sourceUpdatedAt: at, receivedAt: at, jaSettings: rec });
      await tx.audit({
        at,
        actor: user.name,
        companyId: null,
        action: 'ja.switch.settings',
        entity: 'ja_switch',
        entityId: JA_SETTINGS_ID,
        summary: `Switch-over numbers set: ${Object.entries(values).map(([k, v]) => `${k} ${v}`).join(', ')}. ${reason}`,
      });
      return values;
    });
  }

  // ----- Screens -----

  async board(user: User) {
    const ctx = await this.ctx(user);
    const rule = jaSwitchRule();
    const today = this.today();
    const rows = [];
    for (const c of ctx.companies) {
      for (const area of JA_SWITCH_AREAS) {
        const rec = await this.switchRecord(c.id, area);
        let summary: { differences: number; explained: number; jaMissingDays: number; primaReady: boolean; compared: number; checkStale: boolean } | null = null;
        if (rec.run) {
          const cmp = await this.compare(c.id, area, rec.run.from, rec.run.to, runSettings(rec));
          const keys = new Set(cmp.differences.map((d) => d.key));
          summary = {
            differences: cmp.differences.length,
            explained: rec.explanations.filter((e) => keys.has(e.key)).length,
            jaMissingDays: cmp.jaMissingDays.length,
            primaReady: cmp.primaReady,
            compared: cmp.to ? daysBetween(cmp.from, cmp.to) + 1 : 0,
            checkStale: !!rec.check && rec.check.reportHash !== jaReportHash(cmp, rec.explanations, runSettings(rec)),
          };
        }
        if (!rec.run && rec.state === 'ja' && !rec.history.length) {
          rows.push({ companyId: c.id, companyName: c.name, area, state: rec.state, run: null, summary: null, check: null, switched: null, ended: false, ...this.can(user, rec, c.id, null, today) });
          continue;
        }
        rows.push({
          companyId: c.id,
          companyName: c.name,
          area,
          state: rec.state,
          run: rec.run,
          summary,
          check: rec.check,
          switched: rec.switched,
          ended: !!rec.run && rec.run.to < today,
          ...this.can(user, rec, c.id, summary, today),
        });
      }
    }
    const imports = [];
    for (const c of ctx.companies)
      for (const r of await this.store.list('jaRecords', { companyId: c.id, dataset: 'import' })) {
        const b = r.jaImport!;
        imports.push({
          id: b.id,
          companyId: b.companyId,
          companyName: c.name,
          kind: b.kind,
          from: b.from,
          to: b.to,
          fileName: b.fileName,
          fileHash: b.fileHash,
          rowsInFile: b.rowsInFile,
          kept: b.rows.length || b.written,
          refused: b.refused.slice(0, 50),
          refusedCount: b.refused.length,
          ignoredColumns: b.ignoredColumns,
          counts: b.counts,
          unknownStaff: b.unknownStaff.slice(0, 50),
          unknownStaffCount: b.unknownStaff.length,
          staged: b.staged,
          decision: b.decision,
          written: b.written,
          canDecide: !b.decision && isActChecker(user) && user.id !== b.staged.byId,
        });
      }
    imports.sort((a, b) => b.staged.at.localeCompare(a.staged.at));
    const history: Record<JaImportKind, number> = { attendance: 0, patrol: 0, incidents: 0, payslips: 0, hostels: 0, guards: 0 };
    for (const c of ctx.companies) for (const k of JA_IMPORT_KINDS) history[k] += (await this.store.list('jaRecords', { companyId: c.id, dataset: `hist_${k}` as JaRecord['dataset'] })).length;
    return {
      today,
      rule: { ...rule },
      areas: JA_SWITCH_AREAS.map((a) => ({ area: a, label: JA_SWITCH_AREA_LABEL[a] })),
      companies: ctx.companies.map((c) => ({ id: c.id, name: c.name, code: c.code })),
      rows,
      imports,
      history,
      canStage: canStageJaImport(user),
      // The numbers are a group record: a company sign-in (company manager) cannot read it on the database, so it is
      // not shown to them rather than shown as the standard numbers. Each run carries its own numbers in the report.
      settingsShown: isGroupRole(user),
      settings: isGroupRole(user) ? await this.settings() : jaDefaultSettings(),
      settingsLimits: JA_SETTINGS_LIMITS,
      settingsHistory: isGroupRole(user) ? ((await this.store.get('jaRecords', JA_SETTINGS_ID).catch(() => undefined))?.jaSettings?.history.slice(-10).reverse() ?? []) : [],
      canSetSettings: isActHead(user),
      importKinds: JA_IMPORT_KINDS.map((k) => ({ kind: k, columns: JA_IMPORT_COLUMNS[k], area: JA_IMPORT_AREA[k] })),
    };
  }

  private can(user: User, rec: JaSwitchRecord, companyId: Id, s: { differences: number; explained: number; jaMissingDays: number; primaReady: boolean; checkStale: boolean } | null, today: IsoDate) {
    const ended = !!rec.run && rec.run.to < today;
    const clean = !!s && s.primaReady && s.jaMissingDays === 0 && s.explained === s.differences;
    const explainers = new Set(rec.explanations.map((e) => e.byId));
    return {
      canStart: (isCeo(user) || isCoo(user)) && rec.state === 'ja',
      canCancel: (isCeo(user) || isCoo(user)) && rec.state === 'side_by_side',
      canExplain: rec.state === 'side_by_side' && canExplainJaDifference(user, rec.area, companyId),
      canCheck: rec.state === 'side_by_side' && ended && clean && isActChecker(user) && !explainers.has(user.id) && (!rec.check || s!.checkStale),
      canSwitch: rec.state === 'side_by_side' && isCeo(user) && !!rec.check && !!s && !s.checkStale && clean,
      canUndo: rec.state === 'prima' && isCeo(user),
    };
  }

  /** The full difference report for one company and area. */
  async report(user: User, companyId: unknown, areaIn: unknown) {
    const ctx = await this.ctx(user);
    const c = this.company(ctx, companyId);
    const area = this.area(areaIn);
    const rec = await this.switchRecord(c.id, area);
    if (!rec.run) return { companyId: c.id, companyName: c.name, area, state: rec.state, run: null, comparison: null, reportHash: null, explanations: [], check: rec.check, switched: rec.switched, history: rec.history };
    const cmp = await this.compare(c.id, area, rec.run.from, rec.run.to, runSettings(rec));
    const keys = new Set(cmp.differences.map((d) => d.key));
    return {
      companyId: c.id,
      companyName: c.name,
      area,
      state: rec.state,
      run: rec.run,
      comparison: { ...cmp, differences: cmp.differences.slice(0, jaSwitchRule().reportRows), total: cmp.differences.length },
      reportHash: jaReportHash(cmp, rec.explanations, runSettings(rec)),
      explanations: rec.explanations.filter((e) => keys.has(e.key)),
      check: rec.check,
      switched: rec.switched,
      history: rec.history,
      ...this.can(
        user,
        rec,
        c.id,
        {
          differences: cmp.differences.length,
          explained: rec.explanations.filter((e) => keys.has(e.key)).length,
          jaMissingDays: cmp.jaMissingDays.length,
          primaReady: cmp.primaReady,
          checkStale: !!rec.check && rec.check.reportHash !== jaReportHash(cmp, rec.explanations, runSettings(rec)),
        },
        this.today(),
      ),
    };
  }

  // ----- Actions on a switch -----

  async act(user: User, companyId: unknown, areaIn: unknown, action: unknown, body: Record<string, unknown>) {
    const ctx = await this.ctx(user);
    const c = this.company(ctx, companyId);
    const area = this.area(areaIn);
    const today = this.today();
    const rule = jaSwitchRule();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('jaRecords', jaSwitchId(c.id, area));
      const rec = await this.switchRecord(c.id, area, tx);
      const at = this.clock();
      const who = { by: user.name, byId: user.id, at };
      let summary: string;
      if (action === 'start') {
        if (!isCeo(user) && !isCoo(user)) throw new AccessDenied('view', '(only the CEO or COO starts a side-by-side run)');
        if (rec.state !== 'ja') throw new BadInput(rec.state === 'prima' ? 'Prima already runs this area. Undo the switch first.' : 'A side-by-side run is already going.');
        const from = String(body.from ?? '');
        if (!validDate(from)) throw new BadInput('Give the first day as a date like 2026-11-01.');
        if (from < addDays(today, -rule.startBackDays) || from > addDays(today, rule.startAheadDays))
          throw new BadInput(`The first day must be within ${rule.startBackDays} days before and ${rule.startAheadDays} days after today.`);
        const note = str(body.note ?? 'Side by side with JA', 'a note', 3, 500);
        rec.state = 'side_by_side';
        const settings = await this.settings(tx);
        rec.run = { from, to: addDays(from, settings.sideBySideDays - 1), ...who, note, settings };
        rec.explanations = [];
        rec.check = null;
        rec.history.push({ ...who, action: 'start', note });
        summary = `Side-by-side run of ${JA_SWITCH_AREA_LABEL[area]} with JA from ${from} to ${rec.run.to}.`;
      } else if (action === 'cancel') {
        if (!isCeo(user) && !isCoo(user)) throw new AccessDenied('view', '(only the CEO or COO stops a side-by-side run)');
        if (rec.state !== 'side_by_side') throw new BadInput('There is no side-by-side run to stop.');
        const note = str(body.reason, 'the reason', 10, 500);
        rec.state = 'ja';
        rec.run = null;
        rec.explanations = [];
        rec.check = null;
        rec.history.push({ ...who, action: 'cancel', note });
        summary = `Side-by-side run of ${JA_SWITCH_AREA_LABEL[area]} stopped: ${note}`;
      } else if (action === 'explain') {
        if (rec.state !== 'side_by_side' || !rec.run) throw new BadInput('There is no side-by-side run.');
        if (!canExplainJaDifference(user, area, c.id)) throw new AccessDenied('view', '(explaining this area)');
        const key = String(body.key ?? '').slice(0, 300);
        const kind = body.kind === 'fixed' ? 'fixed' : body.kind === 'explained' ? 'explained' : null;
        if (!kind) throw new BadInput('Say whether the difference was explained or fixed.');
        const note = str(body.note, 'what happened', 10, 1000);
        const cmp = await this.compare(c.id, area, rec.run.from, rec.run.to, runSettings(rec));
        if (!cmp.differences.some((d) => d.key === key)) throw new BadInput('That difference is not in the current report. Reload it.');
        rec.explanations = [...rec.explanations.filter((e) => e.key !== key), { key, kind, note, ...who }];
        summary = `Difference ${key} ${kind}: ${note}`;
      } else if (action === 'check') {
        if (!isActChecker(user)) throw new AccessDenied('view', '(only the ACT Manager or the ACT Director checks the report)');
        if (rec.state !== 'side_by_side' || !rec.run) throw new BadInput('There is no side-by-side run.');
        if (rec.run.to >= today) throw new BadInput(`The run ends on ${rec.run.to}; check it after that day.`);
        if (rec.explanations.some((e) => e.byId === user.id)) throw new BadInput('You explained a difference in this report, so someone else in ACT checks it.');
        const cmp = await this.compare(c.id, area, rec.run.from, rec.run.to, runSettings(rec));
        if (!cmp.primaReady) throw new BadInput(cmp.primaNote ?? 'Prima is not ready for this area.');
        if (cmp.jaMissingDays.length) throw new BadInput(`JA data is missing for ${cmp.jaMissingDays.length} day(s), from ${cmp.jaMissingDays[0]}. Import it first.`);
        const keys = new Set(rec.explanations.map((e) => e.key));
        const open = cmp.differences.filter((d) => !keys.has(d.key));
        if (open.length) throw new BadInput(`${open.length} difference(s) are not explained yet.`);
        const hash = jaReportHash(cmp, rec.explanations, runSettings(rec));
        if (body.reportHash !== hash) throw new BadInput('The report changed since you opened it. Reload and check again.');
        const note = str(body.note ?? 'Checked', 'a note', 3, 1000);
        rec.check = { ...who, reportHash: hash, differences: cmp.differences.length, note };
        rec.history.push({ ...who, action: 'check', note });
        summary = `ACT checked the ${JA_SWITCH_AREA_LABEL[area]} report (${cmp.differences.length} differences, all explained).`;
      } else if (action === 'switch') {
        if (!isCeo(user)) throw new AccessDenied('view', '(only the CEO switches an area)');
        if (rec.state !== 'side_by_side' || !rec.run || !rec.check) throw new BadInput('The area needs a finished side-by-side run checked by ACT first.');
        const cmp = await this.compare(c.id, area, rec.run.from, rec.run.to, runSettings(rec));
        if (jaReportHash(cmp, rec.explanations, runSettings(rec)) !== rec.check.reportHash) throw new BadInput('The data changed after ACT checked it. ACT must check the report again.');
        if (body.reportHash !== rec.check.reportHash) throw new BadInput('Reload the report and confirm again.');
        const reason = str(body.reason, 'the reason', 10, 1000);
        const on = today;
        const until = addDays(on, runSettings(rec).jaReadOnlyDays);
        rec.state = 'prima';
        rec.switched = { ...who, on, reason, jaReadOnlyUntil: until };
        rec.history.push({ ...who, action: 'switch', note: reason });
        summary = `${JA_SWITCH_AREA_LABEL[area]} switched to Prima from ${on}. JA to stay read-only until ${until}.`;
      } else if (action === 'undo') {
        if (!isCeo(user)) throw new AccessDenied('view', '(only the CEO undoes a switch)');
        if (rec.state !== 'prima') throw new BadInput('This area is not switched to Prima.');
        const reason = str(body.reason, 'the reason', 10, 1000);
        rec.state = 'ja';
        rec.run = null;
        rec.explanations = [];
        rec.check = null;
        rec.switched = null;
        rec.history.push({ ...who, action: 'undo', note: reason });
        summary = `${JA_SWITCH_AREA_LABEL[area]} switched back to JA: ${reason}`;
      } else throw new BadInput('Unknown action.');
      rec.history = rec.history.slice(-100);
      await this.saveSwitch(tx, rec);
      await tx.audit({ at, actor: user.name, companyId: c.id, action: `ja.switch.${String(action)}`, entity: 'ja_switch', entityId: jaSwitchId(c.id, area), summary });
      return { state: rec.state, run: rec.run, check: rec.check, switched: rec.switched };
    });
  }

  // ----- Imports -----

  async stageImport(user: User, body: Record<string, unknown>) {
    const ctx = await this.ctx(user);
    if (!canStageJaImport(user)) throw new AccessDenied('view', '(staging a JA export)');
    const c = this.company(ctx, body.companyId);
    const kind = body.kind as JaImportKind;
    if (!JA_IMPORT_KINDS.includes(kind)) throw new BadInput(`Kind must be one of: ${JA_IMPORT_KINDS.join(', ')}.`);
    const rule = jaSwitchRule();
    if (!Array.isArray(body.rows) || !body.rows.length) throw new BadInput('The file has no rows.');
    if (body.rows.length > rule.importMaxRows) throw new BadInput(`Send up to ${rule.importMaxRows} rows per file; split bigger exports.`);
    const fileName = str(body.fileName, 'the file name', 1, 160);
    const from = String(body.from ?? '');
    const to = String(body.to ?? '');
    if (!validDate(from) || !validDate(to) || to < from) throw new BadInput('Give the first and last day the file covers.');
    if (daysBetween(from, to) > 3660) throw new BadInput('One file covers at most ten years.');
    if (to > this.today()) throw new BadInput('A file cannot cover days that have not happened.');
    const parsed = parseJaImportRows(kind, body.rows);
    const rows: JaHistoryRow[] = [];
    const refused = [...parsed.refused];
    parsed.rows.forEach((r, i) => {
      const d = rowDate(r);
      const out = d != null && (kind === 'payslips' || kind === 'hostels' ? d.slice(0, 7) < from.slice(0, 7) || d.slice(0, 7) > to.slice(0, 7) : d < from || d > to);
      if (out) refused.push({ line: parsed.lines[i], reason: `Outside the days the file covers (${from} to ${to}).` });
      else rows.push(r);
    });
    refused.sort((a, b) => a.line - b.line);
    if (!rows.length) throw new BadInput(`No row could be used. First problem: line ${refused[0]?.line}: ${refused[0]?.reason}`);
    const fileHash = jaHash({ kind, from, to, rows });
    const existing = await this.store.list('jaRecords', { companyId: c.id, dataset: 'import' });
    if (existing.some((r) => r.jaImport?.fileHash === fileHash && r.jaImport.decision?.decision !== 'rejected'))
      throw new BadInput('This exact file is already staged or imported for this company.');
    const counts = { new: 0, same: 0, changed: 0 };
    for (const r of rows) {
      const old = await this.store.get('jaRecords', jaRecordId(c.id, kind, jaRowKey(r)));
      if (!old?.jaRow) counts.new++;
      else if (jaHash(old.jaRow) === jaHash(r)) counts.same++;
      else counts.changed++;
    }
    const known = new Set((await this.store.list('people', { companyId: c.id })).map((p) => p.staffNo));
    const unknownStaff = [...new Set(rows.flatMap((r) => ('staffNo' in r && !known.has(r.staffNo) ? [r.staffNo] : [])))].sort();
    const at = this.clock();
    const id = `jaimport-${c.id}-${kind}-${toMs(at)}-${fileHash.slice(0, 8)}`;
    const batch: JaImportBatch = {
      id,
      companyId: c.id,
      kind,
      from,
      to,
      fileName,
      fileHash,
      rowsInFile: body.rows.length,
      ignoredColumns: parsed.ignoredColumns,
      refused,
      counts,
      unknownStaff,
      rows,
      staged: { by: user.name, byId: user.id, at },
      decision: null,
      written: 0,
    };
    await this.store.transaction(async (tx) => {
      await tx.insert('jaRecords', { id: `ja:import:${id}`, companyId: c.id, dataset: 'import', externalId: id, sourceUpdatedAt: at, receivedAt: at, jaImport: batch });
      await tx.audit({
        at,
        actor: user.name,
        companyId: c.id,
        action: 'ja.import.stage',
        entity: 'ja_import',
        entityId: id,
        summary: `Staged JA ${kind} file ${fileName} (${from} to ${to}): ${rows.length} kept, ${refused.length} refused, sha256 ${fileHash}.`,
      });
    });
    return { id, fileHash, kept: rows.length, refused: refused.length, counts, unknownStaff: unknownStaff.length, ignoredColumns: parsed.ignoredColumns };
  }

  async decideImport(user: User, idIn: unknown, body: Record<string, unknown>) {
    const ctx = await this.ctx(user);
    if (!isActChecker(user)) throw new AccessDenied('view', '(only the ACT Manager or the ACT Director approves a JA import)');
    const id = `ja:import:${String(idIn).slice(0, 160)}`;
    return this.store.transaction(async (tx) => {
      await tx.lock?.('jaRecords', id);
      const row = await tx.get('jaRecords', id);
      const b = row?.jaImport;
      if (!row || !b || !ctx.companyIds.includes(b.companyId)) throw new AccessDenied('view', '(this import)');
      if (b.decision) throw new BadInput(`This file was already ${b.decision.decision}.`);
      if (b.staged.byId === user.id) throw new BadInput('You staged this file, so another person approves it.');
      if (body.fileHash !== b.fileHash) throw new BadInput('Confirm the exact file you reviewed (its fingerprint does not match).');
      const decision = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : null;
      if (!decision) throw new BadInput('Approve or reject.');
      const note = str(body.note, 'a note', decision === 'rejected' ? 10 : 3, 1000);
      const at = this.clock();
      let written = 0;
      if (decision === 'approved') {
        for (const r of b.rows) {
          const rid = jaRecordId(b.companyId, b.kind, jaRowKey(r));
          const rec: JaRecord = { id: rid, companyId: b.companyId, dataset: `hist_${b.kind}` as JaRecord['dataset'], externalId: jaRowKey(r), sourceUpdatedAt: at, receivedAt: at, jaRow: r, importId: b.id };
          const old = await tx.get('jaRecords', rid);
          if (old?.jaRow && jaHash(old.jaRow) === jaHash(r)) continue;
          if (old) await tx.update('jaRecords', rid, patchOf(rec));
          else await tx.insert('jaRecords', rec);
          written++;
        }
      }
      const next: JaImportBatch = { ...b, decision: { decision, by: user.name, byId: user.id, at, note }, written, rows: [] };
      await tx.update('jaRecords', id, { sourceUpdatedAt: at, jaImport: next });
      await tx.audit({
        at,
        actor: user.name,
        companyId: b.companyId,
        action: `ja.import.${decision === 'approved' ? 'approve' : 'reject'}`,
        entity: 'ja_import',
        entityId: b.id,
        summary: `JA ${b.kind} file ${b.fileName} ${decision}: ${written} record(s) written. ${note}`,
      });
      return { decision, written };
    });
  }

  /** The guard history Prima holds from JA for one guard (records only from approved files). */
  async guardHistory(user: User, companyId: unknown, staffNoIn: unknown) {
    const ctx = await this.ctx(user);
    const c = this.company(ctx, companyId);
    const staffNo = str(staffNoIn, 'the staff number', 1, 40);
    const pick = async <K extends JaImportKind>(kind: K) => (await this.jaRows(c.id, kind)).filter((r) => 'staffNo' in r && r.staffNo === staffNo);
    const pay = user.role === 'company_manager' || isGroupLeader(user) || isAct(user) || user.department === 'hr';
    return {
      companyId: c.id,
      staffNo,
      guard: (await pick('guards'))[0] ?? null,
      payslips: pay ? (await pick('payslips')).sort((a, b) => b.period.localeCompare(a.period)) : null,
      attendanceDays: (await pick('attendance')).length,
      hostels: (await pick('hostels')).sort((a, b) => b.month.localeCompare(a.month)),
    };
  }
}