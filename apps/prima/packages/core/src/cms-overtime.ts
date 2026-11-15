import type { CmsShift, Id, IsoDateTime } from './types';

/**
 * C12 (Fauzan, 11 Nov 2026): overtime worked on CMS command-centre seats goes into the monthly staff payroll, at the
 * staff overtime rates (HR-OT), once Arms Control has approved the month's hours with a reason. Hours worked on a seat
 * are from clock-in to clock-out (or the shift end), inside the shift; overtime is what is past the normal 8 hours and a
 * 1-hour unpaid break on that seat. Unapproved hours never reach the payslip.
 */
export const CMS_OT_NORMAL_HOURS = 8;
export const CMS_OT_BREAK_HOURS = 1;
export const CMS_OT_TYPE_ID = 'cms-ot';

export interface CmsOvertimeApproval {
  period: string;
  staffId: Id;
  hours: number;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

const ms = (t: string) => Date.parse(t);

export function cmsOvertimeHours(shifts: CmsShift[], staffId: Id, period: string): { hours: number; seats: number } {
  let hours = 0;
  let seats = 0;
  for (const s of shifts) {
    if (s.cancelled || s.staffId !== staffId || !s.clockIn || s.date.slice(0, 7) !== period) continue;
    const from = Math.max(ms(s.clockIn), ms(s.start));
    const to = Math.min(ms(s.clockOut ?? s.end), ms(s.end));
    const worked = Math.max(0, to - from) / 3_600_000;
    const ot = Math.max(0, worked - CMS_OT_NORMAL_HOURS - CMS_OT_BREAK_HOURS);
    if (ot > 0) {
      hours += ot;
      seats += 1;
    }
  }
  return { hours: Math.round(hours * 100) / 100, seats };
}

/** RM for approved CMS overtime hours: monthly basic / 26 / 8 (EA s.60I) times the HR-OT normal-day rate. */
export function cmsOvertimePay(basicMonthly: number, hours: number, rate: number, divisor = 26, hoursPerDay = 8): number {
  return Math.round(((basicMonthly / divisor / hoursPerDay) * rate * hours) * 100) / 100;
}
