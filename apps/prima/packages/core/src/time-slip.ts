import { RULES } from "./rules";
import { addDays } from "./time";
import { dateOf } from "./time";
import { myt } from "./time";
import { toMs } from "./time";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { StaffClock } from "./types";
import type { TimeSlip } from "./types";
import type { User } from "./types";


const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes from one HH:MM to another on the same day; null when either is not a time or the end is not later. */
export function slipMinutes(from: string, to: string): number | null {
  if (!HHMM.test(from ?? '') || !HHMM.test(to ?? '')) return null;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const n = m(to) - m(from);
  return n > 0 ? n : null;
}

/** Whether two slips on the same day overlap in time. */
export function slipsOverlap(a: Pick<TimeSlip, 'date' | 'from' | 'to'>, b: Pick<TimeSlip, 'date' | 'from' | 'to'>): boolean {
  return a.date === b.date && a.from < b.to && b.from < a.to;
}

/**
 * Clocks that may count as make-up time: only a clock the person closed by signing out. A clock still open (the
 * person has not signed out, possibly from an earlier day) is not counted until it is closed, so open time is never
 * credited. A clock closed by Prima because the person never signed out, or one where the door shows they left
 * before signing out, is not counted either: the time was not shown to be worked.
 */
function countable(c: StaffClock): boolean {
  return !!c.out && !c.flags.includes('NO_SIGN_OUT') && !c.flags.includes('LEFT_BEFORE_SIGN_OUT');
}

/**
 * Minutes worked after the end of office hours (5.30 pm) per day, from closed staff clock records. Only time on the
 * same calendar day as the clock-in counts, and never time after now.
 */
export function afterHoursByDay(clocks: StaffClock[], now: IsoDateTime): Map<IsoDate, number> {
  const end = RULES.staffHours.value.end;
  const out = new Map<IsoDate, number>();
  for (const c of clocks) {
    if (!countable(c)) continue;
    const day = dateOf(c.in.receivedAt);
    const startMs = Math.max(toMs(c.in.receivedAt), toMs(myt(day, end)));
    const stopMs = Math.min(toMs(c.out!.receivedAt), toMs(now), toMs(myt(day, '23:59')) + 60_000);
    const min = Math.floor((stopMs - startMs) / 60_000);
    if (min > 0) out.set(day, (out.get(day) ?? 0) + min);
  }
  return out;
}

export interface SlipMakeUp {
  madeUpMin: number;
  /** Minutes still to work back (0 when done). */
  leftMin: number;
  /** True once the make-up period has ended. */
  ended: boolean;
}

/**
 * Shares the after-hours minutes among the person's approved slips. Each minute is used once. Slips with the earliest
 * last day take minutes first, and only from days between the slip date and its last day.
 */
export function allocateMakeUp(slips: TimeSlip[], clocks: StaffClock[], now: IsoDateTime): Map<string, SlipMakeUp> {
  const pool = afterHoursByDay(clocks, now);
  const days = [...pool.keys()].sort();
  const today = dateOf(now);
  const out = new Map<string, SlipMakeUp>();
  const approved = slips
    .filter((s) => s.status === 'approved' && s.makeUpBy)
    .sort((a, b) => a.makeUpBy!.localeCompare(b.makeUpBy!) || a.requestedAt.localeCompare(b.requestedAt));
  for (const s of approved) {
    let need = s.minutes;
    for (const d of days) {
      if (need <= 0) break;
      if (d < s.date || d > s.makeUpBy!) continue;
      const have = pool.get(d) ?? 0;
      const take = Math.min(have, need);
      if (take > 0) {
        pool.set(d, have - take);
        need -= take;
      }
    }
    out.set(s.id, { madeUpMin: s.minutes - need, leftMin: need, ended: today > s.makeUpBy! });
  }
  return out;
}

/** Leave days for minutes not worked back: whole half days (4 hours each), rounded up. */
export function shortfallLeaveDays(shortfallMin: number): number {
  if (shortfallMin <= 0) return 0;
  const half = RULES.timeSlip.value.halfDayHours * 60;
  return Math.ceil(shortfallMin / half) * 0.5;
}

/** The last day to work the hours back. */
export function makeUpByOf(date: IsoDate): IsoDate {
  return addDays(date, RULES.timeSlip.value.makeUpDays);
}

/** Central HR: the HR administrators. The HR Director is the Chief of Staff or Deputy. */
function isCentralHr(u: User): boolean {
  return u.role === 'pwvsb_officer' && u.department === 'hr';
}
function isHrDirectorUser(u: User): boolean {
  return u.role === 'pwvsb_officer' && (u.leadership === 'cos' || u.leadership === 'deputy_cos');
}
function active(u: User, today: IsoDate): boolean {
  return !u.integration && u.role !== 'site_device' && (!u.accessClosedFrom || u.accessClosedFrom > today);
}

/** The department head of a central department, where the organisation records one. */
function isDepartmentHead(u: User, dept: NonNullable<User['department']>): boolean {
  if (u.role !== 'pwvsb_officer') return false;
  switch (dept) {
    case 'it':
      return u.department === 'it' && u.itRole === 'manager';
    case 'audit':
      return u.department === 'audit' && u.actRole === 'lead';
    case 'fwm':
      return u.department === 'fwm' && u.fwmRole === 'manager';
    case 'finance':
      return u.leadership === 'finance_director';
    case 'hr':
      return isHrDirectorUser(u);
    case 'chief_of_staff':
      return u.leadership === 'cos';
    case 'procurement':
      return u.opsTier === 'ogm';
    case 'asset':
      return u.department === 'asset' && u.assetRole === 'director';
    default:
      return false;
  }
}

export interface SlipApprovers {
  ids: string[];
  names: string[];
  /** Who approves, in words, for the staff member's screen. */
  label: string;
}

/**
 * Who approves a staff member's time slip under the current setting. Nobody approves their own slip. When the setting
 * is the head but there is no head above the staff member (a company manager, a department head, or a department with
 * no head recorded), HR approves instead.
 */
export function slipApprovers(
  applicant: User,
  companyId: string | null,
  central: boolean,
  users: User[],
  mode: 'head' | 'hr',
  today: IsoDate,
): SlipApprovers {
  const others = users.filter((u) => u.id !== applicant.id && active(u, today));
  const pack = (list: User[], label: string): SlipApprovers => ({ ids: list.map((u) => u.id), names: list.map((u) => u.name), label });
  const hr = () => {
    // HR's own slips go to the HR Director.
    const list = isCentralHr(applicant) ? others.filter(isHrDirectorUser) : others.filter(isCentralHr);
    return pack(list.length ? list : others.filter(isHrDirectorUser), isCentralHr(applicant) ? 'HR Director' : 'HR');
  };
  if (mode === 'hr') return hr();
  if (!central && companyId) {
    if (applicant.role === 'company_manager') return { ...hr(), label: `${hr().label} (no company head above you)` };
    const heads = others.filter((u) => u.role === 'company_manager' && u.companyIds.includes(companyId));
    return heads.length ? pack(heads, 'Company head') : { ...hr(), label: `${hr().label} (no company head recorded)` };
  }
  const dept = applicant.department;
  if (dept && !isDepartmentHead(applicant, dept)) {
    const heads = others.filter((u) => isDepartmentHead(u, dept));
    if (heads.length) return pack(heads, 'Department head');
  }
  const h = hr();
  return { ...h, label: `${h.label} (no department head above you)` };
}

/** Everyone in HR who is told of approved slips and leave taken for them. */
export function slipHrIds(users: User[], except: string[], today: IsoDate): string[] {
  return users.filter((u) => active(u, today) && (isCentralHr(u) || isHrDirectorUser(u)) && !except.includes(u.id)).map((u) => u.id);
}