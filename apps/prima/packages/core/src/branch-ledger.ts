import type { Branch } from "./types";
import type { BranchAccount } from "./types";
import type { BranchPurchase } from "./types";
import type { StaffPayRun } from "./types";
import type { BranchBusinessCase } from "./types";
import type { BranchSettlement } from "./types";
import type { BranchSettlementLine } from "./types";
import type { BranchTreasuryDay } from "./types";
import type { Company } from "./types";
import type { IsoDate } from "./types";
import { agreementOn } from "./branches";
import type { BranchApprovalPolicy } from "./types";
import type { BranchApprovalRule } from "./types";



// Masterplan chapter 03 (V11, V12, V12.1): a branch is inside its licensed company. These helpers keep the parts of
// the chapter that are pure rules: what a branch needs before it is activated, what a month's settlement is made of,
// and which account kinds may carry company money. Nothing here posts to SQL Account, moves money or files with KDN.

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cost kinds a branch month may carry. Model C's net profit is billing less every one of them. */
export const BRANCH_COST_KINDS = [
  'wages',
  'manager_salary',
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
  manager_salary: 'Branch Manager salary (Model B, or Model C when set)',
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
  // A Model B manager's salary is a wage: it sits in the wages bucket, with its own line kind so it can be checked.
  const wages = r2(byKind.wages + byKind.manager_salary);
  const statutory = r2(byKind.statutory);
  const other = r2(BRANCH_COST_KINDS.filter((k) => k !== 'wages' && k !== 'manager_salary' && k !== 'statutory').reduce((n, k) => n + byKind[k], 0));
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

// ---------- JV branch purchases and staff (Fauzan, 4 Nov 2026) ----------

/** Models where the Branch Manager shares the result (JV): A (share of billing) and C (share of net profit). */
export const JV_MODELS = ['A', 'C'] as const;

/** Whether a branch is a JV branch on a date: its agreement in force is Model A or C. */
export function isJvBranch(b: Pick<Branch, 'agreements' | 'model'>, on: IsoDate): boolean {
  const a = agreementOn(b.agreements, on);
  return (JV_MODELS as readonly string[]).includes(a?.model ?? b.model);
}

/** Cost kinds a branch purchase may be: what is bought, never wages, levies, fees, provisions or write-offs. */
export const BRANCH_PURCHASE_KINDS = ['equipment', 'transport', 'hostel', 'insurance', 'subcontract', 'other'] as const;
export type BranchPurchaseKind = (typeof BRANCH_PURCHASE_KINDS)[number];

/** Firearms and ammunition are licensed under the Arms Act 1960: they go through Arms Control, never a branch purchase. */
const ARMS = /\b(fire ?arms?|guns?|pistols?|revolvers?|shotguns?|rifles?|ammo|ammunition|cartridges?|bullets?|peluru|senjata( api)?|senapang|pistol)\b/i;
export function isArmsItem(text: string): boolean {
  return ARMS.test(text);
}

/** A month's purchases as settlement lines, citing each supplier invoice. */
export function purchaseLines(purchases: BranchPurchase[] | undefined, period: string): BranchSettlementLine[] {
  return (purchases ?? [])
    .filter((p) => purchaseCounts(p) && p.on.slice(0, 7) === period)
    .map((p) => ({ kind: p.kind, ref: p.invoiceRef, siteId: null, amount: p.amount, note: `${p.category === 'expense' ? 'Expense, ' : ''}${p.supplier}: ${p.item}`.slice(0, 200) }));
}

/** Pay for one branch's staff from the company's staff pay run: wages (gross) and the employer's statutory share. */
export function branchStaffPay(run: StaffPayRun | null, personIds: Set<string>) {
  if (!run) return null;
  const lines = run.lines.filter((l) => personIds.has(l.personId));
  const wages = r2(lines.reduce((t, l) => t + l.gross, 0));
  const statutory = r2(lines.reduce((t, l) => t + l.epfEr + l.socsoEr + l.eisEr + l.hrd, 0));
  return { runId: run.id, period: run.period, stage: run.stage, people: lines.length, wages, statutory, lines };
}

/** Settlement lines for a branch's staff pay, when the company's staff pay run for the month is approved or paid. */
export function staffPayLines(pay: ReturnType<typeof branchStaffPay>): BranchSettlementLine[] {
  if (!pay || !pay.people) return [];
  const out: BranchSettlementLine[] = [];
  if (pay.wages > 0) out.push({ kind: 'wages', ref: pay.runId, siteId: null, amount: pay.wages, note: `Branch staff pay, ${pay.people} staff (Prima staff payroll)` });
  if (pay.statutory > 0) out.push({ kind: 'statutory', ref: `${pay.runId}-ER`, siteId: null, amount: pay.statutory, note: 'Employer EPF, SOCSO, EIS and HRD for branch staff' });
  return out;
}

/** Add lines the month must carry that the preparer has not already listed (same kind and reference). */
export function withAutoLines(lines: BranchSettlementLine[], auto: BranchSettlementLine[]): BranchSettlementLine[] {
  const key = (l: BranchSettlementLine) => `${l.kind}|${l.ref.trim().toUpperCase()}`;
  const have = new Set(lines.map(key));
  return [...lines, ...auto.filter((l) => !have.has(key(l)))];
}

// ---------- Low profit flag (Fauzan, 4 Nov 2026: "Flag to ceo if pnl is less than 10% from billing") ----------

/** A branch month whose profit (billing less all branch costs, before the company's share) is under this % of billing. */
export const BRANCH_LOW_MARGIN_PCT = 10;

/** The month's profit as a % of billing. A month with costs and no billing is low; a month with neither is not. */
export function branchMargin(s: Pick<BranchSettlement, 'billing' | 'costs'>) {
  const costs = r2(s.costs.wages + s.costs.statutory + s.costs.other);
  const net = r2(s.billing - costs);
  const raw = s.billing > 0 ? (net / s.billing) * 100 : null;
  const pct = raw == null ? null : Math.round(raw * 10) / 10;
  // Compared before rounding, so 9.96% is still under 10%.
  const low = raw == null ? costs > 0 : raw < BRANCH_LOW_MARGIN_PCT;
  return { billing: s.billing, costs, net, pct, low };
}

/** Months counted for the flag: settled ones, and drafts prepared from lines. Older test rows with no lines are not. */
export function marginCounts(s: Pick<BranchSettlement, 'status' | 'lines'>): boolean {
  return isSettled(s) || ((s.status === 'draft' || s.status === 'returned') && !!s.lines?.length);
}

/** The management fee % a CEO setting may change: Model A (of billing) and Model C (of net profit) only. */
export function feePctOf(a: { model: string; companyBillingSharePct: number | null; companyNetProfitSharePct: number | null } | null): number | null {
  if (!a) return null;
  return a.model === 'A' ? a.companyBillingSharePct : a.model === 'C' ? a.companyNetProfitSharePct : null;
}

/**
 * Whether a purchase counts in the branch P&L: a JV purchase always (no approval step); a Model B purchase only once
 * the company approved it and the supplier invoice is recorded. A request, an approved-not-bought or a refused one never.
 */
export function purchaseCounts(p: Pick<BranchPurchase, 'approval'>): boolean {
  return !p.approval || p.approval.status === 'bought';
}

// ---------- Model B: salaried Branch Manager (V12: company-run, salary only, every matter company-approved first) ----

/** Whether a branch is Model B (salaried Branch Manager) on a date: its agreement in force says so. */
export function isSalariedBranch(b: Pick<Branch, 'agreements' | 'model'>, on: IsoDate): boolean {
  const a = agreementOn(b.agreements, on);
  return (a?.model ?? b.model) === 'B';
}

/**
 * Model B month: the salary the month carries against the signed monthly salary. A month without the salary line is
 * incomplete. A difference is allowed (part month, unpaid leave, an increment waiting for a new agreement version) only
 * with a note from the preparer; it never changes the signed salary.
 */
export function managerSalaryCheck(signed: number | null, lines: BranchSettlementLine[]) {
  const paid = r2(lines.filter((l) => l.kind === 'manager_salary').reduce((t, l) => t + l.amount, 0));
  const has = lines.some((l) => l.kind === 'manager_salary');
  return { signed, paid, has, differs: signed != null && has && Math.abs(paid - signed) >= 0.005, diff: signed == null ? null : r2(paid - signed) };
}

/**
 * Split a branch's staff pay into the Model B manager's own salary and everyone else's pay, so the manager's salary is
 * cited on its own line and never counted twice.
 */
export function managerPayLines(pay: ReturnType<typeof branchStaffPay>, managerPersonId: string | null): BranchSettlementLine[] {
  if (!pay || !managerPersonId) return [];
  const l = pay.lines.find((x) => x.personId === managerPersonId);
  if (!l || !(l.gross > 0)) return [];
  const out: BranchSettlementLine[] = [{ kind: 'manager_salary', ref: `${pay.runId}-BM`, siteId: null, amount: r2(l.gross), note: 'Branch Manager salary (Prima staff payroll)' }];
  const er = r2(l.epfEr + l.socsoEr + l.eisEr + l.hrd);
  if (er > 0) out.push({ kind: 'statutory', ref: `${pay.runId}-BM-ER`, siteId: null, amount: er, note: 'Employer EPF, SOCSO, EIS and HRD for the Branch Manager' });
  return out;
}

// ---------- Model B approval style, set by the Finance Director (Fauzan, 5 Nov 2026) ----------

/** The default style: the company manager consents, then the Finance Director or the CEO approves; the FD decides payouts. */
export const DEFAULT_BRANCH_APPROVAL: Pick<BranchApprovalPolicy, 'purchase' | 'expense' | 'payout'> = {
  purchase: { consent: 'company_manager', approver: 'fd_or_ceo', noApprovalUpTo: 0 },
  expense: { consent: 'company_manager', approver: 'fd_or_ceo', noApprovalUpTo: 0 },
  payout: 'fd',
};

export const BRANCH_APPROVER_LABEL: Record<BranchApprovalRule['approver'], string> = {
  fd_or_ceo: 'Finance Director or CEO',
  fd: 'Finance Director',
  ceo: 'CEO',
  company_manager: 'Company manager',
};

/** The style in force for a branch: its own setting, or the default. */
export function approvalPolicyOf(b: Pick<Branch, 'approvalPolicy'>): Pick<BranchApprovalPolicy, 'purchase' | 'expense' | 'payout'> {
  return b.approvalPolicy ?? DEFAULT_BRANCH_APPROVAL;
}

/** Problems with a rule, or null. The same person can never both consent and approve, so a company manager approver needs no consent step. */
export function approvalRuleProblem(r: BranchApprovalRule, what: string): string | null {
  if (!['company_manager', 'none'].includes(r?.consent)) return `${what}: choose the consent step (company manager or none).`;
  if (!['fd_or_ceo', 'fd', 'ceo', 'company_manager'].includes(r?.approver)) return `${what}: choose who approves.`;
  if (r.consent === 'company_manager' && r.approver === 'company_manager') return `${what}: the company manager approves, so choose no separate consent step.`;
  if (!isMoney(r.noApprovalUpTo) || r.noApprovalUpTo < 0) return `${what}: give the no-approval limit in ringgit (0 when every request needs approval).`;
  return null;
}