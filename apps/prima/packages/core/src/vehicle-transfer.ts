// E6 (Fauzan, 11 Nov 2026: "Moving vehicles between group companies: BUILD. Managed by the Transport department; the COO
// monitors."). A vehicle owned by one group company moves to another company's use in three steps:
//   1. the Transport department asks, with the company, the date and the reason;
//   2. another person approves or returns it with a comment: a second Transport department member or the COO, never the
//      person who asked;
//   3. the Transport department records the handover (date, odometer, who handed and who received, condition, what went
//      with it). Only then does the vehicle move: the same "used by" record the rent bills read (vehicle-rental.ts), so the
//      month's rent goes to the company using it on the month's last day. The owner (companyId) never changes here.
// The COO, the OGM and the group leaders see every request and its history. Synthetic data in tests only.
import { AccessDenied, isGroupLeader } from './access';
import { isOgm } from './ops-access';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { dateOf } from './time';
import type { Id, IsoDate, IsoDateTime, User, Vehicle } from './types';
import { vehicleUserOn } from './vehicle-rental';

export type VehicleTransferStatus = 'requested' | 'approved' | 'returned' | 'cancelled' | 'handed_over';

/** What went with the vehicle at the handover, ticked by Transport. */
export const HANDOVER_ITEMS = ['keys', 'registration', 'road_tax', 'insurance', 'fuel_card', 'logbook'] as const;
export type HandoverItem = (typeof HANDOVER_ITEMS)[number];
export const HANDOVER_ITEM_LABEL: Record<HandoverItem, string> = {
  keys: 'Keys',
  registration: 'Registration card (grant)',
  road_tax: 'Road tax',
  insurance: 'Insurance cover note',
  fuel_card: 'Fuel card',
  logbook: 'Vehicle logbook',
};

export interface VehicleTransfer {
  id: Id;
  ref: string;
  /** The vehicle's owner company (it stays the owner): the database row's company column. */
  companyId: Id;
  vehicleId: Id;
  plate: string;
  /** The company using the vehicle when the move was asked for. */
  fromCompanyId: Id;
  toCompanyId: Id;
  /** The day the move should start; the handover date is the day it does. */
  wantedOn: IsoDate;
  reason: string;
  status: VehicleTransferStatus;
  requestedBy: string;
  requestedById: Id;
  requestedAt: IsoDateTime;
  decision: { approve: boolean; note: string; by: string; byId: Id; role: 'transport' | 'coo'; at: IsoDateTime } | null;
  handover: {
    on: IsoDate;
    odometerKm: number;
    handedBy: string;
    receivedBy: string;
    condition: string;
    items: HandoverItem[];
    note: string;
    by: string;
    byId: Id;
    at: IsoDateTime;
  } | null;
  cancelled: { by: string; byId: Id; at: IsoDateTime; reason: string } | null;
}

/** Who works vehicle moves: Transport asks and hands over; Transport (not the asker) or the COO approves; others watch. */
export function vehicleTransferRole(u: User): 'transport' | 'coo' | 'monitor' | null {
  if (u.integration) return null;
  if (u.role === 'pwvsb_officer' && u.department === 'transport') return 'transport';
  if (u.role === 'pwvsb_officer' && u.opsTier === 'coo') return 'coo';
  if (isOgm(u) || isGroupLeader(u)) return 'monitor';
  return null;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isDay = (d: unknown): d is IsoDate => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
/** First day of last month: the earliest a move may start, so bills already raised do not change. */
const earliest = (today: IsoDate) => {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

export interface VehicleTransferDeps {
  /** Group companies a vehicle may be used by (the companies plus the central employers such as PGL). */
  companies(): Promise<{ id: Id; name: string }[]>;
}

export class VehicleTransferService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
    private deps: VehicleTransferDeps,
  ) {}

  private today(): IsoDate {
    return dateOf(this.now());
  }

  private async load(id: Id): Promise<VehicleTransfer> {
    const t = await this.store.get('vehicleTransfers', String(id ?? '').slice(0, 80));
    if (!t) throw new NotFound('Vehicle move');
    return t;
  }

  /** The board: open moves first, then the history; vehicles Transport can ask to move; what this person may do. */
  async board(user: User) {
    const role = vehicleTransferRole(user);
    if (!role) throw new AccessDenied('view', '(the Transport department, the COO, the OGM and the group leaders)');
    const [rows, vehicles, companies] = await Promise.all([this.store.list('vehicleTransfers', {}), this.store.list('vehicles', {}), this.deps.companies()]);
    const name = (id: Id) => companies.find((c) => c.id === id)?.name ?? id;
    const today = this.today();
    const order: Record<VehicleTransferStatus, number> = { requested: 0, approved: 1, returned: 2, handed_over: 3, cancelled: 4 };
    const moves = rows
      .sort((a, b) => order[a.status] - order[b.status] || b.requestedAt.localeCompare(a.requestedAt))
      .map((t) => ({
        ...t,
        fromName: name(t.fromCompanyId),
        toName: name(t.toCompanyId),
        ownerName: name(t.companyId),
        canDecide: t.status === 'requested' && (role === 'transport' || role === 'coo') && t.requestedById !== user.id,
        canHandOver: t.status === 'approved' && role === 'transport',
        canCancel: (t.status === 'requested' || t.status === 'approved') && (role === 'transport' || role === 'coo'),
        mine: t.requestedById === user.id,
      }));
    const open = new Set(rows.filter((t) => t.status === 'requested' || t.status === 'approved').map((t) => t.vehicleId));
    return {
      role,
      canRequest: role === 'transport',
      today,
      earliest: earliest(today),
      companies,
      vehicles: vehicles
        .filter((v) => !open.has(v.id))
        .sort((a, b) => a.plate.localeCompare(b.plate))
        .map((v) => ({ id: v.id, plate: v.plate, model: v.model, ownerId: v.companyId, ownerName: name(v.companyId), usedById: vehicleUserOn(v, today), usedByName: name(vehicleUserOn(v, today)) })),
      moves,
      counts: {
        toDecide: moves.filter((m) => m.canDecide).length,
        toHandOver: moves.filter((m) => m.canHandOver).length,
        open: moves.filter((m) => m.status === 'requested' || m.status === 'approved').length,
      },
      handoverItems: HANDOVER_ITEMS.map((k) => ({ key: k, label: HANDOVER_ITEM_LABEL[k] })),
    };
  }

  /** Step 1: the Transport department asks to move a vehicle to another company's use, from a date, with the reason. */
  async request(user: User, input: { vehicleId: Id; toCompanyId: Id; wantedOn: IsoDate; reason: string }): Promise<VehicleTransfer> {
    if (vehicleTransferRole(user) !== 'transport') throw new AccessDenied('view', '(the Transport department asks to move a vehicle)');
    const v = await this.store.get('vehicles', String(input.vehicleId ?? '').slice(0, 80));
    if (!v) throw new NotFound('Vehicle');
    const target = (await this.deps.companies()).find((c) => c.id === input.toCompanyId);
    if (!target) throw new BadRequest('Choose the company that will use the vehicle.');
    const reason = clean(input.reason, 300);
    if (reason.length < 5) throw new BadRequest('Give the reason for the move (at least 5 characters).');
    const today = this.today();
    if (!isDay(input.wantedOn) || input.wantedOn < earliest(today)) throw new BadRequest('Give the date: from the first day of last month at the earliest.');
    const from = vehicleUserOn(v, input.wantedOn);
    if (from === target.id) throw new BadRequest(`${target.name} already uses ${v.plate} on ${input.wantedOn}.`);
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('vehicles', v.id);
      const open = (await tx.list('vehicleTransfers', { vehicleId: v.id })).find((t) => t.status === 'requested' || t.status === 'approved');
      if (open) throw new BadRequest(`${v.plate} already has an open move (${open.ref}). Finish or cancel it first.`);
      const t: VehicleTransfer = {
        id: `vt-${globalThis.crypto.randomUUID()}`,
        ref: `VT-${today.replace(/-/g, '').slice(2)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        companyId: v.companyId,
        vehicleId: v.id,
        plate: v.plate,
        fromCompanyId: from,
        toCompanyId: target.id,
        wantedOn: input.wantedOn,
        reason,
        status: 'requested',
        requestedBy: user.name,
        requestedById: user.id,
        requestedAt: at,
        decision: null,
        handover: null,
        cancelled: null,
      };
      await tx.insert('vehicleTransfers', t);
      await tx.audit({ at, actor: user.name, companyId: v.companyId, action: 'fleet.transfer.request', entity: 'vehicle', entityId: v.id, summary: `${t.ref}: ${v.plate} to be used by ${target.name} from ${t.wantedOn}. Reason: ${reason}` });
      return t;
    });
  }

  /** Step 2: a second Transport department member or the COO approves or returns it, with a comment. Never the asker. */
  async decide(user: User, id: Id, approve: boolean, note: string): Promise<VehicleTransfer> {
    const role = vehicleTransferRole(user);
    if (role !== 'transport' && role !== 'coo') throw new AccessDenied('view', '(another Transport department member or the COO approves a vehicle move)');
    const t = await this.load(id);
    if (t.requestedById === user.id) throw new AccessDenied('view', '(you asked for this move; someone else must approve it)');
    const text = clean(note, 500);
    if (text.length < 3) throw new BadRequest(approve ? 'Write a comment to approve. A short one is fine.' : 'Write why you are returning it.');
    if (typeof approve !== 'boolean') throw new BadRequest('Say whether you approve.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('vehicleTransfers', t.id);
      const cur = (await tx.get('vehicleTransfers', t.id))!;
      if (cur.status !== 'requested') throw new BadRequest('This move was already decided or cancelled. Open it again.');
      const status: VehicleTransferStatus = approve ? 'approved' : 'returned';
      const saved = await tx.update('vehicleTransfers', t.id, { status, decision: { approve, note: text, by: user.name, byId: user.id, role, at } });
      await tx.audit({ at, actor: user.name, companyId: t.companyId, action: approve ? 'fleet.transfer.approve' : 'fleet.transfer.return', entity: 'vehicle', entityId: t.vehicleId, summary: `${t.ref}: ${t.plate} move ${approve ? 'approved' : 'returned'}. ${text}` });
      return saved;
    });
  }

  /**
   * Step 3: the Transport department records the handover. The vehicle moves from the handover date: a "used by" line
   * and a log line on the vehicle, in the same transaction, so the rent follows the company using it at month end.
   */
  async handover(
    user: User,
    id: Id,
    input: { on: IsoDate; odometerKm: number; handedBy: string; receivedBy: string; condition: string; items: string[]; note?: string },
  ): Promise<VehicleTransfer> {
    if (vehicleTransferRole(user) !== 'transport') throw new AccessDenied('view', '(the Transport department records the handover)');
    const t = await this.load(id);
    const today = this.today();
    if (!isDay(input.on) || input.on > today || input.on < earliest(today)) throw new BadRequest('Give the handover date: not in the future, and from the first day of last month at the earliest.');
    const km = Math.round(Number(input.odometerKm));
    if (!Number.isFinite(km) || km < 0 || km > 3_000_000) throw new BadRequest('Give the odometer reading in km.');
    const handedBy = clean(input.handedBy, 120);
    const receivedBy = clean(input.receivedBy, 120);
    if (handedBy.length < 2 || receivedBy.length < 2) throw new BadRequest('Give who handed the vehicle over and who received it.');
    if (handedBy.toLowerCase() === receivedBy.toLowerCase()) throw new BadRequest('The person handing over and the person receiving must be two different people.');
    const condition = clean(input.condition, 500);
    if (condition.length < 3) throw new BadRequest('Describe the condition of the vehicle at the handover.');
    const items = [...new Set((Array.isArray(input.items) ? input.items : []).filter((x): x is HandoverItem => (HANDOVER_ITEMS as readonly string[]).includes(x)))];
    if (!items.includes('keys')) throw new BadRequest('Tick the keys: a vehicle is handed over with its keys.');
    const note = clean(input.note, 500);
    const at = this.now();
    const companies = await this.deps.companies();
    const name = (cid: Id) => companies.find((c) => c.id === cid)?.name ?? cid;
    return this.store.transaction(async (tx) => {
      await tx.lock?.('vehicles', t.vehicleId);
      await tx.lock?.('vehicleTransfers', t.id);
      const cur = (await tx.get('vehicleTransfers', t.id))!;
      if (cur.status !== 'approved') throw new BadRequest('Only an approved move can be handed over. Open it again.');
      const v = (await tx.get('vehicles', t.vehicleId)) as Vehicle | undefined;
      if (!v) throw new NotFound('Vehicle');
      const last = [...(v.usedBy ?? [])].sort((a, b) => a.from.localeCompare(b.from)).at(-1);
      if (last && input.on <= last.from) throw new BadRequest(`The handover must be after the vehicle's last move (${last.from}).`);
      const current = vehicleUserOn(v, input.on);
      if (current === t.toCompanyId) throw new BadRequest(`${name(t.toCompanyId)} already uses ${v.plate} on ${input.on}.`);
      const handover = { on: input.on, odometerKm: km, handedBy, receivedBy, condition, items, note, by: user.name, byId: user.id, at };
      const why = `${t.reason} (${t.ref}, approved by ${cur.decision?.by ?? 'unknown'})`;
      await tx.update('vehicles', v.id, {
        usedBy: [...(v.usedBy ?? []), { companyId: t.toCompanyId, from: input.on, reason: why.slice(0, 300), by: user.name, at }],
        log: [...v.log, { at, by: user.name, what: `Handed over to ${name(t.toCompanyId)} on ${input.on} (was ${name(current)}), ${km} km, ${handedBy} to ${receivedBy}: ${t.ref}`, docId: null }],
        ...(km > (v.odometerKm ?? 0) ? { odometerKm: km } : {}),
      });
      const saved = await tx.update('vehicleTransfers', t.id, { status: 'handed_over', handover });
      await tx.audit({
        at,
        actor: user.name,
        companyId: v.companyId,
        action: 'fleet.move',
        entity: 'vehicle',
        entityId: v.id,
        summary: `${v.plate} used by ${name(t.toCompanyId)} from ${input.on}, was ${name(current)}. Owner stays ${name(v.companyId)}. Handed over ${handedBy} to ${receivedBy}, ${km} km. Reason: ${why}`,
      });
      return saved;
    });
  }

  /** Transport or the COO stops a move that is not handed over yet, with the reason. */
  async cancel(user: User, id: Id, reason: string): Promise<VehicleTransfer> {
    const role = vehicleTransferRole(user);
    if (role !== 'transport' && role !== 'coo') throw new AccessDenied('view', '(the Transport department or the COO cancels a vehicle move)');
    const t = await this.load(id);
    const text = clean(reason, 300);
    if (text.length < 3) throw new BadRequest('Give the reason for cancelling.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('vehicleTransfers', t.id);
      const cur = (await tx.get('vehicleTransfers', t.id))!;
      if (cur.status !== 'requested' && cur.status !== 'approved') throw new BadRequest('Only an open move can be cancelled.');
      const saved = await tx.update('vehicleTransfers', t.id, { status: 'cancelled', cancelled: { by: user.name, byId: user.id, at, reason: text } });
      await tx.audit({ at, actor: user.name, companyId: t.companyId, action: 'fleet.transfer.cancel', entity: 'vehicle', entityId: t.vehicleId, summary: `${t.ref}: ${t.plate} move cancelled. ${text}` });
      return saved;
    });
  }
}
