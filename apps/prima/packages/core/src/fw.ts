// Foreign Worker Management (Fauzan, 26 Oct 2026): the reminder ladder for foreign-worker papers, the Year 10 plan,
// and the labels FWM uses. FWM does the renewals; the company stays the employer.

import { RULES } from './rules';
import { addDays, daysBetween } from './time';
import type { FwCheckKind, FwConcern, FwmTaskKind, FwPaper, FwWelfareCheck, IsoDate } from './types';

export const FW_PAPER_LABEL: Record<FwPaper, string> = {
  PLKS_PERMIT: 'Work permit (PLKS)',
  PASSPORT: 'Passport',
  FOMEMA: 'FOMEMA medical',
  FW_INSURANCE: 'Foreign worker insurance',
};

export const FWM_TASK_LABEL: Record<FwmTaskKind, string> = {
  FOMEMA: 'FOMEMA medical check',
  JIM: 'Immigration (JIM) appointment',
  TNG: 'TNG training',
  BIOMETRIC: 'Biometric or photo capture',
  UTILITY_CLAUSE: 'Add the utility clause to the contract',
  OTHER: 'Other errand',
};

/** Who is told at each stage. Escalation goes FWM, Chief of Staff, COO, CEO (Fauzan, 26 Oct 2026). */
export type FwLevel = 'FWM' | 'CHIEF_OF_STAFF' | 'COO' | 'CEO';

export const FW_LEVEL_LABEL: Record<FwLevel, string> = { FWM: 'FWM', CHIEF_OF_STAFF: 'Chief of Staff', COO: 'COO', CEO: 'CEO' };

export interface FwStage {
  /** The ladder step reached: 120, 90, 60, 30, 15 or 7 days, 0 when expired, null when more than 120 days remain. */
  step: number | null;
  priority: 'P1' | 'P2' | 'P3' | 'P4' | null;
  urgent: boolean;
  /** Everyone alerted so far, in escalation order. */
  alerted: FwLevel[];
  paused: boolean;
  label: string;
}

// FW design v3 escalation matrix: Chief of Staff at 30 days, COO at 15 (urgent), CEO at 7 or expired.
const LEVEL_AT: Record<number, FwLevel> = { 120: 'FWM', 90: 'FWM', 60: 'FWM', 30: 'CHIEF_OF_STAFF', 15: 'COO', 7: 'CEO' };
const PRIORITY_AT: Record<number, FwStage['priority']> = { 120: 'P4', 90: 'P4', 60: 'P3', 30: 'P2', 15: 'P1', 7: 'P1' };

/**
 * Where a paper is on the ladder. A renewal submitted with its receipt pauses it: FWM is still shown the date, but
 * nobody above FWM is alerted.
 */
export function fwStage(daysLeft: number, submitted: boolean): FwStage {
  const steps = [...RULES.fwmLadder.value];
  const reached = daysLeft < 0 ? 0 : (steps.filter((d) => daysLeft <= d).at(-1) ?? null);
  if (reached === null) return { step: null, priority: null, urgent: false, alerted: [], paused: false, label: 'More than 120 days' };
  const passed = reached === 0 ? steps : steps.filter((d) => d >= reached);
  const levels: FwLevel[] = [];
  for (const d of passed) if (!levels.includes(LEVEL_AT[d])) levels.push(LEVEL_AT[d]);
  if (submitted) return { step: reached, priority: 'P4', urgent: false, alerted: ['FWM'], paused: true, label: 'Renewal submitted, waiting for the new date' };
  const urgent = reached <= 15;
  return {
    step: reached,
    priority: reached === 0 ? 'P1' : PRIORITY_AT[reached],
    urgent,
    alerted: levels,
    paused: false,
    label: reached === 0 ? 'Expired' : `${reached} days${urgent ? ', urgent' : ''}`,
  };
}

/** The date the ladder counts to: for a passport, 12 months before it expires (needed to renew the PLKS). */
export function fwDeadline(paper: FwPaper, expiresOn: IsoDate): IsoDate {
  return paper === 'PASSPORT' ? addDays(expiresOn, -Math.round(RULES.fwmPassportMonths.value * 30.44)) : expiresOn;
}

/**
 * The Year 10 plan (rule FWM-YEAR-CAP). Service is counted from the hire date until the first permit date is on
 * record. The worker leaves at the end of year 10, the fresh application is filed in month 3 at home, and the worker
 * can be back after 6 months with the count starting again.
 */
export function fwServicePlan(hiredOn: IsoDate, today: IsoDate) {
  const cap = RULES.fwmYearCap.value;
  const year = Math.floor(daysBetween(hiredOn, today) / 365.25) + 1;
  const leaveBy = addDays(hiredOn, Math.round(cap * 365.25));
  return {
    year,
    cap,
    leaveBy,
    applyFrom: addDays(leaveBy, 91),
    backFrom: addDays(leaveBy, 183),
    daysToLeave: daysBetween(today, leaveBy),
    finalYear: year >= cap,
  };
}

// ---------- Responsible recruitment and worker welfare (masterplan §240, Fauzan 3 Nov 2026) ----------

export const FW_CHECK_LABEL: Record<FwCheckKind, string> = {
  ARRIVAL_FEE: 'Arrival fee check',
  PASSPORT: 'Passport check',
  WELFARE: 'Welfare talk',
};

export const FW_CONCERN_LABEL: Record<FwConcern, string> = {
  PAY: 'Pay late or short',
  HOURS: 'Too many hours or no rest day',
  HOUSING: 'Hostel conditions',
  TREATMENT: 'Treatment by a supervisor',
  FEES: 'Paying a fee or debt to someone',
  DOCUMENTS: 'Passport or papers kept from them',
  HEALTH: 'Health',
  OTHER: 'Other',
};

/** Whether a new check needs following up: a fee paid, a passport held without consent, or a concern raised. */
export function fwCheckOpens(c: Pick<FwWelfareCheck, 'kind' | 'paidAnything' | 'heldBy' | 'docIds' | 'concerns'>): boolean {
  if (c.kind === 'ARRIVAL_FEE') return !!c.paidAnything;
  // Rule FWM-PASSPORT-CONSENT (Fauzan, 3 Nov 2026): an attached document counts as consent; its content is not checked.
  if (c.kind === 'PASSPORT') return c.heldBy === 'company' && !c.docIds.length;
  return (c.concerns ?? []).length > 0;
}

/** Who holds the passport after this check and any follow-up on it, and whether a company hold is consented. */
export function fwPassportCustody(c: FwWelfareCheck | null): { holder: 'worker' | 'company' | null; consented: boolean } {
  if (!c || c.kind !== 'PASSPORT') return { holder: null, consented: false };
  if (c.status === 'closed' && c.custodyAfter) return { holder: c.custodyAfter, consented: c.custodyAfter === 'company' };
  const holder = c.heldBy ?? null;
  return { holder, consented: holder === 'company' && c.docIds.length > 0 };
}

export interface AgencyScore {
  agency: string;
  checked: number;
  feesFound: number;
  /** RM the workers said they paid. */
  paid: number;
  /** RM the agencies paid back. */
  repaid: number;
  open: number;
}

/**
 * The agency scorecard from the arrival fee checks: how many workers each agency brought, how many paid a fee, how
 * much, and how much was paid back. Agency names are matched ignoring case and spaces.
 */
export function agencyScorecard(checks: FwWelfareCheck[]): AgencyScore[] {
  const by = new Map<string, AgencyScore>();
  for (const c of checks) {
    if (c.kind !== 'ARRIVAL_FEE') continue;
    const name = (c.agency ?? '').trim() || 'Agency not recorded';
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    const s = by.get(key) ?? { agency: name, checked: 0, feesFound: 0, paid: 0, repaid: 0, open: 0 };
    s.checked += 1;
    if (c.paidAnything) {
      s.feesFound += 1;
      s.paid += c.amount ?? 0;
      s.repaid += c.repaid ?? 0;
    }
    if (c.status === 'open') s.open += 1;
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => b.feesFound - a.feesFound || b.paid - a.paid || a.agency.localeCompare(b.agency));
}
