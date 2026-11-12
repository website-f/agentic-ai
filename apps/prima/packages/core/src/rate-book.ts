import { AccessDenied } from "./access";
import { tenantCompanyIds } from "./access";
import { actsOn } from "./finance";
import { finActor } from "./finance";
import { fwCostRateFor } from "./fw-cost";
import { feeChargers } from "./management-fees";
import { feeInEffect } from "./management-fees";
import { canSetManagementFee } from "./ops-access";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { dateOf } from "./time";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";

/**
 * C5 (Fauzan, 11 Nov 2026: "rates for all things can be set in the system, not predetermined, from now", because prices
 * sometimes change every month). The rates Prima needs for costing are entered here by the rate owner (the Finance
 * Director or the CEO), each from a month, with a reason; every change is kept, so a month already costed keeps the rate
 * that was in force then. With no rate entered for a month the cost is "rate not set": never zero, never a guess.
 *
 * The rates live on each company's Finance record (FinStatus.rateLog), next to its management fees, so the company's own
 * people (quotations) and its operations monitors (site profit) can read them under the company wall. A rate set "for
 * every company" is written to each company's record as a group rate; a company rate overrides it.
 */
export type RateKey = 'hostel_np' | 'transport_np' | 'uniform' | 'equipment';
export const RATE_KEYS: RateKey[] = ['hostel_np', 'transport_np', 'uniform', 'equipment'];

export const RATE_INFO: Record<RateKey, { label: string; unit: string; who: 'nepali' | 'all'; max: number }> = {
  hostel_np: { label: 'Hostel, per Nepali guard', unit: 'RM per guard a month', who: 'nepali', max: 100_000 },
  transport_np: { label: 'Transport, per Nepali guard', unit: 'RM per guard a month', who: 'nepali', max: 100_000 },
  uniform: { label: 'Uniform, per guard', unit: 'RM per guard a month', who: 'all', max: 100_000 },
  equipment: { label: 'Equipment, per guard', unit: 'RM per guard a month', who: 'all', max: 100_000 },
};

/** One change to a rate on a company's Finance record. Append-only. amount null: not set (group) or "use the group rate" (company). */
export interface RateEntry {
  key: RateKey;
  scope: 'group' | 'company';
  /** First month it applies, YYYY-MM. */
  from: string;
  amount: number | null;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export interface RateInForce {
  amount: number;
  from: string;
  scope: 'group' | 'company';
  reason: string;
  by: string;
  at: IsoDateTime;
}

export const RATE_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function newest(entries: RateEntry[]): RateEntry | null {
  return [...entries].sort((a, b) => b.from.localeCompare(a.from) || b.at.localeCompare(a.at))[0] ?? null;
}

/**
 * The rate in force for a month: the company's own rate when it has one, else the group rate; null when neither is
 * set ("rate not set"). Later entries for the same month replace earlier ones.
 */
export function rateFor(fin: Pick<FinStatus, 'rateLog'> | null | undefined, key: RateKey, month: string): RateInForce | null {
  const mine = (fin?.rateLog ?? []).filter((e) => e.key === key && e.from <= month);
  const own = newest(mine.filter((e) => e.scope === 'company'));
  const group = newest(mine.filter((e) => e.scope === 'group'));
  const pick = own && own.amount != null ? own : group && group.amount != null ? group : null;
  return pick ? { amount: pick.amount!, from: pick.from, scope: pick.scope, reason: pick.reason, by: pick.by, at: pick.at } : null;
}

/** Changes already entered for months after m. */
export function rateChangesAfter(fin: Pick<FinStatus, 'rateLog'> | null | undefined, key: RateKey, m: string): RateEntry[] {
  return (fin?.rateLog ?? []).filter((e) => e.key === key && e.from > m).sort((a, b) => a.from.localeCompare(b.from) || a.at.localeCompare(b.at));
}

export function monthBeforeRate(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

/** Every other rate list in Prima: each is entered by its owner on its own screen, from a date, never preset. */
export const OTHER_RATE_LISTS: { id: string; title: string; owner: string; where: string; view: string }[] = [
  { id: 'it_rental', title: 'IT device rental', owner: 'IT Manager', where: 'IT, Device rental', view: 'it' },
  { id: 'fw_recruitment', title: 'Foreign worker recruitment cost', owner: 'Finance Director or CEO', where: 'Foreign workers, Recruitment cost', view: 'fwcost' },
  { id: 'management_fee', title: 'Management fees', owner: 'Finance Director or CEO', where: 'Finance, Management fees', view: 'finance' },
  { id: 'vehicle_rental', title: 'Vehicle rental', owner: 'Transport', where: 'Equipment, Vehicles', view: 'fleet' },
  { id: 'claim_km', title: 'Mileage claim rate per km', owner: 'Chief of Staff', where: 'HR, Claims', view: 'claims' },
  { id: 'pay_formulas', title: 'Guard pay formulas', owner: 'ACT Director', where: 'Payroll, Pay formulas', view: 'payformulas' },
  { id: 'item_prices', title: 'Item rental and sale prices', owner: 'Procurement', where: 'Equipment, Items', view: 'items' },
];

type Status = { set: boolean; text: string } | null;

export class RateBookService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
  ) {}

  private today() {
    return dateOf(this.clock());
  }

  /** Who sees the rate book: Finance, the COO and the CEO; only the Finance Director or the CEO changes it. */
  roleOf(user: User): { view: boolean; set: boolean } {
    const set = canSetManagementFee(user);
    const view = set || (!user.integration && (finActor(user) != null || (user.role === 'pwvsb_officer' && user.opsTier === 'coo')));
    return { view, set };
  }

  private async rows(user: User): Promise<FinStatus[]> {
    const ids = tenantCompanyIds(user, await this.store.list('grants'), this.today());
    const rows = ids.length ? await this.store.list('finStatus', { companyId: ids }) : [];
    const a = finActor(user);
    // A Finance team member sees the companies their team keeps (Fauzan, 2 Nov 2026); others in the book see all.
    return a && a.kind !== 'ceo' && a.kind !== 'director' && a.kind !== 'viewer' ? rows.filter((f) => actsOn(a, f)) : rows;
  }

  async view(user: User) {
    const r = this.roleOf(user);
    if (!r.view) throw new AccessDenied('view', '(the rate book: Finance, the COO and the CEO)');
    const m = this.today().slice(0, 7);
    const rows = await this.rows(user);
    const ids = rows.map((f) => f.companyId);
    const companies = ids.length ? await this.store.list('companies', { id: ids }) : [];
    const nameOf = (id: Id) => companies.find((c) => c.id === id)?.name ?? id;
    const groupLog = new Map<string, RateEntry>();
    for (const f of rows) for (const e of f.rateLog ?? []) if (e.scope === 'group') groupLog.set(`${e.key}|${e.from}|${e.at}`, e);
    const history = [
      ...[...groupLog.values()].map((e) => ({ ...e, companyId: null as Id | null, companyName: 'Every company' })),
      ...rows.flatMap((f) => (f.rateLog ?? []).filter((e) => e.scope === 'company').map((e) => ({ ...e, companyId: f.companyId as Id | null, companyName: nameOf(f.companyId) }))),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 200);
    return {
      month: m,
      earliestFrom: monthBeforeRate(m),
      canSet: r.set,
      keys: RATE_KEYS.map((k) => ({ key: k, ...RATE_INFO[k] })),
      companies: rows
        .map((f) => ({
          companyId: f.companyId,
          companyName: nameOf(f.companyId),
          rates: RATE_KEYS.map((k) => ({ key: k, now: rateFor(f, k, m), later: rateChangesAfter(f, k, m) })),
        }))
        .sort((a, b) => a.companyName.localeCompare(b.companyName)),
      history,
      others: await this.others(m),
    };
  }

  /** What is set in each other rate list, where this person may read it; null where it is kept out of their reach. */
  private async others(m: string) {
    const status: Record<string, Status> = {};
    try {
      const rates = await this.store.list('itRentalRates', {});
      const live = rates.filter((x) => x.effectiveOn <= `${m}-01`).sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn) || b.version - a.version)[0];
      status.it_rental = live
        ? { set: true, text: `Version ${live.version} from ${live.effectiveOn}: ${Object.keys(live.monthly).length} device kinds priced` }
        : { set: false, text: 'Rate not set' };
    } catch {
      status.it_rental = null;
    }
    try {
      const row = (await this.store.list('fwCostRates', {}))[0];
      const c = fwCostRateFor(row?.charge, m);
      const p = fwCostRateFor(row?.payback, m);
      status.fw_recruitment =
        c == null || p == null
          ? { set: false, text: `Rate not set${c == null && p == null ? '' : c == null ? ' (charge to host)' : ' (payback to owner)'}` }
          : { set: true, text: `RM${c.toFixed(2)} charged, RM${p.toFixed(2)} paid back, per worker a month` };
    } catch {
      status.fw_recruitment = null;
    }
    try {
      const fins = await this.store.list('finStatus', {});
      const n = fins.filter((f) => feeChargers(f).some((by) => feeInEffect(f, by, m))).length;
      status.management_fee = n ? { set: true, text: `${n} compan${n === 1 ? 'y has' : 'ies have'} a fee this month` } : { set: false, text: 'Rate not set' };
    } catch {
      status.management_fee = null;
    }
    return OTHER_RATE_LISTS.map((o) => ({ ...o, status: status[o.id] ?? null }));
  }

  /**
   * The Finance Director or the CEO enters a rate from a month (this month by default, last month at the earliest, so
   * months already costed never change), for one company or for every company, with a reason. 0 is a real "no cost";
   * blank (null) for one company goes back to the group rate, and for every company marks it not set.
   */
  async set(user: User, input: { key: unknown; companyId: unknown; from?: unknown; amount: unknown; reason: unknown }) {
    if (!this.roleOf(user).set) throw new AccessDenied('view', '(only the Finance Director or the CEO sets rates)');
    const key = RATE_KEYS.find((k) => k === input.key);
    if (!key) throw new BadRequest('Choose which rate to set.');
    const m = this.today().slice(0, 7);
    const from = typeof input.from === 'string' && input.from ? input.from : m;
    if (!RATE_MONTH.test(from)) throw new BadRequest('Choose the month the rate starts from (YYYY-MM).');
    if (from < monthBeforeRate(m)) throw new BadRequest('A rate can start from last month at the earliest, so months already costed keep their rate.');
    let amount: number | null = null;
    if (input.amount !== null && input.amount !== undefined && input.amount !== '') {
      const n = typeof input.amount === 'number' ? input.amount : Number(input.amount);
      if (!Number.isFinite(n) || n < 0 || n > RATE_INFO[key].max) throw new BadRequest(`${RATE_INFO[key].label}: give an amount in RM from 0 to ${RATE_INFO[key].max.toLocaleString('en-MY')}.`);
      if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new BadRequest('Give the amount to the sen (2 decimal places at most).');
      amount = Math.round(n * 100) / 100;
    }
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
    if (reason.length < 3) throw new BadRequest('Give the reason for this rate (for example the supplier quote or the hostel agreement).');
    const all = input.companyId === 'all';
    const rows = await this.rows(user);
    const targets = all ? rows : rows.filter((f) => f.companyId === input.companyId);
    if (!all && !targets.length) throw new NotFound('Company Finance record');
    if (!targets.length) throw new BadRequest('No company has Finance books yet. Start the books in Finance settings first.');
    const scope: RateEntry['scope'] = all ? 'group' : 'company';
    const at = this.clock();
    const entry: RateEntry = { key, scope, from, amount, reason, by: user.name, byId: user.id, at };
    return this.store.transaction(async (tx) => {
      let changed = 0;
      for (const t of targets) {
        await tx.lock?.('finStatus', t.id);
        const cur = await tx.get('finStatus', t.id);
        if (!cur) continue;
        const before = (cur.rateLog ?? []).filter((e) => e.key === key && e.scope === scope && e.from <= from);
        const last = newest(before);
        if (last && last.amount === amount && last.from === from) continue;
        await tx.update('finStatus', cur.id, { rateLog: [...(cur.rateLog ?? []), entry] });
        changed += 1;
      }
      if (!changed) throw new BadRequest('That is already the rate for that month.');
      const what = amount == null ? (all ? 'not set' : 'back to the group rate') : `RM${amount.toFixed(2)}`;
      await tx.audit({
        at,
        actor: user.name,
        companyId: all ? null : targets[0].companyId,
        action: 'fin.rate.set',
        entity: 'fin_status',
        entityId: all ? 'rates:group' : targets[0].id,
        summary: `${RATE_INFO[key].label} ${what} (${RATE_INFO[key].unit}) from ${from} for ${all ? `every company (${changed})` : targets[0].companyId}. Reason: ${reason}`,
      });
      return { key, scope, from, amount, companies: changed };
    });
  }
}
