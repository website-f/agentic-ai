import { epfShare } from "./payroll";
import { lindungShare } from "./payroll";
import { socsoShare } from "./payroll";
import type { FwContribution } from "./types";
import type { FwStatCharge } from "./types";
import type { FwStatLine } from "./types";
import type { IsoDate } from "./types";


const r2 = (n: number) => Math.round(n * 100) / 100;

export const FW_CONTRIBUTION_KEYS = ['epfEr', 'epfEe', 'socsoEr', 'socsoEe', 'lindungEe'] as const;

export const FW_CONTRIBUTION_LABEL: Record<keyof FwContribution, string> = {
  epfEr: 'EPF employer',
  epfEe: 'EPF employee',
  socsoEr: 'SOCSO employer',
  socsoEe: 'SOCSO employee',
  lindungEe: 'LINDUNG 24 Jam',
};

export const FW_STAT_STATUS_LABEL: Record<FwStatCharge['status'], string> = {
  issued: 'Waiting for repayment',
  paid: 'Repaid, waiting for Finance to check',
  received: 'Repaid and checked',
  cancelled: 'Cancelled',
};

export function contributionTotal(c: FwContribution): number {
  return r2(FW_CONTRIBUTION_KEYS.reduce((t, k) => t + c[k], 0));
}

/** Days in a YYYY-MM month. */
export function daysInPeriod(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Days of the month a placement covers (from and to inclusive; an open placement runs to the end of the month). */
export function placementDaysIn(p: { from: IsoDate; to: IsoDate | null }, period: string): number {
  const first = `${period}-01`;
  const last = `${period}-${String(daysInPeriod(period)).padStart(2, '0')}`;
  const a = p.from > first ? p.from : first;
  const b = p.to && p.to < last ? p.to : last;
  if (a > b) return 0;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
}

/**
 * What the published rates give for a Nepali worker on a wage (foreign EPF 2% + 2%, SOCSO 1.75% + 0.5%, LINDUNG 24 Jam
 * at the month's rate). Used only to check the figures the owner company paid; the paid figures are what is recharged.
 */
export function expectedContribution(wage: number, age: number, period: string): FwContribution {
  const epf = epfShare(wage, age, 'NP');
  const socso = socsoShare(wage, age);
  const lindung = lindungShare(wage, period, 'NP', false);
  return { epfEr: epf.er, epfEe: epf.ee, socsoEr: socso.er, socsoEe: socso.ee, lindungEe: lindung.ee };
}

/** The user's share of what was paid: each figure x days used / days in the month, to the sen. */
export function chargedShare(paid: FwContribution, daysUsed: number, daysInMonth: number): FwContribution {
  const f = daysInMonth > 0 ? Math.min(1, Math.max(0, daysUsed / daysInMonth)) : 0;
  return {
    epfEr: r2(paid.epfEr * f),
    epfEe: r2(paid.epfEe * f),
    socsoEr: r2(paid.socsoEr * f),
    socsoEe: r2(paid.socsoEe * f),
    lindungEe: r2(paid.lindungEe * f),
  };
}

/** Figures that differ from the published rate by more than the tolerance. */
export function contributionDiffs(paid: FwContribution, expected: FwContribution, toleranceRm: number): (keyof FwContribution)[] {
  return FW_CONTRIBUTION_KEYS.filter((k) => Math.abs(paid[k] - expected[k]) > toleranceRm + 1e-9);
}

/** The amount a charge asks to be repaid. */
export function chargeTotal(lines: Pick<FwStatLine, 'charged'>[]): number {
  return r2(lines.reduce((t, l) => t + contributionTotal(l.charged), 0));
}

/** Whether a repayment is late: still not repaid after the due date. */
export function chargeOverdue(c: Pick<FwStatCharge, 'status' | 'dueOn'>, today: IsoDate): boolean {
  return c.status === 'issued' && c.dueOn < today;
}

/** Key of the user a placement or charge is for: a branch, or the company itself. */
export function fwUserKey(companyId: string, branchId: string | null): string {
  return branchId ? `${companyId}/${branchId}` : companyId;
}

/** Who pays the salary for a placement: as FWM recorded it, else the branch when a branch hosts, else the company. */
export function salaryPayerOf(p: { hostBranchId: string | null; salaryPaidBy?: 'company' | 'branch' }): 'company' | 'branch' {
  return p.salaryPaidBy ?? (p.hostBranchId ? 'branch' : 'company');
}