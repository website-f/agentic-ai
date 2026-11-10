// P97: the face photo at each staff check-in and check-out (clock-snap.ts), its review by the person's manager or HR,
// and who may see it. PrimaService wires it in (service.ts, "Check-in places") with the staff clock pieces it needs.
import { AccessDenied } from './access';
import { SNAP_REASON_MIN, snapImageProblem, snapReviewWhy, snapView, type ClockSnap, type SnapInput, type SnapMode } from './clock-snap';
import type { CheckinEvent } from './checkin';
import { validFaceDescriptor } from './face';
import { RULES } from './rules';
import { BadRequest, NotFound, requireApprovalReason } from './service';
import { sha256Hex } from './audit';
import type { Store } from './store';
import { addDays, dateOf } from './time';
import type { Id, IsoDateTime, StaffClock, User } from './types';

/** What the check-in carries for the photo: the photo, or no camera with the reason. */
export interface SnapRequest {
  face?: SnapInput | null;
  noCamera?: { reason: string } | null;
  /** Set by the API from its own setting, never by the phone: where the face engine runs. */
  faceEngine?: 'phone' | 'server';
}

export interface ClockSnapDeps {
  enrolled(user: User): Promise<boolean>;
  /** The score against the face HR approved, or null when there is none to compare with. */
  score(user: User, descriptor: number[]): Promise<number | null>;
  /** Whose staff clock this person sees: everyone, these companies, or nobody (the staff clock scope). */
  scope(user: User): 'all' | Id[] | null;
  /** The IT Manager sees the IT team's clock, view only. */
  itTeamViewer(user: User): boolean;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

export class ClockSnapService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
    private deps: ClockSnapDeps,
  ) {}

  /** The rule (HR-STAFF-SNAP) and what the screen needs to ask for the photo. */
  rule() {
    return { on: RULES.staffClockSnap.value.on, reasonMin: SNAP_REASON_MIN, keepDays: RULES.staffTrackKeepDays.value };
  }

  /** Checked before the check-in is saved, so a broken photo never leaves a check-in without its photo. */
  check(req: SnapRequest): void {
    if (!this.rule().on) return;
    if (req.face) {
      const p = snapImageProblem(req.face.image);
      if (p) throw new BadRequest(p);
    } else if (req.noCamera && clean(req.noCamera.reason, 500).length < SNAP_REASON_MIN)
      throw new BadRequest(`Write why the camera cannot be used (at least ${SNAP_REASON_MIN} characters). Your manager or HR will see it.`);
  }

  private async installed(): Promise<boolean> {
    return !this.store.hasTable || (await this.store.hasTable('clockSnaps'));
  }

  /**
   * Keep the photo of a check-in or check-out (or, with no photo, the reason). Never refuses the check-in: a missing or
   * unmatched face is recorded for the manager or HR to look at. Not kept when the rule is off or the database module is
   * not installed yet (then the answer says so).
   */
  async save(user: User, event: CheckinEvent, clock: StaffClock | null, req: SnapRequest): Promise<{ kept: boolean; snap: Omit<ClockSnap, 'image'> | null }> {
    if (!this.rule().on || !(await this.installed())) return { kept: false, snap: null };
    const at = this.now();
    const enrolled = await this.deps.enrolled(user);
    const f = req.face ?? null;
    const faceFound = !!f && validFaceDescriptor(f.descriptor);
    const score = f && faceFound && enrolled ? await this.deps.score(user, f.descriptor) : null;
    const mode: SnapMode = !f ? 'none' : enrolled && score !== null ? 'face' : 'photo';
    const reason = f ? null : clean(req.noCamera?.reason, 500) || null;
    const base = {
      mode,
      enrolled,
      faceFound,
      live: !!f && f.live === true,
      face: score === null ? null : { score: Math.round(score * 1000) / 1000, matched: score >= RULES.faceMatchMin.value },
      reason,
    };
    const why = snapReviewWhy(base, req.faceEngine !== 'server');
    const image = f ? f.image : '';
    const snap: ClockSnap = {
      id: `cs-${event.id}`,
      userId: user.id,
      userName: user.name,
      companyId: clock?.companyId ?? null,
      clockId: clock?.id ?? event.clockId,
      eventId: event.id,
      kind: event.kind,
      at,
      capturedAt: event.capturedAt ?? at,
      image,
      sha256: sha256Hex(image),
      ...base,
      review: why.length ? { status: 'open', why, by: null, byId: null, at: null, note: '' } : null,
      reviewOpen: why.length > 0,
      keepUntil: addDays(dateOf(at), RULES.staffTrackKeepDays.value),
    };
    const today = dateOf(at);
    // The person's own photos past their keeping day lose the picture (the record of the check stays).
    const old = (await this.store.list('clockSnaps', { userId: user.id })).filter((s) => s.image && s.keepUntil < today);
    await this.store.transaction(async (tx) => {
      if (!(await tx.get('clockSnaps', snap.id))) await tx.insert('clockSnaps', snap);
      for (const o of old) await tx.update('clockSnaps', o.id, { image: '' });
      await tx.audit({
        at,
        actor: user.name,
        companyId: snap.companyId,
        action: 'staff.clock_snap',
        entity: 'clock_snap',
        entityId: snap.id,
        summary: `${user.name} ${event.kind === 'in' ? 'check-in' : 'check-out'} face photo: ${mode === 'none' ? (reason ? 'no camera, reason given' : 'no photo') : mode === 'face' ? `matched ${base.face?.matched ? 'yes' : 'no'}` : 'photo, no registered face'}${why.length ? ` (to look at: ${why.join(', ')})` : ''}`,
      });
    });
    const { image: _i, ...rest } = snap;
    void _i;
    return { kept: true, snap: rest };
  }

  private covers(user: User, s: Pick<ClockSnap, 'userId' | 'companyId'>, subject?: User): boolean {
    const scope = this.deps.scope(user);
    if (scope === 'all') return true;
    if (scope && s.companyId !== null && scope.includes(s.companyId)) return true;
    return this.deps.itTeamViewer(user) && subject?.department === 'it';
  }

  /** The photos of one clock record, for someone the caller already let see that record (staffClockDetail). */
  async forClock(clockId: Id) {
    if (!(await this.installed())) return [];
    const today = dateOf(this.now());
    return (await this.store.list('clockSnaps', { clockId })).sort((a, b) => a.at.localeCompare(b.at)).map((s) => snapView(s, today));
  }

  /** The photos to look at, for the managers and HR who see those people's staff clock. Never the person's own. */
  async reviews(user: User) {
    const scope = this.deps.scope(user);
    const viewer = this.deps.itTeamViewer(user);
    if (!scope && !viewer) throw new AccessDenied('hr.monitor', '(staff clock face photos)');
    if (!(await this.installed())) return { installed: false, open: [], canDecide: !!scope };
    const today = dateOf(this.now());
    const rows = await this.store.list('clockSnaps', { reviewOpen: true });
    const users = new Map((await this.store.list('users', { id: [...new Set(rows.map((r) => r.userId))] })).map((u) => [u.id, u]));
    const open = rows
      .filter((s) => s.review?.status === 'open' && s.userId !== user.id && this.covers(user, s, users.get(s.userId)))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 60)
      .map((s) => snapView(s, today));
    return { installed: true, open, canDecide: !!scope };
  }

  /** A manager or HR clears it (fine) or upholds it (a follow-up), with a comment. Never their own photo. */
  async decide(user: User, id: Id, decision: 'cleared' | 'upheld', note: string) {
    const scope = this.deps.scope(user);
    if (!scope) throw new AccessDenied('hr.monitor', '(staff clock face photos)');
    const s = await this.store.get('clockSnaps', id);
    if (!s) throw new NotFound('Face photo');
    const subject = await this.store.get('users', s.userId);
    if (!this.covers(user, s, subject)) throw new AccessDenied('hr.monitor', '(staff clock face photos)');
    if (s.userId === user.id) throw new BadRequest('Your own photo is looked at by someone else.');
    if (s.review?.status !== 'open') throw new BadRequest('This photo is already decided.');
    if (decision !== 'cleared' && decision !== 'upheld') throw new BadRequest('Choose fine or follow up.');
    const text = requireApprovalReason(note, decision === 'cleared' ? 'clear it' : 'follow it up');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const updated = await tx.update('clockSnaps', id, { review: { ...s.review!, status: decision, by: user.name, byId: user.id, at, note: text }, reviewOpen: false });
      await tx.audit({
        at,
        actor: user.name,
        companyId: s.companyId,
        action: 'staff.clock_snap_review',
        entity: 'clock_snap',
        entityId: id,
        summary: `${user.name} ${decision === 'cleared' ? 'cleared' : 'followed up'} the ${s.kind === 'in' ? 'check-in' : 'check-out'} face photo of ${s.userName} (${s.at.slice(0, 16)}): ${text}`,
      });
      const { image: _i, ...rest } = updated;
      void _i;
      return rest;
    });
  }
}
