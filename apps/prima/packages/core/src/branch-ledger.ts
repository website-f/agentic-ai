import type { Branch, BranchAccount, BranchBusinessCase, BranchSettlement, BranchSettlementLine, BranchTreasuryDay, Company, IsoDate } from './types';
import { agreementOn } from './branches';

// Masterplan chapter 03 (V11, V12, V12.1): a branch is inside its licensed company. These helpers keep the parts of
// the chapter that are pure rules: what a branch needs before it is activated, what a month's settlement is made of,
// and which account kinds may carry company money. Nothing here posts to SQL Account, moves money or files with KDN.

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cost kinds a branch month may carry. Model C's net profit is billing less every one of them. */
export const BRANCH_COST_KINDS = [
  'wages',
  'statutory',
  'transport',
  'hostel',
  'insurance',
  'equipment',
  'subcontract',
  'management_fee',
  'shared_cost',
  'bad_debt',
  'provision',
  'other',
] as const;
export type BranchCostKind = (typeof BRANCH_COST_KINDS)[number];

export const BRANCH_COST_LABEL: Record<BranchCostKind, string> = {
  wages: 'Guard and staff wages',
  statutory: 'EPF, SOCSO, EIS, PCB and levies',
  transport: 'Transport',
  hostel: 'Hostel and lodging',
  insurance: 'Insurance',
  equipment: 'Uniforms and equipment',
  subcontract: 'Lawful subcontractors',
  management_fee: 'Management fee',
  shared_cost: 'Shared head office cost',
  bad_debt: 'Bad debt written off',
  provision: 'Provision (e.g. leave)',
  other: 'Other approved cost',
};

/** Statuses after which the month counts as settled; a returned or draft month can still change. */
export const SETTLED: BranchSettlement['status'][] = ['approved', 'validated', 'paid'];

export function isSettled(s: Pick<BranchSettlement, 'status'>): boolean {
  return SETTLED.includes(s.status);
}

/**
 * The month's billing and cost totals from its lines. Billing is the tax-exclusive invoiced value of signed work; a
 * credit note is a negative billing line. The three legacy cost buckets are kept so the existing split works.
 */
export function settlementTotals(lines: BranchSettlementLine[]) {
  let billing = 0;
  const byKind = Object.fromEntries(BRANCH_COST_KINDS.map((k) => [k, 0])) as Record<BranchCostKind, number>;
  for (const l of lines) {
    if (l.kind === 'billing' || l.kind === 'credit_note' || l.kind === 'true_up') billing += l.amount;
    else byKind[l.kind] += l.amount;
  }
  const wages = r2(byKind.wages);
  const statutory = r2(byKind.statutory);
  const other = r2(BRANCH_COST_KINDS.filter((k) => k !== 'wages' && k !== 'statutory').reduce((n, k) => n + byKind[k], 0));
  return { billing: r2(billing), costs: { wages, statutory, other }, byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, r2(v)])) };
}

/**
 * What must be on record before a proposed branch may start work (masterplan 145 "activate after compliance gate").
 * Each item names the paper; the KDN step is a reference the company enters, never a check Prima makes with KDN.
 */
export function branchActivationGaps(b: Branch, company: Pick<Company, 'name'>, on: IsoDate): string[] {
  const gaps: string[] = [];
  const a = agreementOn(b.agreements, on);
  if (!a) gaps.push('No signed branch agreement in force');
  const s = b.setup;
  if (!s?.kdnRef) gaps.push('No KDN branch or operating-area approval reference');
  if (!s?.premisesRef) gaps.push('No premises or local council licence reference');
  if (!s?.insuranceRef) gaps.push('No insurance reference covering the branch');
  if (!s?.sqlProjectCode) gaps.push('No SQL Account project code (Finance sets it)');
  if (!s?.legalEmployer || s.legalEmployer !== company.name) gaps.push(`Legal employer not confirmed as ${company.name}`);
  const bank = (b.accounts ?? []).filter((x) => x.kind === 'company_branch_bank' && x.verifiedBy && !x.closedAt);
  if (!bank.length) gaps.push("No verified bank account in the company's own name for the branch");
  const bc = latestBusinessCase(b);
  if (!bc) gaps.push('No business case with a 13-week cash forecast');
  else if (!bc.reviewedBy) gaps.push('Business case not yet reviewed by Finance');
  return gaps;
}

/**
 * Masterplan 148 and 170: only an account in the licensed company's own name is a company bank account. A partner
 * entity's account may receive the manager's approved fee and nothing else; a personal account is never accepted.
 */
export function accountProblem(
  kind: BranchAccount['kind'],
  holder: string,
  ssmRegNo: string | null,
  company: Pick<Company, 'name'>,
): string | null {
  const h = holder.trim().toLowerCase();
  if (kind === 'company_branch_bank' && h !== company.name.trim().toLowerCase())
    return `A branch bank account must be in the company's own name (${company.name}), not "${holder.trim()}".`;
  if (kind === 'partner_entity' && !(ssmRegNo ?? '').trim())
    return "A partner account must belong to the partner's registered business: give its SSM registration number. A personal account is not accepted.";
  return null;
}

/** Steps to close a branch (masterplan 157), in order. Each needs a note; the last needs the final settlement paid. */
export const TERMINATION_STEPS = ['notice_given', 'clients_moved', 'guards_moved', 'assets_returned', 'final_settlement', 'closed'] as const;
export type TerminationStep = (typeof TERMINATION_STEPS)[number];

export const TERMINATION_LABEL: Record<TerminationStep, string> = {
  notice_given: 'Notice given under the agreement',
  clients_moved: 'Clients moved to the company or another branch',
  guards_moved: 'Guards moved, with their employer unchanged',
  assets_returned: 'Uniforms, devices, keys and records returned',
  final_settlement: 'Final settlement paid',
  closed: 'Branch closed',
};

/** The next termination step after the ones already done, or null when the branch is closed. */
export function nextTerminationStep(done: { step: TerminationStep }[]): TerminationStep | null {
  return TERMINATION_STEPS[done.length] ?? null;
}

/** The business case in force: the newest version. Older versions stay on the branch as history. */
export function latestBusinessCase(b: Pick<Branch, 'businessCases'>): BranchBusinessCase | null {
  const all = b.businessCases ?? [];
  return all.length ? all[all.length - 1] : null;
}

/**
 * Masterplan 145 "business case and 13-week cash at formation": what the forecast says week by week. The figures are
 * the company's own estimates, entered by company staff and reviewed by Finance; nothing here is a payment.
 */
export function cash13Summary(bc: Pick<BranchBusinessCase, 'openingCash' | 'cash13'>) {
  let bal = bc.openingCash;
  const weeks = bc.cash13.map((w) => {
    bal = r2(bal + w.inflow - w.outflow);
    return { week: w.week, inflow: w.inflow, outflow: w.outflow, closing: bal };
  });
  const lowest = weeks.reduce((m, w) => Math.min(m, w.closing), bc.openingCash);
  const firstShort = weeks.find((w) => w.closing < 0)?.week ?? null;
  return { weeks, lowest: r2(lowest), firstShortWeek: firstShort, closing: weeks.length ? weeks[weeks.length - 1].closing : bc.openingCash };
}

/** A ringgit amount with at most two decimals. */
export const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e11 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

/** Input problems with a business case, or null. Every amount is a ringgit figure with at most two decimals. */
export function businessCaseProblem(input: {
  sites: number;
  guards: number;
  monthlyBilling: number;
  monthlyCosts: number;
  startupCost: number;
  openingCash: number;
  fundingSource: string;
  assumptions: string;
  cash13: { week: number; inflow: number; outflow: number }[];
}): string | null {
  if (!Number.isInteger(input.sites) || input.sites < 0 || input.sites > 5000) return 'Give the number of sites expected (a whole number).';
  if (!Number.isInteger(input.guards) || input.guards < 0 || input.guards > 100000) return 'Give the number of guards expected (a whole number).';
  for (const [k, label] of [
    ['monthlyBilling', 'expected monthly billing'],
    ['monthlyCosts', 'expected monthly costs'],
    ['startupCost', 'start-up cost'],
    ['openingCash', 'opening cash'],
  ] as const)
    if (!isMoney(input[k]) || input[k] < 0) return `Give the ${label} in ringgit (0 or more, up to 2 decimals).`;
  if ((input.fundingSource ?? '').trim().length < 3) return 'Say where the start-up money comes from (e.g. company cash, or the PWVSB loan reference).';
  if ((input.assumptions ?? '').trim().length < 10) return 'Write the main assumptions (clients, rates, start date).';
  if (!Array.isArray(input.cash13) || input.cash13.length !== 13) return 'The cash forecast needs exactly 13 weeks.';
  for (let i = 0; i < 13; i++) {
    const w = input.cash13[i];
    if (!w || w.week !== i + 1) return 'Weeks must be numbered 1 to 13 in order.';
    if (!isMoney(w.inflow) || w.inflow < 0 || !isMoney(w.outflow) || w.outflow < 0) return `Week ${i + 1}: money in and money out must be 0 or more, up to 2 decimals.`;
  }
  return null;
}

/** Days after which a treasury figure is too old to rely on: the branch shows Unknown, never fine. Decided by Fauzan, 3 Nov 2026 07:42Z. */
export const TREASURY_STALE_DAYS = 3;

/**
 * Masterplan branch treasury: the latest figures Finance recorded from the bank statement, and what needs attention.
 * State is unknown when nothing recent is recorded. Prima records these figures; it never reads the bank or pays.
 */
export function treasuryView(days: BranchTreasuryDay[], floatLimit: number | null, today: IsoDate) {
  const sorted = [...days].sort((a, b) => a.on.localeCompare(b.on) || a.at.localeCompare(b.at));
  const latest = sorted[sorted.length - 1] ?? null;
  const ageDays = latest ? Math.round((Date.parse(today) - Date.parse(latest.on)) / 86_400_000) : null;
  const flags: string[] = [];
  if (!latest) flags.push('No bank balance recorded by Finance yet');
  else {
    if (ageDays! > TREASURY_STALE_DAYS) flags.push(`Last balance is ${ageDays} days old (from ${latest.on})`);
    const payrollSoon =
      latest.payrollDueOn && latest.payrollDueAmount != null && Math.round((Date.parse(latest.payrollDueOn) - Date.parse(today)) / 86_400_000) <= 7;
    const need = r2((payrollSoon ? latest.payrollDueAmount! : 0) + latest.paymentsDue7d);
    if (need > latest.bankBalance) flags.push(`Bank balance RM${latest.bankBalance.toFixed(2)} is below what is due in 7 days (RM${need.toFixed(2)})`);
    if (floatLimit != null && latest.floatHeld > floatLimit) flags.push(`Cash float RM${latest.floatHeld.toFixed(2)} is over the limit of RM${floatLimit.toFixed(2)}`);
    if (floatLimit == null) flags.push('No cash float limit set by the company manager');
  }
  const state: 'unknown' | 'attention' | 'ok' = !latest || ageDays! > TREASURY_STALE_DAYS ? 'unknown' : flags.length ? 'attention' : 'ok';
  return { state, latest, ageDays, flags, recent: sorted.slice(-7).reverse() };
}
