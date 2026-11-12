import { staffZakatPreview, staffZakatInputKey } from './staff-zakat-guards';
import { RULES } from "./rules";
import { minimumWageFor } from "./hr-payroll-checks";
import { minimumWageShort } from "./hr-payroll-checks";
import { DEFAULT_STATUTORY } from "./statutory";
import { otherShare } from "./statutory";
import type { StatutorySettings } from "./statutory";
import { ageOn } from "./time";
import type { AllowanceType } from "./types";
import type { LeaveRequest } from "./types";
import type { Nationality } from "./types";
import type { PayAccount } from "./types";
import type { Person } from "./types";
import type { StaffClaim } from "./types";
import type { StaffPayLine } from "./types";
import { statShare } from "./statutory-tables";
import { statTableFor } from "./statutory-tables";
import type { StatTable } from "./statutory-tables";
import type { StatTableId } from "./statutory-tables";


/**
 * Staff payroll sums (Fauzan, 27 Oct 2026: guards are paid from the JA Group app; Prima builds payroll for staff).
 * These follow the statutory rates as at October 2026. They are estimates for testing: before any real payroll the
 * figures are checked against the KWSP Third Schedule, the PERKESO tables and LHDN's e-PCB calculator.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
/** SOCSO and EIS amounts are in 5 sen steps. */
const r05 = (n: number) => Math.round(n * 20) / 20;

/**
 * EPF (KWSP Act 1991, Third Schedule). Wages up to RM5,000 go in RM20 bands, above that in RM100 bands; the share is
 * worked on the top of the band and rounded up to the next ringgit. Employer 13% up to RM5,000 and 12% above;
 * employee 11%. From age 60 the employee pays nothing and the employer 4%. Foreign workers 2% each.
 */
export function epfShare(wage: number, age: number, nationality: Nationality, st: StatutorySettings = DEFAULT_STATUTORY): { ee: number; er: number } {
  const e = st.epf;
  if (wage <= 0) return { ee: 0, er: 0 };
  const up = (n: number) => (e.bands ? Math.ceil(Math.max(0, n - 1e-9)) : r2(n));
  if (nationality !== 'MY') return { ee: up(wage * e.foreignEeRate), er: up(wage * e.foreignErRate) };
  const band = wage <= e.erLimit ? 20 : 100;
  const top = !e.bands || wage > 20000 ? wage : Math.ceil(wage / band) * band;
  if (age >= e.olderAge) return { ee: up(top * e.olderEeRate), er: up(top * e.olderErRate) };
  return { ee: up(top * e.eeRate), er: up(top * (wage <= e.erLimit ? e.erRateLow : e.erRateHigh)) };
}

/** SOCSO (PERKESO): employer 1.75%, employee 0.5% on wages up to RM6,000; from 60 the employer pays 1.25% only. */
export function socsoShare(wage: number, age: number, st: StatutorySettings = DEFAULT_STATUTORY): { ee: number; er: number } {
  const s = st.socso;
  const w = Math.min(Math.max(wage, 0), s.wageCap);
  if (age >= s.olderAge) return { ee: 0, er: r05(w * s.olderErRate) };
  return { ee: r05(w * s.eeRate), er: r05(w * s.erRate) };
}

/**
 * LINDUNG 24 Jam (non-work accidents): employee only, at the rate for the wage month, on wages up to RM6,000. A
 * Malaysian with an opt-out form on file pays nothing; a foreign worker always pays.
 */
export function lindungShare(
  wage: number,
  period: string,
  nationality: Nationality,
  optedOut: boolean,
  st: StatutorySettings = DEFAULT_STATUTORY,
): { ee: number; rate: number; status: 'deducted' | 'opted_out' | 'not_started' } {
  const rule = RULES.lindung.value;
  const rate = st.lindung.rate ?? [...rule.rates].reverse().find((r) => r.from <= period)?.rate ?? 0;
  const cap = st.lindung.rate != null ? st.lindung.wageCap : rule.wageCeiling;
  if (!rate) return { ee: 0, rate: 0, status: 'not_started' };
  if (nationality === 'MY' && optedOut) return { ee: 0, rate, status: 'opted_out' };
  return { ee: r05(Math.min(Math.max(wage, 0), cap) * rate), rate, status: 'deducted' };
}

/** EIS (SIP): 0.2% each on wages up to RM6,000, Malaysians aged 18 to 59. */
export function eisShare(wage: number, age: number, nationality: Nationality, st: StatutorySettings = DEFAULT_STATUTORY): { ee: number; er: number } {
  const e = st.eis;
  if ((e.malaysiansOnly && nationality !== 'MY') || age < e.minAge || age >= e.maxAge) return { ee: 0, er: 0 };
  const w = Math.min(Math.max(wage, 0), e.wageCap);
  return { ee: r05(w * e.eeRate), er: r05(w * e.erRate) };
}

/** HRD Corp levy: 1% of basic pay and fixed allowances, Malaysian employees, paid by the employer. */
export function hrdLevy(basicAndFixed: number, nationality: Nationality, st: StatutorySettings = DEFAULT_STATUTORY): number {
  return !st.hrd.malaysiansOnly || nationality === 'MY' ? r2(basicAndFixed * st.hrd.rate) : 0;
}

/** The new contribution types the CEO added, for one worker. */
export function otherShares(st: StatutorySettings, wages: number, otPay: number, age: number, nationality: Nationality) {
  return st.others
    .map((o) => ({ code: o.code, name: o.name, payee: o.payee, ...otherShare(o, wages, otPay, age, nationality) }))
    .filter((x) => x.ee || x.er);
}

/** Resident individual tax bands (Income Tax Act 1967, Schedule 1, from YA 2023). */
const TAX_BANDS: [number, number][] = [
  [5000, 0],
  [20000, 0.01],
  [35000, 0.03],
  [50000, 0.06],
  [70000, 0.11],
  [100000, 0.19],
  [400000, 0.25],
  [600000, 0.26],
  [2000000, 0.28],
  [Infinity, 0.3],
];

export function residentTax(chargeable: number): number {
  let tax = 0;
  let from = 0;
  for (const [to, rate] of TAX_BANDS) {
    if (chargeable <= from) break;
    tax += (Math.min(chargeable, to) - from) * rate;
    from = to;
  }
  return tax;
}

/**
 * A rough monthly PCB: a full year at this month's pay, less the individual relief (RM9,000), EPF (up to RM4,000) and
 * SOCSO plus EIS (up to RM350), taxed at resident rates with the RM400 rebate up to RM35,000 chargeable. PCB under RM10
 * is not deducted. Only the single, no-children case: the real figure comes from LHDN's e-PCB with the TP1 and TP3 forms.
 */
export function pcbEstimate(monthlyTaxable: number, epfEe: number, socsoEisEe: number): number {
  const annual = monthlyTaxable * 12;
  const chargeable = Math.max(0, annual - 9000 - Math.min(epfEe * 12, 4000) - Math.min(socsoEisEe * 12, 350));
  const tax = Math.max(0, residentTax(chargeable) - (chargeable <= 35000 ? 400 : 0));
  const pcb = r2(tax / 12);
  return pcb < 10 ? 0 : pcb;
}

export interface StaffPayInput {
  basic: number;
  /**
   * Each allowance counts for EPF, SOCSO (with EIS and LINDUNG), PCB and the HRD levy unless its type says it does not
   * (HR's allowance list, Fauzan 3 Nov 2026). A missing tick means counted, as before the list.
   */
  allowances: { label: string; amount: number; fixed: boolean; epf?: boolean; socso?: boolean; pcb?: boolean; hrd?: boolean }[];
  unpaidDays: number;
  /** Employment Act s.60I: the daily rate of a monthly-paid employee is the monthly pay divided by 26. */
  unpaidDivisor: number;
  claims: number;
  age: number;
  nationality: Nationality;
  /** PCB entered from LHDN's calculator; null means use the estimate. */
  pcbEntered: number | null;
  /** The wage month (YYYY-MM), for rates that change by date. */
  period: string;
  lindungOptedOut: boolean;
  /** The statutory settings in force for the month (CEO, by month); the law as at Nov 2026 when not given. */
  statutory?: StatutorySettings;
  /** Zakat the staff member chose, as a percentage of gross pay (0 = none). */
  zakatPercent?: number;
  /** EPF and PERKESO tables loaded and checked in Prima; the built-in tables otherwise. */
  tables?: StatTable[];
}


export function staffPaySums(i: StaffPayInput) {
  const st = i.statutory ?? DEFAULT_STATUTORY;
  const allowances = r2(i.allowances.reduce((n, a) => n + a.amount, 0));
  // The HRD levy basis: basic plus fixed allowances, and one-offs HR ticked for HRD on the list (Arisha main retest,
  // 4 Nov 2026; to be confirmed with HRD Corp's wage definition). An unlisted one-off stays out, as before the list.
  const fixed = r2(i.allowances.filter((a) => (a.fixed ? a.hrd !== false : a.hrd === true)).reduce((n, a) => n + a.amount, 0));
  const unpaidDeduction = r2((i.basic / i.unpaidDivisor) * i.unpaidDays);
  const gross = r2(i.basic + allowances - unpaidDeduction);
  const outside = (k: 'epf' | 'socso' | 'pcb') => r2(i.allowances.filter((a) => a[k] === false).reduce((n, a) => n + a.amount, 0));
  const epfWage = r2(gross - outside('epf'));
  const socsoWage = r2(gross - outside('socso'));
  const taxable = r2(gross - outside('pcb'));
  const epf = epfShare(epfWage, i.age, i.nationality, st);
  const socso = socsoShare(socsoWage, i.age, st);
  const eis = eisShare(socsoWage, i.age, i.nationality, st);
  const lindung = lindungShare(socsoWage, i.period, i.nationality, i.lindungOptedOut, st);
  const others = otherShares(st, gross, 0, i.age, i.nationality);
  const othersEe = r2(others.reduce((n, o) => n + o.ee, 0));
  const pcbBeforeZakat = i.pcbEntered ?? pcbEstimate(taxable, epf.ee, socso.ee + eis.ee);
  const zakat = r2(Math.max(0, gross) * Math.max(0, i.zakatPercent ?? 0) / 100);
  const pcb = r2(Math.max(0, pcbBeforeZakat - zakat));
  const deductions = r2(epf.ee + socso.ee + lindung.ee + eis.ee + pcb + zakat + othersEe);
  return {
    allowances,
    unpaidDeduction,
    gross,
    epfWage,
    socsoWage,
    taxable,
    epfEe: epf.ee,
    epfEr: epf.er,
    socsoEe: socso.ee,
    socsoEr: socso.er,
    lindungEe: lindung.ee,
    lindungRate: lindung.rate,
    lindungStatus: lindung.status,
    eisEe: eis.ee,
    eisEr: eis.er,
    hrd: hrdLevy(i.basic + fixed, i.nationality, st),
    others,
    pcb,
    pcbSource: (i.pcbEntered == null ? 'estimate' : 'entered') as 'estimate' | 'entered',
    zakat,
    zakatPercent: Math.max(0, i.zakatPercent ?? 0),
    pcbBeforeZakat,
    deductions,
    /** Approved claims are paid back with the salary and are not wages for EPF, SOCSO or tax. */
    claims: r2(i.claims),
    net: r2(gross - deductions + i.claims),
  };
}

/** The last day of a YYYY-MM period. */
export function periodEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/**
 * What a payroll line was calculated from (Arisha main review, 3 Nov 2026): basic pay, fixed allowances with the ticks of
 * their types, the days employed in the month, unpaid leave days, and the facts the contribution rates depend on. A draft
 * whose lines no longer match is stale and must be recalculated before it is submitted.
 */
export function staffPayInputsKey(p: Person, period: string, types: AllowanceType[] | undefined, unpaidDays: number): string {
  const end = periodEnd(period);
  const start = `${period}-01`;
  const from = p.hiredOn > start ? p.hiredOn : start;
  const to = p.leaving && p.leaving.lastDayOn < end ? p.leaving.lastDayOn : end;
  const allowances = (p.allowances ?? []).map((a) => {
    const t = a.typeId ? types?.find((x) => x.id === a.typeId) : undefined;
    return [a.typeId ?? '', a.label, a.amount, t ? [t.epf, t.socso, t.pcb, t.hrd].map(Number).join('') : ''];
  });
  return JSON.stringify([p.basicPay ?? 0, allowances, from, to, unpaidDays, p.nationality, p.dob ?? '', p.lindungOptOut ?? null, staffZakatInputKey(p)]);
}

/** Effective contribution inputs, excluding version IDs, reasons and law-reference wording.
 * Stable object-key and contribution-code order prevents metadata/reordering-only changes from invalidating pay. */
export function staffPayStatutoryKey(settings: StatutorySettings = DEFAULT_STATUTORY): string {
  const { lawRef: _lawRef, ...inputs } = settings;
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
    return value;
  };
  return JSON.stringify(stable({ ...inputs, others: [...inputs.others].sort((a, b) => a.code.localeCompare(b.code)) }));
}


/**
 * P100 C1: the working days (Monday to Friday) from one date to another, both counted. A public holiday on a weekday is a
 * paid day for a monthly-paid employee (EA s.60D), so it counts as a day employed.
 */
export function staffWorkingDays(from: string, to: string): number {
  let n = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) n += 1;
  }
  return n;
}

/** P100 C1: the part-month pay for the working days employed: monthly / divisor x days, never more than the month. */
export function staffPartMonthPay(basic: number, fixedAllowances: number, from: string, to: string, divisor: number) {
  const workingDays = staffWorkingDays(from, to);
  const dailyBasic = basic / divisor;
  const dailyAllowances = fixedAllowances / divisor;
  return {
    workingDays,
    divisor,
    dailyBasic: r2(dailyBasic),
    dailyAllowances: r2(dailyAllowances),
    basic: r2(Math.min(basic, dailyBasic * workingDays)),
    allowances: r2(Math.min(fixedAllowances, dailyAllowances * workingDays)),
  };
}

/** One staff member's line for the month, from their record, approved unpaid leave and approved claims not paid yet. */
export function buildStaffPayLine(args: {
  person: Person;
  period: string;
  unpaidDivisor: number;
  leaves: LeaveRequest[];
  claims: StaffClaim[];
  /** HR's own entries kept across a recalculation: one-off allowances and a PCB from LHDN's calculator. */
  kept?: { extra: { label: string; amount: number; typeId?: string }[]; pcb: number | null; partPay?: StaffPayLine['partPay'] } | null;
  lastBasic?: number | null;
  /** Last month's salary account (masked), to flag a change. */
  lastBank?: string | null;
  /** One-off allowances above this are flagged for the approvers. */
  allowanceFlagAbove?: number;
  /** HR's allowance list, for each allowance's EPF, SOCSO, PCB and HRD ticks. */
  types?: AllowanceType[];
  /** The CEO's statutory settings for the month. */
  statutory?: StatutorySettings;
  /** P100 C12 + J3: approved overtime to pay on this line (HR's switch on, the person named). */
  overtime?: { ids: string[]; hours: number; hourly: number; amount: number } | null;
}): StaffPayLine {
  const { person: p, period } = args;
  const zakatChoice = staffZakatPreview(p, period);
  const end = periodEnd(period);
  const age = ageOn(p.dob, end);
  const extra = args.kept?.extra ?? [];
  // Part of the month only: joined after the 1st or last day before the month end (Arisha main review, 3 Nov 2026).
  const start = `${period}-01`;
  const from = p.hiredOn > start ? p.hiredOn : start;
  const to = p.leaving && p.leaving.lastDayOn < end ? p.leaving.lastDayOn : end;
  const partMonth = from > start || to < end ? { from, to } : null;
  const kp = args.kept?.partPay ?? null;
  const fullFixed0 = (p.allowances ?? []).reduce((n, a) => n + a.amount, 0);
  // P100 C1: Prima works out the part month (working days x the daily rate); HR's correction, with a reason, wins.
  const partAuto = partMonth ? staffPartMonthPay(p.basicPay ?? 0, fullFixed0, partMonth.from, partMonth.to, args.unpaidDivisor) : null;
  const partPay = partMonth ? (kp ?? (partAuto ? { basic: partAuto.basic, allowances: partAuto.allowances, note: '', by: '', at: '' } : null)) : null;
  const corrected = partMonth && kp ? kp : null;
  const typed = (a: { label: string; amount: number; typeId?: string }, fixed: boolean) => {
    const t = a.typeId ? args.types?.find((x) => x.id === a.typeId) : undefined;
    return { ...a, fixed, ...(t ? { epf: t.epf, socso: t.socso, pcb: t.pcb, hrd: t.hrd } : {}) };
  };
  // HR's part-month figure scales the fixed allowances together, keeping each one's EPF, SOCSO, PCB and HRD ticks.
  const fullFixed = (p.allowances ?? []).reduce((n, a) => n + a.amount, 0);
  const factor = partPay && fullFixed > 0 ? partPay.allowances / fullFixed : 1;
  const fixedLines = (p.allowances ?? []).map((a) => typed({ ...a, amount: Math.round(a.amount * factor * 100) / 100 }, true));
  if (partPay && fixedLines.length) {
    const drift = Math.round((partPay.allowances - fixedLines.reduce((n, a) => n + a.amount, 0)) * 100) / 100;
    fixedLines[fixedLines.length - 1].amount = Math.round((fixedLines[fixedLines.length - 1].amount + drift) * 100) / 100;
  }
  const otPay = args.overtime && args.overtime.amount > 0 ? args.overtime : null;
  const allowanceLines = [
    ...fixedLines,
    ...extra.map((a) => typed(a, false)),
    // Overtime is not wages for EPF (KWSP); SOCSO, EIS and PCB count it; not part of the HRD levy basis.
    ...(otPay ? [{ label: `Overtime (${otPay.hours} h approved)`, amount: otPay.amount, fixed: false, typeId: undefined as string | undefined, epf: false, socso: true, pcb: true, hrd: false, overtime: true }] : []),
  ];
  const unpaidDays = args.leaves
    .filter((l) => l.personId === p.id && l.kind === 'UNPAID' && l.status === 'approved' && l.from.slice(0, 7) === period)
    .reduce((n, l) => n + l.days, 0);
  const claims = args.claims.filter((c) => c.personId === p.id && c.status === 'approved');
  const inputs = staffPayInputsKey(p, period, args.types, unpaidDays);
  const basic = partPay ? partPay.basic : (p.basicPay ?? 0);
  const sums = staffPaySums({
    basic,
    allowances: allowanceLines,
    unpaidDays,
    unpaidDivisor: args.unpaidDivisor,
    claims: claims.reduce((n, c) => n + c.allowed, 0),
    age,
    nationality: p.nationality,
    pcbEntered: args.kept?.pcb ?? null,
    period,
    lindungOptedOut: p.lindungOptOut === true,
    statutory: args.statutory,
    zakatPercent: zakatChoice.percent,
  });
  const flags: string[] = [];
  // Presence warnings only: full member/tax identifiers stay out of broadly visible payroll lines.
  if (!p.epfNo) flags.push('No EPF (KWSP) number on record');
  if (!p.socsoNo) flags.push('No SOCSO (PERKESO) number on record');
  if (!p.taxNo) flags.push('No income tax number on record');
  const account = payAccountCheck(p.bank);
  if (account.problem) flags.push(`${account.problem}: cannot go in the bank file`);
  flags.push(...account.flags);
  if (!(p.basicPay ?? 0)) flags.push('No basic pay on record');
  if (args.lastBasic != null && args.lastBasic !== (p.basicPay ?? 0) && !partMonth) flags.push(`Basic pay changed from RM${args.lastBasic.toFixed(2)} last month`);
  if (p.bank && args.lastBank && args.lastBank !== p.bank.accountMasked) flags.push(`Salary account changed since last month (was ${args.lastBank})`);
  else if (p.bank && p.bankChangedOn?.slice(0, 7) === period)
    flags.push(`Salary account changed on ${p.bankChangedOn}`);
  const big = args.allowanceFlagAbove ?? Infinity;
  for (const a of extra.filter((x) => x.amount > big)) flags.push(`One-off allowance above RM${big}: ${a.label} RM${a.amount.toFixed(2)}`);
  for (const a of allowanceLines.filter((x) => args.types && x.typeId && !args.types.some((t) => t.id === x.typeId)))
    flags.push(`Allowance "${a.label}" is not on HR's allowance list: counted for EPF, SOCSO, PCB and HRD`);
  const off = allowanceLines.filter((a) => a.epf === false || a.socso === false || a.pcb === false || a.hrd === false);
  if (off.length)
    flags.push(
      `Not counted per HR's allowance list: ${off.map((a) => `${a.label} (${[a.epf === false && 'EPF', a.socso === false && 'SOCSO', a.pcb === false && 'PCB', a.hrd === false && 'HRD'].filter(Boolean).join(', ')})`).join('; ')}`,
    );
  if (partMonth && partAuto)
    flags.push(
      corrected
        ? `Part month ${partMonth.from} to ${partMonth.to}: corrected by ${corrected.by} to basic RM${corrected.basic.toFixed(2)}, fixed allowances RM${corrected.allowances.toFixed(2)} (worked out: RM${partAuto.basic.toFixed(2)} and RM${partAuto.allowances.toFixed(2)}): ${corrected.note}`
        : `Part month ${partMonth.from} to ${partMonth.to}: ${partAuto.workingDays} working days x RM${partAuto.dailyBasic.toFixed(2)} a day (basic / ${partAuto.divisor}) = RM${partAuto.basic.toFixed(2)}${fullFixed0 ? `; fixed allowances RM${partAuto.allowances.toFixed(2)}` : ''}`,
    );
  if (p.movedFrom && p.hiredOn.slice(0, 7) === period) flags.push(`Transferred in on ${p.hiredOn}: the old employer pays up to the day before`);
  if (p.movedTo && p.leaving && p.leaving.lastDayOn.slice(0, 7) === period) flags.push(`Transferred out after ${p.leaving.lastDayOn}: the new employer pays from the day after`);
  if (age >= 60) flags.push('Aged 60 or over: EPF and SOCSO at the older rates, no EIS');
  // Minimum Wages Order 2024 (slice 3D): HR corrects the basic pay; Prima never pays less on its own.
  if (!partMonth && minimumWageShort(basic, period) > 0) flags.push(`Basic pay RM${basic.toFixed(2)} is below the minimum wage of RM${minimumWageFor(period).toFixed(2)}`);
  if (p.nationality === 'MY' && p.lindungOptOut == null && sums.lindungStatus === 'deducted')
    flags.push('LINDUNG 24 Jam deducted: opt-out choice not recorded');
  if (sums.gross > 0 && sums.deductions > sums.gross / 2) flags.push(`Deductions RM${sums.deductions.toFixed(2)} exceed half of gross pay: review the applicable deduction limits and zakat choice`);
  if (unpaidDays) flags.push(`${unpaidDays} day${unpaidDays === 1 ? '' : 's'} unpaid leave deducted`);
  // P100 J4: unpaid leave Prima took for time slip hours not worked back (rule HR-TIME-SLIP) is named on the line.
  const slipUnpaid = args.leaves.filter((l) => l.personId === p.id && l.kind === 'UNPAID' && l.status === 'approved' && l.from.slice(0, 7) === period && l.timeSlipId);
  if (slipUnpaid.length) flags.push(`Of which ${slipUnpaid.reduce((n, l) => n + l.days, 0)} day(s) for time slip hours not worked back (${slipUnpaid.map((l) => l.timeSlipId).join(', ')})`);
  return {
    personId: p.id,
    staffNo: p.staffNo,
    name: p.name,
    jobTitle: p.jobTitle ?? '',
    age,
    nationality: p.nationality,
    basic,
    allowanceLines,
    unpaidDays,
    claimIds: claims.map((c) => c.id),
    bank: p.bank ?? null,
    flags,
    overtime: otPay,
    partMonth,
    partAuto,
    partPay: corrected,
    inputs,
    statutoryInputs: staffPayStatutoryKey(args.statutory),
    ...sums,
    zakatBody: sums.zakat > 0 ? zakatChoice.body : null,
  };
}

/** Whether wages can be paid into this account (Fauzan, 6 Nov 2026), and what the approver should know. */
export function payAccountCheck(acc: PayAccount | null | undefined): { problem: string | null; flags: string[] } {
  if (!acc) return { problem: 'No bank account or e-wallet on record', flags: [] };
  const flags: string[] = [];
  if (acc.kind === 'ewallet') flags.push(`Paid to an e-wallet (${acc.bank}): EA s.25 names a bank account; legal point for the CEO`);
  const holder = acc.holder ?? 'own';
  if (holder === 'relative' || holder === 'friend') {
    const who = `${acc.holderName || 'someone else'}${acc.relationship ? `, ${acc.relationship}` : ''}`;
    if (!acc.consent) return { problem: `Paid into ${who}'s account with no written consent on file`, flags };
    if (!acc.consent.oaths?.commissioner || !acc.consent.oaths?.stampRef)
      return { problem: `Consent letter for ${who}'s account has no Commissioner for Oaths stamp recorded`, flags };
    if (!acc.consent.approved) return { problem: `Consent letter for ${who}'s account is waiting for the COO's approval`, flags };
    flags.push(
      `Paid into ${who}'s account: consent letter ${acc.consent.docRef}, stamped by Commissioner for Oaths ${acc.consent.oaths.commissioner}, approved by ${acc.consent.approved.by}. EA s.25 wants the worker's own or joint account; legal point for the CEO`,
    );
  }
  return { problem: null, flags };
}
