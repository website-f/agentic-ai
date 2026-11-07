/**
 * Site man-hours check (Fauzan, 6 Nov 2026): "The most important we monitor guard total hours when we do salary. A site
 * that need 2 guard per shift of 12 hours a days. For a 30 days month. Total man power need is 4 people. Total man hours
 * cannot exceed 1440 hours. Flag any total hours that be more. Od or ogm need to give approval if it will be more than
 * supposedly number of total hours. Usually happen when some guard training, anual leave, or on job trainig."
 *
 * Allowed hours for a site and month = for every post, guards per shift x hours the post is covered a day x days in the
 * month. Hours over that need the Operations Director (private site) or the OGM (government site) to approve, with a
 * reason. Pure functions only; the service reads posts, shifts and attendance and keeps the approvals.
 */
import type { Attendance, Id, IsoDateTime, Post, Shift, ShiftStructure, Site } from './types';
import { toMs } from './time';

/** Shifts a day and hours covered a day for each shift structure (the same times the roster uses). */
export const STRUCTURE_COVER: Record<ShiftStructure, { shifts: number; hoursPerDay: number; label: string }> = {
  A: { shifts: 2, hoursPerDay: 24, label: '2 x 12 h, round the clock' },
  B: { shifts: 3, hoursPerDay: 24, label: '3 x 8 h, round the clock' },
  C: { shifts: 1, hoursPerDay: 12, label: 'Day 12 h' },
  D: { shifts: 1, hoursPerDay: 12, label: 'Night 12 h' },
  E: { shifts: 1, hoursPerDay: 9, label: 'Office hours 9 h' },
};

/** Why a site needs more hours than its posts allow. Fauzan named the first three. */
export type SiteHoursCause = 'training' | 'annual_leave' | 'on_job_training' | 'client_extra' | 'other';
export const SITE_HOURS_CAUSE_LABEL: Record<SiteHoursCause, string> = {
  training: 'Guard on training (relief covers the post)',
  annual_leave: 'Annual leave (relief covers the post)',
  on_job_training: 'On-the-job training (new guard alongside)',
  client_extra: 'Client asked for extra guards or hours',
  other: 'Other',
};

/** An approval of hours over a site's allowed total for one month. Several add up. */
export interface SiteHoursApproval {
  id: Id;
  companyId: Id;
  siteId: Id;
  /** YYYY-MM */
  month: string;
  /** Extra hours approved on top of the allowed total. */
  extraHours: number;
  cause: SiteHoursCause;
  reason: string;
  approvedBy: string;
  approvedById: Id;
  /** 'ops_director' for a private site, 'ogm' for a government site. */
  approverTier: 'ops_director' | 'ogm';
  approvedAt: IsoDateTime;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Allowed man-hours and people needed for a site in a month, post by post. */
export function siteAllowedHours(posts: Pick<Post, 'id' | 'name' | 'shiftStructure' | 'guardsPerShift'>[], month: string) {
  const days = daysInMonth(month);
  const rows = posts.map((p) => {
    const c = STRUCTURE_COVER[p.shiftStructure];
    return {
      postId: p.id,
      name: p.name,
      structure: p.shiftStructure,
      structureLabel: c.label,
      guardsPerShift: p.guardsPerShift,
      hoursPerDay: c.hoursPerDay,
      /** People needed for the post: guards per shift x shifts a day (Fauzan: 2 per 12-hour shift = 4 people). */
      people: p.guardsPerShift * c.shifts,
      allowedHours: p.guardsPerShift * c.hoursPerDay * days,
    };
  });
  return {
    days,
    posts: rows,
    people: rows.reduce((s, r) => s + r.people, 0),
    hoursPerDay: rows.reduce((s, r) => s + r.guardsPerShift * r.hoursPerDay, 0),
    allowedHours: rows.reduce((s, r) => s + r.allowedHours, 0),
  };
}

const HOUR = 3_600_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Hours a guard is counted for on one attendance record: the clocked time inside the rostered shift (early clock-in and
 * late clock-out are not extra hours). A record with no shift (not rostered) counts its whole clocked time, since those
 * are exactly the extra hours to watch. A record still open counts up to now, no later than the shift end.
 */
export function attendanceHours(a: Pick<Attendance, 'clockIn' | 'clockOut'>, shift: Pick<Shift, 'start' | 'end'> | null, now: IsoDateTime): number {
  if (!a.clockIn) return 0;
  let from = toMs(a.clockIn);
  let to = a.clockOut ? toMs(a.clockOut) : toMs(now);
  if (shift) {
    from = Math.max(from, toMs(shift.start));
    to = Math.min(to, toMs(shift.end));
  } else if (!a.clockOut) to = Math.min(to, from + 12 * HOUR);
  return Math.max(0, (to - from) / HOUR);
}

export type SiteHoursStatus = 'within' | 'approved' | 'pace' | 'roster_over' | 'over';

/**
 * Compare a site's month with its allowed hours.
 * - over: hours worked are above the allowed total plus what was approved. Needs OD/OGM approval before salary.
 * - roster_over: the roster for the month is above it, the hours are not worked yet. Approve now or fix the roster.
 * - pace: the month is still running and the hours worked so far are above the allowance up to now, so the month is
 *   heading over.
 * - approved: above the allowance but within what OD/OGM approved.
 * - within: nothing to do.
 */
export function siteHoursCheck(input: {
  allowedHours: number;
  hoursPerDay: number;
  month: string;
  /** Now; the allowance so far runs from the 1st of the month (Malaysia time) up to this moment. */
  now: IsoDateTime;
  workedHours: number;
  rosteredHours: number;
  approvals: Pick<SiteHoursApproval, 'extraHours'>[];
}) {
  const approvedExtra = round1(input.approvals.reduce((s, a) => s + a.extraHours, 0));
  const ceiling = input.allowedHours + approvedExtra;
  const worked = round1(input.workedHours);
  const rostered = round1(input.rosteredHours);
  const [y, m] = input.month.split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, 1) - 8 * HOUR;
  const days = daysInMonth(input.month);
  const daysSoFar = Math.min(days, Math.max(0, (toMs(input.now) - startMs) / (24 * HOUR)));
  const current = daysSoFar > 0 && daysSoFar < days;
  const allowedSoFar = round1(input.hoursPerDay * daysSoFar);
  const paceOverBy = current ? round1(Math.max(0, worked - (allowedSoFar + approvedExtra))) : 0;
  const overBy = round1(Math.max(0, worked - ceiling));
  const rosterOverBy = round1(Math.max(0, rostered - ceiling));
  const aboveAllowance = worked > input.allowedHours || rostered > input.allowedHours || (current && worked > allowedSoFar);
  const status: SiteHoursStatus = overBy > 0 ? 'over' : rosterOverBy > 0 ? 'roster_over' : paceOverBy > 0 ? 'pace' : aboveAllowance ? 'approved' : 'within';
  return {
    allowedHours: input.allowedHours,
    approvedExtra,
    ceiling,
    workedHours: worked,
    rosteredHours: rostered,
    allowedSoFar,
    overBy,
    rosterOverBy,
    paceOverBy,
    /** Extra hours that still need approval: the largest of worked, rostered and so-far over what is allowed and approved. */
    needsApproval: Math.max(overBy, rosterOverBy, paceOverBy),
    status,
  };
}

/** Who approves hours over the allowance at a site (Fauzan: "Od or ogm"). Missing sector means private. */
export function siteHoursApproverTier(site: Pick<Site, 'sector'>): 'ops_director' | 'ogm' {
  return site.sector === 'government' ? 'ogm' : 'ops_director';
}

/** The month a record counts in: its shift's date, or the clock-in date (Malaysia time) when there is no shift. */
export function attendanceMonth(a: Pick<Attendance, 'clockIn'>, shift: Pick<Shift, 'date'> | null): string | null {
  if (shift) return shift.date.slice(0, 7);
  if (!a.clockIn) return null;
  return new Date(toMs(a.clockIn) + 8 * HOUR).toISOString().slice(0, 7);
}
