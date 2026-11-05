// Weekly and monthly reports to the Director Office (Fauzan, 25 Oct 2026): which period a report covers and when it
// is due.

import { addDays } from './time';
import type { IsoDate, ReportDef } from './types';

/** Monday of the week the date falls in. */
export function mondayOf(d: IsoDate): IsoDate {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
  return addDays(d, 1 - dow);
}

/** ISO week label, e.g. '2026-W43'. */
export function isoWeek(d: IsoDate): string {
  const thursday = addDays(mondayOf(d), 3);
  const year = thursday.slice(0, 4);
  const firstThursday = addDays(mondayOf(`${year}-01-04`), 3);
  const week = Math.round((Date.parse(thursday) - Date.parse(firstThursday)) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface ReportPeriod {
  period: string;
  label: string;
  due: IsoDate;
}

/** The latest periods of a report, newest first: the one still open, then the ones already due. */
export function reportPeriods(def: ReportDef, today: IsoDate, count: number): ReportPeriod[] {
  const out: ReportPeriod[] = [];
  const dow = Math.min(Math.max(def.dueDay, 1), 7) - 1;
  const day = (ym: string) => `${ym}-${String(Math.min(Math.max(def.dueDay, 1), daysInMonth(ym))).padStart(2, '0')}`;
  if (def.frequency === 'weekly') {
    const monday = mondayOf(today);
    for (let k = 0; k < count; k++) {
      const m = addDays(monday, -7 * k);
      out.push({ period: isoWeek(m), label: `Week of ${m}`, due: addDays(m, dow) });
    }
  } else if (def.frequency === 'fortnightly') {
    // Every 2 weeks, in pairs of weeks counted from Monday 5 Jan 2026 (for example toolbox reports).
    const anchor = '2026-01-05';
    const monday = mondayOf(today);
    const weeks = Math.floor((Date.parse(monday) - Date.parse(anchor)) / (7 * 86_400_000));
    const start = addDays(anchor, 7 * (weeks - (((weeks % 2) + 2) % 2)));
    for (let k = 0; k < count; k++) {
      const m = addDays(start, -14 * k);
      out.push({ period: isoWeek(m), label: `2 weeks from ${m}`, due: addDays(m, 7 + dow) });
    }
  } else if (def.frequency === 'quarterly') {
    const y = Number(today.slice(0, 4));
    const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
    for (let k = 0; k < count; k++) {
      const t = y * 4 + q - k;
      const qy = Math.floor(t / 4);
      const qn = (t % 4) + 1;
      out.push({ period: `${qy}-Q${qn}`, label: `Quarter ${qn} ${qy}`, due: day(addMonths(`${qy}-${String(qn * 3).padStart(2, '0')}`, 1)) });
    }
  } else if (def.frequency === 'yearly' || def.frequency === 'once') {
    const on = def.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(def.dueOn) ? def.dueOn : `${today.slice(0, 4)}-12-31`;
    if (def.frequency === 'once') return [{ period: `once-${on}`, label: 'One time', due: on }];
    const y = Number(today.slice(0, 4));
    const md = on.slice(5) === '02-29' ? '02-28' : on.slice(5);
    // This year's, then earlier years'; once this year's date has passed, next year's is the open one.
    const first = `${y}-${md}` < today ? y + 1 : y;
    for (let k = 0; k < count; k++) out.push({ period: String(first - k), label: `Year ${first - k}`, due: `${first - k}-${md}` });
  } else {
    const thisMonth = today.slice(0, 7);
    for (let k = 0; k < count; k++) {
      const ym = addMonths(thisMonth, -k);
      out.push({ period: ym, label: ym, due: day(addMonths(ym, 1)) });
    }
  }
  return out;
}

/**
 * Walk through a workflow's timing step by step (Fauzan, 2 Nov 2026: show how the workflow works). Deterministic, no AI:
 * starting when the work arrives, each step's time is counted in working hours (Monday to Friday, within the working day)
 * and the time each step is due is shown. A day is one working day.
 */
export function simulateWorkflow(
  segments: { step: string; target: number; unit: 'hours' | 'days' }[],
  startLocal: string,
  workDay: { start: string; end: string } = { start: '08:30', end: '17:30' },
): { step: string; target: number; unit: 'hours' | 'days'; startsAt: string; dueAt: string }[] {
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const open = toMin(workDay.start);
  const close = toMin(workDay.end);
  const dayLen = close - open;
  // Work in local wall-clock minutes; dates via UTC arithmetic so no time zone shifts the result.
  let d = new Date(`${startLocal.slice(0, 10)}T00:00:00Z`);
  let m = toMin(startLocal.slice(11, 16) || workDay.start);
  const weekend = () => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const nextDay = () => {
    d = new Date(d.getTime() + 86_400_000);
    m = open;
  };
  const settle = () => {
    if (m < open) m = open;
    if (m >= close) nextDay();
    while (weekend()) nextDay();
  };
  const stamp = () => `${d.toISOString().slice(0, 10)}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const out: { step: string; target: number; unit: 'hours' | 'days'; startsAt: string; dueAt: string }[] = [];
  for (const s of segments) {
    settle();
    const startsAt = stamp();
    let left = Math.round(s.target * (s.unit === 'hours' ? 60 : dayLen));
    while (left > 0) {
      settle();
      const take = Math.min(left, close - m);
      m += take;
      left -= take;
      if (left > 0) nextDay();
    }
    out.push({ ...s, startsAt, dueAt: stamp() });
  }
  return out;
}
