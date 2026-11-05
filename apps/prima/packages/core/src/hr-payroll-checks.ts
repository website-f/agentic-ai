// HR Phase 3, slice 3D (Fauzan, 2 Nov 2026): minimum wage, staff overtime (off until HR sets it), statutory files.
import { RULES } from './rules';

/** The minimum monthly wage in force for a pay month (YYYY-MM) or a day. */
export function minimumWageFor(on: string): number {
  const r = RULES.minimumWage.value;
  const day = on.length === 7 ? `${on}-28` : on;
  return day >= r.from ? r.monthly : r.before;
}

/** How far a basic pay falls below the minimum wage (0 when it does not). */
export function minimumWageShort(basic: number | null | undefined, on: string): number {
  if (basic == null || basic <= 0) return 0;
  return Math.max(0, Math.round((minimumWageFor(on) - basic) * 100) / 100);
}

export interface OvertimeRates {
  normal: number;
  restDay: number;
  publicHoliday: number;
}

export type OvertimeKind = 'normal' | 'restDay' | 'publicHoliday';

/** Employment Act s.60I: hourly rate = monthly basic / 26 / 8; overtime pay = hours x hourly x the rate for the day. */
export function overtimePay(basic: number, hours: number, kind: OvertimeKind, rates: OvertimeRates) {
  const r = RULES.staffOvertime.value;
  const hourly = Math.round((basic / r.daysDivisor / r.hoursPerDay) * 100) / 100;
  const amount = Math.round(hours * hourly * rates[kind] * 100) / 100;
  return { hourly, rate: rates[kind], amount, coveredByAct: basic <= r.eaWageCap };
}

