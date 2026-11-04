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
  if (def.frequency === 'weekly') {
    const monday = mondayOf(today);
    for (let k = 0; k < count; k++) {
      const m = addDays(monday, -7 * k);
      out.push({ period: isoWeek(m), label: `Week of ${m}`, due: addDays(m, Math.min(Math.max(def.dueDay, 1), 7) - 1) });
    }
  } else {
    const thisMonth = today.slice(0, 7);
    for (let k = 0; k < count; k++) {
      const ym = addMonths(thisMonth, -k);
      const next = addMonths(ym, 1);
      out.push({ period: ym, label: ym, due: `${next}-${String(Math.min(def.dueDay, daysInMonth(next))).padStart(2, '0')}` });
    }
  }
  return out;
}
