import { AccessDenied } from "./access";
import { tenantCompanyIds } from "./access";
import { contractBilling } from "./contracts";
import { actsOn } from "./finance";
import { finActor } from "./finance";
import { finSettingsOf } from "./finance";
import { isLead } from "./finance";
import { GROUP_EMPLOYER_ID } from "./access";
import { finContractEndOn } from "./finance-contract-end";
import { periodEnd } from "./payroll";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import { dateOf } from "./time";
import { toMs } from "./time";
import type { Attendance } from "./types";
import type { ClientAccount } from "./types";
import type { Contract } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDateTime } from "./types";
import type { Site } from "./types";
import type { User } from "./types";

/**
 * F1 (Fauzan, 11 Nov 2026: "Yes prepare new build list for 3,4,9"): every site where guards worked is billed. Starts from
 * the ATTENDANCE of the month, not only the contracts: a site where guards clocked hours is flagged when no live contract
 * covers it, when its contract has no invoice recorded for the month, when the client's sign-off for the month is missing
 * or disputed, and (billing methods 1 and 3, hours actually worked) when the invoice is lower than the hours worked times
 * the contract rate by more than the % set in Finance settings. A flag is cleared only with a reason, by a Finance
 * reviewer who did not record that invoice. Prima monitors only; SQL Account stays the book of record.
 */
export type UnbilledKind = 'no_contract' | 'not_invoiced' | 'no_signoff' | 'below_hours';

export interface UnbilledClear {
  key: string;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export const UNBILLED_LABEL: Record<UnbilledKind, string> = {
  no_contract: 'Guards on site, no contract',
  not_invoiced: 'Worked, not invoiced',
  no_signoff: 'No client sign-off',
  below_hours: 'Invoice lower than hours worked',
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const unbilledKey = (period: string, siteId: Id, kind: UnbilledKind, contractId: Id | null) => `${period}|${siteId}|${kind}|${contractId ?? ''}`;

/** The contracts that ran in the month and cover a site. */
function liveFor(contracts: Contract[], siteId: Id, period: string) {
  const start = `${period}-01`;
  const end = periodEnd(period);
  return contracts.filter((c) => c.siteIds.includes(siteId) && ['ready', 'active', 'suspended', 'terminated'].includes(c.state) && c.startOn <= end && finContractEndOn(c) >= start);
}

function versionFor(c: Contract, period: string) {
  const end = periodEnd(period);
  return [...c.versions].filter((v) => v.effectiveFrom <= end).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? c.versions[0] ?? null;
}

/** Hours clocked (clock-in to clock-out) per site in the month. */
export function hoursBySite(attendance: Attendance[], period: string): Map<Id, { hours: number; people: Set<Id> }> {
  const from = `${period}-01`;
  const to = addDays(periodEnd(period), 1);
  const out = new Map<Id, { hours: number; people: Set<Id> }>();
  for (const a of attendance) {
    if (!a.clockIn || !a.clockOut) continue;
    const d = dateOf(a.clockIn);
    if (d < from || d >= to) continue;
    const h = (toMs(a.clockOut) - toMs(a.clockIn)) / 3_600_000;
    if (!(h > 0)) continue;
    const row = out.get(a.siteId) ?? { hours: 0, people: new Set<Id>() };
    row.hours += h;
    row.people.add(a.personId);
    out.set(a.siteId, row);
  }
  return out;
}

export interface UnbilledInput {
  period: string;
  sites: Site[];
  attendance: Attendance[];
  contracts: Contract[];
  fin: FinStatus | null | undefined;
  clients: ClientAccount[];
  /** The % an invoice may be below the hours worked before it is flagged (Finance settings billDiffPct). */
  diffPct?: number;
}

/** The unbilled-sites check for one company and month. */
export function finUnbilledSites(x: UnbilledInput) {
  const { period } = x;
  const diffPct = x.diffPct ?? RULES.financeMoneyIn.value.billDiffPct;
  const worked = hoursBySite(x.attendance, period);
  const clears = x.fin?.billingClears ?? [];
  const rows = [];
  for (const site of x.sites) {
    const w = worked.get(site.id);
    if (!w || w.hours <= 0) continue;
    const live = liveFor(x.contracts, site.id, period);
    const flags: { kind: UnbilledKind; key: string; text: string; contractId: Id | null; recordedById: Id | null; cleared: UnbilledClear | null }[] = [];
    const flag = (kind: UnbilledKind, contractId: Id | null, text: string, recordedById: Id | null = null) => {
      const key = unbilledKey(period, site.id, kind, contractId);
      flags.push({ kind, key, text, contractId, recordedById, cleared: clears.find((c) => c.key === key) ?? null });
    };
    let hoursBilled: number | null = live.length ? 0 : null;
    let expected: number | null = null;
    let invoiced: number | null = live.length ? 0 : null;
    if (!live.length) flag('no_contract', null, `${r1(w.hours)} hours clocked by ${w.people.size} guard(s) and no live contract covers this site`);
    for (const c of live) {
      const v = versionFor(c, period);
      // A contract for several sites: its hours and invoice are shared out by the hours worked at each.
      const totalHours = c.siteIds.reduce((n, id) => n + (worked.get(id)?.hours ?? 0), 0);
      const share = totalHours > 0 ? w.hours / totalHours : 1 / Math.max(1, c.siteIds.length);
      const bill = v ? contractBilling(v, period, RULES.contracts.value.daysPerMonthM1) : null;
      if (bill && v && v.billingMethod !== 'FIXED' && hoursBilled != null) hoursBilled += bill.lines.reduce((n, l) => n + l.hours, 0) * share;
      else hoursBilled = null;
      const line = (x.fin?.billing ?? []).find((b) => b.contractId === c.id && b.period === period) ?? null;
      if (line?.invoice) {
        if (invoiced != null) invoiced += line.invoice.amount * share;
      } else if (!line?.none?.checked) {
        invoiced = invoiced ?? 0;
        flag(
          'not_invoiced',
          c.id,
          line?.none ? `Contract ${c.ref}: "no invoice" reason waiting for a check (${line.none.reason})` : `Contract ${c.ref}: no invoice recorded for ${period}`,
          line?.none?.byId ?? null,
        );
      }
      // Methods 1 and 3 bill the hours worked: hours worked x the contract's rate per hour.
      if (v && (v.billingMethod === 'M1' || v.billingMethod === 'M3') && bill) {
        const hrs = bill.lines.reduce((n, l) => n + l.hours, 0);
        const rate = hrs > 0 ? bill.total / hrs : null;
        if (rate != null) {
          const exp = r2(totalHours * rate);
          expected = r2((expected ?? 0) + exp * share);
          if (line?.invoice && line.invoice.amount < exp * (1 - diffPct / 100))
            flag(
              'below_hours',
              c.id,
              `Contract ${c.ref}: invoice ${rm(line.invoice.amount)} is ${rm(exp - line.invoice.amount)} below ${r1(totalHours)} hours worked x ${rm(rate)} = ${rm(exp)}`,
              line.invoice.byId,
            );
        }
      }
      // The client's signed acknowledgement of the month's work (Client CRM, Fauzan 4 Nov 2026).
      const acc = x.clients.find((a) => a.id === c.clientAccountId) ?? x.clients.find((a) => a.siteIds.includes(site.id)) ?? null;
      const ack = acc?.workAcks?.find((k) => k.period === period) ?? null;
      if (!acc) flag('no_signoff', c.id, `Contract ${c.ref}: no client account linked, so the client's sign-off for ${period} is unknown`, line?.invoice?.byId ?? null);
      else if (!ack) flag('no_signoff', c.id, `${acc.name}: no signed acknowledgement of the ${period} work`, line?.invoice?.byId ?? null);
      else if (ack.outcome === 'complaints') flag('no_signoff', c.id, `${acc.name}: the client disputed the ${period} work: ${ack.comment.slice(0, 120)}`, line?.invoice?.byId ?? null);
    }
    const open = flags.filter((f) => !f.cleared);
    rows.push({
      siteId: site.id,
      siteName: site.name,
      companyId: site.companyId,
      guards: w.people.size,
      hoursWorked: r1(w.hours),
      hoursBilled: hoursBilled == null ? null : r1(hoursBilled),
      hoursDifference: hoursBilled == null ? null : r1(hoursBilled - w.hours),
      expected,
      invoiced: invoiced == null ? null : r2(invoiced),
      contracts: live.map((c) => ({ id: c.id, ref: c.ref, method: versionFor(c, period)?.billingMethod ?? null })),
      flags,
      flagged: open.length > 0,
    });
  }
  return rows.sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.siteName.localeCompare(b.siteName));
}

type Role = { see: (companyId: Id) => boolean; clear: (f: FinStatus) => boolean; all: boolean };

export class FinMonitorService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
  ) {}

  private today() {
    return dateOf(this.clock());
  }

  /** The month being closed (last month). */
  closePeriod(): string {
    const [y, m] = this.today().slice(0, 7).split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }

  /**
   * Who sees the unbilled-sites check: the Finance team for its companies, the FD and the CEO for all, and a company
   * manager for their own company. A Finance reviewer (deputy, team leader, FD, CEO) clears a flag. Nobody else.
   */
  private role(user: User): Role | null {
    if (user.integration) return null;
    const a = finActor(user);
    if (a && (isLead(a) || a.kind === 'leader' || a.kind === 'deputy' || a.kind === 'data_entry')) {
      const reviewer = isLead(a) || a.kind === 'leader' || a.kind === 'deputy';
      return { see: () => true, clear: (f) => reviewer && actsOn(a, f), all: isLead(a) };
    }
    if (user.role === 'company_manager') return { see: (id) => user.companyIds.includes(id), clear: () => false, all: false };
    return null;
  }

  private async scope(user: User, r: Role) {
    const ids = tenantCompanyIds(user, await this.store.list('grants'), this.today()).filter((id) => r.see(id));
    const fins = ids.length ? await this.store.list('finStatus', { companyId: ids }) : [];
    const a = finActor(user);
    // A Finance team sees its own companies only (Fauzan, 2 Nov 2026).
    const mine = a && !isLead(a) ? fins.filter((f) => actsOn(a, f)) : fins;
    const companyIds = a ? mine.map((f) => f.companyId) : ids;
    return { companyIds, fins };
  }

  /** The check for every company the person may see, for a finished month. */
  async unbilled(user: User, period?: string) {
    const r = this.role(user);
    if (!r) throw new AccessDenied('view', '(the unbilled sites check: Finance, the company manager, the FD and the CEO)');
    const close = this.closePeriod();
    const p = typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && period <= close ? period : close;
    const { companyIds, fins } = await this.scope(user, r);
    const data = await this.unbilledFor(companyIds, p, fins);
    return {
      period: p,
      periods: [close, prevP(close), prevP(prevP(close))],
      diffPct: data.diffPct,
      companies: data.companies.map((c) => ({ ...c, canClear: !!c.fin && r.clear(c.fin), fin: undefined })),
    };
  }

  /** The rows for a set of companies (also used by the CEO's monthly page). */
  async unbilledFor(companyIds: Id[], period: string, fins?: FinStatus[]) {
    const from = `${period}-01`;
    const to = addDays(periodEnd(period), 1);
    const [companies, sites, att, contracts, clients, rows, group] = await Promise.all([
      companyIds.length ? this.store.list('companies', { id: companyIds }) : Promise.resolve([]),
      companyIds.length ? this.store.list('sites', { companyId: companyIds }) : Promise.resolve([]),
      companyIds.length ? this.store.list('attendance', { companyId: companyIds }, { field: 'clockIn', from: addDays(from, -1), before: addDays(to, 1) }) : Promise.resolve([]),
      companyIds.length ? this.store.list('contracts', { companyId: companyIds }) : Promise.resolve([]),
      companyIds.length ? this.store.list('clientAccounts', { companyId: companyIds }) : Promise.resolve([]),
      fins ? Promise.resolve(fins) : companyIds.length ? this.store.list('finStatus', { companyId: companyIds }) : Promise.resolve([]),
      this.store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`).catch(() => null),
    ]);
    const diffPct = finSettingsOf(group, this.today()).billDiffPct;
    return {
      diffPct,
      companies: companyIds
        .map((id) => {
          const fin = rows.find((f) => f.companyId === id) ?? null;
          const list = finUnbilledSites({
            period,
            sites: sites.filter((s) => s.companyId === id),
            attendance: att.filter((a) => a.companyId === id),
            contracts: contracts.filter((c) => c.companyId === id),
            fin,
            clients: clients.filter((c) => c.companyId === id),
            diffPct,
          });
          return { companyId: id, companyName: companies.find((c) => c.id === id)?.name ?? id, fin, rows: list, flagged: list.filter((x) => x.flagged).length };
        })
        .sort((a, b) => b.flagged - a.flagged || a.companyName.localeCompare(b.companyName)),
    };
  }

  /** A Finance reviewer clears one flag with a reason; never the person who recorded that invoice. */
  async clearUnbilled(user: User, companyId: Id, input: { key: unknown; reason: unknown }) {
    const r = this.role(user);
    if (!r) throw new AccessDenied('view', '(Finance reviewers clear unbilled flags)');
    const key = typeof input.key === 'string' ? input.key : '';
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
    if (reason.length < 5) throw new BadRequest('Give the reason the flag is cleared (for example "free month in the contract").');
    const [period, siteId, kind, contractId] = key.split('|');
    if (!/^\d{4}-\d{2}$/.test(period ?? '') || !siteId || !(kind in UNBILLED_LABEL)) throw new BadRequest('Unknown flag.');
    return this.store.transaction(async (tx) => {
      const id = `fin-${companyId}`;
      await tx.lock?.('finStatus', id);
      const f = await tx.get('finStatus', id);
      if (!f) throw new NotFound('Company books');
      if (!r.clear(f)) throw new AccessDenied('view', '(only a Finance reviewer for this company: the deputy, the team leader, the FD or the CEO clears a flag)');
      const data = await this.unbilledFor([companyId], period, [f]);
      const flag = data.companies[0]?.rows.flatMap((x) => x.flags).find((x) => x.key === key);
      if (!flag) throw new NotFound('Flag');
      if (flag.cleared) throw new BadRequest('This flag is already cleared.');
      if (flag.recordedById === user.id) throw new AccessDenied('view', '(you recorded this invoice; another Finance reviewer clears the flag)');
      const row: UnbilledClear = { key, reason, by: user.name, byId: user.id, at: this.clock() };
      await tx.update('finStatus', id, { billingClears: [...(f.billingClears ?? []), row] });
      await tx.audit({
        at: row.at,
        actor: user.name,
        companyId,
        action: 'finance.unbilled.cleared',
        entity: 'fin_status',
        entityId: id,
        summary: `${UNBILLED_LABEL[kind as UnbilledKind]} cleared for ${siteId}${contractId ? ` (${contractId})` : ''}, ${period}: ${reason}`,
      });
      return row;
    });
  }
}

function prevP(p: string) {
  const [y, m] = p.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
