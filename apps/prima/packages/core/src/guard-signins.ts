// J5 (Fauzan, 11 Nov 2026: "Guard phone bulk sign-ins and 90-day location deletion: BUILD"). Part one: guard sign-ins
// made in bulk with a review step. Each guard's own sign-in (role guard, linked to their person record) is what the guard
// phone uses; today IT makes them one by one, and there are about 8,000 guards. HR or the company office (or the
// Operations Manager) prepares a batch from the company's active guards who have no sign-in yet; another person (HR, the
// company manager, the OGM or Operations Director, or the Chief of Staff or Deputy) approves it with a comment, never the
// person who prepared it, and the sign-ins are made at once. On PostgreSQL only the database itself makes them
// (prima.gsb_create in db/modules/guard-signins-v1.sql re-checks the batch and the approver): the API login cannot write
// sign-in accounts. A sign-in gives no way in by itself: the guard phone stays switched off (GUARD_PHONE) and the phone
// still needs enrolment, the PIN and the face.
import { AccessDenied } from './access';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { dateOf, toMs } from './time';
import type { Id, IsoDateTime, User } from './types';

export const GUARD_BATCH_MAX = 500;

export interface GuardSignInBatch {
  id: Id;
  ref: string;
  companyId: Id;
  rows: { personId: Id; staffNo: string; name: string }[];
  status: 'prepared' | 'approved' | 'created' | 'returned' | 'cancelled';
  note: string;
  preparedBy: string;
  preparedById: Id;
  preparedAt: IsoDateTime;
  decision: { approve: boolean; note: string; by: string; byId: Id; at: IsoDateTime } | null;
  created: { count: number; skipped: { personId: Id; why: string }[]; at: IsoDateTime } | null;
  cancelled: { by: string; at: IsoDateTime; reason: string } | null;
}

/** The sign-in id the batch gives a guard: one per person record, so a second batch never makes a second sign-in. */
export const guardUserId = (personId: Id) => `u-g-${personId}`;

const isHr = (u: User) => u.role === 'pwvsb_officer' && u.department === 'hr';
const isOpsLead = (u: User) => u.role === 'pwvsb_officer' && (u.opsTier === 'ogm' || u.opsTier === 'ops_director');
const isOm = (u: User) => u.role === 'pwvsb_officer' && u.department === 'operations' && (u.opsTier === 'om' || u.opsTier === 'regional');
const isCos = (u: User) => u.role === 'pwvsb_officer' && (u.leadership === 'cos' || u.leadership === 'deputy_cos');

/** Who prepares and who approves a batch for a company they can see. Mirrors prima.gsb_role in the module. */
export function guardSignInRole(u: User, companyId: Id, visible: Id[]): { prepare: boolean; approve: boolean } {
  if (u.integration || !visible.includes(companyId)) return { prepare: false, approve: false };
  const office = (u.role === 'company_manager' || u.role === 'admin_exec') && u.companyIds.includes(companyId);
  return {
    prepare: isHr(u) || office || isOm(u) || isOpsLead(u),
    approve: isHr(u) || (u.role === 'company_manager' && u.companyIds.includes(companyId)) || isOpsLead(u) || isCos(u),
  };
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

export interface GuardSignInDeps {
  visible(user: User): Promise<Id[]>;
  companyName(id: Id): Promise<string>;
}

export class GuardSignInService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
    private deps: GuardSignInDeps,
  ) {}

  /** Active guards of a company with no sign-in of their own yet. */
  private async candidates(companyId: Id) {
    const [people, users] = await Promise.all([this.store.list('people', { companyId: [companyId] }), this.store.list('users', {})]);
    const linked = new Set(users.filter((u) => u.personId).map((u) => u.personId!));
    return people
      .filter((p) => p.companyId === companyId && p.role === 'guard' && p.status === 'active' && !linked.has(p.id))
      .map((p) => ({ personId: p.id, staffNo: p.staffNo, name: p.name }))
      .sort((a, b) => a.staffNo.localeCompare(b.staffNo));
  }

  /** The companies this person may work on, the guards still without a sign-in, and the batches. */
  async board(user: User, companyId?: Id) {
    const visible = await this.deps.visible(user);
    const companies: { id: Id; name: string; prepare: boolean; approve: boolean }[] = [];
    for (const id of visible) {
      const r = guardSignInRole(user, id, visible);
      if (r.prepare || r.approve) companies.push({ id, name: await this.deps.companyName(id), ...r });
    }
    if (!companies.length) throw new AccessDenied('view', '(HR, the company office, the Operations Managers and their heads)');
    const chosen = companies.find((c) => c.id === companyId) ?? companies[0];
    const ids = new Set(companies.map((c) => c.id));
    const batches = (await this.store.list('guardSignInBatches', {}))
      .filter((b) => ids.has(b.companyId))
      .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt))
      .map((b) => {
        const r = companies.find((c) => c.id === b.companyId)!;
        return { ...b, companyName: r.name, canDecide: b.status === 'prepared' && r.approve && b.preparedById !== user.id, canCancel: b.status === 'prepared' && (b.preparedById === user.id || r.approve), mine: b.preparedById === user.id };
      });
    return {
      companies,
      companyId: chosen.id,
      candidates: chosen.prepare ? await this.candidates(chosen.id) : [],
      batches,
      max: GUARD_BATCH_MAX,
      counts: { toDecide: batches.filter((b) => b.canDecide).length, waiting: batches.filter((b) => b.status === 'prepared').length },
    };
  }

  /** Step 1: prepare a batch of guards (all chosen must still be without a sign-in), with a note. */
  async prepare(user: User, companyId: Id, personIds: Id[], note: string): Promise<GuardSignInBatch> {
    const visible = await this.deps.visible(user);
    if (!guardSignInRole(user, companyId, visible).prepare) throw new AccessDenied('view', '(HR, the company office or the Operations Manager prepares guard sign-ins)');
    const want = [...new Set((Array.isArray(personIds) ? personIds : []).map(String))];
    if (!want.length) throw new BadRequest('Choose at least one guard.');
    if (want.length > GUARD_BATCH_MAX) throw new BadRequest(`One batch holds at most ${GUARD_BATCH_MAX} guards. Make another batch for the rest.`);
    const open = new Set((await this.store.list('guardSignInBatches', {})).filter((b) => b.status === 'prepared').flatMap((b) => b.rows.map((r) => r.personId)));
    const cands = new Map((await this.candidates(companyId)).map((c) => [c.personId, c]));
    const bad = want.filter((id) => !cands.has(id));
    if (bad.length) throw new BadRequest(`${bad.length} of the chosen are not active guards of this company without a sign-in.`);
    const busy = want.filter((id) => open.has(id));
    if (busy.length) throw new BadRequest(`${busy.length} of the chosen are already in a batch waiting for approval.`);
    const at = this.now();
    const b: GuardSignInBatch = {
      id: `gsb-${toMs(at).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ref: `GS-${dateOf(at).replace(/-/g, '').slice(2)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      companyId,
      rows: want.map((id) => cands.get(id)!),
      status: 'prepared',
      note: clean(note, 300),
      preparedBy: user.name,
      preparedById: user.id,
      preparedAt: at,
      decision: null,
      created: null,
      cancelled: null,
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('guardSignInBatches', b);
      await tx.audit({ at, actor: user.name, companyId, action: 'guard.signins.prepare', entity: 'guard_signin_batch', entityId: b.id, summary: `${b.ref}: ${b.rows.length} guard sign-in${b.rows.length === 1 ? '' : 's'} prepared for approval.${b.note ? ` ${b.note}` : ''}` });
      return b;
    });
  }

  /** Step 2: another person approves (the sign-ins are made at once) or returns it, with a comment. */
  async decide(user: User, batchId: Id, approve: boolean, note: string): Promise<GuardSignInBatch> {
    const b = await this.store.get('guardSignInBatches', String(batchId ?? '').slice(0, 80));
    if (!b) throw new NotFound('Batch');
    const visible = await this.deps.visible(user);
    if (!guardSignInRole(user, b.companyId, visible).approve) throw new AccessDenied('view', '(HR, the company manager, the OGM or Operations Director, or the Chief of Staff approves guard sign-ins)');
    if (b.preparedById === user.id) throw new AccessDenied('view', '(you prepared this batch; someone else approves it)');
    const text = clean(note, 500);
    if (text.length < 3) throw new BadRequest(approve ? 'Write a comment to approve. A short one is fine.' : 'Write why you are returning it.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('guardSignInBatches', b.id);
      const cur = (await tx.get('guardSignInBatches', b.id))!;
      if (cur.status !== 'prepared') throw new BadRequest('This batch was already decided or cancelled. Open it again.');
      const decision = { approve, note: text, by: user.name, byId: user.id, at };
      if (!approve) {
        const saved = await tx.update('guardSignInBatches', b.id, { status: 'returned', decision });
        await tx.audit({ at, actor: user.name, companyId: b.companyId, action: 'guard.signins.return', entity: 'guard_signin_batch', entityId: b.id, summary: `${b.ref} returned. ${text}` });
        return saved;
      }
      await tx.update('guardSignInBatches', b.id, { status: 'approved', decision });
      let made: { count: number; skipped: { personId: Id; why: string }[] };
      if (tx.createGuardSignIns) made = await tx.createGuardSignIns(b.id);
      else made = await this.createInMemory(tx, cur, at);
      const saved = (await tx.get('guardSignInBatches', b.id))!;
      await tx.audit({
        at,
        actor: user.name,
        companyId: b.companyId,
        action: 'guard.signins.create',
        entity: 'guard_signin_batch',
        entityId: b.id,
        summary: `${b.ref} approved: ${made.count} guard sign-in${made.count === 1 ? '' : 's'} made${made.skipped.length ? `, ${made.skipped.length} skipped` : ''}. ${text}`,
      });
      return saved;
    });
  }

  /** The memory store's (test version) stand-in for prima.gsb_create: the same checks, the same rows. */
  private async createInMemory(tx: Store, b: GuardSignInBatch, at: IsoDateTime) {
    const [people, users] = await Promise.all([tx.list('people', { companyId: [b.companyId] }), tx.list('users', {})]);
    const linked = new Set(users.filter((u) => u.personId).map((u) => u.personId!));
    const skipped: { personId: Id; why: string }[] = [];
    let count = 0;
    for (const r of b.rows) {
      const p = people.find((x) => x.id === r.personId);
      if (!p || p.role !== 'guard' || p.status !== 'active') skipped.push({ personId: r.personId, why: 'no longer an active guard' });
      else if (linked.has(p.id) || users.some((u) => u.id === guardUserId(p.id))) skipped.push({ personId: r.personId, why: 'already has a sign-in' });
      else {
        await tx.insert('users', { id: guardUserId(p.id), name: p.name, title: `Guard ${p.staffNo}, own view only`, role: 'guard', companyIds: [b.companyId], siteIds: [], personId: p.id });
        count++;
      }
    }
    await tx.update('guardSignInBatches', b.id, { status: 'created', created: { count, skipped, at } });
    return { count, skipped };
  }

  /** The preparer or an approver withdraws a batch still waiting, with the reason. */
  async cancel(user: User, batchId: Id, reason: string): Promise<GuardSignInBatch> {
    const b = await this.store.get('guardSignInBatches', String(batchId ?? '').slice(0, 80));
    if (!b) throw new NotFound('Batch');
    const r = guardSignInRole(user, b.companyId, await this.deps.visible(user));
    if (b.preparedById !== user.id && !r.approve) throw new AccessDenied('view', '(the person who prepared it or an approver)');
    const why = clean(reason, 300);
    if (why.length < 3) throw new BadRequest('Give the reason for cancelling.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('guardSignInBatches', b.id);
      const cur = (await tx.get('guardSignInBatches', b.id))!;
      if (cur.status !== 'prepared') throw new BadRequest('Only a batch waiting for approval can be cancelled.');
      const saved = await tx.update('guardSignInBatches', b.id, { status: 'cancelled', cancelled: { by: user.name, at, reason: why } });
      await tx.audit({ at, actor: user.name, companyId: b.companyId, action: 'guard.signins.cancel', entity: 'guard_signin_batch', entityId: b.id, summary: `${b.ref} cancelled. ${why}` });
      return saved;
    });
  }
}
