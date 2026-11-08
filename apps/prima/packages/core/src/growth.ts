import { contractBilling } from "./contracts";
import { addDays } from "./time";
import type { Company } from "./types";
import type { Contract } from "./types";
import type { ClientAccount } from "./types";
import type { FinAgeing } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { SalesLead } from "./types";


export interface GrowthCompany {
  companyId: Id;
  companyName: string;
  /** Monthly run-rate of contracts live this month (RM, Method 3 at 30.5 days); null: no contract recorded. */
  contractValue: number | null;
  /** The same for last month; null when nothing was live then. */
  contractValuePrev: number | null;
  /** Change from last month, percent (one decimal); null when either month is unknown or last month was zero. */
  changePct: number | null;
  /** Live contracts ending within 90 days and not yet renewed: count and their monthly value. */
  ending90: { count: number; monthly: number } | null;
  /** Open sales leads (not won, lost or dropped): count and estimated monthly value; null: no lead recorded. */
  pipeline: { count: number; monthly: number; unpriced: number } | null;
  /** Last month's billing check: amount under the contract, contracts under-billed and invoices missing. */
  billing: { period: string; underBilled: number; underContracts: number; missing: number; checked: number } | null;
  /** Shifts in the next 7 days with nobody rostered; null: no roster in Prima for this company. */
  unfilled7: number | null;
  /** Debtor days from the latest reviewed or prepared ageing: debtors / last month's contract value x 30. */
  collectionDays: number | null;
  collectionNote: string;
  /** The figures behind collectionDays (the ageing's month and that month's billing), so the group can add them up. */
  collection: { period: string; debtors: number; billing: number } | null;
}

export interface GrowthPanel {
  month: string;
  prevMonth: string;
  rows: GrowthCompany[];
  group: {
    contractValue: number | null;
    contractValuePrev: number | null;
    changePct: number | null;
    // Each group figure is null (Unknown) when no company has that figure recorded: Unknown is never a green zero.
    ending90Count: number | null;
    ending90Monthly: number | null;
    pipelineCount: number | null;
    pipelineMonthly: number | null;
    underBilled: number | null;
    underContracts: number | null;
    missingInvoices: number | null;
    unfilled7: number | null;
    collectionDays: number | null;
    /** How many companies have each figure known, so a group total is never read as covering everyone. */
    known: { contracts: number; pipeline: number; billing: number; roster: number; collection: number; of: number };
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const firstDay = (m: string) => `${m}-01` as IsoDate;
const lastDay = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}` as IsoDate;
};
export const prevMonthOf = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

/** The contract's version in force on a day (the latest that started by then). */
function versionOn(c: Contract, day: IsoDate) {
  return [...c.versions].filter((v) => v.effectiveFrom <= day).sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Whether the contract was billing during the month: started by its end, not ended before it starts, and live. */
function billingIn(c: Contract, m: string): boolean {
  if (c.state === 'awarded' || c.state === 'mobilising' || c.state === 'ready') return false;
  // A terminated contract with no recorded end day is not counted in any month (its billing day is unknown).
  if (c.state === 'terminated' && !c.endedOn) return false;
  const end = c.endedOn ?? c.endOn;
  return c.startOn <= lastDay(m) && end >= firstDay(m);
}

/** What the contract bills for the month (the version in force at the month's end), by its own billing method. */
function monthValue(c: Contract, m: string, daysPerMonthM1: number): number {
  const v = versionOn(c, lastDay(m));
  return v ? contractBilling(v, m, daysPerMonthM1).total : 0;
}

/**
 * The contract's monthly run-rate for growth: like the bill, except that a days-in-the-month contract (Method 3) is
 * valued at the standard month (30.5 days), so a 30-day month never looks like a fall against a 31-day month.
 */
function runRate(c: Contract, m: string, daysPerMonthM1: number): number {
  const v = versionOn(c, lastDay(m));
  if (!v) return 0;
  return contractBilling(v.billingMethod === 'M3' ? { ...v, billingMethod: 'M1' } : v, m, daysPerMonthM1).total;
}

export interface GrowthInput {
  today: IsoDate;
  companies: Pick<Company, 'id' | 'name'>[];
  contracts: Contract[];
  accounts: Pick<ClientAccount, 'id' | 'companyId' | 'invoices'>[];
  leads: Pick<SalesLead, 'companyId' | 'stage' | 'estMonthly'>[];
  /** Shifts from today to 7 days ahead, already cut to those days. */
  shifts7: { companyId: Id; personId: Id | null }[];
  /** Companies that keep a roster in Prima (any shift recorded); others are Unknown, not zero unfilled. */
  rosterCompanies: Set<Id>;
  /** Each company's ageing records (Finance, from SQL Account). */
  ageing: Map<Id, FinAgeing[]>;
  daysPerMonthM1: number;
}

export function growthPanel(i: GrowthInput): GrowthPanel {
  const month = i.today.slice(0, 7);
  const prev = prevMonthOf(month);
  const in90 = addDays(i.today, 90);
  const rows: GrowthCompany[] = i.companies.map((co) => {
    const mine = i.contracts.filter((c) => c.companyId === co.id);
    const nowLive = mine.filter((c) => billingIn(c, month));
    const prevLive = mine.filter((c) => billingIn(c, prev));
    const recorded = mine.length > 0;
    const contractValue = recorded ? r2(nowLive.reduce((n, c) => n + runRate(c, month, i.daysPerMonthM1), 0)) : null;
    const contractValuePrev = recorded && prevLive.length ? r2(prevLive.reduce((n, c) => n + runRate(c, prev, i.daysPerMonthM1), 0)) : recorded ? 0 : null;
    const changePct =
      contractValue != null && contractValuePrev ? Math.round(((contractValue - contractValuePrev) / contractValuePrev) * 1000) / 10 : null;
    // A live contract ending within 90 days whose end is still the planned end (no early termination recorded).
    const ending = nowLive.filter((c) => c.state !== 'terminated' && !c.endedOn && c.endOn >= i.today && c.endOn <= in90);
    const ending90 = recorded ? { count: ending.length, monthly: r2(ending.reduce((n, c) => n + runRate(c, month, i.daysPerMonthM1), 0)) } : null;

    const leads = i.leads.filter((l) => l.companyId === co.id);
    const open = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost' && l.stage !== 'dropped');
    const pipeline = leads.length
      ? { count: open.length, monthly: r2(open.reduce((n, l) => n + (l.estMonthly ?? 0), 0)), unpriced: open.filter((l) => l.estMonthly == null).length }
      : null;

    // Last month's invoice against what the contract bills (same test as the Contracts screen: off by more than RM10
    // and 0.5%). Only contracts that billed the whole of last month are checked.
    let underBilled = 0;
    let underContracts = 0;
    let missing = 0;
    let checked = 0;
    for (const c of mine.filter((x) => x.state === 'active' && x.startOn <= firstDay(prev) && billingIn(x, prev))) {
      const expected = monthValue(c, prev, i.daysPerMonthM1);
      const acct = i.accounts.find((a) => a.id === c.clientAccountId);
      const inv = acct?.invoices?.find((v) => v.period === prev) ?? null;
      checked++;
      if (!inv) {
        missing++;
        continue;
      }
      const short = expected - inv.amount;
      if (short > Math.max(10, expected * 0.005)) {
        underBilled += short;
        underContracts++;
      }
    }
    const billing = checked ? { period: prev, underBilled: r2(underBilled), underContracts, missing, checked } : null;

    const unfilled7 = i.rosterCompanies.has(co.id) ? i.shifts7.filter((s) => s.companyId === co.id && !s.personId).length : null;

    // Collection days from the newest ageing: debtors over last month's contract value, times 30. A reviewed ageing is
    // preferred; a prepared one is used and said so. No ageing, or no contract value to divide by, is Unknown.
    const ages = [...(i.ageing.get(co.id) ?? [])].sort((a, b) => b.period.localeCompare(a.period));
    const age = ages.find((a) => a.reviewed) ?? ages[0] ?? null;
    let collectionDays: number | null = null;
    let collection: GrowthCompany['collection'] = null;
    let collectionNote = 'No debtor ageing recorded by Finance yet (SQL Account)';
    if (age) {
      const debtors = age.ar.current + age.ar.d1to30 + age.ar.d31to60 + age.ar.d61to90 + age.ar.over90;
      const base = recorded ? i.contracts.filter((c) => c.companyId === co.id && billingIn(c, age.period)).reduce((n, c) => n + monthValue(c, age.period, i.daysPerMonthM1), 0) : 0;
      if (base > 0) {
        collectionDays = Math.round((debtors / base) * 30);
        collection = { period: age.period, debtors: r2(debtors), billing: r2(base) };
        collectionNote = `Ageing ${age.period}${age.reviewed ? ', reviewed' : ', not yet reviewed'}`;
      } else collectionNote = `Ageing ${age.period} recorded, but no contract value for that month to compare`;
    }
    return { companyId: co.id, companyName: co.name, contractValue, contractValuePrev, changePct, ending90, pipeline, billing, unfilled7, collectionDays, collectionNote, collection };
  });

  const sum = (f: (r: GrowthCompany) => number | null | undefined) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  const withValue = rows.filter((r) => r.contractValue != null);
  const withPrev = rows.filter((r) => r.contractValuePrev != null && r.contractValue != null);
  const gNow = withValue.length ? r2(sum((r) => r.contractValue)) : null;
  const gPrevSame = withPrev.length ? r2(withPrev.reduce((n, r) => n + (r.contractValuePrev ?? 0), 0)) : null;
  const gNowSame = withPrev.length ? r2(withPrev.reduce((n, r) => n + (r.contractValue ?? 0), 0)) : null;
  const withDays = rows.filter((r) => r.collection != null);
  // Group debtor days: all debtors over all billing of the same ageing months, times 30 (Arisha review, 3 Nov 2026).
  // Weighting by this month's contract value was wrong: a company whose contracts have since ended dropped out.
  const gDebtors = withDays.reduce((n, r) => n + r.collection!.debtors, 0);
  const gBilling = withDays.reduce((n, r) => n + r.collection!.billing, 0);
  const roster = rows.filter((r) => r.unfilled7 != null);
  const withEnding = rows.filter((r) => r.ending90 != null);
  const withPipeline = rows.filter((r) => r.pipeline != null);
  const withBilling = rows.filter((r) => r.billing != null);
  const known = <T,>(of: GrowthCompany[], v: T) => (of.length ? v : null);
  return {
    month,
    prevMonth: prev,
    rows,
    group: {
      contractValue: gNow,
      contractValuePrev: gPrevSame,
      changePct: gPrevSame && gNowSame != null ? Math.round(((gNowSame - gPrevSame) / gPrevSame) * 1000) / 10 : null,
      ending90Count: known(withEnding, sum((r) => r.ending90?.count)),
      ending90Monthly: known(withEnding, r2(sum((r) => r.ending90?.monthly))),
      pipelineCount: known(withPipeline, sum((r) => r.pipeline?.count)),
      pipelineMonthly: known(withPipeline, r2(sum((r) => r.pipeline?.monthly))),
      underBilled: known(withBilling, r2(sum((r) => r.billing?.underBilled))),
      underContracts: known(withBilling, sum((r) => r.billing?.underContracts)),
      missingInvoices: known(withBilling, sum((r) => r.billing?.missing)),
      unfilled7: roster.length ? sum((r) => r.unfilled7) : null,
      collectionDays: gBilling > 0 ? Math.round((gDebtors / gBilling) * 30) : null,
      known: {
        contracts: withValue.length,
        pipeline: withPipeline.length,
        billing: withBilling.length,
        roster: roster.length,
        collection: withDays.length,
        of: rows.length,
      },
    },
  };
}

/** Site margin summary from the Operations monitors' site profit and loss (government and private sectors). */
export interface GrowthMargin {
  month: string;
  sectors: { sector: 'government' | 'private'; sites: number; known: number; lossSites: number; revenue: number; margin: number; marginPct: number | null; error?: string }[];
}

export function marginSummary(
  month: string,
  parts: { sector: 'government' | 'private'; sites?: { revenue: number | null; margin: number | null; tone: string }[]; error?: string }[],
): GrowthMargin {
  return {
    month,
    sectors: parts.map((p) => {
      if (!p.sites) return { sector: p.sector, sites: 0, known: 0, lossSites: 0, revenue: 0, margin: 0, marginPct: null, error: p.error };
      // Only sites whose profit and loss is complete count (tone ok or crit); the rest are Unknown, not zero.
      const known = p.sites.filter((s) => s.tone !== 'unknown' && s.revenue != null && s.margin != null);
      const revenue = r2(known.reduce((n, s) => n + (s.revenue ?? 0), 0));
      const margin = r2(known.reduce((n, s) => n + (s.margin ?? 0), 0));
      return {
        sector: p.sector,
        sites: p.sites.length,
        known: known.length,
        lossSites: known.filter((s) => (s.margin ?? 0) < 0).length,
        revenue,
        margin,
        marginPct: revenue ? Math.round((margin / revenue) * 1000) / 10 : null,
      };
    }),
  };
}