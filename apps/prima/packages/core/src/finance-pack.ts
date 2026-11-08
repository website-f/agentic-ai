import { AccessDenied } from "./access";
import { requireComment } from "./finance";
import type { FinActor } from "./finance";
import { finCash13 } from "./finance-forecast13";
import { finIcPairs } from "./finance-intercompany";
import { finRegularDues } from "./finance-regular";
import { finRegularExpected } from "./finance-regular";
import { BadRequest } from "./service";
import type { Contract } from "./types";
import type { FinPlanLine } from "./types";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { StaffPayRun } from "./types";


const round2 = (n: number) => Math.round(n * 100) / 100;
const COST_LINES: FinPlanLine[] = [
  'guard_cost',
  'staff_cost',
  'statutory',
  'premises',
  'vehicles',
  'equipment',
  'insurance',
  'other_opex',
  'finance_cost',
  'tax',
];
/** Costs shared across sites per guard (Fauzan, 1 Nov 2026: shared costs per guard). */
const SHARED_LINES: FinPlanLine[] = ['staff_cost', 'premises', 'vehicles', 'equipment', 'insurance', 'other_opex'];

export interface FinPackReview {
  period: string;
  sign: FinSign;
  /** The figures as reviewed, kept for the board. */
  snapshot: FinPackData;
}

export type FinPackData = ReturnType<typeof finPackData>;

function monthIndex(period: string) {
  return Number(period.slice(5, 7)) - 1;
}
const daysIn = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Profit for the month and the year to date, against the approved budget. */
function profitOf(f: FinStatus, period: string) {
  const year = Number(period.slice(0, 4));
  const plan = (f.plans ?? []).find((p) => p.year === year);
  if (!plan) return null;
  const i = monthIndex(period);
  const act = (line: FinPlanLine, k: number) => plan.actuals[line]?.[k] ?? null;
  const bud = (line: FinPlanLine, k: number) => (plan.budget.status === 'approved' ? (plan.budget.months[line]?.[k] ?? 0) : null);
  const sum = (get: (l: FinPlanLine, k: number) => number | null, lines: FinPlanLine[], ks: number[]) => {
    let n = 0;
    for (const l of lines)
      for (const k of ks) {
        const v = get(l, k);
        if (v == null) return null;
        n += v;
      }
    return round2(n);
  };
  const block = (ks: number[]) => {
    const revenue = sum(act, ['revenue'], ks);
    const costs = sum(act, COST_LINES, ks);
    const bRevenue = sum(bud, ['revenue'], ks);
    const bCosts = sum(bud, COST_LINES, ks);
    return {
      revenue,
      costs,
      profit: revenue != null && costs != null ? round2(revenue - costs) : null,
      budgetRevenue: bRevenue,
      budgetCosts: bCosts,
      budgetProfit: bRevenue != null && bCosts != null ? round2(bRevenue - bCosts) : null,
    };
  };
  return { month: block([i]), ytd: block(Array.from({ length: i + 1 }, (_, k) => k)), budgetApproved: plan.budget.status === 'approved' };
}

export interface FinPackInput {
  period: string;
  today: IsoDate;
  contracts: Contract[];
  /** PWVSB's row (intercompany loans). */
  group: FinStatus | null | undefined;
  runs: StaffPayRun[];
  nameOf: (id: Id) => string;
  /** Close exceptions still open for the month, worked out by the caller. */
  openExceptions: number;
}

/** Everything in the pack, worked out from Finance's own records. */
export function finPackData(f: FinStatus, x: FinPackInput) {
  const { period, today } = x;
  const close = (f.closes ?? []).find((c) => c.period === period) ?? null;
  const profit = profitOf(f, period);
  // Cash: each bank's statement closing for the month.
  const banks = f.banks.map((b) => {
    const st = (f.statements ?? []).find((s) => s.bankId === b.id && s.period === period);
    return { bank: `${b.bank} ${b.accountMasked}`, closing: st ? st.closing : null };
  });
  const cashKnown = banks.filter((b) => b.closing != null);
  const c13 = finCash13(f, x.runs, today);
  // Invoices over 90 days.
  const age = (f.ageing ?? []).find((a) => a.period === period) ?? null;
  const arTotal = age ? round2(age.ar.current + age.ar.d1to30 + age.ar.d31to60 + age.ar.d61to90 + age.ar.over90) : null;
  const openCases = (f.arCases ?? []).filter((c) => !['closed', 'reissued', 'written_off', 'recovered'].includes(c.status)).length;
  // Loans and hire purchase: instalment and what is left on the list after this month (an estimate from the schedule).
  const periodEnd = `${period}-${String(daysIn(period)).padStart(2, '0')}`;
  const loans = (f.regular ?? [])
    .filter((r) => r.status === 'active' && (r.kind === 'loan' || r.kind === 'hire_purchase'))
    .map((r) => {
      const left = r.lastDue
        ? finRegularDues({ ...r, firstDue: periodEnd > r.firstDue ? periodEnd : r.firstDue }, r.lastDue).filter((d) => d.dueOn > periodEnd)
        : [];
      const instalment = r.amount ?? (left[0] ? finRegularExpected(r, left[0]) : null);
      return {
        name: r.name,
        kind: r.kind,
        instalment,
        lastDue: r.lastDue ?? null,
        remaining: left.length,
        outstandingEstimate: instalment != null && r.lastDue ? round2(instalment * left.length) : null,
      };
    });
  const icLoans = x.group
    ? finIcPairs(x.group, period)
        .filter((p) => p.kind === 'loan' && (p.a === f.companyId || p.b === f.companyId))
        .map((p) => {
          const mine = p.a === f.companyId ? p.aEntry : p.bEntry;
          const other = p.a === f.companyId ? p.b : p.a;
          return { with: x.nameOf(other), balance: mine?.balance ?? null, status: p.status };
        })
    : [];
  // Collateral held by banks and insurers.
  const collateral = (f.guarantees ?? [])
    .filter((g) => g.collateral > 0 && !g.refund && !['ended', 'called', 'pending'].includes(g.status))
    .map((g) => ({
      kind: g.kind,
      issuer: g.issuer,
      number: g.number,
      beneficiary: g.beneficiary,
      collateral: g.collateral,
      status: g.status,
      expiresOn: g.expiresOn,
    }));
  // Health numbers.
  const plan = (f.plans ?? []).find((p) => p.year === Number(period.slice(0, 4)));
  const i = monthIndex(period);
  const revMonth = plan?.actuals.revenue?.[i] ?? null;
  const rev3 = plan ? [i - 2, i - 1, i].filter((k) => k >= 0).map((k) => plan.actuals.revenue?.[k] ?? null) : [];
  const rev3Known = rev3.length && rev3.every((v) => v != null) ? (rev3 as number[]) : null;
  const daysToCollect =
    arTotal != null && rev3Known && rev3Known.reduce((n, v) => n + v, 0) > 0
      ? Math.round((arTotal / rev3Known.reduce((n, v) => n + v, 0)) * rev3Known.length * 30.4)
      : null;
  const pay = plan ? [plan.actuals.guard_cost?.[i], plan.actuals.staff_cost?.[i], plan.actuals.statutory?.[i]] : [];
  const payroll = pay.length && pay.every((v) => v != null) ? (pay as number[]).reduce((n, v) => n + v, 0) : null;
  const payrollPct = payroll != null && revMonth ? round2((payroll / revMonth) * 100) : null;
  // Profit per site: the contract's money for the month (collected where Prima knows it, else billed) less its guards'
  // cost and the shared costs per guard (Fauzan, 1 Nov 2026).
  const running = x.contracts.filter((c) => c.companyId === f.companyId && c.startOn <= periodEnd && (!c.endOn || c.endOn >= `${period}-01`));
  const guardsOf = (c: Contract) =>
    (c.versions[c.versions.length - 1]?.posts ?? []).reduce((n, p) => n + p.guards * Math.max(1, Math.round((p.hoursPerDay || 12) / 12)), 0);
  const totalGuards = running.reduce((n, c) => n + guardsOf(c), 0);
  const costLines = plan ? (['guard_cost', 'statutory', ...SHARED_LINES] as FinPlanLine[]).map((l) => plan.actuals[l]?.[i] ?? null) : [];
  const costPool = costLines.length && costLines.every((v) => v != null) ? (costLines as number[]).reduce((n, v) => n + v, 0) : null;
  const perGuard = costPool != null && totalGuards > 0 ? costPool / totalGuards : null;
  const sites = running
    .map((c) => {
      const collected = (f.govtClaims ?? [])
        .filter((g) => g.contractId === c.id && g.paid && g.paid.date.slice(0, 7) === period)
        .reduce((n, g) => n + (g.paid?.amount ?? 0), 0);
      const billed = (f.billing ?? []).find((b) => b.contractId === c.id && b.period === period)?.invoice?.amount ?? null;
      const revenue = collected > 0 ? round2(collected) : billed;
      const guards = guardsOf(c);
      const cost = perGuard != null ? round2(perGuard * guards) : null;
      return {
        contractId: c.id,
        contractRef: c.ref,
        client: c.clientName,
        guards,
        revenue,
        basis: collected > 0 ? ('collected' as const) : billed != null ? ('billed' as const) : null,
        cost,
        profit: revenue != null && cost != null ? round2(revenue - cost) : null,
      };
    })
    .sort((a, b) => (a.profit ?? Infinity) - (b.profit ?? Infinity));
  return {
    companyId: f.companyId,
    company: x.nameOf(f.companyId),
    period,
    close: { status: close?.status ?? 'open', openExceptions: x.openExceptions },
    profit,
    cash: {
      banks,
      total: cashKnown.length ? round2(cashKnown.reduce((n, b) => n + (b.closing ?? 0), 0)) : null,
      missing: banks.filter((b) => b.closing == null).map((b) => b.bank),
      lowest13: c13.firstShort ? c13.lowest : null,
      firstShortWeek: c13.firstShort?.from ?? null,
    },
    ar: age ? { total: arTotal, over90: age.ar.over90, openCases } : null,
    loans,
    intercompanyLoans: icLoans,
    collateral: { items: collateral, total: round2(collateral.reduce((n, g) => n + g.collateral, 0)) },
    health: { daysToCollect, payrollPct, perGuardCost: perGuard != null ? round2(perGuard) : null, sites },
  };
}

/** A reviewer signs off the whole pack once the month is closed (one review for the pack). */
export function finPackReview(a: FinActor, reviewer: boolean, f: FinStatus, data: FinPackData, sign: (c: string) => FinSign, input: Record<string, unknown>) {
  if (!reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO reviews the monthly pack)');
  if (a.kind === 'viewer' || a.kind === 'coo') throw new AccessDenied('view', '(Finance reviews the pack)');
  if (data.close.status !== 'approved') throw new BadRequest('The pack is reviewed after the month is closed and the close approved.');
  if ((f.packReviews ?? []).some((r) => r.period === data.period)) throw new BadRequest('This month’s pack is already reviewed.');
  const c = requireComment(input.comment, 'review the pack');
  const r: FinPackReview = { period: data.period, sign: sign(c), snapshot: data };
  return {
    patch: { packReviews: [...(f.packReviews ?? []), r].slice(-36) },
    action: 'finance.pack.review',
    summary: `Monthly pack ${data.period} reviewed for the board: ${c}`,
    result: r,
  };
}

/** One dashboard row per company: the key numbers. */
export function finDashboardRow(d: FinPackData, reviewed: FinPackReview | null) {
  return {
    companyId: d.companyId,
    company: d.company,
    period: d.period,
    closeStatus: d.close.status,
    openExceptions: d.close.openExceptions,
    cash: d.cash.total,
    cashMissing: d.cash.missing.length,
    firstShortWeek: d.cash.firstShortWeek,
    profitMonth: d.profit?.month.profit ?? null,
    budgetProfitMonth: d.profit?.month.budgetProfit ?? null,
    profitYtd: d.profit?.ytd.profit ?? null,
    budgetProfitYtd: d.profit?.ytd.budgetProfit ?? null,
    over90: d.ar?.over90 ?? null,
    daysToCollect: d.health.daysToCollect,
    payrollPct: d.health.payrollPct,
    lossSites: d.health.sites.filter((s) => s.profit != null && s.profit < 0).length,
    collateral: d.collateral.total,
    packReviewed: reviewed ? { by: reviewed.sign.by, at: reviewed.sign.at } : null,
  };
}