// E8 Foreign workers (Fauzan, 11 Nov 2026: "Tell Fitri to build"; handover A4 / E8). Built on what exists, never a
// second copy: the hostel register and its bills (Hostels screen), the hostel stays table (bed-days for the utility
// shares, which until now had no way to be filled), and the FWM task to the OM (Foreign workers screen).
//   1. Hostels in Prima: FWM or the company office checks a worker into a hostel (a bed, from a date); one open stay
//      per worker; a full hostel refuses another resident.
//   2. Check-out memo: FWM or the company office prepares the memo when a worker leaves the hostel (key, bedding,
//      locker, room, damage, money the worker still owes noted for HR only, the worker's signed copy). The FWM Manager
//      or Deputy approves it with a reason, never the person who prepared it; only then does the stay end. Nothing is
//      ever taken from pay here (deductions stay switched off).
//   3. Permit task during long SOCSO MC: a foreign worker on SOCSO MC of 4 days or more in a row (the days PERKESO pays,
//      rule SOCSO-INJURY-MC) whose permit enters its reminder window (rule HR-CRED-LEAD: PLKS 90, passport 180, FOMEMA
//      60, foreign worker insurance 60 days, approved 11 Nov 2026 as G10) before the MC ends cannot be sent for the
//      renewal himself. FWM sees him on the board and on Home, and sends the OM a "permit during SOCSO MC" task with
//      one tap; the OM gets the passport and papers and uploads proof, FWM accepts it (the existing task steps).
// Stays live in prima.hostel_stays (base schema, company wall): no new table.

import { AccessDenied, isOwnerAdmin } from './access';
import { latestCredentials } from './checks';
import { RULES } from './rules';
import type { HomeItem, PrimaService, ProofInput } from './service';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { addDays, toMs } from './time';
import type { Credential, CredentialType, FwmTask, Hostel, HostelStay, Id, IsoDate, IsoDateTime, Person, SocsoClaim, User } from './types';

export type CheckoutReason = 'LEFT_COMPANY' | 'TRANSFER' | 'REPATRIATION' | 'MOVED_HOSTEL' | 'OTHER';
export type WorkerAck = 'SIGNED' | 'REFUSED' | 'NOT_AVAILABLE';

export const CHECKOUT_REASON_LABEL: Record<CheckoutReason, string> = {
  LEFT_COMPANY: 'Left the company',
  TRANSFER: 'Transferred to another site or company',
  REPATRIATION: 'Going home (repatriation)',
  MOVED_HOSTEL: 'Moved to another hostel',
  OTHER: 'Other reason',
};

export const WORKER_ACK_LABEL: Record<WorkerAck, string> = {
  SIGNED: 'The worker signed the memo',
  REFUSED: 'The worker refused to sign (witnessed)',
  NOT_AVAILABLE: 'The worker was not there to sign',
};

export interface StayStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

/** The check-out memo on a stay. The stay ends only when the FWM Manager or Deputy approves it. */
export interface CheckoutMemo {
  outOn: IsoDate;
  reason: CheckoutReason;
  keyReturned: boolean;
  beddingReturned: boolean;
  lockerCleared: boolean;
  roomOk: boolean;
  damage: string;
  /** Money the worker may still owe (a share of a bill, a lost key), written down for HR. Never taken from pay here. */
  owedNote: string;
  workerAck: WorkerAck;
  docIds: Id[];
  prepared: StayStep;
  decided: (StayStep & { approve: boolean }) | null;
  version: number;
}


export const FW_EXTRA_ACTIONS = ['check_in', 'memo', 'memo_decide', 'permit_task'] as const;

/** Papers FWM renews for a foreign worker, and that a worker on MC cannot be sent for. */
const MC_PAPERS: CredentialType[] = ['PLKS_PERMIT', 'PASSPORT', 'FOMEMA', 'FW_INSURANCE'];

/** The longest run of MC days in a row, and its first and last day. */
export function longestMc(mcs: { from: IsoDate; to: IsoDate }[]): { days: number; from: IsoDate | null; to: IsoDate | null } {
  const days = new Set<IsoDate>();
  for (const m of mcs) for (let d = m.from; d <= m.to; d = addDays(d, 1)) days.add(d);
  let best = { days: 0, from: null as IsoDate | null, to: null as IsoDate | null };
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue;
    let n = 0;
    while (days.has(addDays(d, n))) n += 1;
    if (n > best.days) best = { days: n, from: d, to: addDays(d, n - 1) };
  }
  return best;
}

/** "Long" SOCSO MC: more days in a row than the company pays as sick leave (rule SOCSO-INJURY-MC: PERKESO pays from day 4). */
export function longMcDays(): number {
  return RULES.injuryMcPay.value + 1;
}

export interface PermitOnMc {
  personId: Id;
  companyId: Id;
  claimId: Id;
  paper: CredentialType;
  expiresOn: IsoDate;
  /** The day the paper's reminder window opens (expiry less the approved lead days). */
  windowFrom: IsoDate;
  mcFrom: IsoDate;
  mcTo: IsoDate;
  mcDays: number;
  /** An open "permit during SOCSO MC" task for this worker, if FWM already sent one. */
  taskId: Id | null;
}

/**
 * Foreign workers on long SOCSO MC whose permit enters its reminder window before the MC ends. A claim that is closed,
 * or an MC that ended before today, does not count.
 */
export function permitsOnMc(people: Person[], claims: SocsoClaim[], credentials: Credential[], tasks: FwmTask[], today: IsoDate): PermitOnMc[] {
  const out: PermitOnMc[] = [];
  const lead = RULES.credentialLeadDays.value;
  for (const p of people) {
    if (p.nationality === 'MY' || p.status === 'left') continue;
    const mine = claims.filter((c) => c.personId === p.id && c.status !== 'CLOSED');
    if (!mine.length) continue;
    const latest = latestCredentials(credentials.filter((c) => c.personId === p.id));
    for (const c of mine) {
      const run = longestMc(c.mcs);
      if (run.days < longMcDays() || !run.to || run.to < today) continue;
      for (const paper of MC_PAPERS) {
        const cred = latest.get(paper);
        if (!cred?.expiresOn) continue;
        const windowFrom = addDays(cred.expiresOn, -(lead[paper] ?? 60));
        if (windowFrom > run.to) continue;
        const task = tasks.find((t) => t.personId === p.id && t.kind === 'PERMIT_ON_MC' && t.status !== 'accepted' && t.what.includes(`[${paper}]`)) ?? null;
        out.push({ personId: p.id, companyId: p.companyId, claimId: c.id, paper, expiresOn: cred.expiresOn, windowFrom, mcFrom: run.from!, mcTo: run.to, mcDays: run.days, taskId: task?.id ?? null });
      }
    }
  }
  return out.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v: unknown): IsoDate | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const step = (user: User, at: IsoDateTime, note = ''): StayStep => ({ by: user.name, byId: user.id, at, note });
type Stay = HostelStay;

export class FwExtrasService {
  constructor(
    private store: Store,
    private svc: PrimaService,
  ) {}

  private now(): IsoDateTime {
    return this.svc.now();
  }
  private today(): IsoDate {
    return this.svc.now().slice(0, 10);
  }

  /** FWM (not despatch) and the company office keep stays and prepare memos; the owner too (P78 maker steps). */
  private keeps(user: User): boolean {
    const r = this.svc.hostelRole(user);
    return r === 'fwm' || r === 'company' || isOwnerAdmin(user);
  }
  /** The FWM Manager and Deputy approve check-out memos. */
  private approves(user: User): boolean {
    return user.department === 'fwm' && (user.fwmRole === 'manager' || user.fwmRole === 'deputy');
  }

  private async hostelFor(user: User, hostelId: Id): Promise<Hostel> {
    const h = await this.store.get('hostels', hostelId);
    if (!h) throw new NotFound('Hostel');
    if (!(await this.svc.visibleCompanies(user)).some((c) => c.id === h.companyId)) throw new AccessDenied('view', h.companyId);
    return h;
  }

  async act(user: User, action: string, body: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'check_in':
        return this.checkIn(user, body);
      case 'memo':
        return this.memo(user, body);
      case 'memo_decide':
        return this.memoDecide(user, text(body.stayId, 120), body.approve === true, text(body.note, 400));
      case 'permit_task':
        return this.permitTask(user, text(body.personId, 80), text(body.paper, 30) as CredentialType);
      default:
        throw new BadRequest('Unknown foreign worker step.');
    }
  }

  /** A worker moves into a hostel from a date. One open stay per worker; a full hostel takes nobody else. */
  private async checkIn(user: User, body: Record<string, unknown>) {
    if (!this.keeps(user)) throw new AccessDenied('view', '(hostel residents: FWM or the company office)');
    const h = await this.hostelFor(user, text(body.hostelId, 80));
    const person = await this.store.get('people', text(body.personId, 80));
    if (!person) throw new NotFound('Worker');
    if (person.companyId !== h.companyId) throw new BadRequest('The worker and the hostel belong to different companies.');
    if (person.status === 'left') throw new BadRequest('This worker has left the company.');
    if (person.role === 'office') throw new BadRequest('Hostels are for guards and site workers.');
    const from = day(body.from);
    const today = this.today();
    if (!from || from > addDays(today, 30) || from < addDays(today, -60)) throw new BadRequest('Give the day the worker moved in (from 60 days ago to 30 days ahead).');
    const room = text(body.room, 40);
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('hostels', h.id);
      const all = (await tx.list('hostelStays', { companyId: h.companyId })) as Stay[];
      const open = all.find((s) => s.personId === person.id && (!s.to || s.to >= from));
      if (open) throw new BadRequest('This worker already has a hostel stay. Check them out of it first.');
      const living = all.filter((s) => s.hostelId === h.id && s.from <= from && (!s.to || s.to >= from)).length;
      if (living >= h.beds) throw new BadRequest(`The hostel is full: ${living} of ${h.beds} beds are taken.`);
      const row: Stay = {
        id: `hs-${toMs(at).toString(36)}-${person.id}`.slice(0, 120),
        companyId: h.companyId,
        hostelId: h.id,
        personId: person.id,
        personName: person.name,
        from,
        to: null,
        room: room || undefined,
        checkedInBy: user.name,
        checkedInById: user.id,
        checkedInAt: at,
        checkout: null,
      };
      await tx.insert('hostelStays', row);
      await tx.audit({ at, actor: user.name, companyId: h.companyId, action: 'hostel.check_in', entity: 'hostel_stay', entityId: row.id, summary: `${person.staffNo} moved into ${h.name}${room ? `, room ${room}` : ''}, from ${from}` });
      return row;
    });
  }

  /** The check-out memo, prepared (or corrected after it was sent back) by FWM or the company office, with the signed copy. */
  private async memo(user: User, body: Record<string, unknown>) {
    if (!this.keeps(user)) throw new AccessDenied('view', '(check-out memo: FWM or the company office)');
    const stayId = text(body.stayId, 120);
    const s = (await this.store.get('hostelStays', stayId)) as Stay | undefined;
    if (!s) throw new NotFound('Hostel stay');
    const h = await this.hostelFor(user, s.hostelId);
    if (s.to && s.checkout?.decided?.approve) throw new BadRequest('This worker has already checked out.');
    if (s.checkout && !s.checkout.decided) throw new BadRequest('A check-out memo is already waiting for the FWM Manager.');
    const outOn = day(body.outOn);
    const today = this.today();
    if (!outOn || outOn < s.from || outOn > addDays(today, 30)) throw new BadRequest('Give the day the worker leaves the hostel, on or after the day they moved in.');
    const reason = body.reason as CheckoutReason;
    if (!CHECKOUT_REASON_LABEL[reason]) throw new BadRequest('Choose why the worker leaves the hostel.');
    const workerAck = body.workerAck as WorkerAck;
    if (!WORKER_ACK_LABEL[workerAck]) throw new BadRequest('Say whether the worker signed the memo.');
    const flags = { keyReturned: body.keyReturned === true, beddingReturned: body.beddingReturned === true, lockerCleared: body.lockerCleared === true, roomOk: body.roomOk === true };
    const damage = text(body.damage, 400);
    if (!flags.roomOk && damage.length < 5) throw new BadRequest('Describe what is wrong with the room.');
    if ((!flags.keyReturned || !flags.beddingReturned || !flags.lockerCleared) && damage.length < 5) throw new BadRequest('Say what was not returned or cleared.');
    const owedNote = text(body.owedNote, 300);
    const proof = (Array.isArray(body.proof) ? body.proof.slice(0, 3) : []) as ProofInput[];
    const docs = this.svc.paperDocs(user, h.companyId, proof, `Check-out memo: ${s.personName}`);
    if (!docs.length) throw new BadRequest(workerAck === 'SIGNED' ? 'Attach the memo the worker signed.' : 'Attach the memo with the witness’s signature.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('hostelStays', s.id);
      const cur = (await tx.get('hostelStays', s.id)) as Stay | undefined;
      if (!cur || (cur.checkout && !cur.checkout.decided)) throw new BadRequest('A check-out memo is already waiting for the FWM Manager.');
      const ids = await this.svc.savePaperDocs(tx, docs);
      const memo: CheckoutMemo = { outOn, reason, ...flags, damage, owedNote, workerAck, docIds: ids, prepared: step(user, at), decided: null, version: (cur.checkout?.version ?? 0) + 1 };
      const updated = await tx.update('hostelStays', s.id, { checkout: memo });
      await tx.audit({ at, actor: user.name, companyId: h.companyId, action: 'hostel.checkout_memo', entity: 'hostel_stay', entityId: s.id, summary: `Check-out memo for ${s.personName} from ${h.name} on ${outOn}: ${CHECKOUT_REASON_LABEL[reason]}; ${WORKER_ACK_LABEL[workerAck]}` });
      return updated;
    });
  }

  /** The FWM Manager or Deputy approves the memo (the stay ends on the out day) or sends it back, always with a reason. */
  private async memoDecide(user: User, stayId: Id, approve: boolean, note: string) {
    if (!this.approves(user)) throw new AccessDenied('view', '(the FWM Manager or Deputy approves a check-out memo)');
    const s = (await this.store.get('hostelStays', stayId)) as Stay | undefined;
    if (!s) throw new NotFound('Hostel stay');
    const h = await this.hostelFor(user, s.hostelId);
    const m = s.checkout;
    if (!m || m.decided) throw new BadRequest('There is no check-out memo waiting.');
    if (m.prepared.byId === user.id) throw new AccessDenied('view', '(nobody approves a memo they prepared)');
    if (note.length < 3) throw new BadRequest(`Write a comment to ${approve ? 'approve' : 'send it back'}. A short one is fine.`);
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('hostelStays', s.id);
      const cur = (await tx.get('hostelStays', s.id)) as Stay | undefined;
      if (!cur?.checkout || cur.checkout.decided || cur.checkout.version !== m.version) throw new BadRequest('The memo changed meanwhile. Open it again.');
      const checkout: CheckoutMemo = { ...cur.checkout, decided: { ...step(user, at, note), approve } };
      const patch: Partial<HostelStay> = approve ? { checkout, to: cur.checkout.outOn } : { checkout };
      const updated = await tx.update('hostelStays', s.id, patch);
      await tx.audit({
        at,
        actor: user.name,
        companyId: h.companyId,
        action: approve ? 'hostel.checkout_approve' : 'hostel.checkout_return',
        entity: 'hostel_stay',
        entityId: s.id,
        summary: `${s.personName} ${approve ? `checked out of ${h.name} on ${cur.checkout.outOn}` : 'check-out memo sent back'}: ${note}`,
      });
      return updated;
    });
  }

  /** FWM sends the OM a "permit during SOCSO MC" task for a worker the board lists. The server checks the case again. */
  private async permitTask(user: User, personId: Id, paper: CredentialType) {
    if (this.svc.fwmRole(user) !== 'staff' && !isOwnerAdmin(user)) throw new AccessDenied('view', '(FWM sends permit tasks)');
    if (!MC_PAPERS.includes(paper)) throw new BadRequest('Choose the permit.');
    const person = await this.store.get('people', personId);
    if (!person) throw new NotFound('Worker');
    const row = (await this.permitRows(user, [person])).find((r) => r.paper === paper);
    if (!row) throw new BadRequest('This worker is not on long SOCSO MC with this permit coming due.');
    if (row.taskId) throw new BadRequest('A permit task for this worker is already open.');
    const label = paper === 'PLKS_PERMIT' ? 'PLKS (work permit)' : paper === 'PASSPORT' ? 'Passport' : paper === 'FOMEMA' ? 'FOMEMA medical' : 'Foreign worker insurance';
    const what = `[${paper}] ${label} expires ${row.expiresOn}; the worker is on SOCSO MC ${row.mcFrom} to ${row.mcTo} (${row.mcDays} days). Collect the passport and papers from the worker and arrange the renewal or a special pass with Immigration without the worker attending; keep the MC and SOCSO papers with the application.`;
    // Due 30 days before the expiry, or today when that has passed.
    const dueOn = [addDays(row.expiresOn, -30), this.today()].sort().at(-1)!;
    return this.svc.createFwmTask(user, person.id, { kind: 'PERMIT_ON_MC', what, place: 'Immigration (JIM) office, with the worker’s papers', dueOn });
  }

  private async permitRows(user: User, only?: Person[]) {
    const ids = (await this.svc.visibleCompanies(user)).map((c) => c.id);
    const people = only ?? (await this.store.list('people', { companyId: ids })).filter((p) => p.nationality !== 'MY' && p.status !== 'left');
    const shown = people.filter((p) => ids.includes(p.companyId));
    if (!shown.length) return [];
    const pid = shown.map((p) => p.id);
    const [claims, creds, tasks] = await Promise.all([
      this.store.list('socsoClaims', { companyId: ids }),
      this.store.list('credentials', { personId: pid }),
      this.store.list('fwmTasks', { companyId: ids }),
    ]);
    return permitsOnMc(shown, claims.filter((c) => pid.includes(c.personId)), creds, tasks, this.today());
  }

  /** Foreign workers on long SOCSO MC with a permit coming due: FWM and the group leaders. Only the MC dates are shown. */
  async permitsBoard(user: User) {
    const role = this.svc.fwmRole(user);
    if (role !== 'staff' && role !== 'escalation') throw new AccessDenied('view', '(foreign workers)');
    const rows = await this.permitRows(user);
    const people = rows.length ? await this.store.list('people', { id: [...new Set(rows.map((r) => r.personId))] }) : [];
    const companies = await this.svc.visibleCompanies(user);
    return {
      rows: rows.map((r) => {
        const p = people.find((x) => x.id === r.personId);
        return { ...r, name: p?.name ?? '', staffNo: p?.staffNo ?? '', companyName: companies.find((c) => c.id === r.companyId)?.name ?? r.companyId, canSend: role === 'staff' && !r.taskId };
      }),
      longMcDays: longMcDays(),
      lead: RULES.credentialLeadDays.value,
    };
  }

  /** Hostels with who lives there now, and check-out memos with their step: FWM, the company office, HR and leaders. */
  async staysBoard(user: User) {
    const role = this.svc.hostelRole(user);
    if (!role && !isOwnerAdmin(user)) throw new AccessDenied('view', '(hostels)');
    const companies = await this.svc.visibleCompanies(user);
    const ids = companies.map((c) => c.id);
    const [hostels, stays] = await Promise.all([this.store.list('hostels', { companyId: ids }), this.store.list('hostelStays', { companyId: ids }) as Promise<Stay[]>]);
    const today = this.today();
    const keeps = this.keeps(user);
    const approves = this.approves(user);
    const people = keeps ? (await this.store.list('people', { companyId: ids })).filter((p) => p.status !== 'left' && p.role !== 'office') : [];
    const busy = new Set(stays.filter((s) => !s.to || s.to >= today).map((s) => s.personId));
    const view = (s: Stay) => ({
      stay: s,
      state: s.to && s.to < today ? ('left' as const) : s.checkout && !s.checkout.decided ? ('memo_waiting' as const) : s.checkout?.decided && !s.checkout.decided.approve ? ('memo_returned' as const) : s.to ? ('leaving' as const) : ('living' as const),
      canMemo: keeps && (!s.checkout || (s.checkout.decided ? !s.checkout.decided.approve : false)) && !(s.to && s.to < today),
      canDecide: approves && !!s.checkout && !s.checkout.decided && s.checkout.prepared.byId !== user.id,
    });
    return {
      role,
      canCheckIn: keeps,
      hostels: hostels
        .map((h) => {
          const mine = stays.filter((s) => s.hostelId === h.id);
          const now = mine.filter((s) => s.from <= today && (!s.to || s.to >= today));
          return {
            hostel: h,
            companyName: companies.find((c) => c.id === h.companyId)?.name ?? h.companyId,
            residents: now.length,
            free: Math.max(0, h.beds - now.length),
            stays: mine.sort((a, b) => Number(!!a.to) - Number(!!b.to) || b.from.localeCompare(a.from)).slice(0, 200).map(view),
            // Workers of the hostel's company with no stay now, for the check-in pick list.
            candidates: keeps ? people.filter((p) => p.companyId === h.companyId && !busy.has(p.id)).map((p) => ({ id: p.id, name: p.name, staffNo: p.staffNo, foreign: p.nationality !== 'MY' })) : [],
          };
        })
        .sort((a, b) => a.hostel.name.localeCompare(b.hostel.name)),
      waiting: stays.filter((s) => s.checkout && !s.checkout.decided).length,
    };
  }

  /** Home: memos for the FWM Manager or Deputy to decide, memos sent back, and workers needing a permit task. */
  async homeItems(user: User): Promise<HomeItem[]> {
    if (user.integration) return [];
    const out: HomeItem[] = [];
    const approves = this.approves(user);
    const keeps = this.keeps(user) && user.department === 'fwm';
    if (!approves && !keeps) return out;
    const ids = (await this.svc.visibleCompanies(user)).map((c) => c.id);
    const stays = (await this.store.list('hostelStays', { companyId: ids })) as Stay[];
    const waiting = stays.filter((s) => s.checkout && !s.checkout.decided && s.checkout.prepared.byId !== user.id);
    if (approves && waiting.length)
      out.push({ tone: 'warn', tag: 'Hostel', title: `${waiting.length} check-out memo${waiting.length === 1 ? '' : 's'} to approve`, detail: waiting.slice(0, 3).map((s) => s.personName).join(', '), go: { view: 'hostels' } });
    const returned = stays.filter((s) => s.checkout?.decided && !s.checkout.decided.approve && s.checkout.prepared.byId === user.id);
    if (returned.length) out.push({ tone: 'warn', tag: 'Hostel', title: `${returned.length} check-out memo${returned.length === 1 ? '' : 's'} sent back to you`, detail: returned.map((s) => s.personName).slice(0, 3).join(', '), go: { view: 'hostels' } });
    if (this.svc.fwmRole(user) === 'staff') {
      const rows = (await this.permitRows(user)).filter((r) => !r.taskId);
      if (rows.length)
        out.push({ tone: 'crit', tag: 'FWM', title: `${new Set(rows.map((r) => r.personId)).size} worker(s) on long SOCSO MC need a permit task`, detail: rows.slice(0, 3).map((r) => `${r.paper} expires ${r.expiresOn}`).join('; '), go: { view: 'fwm' } });
    }
    return out;
  }
}
