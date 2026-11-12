// P100 C3 (Fauzan, 11 Nov 2026, item C3: "CHANGE from 12 hours to 1 working day per level"): a guard's or officer's leave
// request that nobody approves or rejects moves up one level (OM, Regional OM, head of operations, COO, CEO) after one
// working day. Saturdays, Sundays and public holidays do not count (rule LEAVE-ESCALATE). Time is counted in Malaysia time.
import type { IsoDate, IsoDateTime } from './types';
import { fromMs, toMs } from './time';

const DAY_MS = 86_400_000;
const MYT_MS = 8 * 3_600_000;

/** The Malaysia calendar day a moment falls on. */
const mytDay = (ms: number): IsoDate => new Date(ms + MYT_MS).toISOString().slice(0, 10);
/** The start (00:00 Malaysia time) of the day a moment falls on, as an instant. */
const dayStart = (ms: number): number => Math.floor((ms + MYT_MS) / DAY_MS) * DAY_MS - MYT_MS;

/** A working day: Monday to Friday, not a public holiday. */
export function isLeaveWorkingDay(day: IsoDate, holidays: ReadonlySet<IsoDate>): boolean {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6 && !holidays.has(day);
}

/** Working time between two moments: only the parts that fall on working days count. */
export function workingMsBetween(from: IsoDateTime, to: IsoDateTime, holidays: ReadonlySet<IsoDate>): number {
  const a = toMs(from);
  const b = toMs(to);
  if (b <= a) return 0;
  let total = 0;
  for (let start = dayStart(a); start < b && start < a + 400 * DAY_MS; start += DAY_MS) {
    if (!isLeaveWorkingDay(mytDay(start), holidays)) continue;
    total += Math.max(0, Math.min(b, start + DAY_MS) - Math.max(a, start));
  }
  return total;
}

/** The moment working time since `from` reaches `ms`. */
export function addWorkingMs(from: IsoDateTime, ms: number, holidays: ReadonlySet<IsoDate>): IsoDateTime {
  const a = toMs(from);
  let left = ms;
  for (let start = dayStart(a); start < a + 400 * DAY_MS; start += DAY_MS) {
    if (!isLeaveWorkingDay(mytDay(start), holidays)) continue;
    const begin = Math.max(a, start);
    const room = start + DAY_MS - begin;
    if (room >= left) return fromMs(begin + left);
    left -= room;
  }
  return fromMs(a + ms);
}

/** Which level a request is at after waiting, and when it moves next (null at the top). */
export function leaveEscalationStep(requestedAt: IsoDateTime, now: IsoDateTime, levels: number, workingDaysPerLevel: number, holidays: ReadonlySet<IsoDate>) {
  const per = workingDaysPerLevel * DAY_MS;
  const step = Math.min(levels - 1, Math.max(0, Math.floor(workingMsBetween(requestedAt, now, holidays) / per)));
  return { step, nextAt: step < levels - 1 ? addWorkingMs(requestedAt, (step + 1) * per, holidays) : null };
}
