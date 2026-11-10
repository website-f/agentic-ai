/**
 * P97 (Fitri, 11 Nov 2026: "the salary calc page ... fields are not organized and look chaotic"): what the salary
 * calculator screen shows, kept apart from how it looks so it can be tested on its own.
 *
 * Nothing here is a pay rule. Gross pay is core's guardSalaryCalc, exactly as before; the inputs are read the same way
 * (a day field that is not a number counts 0, a basic of 0 or less uses the formula's basic). The deduction estimate is
 * core's own statutory sums (epfShare, socsoShare, eisShare, lindungShare, otherShares, pcbEstimate, hrdLevy) on the
 * same wage bases the guard pay run uses (buildGuardPayLine): EPF leaves out overtime (and rest-day and holiday day pay
 * when the formula says so), SOCSO, EIS, LINDUNG and PCB are on gross, the HRD levy on basic and fixed allowances.
 * Statutory rates are the law as at November 2026 (DEFAULT_STATUTORY); the pay run reads the CEO's settings for the
 * month. scripts/salary-calc-model.test.cjs checks these figures against buildGuardPayLine.
 */
import {
  DEFAULT_STATUTORY,
  eisShare,
  epfShare,
  guardSalaryCalc,
  hrdLevy,
  lindungShare,
  otherShares,
  pcbEstimate,
  socsoShare,
  type Nationality,
  type PayFormulaAmounts,
  type PayLawSettings,
  type StatutorySettings,
} from '@prima/core';

export type DayKey = 'daysWorked' | 'trainingDays' | 'annualLeaveDays' | 'mcDays' | 'holidaysOff' | 'restDaysWorked' | 'publicHolidaysWorked';
export type Days = Record<DayKey, string>;
export const DAY_KEYS: DayKey[] = ['daysWorked', 'restDaysWorked', 'publicHolidaysWorked', 'trainingDays', 'annualLeaveDays', 'mcDays', 'holidaysOff'];
export const START_DAYS: Days = { daysWorked: '26', trainingDays: '0', annualLeaveDays: '0', mcDays: '0', holidaysOff: '0', restDaysWorked: '0', publicHolidaysWorked: '0' };

/** Who the deduction estimate is for: the facts the statutory shares depend on. */
export interface About {
  nationality: Nationality;
  /** 'under60' is counted as age 30, 'from60' as 60 (EPF, SOCSO and EIS change at 60). */
  ageGroup: 'under60' | 'from60';
  lindungOptOut: boolean;
}
export const START_ABOUT: About = { nationality: 'MY', ageGroup: 'under60', lindungOptOut: false };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "RM 1,234.50"; a minus sign before RM. */
export function rm(n: number): string {
  const v = r2(n);
  return `${v < 0 ? '-' : ''}RM ${Math.abs(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A typed amount: commas, spaces and an RM in front are allowed ("RM 1,850.00"). */
export function parseAmount(s: string): number {
  return Number(String(s).replace(/rm/i, '').replace(/[\s,]/g, ''));
}

/** The basic used: what was typed when above 0, else the formula's own (as before P97). */
export function basicUsed(typed: string, formulaBasic: number): number {
  const v = parseAmount(typed);
  return v > 0 ? v : formulaBasic;
}

/** A day field as counted (as before P97): a number of 0 or more, anything else 0. */
export function dayCount(s: string): number {
  return Math.max(0, Number(s) || 0);
}

/** Inline problems with what was typed; the sums still count as described above, so nothing changes silently. */
export function basicProblem(typed: string): string | null {
  if (!String(typed).trim()) return 'Enter the basic pay. Until then the formula’s basic is used.';
  const v = parseAmount(typed);
  if (!Number.isFinite(v)) return 'Enter an amount in ringgit, like 1,850.00. Until then the formula’s basic is used.';
  if (v <= 0) return 'Enter an amount above RM 0. Until then the formula’s basic is used.';
  return null;
}
export function dayProblem(s: string): string | null {
  const t = String(s).trim();
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return 'Enter a number of days. Counted as 0 until then.';
  if (v < 0) return 'Days cannot be below 0. Counted as 0.';
  if (v > 31) return 'More than 31 days in one month. Check the number.';
  if (!Number.isInteger(v)) return 'Use whole days.';
  return null;
}

export interface StatLine {
  key: string;
  label: string;
  /** How it is counted, in plain words. */
  how?: string;
  amount: number;
  /** A word shown in place of the amount (opted out, not started). */
  note?: string;
}

export function salaryCalcModel(
  formula: PayFormulaAmounts,
  typedBasic: string,
  days: Days,
  law: PayLawSettings,
  about: About = START_ABOUT,
  period: string,
  st: StatutorySettings = DEFAULT_STATUTORY,
) {
  const amounts: PayFormulaAmounts = { ...formula, basicMonthly: basicUsed(typedBasic, formula.basicMonthly) };
  const calc = guardSalaryCalc(
    amounts,
    {
      daysWorked: dayCount(days.daysWorked),
      trainingDays: dayCount(days.trainingDays),
      annualLeaveDays: dayCount(days.annualLeaveDays),
      mcDays: dayCount(days.mcDays),
      holidaysOff: dayCount(days.holidaysOff),
      restDaysWorked: dayCount(days.restDaysWorked),
      publicHolidaysWorked: dayCount(days.publicHolidaysWorked),
    },
    law,
  );

  // The wage bases, as the guard pay run sets them (guard-pay.ts buildGuardPayLine).
  const OT = new Set(['Overtime, working days', 'Overtime, rest days', 'Overtime, public holidays']);
  const DAY_PAY = new Set(['Rest day worked', 'Public holiday worked']);
  const fixedLabels = new Set(['Basic pay', 'Days not worked and not paid']);
  const sum = (f: (l: (typeof calc.lines)[number]) => boolean) => r2(calc.lines.filter(f).reduce((n, l) => n + l.amount, 0));
  const otPay = sum((l) => OT.has(l.label) && l.how !== 'Fixed allowance');
  const dayPay = sum((l) => DAY_PAY.has(l.label) && l.how !== 'Fixed allowance');
  const fixed = sum((l) => l.how === 'Fixed allowance' || fixedLabels.has(l.label));
  const gross = calc.gross;
  const epfWages = r2(gross - otPay - (amounts.epfOnRestHolidayPay === false ? dayPay : 0));
  const age = about.ageGroup === 'from60' ? 60 : 30;
  const nat = about.nationality;
  const epf = epfShare(epfWages, age, nat, st);
  const socso = socsoShare(gross, age, st);
  const eis = eisShare(gross, age, nat, st);
  const lindung = lindungShare(gross, period, nat, about.lindungOptOut, st);
  const others = otherShares(st, gross, otPay, age, nat);
  const pcb = pcbEstimate(gross, epf.ee, socso.ee + eis.ee);
  const hrd = hrdLevy(Math.max(0, fixed), nat, st);
  const eisNote = eis.ee || eis.er ? undefined : nat !== 'MY' && st.eis.malaysiansOnly ? 'Malaysians only' : age >= st.eis.maxAge ? 'None from age 60' : undefined;

  const deductions: StatLine[] = [
    { key: 'epf', label: 'EPF (employee)', how: `On ${rm(epfWages)}: overtime is not EPF wages`, amount: epf.ee },
    { key: 'socso', label: 'SOCSO (employee)', amount: socso.ee },
    { key: 'eis', label: 'EIS (employee)', amount: eis.ee, note: eisNote },
    {
      key: 'lindung',
      label: 'LINDUNG 24 Jam',
      amount: lindung.ee,
      note: lindung.status === 'opted_out' ? 'Opted out' : lindung.status === 'not_started' ? 'Not started' : undefined,
    },
    ...others.filter((o) => o.ee > 0).map((o) => ({ key: `o-${o.code}`, label: `${o.name} (employee)`, amount: o.ee })),
    { key: 'pcb', label: 'PCB (estimate)', how: 'Income tax, single with no children', amount: pcb },
  ];
  const employer: StatLine[] = [
    { key: 'epf', label: 'EPF (employer)', amount: epf.er },
    { key: 'socso', label: 'SOCSO (employer)', amount: socso.er },
    { key: 'eis', label: 'EIS (employer)', amount: eis.er, note: eisNote },
    { key: 'hrd', label: 'HRD levy', how: 'On basic pay and fixed allowances', amount: hrd, note: !hrd && nat !== 'MY' ? 'Malaysians only' : undefined },
    ...others.filter((o) => o.er > 0).map((o) => ({ key: `o-${o.code}`, label: `${o.name} (employer)`, amount: o.er })),
  ];
  const totalDeductions = r2(deductions.reduce((n, d) => n + d.amount, 0));
  const totalEmployer = r2(employer.reduce((n, d) => n + d.amount, 0));
  return {
    amounts,
    calc,
    epfWages,
    otPay,
    deductions,
    employer,
    totalDeductions,
    totalEmployer,
    net: r2(gross - totalDeductions),
    employerCost: r2(gross + totalEmployer),
  };
}
