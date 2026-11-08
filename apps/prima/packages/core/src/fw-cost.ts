import type { FwCostRateStep } from "./types";
import type { FwPlacement } from "./types";
import type { IsoDate } from "./types";


export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** First and last day of a YYYY-MM month. */
export function monthBounds(month: string): { first: IsoDate; last: IsoDate } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, '0')}` };
}

/** Does the placement have at least one day inside the month? */
export function placementInMonth(p: Pick<FwPlacement, 'from' | 'to'>, month: string): boolean {
  const { first, last } = monthBounds(month);
  return p.from <= last && (p.to === null || p.to >= first);
}

/** The rate in force for a month: the latest step starting on or before it; null when none is set (Unknown). */
export function fwCostRateFor(steps: FwCostRateStep[] | undefined, month: string): number | null {
  // The newest-starting step wins; for the same start month the one set last wins (insertion order breaks a time tie).
  const live = (steps ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.from <= month)
    .sort((a, b) => b.s.from.localeCompare(a.s.from) || b.s.at.localeCompare(a.s.at) || b.i - a.i);
  return live[0]?.s.monthlyPerWorker ?? null;
}

/** Placements with at least one day in the month, one line per worker per group key (full month per worker). */
export function fwCostGroups(placements: FwPlacement[], month: string, key: (p: FwPlacement) => string): Map<string, Map<string, FwPlacement[]>> {
  const out = new Map<string, Map<string, FwPlacement[]>>();
  for (const p of placements) {
    if (!placementInMonth(p, month)) continue;
    const k = key(p);
    const people = out.get(k) ?? new Map<string, FwPlacement[]>();
    people.set(p.personId, [...(people.get(p.personId) ?? []), p]);
    out.set(k, people);
  }
  return out;
}

/**
 * Split one worker's monthly charge equally between the hosts they worked under in that month (Fauzan, 3 Nov 2026:
 * "the host cost split half"). Amounts are in whole sen; any leftover sen goes to the first host in the given order.
 */
export function fwCostSplit(rate: number, hosts: string[]): Map<string, { share: number; amount: number }> {
  const out = new Map<string, { share: number; amount: number }>();
  if (!hosts.length) return out;
  const sen = Math.round(rate * 100);
  const each = Math.floor(sen / hosts.length);
  hosts.forEach((h, i) => out.set(h, { share: 1 / hosts.length, amount: (each + (i === 0 ? sen - each * hosts.length : 0)) / 100 }));
  return out;
}

/**
 * The legal flag on recruitment cost. Fauzan, 3 Nov 2026: a legal flag never stops the system; it goes to the CEO
 * log, where the CEO records the details. Shown to the CEO only, never on staff screens.
 */
export const FW_COST_LEGAL_FLAG = {
  id: 'FWM-RECRUITMENT-COST-LEGAL',
  text:
    "A foreign worker's permit (PLKS) names the employer, and a security guard must be employed by the licensed company providing the service (Private Agencies Act 1971). A worker working under another company's job may need counsel's view. Fauzan checked on 3 Nov 2026: the worker keeps wearing the owning company's uniform, and KDN allows this.",
} as const;