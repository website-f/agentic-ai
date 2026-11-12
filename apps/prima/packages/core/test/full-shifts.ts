import type { Dataset } from '../src';

/**
 * P100 B1b: the synthetic seed lets a few guards clock out an hour or two early, so their pay line's hours do not match
 * and the run is held (as it should be). Tests about other pay rules first "correct the attendance", as a supervisor
 * would: each early clock-out on a locked shift is moved to the shift end. Synthetic data only.
 */
export function closeShortShifts(ds: Dataset): Dataset {
  const shifts = new Map(ds.shifts.map((s) => [s.id, s]));
  for (const a of ds.attendance) {
    const s = a.shiftId ? shifts.get(a.shiftId) : undefined;
    if (s && a.clockOut && a.locked && Date.parse(a.clockOut) < Date.parse(s.end)) a.clockOut = s.end;
  }
  return ds;
}
