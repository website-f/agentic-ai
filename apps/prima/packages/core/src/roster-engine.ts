import type { Id, IsoDate, IsoDateTime } from './types';

/**
 * Guard roster, breaks and hybrid pay engine (Part O, Fauzan 13 Nov 2026; roster and pay pack v3, 14 Nov 2026).
 *
 * One configurable engine, switched on PER SITE by the ACT Director (pay mode on the guard formula). Nothing here is
 * hard-coded to IKEA or the school zone: 22 / 26 days, 9 or 7.5 normal hours, 14 + 12 posts, RM8.72 and RM13.08 are all
 * settings with effective dates. Pure functions only: no database, no clock.
 *
 * Five ledgers stay apart and never overwrite one another (v3 spec section 1): contract coverage, planned roster,
 * actual attendance and breaks, pay, and compliance evidence. A planned status is never replaced by the actual one.
 *
 * Decisions this follows (Fauzan, 13 Nov 2026, Part O answers):
 *  - PO-2: client limits BLOCK publishing a roster; Employment Act points are FLAGS to the CEO, never a refusal, and
 *    never stop paying wages already worked.
 *  - PO-4: rest-day pay comes only from a duty on a date the published roster marks OFF-REST (or OFF-ADD, see below),
 *    never from counting days in the month. OFF days are never absence and never unpaid.
 *  - PO-3 (23:05Z, 23:13Z): part month and unpaid days use the SITE's normal working days a month (IKEA 22, some 24,
 *    default 26): daily rate = basic / that number. EA s.18A calendar days stays a second choice for the CEO.
 *  - 23:16Z: work on either OFF day is paid as rest-day work: normal hours x fixed base (RM8.72), hours above normal x
 *    2 x fixed base, or the statutory rest-day amount if that is higher.
 *  - PO-5: guard rosters are prepared by the OM, verified by the Area/Zone Supervisor where the site has one, and
 *    published by the OD (private) or OGM (government). HR does not check guard rosters.
 *  - Lump sum (14 Nov 2026, "Build it fully now"): an agreed lump-sum target never lowers what the law and the
 *    formula say is due; a target above it is paid as a separate top-up, a target below it raises a shortfall alert.
 */

// ----------------------------------------------------------------------------------------------------------------------
// O1. Roster day status
// ----------------------------------------------------------------------------------------------------------------------

export type RosterStatus =
  | 'WORK_D'
  | 'WORK_N'
  | 'OFF_REST'
  | 'OFF_ADD'
  | 'AL'
  | 'MC'
  | 'HOSP'
  | 'PH'
  | 'UPL'
  | 'ABS'
  | 'RELIEF_D'
  | 'RELIEF_N'
  | 'TRF'
  | 'END'
  | 'PENDING';

export const ROSTER_STATUS_LABEL: Record<RosterStatus, string> = {
  WORK_D: 'WORK-D (day duty)',
  WORK_N: 'WORK-N (night duty)',
  OFF_REST: 'OFF-REST (weekly rest day)',
  OFF_ADD: 'OFF-ADD (extra day off)',
  AL: 'AL (annual leave)',
  MC: 'MC (sick leave)',
  HOSP: 'HOSP (hospital leave)',
  PH: 'PH (public holiday, not worked)',
  UPL: 'UPL (approved unpaid leave)',
  ABS: 'ABS (absent, waiting for decision)',
  RELIEF_D: 'RELIEF-D (relief day duty)',
  RELIEF_N: 'RELIEF-N (relief night duty)',
  TRF: 'TRF (transferred out)',
  END: 'END (employment ended)',
  PENDING: 'PENDING (waiting for licence, induction or availability)',
};

export const DUTY_STATUSES: readonly RosterStatus[] = ['WORK_D', 'WORK_N', 'RELIEF_D', 'RELIEF_N'];
export const OFF_STATUSES: readonly RosterStatus[] = ['OFF_REST', 'OFF_ADD'];
export const PAID_LEAVE_STATUSES: readonly RosterStatus[] = ['AL', 'MC', 'HOSP'];
export const isDuty = (s: RosterStatus | null | undefined) => !!s && DUTY_STATUSES.includes(s);
export const isOff = (s: RosterStatus | null | undefined) => !!s && OFF_STATUSES.includes(s);
export const rosterDutyShift = (s: RosterStatus): 'D' | 'N' | null => (s === 'WORK_D' || s === 'RELIEF_D' ? 'D' : s === 'WORK_N' || s === 'RELIEF_N' ? 'N' : null);

/** One guard, one calendar date, at one site. A night duty belongs to the date it STARTS (never two days). */
export interface RosterDay {
  personId: Id;
  siteId: Id;
  postId: Id | null;
  date: IsoDate;
  planned: RosterStatus;
  /** Set once the day is over; never overwrites planned. */
  actual: RosterStatus | null;
  plannedStart: IsoDateTime | null;
  plannedEnd: IsoDateTime | null;
}

// ----------------------------------------------------------------------------------------------------------------------
// Small date helpers (UTC arithmetic on calendar dates; times keep their own offsets)
// ----------------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
export const addDaysIso = (d: IsoDate, n: number): IsoDate => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export function monthDates(month: string): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = `${month}-01`; d.slice(0, 7) === month; d = addDaysIso(d, 1)) out.push(d);
  return out;
}
const weekday = (d: IsoDate) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const minutesBetweenIso = (a: IsoDateTime, b: IsoDateTime) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ----------------------------------------------------------------------------------------------------------------------
// O2. Contract coverage per site
// ----------------------------------------------------------------------------------------------------------------------

export type CoverageCalendar =
  | { kind: 'every_day' }
  /** 0 = Sunday ... 6 = Saturday. A 22- or 23-day office uses its working weekdays or exact dates. */
  | { kind: 'weekdays'; weekdays: number[] }
  /** School calendar or any custom list of dates. */
  | { kind: 'dates'; dates: IsoDate[] };

export interface ShiftDefinition {
  code: 'D' | 'N';
  /** HH:MM local; an end at or before the start ends the next day. */
  start: string;
  end: string;
  /** Posts required on this shift on every covered date. */
  posts: number;
}

export interface ClientLimits {
  /** Longest single duty in working hours (IKEA 12). */
  maxDutyHours?: number;
  /** Most hours in ANY rolling 7 days (IKEA 60). */
  maxHours7d?: number;
  /** Most days in a row before an OFF (IKEA 6). */
  maxDaysInRow?: number;
  /** Most duties of at least `hours` in any 7 days (IKEA: at most 5 duties of 12 hours). */
  maxLongDuties7d?: { hours: number; max: number };
}

/** Versioned from a date by the OD (private) / OGM (government) with a reason and the contract document. */
export interface SiteCoverage {
  siteId: Id;
  effectiveFrom: IsoDate;
  sector: 'private' | 'government';
  calendar: CoverageCalendar;
  shifts: ShiftDefinition[];
  /** Fewest guards on duty at the site at any minute, including during breaks. */
  minActive: number;
  armed: boolean;
  clientLimits: ClientLimits;
  /** Client billing method, kept apart from payroll (v3 UAT-33). */
  billing: 'fixed_monthly_post' | 'fixed_monthly_hours' | 'hours_x_30_5_days' | 'hours_x_actual_dates' | 'other';
  /** Client's written break permission (reference to the stored document); breaks are not used without it. */
  breakPermissionRef: string | null;
  reason: string;
  documentRef: string;
  setById: Id;
}

export function coverageFor(versions: SiteCoverage[], siteId: Id, date: IsoDate): SiteCoverage | null {
  return versions.filter((v) => v.siteId === siteId && v.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

export function coverageCoversDate(c: SiteCoverage, date: IsoDate): boolean {
  if (c.calendar.kind === 'every_day') return true;
  if (c.calendar.kind === 'weekdays') return c.calendar.weekdays.includes(weekday(date));
  return c.calendar.dates.includes(date);
}

/** Posts required per date and shift, and the month's total position-shifts. Never invents a second shift. */
export function requiredCoverage(versions: SiteCoverage[], siteId: Id, month: string): { byDate: Record<IsoDate, { D: number; N: number }>; total: number } {
  const byDate: Record<IsoDate, { D: number; N: number }> = {};
  let total = 0;
  for (const d of monthDates(month)) {
    const c = coverageFor(versions, siteId, d);
    const need = { D: 0, N: 0 };
    if (c && coverageCoversDate(c, d)) for (const s of c.shifts) need[s.code] += s.posts;
    byDate[d] = need;
    total += need.D + need.N;
  }
  return { byDate, total };
}

export function coverageProblem(c: SiteCoverage): string | null {
  if (!c.reason.trim() || !c.documentRef.trim()) return 'A coverage change needs a reason and the contract document.';
  if (!c.shifts.length) return 'At least one shift is needed.';
  if (new Set(c.shifts.map((s) => s.code)).size !== c.shifts.length) return 'Each shift code is used once.';
  if (c.shifts.some((s) => !Number.isInteger(s.posts) || s.posts < 1 || !/^\d\d:\d\d$/.test(s.start) || !/^\d\d:\d\d$/.test(s.end))) return 'Shift posts must be whole numbers and times HH:MM.';
  if (!Number.isInteger(c.minActive) || c.minActive < 0) return 'Minimum active guards must be a whole number.';
  if (c.calendar.kind === 'weekdays' && !c.calendar.weekdays.length) return 'Choose the covered weekdays.';
  return null;
}

// ----------------------------------------------------------------------------------------------------------------------
// O12. Compliance evidence (a document, never a ticked waiver)
// ----------------------------------------------------------------------------------------------------------------------

export type LawRule = 'weekly_rest' | 'daily_12h' | 'spread_over' | 'ot_104' | 'break_after_5h' | 'normal_hours';

export interface ComplianceEvidence {
  id: Id;
  rule: LawRule;
  /** Labour department permit, client permission or other; client and labour-department permission are separate. */
  kind: 'jtk_permit' | 'client_permission' | 'other_document';
  documentRef: string;
  siteId: Id;
  /** Empty = every guard at the site. */
  personIds: Id[];
  from: IsoDate;
  to: IsoDate;
  conditions: string;
  recordedById: Id;
}

/** UAT-15: a record for another site, another guard or outside its dates never clears the flag. Expired = RED again. */
export function evidenceCovers(e: ComplianceEvidence, rule: LawRule, siteId: Id, personId: Id, date: IsoDate): boolean {
  return e.rule === rule && e.kind !== 'client_permission' && !!e.documentRef.trim() && e.siteId === siteId && (!e.personIds.length || e.personIds.includes(personId)) && e.from <= date && date <= e.to;
}

// ----------------------------------------------------------------------------------------------------------------------
// O3. Roster checker
// ----------------------------------------------------------------------------------------------------------------------

export interface RosterPerson {
  personId: Id;
  joinedOn: IsoDate;
  leftOn: IsoDate | null;
  /** Arms authorisation in force until (Arms Control data); null = not armed-qualified. */
  armedUntil: IsoDate | null;
  /** Guard licence / KDN / site induction valid until; null = not valid. */
  licenceUntil: IsoDate | null;
  /** Home post (O5) or relief for a named cluster of sites. */
  home: { siteId: Id; from: IsoDate } | { relief: true; clusterSiteIds: Id[] } | null;
}

export type CheckLevel = 'block' | 'red' | 'amber' | 'info';
export interface RosterFinding {
  level: CheckLevel;
  code: string;
  personId: Id | null;
  date: IsoDate | null;
  message: string;
  /** Owner of the follow-up (PO-5): the OM, then the OD/OGM; ACT sees all. */
  owner: 'OM' | 'OD_OGM';
}

export interface RosterCheckInput {
  siteId: Id;
  month: string;
  /** Days for this site and month (the version being checked). */
  days: RosterDay[];
  /** Every other day of the same people: other sites, other companies of the group, previous and next months. */
  otherDays: RosterDay[];
  coverage: SiteCoverage[];
  people: RosterPerson[];
  /** Ordinary normal hours a day of the site's formula, for the 104-hour overtime flag. */
  normalHoursPerDay: number;
  evidence: ComplianceEvidence[];
  /** Approved contract deviations (OD/OGM, with a document) that allow other post counts on given dates. */
  deviations?: { date: IsoDate; shift: 'D' | 'N'; posts: number; documentRef: string }[];
  /** Site break plan, for the "break after 5 hours" flag. */
  breakPlan?: BreakPlan | null;
}

const dutyMinutes = (d: RosterDay) => (d.plannedStart && d.plannedEnd ? Math.max(0, minutesBetweenIso(d.plannedStart, d.plannedEnd)) : 0);

/** Runs on every save, submit and publish. Blocks are client/contract and person problems; law points are flags. */
export function checkRoster(i: RosterCheckInput): { findings: RosterFinding[]; canPublish: boolean; dutiesPerPerson: Record<Id, number> } {
  const f: RosterFinding[] = [];
  const add = (level: CheckLevel, code: string, personId: Id | null, date: IsoDate | null, message: string, owner: RosterFinding['owner'] = 'OM') =>
    f.push({ level, code, personId, date, message, owner });
  const dates = monthDates(i.month);
  const need = requiredCoverage(i.coverage, i.siteId, i.month);
  const byPerson = new Map<Id, RosterDay[]>();
  for (const d of i.days) byPerson.set(d.personId, [...(byPerson.get(d.personId) ?? []), d]);
  const people = new Map(i.people.map((p) => [p.personId, p]));

  // One status per person and date; a blank day is not allowed on submit.
  for (const [pid, list] of byPerson) {
    const seen = new Set<IsoDate>();
    for (const d of list) {
      if (seen.has(d.date)) add('block', 'DOUBLE_ENTRY', pid, d.date, 'Two statuses on one date for the same guard.');
      seen.add(d.date);
    }
    for (const d of dates) if (!seen.has(d)) add('block', 'BLANK_DAY', pid, d, 'Every date needs a status (WORK, OFF, leave and so on).');
  }

  // Coverage: exactly the contracted posts, no more and no fewer, unless an approved deviation exists.
  for (const d of dates) {
    for (const sh of ['D', 'N'] as const) {
      const dev = i.deviations?.find((x) => x.date === d && x.shift === sh && x.documentRef.trim());
      const want = dev ? dev.posts : need.byDate[d][sh];
      const have = i.days.filter((x) => x.date === d && isDuty(x.planned) && rosterDutyShift(x.planned) === sh).length;
      if (have < want) add('block', 'UNCOVERED', null, d, `${want - have} ${sh === 'D' ? 'day' : 'night'} post(s) not covered.`);
      if (have > want) add('block', 'OVER_COVERAGE', null, d, `${have - want} ${sh === 'D' ? 'day' : 'night'} duty(ies) above the contract; needs a contract change from the OD/OGM.`, 'OD_OGM');
    }
  }

  const cov = (d: IsoDate) => coverageFor(i.coverage, i.siteId, d);
  const dutiesPerPerson: Record<Id, number> = {};
  for (const [pid, list] of byPerson) {
    const p = people.get(pid);
    const all = [...list, ...i.otherDays.filter((x) => x.personId === pid)];
    const duties = all.filter((x) => isDuty(x.planned)).sort((a, b) => (a.plannedStart ?? a.date).localeCompare(b.plannedStart ?? b.date));
    dutiesPerPerson[pid] = list.filter((x) => isDuty(x.planned)).length;

    for (const d of list.filter((x) => isDuty(x.planned))) {
      if (!d.plannedStart || !d.plannedEnd || dutyMinutes(d) <= 0) add('block', 'NO_TIMES', pid, d.date, 'A duty needs its start and end time.');
      if (p && d.date < p.joinedOn) add('block', 'BEFORE_JOIN', pid, d.date, 'Duty before the joining date.');
      if (p?.leftOn && d.date > p.leftOn) add('block', 'AFTER_END', pid, d.date, 'Duty after employment ended.');
      if (!p?.licenceUntil || p.licenceUntil < d.date) add('block', 'LICENCE', pid, d.date, 'Guard licence, KDN or site induction not valid on this date.');
      if (cov(d.date)?.armed && (!p?.armedUntil || p.armedUntil < d.date)) add('block', 'ARMED_POST', pid, d.date, 'Armed post: the guard has no arms authorisation in force.');
      if (p?.home && 'siteId' in p.home && p.home.siteId !== i.siteId && d.planned.startsWith('WORK')) add('amber', 'PIECEMEAL_MOVE', pid, d.date, 'Resident guard at another site: needs the OD/OGM reason, or a transfer.', 'OD_OGM');
      if (p?.home && 'relief' in p.home && !p.home.clusterSiteIds.includes(i.siteId)) add('block', 'RELIEF_OUTSIDE_CLUSTER', pid, d.date, 'Relief guard outside the named cluster.');
      const lim = cov(d.date)?.clientLimits;
      if (lim?.maxDutyHours && dutyMinutes(d) > lim.maxDutyHours * 60) add('block', 'CLIENT_DUTY_HOURS', pid, d.date, `Duty longer than the client's ${lim.maxDutyHours} hours.`);
      if (dutyMinutes(d) > 12 * 60) add('red', 'LAW_DAILY_12H', pid, d.date, 'Duty over 12 hours (EA s.60A): needs an exception document.');
      else if (dutyMinutes(d) > 10 * 60 && !lawCleared(i, 'spread_over', pid, d.date)) add('amber', 'LAW_SPREAD_OVER', pid, d.date, 'Spread over 10 hours: shift-work rules or a permit must be on file.');
      const bp = i.breakPlan;
      if (dutyMinutes(d) > 5 * 60 && (!bp || bp.minutesPerShift === 0) && !lawCleared(i, 'break_after_5h', pid, d.date)) add('amber', 'LAW_BREAK_5H', pid, d.date, 'No break planned after 5 hours (EA s.60A(1)(a)): record a paid or unpaid break plan.');
    }

    // No overlapping duties anywhere in the group.
    for (let k = 1; k < duties.length; k++) {
      const a = duties[k - 1];
      const b = duties[k];
      if (a.plannedEnd && b.plannedStart && Date.parse(b.plannedStart) < Date.parse(a.plannedEnd))
        add('block', 'DOUBLE_BOOKED', pid, b.date, `Overlaps another duty${a.siteId !== b.siteId ? ' at another site' : ''}.`);
    }

    // Rolling 7-day and days-in-a-row checks over this, the previous and the next month, every site added together.
    const dayMin = new Map<IsoDate, number>();
    const long = new Map<IsoDate, number>();
    for (const d of duties) {
      dayMin.set(d.date, (dayMin.get(d.date) ?? 0) + dutyMinutes(d));
      long.set(d.date, Math.max(long.get(d.date) ?? 0, dutyMinutes(d)));
    }
    const onDuty = (d: IsoDate) => dayMin.has(d);
    const flagged = new Set<string>();
    const once = (code: string, date: IsoDate, level: CheckLevel, msg: string) => {
      if (flagged.has(code)) return;
      flagged.add(code);
      add(level, code, pid, date, msg);
    };
    // Windows ending up to 6 days into the next month, so a run across 30 Nov / 1 Dec is caught (D3 test 10).
    const ends = [...dates, ...[1, 2, 3, 4, 5, 6].map((k) => addDaysIso(dates[dates.length - 1], k))];
    for (const end of ends) {
      const lim = cov(end > dates[dates.length - 1] ? dates[dates.length - 1] : end)?.clientLimits ?? {};
      let mins = 0;
      let longCount = 0;
      for (let k = 0; k < 7; k++) {
        const d = addDaysIso(end, -k);
        mins += dayMin.get(d) ?? 0;
        if (lim.maxLongDuties7d && (long.get(d) ?? 0) >= lim.maxLongDuties7d.hours * 60) longCount++;
      }
      if (lim.maxHours7d && mins > lim.maxHours7d * 60) once('CLIENT_60H', end, 'block', `More than ${lim.maxHours7d} hours in the 7 days to ${end} (client limit).`);
      if (lim.maxLongDuties7d && longCount > lim.maxLongDuties7d.max) once('CLIENT_LONG_DUTIES', end, 'block', `More than ${lim.maxLongDuties7d.max} duties of ${lim.maxLongDuties7d.hours} hours in the 7 days to ${end} (client limit).`);
    }
    // Days in a row, looking 6 days before the month and 6 days after it.
    let run = 0;
    let worst = 0;
    let worstEnd: IsoDate | null = null;
    for (let d = addDaysIso(dates[0], -6); d <= addDaysIso(dates[dates.length - 1], 6); d = addDaysIso(d, 1)) {
      run = onDuty(d) ? run + 1 : 0;
      if (run > worst) {
        worst = run;
        worstEnd = d;
      }
    }
    const maxRow = Math.min(...dates.map((d) => cov(d)?.clientLimits.maxDaysInRow ?? Infinity));
    if (Number.isFinite(maxRow) && worst > maxRow) add('block', 'CLIENT_DAYS_IN_ROW', pid, worstEnd, `${worst} days in a row (client allows ${maxRow}).`);
    if (worst > 6 && !lawCleared(i, 'weekly_rest', pid, worstEnd!)) add('red', 'LAW_WEEKLY_REST', pid, worstEnd, `${worst} days in a row with no rest day (EA s.59): needs a rest day or a permit.`);
    if (!list.some((x) => x.planned === 'OFF_REST') && list.some((x) => isDuty(x.planned)) && !lawCleared(i, 'weekly_rest', pid, dates[0]))
      add('red', 'LAW_NO_REST_DAY_MARKED', pid, null, 'No OFF-REST marked this month: the OM marks which OFF is the weekly rest day.');
    // 104 hours of ordinary overtime in the month (flag only).
    const ot = list.filter((x) => isDuty(x.planned)).reduce((n, x) => n + Math.max(0, dutyMinutes(x) - i.normalHoursPerDay * 60), 0) / 60;
    if (ot > 104 && !lawCleared(i, 'ot_104', pid, dates[0])) add('red', 'LAW_OT_104', pid, null, `${r2(ot)} overtime hours planned this month (more than 104).`);
  }
  // Information: fairness.
  const counts = Object.values(dutiesPerPerson);
  if (counts.length) add('info', 'FAIRNESS', null, null, `Duties per guard this month: ${Math.min(...counts)} to ${Math.max(...counts)}.`);
  return { findings: f, canPublish: !f.some((x) => x.level === 'block'), dutiesPerPerson };
}

function lawCleared(i: RosterCheckInput, rule: LawRule, personId: Id, date: IsoDate) {
  return i.evidence.some((e) => evidenceCovers(e, rule, i.siteId, personId, date));
}

// ----------------------------------------------------------------------------------------------------------------------
// O4. Roster versions and approval (PO-5: OM prepares -> Area/Zone Supervisor verifies where the site has one ->
// OD (private) / OGM (government) publishes; reason at each step; nobody approves their own)
// ----------------------------------------------------------------------------------------------------------------------

export type RosterVersionStatus = 'draft' | 'submitted' | 'verified' | 'published' | 'replaced';
export type RosterRole = 'om' | 'area_supervisor' | 'ops_director' | 'ogm';
export interface RosterStep {
  action: 'submit' | 'verify' | 'publish' | 'return';
  byId: Id;
  role: RosterRole;
  at: IsoDateTime;
  reason: string;
}
export interface RosterVersion {
  id: Id;
  companyId: Id;
  siteId: Id;
  month: string;
  version: number;
  status: RosterVersionStatus;
  preparedById: Id;
  steps: RosterStep[];
  /** For a version made after publishing: why it changed. */
  changeReason: string | null;
  replacesId: Id | null;
}

export function rosterStepProblem(
  v: RosterVersion,
  step: { action: RosterStep['action']; byId: Id; role: RosterRole; reason: string },
  site: { sector: 'private' | 'government'; hasAreaSupervisor: boolean },
  check: { canPublish: boolean },
): string | null {
  if (!step.reason.trim()) return 'A reason is needed at every step.';
  const publisher: RosterRole = site.sector === 'private' ? 'ops_director' : 'ogm';
  if (step.action === 'submit') {
    if (v.status !== 'draft') return 'Only a draft can be submitted.';
    if (step.role !== 'om') return 'The OM prepares and submits the roster.';
    return null;
  }
  if (step.byId === v.preparedById) return 'Nobody approves their own roster.';
  // Within the current approval round only (since the last submit): after a return and resubmission the same Area
  // Supervisor may verify again (review of PR #141, 14 Nov 2026).
  const lastSubmit = v.steps.map((s) => s.action).lastIndexOf('submit');
  if (v.steps.slice(lastSubmit + 1).some((s) => s.byId === step.byId && s.action !== 'return')) return 'Each step needs a different person.';
  if (step.action === 'verify') {
    if (!site.hasAreaSupervisor) return 'This site has no Area/Zone Supervisor step.';
    if (v.status !== 'submitted') return 'Only a submitted roster can be verified.';
    if (step.role !== 'area_supervisor') return 'The Area/Zone Supervisor verifies.';
    return null;
  }
  if (step.action === 'publish') {
    if (v.status !== (site.hasAreaSupervisor ? 'verified' : 'submitted')) return site.hasAreaSupervisor ? 'The Area/Zone Supervisor verifies first.' : 'Only a submitted roster can be published.';
    if (step.role !== publisher) return site.sector === 'private' ? 'The Operations Director publishes private-site rosters.' : 'The OGM publishes government-site rosters.';
    if (!check.canPublish) return 'Client limits or coverage problems block publishing.';
    return null;
  }
  // return
  if (v.status !== 'submitted' && v.status !== 'verified') return 'Only a roster waiting for a decision can be returned.';
  if (step.role !== 'area_supervisor' && step.role !== publisher) return 'Only the verifier or the publisher returns a roster.';
  return null;
}

/** After publishing, dates already worked are locked; a correction is proposed by the OM and approved by the OD/OGM. */
export function lateChange(publishedAt: IsoDateTime, changedDate: IsoDate, now: IsoDateTime): boolean {
  return Date.parse(`${changedDate}T00:00:00+08:00`) - Date.parse(now) < 48 * 3_600_000 && Date.parse(now) > Date.parse(publishedAt);
}

// ----------------------------------------------------------------------------------------------------------------------
// O6. Breaks (v3 section 5): slots per post, minimum active guards at every minute, max segment, paid or unpaid
// ----------------------------------------------------------------------------------------------------------------------

export interface BreakPlan {
  /** Total break minutes per shift for one guard (0, 60, 90, 120 ... or custom). */
  minutesPerShift: number;
  /** Longest single break (school template 60). */
  maxSegmentMinutes: number;
  /** IKEA: breaks are paid by the client; paid breaks are recorded, never deducted (Fauzan 13 Nov L2). */
  paid: boolean;
  permission: 'relief_required' | 'staggered_no_extra_relief' | 'isolated_post' | 'other';
}

export interface BreakSlot {
  /** Post slot (A/B ...), so a relief guard takes the slot of the person replaced. */
  slot: string;
  start: IsoDateTime;
  end: IsoDateTime;
}

/** Validates a shift's break slots: no overlap at the same post below min active, segment limits, total minutes. */
export function breakPlanProblems(plan: BreakPlan, shift: { start: IsoDateTime; end: IsoDateTime; guards: number; minActive: number }, slots: BreakSlot[]): string[] {
  const out: string[] = [];
  for (const s of slots) {
    const m = minutesBetweenIso(s.start, s.end);
    if (m <= 0) out.push(`Slot ${s.slot}: the break must end after it starts.`);
    if (m > plan.maxSegmentMinutes) out.push(`Slot ${s.slot}: ${m} minutes is longer than the ${plan.maxSegmentMinutes}-minute limit.`);
    if (Date.parse(s.start) < Date.parse(shift.start) || Date.parse(s.end) > Date.parse(shift.end)) out.push(`Slot ${s.slot}: outside the shift.`);
  }
  const perSlot = new Map<string, number>();
  for (const s of slots) perSlot.set(s.slot, (perSlot.get(s.slot) ?? 0) + Math.max(0, minutesBetweenIso(s.start, s.end)));
  for (const [slot, m] of perSlot) if (m > plan.minutesPerShift) out.push(`Slot ${slot}: ${m} break minutes, the plan allows ${plan.minutesPerShift}.`);
  // Minute-level check: guards on break at once may never leave fewer than minActive on duty.
  const t0 = Date.parse(shift.start);
  const t1 = Date.parse(shift.end);
  for (let t = t0; t < t1; t += 60_000) {
    const away = slots.filter((s) => Date.parse(s.start) <= t && t < Date.parse(s.end)).length;
    if (shift.guards - away < shift.minActive) {
      out.push(`At ${new Date(t).toISOString().slice(11, 16)}Z fewer than ${shift.minActive} guard(s) would be on duty (breaks overlap).`);
      break;
    }
  }
  return out;
}

/** A break actually taken, from attendance, with the supervisor's confirmation. */
export interface BreakTaken {
  start: IsoDateTime;
  end: IsoDateTime;
  confirmedBySupervisor: boolean;
  /** Relieved: free of duty during the break. */
  relieved: boolean;
  /** Minutes the guard was called back (incident, patrol, order); always paid. */
  interruptedMinutes: number;
}

/**
 * Paid work minutes for one duty (v3 section 5): clock-out minus clock-in, minus ONLY genuine, confirmed, relieved,
 * unpaid break minutes; interrupted minutes are paid back. Paid breaks, a single guard on the post, or no client
 * permission: nothing is deducted. Time outside the approved duty counts only if the OM approved it.
 */
export function workedMinutes(i: {
  plannedStart: IsoDateTime;
  plannedEnd: IsoDateTime;
  clockIn: IsoDateTime;
  clockOut: IsoDateTime;
  extraApproved?: boolean;
  breaks: BreakTaken[];
  plan: BreakPlan | null;
  guardsOnPost: number;
  breakPermission: boolean;
}): { worked: number; unpaidBreak: number; alerts: string[] } {
  const alerts: string[] = [];
  const s = i.extraApproved ? Math.min(Date.parse(i.clockIn), Date.parse(i.plannedStart)) : Math.max(Date.parse(i.clockIn), Date.parse(i.plannedStart));
  const e = i.extraApproved ? Math.max(Date.parse(i.clockOut), Date.parse(i.plannedEnd)) : Math.min(Date.parse(i.clockOut), Date.parse(i.plannedEnd));
  const present = Math.max(0, Math.round((e - s) / 60_000));
  let unpaid = 0;
  const deductible = !!i.plan && !i.plan.paid && i.guardsOnPost > 1 && i.breakPermission;
  for (const b of i.breaks) {
    const m = Math.max(0, minutesBetweenIso(b.start, b.end));
    if (!b.confirmedBySupervisor) alerts.push('Break not confirmed by the supervisor: paid as work.');
    else if (!b.relieved) alerts.push('Break not relieved: paid as work.');
    if (b.interruptedMinutes > 0) alerts.push(`Break interrupted for ${b.interruptedMinutes} minutes: those minutes are paid.`);
    if (deductible && b.confirmedBySupervisor && b.relieved) unpaid += Math.max(0, m - Math.min(m, b.interruptedMinutes));
  }
  if (i.plan && !i.plan.paid && i.guardsOnPost <= 1 && i.breaks.length) alerts.push('Only one guard on the post: no unpaid break this shift.');
  unpaid = Math.min(unpaid, present);
  return { worked: present - unpaid, unpaidBreak: unpaid, alerts };
}

// ----------------------------------------------------------------------------------------------------------------------
// O7. Formula settings for the engine (on the guard formula, ACT Director / CEO, versioned by month)
// ----------------------------------------------------------------------------------------------------------------------

export type GuardPayMode = 'count_days' | 'roster_hybrid' | 'hourly';
export interface HybridSettings {
  basicMonthly: number;
  normalHoursPerDay: number;
  workDaysPerWeek: number;
  otNormalRate: number;
  otRestDayRate: number;
  otPublicHolidayRate: number;
  restDayDays: number;
  publicHolidayDays: number;
  /** 'statutory' = basic / 26 / normal hours; 'fixed' = a company RM base per hour (e.g. 8.72). The higher is paid. */
  otRateBase: 'statutory' | 'fixed';
  otFixedBase?: number;
  /** 'rate_to_sen_first' = 8.72 x 1.5 = 13.08, then x hours; 'exact' = keep all decimals until the final sum. */
  otRateRounding: 'rate_to_sen_first' | 'exact';
  /** OFF-ADD work: paid like rest-day work (Fauzan 13 Nov 23:16Z), ordinary overtime, or held for a decision. */
  restDayExtraTreatment: 'same_as_rest_day' | 'ordinary_ot' | 'ask_each_time';
  /** Rest-day normal hours at the fixed base (x1) and hours above normal at fixed base x restDayOtMultiplier. */
  restDayNormalRateBase: 'statutory' | 'fixed';
  restDayOtMultiplier: number;
  /** Part month and unpaid days: the site's normal working days a month (IKEA 22, some 24, default 26). */
  normalWorkingDaysPerMonth: number;
  /** 'working_days' (Fauzan's choice, PO-3) or EA s.18A calendar days (second choice). */
  incompleteMonthMethod: 'working_days' | 's18A_calendar';
  /** For pay mode 'hourly' (v3: genuine hourly-paid guard): the RM rate per normal hour, never below the minimum. */
  hourlyRate?: number;
}

export interface HybridLaw {
  /** EA s.60I divisor for the statutory daily rate (26). */
  divisor: number;
  minimumMonthly: number;
  minimumHourly: number;
}
export const DEFAULT_HYBRID_LAW: HybridLaw = { divisor: 26, minimumMonthly: 1700, minimumHourly: 8.72 };

/** EA s.60I statutory rates for a monthly-paid guard. */
export function statutoryRates(s: HybridSettings, law: HybridLaw = DEFAULT_HYBRID_LAW) {
  const daily = s.basicMonthly / law.divisor;
  return { daily, hourly: daily / s.normalHoursPerDay };
}

/** The ordinary OT rate per hour: the higher of the statutory and the company rate (v3: MAX(statute, contract, policy)). */
export function ordinaryOtRate(s: HybridSettings, law: HybridLaw = DEFAULT_HYBRID_LAW): { rate: number; statutory: number; company: number | null; used: 'statutory' | 'company' } {
  const statutory = statutoryRates(s, law).hourly * s.otNormalRate;
  let company: number | null = null;
  if (s.otRateBase === 'fixed' && s.otFixedBase) company = s.otRateRounding === 'rate_to_sen_first' ? r2(s.otFixedBase * s.otNormalRate) : s.otFixedBase * s.otNormalRate;
  const statUsed = s.otRateRounding === 'rate_to_sen_first' ? r2(statutory) : statutory;
  return company !== null && company >= statUsed ? { rate: company, statutory: statUsed, company, used: 'company' } : { rate: statUsed, statutory: statUsed, company, used: 'statutory' };
}

/** Problems with the engine settings (refused) and law flags for the CEO. */
export function hybridSettingsCheck(s: HybridSettings, mode: GuardPayMode, law: HybridLaw = DEFAULT_HYBRID_LAW): { refuse: string[]; flags: string[] } {
  const refuse: string[] = [];
  const flags: string[] = [];
  if (!(s.normalWorkingDaysPerMonth >= 20 && s.normalWorkingDaysPerMonth <= 31)) refuse.push('Normal working days a month must be between 20 and 31.');
  if (s.otRateBase === 'fixed' && !(s.otFixedBase && s.otFixedBase > 0)) refuse.push('A fixed OT base needs its RM amount per hour.');
  if (s.restDayNormalRateBase === 'fixed' && !(s.otFixedBase && s.otFixedBase > 0)) refuse.push('A fixed rest-day base needs the fixed RM amount per hour.');
  if (s.restDayOtMultiplier < 2) refuse.push('Rest-day hours above normal are at least 2 times (EA s.60(3)(c)).');
  if (s.normalHoursPerDay * s.workDaysPerWeek > 45) refuse.push('Normal hours above 45 a week (EA s.60A(1)).');
  if (mode === 'hourly' && !(s.hourlyRate && s.hourlyRate >= law.minimumHourly)) refuse.push(`An hourly rate of at least RM${law.minimumHourly.toFixed(2)} is needed (Minimum Wages Order 2024).`);
  if (s.normalWorkingDaysPerMonth < law.divisor)
    flags.push(`Normal working days ${s.normalWorkingDaysPerMonth} is under ${law.divisor}: each unpaid day takes more than EA s.60I (basic / ${law.divisor}) and s.18A would (law flag for the CEO).`);
  if (s.normalHoursPerDay > 8) flags.push(`${s.normalHoursPerDay} normal hours a day: EA s.60A(1) allows up to 9 only when other days of the week are shorter; HR/Legal to confirm.`);
  if (s.basicMonthly < law.minimumMonthly) refuse.push(`Basic below the minimum wage of RM${law.minimumMonthly.toFixed(2)}.`);
  return { refuse, flags };
}

// ----------------------------------------------------------------------------------------------------------------------
// O9. Guard allowances (v3 section 8: armed, transport, supervisor, night, remote/rural, custom)
// ----------------------------------------------------------------------------------------------------------------------

export interface GuardAllowance {
  id: Id;
  type: 'armed' | 'transport' | 'supervisor' | 'night' | 'remote' | 'custom';
  label: string;
  basis: 'monthly' | 'per_duty' | 'per_night' | 'per_trip';
  amount: number;
  /** Only when the allowance policy says so (never automatically by calendar days). */
  prorate: boolean;
  from: IsoDate;
  to: IsoDate | null;
  /** PO-7: verified by the HR Director, approved by the COO. Unapproved allowances are not paid. */
  verifiedById: Id | null;
  approvedById: Id | null;
  /** Counted as wages for OT (HR/Legal decides; armed allowance not assumed excluded). */
  partOfWagesForOt: boolean;
  epf: boolean;
  socso: boolean;
  pcb: boolean;
}

export interface AllowanceDuty {
  date: IsoDate;
  status: RosterStatus;
  armedPost: boolean;
  /** Company transport was given that day (no transport allowance). */
  companyTransport: boolean;
  /** Confirmed trips with evidence, for per-trip transport. */
  trips: number;
}

/**
 * Fixed monthly allowances are cut for days lost (Fauzan, 14 Nov 2026): unpaid leave, absence decided unpaid and leave
 * taken off a rostered duty (unscheduled annual leave), at allowance / normal working days a month for each day. Paid
 * sick leave and hospital leave are not cut: they are paid at the ordinary rate of pay (EA s.60F), law first.
 */
export function allowanceLostDays(days: { date: IsoDate; planned: RosterStatus; actual: RosterStatus | null }[], absDecidedUnpaid: IsoDate[]): IsoDate[] {
  const out = new Set<IsoDate>(absDecidedUnpaid);
  for (const d of days) {
    const st = d.actual ?? d.planned;
    if (st === 'UPL') out.add(d.date);
    if (st === 'AL' && d.actual === 'AL' && isDuty(d.planned)) out.add(d.date);
  }
  return [...out].sort();
}

export function allowanceLines(list: GuardAllowance[], duties: AllowanceDuty[], month: string, person: { armedUntil: IsoDate | null }, employedDays: number, lost: { days: IsoDate[]; divisor: number } = { days: [], divisor: 26 }): { label: string; qty: number | null; rate: number | null; amount: number; allowanceId: Id; flags: string[] }[] {
  const out: { label: string; qty: number | null; rate: number | null; amount: number; allowanceId: Id; flags: string[] }[] = [];
  const dates = monthDates(month);
  for (const a of list) {
    const flags: string[] = [];
    if (!a.verifiedById || !a.approvedById) {
      out.push({ label: a.label, qty: 0, rate: a.amount, amount: 0, allowanceId: a.id, flags: ['Not verified by the HR Director and approved by the COO: not paid.'] });
      continue;
    }
    if (a.verifiedById === a.approvedById) {
      out.push({ label: a.label, qty: 0, rate: a.amount, amount: 0, allowanceId: a.id, flags: ['Verified and approved by the same person: not paid.'] });
      continue;
    }
    const inForce = (d: IsoDate) => a.from <= d && (!a.to || d <= a.to);
    const ds = duties.filter((d) => d.date.slice(0, 7) === month && isDuty(d.status) && inForce(d.date));
    let qty = 0;
    if (a.basis === 'monthly') {
      const days = dates.filter(inForce).length;
      const share = a.prorate ? Math.min(days, employedDays) / dates.length : days ? 1 : 0;
      const gone = lost.days.filter((d) => d.slice(0, 7) === month && inForce(d)).length;
      const cut = gone ? Math.min(a.amount * share, (a.amount / Math.max(1, lost.divisor)) * gone) : 0;
      if (gone) flags.push(`${gone} day(s) of unpaid leave, unpaid absence or unscheduled leave: RM${r2(cut).toFixed(2)} less (RM${r2(a.amount / Math.max(1, lost.divisor)).toFixed(2)} a day).`);
      out.push({ label: a.label, qty: null, rate: null, amount: r2(a.amount * share - cut), allowanceId: a.id, flags });
      continue;
    }
    if (a.type === 'armed') {
      const armedDuties = ds.filter((d) => d.armedPost);
      const ok = armedDuties.filter((d) => person.armedUntil && person.armedUntil >= d.date);
      if (ok.length < armedDuties.length) flags.push(`${armedDuties.length - ok.length} armed duty(ies) after the arms authorisation expired: no armed allowance.`);
      qty = ok.length;
    } else if (a.type === 'transport') {
      if (a.basis === 'per_trip') qty = ds.filter((d) => !d.companyTransport).reduce((n, d) => n + d.trips, 0);
      else qty = ds.filter((d) => !d.companyTransport).length;
    } else if (a.basis === 'per_night') qty = ds.filter((d) => rosterDutyShift(d.status) === 'N').length;
    else qty = ds.length;
    out.push({ label: a.label, qty, rate: a.amount, amount: r2(qty * a.amount), allowanceId: a.id, flags });
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------------------------
// Lump-sum agreement (v3 section 7; Fauzan 14 Nov 2026 "Build it fully now"). Consent never waives statutory dues.
// ----------------------------------------------------------------------------------------------------------------------

export interface LumpSumAgreement {
  id: Id;
  personId: Id;
  siteId: Id;
  /** Guaranteed gross target, before separately designated allowances. */
  target: number;
  from: string;
  to: string | null;
  language: 'ms' | 'en' | 'ne' | 'other';
  /** The guard's own positive action: signed paper scanned, or an in-app signature, with its hash. */
  consent: { signedAt: IsoDateTime; method: 'paper_scan' | 'in_app'; documentHash: string; witnessId: Id | null } | null;
  proposedById: Id;
  approvedById: Id | null;
  withdrawnAt: IsoDateTime | null;
  status: 'proposed' | 'signed' | 'refused' | 'withdrawn';
}

/** Consent must be the guard's own, dated at or after the proposal, and never reused or backdated (UAT-20). */
export function lumpSumConsentProblem(a: LumpSumAgreement, input: { signedAt: IsoDateTime; proposedAt: IsoDateTime; now: IsoDateTime; documentHash: string; usedHashes: string[]; byPersonId: Id }): string | null {
  if (a.status !== 'proposed') return 'Only a proposed agreement can be signed.';
  if (input.byPersonId !== a.personId) return 'Only the guard named in the agreement can sign it.';
  if (!/^[a-f0-9]{64}$/.test(input.documentHash)) return 'The signed document hash is needed.';
  if (input.usedHashes.includes(input.documentHash)) return 'This signed document is already used for another agreement.';
  if (Date.parse(input.signedAt) < Date.parse(input.proposedAt)) return 'A signature cannot be dated before the proposal.';
  if (Math.abs(Date.parse(input.now) - Date.parse(input.signedAt)) > 10 * 60_000) return 'The signature time must be the time it is recorded (no backdating).';
  return null;
}

export function lumpSumActive(a: LumpSumAgreement | null | undefined, month: string): a is LumpSumAgreement {
  return !!a && a.status === 'signed' && !!a.consent && !a.withdrawnAt && a.from <= month && (!a.to || month <= a.to);
}

// ----------------------------------------------------------------------------------------------------------------------
// O8. Pay run "roster_hybrid" mode (and v3 "hourly"), one guard, one month
// ----------------------------------------------------------------------------------------------------------------------

export interface HybridDuty {
  date: IsoDate;
  siteId: Id;
  /** Planned status from the published roster (decides rest-day vs ordinary). */
  planned: RosterStatus;
  /** Verified paid minutes (from workedMinutes); null = not yet verified -> exception, paid once verified. */
  workedMinutes: number | null;
  publicHoliday: boolean;
  /** The OM/HR person responsible for verifying (for the exception list). */
  ownerRole?: 'OM' | 'OD_OGM';
}

export interface HybridInput {
  month: string;
  mode: GuardPayMode;
  settings: HybridSettings;
  law?: HybridLaw;
  /** Planned status of every date for this guard (main site's published roster plus others). */
  days: { date: IsoDate; planned: RosterStatus; actual: RosterStatus | null }[];
  duties: HybridDuty[];
  /** ABS days the OD/OGM decided are unpaid (PO-5). */
  absDecidedUnpaid: IsoDate[];
  /**
   * ABS days the OD/OGM decided are paid (Fauzan's audit of 4b708ae, P1). An ABS day in neither list waits for the
   * decision. Absent (older callers): every ABS day not decided unpaid is taken as waiting.
   */
  absDecidedPaid?: IsoDate[];
  joinedOn: IsoDate;
  leftOn: IsoDate | null;
  allowances?: ReturnType<typeof allowanceLines>;
  lumpSum?: LumpSumAgreement | null;
}

export type HybridItemKind = 'basic' | 'unpaid' | 'ot' | 'rest_day' | 'holiday' | 'allowance' | 'topup' | 'hourly';
export interface HybridItem {
  label: string;
  kind: HybridItemKind;
  qty: number | null;
  unit: 'day' | 'hour' | null;
  rate: number | null;
  amount: number;
}

export interface HybridResult {
  items: HybridItem[];
  /** Due under law and the formula, before allowances (v3 independent_due_before_allowances). */
  independentDue: number;
  gross: number;
  offDays: number;
  unpaidDays: number;
  normalMinutes: number;
  otMinutes: number;
  restDayMinutes: number;
  holidayMinutes: number;
  otRate: number;
  statutoryOtRate: number;
  method: string;
  /** Duties not yet verified: not paid yet, listed for the OM. */
  unverified: IsoDate[];
  /** ABS days waiting for the OD/OGM decision. */
  absPending: IsoDate[];
  lumpSum: { target: number; topUp: number; shortfall: number } | null;
  flags: string[];
}

/**
 * Basic is the full monthly basic, never reduced for OFF-REST, OFF-ADD, paid leave or public holidays. Deductions only
 * for UPL, ABS the OD/OGM decided unpaid, and days before joining / after leaving. Overtime from verified minutes above
 * normal hours on each WORK day, summed for the month and rounded once. Rest-day pay only for duties on OFF dates.
 */
export function hybridPay(i: HybridInput): HybridResult {
  const s = i.settings;
  const law = i.law ?? DEFAULT_HYBRID_LAW;
  const dates = monthDates(i.month);
  const flags: string[] = [];
  const items: HybridItem[] = [];
  const add = (label: string, kind: HybridItemKind, qty: number | null, unit: HybridItem['unit'], rate: number | null, amount: number) => {
    if (amount === 0 && kind !== 'basic') return;
    items.push({ label, kind, qty: qty == null ? null : r2(qty), unit, rate: rate == null ? null : r2(rate), amount: r2(amount) });
  };
  const stat = statutoryRates(s, law);
  const ot = ordinaryOtRate(s, law);
  const normalMin = s.normalHoursPerDay * 60;
  const planned = new Map(i.days.map((d) => [d.date, d.planned]));

  // Days employed and unpaid days.
  const employed = dates.filter((d) => d >= i.joinedOn && (!i.leftOn || d <= i.leftOn));
  const absPending = i.days.filter((d) => (d.actual ?? d.planned) === 'ABS' && !i.absDecidedUnpaid.includes(d.date) && !(i.absDecidedPaid ?? []).includes(d.date)).map((d) => d.date);
  const unpaid = new Set<IsoDate>([...i.days.filter((d) => (d.actual ?? d.planned) === 'UPL').map((d) => d.date), ...i.absDecidedUnpaid].filter((d) => employed.includes(d)));
  const offDays = i.days.filter((d) => isOff(d.planned)).length;
  const fullMonth = employed.length === dates.length;
  let basic = s.basicMonthly;
  let method = '';
  if (i.mode !== 'hourly') {
    if (s.incompleteMonthMethod === 's18A_calendar') {
      const eligible = employed.length - unpaid.size;
      basic = (s.basicMonthly * Math.max(0, eligible)) / dates.length;
      method = `EA s.18A: basic x ${eligible} eligible days / ${dates.length} calendar days`;
    } else {
      const daily = s.basicMonthly / s.normalWorkingDaysPerMonth;
      if (fullMonth) {
        basic = Math.max(0, s.basicMonthly - unpaid.size * daily);
        method = `Normal working days: daily rate = basic / ${s.normalWorkingDaysPerMonth}${unpaid.size ? `, ${unpaid.size} unpaid day(s) deducted` : ''}`;
      } else {
        // Join or leave in the month: daily rate x normal working days employed (the roster's non-OFF days employed).
        const workingEmployed = employed.filter((d) => !isOff(planned.get(d)) && planned.get(d) !== 'TRF' && planned.get(d) !== 'END').length;
        const days = Math.max(0, Math.min(s.normalWorkingDaysPerMonth, workingEmployed) - unpaid.size);
        basic = Math.min(s.basicMonthly, days * daily);
        method = `Part month: ${days} normal working day(s) employed x basic / ${s.normalWorkingDaysPerMonth}`;
      }
      if (s.normalWorkingDaysPerMonth < law.divisor && (unpaid.size || !fullMonth)) flags.push(`Divisor ${s.normalWorkingDaysPerMonth} is under ${law.divisor}: EA s.60I / s.18A would deduct less (law flag for the CEO).`);
    }
    add('Monthly basic', 'basic', null, null, null, s.basicMonthly);
    if (r2(basic) !== r2(s.basicMonthly)) add(`Incomplete month (${method})`, 'unpaid', unpaid.size || null, unpaid.size ? 'day' : null, null, basic - s.basicMonthly);
  } else {
    basic = 0;
    method = `Hourly at RM${(s.hourlyRate ?? 0).toFixed(2)}`;
  }

  // Duties.
  const unverified: IsoDate[] = [];
  let ordinaryOtMin = 0;
  let normalWorkedMin = 0;
  let restMin = 0;
  let restExtra = 0;
  let restDays = 0;
  let phMin = 0;
  let phExtra = 0;
  let phOt = 0;
  let phOtMin = 0;
  let restOt = 0;
  let restOtMin = 0;
  let phDays = 0;
  let heldOffAdd = 0;
  for (const d of i.duties.filter((x) => x.date.slice(0, 7) === i.month)) {
    if (d.workedMinutes === null) {
      unverified.push(d.date);
      continue;
    }
    const m = d.workedMinutes;
    const offStatus = planned.get(d.date);
    const restLike = offStatus === 'OFF_REST' || (offStatus === 'OFF_ADD' && s.restDayExtraTreatment === 'same_as_rest_day');
    if (offStatus === 'OFF_ADD' && s.restDayExtraTreatment === 'ask_each_time') {
      heldOffAdd++;
      continue;
    }
    if (d.publicHoliday) {
      // EA s.60D(3): 2 extra days' wages for normal hours, hours above normal at 3x the statutory hourly rate.
      phDays++;
      phMin += m;
      phExtra += stat.daily * s.publicHolidayDays;
      // Overtime is its own item so EPF never counts it (review of PR #141).
      phOt += (Math.max(0, m - normalMin) / 60) * stat.hourly * s.otPublicHolidayRate;
      phOtMin += Math.max(0, m - normalMin);
      continue;
    }
    if (restLike) {
      restDays++;
      restMin += m;
      const nh = Math.min(m, normalMin) / 60;
      const over = Math.max(0, m - normalMin) / 60;
      // Statutory: half a day's wages up to half the normal hours, a full day above (EA s.60(3)(a)), + 2x for hours above.
      const statDay = m <= normalMin / 2 ? stat.daily * s.restDayDays * 0.5 : stat.daily * s.restDayDays;
      const statutory = statDay + over * stat.hourly * s.otRestDayRate;
      const company = s.restDayNormalRateBase === 'fixed' && s.otFixedBase ? nh * s.otFixedBase + over * s.otFixedBase * s.restDayOtMultiplier : 0;
      // The higher of the two is paid, split into the day's pay and its overtime (EPF never counts overtime).
      if (statutory >= company) {
        restExtra += statDay;
        restOt += over * stat.hourly * s.otRestDayRate;
      } else {
        restExtra += nh * s.otFixedBase!;
        restOt += over * s.otFixedBase! * s.restDayOtMultiplier;
      }
      restOtMin += over * 60;
      continue;
    }
    if (i.mode === 'hourly') {
      normalWorkedMin += Math.min(m, normalMin);
      ordinaryOtMin += Math.max(0, m - normalMin);
      continue;
    }
    normalWorkedMin += Math.min(m, normalMin);
    ordinaryOtMin += Math.max(0, m - normalMin);
  }
  let otRate = ot.rate;
  if (i.mode === 'hourly') {
    const hr = s.hourlyRate ?? 0;
    otRate = r2(hr * s.otNormalRate);
    add('Normal hours worked', 'hourly', normalWorkedMin / 60, 'hour', hr, (normalWorkedMin / 60) * hr);
    const monthlyFloor = law.minimumMonthly * (employed.length / dates.length);
    const earned = (normalWorkedMin / 60) * hr;
    if (earned < monthlyFloor && normalWorkedMin / 60 >= (s.normalHoursPerDay * s.workDaysPerWeek * 52) / 12 - 0.01)
      flags.push('Hourly pay for a full month is below the monthly minimum wage: top up to the minimum.');
  }
  add('Ordinary overtime', 'ot', ordinaryOtMin / 60, 'hour', otRate, (ordinaryOtMin / 60) * otRate);
  if (ot.used === 'company' && i.mode !== 'hourly') flags.push(`OT at the company rate RM${ot.rate.toFixed(2)}/h (statutory RM${ot.statutory.toFixed(2)}/h): the higher is paid.`);
  add('Rest-day work (extra)', 'rest_day', restDays, 'day', null, restExtra);
  add('Rest-day overtime', 'ot', restOtMin / 60, 'hour', null, restOt);
  add('Public holiday work (extra)', 'holiday', phDays, 'day', null, phExtra);
  add('Public holiday overtime', 'ot', phOtMin / 60, 'hour', null, phOt);
  if (heldOffAdd) flags.push(`${heldOffAdd} duty(ies) on an OFF-ADD day wait for a decision on how they are paid.`);
  if (unverified.length) flags.push(`${unverified.length} duty(ies) not verified yet: paid once the OM verifies the hours.`);
  if (absPending.length) flags.push(`${absPending.length} ABS day(s) wait for the OD/OGM decision (OFF days are never absence).`);
  if (offDays) flags.push(`OFF days: ${offDays} (not absence)`);

  const independentDue = r2(items.reduce((n, x) => n + x.amount, 0));
  let lumpSum: HybridResult['lumpSum'] = null;
  if (lumpSumActive(i.lumpSum, i.month)) {
    const target = i.lumpSum.target;
    const topUp = r2(Math.max(0, target - independentDue));
    const shortfall = r2(Math.max(0, independentDue - target));
    lumpSum = { target, topUp, shortfall };
    add('Agreed pay top-up', 'topup', null, null, null, topUp);
    if (shortfall > 0) flags.push(`Agreed target RM${target.toFixed(2)} is RM${shortfall.toFixed(2)} below what is due: the full RM${independentDue.toFixed(2)} is paid (consent never waives wages).`);
  }
  for (const a of i.allowances ?? []) {
    add(a.label, 'allowance', a.qty, a.qty === null ? null : 'day', a.rate, a.amount);
    flags.push(...a.flags);
  }
  const gross = r2(items.reduce((n, x) => n + x.amount, 0));
  return {
    items,
    independentDue,
    gross,
    offDays,
    unpaidDays: unpaid.size,
    normalMinutes: normalWorkedMin,
    otMinutes: ordinaryOtMin,
    restDayMinutes: restMin,
    holidayMinutes: phMin,
    otRate,
    statutoryOtRate: ot.statutory,
    method,
    unverified,
    absPending,
    lumpSum,
    flags,
  };
}

// ----------------------------------------------------------------------------------------------------------------------
// O10. Duty ledger (one line per duty) and O11. exception list
// ----------------------------------------------------------------------------------------------------------------------

export interface DutyLedgerLine {
  personId: Id;
  homeSiteId: Id | null;
  costSiteId: Id;
  date: IsoDate;
  shift: 'D' | 'N' | null;
  plannedStart: IsoDateTime | null;
  plannedEnd: IsoDateTime | null;
  actualStart: IsoDateTime | null;
  actualEnd: IsoDateTime | null;
  workedMinutes: number | null;
  unpaidBreakMinutes: number;
  normalMinutes: number;
  otMinutes: number;
  status: RosterStatus;
  restDayType: 'OFF_REST' | 'OFF_ADD' | null;
  publicHoliday: boolean;
  rosterVersionId: Id | null;
  attendanceId: Id | null;
  exceptions: string[];
}

export function ledgerTotals(lines: DutyLedgerLine[]) {
  return lines.reduce((t, l) => ({ worked: t.worked + (l.workedMinutes ?? 0), normal: t.normal + l.normalMinutes, ot: t.ot + l.otMinutes }), { worked: 0, normal: 0, ot: 0 });
}

export type ExceptionKind =
  | 'UNCOVERED'
  | 'OVER_COVERAGE'
  | 'CLIENT_LIMIT'
  | 'MISSING_REST_DAY'
  | 'DOUBLE_BOOKED'
  | 'MISSING_CLOCK_OUT'
  | 'BREAK_UNCONFIRMED'
  | 'ABS_WAITING'
  | 'PIECEMEAL_MOVE'
  | 'PAY_ROSTER_MISMATCH'
  | 'LATE_CHANGE'
  | 'LAW_FLAG'
  | 'UNVERIFIED_DUTY';

export interface RosterException {
  kind: ExceptionKind;
  siteId: Id;
  personId: Id | null;
  date: IsoDate | null;
  owner: 'OM' | 'OD_OGM';
  due: IsoDate;
  message: string;
  level: CheckLevel;
}

const KIND_OF: Record<string, ExceptionKind> = {
  UNCOVERED: 'UNCOVERED',
  OVER_COVERAGE: 'OVER_COVERAGE',
  CLIENT_60H: 'CLIENT_LIMIT',
  CLIENT_LONG_DUTIES: 'CLIENT_LIMIT',
  CLIENT_DAYS_IN_ROW: 'CLIENT_LIMIT',
  CLIENT_DUTY_HOURS: 'CLIENT_LIMIT',
  LAW_WEEKLY_REST: 'MISSING_REST_DAY',
  LAW_NO_REST_DAY_MARKED: 'MISSING_REST_DAY',
  DOUBLE_BOOKED: 'DOUBLE_BOOKED',
  PIECEMEAL_MOVE: 'PIECEMEAL_MOVE',
};

/** One list per company and month for the OM, OD/OGM, ACT, COO and CEO. Each item has an owner and a due date. */
export function rosterExceptions(siteId: Id, today: IsoDate, findings: RosterFinding[], pay: { personId: Id; result: HybridResult }[] = []): RosterException[] {
  const out: RosterException[] = [];
  for (const f of findings) {
    if (f.level === 'info') continue;
    out.push({ kind: KIND_OF[f.code] ?? 'LAW_FLAG', siteId, personId: f.personId, date: f.date, owner: f.owner, due: addDaysIso(today, f.level === 'block' ? 1 : 3), message: f.message, level: f.level });
  }
  for (const p of pay) {
    for (const d of p.result.unverified) out.push({ kind: 'UNVERIFIED_DUTY', siteId, personId: p.personId, date: d, owner: 'OM', due: addDaysIso(today, 1), message: 'Duty hours not verified yet.', level: 'amber' });
    for (const d of p.result.absPending) out.push({ kind: 'ABS_WAITING', siteId, personId: p.personId, date: d, owner: 'OD_OGM', due: addDaysIso(today, 2), message: 'Absence waiting for the OD/OGM decision.', level: 'amber' });
  }
  return out;
}

/** Dashboard numbers per site and month (D3 sec. 11, v3 section 4). */
export function rosterDashboard(i: { siteId: Id; month: string; coverage: SiteCoverage[]; days: RosterDay[]; ledger: DutyLedgerLine[]; exceptions: RosterException[] }) {
  const need = requiredCoverage(i.coverage, i.siteId, i.month);
  const filled = i.days.filter((d) => isDuty(d.planned)).length;
  const per = new Map<Id, number>();
  for (const d of i.days.filter((x) => isDuty(x.planned))) per.set(d.personId, (per.get(d.personId) ?? 0) + 1);
  const counts = (s: RosterStatus[]) => i.days.filter((d) => s.includes(d.actual ?? d.planned)).length;
  const t = ledgerTotals(i.ledger);
  return {
    required: need.total,
    filled,
    coveragePct: need.total ? r2((Math.min(filled, need.total) / need.total) * 100) : 100,
    dutiesPerGuard: [...per.values()].sort((a, b) => a - b),
    scheduledMinutes: i.days.filter((d) => isDuty(d.planned)).reduce((n, d) => n + dutyMinutes(d), 0),
    verifiedMinutes: t.worked,
    normalMinutes: t.normal,
    otMinutes: t.ot,
    off: counts(['OFF_REST', 'OFF_ADD']),
    leave: counts(['AL', 'MC', 'HOSP']),
    upl: counts(['UPL']),
    abs: counts(['ABS']),
    openExceptions: i.exceptions.length,
  };
}
