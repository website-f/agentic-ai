// Working from home (Fauzan, 27 Oct 2026): staff may work remotely while their manager can see they are working.
// Work is judged by what is planned and delivered (day plan, fixed check-ins, end-of-day report, manager review),
// not by watching the person: no screenshots, keystrokes, camera or following the location at home.

import { RULES } from './rules';
import { addMinutes, dateOf, myt, toMs } from './time';
import type { IsoDate, IsoDateTime, RemoteArrangement, RemoteDay, StaffClock } from './types';

/**
 * What the staff member reads and accepts before applying (PDPA 2010 s.7, notice and choice). Wording for counsel and
 * the PDPA officer to confirm before go-live.
 */
export const REMOTE_NOTICE: string[] = [
  'On a home day Prima records: your sign-in and sign-out times, your day plan, your two check-ins, your end-of-day report and your manager’s review.',
  'Your location is checked once, at the start of the day, against the place approved for you. Only the distance is kept. It is not followed for the rest of the day.',
  'Prima also counts the work you record in Prima itself (records saved, approvals, updates). Work done in other systems is covered by your plan and report.',
  'Prima never takes screenshots, records keystrokes, turns on your camera or microphone, or reads your personal files.',
  'Your manager, central HR and group leadership see this for your own company only. You see everything they see about you.',
  'It is used to plan and check work and to decide whether working from home continues. A miss is never a disciplinary finding by itself.',
  'Home day records are kept for 12 months, then deleted (proposed). You may ask the PDPA officer for a copy or a correction.',
];

/** Weekday of a date: 1 Monday to 7 Sunday. */
export function weekdayOf(date: IsoDate): number {
  const d = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Whether an approved arrangement makes this date a home day. */
export function isHomeDay(a: RemoteArrangement, date: IsoDate): boolean {
  return a.status === 'approved' && a.from <= date && (a.to === null || date <= a.to) && a.days.includes(weekdayOf(date));
}

export type RemoteStep = 'done' | 'late' | 'missed' | 'open' | 'upcoming' | 'not_needed';

export interface RemoteDayStatus {
  plan: RemoteStep;
  planDueAt: IsoDateTime | null;
  checkIns: { due: string; dueAt: IsoDateTime; closesAt: IsoDateTime; state: RemoteStep; at: IsoDateTime | null; note: string }[];
  report: RemoteStep;
  /** A missing plan, missed check-ins and a missing report. A late answer shows as late, not as a miss. */
  misses: number;
  tasks: { planned: number; done: number };
}

/**
 * Where a home day stands at a moment. Steps before sign-in, or after sign-out, are not needed; nothing is counted
 * against a day the person did not sign in.
 */
export function remoteDayStatus(day: RemoteDay | null, date: IsoDate, clock: StaffClock | null, now: IsoDateTime): RemoteDayStatus {
  const nowMs = toMs(now);
  const past = date < dateOf(now);
  const planDueAt = clock ? addMinutes(clock.in.receivedAt, RULES.remotePlanMin.value) : null;
  let plan: RemoteStep = 'not_needed';
  if (day?.plan) plan = planDueAt && toMs(day.plan.at) > toMs(planDueAt) ? 'late' : 'done';
  else if (planDueAt) plan = past || nowMs > toMs(planDueAt) ? 'missed' : 'open';
  const { times, windowMin } = RULES.remoteCheckIns.value;
  const checkIns = times.map((due) => {
    const dueAt = myt(date, due);
    const closesAt = addMinutes(dueAt, windowMin);
    const ci = day?.checkIns.find((c) => c.due === due) ?? null;
    let state: RemoteStep;
    if (ci?.at) state = toMs(ci.at) > toMs(closesAt) ? 'late' : 'done';
    else if (!clock || toMs(clock.in.receivedAt) > toMs(closesAt) || (clock.out && toMs(clock.out.receivedAt) < toMs(dueAt))) state = 'not_needed';
    else if (nowMs < toMs(dueAt)) state = 'upcoming';
    else if (nowMs <= toMs(closesAt)) state = 'open';
    else state = 'missed';
    return { due, dueAt, closesAt, state, at: ci?.at ?? null, note: ci?.note ?? '' };
  });
  let report: RemoteStep = 'not_needed';
  if (day?.report) report = 'done';
  else if (clock) report = past || clock.out ? 'missed' : 'open';
  const misses = (plan === 'missed' ? 1 : 0) + checkIns.filter((c) => c.state === 'missed').length + (report === 'missed' ? 1 : 0);
  const tasks = day?.plan?.tasks ?? [];
  return { plan, planDueAt, checkIns, report, misses, tasks: { planned: tasks.length, done: tasks.filter((t) => t.status === 'done').length } };
}
