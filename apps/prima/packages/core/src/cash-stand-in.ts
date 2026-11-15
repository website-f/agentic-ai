// B2 (Fauzan, 11 Nov 2026): "the FD can stand in for the CEO when needed". Cash decisions stay CEO-only unless the CEO
// turns the stand-in on in the app: for set dates while away, or for one named request. The Finance Director's decision
// needs a reason, the CEO gets a notice, and the FD never decides a request they made. Kept on the group Finance record
// (fin-pwvsb), like the approval limits. Before real cash is used, Finance and a legal adviser still review the cash
// treatment (8 Nov merge).
import type { Id, IsoDate, IsoDateTime, User } from './types';

export interface StandInStamp { by: string; byId: Id; at: IsoDateTime }
export type CashStandInKind = 'arrival' | 'exceptional';
export interface CashStandIn {
  /** Dates the CEO is away: the FD may decide any cash request in them. */
  windows: { id: Id; from: IsoDate; to: IsoDate; reason: string; set: StandInStamp; ended: StandInStamp | null }[];
  /** One named request the CEO asked the FD to decide. */
  requests: { id: Id; kind: CashStandInKind; companyId: Id; ref: string; reason: string; set: StandInStamp; ended: StandInStamp | null }[];
  /** Every decision the FD made as stand-in: the CEO's notice until seen. */
  uses: { id: Id; kind: CashStandInKind; companyId: Id; ref: string; approved: boolean; reason: string; amount: number; by: string; byId: Id; at: IsoDateTime; seen: StandInStamp | null }[];
}

export const emptyStandIn = (): CashStandIn => ({ windows: [], requests: [], uses: [] });
export const isFinanceDirector = (u: User) => !u.integration && u.leadership === 'finance_director';
export const isCashCeo = (u: User) => !u.integration && ['director', 'pwvsb_officer'].includes(u.role) && u.opsTier === 'ceo';

/** Why the FD may decide this request now, or null when the stand-in is off for it. */
export function standInCover(s: CashStandIn | undefined, kind: CashStandInKind, companyId: Id, ref: string, today: IsoDate): string | null {
  if (!s) return null;
  const w = s.windows.find((x) => !x.ended && x.from <= today && today <= x.to);
  if (w) return `CEO away ${w.from} to ${w.to}: ${w.reason}`;
  const r = s.requests.find((x) => !x.ended && x.kind === kind && x.companyId === companyId && x.ref === ref);
  if (r) return `CEO asked the FD to decide this request: ${r.reason}`;
  return null;
}

export function standInView(s: CashStandIn | undefined, today: IsoDate) {
  const x = s ?? emptyStandIn();
  return {
    activeWindow: x.windows.find((w) => !w.ended && w.from <= today && today <= w.to) ?? null,
    windows: x.windows.slice(-20).reverse(),
    requests: x.requests.filter((r) => !r.ended).slice(-50).reverse(),
    unseen: x.uses.filter((u) => !u.seen).reverse(),
    uses: x.uses.slice(-50).reverse(),
  };
}
