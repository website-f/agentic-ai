import type { Id } from "./types";
import type { IsoDateTime } from "./types";


/**
 * Pay formulas set by ACT (Fauzan, 5 Nov 2026): "guard salary counting formula can be set per site or per company or
 * per region or per whole company. All be set by act director. For now we set the normal calculation formula for work
 * full month with 12 hours shift, with 2 hours rest per day, 2.5 hour, 3 hour" and "there is formula for driver who
 * overtime. Formula of everyone can be set the amount by act department."
 *
 * A formula is a named set of amounts (basic, normal hours, overtime rates, allowances). The ACT team prepares amount
 * changes; the ACT Director makes them live. The ACT Director also decides which formula is used where: the whole
 * group, a region, a company or a site. The narrowest one wins (site, then company, then region, then group).
 *
 * The Employment Act 1955 sets the floor. Prima refuses a formula that pays less than the law (minimum wage, overtime
 * rates, rest-day and public holiday pay, normal hours) and flags hours limits for ACT and the roster to look at,
 * because refusing a formula would not stop the hours being worked, only stop them being paid. Counsel or the Labour
 * Department confirm before real pay.
 */

/** staff_ot: overtime for everyone else (Fauzan, 5 Nov 2026: "Act set formula for everyone overtime"). */
export type PayFormulaKind = 'guard_shift' | 'driver_ot' | 'staff_ot';
export type PayFormulaScope = 'group' | 'region' | 'company' | 'site';
/** YYYY-MM, the first pay month a formula version or a use counts for. */
export type PayMonth = string;

export interface PayFormulaAmounts {
  /** Monthly basic pay, RM. */
  basicMonthly: number;
  /** Normal working hours a day; hours past this are overtime (EA s.60A(1): at most 8, and 45 a week). */
  normalHoursPerDay: number;
  /** Working days in a normal week (5, 5.5 or 6), for the 45-hour week. */
  workDaysPerWeek: number;
  /** Overtime on a normal working day, times the hourly rate (EA s.60A(3)(a): at least 1.5). */
  otNormalRate: number;
  /** Overtime past normal hours on a rest day (EA s.60(3)(c): at least 2). */
  otRestDayRate: number;
  /** Overtime past normal hours on a public holiday (EA s.60D(3)(b): at least 3). */
  otPublicHolidayRate: number;
  /** Days' wages for normal hours worked on a rest day, on top of the monthly pay (EA s.60(3)(a): at least 1). */
  restDayDays: number;
  /** Days' wages for normal hours worked on a public holiday, on top of the monthly pay (EA s.60D(3)(a): at least 2). */
  publicHolidayDays: number;
  /** Fixed monthly allowances paid with this formula. */
  fixedAllowances: { label: string; amount: number }[];
  // ----- Guard shift formulas -----
  /** Shift length from start to end, hours (12 for the standard shift). */
  shiftHours?: number;
  /** Rest a day inside the shift, hours (2, 2.5 or 3 in the standard formulas). */
  restHours?: number;
  /**
   * The guard is relieved from the post during the rest (a relief guard covers, or the guard may leave the post). Only
   * then is the rest unpaid. A guard who must stay at the post is working, so the rest is paid (rule PAY-REST-BREAK).
   */
  restRelieved?: boolean;
  /** Days a month counted as a full month (26 for a six-day week). */
  fullMonthDays?: number;
  // ----- Guard pay run settings, set by the ACT Director on the formula (Fauzan, 5 Nov 2026) -----
  /** A month at more than one site: the main site's formula for the whole month (default), or each day at its own site's. */
  multiSite?: 'main_site' | 'per_site';
  /** Public holidays count as paid days in the month whether worked or not (default yes, EA s.60D). */
  holidaysArePaidDays?: boolean;
  /** Days short of the full month are deducted at the daily rate (default yes). Off: only approved unpaid leave is. */
  deductShortDays?: boolean;
  /** Rest-day and holiday day pay counts as EPF wages (default yes). Overtime never does (KWSP). */
  epfOnRestHolidayPay?: boolean;
  // ----- Driver overtime formulas -----
  /** Meal allowance for each overtime day of at least mealAfterHours overtime, RM. 0 = none. */
  otMealAllowance?: number;
  mealAfterHours?: number;
  /** Outstation allowance for each night away, RM. 0 = none. */
  outstationPerNight?: number;
}

export type PayFormulaStatus = 'draft' | 'live' | 'rejected' | 'withdrawn';

export interface PayFormula {
  id: Id;
  /** Stable code shared by every version of the formula, e.g. STD-12H-R2. */
  code: string;
  version: number;
  kind: PayFormulaKind;
  name: string;
  effectiveFrom: PayMonth;
  amounts: PayFormulaAmounts;
  status: PayFormulaStatus;
  /** Why the formula or change was made. */
  reason: string;
  preparedBy: string;
  preparedById: Id;
  preparedAt: IsoDateTime;
  /** The ACT Director who made it live, or rejected it. */
  decidedBy: string | null;
  decidedById: Id | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string | null;
  /** What the law check said when it was saved: pay below the law is refused, these are the flags left. */
  lawFlags: string[];
}

/** Which formula is used where, from a month. The ACT Director sets it. */
export interface PayFormulaUse {
  id: Id;
  kind: PayFormulaKind;
  scope: PayFormulaScope;
  /** Region, company or site id; null for the whole group. */
  scopeId: Id | null;
  /** null on a region, company or site hands it back to the wider choice. */
  formulaCode: string | null;
  effectiveFrom: PayMonth;
  reason: string;
  setBy: string;
  setById: Id;
  setAt: IsoDateTime;
  /** A later choice for the same place replaces this one from its own month; the history stays. */
  endedBy: Id | null;
}

export const PAY_FORMULA_KIND_LABEL: Record<PayFormulaKind, string> = {
  guard_shift: 'Guard salary (shift)',
  driver_ot: 'Driver overtime',
  staff_ot: 'Staff overtime',
};
export const PAY_SCOPE_LABEL: Record<PayFormulaScope, string> = {
  group: 'Whole group',
  region: 'Region',
  company: 'Company',
  site: 'Site',
};
/** Driver and staff overtime formulas follow the employer, not a guard post, so they are set for the group, a region or a company. */
export const PAY_SCOPES_FOR: Record<PayFormulaKind, PayFormulaScope[]> = {
  guard_shift: ['group', 'region', 'company', 'site'],
  driver_ot: ['group', 'region', 'company'],
  staff_ot: ['group', 'region', 'company'],
};

/** EA s.60I(1A): the daily rate of a monthly-paid employee is the monthly pay divided by 26. Fixed by law. */
export const ORP_DIVISOR = 26;
/** Minimum Wages Order 2024: RM1,700 a month from 1 Feb 2025 (1 Aug 2025 for employers with fewer than 5). */
export const MIN_WAGE: { from: PayMonth; amount: number; gazetted: boolean }[] = [
  { from: '2025-02', amount: 1700, gazetted: true },
  // Budget 2027 announcement; refused only once it is gazetted, flagged until then.
  { from: '2027-06', amount: 2000, gazetted: false },
];
/** Employment (Limitation of Overtime Work) Regulations 1980: at most 104 overtime hours a month. */
export const OT_MONTH_CAP = 104;
/** EA s.60A(1): normal hours at most 8 a day and 45 a week, a spread-over of at most 10 hours, a 30-minute break after 5 hours. */
export const LAW_HOURS = { normalDay: 8, normalWeek: 45, spreadOver: 10, breakAfter: 5, breakMin: 0.5, maxDay: 12 } as const;
/** First Schedule: the overtime, rest-day and holiday pay rules of the Act bind for employees earning up to RM4,000. */
export const EA_OT_WAGE_LIMIT = 4000;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pay law settings (Fauzan, 6 Nov 2026: "Ceo can set the base salary. When new law came in. Ceo have the flexibility
 * control to set how salary is set and how the base is set base by the new law that came."). The CEO sets these from a
 * month; formulas, worked months, the salary calculator and the labour law flags read the version in force. The
 * defaults are the law as at November 2026.
 */
export interface PayLawSettings {
  /** Days the monthly basic is divided by for the daily rate (EA s.60I(1A): 26). */
  ordinaryRateDivisor: number;
  /** Minimum wage a month, and an announced next step (flagged until gazetted). */
  minimumWage: number;
  nextMinimumWage: { from: PayMonth; amount: number; gazetted: boolean } | null;
  /** Lowest overtime multipliers and extra days' wages the law allows (below them is flagged). */
  otMinNormal: number;
  otMinRestDay: number;
  otMinPublicHoliday: number;
  restDayDaysMin: number;
  publicHolidayDaysMin: number;
  /** Wages up to which the Act's overtime rules bind (First Schedule). */
  otWageLimit: number;
  /** Most overtime hours a month (drivers and staff; guards exempt). */
  otMonthCap: number;
  normalHoursDayMax: number;
  normalHoursWeekMax: number;
  workDaysWeekMax: number;
  /** What changed in the law, in the CEO's words (e.g. the gazette reference). */
  lawNote: string;
}

export interface PayLawVersion {
  id: Id;
  effectiveFrom: PayMonth;
  settings: PayLawSettings;
  reason: string;
  setBy: string;
  setById: Id;
  setAt: string;
  replacedBy: Id | null;
}

export const DEFAULT_PAY_LAW: PayLawSettings = {
  ordinaryRateDivisor: 26,
  minimumWage: 1700,
  nextMinimumWage: { from: '2027-06', amount: 2000, gazetted: false },
  otMinNormal: 1.5,
  otMinRestDay: 2,
  otMinPublicHoliday: 3,
  restDayDaysMin: 1,
  publicHolidayDaysMin: 2,
  otWageLimit: 4000,
  otMonthCap: 104,
  normalHoursDayMax: 8,
  normalHoursWeekMax: 45,
  workDaysWeekMax: 6,
  lawNote: 'Employment Act 1955 as amended 2022; Minimum Wages Order 2024 (RM1,700); RM2,000 from June 2027 announced in Budget 2027.',
};

/** The settings in force for a month: the newest version starting on or before it, else the defaults. */
export function payLawFor(versions: PayLawVersion[], month: PayMonth): PayLawSettings {
  const v = versions.filter((x) => !x.replacedBy && x.effectiveFrom <= month).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.setAt.localeCompare(a.setAt))[0];
  return v ? { ...DEFAULT_PAY_LAW, ...v.settings } : DEFAULT_PAY_LAW;
}

/** Refuse only settings that cannot be counted with. */
export function payLawSettingsProblem(x: PayLawSettings): string | null {
  const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!pos(x.ordinaryRateDivisor) || x.ordinaryRateDivisor > 31) return 'The day divisor must be more than 0 and at most 31.';
  for (const k of ['minimumWage', 'otMinNormal', 'otMinRestDay', 'otMinPublicHoliday', 'otWageLimit', 'otMonthCap', 'normalHoursDayMax', 'normalHoursWeekMax', 'workDaysWeekMax'] as const)
    if (!pos(x[k])) return `Enter ${k} as a number above 0.`;
  for (const k of ['restDayDaysMin', 'publicHolidayDaysMin'] as const) if (typeof x[k] !== 'number' || !Number.isFinite(x[k]) || x[k] < 0) return `Enter ${k} as 0 or more.`;
  if (x.nextMinimumWage && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(x.nextMinimumWage.from) || !pos(x.nextMinimumWage.amount))) return 'Enter the next minimum wage with its month (YYYY-MM) and amount.';
  return null;
}

/**
 * What the ACT Director enters is saved as chosen (Fauzan, 5 Nov 2026: "Labour law is a flag in ceo. But formula can be
 * at the amount act director chose"). Only entries that cannot be counted are refused (not a number, no normal hours, a
 * rest as long as the shift). Every labour law point is a flag, shown on the formula and to the CEO.
 * Security guards are exempt from the hours limits (Fauzan, 5 Nov 2026), so guard formulas carry no spread-over,
 * 12-hour or monthly overtime-hour flags; the rest-break rule stays.
 */
export function payFormulaLawCheck(kind: PayFormulaKind, a: PayFormulaAmounts, month: PayMonth, law: PayLawSettings = DEFAULT_PAY_LAW): { refuse: string[]; flags: string[] } {
  const refuse: string[] = [];
  const flags: string[] = [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  for (const k of ['basicMonthly', 'normalHoursPerDay', 'workDaysPerWeek', 'otNormalRate', 'otRestDayRate', 'otPublicHolidayRate', 'restDayDays', 'publicHolidayDays'] as const)
    if (!num(a[k]) || a[k] < 0) refuse.push(`Enter ${k} as a number of 0 or more.`);
  for (const x of a.fixedAllowances ?? [])
    if (!x || typeof x.label !== 'string' || !x.label.trim() || !num(x.amount) || x.amount < 0) refuse.push('Each allowance needs a name and an amount of 0 or more.');
  if (refuse.length) return { refuse, flags };
  if (a.normalHoursPerDay <= 0 || a.normalHoursPerDay > 24) refuse.push('Normal hours a day must be more than 0: the hourly rate is the daily rate divided by them.');
  if (a.workDaysPerWeek <= 0 || a.workDaysPerWeek > 7) refuse.push('Working days a week must be more than 0 and at most 7.');
  if (kind === 'guard_shift') {
    const shift = a.shiftHours ?? 0;
    const rest = a.restHours ?? 0;
    const full = a.fullMonthDays ?? 0;
    if (!num(shift) || shift <= 0 || shift > 24) refuse.push('Enter the shift length in hours.');
    if (!num(rest) || rest < 0 || rest >= shift) refuse.push('Rest hours must be 0 or more and shorter than the shift.');
    if (!num(full) || full < 1 || full > 31) refuse.push('Enter the days counted as a full month.');
  } else {
    for (const k of ['otMealAllowance', 'mealAfterHours', 'outstationPerNight'] as const)
      if (a[k] != null && (!num(a[k]) || (a[k] as number) < 0)) refuse.push(`Enter ${k} as 0 or more.`);
  }
  if (refuse.length) return { refuse, flags };

  // Labour law points: flags only.
  const next = law.nextMinimumWage;
  const floor = next && next.gazetted && next.from <= month ? next.amount : law.minimumWage;
  if (a.basicMonthly < floor) flags.push(`Basic pay RM${a.basicMonthly} is below the minimum wage of RM${floor} a month (Minimum Wages Order).`);
  if (next && !next.gazetted && next.from <= month && a.basicMonthly < next.amount)
    flags.push(`From ${next.from} the minimum wage is announced at RM${next.amount}. Raise the basic pay once it is gazetted.`);
  if (a.otNormalRate < law.otMinNormal) flags.push(`Overtime on a working day is below ${law.otMinNormal} times the hourly rate (EA s.60A(3)(a)).`);
  if (a.otRestDayRate < law.otMinRestDay) flags.push(`Overtime on a rest day is below ${law.otMinRestDay} times the hourly rate (EA s.60(3)(c)).`);
  if (a.otPublicHolidayRate < law.otMinPublicHoliday) flags.push(`Overtime on a public holiday is below ${law.otMinPublicHoliday} times the hourly rate (EA s.60D(3)(b)).`);
  if (a.restDayDays < law.restDayDaysMin) flags.push(`A rest day worked is paid less than ${law.restDayDaysMin === 1 ? 'one extra day’s' : `${law.restDayDaysMin} extra days’`} wages (EA s.60(3)(a)).`);
  if (a.publicHolidayDays < law.publicHolidayDaysMin) flags.push(`A public holiday worked is paid less than ${law.publicHolidayDaysMin === 2 ? 'two extra days’' : `${law.publicHolidayDaysMin} extra days’`} wages (EA s.60D(3)(a)).`);
  if (a.basicMonthly > law.otWageLimit)
    flags.push(`Basic pay is above RM${law.otWageLimit}: the Act's overtime rules bind only up to RM${law.otWageLimit} (First Schedule). The formula pays the rates set here.`);
  if (kind === 'guard_shift') {
    const rest = a.restHours ?? 0;
    // Guards: the normal-hours limits do not apply (exemption), so only the rest-break rule is flagged.
    if (a.holidaysArePaidDays === false) flags.push('Public holidays not worked are not paid days in this formula (EA s.60D gives a paid holiday).');
    if (a.epfOnRestHolidayPay === false) flags.push('Rest-day and holiday day pay are left out of EPF wages: Finance to confirm with KWSP.');
    if (rest > 0 && !a.restRelieved)
      flags.push(`The guard is not relieved from the post during the ${rest}-hour rest, so the rest is paid as work (rule PAY-REST-BREAK). Tick "relieved" only when a relief guard covers or the guard may leave.`);
  } else {
    if (a.normalHoursPerDay > law.normalHoursDayMax) flags.push(`Normal hours are more than ${law.normalHoursDayMax} a day (EA s.60A(1)); hours past it are normally overtime.`);
    if (a.normalHoursPerDay * a.workDaysPerWeek > law.normalHoursWeekMax + 1e-9)
      flags.push(`${r2(a.normalHoursPerDay * a.workDaysPerWeek)} normal hours a week is more than ${law.normalHoursWeekMax} (EA s.60A(1)).`);
    if (a.workDaysPerWeek > law.workDaysWeekMax) flags.push(`More than ${law.workDaysWeekMax} working days a week: the Act gives one rest day a week (EA s.59).`);
  }
  return { refuse, flags };
}

/** Hours a guard works in one shift: the shift less the rest, and the rest counts only when the guard is relieved. */
export function guardWorkedHours(a: PayFormulaAmounts): number {
  const shift = a.shiftHours ?? 0;
  const rest = a.restRelieved ? (a.restHours ?? 0) : 0;
  return r2(Math.max(0, shift - rest));
}
export function guardOtHoursPerDay(a: PayFormulaAmounts): number {
  return r2(Math.max(0, guardWorkedHours(a) - a.normalHoursPerDay));
}

export interface PayPreviewInput {
  /** Normal working days worked this month (guard: defaults to the full month). */
  daysWorked?: number;
  restDaysWorked?: number;
  publicHolidaysWorked?: number;
  // Driver: hours are entered from the trip or clock record.
  otHoursNormal?: number;
  otHoursRestDay?: number;
  otHoursPublicHoliday?: number;
  mealDays?: number;
  outstationNights?: number;
}

export interface PayPreviewLine {
  label: string;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
}

/**
 * What one month comes to under a formula. Rates follow EA s.60I: the daily rate is the monthly basic / 26 and the
 * hourly rate is the daily rate / the normal hours. A worked example only: it is not a payslip and pays nothing.
 */
export function payFormulaPreview(kind: PayFormulaKind, a: PayFormulaAmounts, input: PayPreviewInput = {}, law: PayLawSettings = DEFAULT_PAY_LAW) {
  const daily = a.basicMonthly / law.ordinaryRateDivisor;
  const hourly = daily / a.normalHoursPerDay;
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const lines: PayPreviewLine[] = [];
  const add = (label: string, qty: number | null, unit: string | null, rate: number | null, amount: number) => {
    if (qty === 0) return;
    lines.push({ label, qty: qty == null ? null : r2(qty), unit, rate: rate == null ? null : r2(rate), amount: r2(amount) });
  };
  const restDays = n(input.restDaysWorked);
  const holidays = n(input.publicHolidaysWorked);
  let otHours = 0;
  if (kind === 'guard_shift') {
    const full = a.fullMonthDays ?? 26;
    const days = input.daysWorked == null ? full : Math.min(n(input.daysWorked), full);
    const missing = full - days;
    lines.push({ label: 'Basic pay', qty: null, unit: null, rate: null, amount: r2(a.basicMonthly) });
    if (missing > 0) add('Days not worked (unpaid)', missing, 'day', -daily, -Math.min(a.basicMonthly, missing * daily));
    const perDay = guardOtHoursPerDay(a);
    otHours = perDay * (days + restDays + holidays);
    add('Overtime, working days', perDay * days, 'hour', hourly * a.otNormalRate, perDay * days * hourly * a.otNormalRate);
    add('Rest day worked', restDays, 'day', daily * a.restDayDays, restDays * daily * a.restDayDays);
    add('Overtime, rest days', perDay * restDays, 'hour', hourly * a.otRestDayRate, perDay * restDays * hourly * a.otRestDayRate);
    add('Public holiday worked', holidays, 'day', daily * a.publicHolidayDays, holidays * daily * a.publicHolidayDays);
    add('Overtime, public holidays', perDay * holidays, 'hour', hourly * a.otPublicHolidayRate, perDay * holidays * hourly * a.otPublicHolidayRate);
  } else {
    const otN = n(input.otHoursNormal);
    const otR = n(input.otHoursRestDay);
    const otP = n(input.otHoursPublicHoliday);
    otHours = otN + otR + otP;
    lines.push({ label: 'Basic pay', qty: null, unit: null, rate: null, amount: r2(a.basicMonthly) });
    add('Overtime, working days', otN, 'hour', hourly * a.otNormalRate, otN * hourly * a.otNormalRate);
    add('Rest day worked', restDays, 'day', daily * a.restDayDays, restDays * daily * a.restDayDays);
    add('Overtime, rest days', otR, 'hour', hourly * a.otRestDayRate, otR * hourly * a.otRestDayRate);
    add('Public holiday worked', holidays, 'day', daily * a.publicHolidayDays, holidays * daily * a.publicHolidayDays);
    add('Overtime, public holidays', otP, 'hour', hourly * a.otPublicHolidayRate, otP * hourly * a.otPublicHolidayRate);
    const meal = a.otMealAllowance ?? 0;
    if (meal > 0) add('Overtime meal allowance', n(input.mealDays), 'day', meal, n(input.mealDays) * meal);
    const away = a.outstationPerNight ?? 0;
    if (away > 0) add('Outstation allowance', n(input.outstationNights), 'night', away, n(input.outstationNights) * away);
  }
  for (const x of a.fixedAllowances ?? []) add(x.label, null, null, null, x.amount);
  const gross = r2(lines.reduce((s, l) => s + l.amount, 0));
  return { dailyRate: r2(daily), hourlyRate: r2(hourly), otHours: r2(otHours), overOtCap: kind !== 'guard_shift' && otHours > law.otMonthCap, lines, gross };
}

/** The place chain for a guard post, narrowest first. */
export interface PayPlace {
  siteId?: Id | null;
  companyId?: Id | null;
  regionId?: Id | null;
}

/** The formula code used at a place for a month: site, then company, then region, then the whole group. */
export function resolvePayFormulaUse(uses: PayFormulaUse[], kind: PayFormulaKind, place: PayPlace, month: PayMonth): PayFormulaUse | null {
  const chain: [PayFormulaScope, Id | null | undefined][] = [
    ['site', place.siteId],
    ['company', place.companyId],
    ['region', place.regionId],
    ['group', null],
  ];
  for (const [scope, id] of chain) {
    if (scope !== 'group' && !id) continue;
    if (!PAY_SCOPES_FOR[kind].includes(scope)) continue;
    const hit = uses
      .filter((u) => u.kind === kind && u.scope === scope && (scope === 'group' || u.scopeId === id) && u.effectiveFrom <= month)
      .sort((x, y) => y.effectiveFrom.localeCompare(x.effectiveFrom) || y.setAt.localeCompare(x.setAt))[0];
    // A "none" choice hands the place back to the wider choice.
    if (hit?.formulaCode) return hit;
  }
  return null;
}

/** The live version of a formula code in force for a month. */
export function payFormulaVersionFor(formulas: PayFormula[], code: string, month: PayMonth): PayFormula | null {
  return (
    formulas
      .filter((f) => f.code === code && f.status === 'live' && f.effectiveFrom <= month)
      .sort((x, y) => y.effectiveFrom.localeCompare(x.effectiveFrom) || y.version - x.version)[0] ?? null
  );
}

/**
 * Starting amounts for the test copy (Fauzan, 5 Nov 2026 gave the shapes: 12-hour shift with 2, 2.5 or 3 hours rest,
 * and driver overtime). Basic pay is the minimum wage as a placeholder and allowances are empty: ACT sets the real
 * amounts. Nothing here is a real rate.
 */
export function standardGuardAmounts(restHours: number): PayFormulaAmounts {
  return {
    basicMonthly: 1700,
    // A six-day week at the 45-hour limit: 7.5 normal hours a day.
    normalHoursPerDay: 7.5,
    workDaysPerWeek: 6,
    otNormalRate: 1.5,
    otRestDayRate: 2,
    otPublicHolidayRate: 3,
    restDayDays: 1,
    publicHolidayDays: 2,
    fixedAllowances: [],
    shiftHours: 12,
    restHours,
    restRelieved: true,
    fullMonthDays: 26,
    multiSite: 'main_site',
    holidaysArePaidDays: true,
    deductShortDays: true,
    epfOnRestHolidayPay: true,
  };
}
export function standardDriverAmounts(): PayFormulaAmounts {
  return {
    basicMonthly: 1700,
    normalHoursPerDay: 8,
    workDaysPerWeek: 5.5,
    otNormalRate: 1.5,
    otRestDayRate: 2,
    otPublicHolidayRate: 3,
    restDayDays: 1,
    publicHolidayDays: 2,
    fixedAllowances: [],
    otMealAllowance: 0,
    mealAfterHours: 3,
    outstationPerNight: 0,
  };
}
