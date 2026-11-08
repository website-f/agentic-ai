import { AccessDenied } from "./access";
import type { CleaningService } from "./cleaning-service";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { ReviewConflict } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import { addMinutes } from "./time";
import { ageOn } from "./time";
import { dateOf } from "./time";
import { fromMs } from "./time";
import { minutesBetween } from "./time";
import { toMs } from "./time";
import type { Credential } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { Person } from "./types";
import type { Shift } from "./types";
import type { Site } from "./types";
import type { User } from "./types";


export type DutyKind = 'handover' | 'patrol' | 'post' | 'meal' | 'log' | 'visit' | 'travel' | 'lunch';

export interface DutyTask {
  id: Id;
  /** Guard (person id) or officer (user id). */
  who: Id;
  whoName: string;
  postId: Id | null;
  siteId: Id | null;
  kind: DutyKind;
  title: string;
  start: IsoDateTime;
  end: IsoDateTime;
  minutes: number;
}

export interface DutyPlan {
  /** duty-<siteId>-<date> for a site's posts; route-<officerId>-<date> for an officer. */
  id: Id;
  companyId: Id;
  kind: 'post' | 'route';
  siteId: Id | null;
  officerId: Id | null;
  date: IsoDate;
  status: 'published';
  tasks: DutyTask[];
  warnings: string[];
  /** The roster the plan was made from (shift id and guard), so a later roster change shows the plan is out of date. */
  basis: string;
  publishedAt: IsoDateTime;
  publishedBy: string;
  /** Route plans: the officer's hours the OM set for the day (none = the default 8am to 5pm). */
  hours?: OfficerHours | null;
}

export const DUTY_RULES = {
  handoverMin: 10,
  firstRoundAfterMin: 30,
  /** Minutes per checkpoint on a round, and the least a round takes. */
  perCheckpointMin: 3,
  minRoundMin: 15,
  /** A 30-minute meal break after about half the shift; two on a 12-hour shift (Employment Act s.60A: a break of at least 30 minutes after 5 hours). */
  mealMin: 30,
  logEveryMin: 240,
  logMin: 5,
  /** Officer visits by site risk, minutes. */
  visitMin: { high: 45, medium: 30, low: 20 } as Record<Site['risk'], number>,
  /** Officer driving speed for travel time between sites, km/h. */
  travelKmh: 40,
  officerDay: { start: '08:00', end: '17:00', lunch: '13:00', lunchMin: 60 },
} as const;

/** What the JA app (or the app that runs the work) sends back each month, to match against the published plans. */
export const SECURITY_MONTHLY_RETURN = {
  version: 2,
  guards: [
    'per published duty plan task (id): patrol round done time, and each checkpoint tapped with its time (or missed with reason)',
    'per shift: clock-in and clock-out times by face or RFID/NFC, handover done, meal break taken',
    'guards present against the contract per shift, and any relief guard sent',
    'log book entries count per shift; the daily report handed to the premise administrator, with the time',
    'guard tour system down: from and to, cause, and the fallback used (watchman clock, or 3 time-stamp photos from different angles at each point)',
    'equipment faults: reported time and fixed or replaced time',
  ],
  officers: ['per planned visit (task id): arrival and leaving time with GPS, findings, photo', 'sites not visited and why', 'extra visits not in the plan'],
  rules: [
    'Task ids come from Prima’s published plan.',
    'A round is on time when it starts within 15 minutes of the planned time.',
    'Every planned checkpoint tap counts: a missed tap is a missed clocking (government contracts deduct per missed clocking).',
  ],
} as const;

/**
 * A guarded site's contract terms (Fauzan, 4 Nov 2026, from the KPM guard contract he shared): the guards each shift
 * needs, the rate per guard-hour (KHS) and the client's rules the plan must follow. The OM enters them from the
 * contract; Prima never guesses a rate.
 */
export interface GuardTerms {
  /** gterms-<siteId> */
  id: Id;
  companyId: Id;
  siteId: Id;
  contractRef: string;
  /** Kadar Harga Sejam: what the client pays per guard-hour, RM. null when not entered. */
  ratePerGuardHour: number | null;
  /** The contract's shifts and guards required on each, e.g. 08:00-20:00 x1 and 20:00-08:00 x1. */
  shifts: { name: string; start: string; end: string; guards: number }[];
  /** Least number of guard tour (clocking) points the contract requires on site. */
  minCheckpoints: number;
  /** The patrolling officer must visit at least every N days (KPM: weekly, every 2 weeks for interior sites). null: no rule. */
  officerVisitDays: number | null;
  /** The daily report must reach the premise administrator by this time the next day (KPM: 09:00). null: no rule. */
  dailyReportBy: string | null;
  /**
   * What the contract says about the guards themselves. Our group rules stay in charge (Fauzan, 4 Nov 2026: "Follow our
   * ruling. Then flag if contract and our rule collide"); these are only compared and flagged, never enforced.
   */
  guardRules?: GuardContractRules | null;
  version: number;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

/** The contract's own rules about the guards (KPM Lampiran A2 3.1.4.2). null or false: the contract says nothing. */
export interface GuardContractRules {
  maxAge: number | null;
  malaysiansOnly: boolean;
  csgWithinMonths: number | null;
  vettingWithinWorkingDays: number | null;
  urineTestWithinDays: number | null;
  maxRelatives: number | null;
}

/** The KPM school guard contract's guard rules. */
export const KPM_GUARD_RULES: GuardContractRules = { maxAge: 65, malaysiansOnly: true, csgWithinMonths: 6, vettingWithinWorkingDays: 60, urineTestWithinDays: 14, maxRelatives: 2 };

/** Where the contract and our group rules differ. Our rule applies; the flag says what the contract would expect. */
export interface GuardRuleClash {
  topic: string;
  ours: string;
  contract: string;
  /** What it means at this site. */
  note: string;
}

export function guardRuleClashes(r: GuardContractRules | null | undefined): GuardRuleClash[] {
  if (!r) return [];
  const out: GuardRuleClash[] = [];
  const maxAge = RULES.maxGuardAge.value;
  if (r.maxAge != null && r.maxAge !== maxAge)
    out.push({
      topic: 'Guard age',
      ours: `no guard over ${maxAge}`,
      contract: `up to ${r.maxAge}`,
      note: r.maxAge > maxAge ? `Our rule applies: no guard over ${maxAge} here, although the contract allows ${r.maxAge}.` : `The contract is stricter: guards over ${r.maxAge} would breach the contract here, although our rule allows ${maxAge}.`,
    });
  const csg = RULES.csgDeadlineMonths.value;
  if (r.csgWithinMonths != null && r.csgWithinMonths !== csg)
    out.push({
      topic: 'CSG course',
      ours: `within ${csg} months of joining`,
      contract: `within ${r.csgWithinMonths} months of the contract start or appointment`,
      note: r.csgWithinMonths < csg ? `Our rule applies, but a guard here without CSG after ${r.csgWithinMonths} months breaches the contract; they are flagged on the plan.` : `Our rule applies: CSG within ${csg} months, sooner than the contract asks.`,
    });
  if (r.malaysiansOnly)
    out.push({ topic: 'Nationality', ours: 'Malaysian and Nepali guards', contract: 'Malaysian citizens only', note: 'Our rule allows Nepali guards; any rostered here are flagged on the plan as a contract breach.' });
  if (r.vettingWithinWorkingDays != null)
    out.push({
      topic: 'KDN vetting',
      ours: 'a guard may work once vetting is submitted in eSIMS, while it is pending',
      contract: `vetting passed within ${r.vettingWithinWorkingDays} working days, or the guard is replaced at once`,
      note: 'Our rule applies; follow up any vetting still pending near the contract’s limit.',
    });
  if (r.urineTestWithinDays != null) out.push({ topic: 'Urine test', ours: 'no group rule', contract: `passed within ${r.urineTestWithinDays} days, result to the premise administrator`, note: 'No group rule to compare; the contract requirement is noted for HR.' });
  if (r.maxRelatives != null) out.push({ topic: 'Relatives', ours: 'no group rule', contract: `at most ${r.maxRelatives} related guards on the contract`, note: 'No group rule to compare; the contract requirement is noted for the OM.' });
  return out;
}

/**
 * Rostered guards who meet our rules but not the contract's (Fauzan, 4 Nov 2026): flagged, never blocked. A guard who
 * breaks our own rule is stopped by the roster checks already.
 */
export function guardContractFlags(r: GuardContractRules | null | undefined, guards: Person[], credentials: Credential[], date: IsoDate): string[] {
  if (!r) return [];
  const out: string[] = [];
  for (const g of guards) {
    const why: string[] = [];
    const age = ageOn(g.dob, date);
    if (r.maxAge != null && age > r.maxAge && age <= RULES.maxGuardAge.value) why.push(`is ${age}, over the contract's ${r.maxAge}`);
    if (r.malaysiansOnly && g.nationality !== 'MY') why.push('is not Malaysian (contract: Malaysians only)');
    if (r.csgWithinMonths != null && !credentials.some((c) => c.personId === g.id && c.type === 'CSG_TRAINING')) {
      const due = addMonthsIso(g.hiredOn, r.csgWithinMonths);
      if (due < date) why.push(`has no CSG ${r.csgWithinMonths} months after joining (contract limit)`);
    }
    if (why.length) out.push(`Contract flag: ${g.name} ${why.join('; ')}. Our rules allow it; check with the client.`);
  }
  return out;
}

function addMonthsIso(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, day));
  return t.toISOString().slice(0, 10);
}

/** Days a month for the contract's monthly price (KPM: 30.5). */
export const GUARD_MONTH_DAYS = 30.5;

/**
 * The KPM guard contract's deductions (Lampiran A3, Jadual 6), so the plan shows what a gap would cost. KHS is the rate
 * per guard-hour. Estimates only: the client decides the deduction.
 */
export const GUARD_DEDUCTION_RULES = [
  { key: 'absent', what: 'Guards not placed at the premise, or not as the schedule sets', formula: 'KHS x guards missing x hours missing' },
  { key: 'clocking', what: 'Patrol and clocking not done (or late) at the set points', formula: 'missed clockings x 20% x KHS' },
  { key: 'equipment', what: 'Equipment not supplied, not working or not maintained', formula: '1% x the month’s service payment' },
  { key: 'uniform', what: 'Guard not in the approved uniform or not ready for duty', formula: 'KHS x guards x hours late, or 1% x the month’s service payment' },
  { key: 'loss', what: 'Loss or damage to the client’s property by negligence', formula: 'a penalty the client sets' },
] as const;

/** KPM guard contract defaults: two 12-hour shifts, 4 guard tour points, weekly officer visit, daily report by 9am. */
export function kpmGuardTerms(guardsPerShift = 1): Pick<GuardTerms, 'shifts' | 'minCheckpoints' | 'officerVisitDays' | 'dailyReportBy'> {
  return {
    shifts: [
      { name: 'Shift 1', start: '08:00', end: '20:00', guards: guardsPerShift },
      { name: 'Shift 2', start: '20:00', end: '08:00', guards: guardsPerShift },
    ],
    minCheckpoints: 4,
    officerVisitDays: 7,
    dailyReportBy: '09:00',
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hmMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Length of a shift in hours; an end at or before the start runs past midnight. */
export function guardShiftHours(start: string, end: string): number {
  return (((hmMin(end) - hmMin(start) + 1440) % 1440) || 1440) / 60;
}

/** Checks the terms the OM entered; throws plain words. */
export function checkGuardTerms(v: unknown): Pick<GuardTerms, 'contractRef' | 'ratePerGuardHour' | 'shifts' | 'minCheckpoints' | 'officerVisitDays' | 'dailyReportBy' | 'guardRules'> {
  const t = (v ?? {}) as Record<string, unknown>;
  const contractRef = typeof t.contractRef === 'string' ? t.contractRef.trim().slice(0, 120) : '';
  let rate: number | null = null;
  if (t.ratePerGuardHour != null && t.ratePerGuardHour !== '') {
    rate = Number(t.ratePerGuardHour);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 500) throw new BadRequest('Rate per guard-hour: RM0.01 to RM500.');
    rate = Math.round(rate * 100) / 100;
  }
  if (!Array.isArray(t.shifts) || t.shifts.length < 1 || t.shifts.length > 4) throw new BadRequest('Give 1 to 4 shifts.');
  const shifts = t.shifts.map((x, i) => {
    const y = (x ?? {}) as Record<string, unknown>;
    const start = String(y.start ?? '');
    const end = String(y.end ?? '');
    if (!HHMM.test(start) || !HHMM.test(end) || start === end) throw new BadRequest(`Shift ${i + 1}: start and end as HH:MM.`);
    if (guardShiftHours(start, end) > 12) throw new BadRequest(`Shift ${i + 1}: a guard may not work more than 12 hours a day.`);
    const guards = Number(y.guards);
    if (!Number.isInteger(guards) || guards < 0 || guards > 200) throw new BadRequest(`Shift ${i + 1}: guards 0 to 200.`);
    const name = typeof y.name === 'string' && y.name.trim() ? y.name.trim().slice(0, 40) : `Shift ${i + 1}`;
    return { name, start, end, guards };
  });
  const minCheckpoints = Number(t.minCheckpoints ?? 0);
  if (!Number.isInteger(minCheckpoints) || minCheckpoints < 0 || minCheckpoints > 100) throw new BadRequest('Guard tour points: 0 to 100.');
  let officerVisitDays: number | null = null;
  if (t.officerVisitDays != null && t.officerVisitDays !== '') {
    officerVisitDays = Number(t.officerVisitDays);
    if (!Number.isInteger(officerVisitDays) || officerVisitDays < 1 || officerVisitDays > 90) throw new BadRequest('Officer visit: every 1 to 90 days.');
  }
  const dailyReportBy = t.dailyReportBy == null || t.dailyReportBy === '' ? null : String(t.dailyReportBy);
  if (dailyReportBy !== null && !HHMM.test(dailyReportBy)) throw new BadRequest('Daily report time as HH:MM.');
  let guardRules: GuardContractRules | null = null;
  if (t.guardRules != null) {
    const g = t.guardRules as Record<string, unknown>;
    const n = (v: unknown, what: string, min: number, max: number) => {
      if (v == null || v === '') return null;
      const x = Number(v);
      if (!Number.isInteger(x) || x < min || x > max) throw new BadRequest(`Contract guard rules: ${what} ${min} to ${max}.`);
      return x;
    };
    guardRules = {
      maxAge: n(g.maxAge, 'age limit', 18, 80),
      malaysiansOnly: g.malaysiansOnly === true,
      csgWithinMonths: n(g.csgWithinMonths, 'CSG months', 1, 36),
      vettingWithinWorkingDays: n(g.vettingWithinWorkingDays, 'vetting working days', 1, 365),
      urineTestWithinDays: n(g.urineTestWithinDays, 'urine test days', 1, 365),
      maxRelatives: n(g.maxRelatives, 'relatives', 0, 50),
    };
  }
  return { contractRef, ratePerGuardHour: rate, shifts, minCheckpoints, officerVisitDays, dailyReportBy, guardRules };
}

/** One contract shift on a date: guards needed against guards on the roster, and what a gap would cost. */
export interface GuardCover {
  name: string;
  start: string;
  end: string;
  hours: number;
  required: number;
  rostered: number;
  short: number;
  /** KHS x guards short x hours; null without a rate. */
  deduction: number | null;
}

/**
 * Guards on the roster against the contract for each shift starting on a date (shifts are matched by start time), with
 * the deduction a gap would bring (KPM Jadual 6 item 1), the month's price, and the cost of one missed clocking.
 */
export function guardCover(terms: GuardTerms, shifts: Shift[], siteId: Id, date: IsoDate) {
  const mine = shifts.filter((s) => s.siteId === siteId && s.date === date);
  const cover: GuardCover[] = terms.shifts.map((c) => {
    const rostered = mine.filter((s) => s.personId && hm(s.start) === c.start).length;
    const hours = guardShiftHours(c.start, c.end);
    const short = Math.max(0, c.guards - rostered);
    return { name: c.name, start: c.start, end: c.end, hours, required: c.guards, rostered, short, deduction: terms.ratePerGuardHour == null ? null : Math.round(terms.ratePerGuardHour * short * hours * 100) / 100 };
  });
  // Guards rostered at times the contract does not list (e.g. roster 07:00, contract 08:00) are not counted as cover.
  const starts = new Set(terms.shifts.map((c) => c.start));
  const offTimes = [...new Set(mine.filter((s) => s.personId && !starts.has(hm(s.start))).map((s) => `${hm(s.start)}-${hm(s.end)}`))].sort();
  const rate = terms.ratePerGuardHour;
  const guardHours = terms.shifts.reduce((n, c) => n + c.guards * guardShiftHours(c.start, c.end), 0);
  return {
    cover,
    shortGuardHours: cover.reduce((n, c) => n + c.short * c.hours, 0),
    deduction: rate == null ? null : Math.round(cover.reduce((n, c) => n + (c.deduction ?? 0), 0) * 100) / 100,
    monthlyPrice: rate == null ? null : Math.round(rate * guardHours * GUARD_MONTH_DAYS * 100) / 100,
    missedClockingCost: rate == null ? null : Math.round(rate * 0.2 * 100) / 100,
    offTimes,
  };
}

function hm(t: IsoDateTime): string {
  return fromMs(toMs(t)).slice(11, 16);
}

/** Minute-by-minute duties for every guard on one site's shifts starting on a date. */
export function planPosts(input: {
  site: Site;
  date: IsoDate;
  shifts: Shift[];
  posts: { id: Id; name: string; guardsPerShift: number }[];
  checkpoints: number;
  names: Map<Id, string>;
  /** The site's contract terms, when entered: cover check, guard tour points and the daily report. */
  terms?: GuardTerms | null;
  /** Rostered guards' records and credentials, to flag the contract's own guard rules. */
  guards?: Person[];
  credentials?: Credential[];
}): { tasks: DutyTask[]; warnings: string[] } {
  const R = DUTY_RULES;
  const every = input.site.patrolIntervalMin ?? RULES.patrolGapMin.value;
  const roundMin = Math.max(R.minRoundMin, input.checkpoints * R.perCheckpointMin);
  const tasks: DutyTask[] = [];
  const warnings: string[] = [];
  const shifts = input.shifts.filter((s) => s.date === input.date && s.siteId === input.site.id).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  if (!shifts.length) warnings.push('No shifts on the roster for this day.');
  if (!input.checkpoints) warnings.push('No patrol checkpoints set at this site: rounds are planned as a walk of the site.');
  const T = input.terms ?? null;
  if (T) {
    if (input.checkpoints < T.minCheckpoints) warnings.push(`The contract needs at least ${T.minCheckpoints} guard tour points; ${input.checkpoints} set at this site.`);
    const c = guardCover(T, input.shifts, input.site.id, input.date);
    if (c.offTimes.length) warnings.push(`Roster shifts ${c.offTimes.join(', ')} do not match the contract's shift times (${T.shifts.map((x) => `${x.start}-${x.end}`).join(', ')}): change the roster or the terms, or those guards do not count as cover.`);
    for (const x of c.cover.filter((x) => x.short > 0))
      warnings.push(`${x.name} ${x.start}-${x.end}: the contract needs ${x.required} guard${x.required === 1 ? '' : 's'}, ${x.rostered} on the roster${x.deduction != null ? `: about RM${x.deduction.toFixed(2)} deduction if not filled` : ''}.`);
    const onDay = new Set(input.shifts.filter((x) => x.siteId === input.site.id && x.date === input.date && x.personId).map((x) => x.personId!));
    warnings.push(...guardContractFlags(T.guardRules, (input.guards ?? []).filter((g) => onDay.has(g.id)), input.credentials ?? [], input.date));
    if (T.shifts.some((x) => x.guards === 1)) warnings.push('One guard on a shift: the contract says how often to patrol is agreed with the premise administrator. Set it as the site’s patrol interval.');
  }
  // Shifts on the same post and the same hours share the work: rounds alternate and meals are staggered.
  const groups = new Map<string, Shift[]>();
  for (const s of shifts) {
    const k = `${s.postId}|${s.start}|${s.end}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  let seq = 0;
  const add = (s: Shift, who: Id, kind: DutyKind, title: string, start: IsoDateTime, min: number) => {
    tasks.push({ id: `dt-${input.site.id}-${input.date.replace(/-/g, '')}-${++seq}`, who, whoName: input.names.get(who) ?? who, postId: s.postId, siteId: s.siteId, kind, title, start, end: addMinutes(start, min), minutes: min });
  };
  for (const group of groups.values()) {
    const post = input.posts.find((p) => p.id === group[0].postId);
    const filled = group.filter((s) => s.personId);
    if (filled.length < group.length) warnings.push(`${post?.name ?? 'A post'} ${hm(group[0].start)}-${hm(group[0].end)}: ${group.length - filled.length} shift(s) not filled.`);
    const len = minutesBetween(group[0].start, group[0].end);
    // Rounds: one guard each time, in turns; a lone guard locks the post while on a round.
    const rounds: number[] = [];
    for (let t = R.firstRoundAfterMin; t + roundMin <= len - R.handoverMin; t += every) rounds.push(t);
    const meals = len >= 11 * 60 ? [Math.round(len / 3), Math.round((2 * len) / 3)] : len >= 6 * 60 ? [Math.round(len / 2)] : [];
    filled.forEach((s, gi) => {
      const who = s.personId!;
      const busy: [number, number, DutyKind, string][] = [];
      busy.push([0, R.handoverMin, 'handover', `Take over ${post?.name ?? 'the post'}: log book, keys, radio, incidents from the last shift`]);
      busy.push([len - R.handoverMin, len, 'handover', 'Hand over to the next shift and sign the log book']);
      rounds.forEach((t, ri) => {
        if (ri % filled.length !== gi) return;
        busy.push([t, t + roundMin, 'patrol', `Patrol round ${ri + 1}${input.checkpoints ? ` (${input.checkpoints} checkpoints, in a different order from the last round)` : ''}${filled.length === 1 ? ': lock the post or call the officer if visitors are waiting' : ''}`]);
      });
      if (T?.dailyReportBy && gi === 0 && hm(s.start) === T.shifts[0]?.start) {
        // The day's first shift writes up the daily report for the premise administrator (due next morning).
        const need = R.logMin * 2;
        let at = len - R.handoverMin - need;
        while (at > 0 && busy.some(([a, b]) => at < b && at + need > a)) at -= 5;
        if (at > 0) busy.push([at, at + need, 'log', `Daily report for the premise administrator (due by ${T.dailyReportBy} tomorrow)`]);
      }
      for (const [mi, m] of meals.entries()) {
        // Staggered: each guard on the post eats at a different time so the post is never empty.
        let at = m + gi * R.mealMin;
        while (busy.some(([a, b]) => at < b && at + R.mealMin > a)) at += 5;
        if (at + R.mealMin <= len - R.handoverMin) busy.push([at, at + R.mealMin, 'meal', filled.length > 1 ? `Meal break ${mi + 1} (in turns)` : `Meal break ${mi + 1} (at the post: no relief)`]);
      }
      for (let t = R.logEveryMin; t < len - R.handoverMin; t += R.logEveryMin) {
        let at = t;
        while (busy.some(([a, b]) => at < b && at + R.logMin > a)) at += 5;
        if (at + R.logMin <= len - R.handoverMin) busy.push([at, at + R.logMin, 'log', 'Log book: write the situation and visitors so far']);
      }
      busy.sort((a, b) => a[0] - b[0]);
      // Fill the gaps with post duty.
      let cur = 0;
      const out: [number, number, DutyKind, string][] = [];
      for (const b of busy) {
        if (b[0] > cur) out.push([cur, b[0], 'post', 'At the post: gate, visitors, vehicles and CCTV']);
        out.push(b);
        cur = Math.max(cur, b[1]);
      }
      for (const [a, b, kind, title] of out) add(s, who, kind, title, addMinutes(s.start, a), b - a);
    });
  }
  if (input.site.armed) warnings.push('Armed site: firearm issue and return at the vault are part of each handover.');
  return { tasks, warnings };
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * A patrolling officer's day: visits to their sites, the ones with open cases and high risk first, then the ones not
 * visited for longest; travel time between sites from the distance; lunch. Sites that do not fit wait for another day.
 */
/** A patrolling officer's working hours for one day (HH:MM), set by the OM. */
export interface OfficerHours {
  start: string;
  end: string;
  mealMin: number;
}

export function checkOfficerHours(h: unknown): OfficerHours | null {
  if (h == null) return null;
  const v = h as Record<string, unknown>;
  const hm = (x: unknown) => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  if (!hm(v.start) || !hm(v.end) || v.start === v.end) throw new BadRequest('Officer hours: give start and end as HH:MM.');
  const meal = Number(v.mealMin ?? 60);
  if (!Number.isInteger(meal) || meal < 0 || meal > 120) throw new BadRequest('Officer hours: meal break is 0 to 120 minutes.');
  const len = ((Number((v.end as string).slice(0, 2)) * 60 + Number((v.end as string).slice(3))) - (Number((v.start as string).slice(0, 2)) * 60 + Number((v.start as string).slice(3))) + 1440) % 1440;
  if (len > 14 * 60) throw new BadRequest('Officer hours: at most 14 hours in a day.');
  return { start: v.start as string, end: v.end as string, mealMin: meal };
}

export function planRoute(input: {
  officer: { id: Id; name: string };
  date: IsoDate;
  sites: Site[];
  openCases: Map<Id, number>;
  lastVisit: Map<Id, IsoDate>;
  /** Sites whose contract says the officer visits at least every N days (KPM: weekly). */
  visitEvery?: Map<Id, number>;
  /** The officer's hours for this day, set by the OM (Fauzan, 4 Nov 2026: flexible, day or night); end before start runs past midnight. */
  hours?: OfficerHours | null;
}): { tasks: DutyTask[]; warnings: string[] } {
  const R = DUTY_RULES;
  const D = R.officerDay;
  const toM = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const at = (min: number) => {
    const day = Math.floor(min / 1440);
    const m = min % 1440;
    return `${day ? addDays(input.date, day) : input.date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00+08:00`;
  };
  const H = input.hours ?? null;
  const prio = (s: Site) => (input.openCases.get(s.id) ?? 0) * 100 + ({ high: 30, medium: 20, low: 10 }[s.risk]) + Math.min(60, input.lastVisit.has(s.id) ? Math.round((Date.parse(input.date) - Date.parse(input.lastVisit.get(s.id)!)) / 86_400_000) : 60);
  // A site whose contract visit is due today or overdue comes first.
  const due = (s: Site) => {
    const n = input.visitEvery?.get(s.id);
    if (!n) return false;
    const last = input.lastVisit.get(s.id);
    return !last || Math.round((Date.parse(input.date) - Date.parse(last)) / 86_400_000) >= n;
  };
  const want = [...input.sites].sort((a, b) => Number(due(b)) - Number(due(a)) || prio(b) - prio(a) || a.id.localeCompare(b.id));
  const tasks: DutyTask[] = [];
  const warnings: string[] = [];
  let t = toM(H?.start ?? D.start);
  const end = H ? toM(H.end) + (toM(H.end) <= toM(H.start) ? 1440 : 0) : toM(D.end);
  // Default day: lunch at 1pm. OM-set hours: the meal break about half way through.
  const lunchAt = H ? t + Math.floor((end - t) / 2 / 5) * 5 : toM(D.lunch);
  const mealMin = H ? H.mealMin : D.lunchMin;
  let lunched = false;
  let here: Site | null = null;
  let seq = 0;
  const left = [...want];
  const push = (kind: DutyKind, title: string, s: Site | null, min: number) => {
    tasks.push({ id: `rt-${input.officer.id}-${input.date.replace(/-/g, '')}-${++seq}`, who: input.officer.id, whoName: input.officer.name, postId: null, siteId: s?.id ?? null, kind, title, start: at(t), end: at(t + min), minutes: min });
    t += min;
  };
  while (left.length) {
    // The most urgent first; after that the nearest of the next most urgent few, to keep driving short.
    const from: Site | null = here;
    const pool = from ? left.slice(0, Math.min(3, left.length)) : left.slice(0, 1);
    const next: Site = from ? pool.sort((a, b) => km(from, a) - km(from, b))[0] : pool[0];
    const drive = here ? Math.max(5, Math.ceil(((km(here, next) / R.travelKmh) * 60) / 5) * 5) : 0;
    const visit = R.visitMin[next.risk];
    if (!lunched && t + drive + visit > lunchAt) {
      if (mealMin > 0) push('lunch', H ? 'Meal break' : 'Lunch', null, mealMin);
      lunched = true;
      continue;
    }
    if (t + drive + visit > end) break;
    if (drive) push('travel', `Drive to ${next.name} (about ${Math.round(km(here!, next))} km)`, next, drive);
    const cases = input.openCases.get(next.id) ?? 0;
    push('visit', `Visit ${next.name}: guards at post, uniform, log book${cases ? `, ${cases} open case${cases === 1 ? '' : 's'}` : ''}${next.armed ? ', armoury register' : ''}`, next, visit);
    here = next;
    left.splice(left.indexOf(next), 1);
  }
  if (left.length) warnings.push(`${left.length} site${left.length === 1 ? '' : 's'} not visited today (next days): ${left.map((s) => s.name).join(', ')}.`);
  const late = left.filter(due);
  if (late.length) warnings.push(`Contract visit due and not fitted today: ${late.map((s) => `${s.name} (every ${input.visitEvery!.get(s.id)} days)`).join(', ')}. Give the officer more hours or move a visit.`);
  return { tasks, warnings };
}

export class SecurityPlanService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private cleaning: CleaningService,
  ) {}

  private today(): IsoDate {
    return dateOf(this.clock());
  }

  private async postInput(siteId: Id, date: IsoDate, site: Site) {
    const shifts = (await this.store.list('shifts', { siteId })).filter((s) => s.date === date);
    const posts = (await this.store.list('posts', { siteId })).map((p) => ({ id: p.id, name: p.name, guardsPerShift: p.guardsPerShift }));
    const checkpoints = (await this.store.list('checkpoints', { siteId })).length;
    const all = await this.store.list('people', { companyId: site.companyId });
    const people = new Map(all.map((p) => [p.id, p.name]));
    const onRoster = new Set(shifts.map((s) => s.personId).filter(Boolean));
    const guards = all.filter((p) => onRoster.has(p.id));
    const credentials = guards.length ? (await this.store.list('credentials', { companyId: site.companyId })).filter((c) => onRoster.has(c.personId)) : [];
    const terms = (await this.store.get('guardTerms', `gterms-${siteId}`)) ?? null;
    const basis = shifts.map((s) => `${s.id}:${s.personId ?? '-'}`).sort().join(',') + (terms ? `|terms v${terms.version}` : '');
    return { shifts, posts, checkpoints, names: people, basis, terms, guards, credentials };
  }

  /** The site's guard duties for a date: the published plan if any (and whether the roster changed since), else a preview. */
  async posts(user: User, siteId: Id, date: IsoDate) {
    const site = await this.store.get('sites', siteId);
    if (!site) throw new NotFound('Site');
    const access = await this.cleaning.access(user, site);
    if (!access) throw new AccessDenied('view', site.companyId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('Choose a date.');
    const inp = await this.postInput(siteId, date, site);
    const saved = await this.store.get('dutyPlans', `duty-${siteId}-${date}`);
    const preview = planPosts({ site, date, ...inp });
    return {
      site: { id: site.id, name: site.name, client: site.client, armed: site.armed, patrolEvery: site.patrolIntervalMin ?? RULES.patrolGapMin.value, checkpoints: inp.checkpoints },
      access,
      date,
      saved: saved ?? null,
      outOfDate: !!saved && saved.basis !== inp.basis,
      preview,
      terms: inp.terms,
      cover: inp.terms ? guardCover(inp.terms, inp.shifts, siteId, date) : null,
      ruleClashes: guardRuleClashes(inp.terms?.guardRules),
      deductionRules: GUARD_DEDUCTION_RULES,
      returnSpec: SECURITY_MONTHLY_RETURN,
    };
  }

  /**
   * The OM covering the site enters the contract terms (Fauzan, 4 Nov 2026): guards per shift, rate per guard-hour, guard
   * tour points, officer visits and the daily report. A later save needs the version seen.
   */
  async saveTerms(user: User, siteId: Id, input: unknown, expectedVersion: number | null) {
    const site = await this.store.get('sites', siteId);
    if (!site) throw new NotFound('Site');
    if ((await this.cleaning.access(user, site)) !== 'manage') throw new AccessDenied('roster.publish', site.companyId);
    const t = checkGuardTerms(input);
    const now = fromMs(toMs(this.clock()));
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const id = `gterms-${siteId}`;
      const cur = await tx.get('guardTerms', id);
      if ((cur?.version ?? null) !== expectedVersion) throw new ReviewConflict('Someone changed these terms. Load them again.');
      const row: GuardTerms = { id, companyId: site.companyId, siteId, ...t, version: (cur?.version ?? 0) + 1, updatedBy: user.name, updatedAt: now };
      if (cur) await tx.update('guardTerms', id, row);
      else await tx.insert('guardTerms', row);
      await tx.audit({
        at: now,
        actor: user.name,
        companyId: site.companyId,
        action: 'duty.terms.save',
        entity: 'guard_terms',
        entityId: id,
        summary: `Contract terms for ${site.name}: ${t.shifts.map((x) => `${x.start}-${x.end} x${x.guards}`).join(', ')}${t.ratePerGuardHour != null ? `, RM${t.ratePerGuardHour.toFixed(2)} per guard-hour` : ', no rate'}${t.contractRef ? ` (${t.contractRef})` : ''}`,
      });
      return row;
    });
  }

  async publishPosts(user: User, siteId: Id, date: IsoDate) {
    const site = await this.store.get('sites', siteId);
    if (!site) throw new NotFound('Site');
    if ((await this.cleaning.access(user, site)) !== 'manage') throw new AccessDenied('roster.publish', site.companyId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < this.today() || date > addDays(this.today(), 31)) throw new BadRequest('Publish today or up to 31 days ahead.');
    const now = fromMs(toMs(this.clock()));
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const inp = await this.postInput(siteId, date, site);
      if (!inp.shifts.length) throw new BadRequest('No shifts on the roster for this day: plan the roster first.');
      const out = planPosts({ site, date, ...inp });
      const id = `duty-${siteId}-${date}`;
      const cur = await tx.get('dutyPlans', id);
      const row: DutyPlan = { id, companyId: site.companyId, kind: 'post', siteId, officerId: null, date, status: 'published', tasks: out.tasks, warnings: out.warnings, basis: inp.basis, publishedAt: now, publishedBy: user.name };
      if (cur) await tx.update('dutyPlans', id, row);
      else await tx.insert('dutyPlans', row);
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: cur ? 'duty.posts.republish' : 'duty.posts.publish', entity: 'duty_plan', entityId: id, summary: `Guard duty plan for ${site.name} on ${date}: ${out.tasks.filter((t) => t.kind === 'patrol').length} rounds, ${inp.shifts.length} shifts` });
      return row;
    });
  }

  /** Officers whose sites this user covers, for the route planner. */
  async officers(user: User) {
    const all = (await this.store.list('users', { role: 'supervisor' })).filter((u) => u.opsTier === 'patrol' && u.siteIds.length);
    const out = [];
    for (const o of all) {
      const sites = (await Promise.all(o.siteIds.map((id) => this.store.get('sites', id)))).filter((s): s is Site => !!s);
      let access: 'manage' | 'view' | null = null;
      for (const s of sites) {
        const a = await this.cleaning.access(user, s);
        if (a === 'manage') { access = 'manage'; break; }
        if (a === 'view') access = 'view';
      }
      if (access) out.push({ id: o.id, name: o.name, title: o.title, sites: sites.length, access });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async routeInput(user: User, officerId: Id, date: IsoDate) {
    const o = await this.store.get('users', officerId);
    if (!o || o.opsTier !== 'patrol') throw new NotFound('Patrolling officer');
    const sites = (await Promise.all(o.siteIds.map((id) => this.store.get('sites', id)))).filter((s): s is Site => !!s);
    let access: 'manage' | 'view' | null = null;
    const seen: Site[] = [];
    for (const s of sites) {
      const a = await this.cleaning.access(user, s);
      if (!a) continue;
      seen.push(s);
      if (a === 'manage') access = 'manage';
      else access ??= 'view';
    }
    if (!access) throw new AccessDenied('view', o.homeCompanyId ?? '(officer)');
    const companies = [...new Set(sites.map((s) => s.companyId))];
    const cases = (await this.store.list('cases', { companyId: companies })).filter((c) => c.siteId && (c.status === 'open' || c.status === 'acknowledged' || c.status === 'escalated'));
    const openCases = new Map<Id, number>();
    for (const c of cases) openCases.set(c.siteId!, (openCases.get(c.siteId!) ?? 0) + 1);
    const visits = (await this.store.list('siteVisits', { companyId: companies })).filter((v) => v.userId === o.id && dateOf(v.startedAt) < date);
    const lastVisit = new Map<Id, IsoDate>();
    for (const v of visits) {
      const d = dateOf(v.startedAt);
      if ((lastVisit.get(v.siteId) ?? '') < d) lastVisit.set(v.siteId, d);
    }
    const visitEvery = new Map<Id, number>();
    for (const s of sites) {
      const t = await this.store.get('guardTerms', `gterms-${s.id}`);
      if (t?.officerVisitDays) visitEvery.set(s.id, t.officerVisitDays);
    }
    // The planner uses every site of the officer; the screen shows names only of the sites the viewer may see.
    return { o, sites, seen, access, openCases, lastVisit, visitEvery };
  }

  /** The officer's route for a date: the published one, and a preview at the hours given (else the published or default hours). */
  async route(user: User, officerId: Id, date: IsoDate, hours?: unknown) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('Choose a date.');
    const r = await this.routeInput(user, officerId, date);
    const saved = await this.store.get('dutyPlans', `route-${officerId}-${date}`);
    const h = hours != null ? checkOfficerHours(hours) : (saved?.hours ?? null);
    const out = planRoute({ officer: { id: r.o.id, name: r.o.name }, date, sites: r.sites, openCases: r.openCases, lastVisit: r.lastVisit, visitEvery: r.visitEvery, hours: h });
    const seenIds = new Set(r.seen.map((s) => s.id));
    const hide = (t: DutyTask): DutyTask => (t.siteId && !seenIds.has(t.siteId) ? { ...t, title: t.kind === 'visit' ? 'Visit (another company’s site)' : 'Drive (another company’s site)' } : t);
    return {
      hours: h ?? { start: DUTY_RULES.officerDay.start, end: DUTY_RULES.officerDay.end, mealMin: DUTY_RULES.officerDay.lunchMin },
      officer: { id: r.o.id, name: r.o.name, title: r.o.title, sites: r.sites.length },
      access: r.access,
      date,
      preview: { tasks: out.tasks.map(hide), warnings: out.warnings },
      saved: saved ? { ...saved, tasks: saved.tasks.map(hide) } : null,
      returnSpec: SECURITY_MONTHLY_RETURN,
    };
  }

  async publishRoute(user: User, officerId: Id, date: IsoDate, expectPublishedAt: IsoDateTime | null, hours?: unknown) {
    const h = checkOfficerHours(hours);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < this.today() || date > addDays(this.today(), 31)) throw new BadRequest('Publish today or up to 31 days ahead.');
    const r = await this.routeInput(user, officerId, date);
    if (r.access !== 'manage') throw new AccessDenied('roster.publish', r.o.homeCompanyId ?? '(officer)');
    const now = fromMs(toMs(this.clock()));
    const out = planRoute({ officer: { id: r.o.id, name: r.o.name }, date, sites: r.sites, openCases: r.openCases, lastVisit: r.lastVisit, visitEvery: r.visitEvery, hours: h });
    const companyId = r.o.homeCompanyId ?? r.sites[0]?.companyId;
    if (!companyId) throw new BadRequest('This officer has no sites.');
    return this.store.transaction(async (tx) => {
      const id = `route-${officerId}-${date}`;
      const cur = await tx.get('dutyPlans', id);
      if ((cur?.publishedAt ?? null) !== expectPublishedAt) throw new ReviewConflict('Someone published this route already. Load it again.');
      const row: DutyPlan = { id, companyId, kind: 'route', siteId: null, officerId, date, status: 'published', tasks: out.tasks, warnings: out.warnings, basis: r.sites.map((s) => s.id).join(','), publishedAt: now, publishedBy: user.name, hours: h };
      if (cur) await tx.update('dutyPlans', id, row);
      else await tx.insert('dutyPlans', row);
      await tx.audit({ at: now, actor: user.name, companyId, action: 'duty.route.publish', entity: 'duty_plan', entityId: id, summary: `Route for ${r.o.name} on ${date}: ${out.tasks.filter((t) => t.kind === 'visit').length} visits${h ? `, hours ${h.start}-${h.end}` : ""}` });
      return row;
    });
  }
}