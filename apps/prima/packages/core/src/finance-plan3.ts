/**
 * Budget revisions and three-statement forecasts (masterplan section 08, items 76 and 78; Fauzan, 3 Nov 2026: "proceed work").
 *
 * Budget revisions: the approved budget itself is never changed. A revision is a new version that applies from an open month
 * onward; months before it keep the budget in force. Fauzan, 3 Nov 2026 ("Either is enough for both"): one approval, by the
 * Finance Director or the CEO, with a comment, by someone who did not draft or send it, puts a revision in force.
 *
 * Three-statement forecasts: a forecast profit and loss, balance sheet and cash-flow statement, linked so the cash flow is worked
 * out from the profit and the balance sheet movements and the closing cash ties to the balance sheet. Each forecast has a
 * scenario (base, downside, upside), written assumptions and a version. A person prepares it; the FD or the CEO (not the
 * preparer or sender) approves it with a comment once the opening balance sheet balances and, where reviewed SQL Account
 * figures exist for the opening month, agrees to them. Prima never approves anything by itself.
 *
 * JSONB on the existing `prima.fin_status` row (`plans[].revisions`, `plans[].threeStatements`); no migration.
 */
import { AccessDenied } from './access';
import type { FinActor } from './finance';
import { isLead, noSecrets, requireComment, requireReason, text } from './finance';
import { BadRequest, NotFound } from './service';
import { FIN_PLAN_LINES, type FinPlan, type FinPlanFigures, type FinPlanLine, type FinSign, type FinStatus, type Id } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;
const off = (n: number) => Math.abs(n) >= 0.005;

export interface FinPlan3Ctx {
  user: { id: Id; name: string };
  a: FinActor;
  /** The last closed month (YYYY-MM). */
  close: string;
  sign: (comment?: string) => FinSign;
}

// ---------- Budget revisions ----------

export interface FinBudgetRevision {
  no: number;
  /** The first month the revised figures apply (an open month of the plan year). Earlier months keep the budget in force. */
  fromMonth: string;
  /** Twelve months per line; months before `fromMonth` are copied from the budget in force when drafted. */
  months: FinPlanFigures;
  reason: string;
  status: 'draft' | 'submitted' | 'approved' | 'returned' | 'withdrawn';
  prepared: FinSign;
  authorIds: Id[];
  /** Which of the two approvers (FD, CEO) wrote or sent it; both never do (no two-author deadlock). */
  leadAuthors?: ('director' | 'ceo')[];
  /** An author withdrew it with a reason; a new revision can then be drafted. */
  withdrawn?: FinSign | null;
  submitted: FinSign | null;
  /** The approval, by the Finance Director or the CEO (either is enough; Fauzan, 3 Nov 2026), in the slot of whoever gave it. */
  fdApproved: FinSign | null;
  ceoApproved: FinSign | null;
  returned: FinSign | null;
}

/** The budget in force for each line and month: the approved budget, overridden by each approved revision from its month. */
export function finBudgetInForce(plan: FinPlan): FinPlanFigures {
  const out: FinPlanFigures = {};
  for (const l of FIN_PLAN_LINES) if (plan.budget.months[l]) out[l] = [...plan.budget.months[l]!];
  const approved = (plan.revisions ?? []).filter((r) => r.status === 'approved').sort((x, y) => x.no - y.no);
  for (const r of approved) {
    const from = Number(r.fromMonth.slice(5)) - 1;
    for (const l of FIN_PLAN_LINES) {
      const rev = r.months[l];
      if (!rev) continue;
      const base = out[l] ?? Array(12).fill(0);
      out[l] = base.map((v, i) => (i >= from ? rev[i] : v));
    }
  }
  return out;
}

const monthOf = (v: unknown, year: number): string => {
  const m = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequest('Give the month as YYYY-MM.');
  if (Number(m.slice(0, 4)) !== year) throw new BadRequest(`The revision applies from a month of ${year}.`);
  return m;
};

const amount = (v: unknown, what: string, negativeOk = false) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e11) throw new BadRequest(`${what}: give an amount in RM.`);
  if (!negativeOk && n < 0) throw new BadRequest(`${what} is not negative.`);
  return round2(n);
};

function revisedFigures(input: unknown, inForce: FinPlanFigures, fromIdx: number): FinPlanFigures {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequest('Give the revised amounts by line, 12 months each.');
  const out: FinPlanFigures = {};
  for (const [k, arr] of Object.entries(input as Record<string, unknown>)) {
    const line = FIN_PLAN_LINES.find((x) => x === k);
    if (!line) throw new BadRequest(`Unknown plan line "${k}".`);
    if (!Array.isArray(arr) || arr.length !== 12) throw new BadRequest(`Revised ${line}: 12 monthly amounts, January to December.`);
    const was = inForce[line] ?? Array(12).fill(0);
    // Months before the revision keep the budget in force, whatever was typed.
    out[line] = arr.map((n, i) => (i < fromIdx ? was[i] : amount(n, `Revised ${line} month ${i + 1}`, line === 'tax')));
  }
  if (!Object.keys(out).length) throw new BadRequest('Give at least one revised line.');
  const changed = Object.entries(out).some(([l, arr]) => arr!.some((v, i) => off(v - (inForce[l as FinPlanLine]?.[i] ?? 0))));
  if (!changed) throw new BadRequest('Nothing differs from the budget in force; a revision changes at least one amount.');
  return out;
}

/**
 * Two-author deadlock (Arisha main, 3 Nov 2026): the Finance Director and the CEO are the only approvers, and nobody approves
 * what they wrote. If both became authors of one record, nobody could approve it. So a change or send by one of them is refused
 * once the other is already an author; they return it with comments instead. Returns the record's lead authors after the step.
 */
export function finLeadAuthors(a: FinActor, leadAuthors: ('director' | 'ceo')[] | undefined, what: string): ('director' | 'ceo')[] {
  const now = leadAuthors ?? [];
  if (a.kind !== 'director' && a.kind !== 'ceo') return now;
  const other = a.kind === 'director' ? 'ceo' : 'director';
  if (now.includes(other))
    throw new BadRequest(
      `The ${other === 'ceo' ? 'CEO' : 'Finance Director'} already wrote this ${what}. If you change or send it too, neither the Finance Director nor the CEO could approve it: return it with your comments once it is sent, or ask the team to change it.`,
    );
  return [...new Set([...now, a.kind])];
}

/** The one revision that can still be acted on (draft, sent or returned); withdrawn, superseded and approved ones never are. */
export function finOpenRevision<R extends { status: string }>(revisions: R[]): R | null {
  return revisions.find((r) => r.status === 'draft' || r.status === 'submitted' || r.status === 'returned') ?? null;
}

export function finBudgetRevisionAction(
  ctx: FinPlan3Ctx,
  plan: FinPlan,
  action: string,
  input: Record<string, unknown>,
): { plan: FinPlan; summary: string; result: unknown } {
  const { a, user } = ctx;
  const revisions = plan.revisions ?? [];
  const open = finOpenRevision(revisions);
  const put = (r: FinBudgetRevision) => ({ ...plan, revisions: [...revisions.filter((x) => x.no !== r.no), r].sort((x, y) => x.no - y.no) });
  if (action === 'revise') {
    if (!['leader', 'deputy', 'director', 'ceo'].includes(a.kind))
      throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO drafts a budget revision)');
    if (plan.budget.status !== 'approved') throw new BadRequest(`The ${plan.year} budget is not approved yet; change the draft instead.`);
    if (open?.status === 'submitted') throw new BadRequest(`Revision ${open.no} is waiting for approval; it is approved or returned first.`);
    const fromMonth = monthOf(input.fromMonth, plan.year);
    if (fromMonth <= ctx.close) throw new BadRequest(`${fromMonth} has closed; a revision applies from an open month (after ${ctx.close}).`);
    const months = revisedFigures(input.months, finBudgetInForce(plan), Number(fromMonth.slice(5)) - 1);
    const reason = noSecrets(requireReason(input.reason, 'revise the budget (contracts won or lost, wage or rate changes)'), 'Reason');
    const leadAuthors = finLeadAuthors(a, open?.leadAuthors, 'revision');
    const r: FinBudgetRevision = open
      ? {
          ...open,
          fromMonth,
          months,
          reason,
          status: 'draft',
          prepared: ctx.sign(),
          authorIds: [...new Set([...open.authorIds, user.id])],
          leadAuthors,
          submitted: null,
          fdApproved: null,
          ceoApproved: null,
        }
      : {
          no: revisions.length + 1,
          fromMonth,
          months,
          reason,
          status: 'draft',
          prepared: ctx.sign(),
          authorIds: [user.id],
          leadAuthors,
          submitted: null,
          fdApproved: null,
          ceoApproved: null,
          returned: null,
        };
    return { plan: put(r), summary: `Budget ${plan.year} revision ${r.no} drafted from ${fromMonth}: ${reason}`, result: r };
  }
  if (action === 'submitRevision') {
    if (!['leader', 'deputy', 'director', 'ceo'].includes(a.kind))
      throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO sends a budget revision for approval)');
    if (!open || (open.status !== 'draft' && open.status !== 'returned')) throw new BadRequest('There is no draft revision to send.');
    if (open.status === 'returned') throw new BadRequest('Change the returned revision first (save it again), then send it.');
    if (open.fromMonth <= ctx.close) throw new BadRequest(`${open.fromMonth} has closed; save the revision again from an open month.`);
    const r: FinBudgetRevision = {
      ...open,
      status: 'submitted',
      submitted: ctx.sign(
        String(input.comment ?? '')
          .trim()
          .slice(0, 300),
      ),
      authorIds: [...new Set([...open.authorIds, user.id])],
      leadAuthors: finLeadAuthors(a, open.leadAuthors, 'revision'),
    };
    return { plan: put(r), summary: `Budget ${plan.year} revision ${r.no} sent to the Finance Director or the CEO for approval.`, result: r };
  }
  if (action === 'approveRevision' || action === 'returnRevision') {
    if (a.kind !== 'director' && a.kind !== 'ceo') throw new AccessDenied('view', '(the Finance Director or the CEO approves a budget revision)');
    const r = revisions.find((x) => x.no === Number(input.no));
    if (!r) throw new NotFound('Budget revision');
    if (r.status !== 'submitted') throw new BadRequest('That revision is not waiting for approval.');
    if (r.authorIds.includes(user.id) || r.submitted?.byId === user.id) throw new AccessDenied('view', '(nobody approves a revision they drafted or sent)');
    if (action === 'returnRevision') {
      const why = requireReason(input.comment, 'return the revision');
      const n: FinBudgetRevision = { ...r, status: 'returned', returned: ctx.sign(why), fdApproved: null, ceoApproved: null };
      return { plan: put(n), summary: `Budget ${plan.year} revision ${r.no} returned: ${why}`, result: n };
    }
    const slot = a.kind === 'director' ? 'fdApproved' : 'ceoApproved';
    if (r.fromMonth <= ctx.close) throw new BadRequest(`${r.fromMonth} closed while the revision waited; return it so it is redone from an open month.`);
    const c = requireComment(input.comment, 'approve the revision');
    const n: FinBudgetRevision = { ...r, [slot]: ctx.sign(c), status: 'approved' };
    return {
      plan: put(n),
      summary: `Budget ${plan.year} revision ${r.no} approved by the ${a.kind === 'director' ? 'Finance Director' : 'CEO'}, in force from ${n.fromMonth}: ${c}`,
      result: n,
    };
  }
  if (action === 'withdrawRevision') {
    // Recovery: an author ends a revision that is not yet approved (for example one written by both the FD and the CEO before
    // this rule); nothing is approved by it, and a fresh revision is drafted with its own authors.
    const r = revisions.find((x) => x.no === Number(input.no));
    if (!r) throw new NotFound('Budget revision');
    if (!['draft', 'submitted', 'returned'].includes(r.status)) throw new BadRequest('Only a revision not yet approved is withdrawn.');
    if (!r.authorIds.includes(user.id) && r.submitted?.byId !== user.id)
      throw new AccessDenied('view', '(only someone who wrote or sent the revision withdraws it)');
    const why = requireReason(input.comment, 'withdraw the revision');
    const n: FinBudgetRevision = { ...r, status: 'withdrawn', withdrawn: ctx.sign(why) };
    return { plan: put(n), summary: `Budget ${plan.year} revision ${r.no} withdrawn: ${why}`, result: n };
  }
  throw new BadRequest('Unknown budget revision action.');
}

// ---------- Three-statement forecasts ----------

export const FIN3_SCENARIOS = ['base', 'downside', 'upside'] as const;
export type Fin3Scenario = (typeof FIN3_SCENARIOS)[number];

export interface Fin3Opening {
  cash: number;
  receivables: number;
  inventory: number;
  fixedAssets: number;
  otherAssets: number;
  payables: number;
  borrowings: number;
  otherLiabilities: number;
  equity: number;
}
/** One forecast quarter: the profit and loss, investing and financing flows, and the closing working-capital balances. */
export interface Fin3Period {
  revenue: number;
  operatingCosts: number;
  depreciation: number;
  financeCost: number;
  tax: number;
  capex: number;
  /** Assets sold, at book value (the money received). */
  disposals: number;
  receivables: number;
  inventory: number;
  otherAssets: number;
  payables: number;
  otherLiabilities: number;
  borrowingsIn: number;
  borrowingsRepaid: number;
  dividends: number;
  equityIn: number;
}
export interface FinThreeStatement {
  id: string;
  kind: 'quarterly' | 'yearly';
  /** The closed month the forecast starts from (its opening balance sheet). */
  asOf: string;
  scenario: Fin3Scenario;
  version: number;
  assumptions: string;
  /** Where the opening balance sheet comes from (the SQL Account balance sheet filed). */
  openingSource: string;
  opening: Fin3Opening;
  periods: Fin3Period[];
  status: 'draft' | 'submitted' | 'approved' | 'returned' | 'superseded' | 'withdrawn';
  prepared: FinSign;
  authorIds: Id[];
  /** Which of the two approvers (FD, CEO) prepared or sent it; both never do (no two-author deadlock). */
  leadAuthors?: ('director' | 'ceo')[];
  withdrawn?: FinSign | null;
  submitted: FinSign | null;
  approved: FinSign | null;
  returned: FinSign | null;
}

const OPENING_KEYS: (keyof Fin3Opening)[] = [
  'cash',
  'receivables',
  'inventory',
  'fixedAssets',
  'otherAssets',
  'payables',
  'borrowings',
  'otherLiabilities',
  'equity',
];
const PERIOD_KEYS: (keyof Fin3Period)[] = [
  'revenue',
  'operatingCosts',
  'depreciation',
  'financeCost',
  'tax',
  'capex',
  'disposals',
  'receivables',
  'inventory',
  'otherAssets',
  'payables',
  'otherLiabilities',
  'borrowingsIn',
  'borrowingsRepaid',
  'dividends',
  'equityIn',
];
/** Lines that may be negative: equity (accumulated losses), cash (overdrawn), tax (a credit). */
const NEGATIVE_OK = new Set<string>(['equity', 'cash', 'tax']);

const addMonths = (p: string, n: number) => {
  const t = Number(p.slice(0, 4)) * 12 + Number(p.slice(5)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
/** The quarter ends a forecast covers: the next quarter end after `asOf`, then every three months. */
export const fin3Quarters = (asOf: string, n: number) => {
  const m = Number(asOf.slice(5));
  const first = addMonths(asOf, m % 3 === 0 ? 3 : 3 - (m % 3));
  return Array.from({ length: n }, (_, i) => addMonths(first, i * 3));
};

export interface Fin3Row {
  quarterEnd: string;
  pl: { revenue: number; operatingCosts: number; depreciation: number; financeCost: number; tax: number; profit: number };
  cf: { operating: number; investing: number; financing: number; opening: number; closing: number };
  bs: Fin3Opening & { assets: number; liabilities: number; difference: number };
}
export interface Fin3Result {
  openingDifference: number;
  rows: Fin3Row[];
  /** Every check that stops approval, in plain words. */
  problems: string[];
  /** Quarters where the forecast cash goes below zero. */
  shortfalls: string[];
  /** The opening against the reviewed SQL Account figures for the month, when there are any. */
  ledger: {
    period: string;
    cash: number;
    assets: number;
    liabilities: number;
    equity: number;
    differences: { cash: number; assets: number; liabilities: number; equity: number };
  } | null;
}

/** Works the three statements out from the inputs: the cash flow from the profit and the balance sheet movements. */
export function fin3Compute(fc: Pick<FinThreeStatement, 'asOf' | 'opening' | 'periods'>, f?: FinStatus): Fin3Result {
  const o = fc.opening;
  const assets0 = o.cash + o.receivables + o.inventory + o.fixedAssets + o.otherAssets;
  const liab0 = o.payables + o.borrowings + o.otherLiabilities;
  const openingDifference = round2(assets0 - liab0 - o.equity);
  const problems: string[] = [];
  if (off(openingDifference))
    problems.push(`The opening balance sheet does not balance: assets less liabilities less equity is RM${openingDifference.toFixed(2)}.`);
  const quarters = fin3Quarters(fc.asOf, fc.periods.length);
  const rows: Fin3Row[] = [];
  let prev = { ...o };
  fc.periods.forEach((p, i) => {
    const profit = round2(p.revenue - p.operatingCosts - p.depreciation - p.financeCost - p.tax);
    const fixedAssets = round2(prev.fixedAssets + p.capex - p.depreciation - p.disposals);
    const borrowings = round2(prev.borrowings + p.borrowingsIn - p.borrowingsRepaid);
    const equity = round2(prev.equity + profit - p.dividends + p.equityIn);
    if (fixedAssets < -0.005) problems.push(`${quarters[i]}: depreciation and disposals are more than the fixed assets (RM${fixedAssets.toFixed(2)}).`);
    if (borrowings < -0.005) problems.push(`${quarters[i]}: more borrowings repaid than owed (RM${borrowings.toFixed(2)}).`);
    const operating = round2(
      profit +
        p.depreciation -
        (p.receivables - prev.receivables) -
        (p.inventory - prev.inventory) -
        (p.otherAssets - prev.otherAssets) +
        (p.payables - prev.payables) +
        (p.otherLiabilities - prev.otherLiabilities),
    );
    const investing = round2(-p.capex + p.disposals);
    const financing = round2(p.borrowingsIn - p.borrowingsRepaid + p.equityIn - p.dividends);
    const cash = round2(prev.cash + operating + investing + financing);
    const next: Fin3Opening = {
      cash,
      receivables: p.receivables,
      inventory: p.inventory,
      fixedAssets,
      otherAssets: p.otherAssets,
      payables: p.payables,
      borrowings,
      otherLiabilities: p.otherLiabilities,
      equity,
    };
    const assets = round2(cash + p.receivables + p.inventory + fixedAssets + p.otherAssets);
    const liabilities = round2(p.payables + borrowings + p.otherLiabilities);
    const difference = round2(assets - liabilities - equity);
    if (off(difference) && !off(openingDifference)) problems.push(`${quarters[i]}: the forecast balance sheet does not balance (RM${difference.toFixed(2)}).`);
    rows.push({
      quarterEnd: quarters[i],
      pl: { revenue: p.revenue, operatingCosts: p.operatingCosts, depreciation: p.depreciation, financeCost: p.financeCost, tax: p.tax, profit },
      cf: { operating, investing, financing, opening: prev.cash, closing: cash },
      bs: { ...next, assets, liabilities, difference },
    });
    prev = next;
  });
  const shortfalls = rows.filter((r) => r.bs.cash < -0.005).map((r) => r.quarterEnd);
  const lf = (f?.ledgerFigures ?? []).find((x) => x.period === fc.asOf && x.reviewed);
  let ledger: Fin3Result['ledger'] = null;
  if (lf) {
    // Review finding (Arisha main, 3 Nov 2026): totals alone let cash be moved against another asset, so the opening cash is
    // also tied to the reviewed balance sheet cash (FS-05's cf.bsCash), at saving, sending and approval.
    const d = {
      cash: round2(o.cash - lf.cf.bsCash),
      assets: round2(assets0 - lf.bs.assets),
      liabilities: round2(liab0 - lf.bs.liabilities),
      equity: round2(o.equity - lf.bs.equity),
    };
    ledger = { period: lf.period, cash: lf.cf.bsCash, assets: lf.bs.assets, liabilities: lf.bs.liabilities, equity: lf.bs.equity, differences: d };
    if (off(d.assets) || off(d.liabilities) || off(d.equity))
      problems.push(
        `The opening does not agree to the reviewed SQL Account balance sheet for ${lf.period} (assets RM${d.assets.toFixed(2)}, liabilities RM${d.liabilities.toFixed(2)}, equity RM${d.equity.toFixed(2)} apart).`,
      );
    if (off(d.cash))
      problems.push(
        `The opening cash RM${o.cash.toFixed(2)} does not agree to the reviewed SQL Account balance sheet cash for ${lf.period} (RM${lf.cf.bsCash.toFixed(2)}, RM${d.cash.toFixed(2)} apart).`,
      );
  }
  return { openingDifference, rows, problems, shortfalls, ledger };
}

function readOpening(v: unknown): Fin3Opening {
  if (!v || typeof v !== 'object') throw new BadRequest('Give the opening balance sheet.');
  const x = v as Record<string, unknown>;
  return Object.fromEntries(OPENING_KEYS.map((k) => [k, amount(x[k] ?? 0, `Opening ${k}`, NEGATIVE_OK.has(k))])) as unknown as Fin3Opening;
}
function readPeriods(v: unknown): Fin3Period[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 8) throw new BadRequest('Give 1 to 8 forecast quarters.');
  return v.map((p, i) => {
    if (!p || typeof p !== 'object') throw new BadRequest(`Quarter ${i + 1}: give its figures.`);
    const x = p as Record<string, unknown>;
    return Object.fromEntries(PERIOD_KEYS.map((k) => [k, amount(x[k] ?? 0, `Quarter ${i + 1} ${k}`, NEGATIVE_OK.has(k))])) as unknown as Fin3Period;
  });
}

export function finThreeStatementAction(
  ctx: FinPlan3Ctx & { reviewer: boolean },
  f: FinStatus,
  plan: FinPlan,
  action: string,
  input: Record<string, unknown>,
): { plan: FinPlan; summary: string; result: unknown } {
  const { a, user } = ctx;
  const list = plan.threeStatements ?? [];
  const put = (x: FinThreeStatement, extra: FinThreeStatement[] = []) => ({
    ...plan,
    threeStatements: [...list.filter((y) => y.id !== x.id && !extra.some((e) => e.id === y.id)), ...extra, x],
  });
  if (action === 'fc3Save') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO prepares a three-statement forecast)');
    const kind = input.kind === 'yearly' ? 'yearly' : input.kind == null || input.kind === 'quarterly' ? 'quarterly' : null;
    if (!kind) throw new BadRequest('A forecast is quarterly or yearly.');
    const asOf = typeof input.asOf === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.asOf) ? input.asOf : null;
    if (!asOf) throw new BadRequest('Give the month the forecast starts from (YYYY-MM).');
    if (asOf > ctx.close) throw new BadRequest('A forecast starts from a month that has closed (its balance sheet is known).');
    if (kind === 'quarterly' && Number(asOf.slice(5)) % 3 !== 0)
      throw new BadRequest('A quarterly forecast starts from a quarter end (March, June, September or December).');
    const scenario = FIN3_SCENARIOS.find((s) => s === (input.scenario ?? 'base'));
    if (!scenario) throw new BadRequest('The scenario is base, downside or upside.');
    const assumptions = noSecrets(
      text(input.assumptions, 'Assumptions (guards and sites, rates, collection days, capital spending, loans)', 10, 3000),
      'Assumptions',
    );
    const openingSource = noSecrets(text(input.openingSource, 'The SQL Account balance sheet the opening comes from', 3, 300), 'Opening source');
    const opening = readOpening(input.opening);
    const periods = readPeriods(input.periods);
    const same = list.filter((x) => x.kind === kind && x.asOf === asOf && x.scenario === scenario);
    const open = same.find((x) => x.status === 'draft' || x.status === 'returned' || x.status === 'submitted');
    if (open?.status === 'submitted') throw new BadRequest(`Version ${open.version} is waiting for approval; it is approved or returned first.`);
    const version = open ? open.version : Math.max(0, ...same.map((x) => x.version)) + 1;
    const x: FinThreeStatement = {
      id: open?.id ?? `fc3-${plan.year}-${kind}-${asOf}-${scenario}-v${version}`,
      kind,
      asOf,
      scenario,
      version,
      assumptions,
      openingSource,
      opening,
      periods,
      status: 'draft',
      prepared: ctx.sign(),
      authorIds: [...new Set([...(open?.authorIds ?? []), user.id])],
      leadAuthors: finLeadAuthors(a, open?.leadAuthors, 'forecast'),
      submitted: null,
      approved: null,
      returned: open?.returned ?? null,
    };
    const r = fin3Compute(x, f);
    return {
      plan: put(x),
      summary: `Three-statement forecast ${plan.year} (${kind}, ${scenario}, as of ${asOf}, version ${version}) saved${r.problems.length ? `; ${r.problems.length} check(s) to fix` : ''}.`,
      result: { ...x, computed: r },
    };
  }
  const x = list.find((y) => y.id === input.id);
  if (!x) throw new NotFound('Three-statement forecast');
  if (action === 'fc3Submit') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO sends a forecast for approval)');
    if (x.status !== 'draft') throw new BadRequest('Only a saved draft is sent; save a returned forecast again first.');
    const r = fin3Compute(x, f);
    if (r.problems.length) throw new BadRequest(`Fix the checks first: ${r.problems.join(' ')}`);
    const n: FinThreeStatement = {
      ...x,
      status: 'submitted',
      submitted: ctx.sign(
        String(input.comment ?? '')
          .trim()
          .slice(0, 300),
      ),
      authorIds: [...new Set([...x.authorIds, user.id])],
      leadAuthors: finLeadAuthors(a, x.leadAuthors, 'forecast'),
    };
    return { plan: put(n), summary: `Three-statement forecast ${x.id} sent for approval.`, result: n };
  }
  if (action === 'fc3Approve' || action === 'fc3Return') {
    if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO approves a three-statement forecast)');
    if (x.status !== 'submitted') throw new BadRequest('That forecast is not waiting for approval.');
    if (x.authorIds.includes(user.id) || x.submitted?.byId === user.id) throw new AccessDenied('view', '(nobody approves a forecast they prepared or sent)');
    if (action === 'fc3Return') {
      const why = requireReason(input.comment, 'return the forecast');
      const n: FinThreeStatement = { ...x, status: 'returned', returned: ctx.sign(why) };
      return { plan: put(n), summary: `Three-statement forecast ${x.id} returned: ${why}`, result: n };
    }
    const r = fin3Compute(x, f);
    if (r.problems.length) throw new BadRequest(`It cannot be approved: ${r.problems.join(' ')}`);
    const c = requireComment(input.comment, 'approve the forecast');
    const n: FinThreeStatement = { ...x, status: 'approved', approved: ctx.sign(c) };
    // The approved version replaces the earlier approved one for the same start, kind and scenario.
    const superseded = list
      .filter((y) => y.id !== x.id && y.status === 'approved' && y.kind === x.kind && y.asOf === x.asOf && y.scenario === x.scenario)
      .map((y) => ({ ...y, status: 'superseded' as const }));
    return { plan: put(n, superseded), summary: `Three-statement forecast ${x.id} approved: ${c}`, result: n };
  }
  if (action === 'fc3Withdraw') {
    if (!['draft', 'submitted', 'returned'].includes(x.status)) throw new BadRequest('Only a forecast not yet approved is withdrawn.');
    if (!x.authorIds.includes(user.id) && x.submitted?.byId !== user.id)
      throw new AccessDenied('view', '(only someone who prepared or sent the forecast withdraws it)');
    const why = requireReason(input.comment, 'withdraw the forecast');
    const n: FinThreeStatement = { ...x, status: 'withdrawn', withdrawn: ctx.sign(why) };
    return { plan: put(n), summary: `Three-statement forecast ${x.id} withdrawn: ${why}`, result: n };
  }
  throw new BadRequest('Unknown three-statement forecast action.');
}

/** What the Budget panel shows: the budget in force, revisions, and each three-statement forecast worked out. */
export function finPlan3View(f: FinStatus, plan: FinPlan | null) {
  if (!plan) return { inForce: null, revisions: [], threeStatements: [] };
  return {
    inForce: finBudgetInForce(plan),
    revisions: plan.revisions ?? [],
    threeStatements: [...(plan.threeStatements ?? [])]
      .sort((x, y) => y.asOf.localeCompare(x.asOf) || x.scenario.localeCompare(y.scenario) || y.version - x.version)
      .map((x) => ({ ...x, computed: fin3Compute(x, f) })),
  };
}
