// Finance monitoring builds F1-F3 (Fauzan, 11 Nov 2026 23:41Z: "Yes prepare new build list for 3,4,9").
// Prima monitors only; SQL Account stays the book of record and nothing here posts to it.
//   F1  every site where guards worked is billed (unbilled sites check), from attendance, not only contracts.
//   F2  profit per site against a target margin the Finance Director (or the CEO) sets with a reason.
//   F3  one page a month for the CEO: every company in a row, the group at the top.
import { contractBilling } from './contracts';
import { finContractEndOn } from './finance-contract-end';
import type { FinBillingLine } from './finance-billing';
import { periodEnd } from './payroll';
import { RULES } from './rules';
import type { ClientAccount, Contract, FinSign, Id, IsoDate, IsoDateTime } from './types';
import { daysBetween, toMs } from './time';

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- F1: unbilled sites ----------

export type FinSiteFlagKind = 'no_contract' | 'not_invoiced' | 'no_signoff' | 'under_billed';
export const FIN_SITE_FLAG_LABEL: Record<FinSiteFlagKind, string> = {
  no_contract: 'Guards on site, no contract',
  not_invoiced: 'Worked, not invoiced',
  no_signoff: 'No client sign-off',
  under_billed: 'Invoice lower than hours worked',
};

/** A flag cleared by a Finance reviewer with a reason (e.g. "free month in contract"); kept on the company's books row. */
export interface FinSiteFlagClear {
  /** `${period}:${siteId}:${kind}` */
  key: string;
  reason: string;
  sign: FinSign;
}

export const finSiteFlagKey = (period: string, siteId: Id, kind: FinSiteFlagKind) => `${period}:${siteId}:${kind}`;

export interface FinSiteHours {
  siteId: Id;
  /** Hours clocked in and out at the site in the month. */
  hours: number;
  guards: number;
}

export interface FinUnbilledInput {
  companyId: Id;
  period: string;
  sites: { id: Id; name: string; companyId: Id }[];
  hours: FinSiteHours[];
  contracts: Contract[];
  billing: FinBillingLine[];
  clients: ClientAccount[];
  clears: FinSiteFlagClear[];
  /** An invoice more than this % under hours worked x rate is flagged (FIN-MONEYIN billDiffPct). */
  diffPct?: number;
}

/** The contract version in force at the month end. */
function versionAt(c: Contract, period: string) {
  const end = periodEnd(period);
  return [...c.versions].filter((v) => v.effectiveFrom <= end).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

/** The average rate per guard-hour of a contract version, weighted by its posts' guards and hours. */
function averageRate(v: NonNullable<ReturnType<typeof versionAt>>): number | null {
  const w = v.posts.reduce((n, p) => n + p.guards * p.hoursPerDay, 0);
  if (w <= 0) return null;
  return v.posts.reduce((n, p) => n + p.guards * p.hoursPerDay * p.rate, 0) / w;
}

/**
 * Every site where guards clocked hours in the month, and every site with a live contract, with what is wrong:
 * guards on site with no contract, worked but not invoiced, no client sign-off (missing or with complaints), and
 * for Methods 1 and 3 an invoice lower than hours worked x the contract rate. A flag a reviewer cleared with a reason
 * shows as cleared.
 */
export function finUnbilledSites(i: FinUnbilledInput) {
  const start = `${i.period}-01`;
  const end = periodEnd(i.period);
  const diffPct = i.diffPct ?? RULES.financeMoneyIn.value.billDiffPct;
  const hoursAt = new Map(i.hours.map((h) => [h.siteId, h]));
  const live = i.contracts.filter(
    (c) => c.companyId === i.companyId && ['ready', 'active', 'suspended', 'terminated'].includes(c.state) && c.startOn <= end && finContractEndOn(c) >= start,
  );
  const siteIds = new Set([...i.hours.filter((h) => h.hours > 0).map((h) => h.siteId), ...live.flatMap((c) => c.siteIds)]);
  const clear = new Map(i.clears.map((x) => [x.key, x]));
  const rows = i.sites
    .filter((s) => s.companyId === i.companyId && siteIds.has(s.id))
    .map((s) => {
      const worked = hoursAt.get(s.id) ?? { siteId: s.id, hours: 0, guards: 0 };
      const contracts = live.filter((c) => c.siteIds.includes(s.id));
      const c = contracts[0] ?? null;
      const v = c ? versionAt(c, i.period) : null;
      const line = c ? i.billing.find((b) => b.contractId === c.id && b.period === i.period) ?? null : null;
      // Hours at all the contract's sites, so an invoice for several sites is compared with all of them.
      const contractHours = c ? r2(c.siteIds.reduce((n, id) => n + (hoursAt.get(id)?.hours ?? 0), 0)) : 0;
      const bill = v ? contractBilling(v, i.period, RULES.contracts.value.daysPerMonthM1) : null;
      const rate = v && v.billingMethod !== 'FIXED' ? averageRate(v) : null;
      // Hours billed: Method 2 the contracted hours; Methods 1 and 3 the invoice over the rate; a fixed fee none.
      const hoursBilled =
        !v || v.billingMethod === 'FIXED'
          ? null
          : v.billingMethod === 'M2'
            ? r2(bill!.lines.reduce((n, l) => n + l.hours, 0))
            : line?.invoice && rate
              ? r2(line.invoice.amount / rate)
              : null;
      // Methods 1 and 3 bill the hours actually worked: expected = hours worked x rate.
      const expected = v && (v.billingMethod === 'M1' || v.billingMethod === 'M3') && rate ? r2(contractHours * rate) : (line?.expected ?? null);
      const acc = c?.clientAccountId ? i.clients.find((a) => a.id === c.clientAccountId) : i.clients.find((a) => a.siteIds.includes(s.id));
      const ack = acc?.workAcks?.find((x) => x.period === i.period) ?? null;
      const flags: { kind: FinSiteFlagKind; label: string; text: string; cleared: FinSiteFlagClear | null }[] = [];
      const flag = (kind: FinSiteFlagKind, text: string) => flags.push({ kind, label: FIN_SITE_FLAG_LABEL[kind], text, cleared: clear.get(finSiteFlagKey(i.period, s.id, kind)) ?? null });
      if (worked.hours > 0 && !c) flag('no_contract', `${r2(worked.hours)} hours by ${worked.guards} guard${worked.guards === 1 ? '' : 's'} and no live contract covers this site`);
      if (c && !line?.invoice && !line?.none?.checked && (worked.hours > 0 || v?.billingMethod === 'FIXED' || v?.billingMethod === 'M2'))
        flag('not_invoiced', line?.none ? `"No invoice" given (${line.none.reason}) and not checked yet` : `No invoice recorded for ${c.ref} in ${i.period}`);
      if (c && worked.hours > 0 && (!ack || ack.outcome === 'complaints'))
        flag('no_signoff', ack ? `The client signed with complaints: ${ack.comment}` : `No client acknowledgement for ${i.period}`);
      if (line?.invoice && expected != null && (v?.billingMethod === 'M1' || v?.billingMethod === 'M3')) {
        const short = r2(expected - line.invoice.amount);
        if (expected > 0 && (short / expected) * 100 > diffPct)
          flag('under_billed', `Invoice RM${line.invoice.amount.toFixed(2)} is RM${short.toFixed(2)} under ${r2(contractHours)} hours worked x RM${rate!.toFixed(2)}`);
      }
      return {
        siteId: s.id,
        siteName: s.name,
        contractId: c?.id ?? null,
        contractRef: c?.ref ?? null,
        client: c?.clientName ?? acc?.name ?? null,
        method: v?.billingMethod ?? null,
        sharedSites: c ? c.siteIds.length : 0,
        guards: worked.guards,
        hoursWorked: r2(worked.hours),
        hoursBilled,
        hoursDifference: hoursBilled == null ? null : r2(hoursBilled - (c && c.siteIds.length > 1 ? contractHours : worked.hours)),
        expected,
        invoice: line?.invoice ? { no: line.invoice.no, amount: line.invoice.amount, byId: line.invoice.byId } : null,
        signOff: ack ? { outcome: ack.outcome, signedOn: ack.signedOn } : null,
        flags,
        open: flags.filter((f) => !f.cleared).length,
      };
    })
    .sort((a, b) => b.open - a.open || a.siteName.localeCompare(b.siteName));
  return { period: i.period, rows, open: rows.reduce((n, r) => n + r.open, 0), sitesFlagged: rows.filter((r) => r.open > 0).length };
}

// ---------- F2: target margin and shared costs per guard ----------

/** A target margin (%), set by the FD or the CEO with a reason; no value is preset (Fauzan, 11 Nov 2026). */
export interface FinSiteTarget {
  pct: number | null;
  set: FinSign;
}
/** Kept on PWVSB's row: the group default, each company's own, and every earlier value. */
export interface FinSiteTargets {
  group: FinSiteTarget | null;
  companies: Record<Id, FinSiteTarget>;
  history: { companyId: Id | null; pct: number | null; set: FinSign }[];
}

/** Shared monthly costs per guard (RM a guard a month), entered in the app; none entered = "rate not set", never zero (C5). */
export type FinSiteCostKind = 'transport_foreign' | 'hostel_foreign' | 'uniform' | 'equipment';
export const FIN_SITE_COST_LABEL: Record<FinSiteCostKind, string> = {
  transport_foreign: 'Transport, foreign (Nepali) guards',
  // C10: used by the quotation cost check; site profit takes hostel from the actual hostel bills instead.
  hostel_foreign: 'Hostel, foreign (Nepali) guards',
  uniform: 'Uniform',
  equipment: 'Equipment',
};
export interface FinSiteCostRates {
  rates: Partial<Record<FinSiteCostKind, number>>;
  set: FinSign | null;
  history: { rates: Partial<Record<FinSiteCostKind, number>>; set: FinSign }[];
}

/** The target in force for a company: its own, else the group default, else none ("target not set"). */
export function finSiteTargetFor(t: FinSiteTargets | null | undefined, companyId: Id): { pct: number; from: 'company' | 'group' } | null {
  const own = t?.companies?.[companyId];
  if (own && own.pct != null) return { pct: own.pct, from: 'company' };
  if (t?.group && t.group.pct != null) return { pct: t.group.pct, from: 'group' };
  return null;
}

/** Why a site is under its target: the hours paid against the hours billed and the cost lines. */
export function finSiteBelowTarget(
  s: { revenue: number | null; marginPct: number | null; clockedHours: number; contractedHours: number; costs: { label: string; amount: number | null }[] },
  target: number | null,
) {
  if (target == null || s.marginPct == null || s.revenue == null) return null;
  if (s.marginPct >= target) return null;
  const why: string[] = [];
  if (s.contractedHours > 0 && s.clockedHours > s.contractedHours) why.push(`${s.clockedHours} hours paid against ${s.contractedHours} hours billed`);
  const big = s.costs.filter((c) => c.amount != null && c.amount > 0).sort((a, b) => b.amount! - a.amount!).slice(0, 3);
  if (big.length) why.push(`Largest costs: ${big.map((c) => `${c.label} RM${c.amount!.toFixed(2)}`).join(', ')}`);
  if (s.clockedHours > 0) why.push(`Price RM${(s.revenue / Math.max(1, s.contractedHours || s.clockedHours)).toFixed(2)} an hour billed, cost RM${((s.revenue * (1 - s.marginPct / 100)) / s.clockedHours).toFixed(2)} an hour worked`);
  return { target, gap: Math.round((target - s.marginPct) * 10) / 10, why };
}

// ---------- F3: one page a month for the CEO ----------

/** A figure from SQL Account is Unknown, never a number, when its last sync is older than FIN-WATCH staleHours (48). */
export function finSqlFresh(sqlLastAt: IsoDateTime | null, now: IsoDateTime): boolean {
  return !!sqlLastAt && (toMs(now) - toMs(sqlLastAt)) / 3_600_000 <= RULES.finance.value.staleHours;
}

export interface FinCeoRowInput {
  companyId: Id;
  company: string;
  sqlLastAt: IsoDateTime | null;
  cash: number | null;
  /** The start of the first week the 13-week forecast runs short, if any. */
  firstShortWeek: IsoDate | null;
  due30: number;
  over90: number | null;
  daysToCollect: number | null;
  banks: { reconciledTo: IsoDate | null }[];
  closeStatus: string;
  openExceptions: number;
  unbilledSites: number;
  belowTarget: number;
  packReviewed: { by: string; at: IsoDateTime } | null;
}

/**
 * One company's row. Red only for: cash short within 4 weeks, bank reconciliation not done after the 10th, books not
 * closed after the 15th, unbilled sites, and any site under target (Fauzan, 11 Nov 2026). Everything else is plain.
 */
export function finCeoRow(x: FinCeoRowInput, period: string, today: IsoDate, now: IsoDateTime) {
  const fresh = finSqlFresh(x.sqlLastAt, now);
  const w = RULES.finance.value;
  const end = periodEnd(period);
  const [y, m] = period.split('-').map(Number);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
  const recDone = x.banks.filter((b) => b.reconciledTo != null && b.reconciledTo >= end).length;
  const pastRec = today > `${next}-${String(w.reconcileByDay).padStart(2, '0')}`;
  const pastClose = today > `${next}-${String(w.closeByDay).padStart(2, '0')}`;
  const closed = x.closeStatus === 'approved';
  const red: string[] = [];
  if (x.firstShortWeek && daysBetween(today, x.firstShortWeek) < 28) red.push('cash');
  if (pastRec && recDone < x.banks.length) red.push('bankRec');
  if (pastClose && !closed) red.push('close');
  if (x.unbilledSites > 0) red.push('unbilled');
  if (x.belowTarget > 0) red.push('belowTarget');
  return {
    companyId: x.companyId,
    company: x.company,
    sqlFresh: fresh,
    // SQL Account figures: Unknown when the last sync is older than 48 hours (FIN-WATCH).
    cash: fresh ? x.cash : null,
    firstShortWeek: x.firstShortWeek,
    due30: r2(x.due30),
    over90: fresh ? x.over90 : null,
    daysToCollect: fresh ? x.daysToCollect : null,
    bankRec: { done: recDone, total: x.banks.length },
    closed,
    closeStatus: x.closeStatus,
    openExceptions: x.openExceptions,
    unbilledSites: x.unbilledSites,
    belowTarget: x.belowTarget,
    packReviewed: x.packReviewed,
    red,
  };
}

export function finCeoTotals(rows: ReturnType<typeof finCeoRow>[]) {
  const sum = (k: 'cash' | 'over90') => (rows.some((r) => r[k] == null) ? null : r2(rows.reduce((n, r) => n + (r[k] ?? 0), 0)));
  return {
    companies: rows.length,
    cash: sum('cash'),
    cashUnknown: rows.filter((r) => r.cash == null).length,
    shortWithin4: rows.filter((r) => r.red.includes('cash')).length,
    due30: r2(rows.reduce((n, r) => n + r.due30, 0)),
    over90: sum('over90'),
    bankRec: { done: rows.reduce((n, r) => n + r.bankRec.done, 0), total: rows.reduce((n, r) => n + r.bankRec.total, 0) },
    closed: rows.filter((r) => r.closed).length,
    openExceptions: rows.reduce((n, r) => n + r.openExceptions, 0),
    unbilledSites: rows.reduce((n, r) => n + r.unbilledSites, 0),
    belowTarget: rows.reduce((n, r) => n + r.belowTarget, 0),
    reviewed: rows.filter((r) => r.packReviewed).length,
  };
}
