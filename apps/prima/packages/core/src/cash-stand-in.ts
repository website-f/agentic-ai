// P100 B2 (Fauzan, 11 Nov 2026: "the FD can stand in for the CEO when needed"; "the FD can decide when the CEO is away, or
// at any time the CEO asks"). Cash decisions stay the CEO's: the arrival cash advance (the FWM Manager asks, the CEO
// decides) and exceptional guard cash (the DOA list, CEO approval). The CEO turns a stand-in on in the app, for set dates
// while away or for one named request, with a reason. While it is on, the Finance Director may decide in the CEO's place:
// with a reason, labelled "standing in for the CEO", never on a request the FD made, and the CEO is told every time.
// Kept in prima.cash_stand_ins (db/modules/cash-stand-ins-v1.sql, an office module; the CEO writes, the CEO and FD read).
import { AccessDenied } from './access';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import type { Id, IsoDate, IsoDateTime, User } from './types';

export type CashStandInArea = 'arrival' | 'exceptional';

export interface CashStandInUse {
  at: IsoDateTime;
  area: CashStandInArea;
  companyId: Id;
  /** The arrival request or the exceptional cash approval reference decided. */
  ref: string;
  byId: Id;
  by: string;
  decision: 'approved' | 'refused';
  amount: number;
  reason: string;
  /** The CEO has seen the notice. */
  seen: boolean;
}

export interface CashStandIn {
  id: Id;
  /** 'dates': the CEO is away from..to (Malaysia dates, both counted); 'request': one named request only. */
  kind: 'dates' | 'request';
  from: IsoDate | null;
  to: IsoDate | null;
  request: { area: CashStandInArea; companyId: Id; ref: string } | null;
  reason: string;
  set: { by: string; byId: Id; at: IsoDateTime };
  ended: { by: string; byId: Id; at: IsoDateTime; reason: string } | null;
  uses: CashStandInUse[];
}

/** The CEO (who decides cash and turns the stand-in on). */
export const isCashCeo = (u: User) => !u.integration && ['director', 'pwvsb_officer'].includes(u.role) && u.opsTier === 'ceo';
/** The Finance Director (who may stand in). */
export const isFinanceDirector = (u: User) => !u.integration && u.role === 'pwvsb_officer' && u.leadership === 'finance_director' && u.opsTier !== 'ceo';

const text = (v: unknown, label: string, min = 5) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > 300) throw new BadRequest(`${label} is needed (at least ${min} letters).`);
  return s;
};
const day = (v: unknown, label: string) => {
  const s = typeof v === 'string' ? v : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw new BadRequest(`Give the ${label} as a date.`);
  return s;
};

/** Whether a stand-in covers a decision today on this request. */
export function standInCovers(s: CashStandIn, area: CashStandInArea, companyId: Id, ref: string, today: IsoDate): boolean {
  if (s.ended) return false;
  if (s.kind === 'dates') return !!s.from && !!s.to && s.from <= today && today <= s.to;
  return !!s.request && s.request.area === area && s.request.companyId === companyId && s.request.ref === ref && !s.uses.length;
}

export class CashStandInService {
  constructor(private store: Store, private now: () => IsoDateTime) {}
  private today() {
    return this.now().slice(0, 10);
  }
  private async rows(st: Store = this.store): Promise<CashStandIn[]> {
    try {
      return await st.list('cashStandIns', {});
    } catch (e) {
      if (e instanceof BadRequest) return [];
      throw e;
    }
  }

  /** The CEO's and the FD's view: every stand-in, what is on now, and the CEO's notices not yet seen. */
  async view(user: User) {
    if (!isCashCeo(user) && !isFinanceDirector(user)) throw new AccessDenied('view', '(cash stand-in: the CEO and the Finance Director)');
    const rows = (await this.rows()).sort((a, b) => b.set.at.localeCompare(a.set.at));
    const today = this.today();
    const active = rows.filter((s) => !s.ended && (s.kind === 'request' ? !s.uses.length : (s.to ?? '') >= today));
    return {
      canSet: isCashCeo(user),
      standsIn: isFinanceDirector(user),
      onNow: active.filter((s) => s.kind === 'request' || ((s.from ?? '') <= today && today <= (s.to ?? ''))).length > 0,
      active,
      past: rows.filter((s) => !active.includes(s)).slice(0, 20),
      unseen: isCashCeo(user) ? rows.flatMap((s) => s.uses.filter((u) => !u.seen).map((u) => ({ ...u, standInId: s.id }))) : [],
    };
  }

  /** The CEO turns a stand-in on (dates or one request), ends one early, or marks the FD's decisions seen. */
  async action(user: User, action: string, body: Record<string, unknown>) {
    if (!isCashCeo(user)) throw new AccessDenied('view', '(cash stand-in: the CEO only)');
    const at = this.now();
    const by = { by: user.name, byId: user.id, at };
    return this.store.transaction(async (tx) => {
      if (action === 'set') {
        const reason = text(body.reason, 'The reason');
        let row: CashStandIn;
        if (body.kind === 'dates') {
          const from = day(body.from, 'first day away');
          const to = day(body.to, 'last day away');
          if (to < from) throw new BadRequest('The last day comes after the first.');
          if (to < this.today()) throw new BadRequest('These dates are already over.');
          if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 60) throw new BadRequest('At most 60 days at a time; set another stand-in after.');
          row = { id: `csi-${at.replace(/\D/g, '').slice(0, 14)}-${from}`, kind: 'dates', from, to, request: null, reason, set: by, ended: null, uses: [] };
        } else if (body.kind === 'request') {
          const area = body.area === 'arrival' || body.area === 'exceptional' ? body.area : null;
          if (!area) throw new BadRequest('Choose arrival cash or exceptional guard cash.');
          const companyId = text(body.companyId, 'The company', 1).slice(0, 120);
          const ref = text(body.ref, 'The request reference', 1).slice(0, 120);
          row = { id: `csi-${at.replace(/\D/g, '').slice(0, 14)}-${area}-${ref}`.slice(0, 120), kind: 'request', from: null, to: null, request: { area, companyId, ref }, reason, set: by, ended: null, uses: [] };
        } else throw new BadRequest('Choose dates away or one request.');
        if (await tx.get('cashStandIns', row.id)) throw new BadRequest('This stand-in is already set.');
        await tx.insert('cashStandIns', row);
        await tx.audit({ at, actor: user.name, companyId: null, action: 'cash.standin_set', entity: 'cash_stand_in', entityId: row.id, summary: `FD stands in for the CEO on cash ${row.kind === 'dates' ? `from ${row.from} to ${row.to}` : `for ${row.request!.area} request ${row.request!.ref}`}: ${reason}` });
        return row;
      }
      const id = String(body.id ?? '').slice(0, 120);
      await tx.lock?.('cashStandIns', id);
      const s = await tx.get('cashStandIns', id);
      if (!s) throw new NotFound('Stand-in');
      if (action === 'end') {
        if (s.ended) throw new BadRequest('This stand-in has already ended.');
        const reason = text(body.reason, 'The reason');
        await tx.update('cashStandIns', id, { ended: { ...by, reason } });
        await tx.audit({ at, actor: user.name, companyId: null, action: 'cash.standin_end', entity: 'cash_stand_in', entityId: id, summary: `FD cash stand-in ended: ${reason}` });
      } else if (action === 'seen') {
        await tx.update('cashStandIns', id, { uses: s.uses.map((u) => ({ ...u, seen: true })) });
      } else throw new BadRequest('Unknown stand-in action.');
      return (await tx.get('cashStandIns', id))!;
    });
  }
}

/**
 * Inside a cash decision's own transaction: whether this decider may decide in the CEO's place, and if so the stand-in
 * that allows it. The CEO decides as before (null). The FD needs a stand-in covering today or this request, a reason, and
 * may never decide a request they made. Anyone else is refused.
 */
export async function cashDeciderStandIn(
  tx: Store,
  u: User,
  area: CashStandInArea,
  companyId: Id,
  ref: string,
  madeBy: Id[],
  today: IsoDate,
): Promise<CashStandIn | null> {
  if (isCashCeo(u)) return null;
  if (!isFinanceDirector(u)) throw new AccessDenied('view', '(cash decisions: the CEO, or the Finance Director standing in)');
  if (madeBy.includes(u.id)) throw new BadRequest('You made this request, so you cannot decide it, even standing in for the CEO.');
  let rows: CashStandIn[] = [];
  try {
    rows = await tx.list('cashStandIns', {});
  } catch (e) {
    if (!(e instanceof BadRequest)) throw e;
  }
  // A one-request stand-in first, then dates away.
  const s = rows.filter((x) => standInCovers(x, area, companyId, ref, today)).sort((a, b) => (a.kind === 'request' ? -1 : 1) - (b.kind === 'request' ? -1 : 1))[0];
  if (!s) throw new AccessDenied('view', '(cash decisions: the CEO has not asked the Finance Director to stand in for this)');
  return s;
}

/** Records the FD's decision on the stand-in, as the CEO's notice. */
export async function recordStandInUse(tx: Store, s: CashStandIn, use: Omit<CashStandInUse, 'seen'>): Promise<void> {
  await tx.lock?.('cashStandIns', s.id);
  const cur = (await tx.get('cashStandIns', s.id)) ?? s;
  await tx.update('cashStandIns', s.id, { uses: [...cur.uses, { ...use, seen: false }] });
}
