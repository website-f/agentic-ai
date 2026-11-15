import { DEFAULT_PAY_LAW } from "./pay-formulas";
import { guardOtHoursPerDay } from "./pay-formulas";
import type { PayFormulaAmounts } from "./pay-formulas";
import type { PayLawSettings } from "./pay-formulas";


export interface SalaryCalcInput {
  /** Normal working days actually worked (each with the formula's daily overtime). */
  daysWorked: number;
  /** Training the company sends the guard to: paid as a normal day, no overtime. */
  trainingDays?: number;
  annualLeaveDays?: number;
  /** Sick leave with a doctor's certificate, paid at basic (EA s.60F). */
  mcDays?: number;
  /** Public holidays in the month the guard did not work: paid inside basic (EA s.60D). */
  holidaysOff?: number;
  restDaysWorked?: number;
  publicHolidaysWorked?: number;
}

export interface SalaryCalcLine {
  label: string;
  how: string;
  amount: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const rm = (n: number) => `RM${r2(n).toFixed(2)}`;
const num = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function guardSalaryCalc(a: PayFormulaAmounts, input: SalaryCalcInput, law: PayLawSettings = DEFAULT_PAY_LAW) {
  const full = a.fullMonthDays ?? 26;
  const daily = a.basicMonthly / law.ordinaryRateDivisor;
  const hourly = daily / a.normalHoursPerDay;
  const perDay = guardOtHoursPerDay(a);
  const worked = num(input.daysWorked);
  const leave = num(input.trainingDays) + num(input.annualLeaveDays) + num(input.mcDays);
  const holidaysOff = num(input.holidaysOff);
  const rest = num(input.restDaysWorked);
  const ph = num(input.publicHolidaysWorked);
  // A worked holiday already belongs to the basic-paid month, just like a holiday off.
  // Rest-day work is additional and does not fill a missing ordinary working day.
  const paidHolidays = a.holidaysArePaidDays === false ? 0 : holidaysOff + ph;
  const paidDays = worked + leave + paidHolidays;
  const short = a.deductShortDays === false ? 0 : Math.max(0, full - paidDays);
  const lines: SalaryCalcLine[] = [];
  lines.push({ label: 'Basic pay', how: `Full month of ${full} working days, including paid leave, MC, training and paid public holidays`, amount: r2(a.basicMonthly) });
  if (short > 0) lines.push({ label: 'Days not worked and not paid', how: `${short} day(s) x daily rate ${rm(daily)}`, amount: -r2(Math.min(a.basicMonthly, short * daily)) });
  if (worked > 0 && perDay > 0)
    lines.push({ label: 'Overtime, working days', how: `${worked} day(s) x ${perDay} h x ${rm(hourly)} x ${a.otNormalRate}`, amount: r2(worked * perDay * hourly * a.otNormalRate) });
  if (rest > 0) {
    lines.push({ label: 'Rest day worked', how: `${rest} day(s) x ${a.restDayDays} x daily rate ${rm(daily)}`, amount: r2(rest * a.restDayDays * daily) });
    if (perDay > 0) lines.push({ label: 'Overtime, rest days', how: `${rest} day(s) x ${perDay} h x ${rm(hourly)} x ${a.otRestDayRate}`, amount: r2(rest * perDay * hourly * a.otRestDayRate) });
  }
  if (ph > 0) {
    lines.push({ label: 'Public holiday worked', how: `${ph} day(s) x ${a.publicHolidayDays} x daily rate ${rm(daily)}, on top of basic`, amount: r2(ph * a.publicHolidayDays * daily) });
    if (perDay > 0)
      lines.push({ label: 'Overtime, public holidays', how: `${ph} day(s) x ${perDay} h x ${rm(hourly)} x ${a.otPublicHolidayRate}`, amount: r2(ph * perDay * hourly * a.otPublicHolidayRate) });
  }
  for (const x of a.fixedAllowances ?? []) lines.push({ label: x.label, how: 'Fixed allowance', amount: r2(x.amount) });
  const gross = r2(lines.reduce((s, l) => s + l.amount, 0));
  const notes: string[] = [];
  if (paidDays > full) notes.push(`Working days, leave, MC, training and paid public holidays add up to ${paidDays}, more than the ${full}-day month. Extra days worked are rest days: enter them as rest days worked.`);
  const totalDays = worked + leave + holidaysOff + rest + ph;
  return {
    divisor: law.ordinaryRateDivisor,
    dailyRate: r2(daily),
    hourlyRate: r2(hourly),
    otHoursPerDay: perDay,
    fullMonthDays: full,
    paidDays: Math.min(paidDays, full),
    shortDays: short,
    otHours: r2(perDay * (worked + rest + ph)),
    /** Hours on duty in the month (normal + overtime) for the man-hours check; paid days off count no hours. */
    dutyHours: r2((worked + rest + ph) * (a.normalHoursPerDay + perDay)),
    totalDays,
    lines,
    gross,
    notes,
  };
}
