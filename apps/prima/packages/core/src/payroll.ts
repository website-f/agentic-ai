import { RULES } from './rules';
import { ageOn } from './time';
import type { LeaveRequest, Nationality, Person, StaffClaim, StaffPayLine } from './types';

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
export function epfShare(wage: number, age: number, nationality: Nationality): { ee: number; er: number } {
  if (wage <= 0) return { ee: 0, er: 0 };
  if (nationality !== 'MY') return { ee: Math.ceil(wage * 0.02), er: Math.ceil(wage * 0.02) };
  const band = wage <= 5000 ? 20 : 100;
  const top = wage > 20000 ? wage : Math.ceil(wage / band) * band;
  if (age >= 60) return { ee: 0, er: Math.ceil(top * 0.04) };
  return { ee: Math.ceil(top * 0.11), er: Math.ceil(top * (wage <= 5000 ? 0.13 : 0.12)) };
}

/** SOCSO (PERKESO): employer 1.75%, employee 0.5% on wages up to RM6,000; from 60 the employer pays 1.25% only. */
export function socsoShare(wage: number, age: number): { ee: number; er: number } {
  const w = Math.min(Math.max(wage, 0), 6000);
  if (age >= 60) return { ee: 0, er: r05(w * 0.0125) };
  return { ee: r05(w * 0.005), er: r05(w * 0.0175) };
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
): { ee: number; rate: number; status: 'deducted' | 'opted_out' | 'not_started' } {
  const rule = RULES.lindung.value;
  const rate = [...rule.rates].reverse().find((r) => r.from <= period)?.rate ?? 0;
  if (!rate) return { ee: 0, rate: 0, status: 'not_started' };
  if (nationality === 'MY' && optedOut) return { ee: 0, rate, status: 'opted_out' };
  return { ee: r05(Math.min(Math.max(wage, 0), rule.wageCeiling) * rate), rate, status: 'deducted' };
}

/** EIS (SIP): 0.2% each on wages up to RM6,000, Malaysians aged 18 to 59. */
export function eisShare(wage: number, age: number, nationality: Nationality): { ee: number; er: number } {
  if (nationality !== 'MY' || age < 18 || age >= 60) return { ee: 0, er: 0 };
  const w = Math.min(Math.max(wage, 0), 6000);
  return { ee: r05(w * 0.002), er: r05(w * 0.002) };
}

/** HRD Corp levy: 1% of basic pay and fixed allowances, Malaysian employees, paid by the employer. */
export function hrdLevy(basicAndFixed: number, nationality: Nationality): number {
  return nationality === 'MY' ? r2(basicAndFixed * 0.01) : 0;
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
  allowances: { label: string; amount: number; fixed: boolean }[];
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
}

export function staffPaySums(i: StaffPayInput) {
  const allowances = r2(i.allowances.reduce((n, a) => n + a.amount, 0));
  const fixed = r2(i.allowances.filter((a) => a.fixed).reduce((n, a) => n + a.amount, 0));
  const unpaidDeduction = r2((i.basic / i.unpaidDivisor) * i.unpaidDays);
  const gross = r2(i.basic + allowances - unpaidDeduction);
  const epf = epfShare(gross, i.age, i.nationality);
  const socso = socsoShare(gross, i.age);
  const eis = eisShare(gross, i.age, i.nationality);
  const lindung = lindungShare(gross, i.period, i.nationality, i.lindungOptedOut);
  const pcb = i.pcbEntered ?? pcbEstimate(gross, epf.ee, socso.ee + eis.ee);
  const deductions = r2(epf.ee + socso.ee + lindung.ee + eis.ee + pcb);
  return {
    allowances,
    unpaidDeduction,
    gross,
    epfEe: epf.ee,
    epfEr: epf.er,
    socsoEe: socso.ee,
    socsoEr: socso.er,
    lindungEe: lindung.ee,
    lindungRate: lindung.rate,
    lindungStatus: lindung.status,
    eisEe: eis.ee,
    eisEr: eis.er,
    hrd: hrdLevy(i.basic + fixed, i.nationality),
    pcb,
    pcbSource: (i.pcbEntered == null ? 'estimate' : 'entered') as 'estimate' | 'entered',
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

/** One staff member's line for the month, from their record, approved unpaid leave and approved claims not paid yet. */
export function buildStaffPayLine(args: {
  person: Person;
  period: string;
  unpaidDivisor: number;
  leaves: LeaveRequest[];
  claims: StaffClaim[];
  /** HR's own entries kept across a recalculation: one-off allowances and a PCB from LHDN's calculator. */
  kept?: { extra: { label: string; amount: number }[]; pcb: number | null } | null;
  lastBasic?: number | null;
  /** Last month's salary account (masked), to flag a change. */
  lastBank?: string | null;
  /** One-off allowances above this are flagged for the approvers. */
  allowanceFlagAbove?: number;
}): StaffPayLine {
  const { person: p, period } = args;
  const end = periodEnd(period);
  const age = ageOn(p.dob, end);
  const extra = args.kept?.extra ?? [];
  const allowanceLines = [...(p.allowances ?? []).map((a) => ({ ...a, fixed: true })), ...extra.map((a) => ({ ...a, fixed: false }))];
  const unpaidDays = args.leaves
    .filter((l) => l.personId === p.id && l.kind === 'UNPAID' && l.status === 'approved' && l.from.slice(0, 7) === period)
    .reduce((n, l) => n + l.days, 0);
  const claims = args.claims.filter((c) => c.personId === p.id && c.status === 'approved');
  const basic = p.basicPay ?? 0;
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
  });
  const flags: string[] = [];
  if (!p.bank) flags.push('No salary account on record: cannot go in the bank file');
  if (!basic) flags.push('No basic pay on record');
  if (args.lastBasic != null && args.lastBasic !== basic) flags.push(`Basic pay changed from RM${args.lastBasic.toFixed(2)} last month`);
  if (p.bank && args.lastBank && args.lastBank !== p.bank.accountMasked) flags.push(`Salary account changed since last month (was ${args.lastBank})`);
  else if (p.bank && p.bankChangedOn?.slice(0, 7) === period)
    flags.push(`Salary account changed on ${p.bankChangedOn}`);
  const big = args.allowanceFlagAbove ?? Infinity;
  for (const a of extra.filter((x) => x.amount > big)) flags.push(`One-off allowance above RM${big}: ${a.label} RM${a.amount.toFixed(2)}`);
  if (p.hiredOn.slice(0, 7) === period) flags.push('Joined this month: check the days to pay');
  if (age >= 60) flags.push('Aged 60 or over: EPF and SOCSO at the older rates, no EIS');
  if (p.nationality === 'MY' && p.lindungOptOut == null && sums.lindungStatus === 'deducted')
    flags.push('LINDUNG 24 Jam deducted: opt-out choice not recorded');
  if (unpaidDays) flags.push(`${unpaidDays} day${unpaidDays === 1 ? '' : 's'} unpaid leave deducted`);
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
    ...sums,
  };
}
