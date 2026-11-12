// P100 C12 + J3 (Fauzan, 11 Nov 2026: "Staff overtime inside the staff payroll run, with an on/off switch HR controls; CMS
// overtime included"; C12: "Carry the overtime hours from the CMS roster into the monthly staff payroll, using the staff
// overtime rules (HR-OT) and keeping the usual approvals and reasons").
//
// Each overtime line is one day's hours for one office staff member: claimed by the staff member, or brought in by HR from
// a completed CMS control-room shift (clock-in to clock-out past the normal day of HR-OT, 8 hours). HR approves or refuses
// each with a reason; nobody approves their own. An approved line is paid once, in the first staff payroll prepared after
// it, only while HR's overtime switch is on and the person is named for overtime; an unapproved line is never paid. Kept
// in prima.staff_ot_lines (db/modules/staff-ot-v1.sql), behind the company wall and readable only by the person and HR.
import type { CmsShift, Id, IsoDate, IsoDateTime, StaffOvertimeSetting } from './types';
import { toMs } from './time';

export type StaffOtKind = 'normal' | 'restDay' | 'publicHoliday';

export interface StaffOtLine {
  id: Id;
  /** The employer (a company, or 'pwvsb' for central staff). */
  companyId: Id;
  personId: Id;
  userId: Id | null;
  name: string;
  date: IsoDate;
  hours: number;
  kind: StaffOtKind;
  source: 'claim' | 'cms';
  /** The CMS seat it came from (one line per seat, so it is counted once). */
  cmsShiftId: Id | null;
  reason: string;
  status: 'pending' | 'approved' | 'refused';
  raised: { by: string; byId: Id; at: IsoDateTime };
  decided: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hours past the normal day on one completed CMS seat (clock-in to clock-out, inside the seat). */
export function cmsOvertimeHours(s: Pick<CmsShift, 'start' | 'end' | 'clockIn' | 'clockOut'>, normalHours: number): number {
  if (!s.clockIn || !s.clockOut) return 0;
  const from = Math.max(toMs(s.clockIn), toMs(s.start));
  const to = Math.min(toMs(s.clockOut), toMs(s.end));
  const worked = Math.max(0, (to - from) / 3_600_000);
  return r2(Math.max(0, worked - normalHours));
}

/** What a set of approved lines pays: hourly rate = basic / 26 / 8 (HR-OT), times each line's rate for its kind. */
export function staffOtPay(basic: number, lines: Pick<StaffOtLine, 'hours' | 'kind'>[], s: Pick<StaffOvertimeSetting, 'normal' | 'restDay' | 'publicHoliday'>, daysDivisor: number, hoursPerDay: number) {
  const hourly = basic / daysDivisor / hoursPerDay;
  const rate = (k: StaffOtKind) => (k === 'restDay' ? s.restDay : k === 'publicHoliday' ? s.publicHoliday : s.normal);
  const hours = r2(lines.reduce((n, l) => n + l.hours, 0));
  const amount = r2(lines.reduce((n, l) => n + l.hours * hourly * rate(l.kind), 0));
  return { hourly: r2(hourly), hours, amount };
}
