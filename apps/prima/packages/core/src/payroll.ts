import { RULES } from './rules';
import { minimumWageFor, minimumWageShort } from './hr-payroll-checks';
import { statShare, statTableFor, type StatTable, type StatTableId } from './statutory-tables';
import { ageOn } from './time';
import type { AllowanceType, LeaveRequest, Nationality, Person, StaffClaim, StaffPayLine } from './types';

/**
 * Staff payroll sums (Fauzan, 27 Oct 2026: guards are paid from the JA Group app; Prima builds payroll for staff).
 * These follow the statutory rates as at October 2026. They are estimates for testing: before any real payroll the
 * figures are checked against the KWSP Third Schedule, the PERKESO tables and LHDN's e-PCB calculator.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
/** SOCSO and EIS amounts are in 5 sen steps. */
const r05 = (n: number) => Math.round(n * 20) / 20;

/**
 * EPF (KWSP Act 1991, Third Schedule), from the table kept in Prima (statutory-tables.ts): Part A for Malaysians under
 * 60 (employer 13% up to RM5,000 and 12% above, employee 11%), Part E from age 60 (employer 4%), foreign workers 2% each.
 */
export function epfShare(wage: number, age: number, nationality: Nationality, period = '9999-12', stored: StatTable[] = []): { ee: number; er: number; band: string; table: string } {
  const id: StatTableId = nationality !== 'MY' ? 'EPF-F' : age >= 60 ? 'EPF-E' : 'EPF-A';
  const t = statTableFor(id, period, stored);
  const s = statShare(t, wage);
  return { ee: s.ee, er: s.er, band: s.band, table: `${t.id} ${t.version}` };
}

/** SOCSO (PERKESO Act 4), from the table kept in Prima: First Category under 60; from 60 the Second Category (employer only). */
export function socsoShare(wage: number, age: number, period = '9999-12', stored: StatTable[] = []): { ee: number; er: number; band: string; table: string } {
  const t = statTableFor(age >= 60 ? 'SOCSO-2' : 'SOCSO-1', period, stored);
  const s = statShare(t, wage);
  return { ee: s.ee, er: s.er, band: s.band, table: `${t.id} ${t.version}` };
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

/** EIS (SIP, Act 800), from the table kept in Prima: Malaysians aged 18 to 59. */
export function eisShare(wage: number, age: number, nationality: Nationality, period = '9999-12', stored: StatTable[] = []): { ee: number; er: number } {
  if (nationality !== 'MY' || age < 18 || age >= 60) return { ee: 0, er: 0 };
  const s = statShare(statTableFor('EIS', period, stored), wage);
  return { ee: s.ee, er: s.er };
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
  /** Zakat the staff member chose, as a percentage of gross pay (0 = none). */
  zakatPercent?: number;
  /** EPF and PERKESO tables loaded and checked in Prima; the built-in tables otherwise. */
  tables?: StatTable[];
}

export function staffPaySums(i: StaffPayInput) {
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
  const epf = epfShare(epfWage, i.age, i.nationality, i.period, i.tables);
  const socso = socsoShare(socsoWage, i.age, i.period, i.tables);
  const eis = eisShare(socsoWage, i.age, i.nationality, i.period, i.tables);
  const lindung = lindungShare(socsoWage, i.period, i.nationality, i.lindungOptedOut);
  const pcbBeforeZakat = i.pcbEntered ?? pcbEstimate(taxable, epf.ee, socso.ee + eis.ee);
  // Zakat by salary deduction (Fauzan, 2 Nov 2026): the staff member's own percentage of gross pay. Zakat paid through
  // the employer reduces the monthly tax deduction ringgit for ringgit (ITA s.6A(3)), never below zero.
  const zakat = r2(Math.max(0, gross) * Math.max(0, i.zakatPercent ?? 0) / 100);
  const pcb = r2(Math.max(0, pcbBeforeZakat - zakat));
  const deductions = r2(epf.ee + socso.ee + lindung.ee + eis.ee + pcb + zakat);
  return {
    allowances,
    unpaidDeduction,
    gross,
    epfWage,
    socsoWage,
    taxable,
    epfEe: epf.ee,
    epfEr: epf.er,
    /** The table rows used, so the payslip can be checked against the published schedule. */
    statBands: { epf: `${epf.table}: ${epf.band}`, socso: `${socso.table}: ${socso.band}` },
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
  return JSON.stringify([p.basicPay ?? 0, allowances, from, to, unpaidDays, p.nationality, p.dob ?? '', p.lindungOptOut ?? null]);
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
  /** EPF and PERKESO tables loaded and checked in Prima. */
  tables?: StatTable[];
}): StaffPayLine {
  const { person: p, period } = args;
  const end = periodEnd(period);
  const age = ageOn(p.dob, end);
  const extra = args.kept?.extra ?? [];
  // Part of the month only: joined after the 1st or last day before the month end (Arisha main review, 3 Nov 2026).
  const start = `${period}-01`;
  const from = p.hiredOn > start ? p.hiredOn : start;
  const to = p.leaving && p.leaving.lastDayOn < end ? p.leaving.lastDayOn : end;
  const partMonth = from > start || to < end ? { from, to } : null;
  const kp = args.kept?.partPay ?? null;
  const partPay = partMonth ? kp : null;
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
  const allowanceLines = [...fixedLines, ...extra.map((a) => typed(a, false))];
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
    zakatPercent: p.zakat?.percent ?? 0,
    tables: args.tables,
  });
  const flags: string[] = [];
  if (!p.bank) flags.push('No salary account on record: cannot go in the bank file');
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
  if (partMonth)
    flags.push(
      partPay
        ? `Part month ${partMonth.from} to ${partMonth.to}: pay entered by ${partPay.by} (basic RM${partPay.basic.toFixed(2)}, fixed allowances RM${partPay.allowances.toFixed(2)}): ${partPay.note}`
        : `Part month ${partMonth.from} to ${partMonth.to}: HR enters the pay for the days worked before this month can be submitted (no proration rule is set)`,
    );
  if (p.movedFrom && p.hiredOn.slice(0, 7) === period) flags.push(`Transferred in on ${p.hiredOn}: the old employer pays up to the day before`);
  if (p.movedTo && p.leaving && p.leaving.lastDayOn.slice(0, 7) === period) flags.push(`Transferred out after ${p.leaving.lastDayOn}: the new employer pays from the day after`);
  if (age >= 60) flags.push('Aged 60 or over: EPF and SOCSO at the older rates, no EIS');
  // Minimum Wages Order 2024 (slice 3D): HR corrects the basic pay; Prima never pays less on its own.
  if (!partMonth && minimumWageShort(basic, period) > 0) flags.push(`Basic pay RM${basic.toFixed(2)} is below the minimum wage of RM${minimumWageFor(period).toFixed(2)}`);
  if (p.nationality === 'MY' && p.lindungOptOut == null && sums.lindungStatus === 'deducted')
    flags.push('LINDUNG 24 Jam deducted: opt-out choice not recorded');
  // Employment Act s.24(8): deductions are at most half of the wages.
  if (sums.gross > 0 && sums.deductions > sums.gross / 2) flags.push(`Deductions RM${sums.deductions.toFixed(2)} are more than half of gross pay: check the zakat choice`);
  // The numbers KWSP, PERKESO and LHDN need on the contribution files.
  if (!p.epfNo && sums.epfEe + sums.epfEr > 0) flags.push('No EPF (KWSP) number on record');
  if (!p.socsoNo && sums.socsoEr > 0) flags.push('No SOCSO (PERKESO) number on record');
  if (!p.taxNo && sums.pcb > 0) flags.push('No income tax (LHDN) number on record');
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
    partMonth,
    partPay,
    inputs,
    ...sums,
    zakatBody: sums.zakat > 0 ? (p.zakat?.body ?? null) : null,
    epfNo: p.epfNo ?? null,
    socsoNo: p.socsoNo ?? null,
    taxNo: p.taxNo ?? null,
  };
}
