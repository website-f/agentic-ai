import { sha256Hex } from "./audit";
import { AccessDenied } from "./access";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { PrimaService } from "./service";
import type { Store } from "./store";
import type { Id } from "./types";
import type { IsoDateTime } from "./types";
import type { ItTicketCategory } from "./types";
import type { User } from "./types";


/** The server-issued offline window: work saved offline must reach the server within 72 hours of the lease. */
export const OFFLINE_LEASE_HOURS = 72;
/** At most this many operations per sync call (Arisha main, 31 Oct 2026: a reasonable cap). */
export const OFFLINE_MAX_OPS = 50;
/** At most this many leases open at once per person (one per device or browser). */
export const OFFLINE_MAX_LEASES = 5;

export type OfflineKind = 'helpRequest' | 'jobNote';
export type OfflineStatus = 'applied' | 'needs_review' | 'rejected' | 'discarded';
export type OfflineReason =
  | 'duplicate_suspected'
  | 'job_changed'
  | 'not_allowed'
  | 'not_found'
  | 'bad_payload'
  | 'lease_expired'
  | 'lease_not_valid';

/** A window for offline work, issued by the server to one person for one device label. */
export interface OfflineLease {
  id: Id;
  userId: Id;
  /** A browser-install label chosen by the device. A label only: never proof that the device is trusted. */
  deviceLabel: string;
  issuedAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

/**
 * One offline operation, by person and operation ID, kept for good: the ID can never be used again, whatever happens
 * to the receipt's details. No payload is kept, only its fingerprint.
 */
export interface OfflineOp {
  /** `${userId}:${opId}` */
  id: string;
  userId: Id;
  opId: string;
  leaseId: string;
  kind: OfflineKind;
  payloadHash: string;
  status: OfflineStatus;
  reason: OfflineReason | null;
  /** The ticket or job it created or changed. */
  resultId: Id | null;
  /** Device time when saved: information only, never trusted. */
  deviceAt: string | null;
  receivedAt: IsoDateTime;
  decidedAt: IsoDateTime;
}

export interface OfflineReceipt {
  opId: string;
  status: OfflineStatus | 'conflict' | 'error';
  reason: OfflineReason | 'op_id_reused' | 'try_again' | null;
  resultId: Id | null;
  /** True when this is the receipt kept from an earlier send of the same operation. */
  replayed: boolean;
  serverAt: IsoDateTime;
}

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CATEGORIES: ItTicketCategory[] = ['ACCOUNT', 'DEVICE', 'M365', 'NETWORK', 'PRIMA', 'OTHER'];
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exactKeys = (x: unknown, keys: readonly string[]): x is Record<string, unknown> =>
  isObj(x) && keys.every((k) => k in x) && Object.keys(x).every((k) => keys.includes(k));
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** JSON with keys sorted, so the same payload always has the same fingerprint. */
function stableJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableJson).join(',')}]`;
  if (isObj(x)) return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stableJson(x[k])}`).join(',')}}`;
  return JSON.stringify(x ?? null);
}

export function offlinePayloadHash(kind: string, payload: unknown): string {
  return sha256Hex(stableJson({ kind, payload }));
}

/** Who may work offline: an allow-list by user ID (OFFLINE_SYNC_USERS), never an integration or a shared site device. */
export function offlineAllowed(user: User, allowed: readonly string[]): boolean {
  return allowed.includes(user.id) && !user.integration && user.role !== 'site_device';
}

type OpIn = { opId: string; leaseId: string; kind: unknown; createdAt: unknown; payload: unknown };

class Held extends Error {
  constructor(public status: OfflineStatus, public reason: OfflineReason, public resultId: Id | null = null) {
    super(reason);
  }
}

export class OfflineSyncService {
  constructor(
    private store: Store,
    private svc: PrimaService,
    private allowed: readonly string[],
  ) {}

  private gate(user: User) {
    if (!offlineAllowed(user, this.allowed)) throw new AccessDenied('view', '(offline work is not switched on for you)');
  }

  /**
   * A new 72-hour window for this device label, issued while online. There is no renewal: a new lease is a new slot, and
   * older leases stay valid until they end. Work saved under an older lease stays bound to that lease (see `one`), so a
   * new lease never extends it.
   */
  async lease(user: User, body: unknown): Promise<OfflineLease> {
    this.gate(user);
    if (!exactKeys(body, ['deviceLabel'])) throw new BadRequest('Send the device label.');
    const label = typeof body.deviceLabel === 'string' ? body.deviceLabel.trim() : '';
    if (label.length < 3 || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) throw new BadRequest('Give the device a label of 3 to 80 characters.');
    return this.store.transaction(async (tx) => {
      // Serialize this person's lease count, so two requests at once cannot both take the last slot.
      await tx.lock?.('offlineLeases', `user:${user.id}`);
      const now = this.svc.now();
      const open = (await tx.list('offlineLeases', { userId: user.id })).filter((l) => Date.parse(l.expiresAt) > Date.parse(now));
      if (open.length >= OFFLINE_MAX_LEASES) throw new BadRequest(`At most ${OFFLINE_MAX_LEASES} devices can work offline at once. Wait for one to end.`);
      const lease: OfflineLease = {
        id: crypto.randomUUID(),
        userId: user.id,
        deviceLabel: label,
        issuedAt: now,
        expiresAt: new Date(Date.parse(now) + OFFLINE_LEASE_HOURS * 3_600_000).toISOString(),
      };
      await tx.insert('offlineLeases', lease);
      await tx.audit({ at: now, actor: user.name, companyId: null, action: 'offline.lease', entity: 'offline_lease', entityId: lease.id, summary: JSON.stringify({ expiresAt: lease.expiresAt }) });
      return lease;
    });
  }

  /** Receipts for the given operation IDs (to settle a lost answer before sending again), or every receipt since a time. */
  async receipts(user: User, query: { opIds?: string[]; since?: string }): Promise<OfflineReceipt[]> {
    this.gate(user);
    const rows = (await this.store.list('offlineOps', { userId: user.id })).filter((r) =>
      query.opIds ? query.opIds.includes(r.opId) : !query.since || Date.parse(r.decidedAt) >= Date.parse(query.since),
    );
    return rows.map((r) => this.receipt(r, true));
  }

  private receipt(r: OfflineOp, replayed: boolean): OfflineReceipt {
    return { opId: r.opId, status: r.status, reason: r.reason, resultId: r.resultId, replayed, serverAt: r.decidedAt };
  }

  /**
   * Apply queued operations in order, each on its own: its effect and its receipt land together or not at all. An
   * unexpected failure stops the batch there, so later operations are not applied out of order; the device sends them
   * again. Every rule is checked as if the person acted now.
   */
  async sync(user: User, body: unknown): Promise<{ receipts: OfflineReceipt[] }> {
    this.gate(user);
    if (!exactKeys(body, ['ops'])) throw new BadRequest('Send the operations.');
    if (!Array.isArray(body.ops) || body.ops.length === 0 || body.ops.length > OFFLINE_MAX_OPS) throw new BadRequest(`Send 1 to ${OFFLINE_MAX_OPS} operations.`);
    const seen = new Set<string>();
    for (const op of body.ops) {
      if (!exactKeys(op, ['opId', 'leaseId', 'kind', 'createdAt', 'payload']) || typeof op.opId !== 'string' || !UUID4.test(op.opId) || typeof op.leaseId !== 'string' || !UUID4.test(op.leaseId))
        throw new BadRequest('Each operation needs its ID (UUID v4), the lease it was saved under, kind, time and content.');
      if (seen.has(op.opId)) throw new BadRequest('The same operation is in this batch twice.');
      seen.add(op.opId);
    }
    const receipts: OfflineReceipt[] = [];
    for (const op of body.ops as OpIn[]) {
      try {
        receipts.push(await this.store.transaction((tx) => this.one(tx, user, op)));
      } catch {
        // Not decided: nothing of this operation was kept. Stop so the rest keep their order.
        receipts.push({ opId: op.opId, status: 'error', reason: 'try_again', resultId: null, replayed: false, serverAt: this.svc.now() });
        break;
      }
    }
    return { receipts };
  }

  /**
   * Each operation names the lease it was saved under, and only that lease counts: work saved under a lease that has
   * ended is refused, even when the device holds a newer lease. A device that relabels old work with a newer lease is
   * the signed-in person sending it now: every rule and the record time are taken at sync, so nothing is gained. Proving
   * when a device really saved something needs device-held keys, which belong to the device-trust review.
   */
  private async one(tx: Store, user: User, op: OpIn): Promise<OfflineReceipt> {
    const leaseId = op.leaseId;
    const key = `${user.id}:${op.opId}`;
    await tx.lock?.('offlineOps', key);
    const kind = op.kind;
    const hash = offlinePayloadHash(String(kind), op.payload);
    const prior = await tx.get('offlineOps', key);
    if (prior) {
      if (prior.payloadHash !== hash || prior.kind !== kind) return { opId: op.opId, status: 'conflict', reason: 'op_id_reused', resultId: null, replayed: false, serverAt: this.svc.now() };
      return this.receipt(prior, true);
    }
    const now = this.svc.now();
    let status: OfflineStatus = 'applied';
    let reason: OfflineReason | null = null;
    let resultId: Id | null = null;
    try {
      if (kind !== 'helpRequest' && kind !== 'jobNote') throw new Held('rejected', 'bad_payload');
      const lease = await tx.get('offlineLeases', leaseId);
      if (!lease || lease.userId !== user.id) throw new Held('rejected', 'lease_not_valid');
      if (Date.parse(now) >= Date.parse(lease.expiresAt)) throw new Held('rejected', 'lease_expired');
      resultId = kind === 'helpRequest' ? await this.helpRequest(tx, user, op.payload, op.opId, false) : await this.jobNote(tx, user, op.payload, false);
    } catch (e) {
      if (!(e instanceof Held)) throw e;
      status = e.status;
      reason = e.reason;
      resultId = e.resultId;
    }
    const row: OfflineOp = {
      id: key,
      userId: user.id,
      opId: op.opId,
      leaseId,
      kind: kind === 'jobNote' ? 'jobNote' : 'helpRequest',
      payloadHash: hash,
      status,
      reason,
      resultId,
      deviceAt: typeof op.createdAt === 'string' ? op.createdAt.slice(0, 40) : null,
      receivedAt: now,
      decidedAt: now,
    };
    await tx.insert('offlineOps', row);
    await this.audit(tx, user, row);
    return this.receipt(row, false);
  }

  /**
   * The person decides a held operation online: send it anyway (the device sends the same content, which must match the
   * fingerprint) or discard it. Once only. The usual rules still apply when sending.
   */
  async resolve(user: User, opId: unknown, body: unknown): Promise<OfflineReceipt> {
    this.gate(user);
    if (typeof opId !== 'string' || !UUID4.test(opId)) throw new NotFound('Offline operation');
    if (!isObj(body) || (body.action !== 'send' && body.action !== 'discard')) throw new BadRequest('Choose send or discard.');
    return this.store.transaction(async (tx) => {
      const key = `${user.id}:${opId}`;
      await tx.lock?.('offlineOps', key);
      const r = await tx.get('offlineOps', key);
      if (!r || r.userId !== user.id) throw new NotFound('Offline operation');
      if (r.status !== 'needs_review') throw new BadRequest(`This operation is already ${r.status}.`);
      const now = this.svc.now();
      let patch: Partial<OfflineOp>;
      if (body.action === 'discard') {
        if (!exactKeys(body, ['action'])) throw new BadRequest('Send only the choice.');
        patch = { status: 'discarded', decidedAt: now };
      } else {
        if (!exactKeys(body, ['action', 'payload'])) throw new BadRequest('Send the same content again.');
        if (offlinePayloadHash(r.kind, body.payload) !== r.payloadHash) throw new BadRequest('That is not the content that was held. Nothing was sent.');
        try {
          const id = r.kind === 'helpRequest' ? await this.helpRequest(tx, user, body.payload, r.opId, true) : await this.jobNote(tx, user, body.payload, true);
          patch = { status: 'applied', reason: null, resultId: id, decidedAt: now };
        } catch (e) {
          if (!(e instanceof Held)) throw e;
          patch = { status: 'rejected', reason: e.reason, decidedAt: now };
        }
      }
      const done = await tx.update('offlineOps', key, patch);
      await this.audit(tx, user, done);
      return this.receipt(done, false);
    });
  }

  private async audit(tx: Store, user: User, r: OfflineOp) {
    await tx.audit({
      at: r.decidedAt,
      actor: user.name,
      companyId: null,
      action: `offline.op.${r.status}`,
      entity: 'offline_op',
      entityId: r.id,
      summary: JSON.stringify({ kind: r.kind, status: r.status, reason: r.reason, resultId: r.resultId }),
    });
  }

  /** helpRequest { title, category, priority, detail }: a likely repeat of an open request of the same person is held. */
  private async helpRequest(tx: Store, user: User, payload: unknown, opId: string, confirmed: boolean): Promise<Id> {
    if (!exactKeys(payload, ['title', 'category', 'priority', 'detail'])) throw new Held('rejected', 'bad_payload');
    const { title, category, priority, detail } = payload;
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || typeof detail !== 'string' || detail.length > 1000) throw new Held('rejected', 'bad_payload');
    if (!CATEGORIES.includes(category as ItTicketCategory) || !['P1', 'P2', 'P3'].includes(priority as string)) throw new Held('rejected', 'bad_payload');
    if (!confirmed) {
      // Serialize this person's duplicate check: two different operations with the same title, sent at once from two
      // devices, cannot both pass it. The lock is held until the request's transaction ends.
      await tx.lock?.('offlineOps', `help:${user.id}`);
      const open = (await tx.list('itTickets', {})).find((t) => t.raisedById === user.id && t.status !== 'resolved' && squash(t.title) === squash(title));
      if (open) throw new Held('needs_review', 'duplicate_suspected', open.id);
    }
    try {
      const t = await this.svc.raiseItTicket(user, { category: category as ItTicketCategory, priority: priority as 'P1' | 'P2' | 'P3', title, detail });
      await tx.update('itTickets', t.id, { offlineOpId: opId });
      return t.id;
    } catch (e) {
      if (e instanceof AccessDenied) throw new Held('rejected', 'not_allowed');
      if (e instanceof BadRequest) throw new Held('rejected', 'bad_payload');
      throw e;
    }
  }

  /**
   * jobNote { targetId, baseVersion, note }: baseVersion is the number of entries in the job's log when the device last
   * saw it. If the job moved on, or closed, the note is held for the person to look at; nothing is appended blindly.
   */
  private async jobNote(tx: Store, user: User, payload: unknown, confirmed: boolean): Promise<Id> {
    if (!exactKeys(payload, ['targetId', 'baseVersion', 'note'])) throw new Held('rejected', 'bad_payload');
    const { targetId, baseVersion, note } = payload;
    if (typeof targetId !== 'string' || !Number.isInteger(baseVersion) || (baseVersion as number) < 0 || typeof note !== 'string' || !note.trim() || note.length > 500) throw new Held('rejected', 'bad_payload');
    await tx.lock?.('itJobs', targetId);
    const j = await tx.get('itJobs', targetId);
    if (!j) throw new Held('rejected', 'not_found');
    if (!confirmed && (j.log.length !== baseVersion || ['accepted', 'cancelled'].includes(j.status))) throw new Held('needs_review', 'job_changed', j.id);
    try {
      await this.svc.itJobStep(user, j.id, 'note', note);
      return j.id;
    } catch (e) {
      if (e instanceof AccessDenied || e instanceof NotFound) throw new Held('rejected', 'not_allowed');
      if (e instanceof BadRequest) throw new Held('rejected', 'not_allowed');
      throw e;
    }
  }
}