// Malaysia time is UTC+8 all year (no daylight saving), so timestamps are stored with a
// fixed +08:00 offset and compared as epoch milliseconds.

import type { IsoDate, IsoDateTime } from './types';

export const MYT_OFFSET_MIN = 8 * 60;
const DAY_MS = 86_400_000;

export function toMs(t: IsoDateTime): number {
  return Date.parse(t);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Format epoch ms as an ISO timestamp in Malaysia time. */
export function fromMs(ms: number): IsoDateTime {
  const d = new Date(ms + MYT_OFFSET_MIN * 60_000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`
  );
}

/** Build a Malaysia-time timestamp from a date and HH:MM. */
export function myt(date: IsoDate, hhmm: string): IsoDateTime {
  return `${date}T${hhmm}:00+08:00`;
}

export function addMinutes(t: IsoDateTime, minutes: number): IsoDateTime {
  return fromMs(toMs(t) + minutes * 60_000);
}

export function minutesBetween(a: IsoDateTime, b: IsoDateTime): number {
  return Math.round((toMs(b) - toMs(a)) / 60_000);
}

/** The Malaysia calendar date of a timestamp. */
export function dateOf(t: IsoDateTime): IsoDate {
  return fromMs(toMs(t)).slice(0, 10);
}

const addDaysMemo = new Map<string, IsoDate>();

export function addDays(d: IsoDate, days: number): IsoDate {
  // Called many thousands of times while the mock data is made; the answers are remembered (bounded).
  const key = `${d}|${days}`;
  let out = addDaysMemo.get(key);
  if (out === undefined) {
    out = new Date(Date.parse(`${d}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
    if (addDaysMemo.size > 50_000) addDaysMemo.clear();
    addDaysMemo.set(key, out);
  }
  return out;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Day of week for a calendar date, 0 = Sunday. */
export function weekday(d: IsoDate): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

/** Age in whole years on a given date. */
export function ageOn(dob: IsoDate, on: IsoDate): number {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/** Malaysian weekend for the working-day count used by P4 cases (Saturday and Sunday). */
export function addWorkingDays(d: IsoDate, n: number): IsoDate {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    const wd = weekday(cur);
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return cur;
}

/** A real calendar date in YYYY-MM-DD form: 2026-02-31 or 2026-13-01 is refused, not rolled over. */
export function isRealDate(v: unknown): v is IsoDate {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
