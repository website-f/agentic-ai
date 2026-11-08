import { AccessDenied } from "./access";
import { sha256Hex } from "./audit";
import type { FaceFrame } from "./face";
import type { FaceStep } from "./face";
import { judgeFaceFrames } from "./face";
import { faceScore } from "./face";
import { validFaceDescriptor } from "./face";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { isOwnRecord } from "./service";
import type { PrimaService } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import { fromMs } from "./time";
import { toMs } from "./time";
import { distanceM } from "./checks";
import type { Company } from "./types";
import type { GuardPhone } from "./types";
import type { GuardPhoneSession } from "./types";
import type { GuardPing } from "./types";
import type { Id } from "./types";
import type { IsoDateTime } from "./types";
import type { Person } from "./types";
import type { Shift } from "./types";
import type { SiteAlarm } from "./types";
import type { StaffFace } from "./types";
import type { User } from "./types";


/** What the phone keeps after enrolling: its id, the guard's sign-in id and its own secret. */
export interface GuardDevice {
  userId: Id;
  phoneId: Id;
  secret: string;
}

/** The face proof at sign-in: the phone engine's numbers, or Prima's own engine's reading of the challenge pictures. */
export type GuardFaceProof =
  | { engine: 'phone'; descriptor: number[] | null; live: boolean; photo: string }
  | { engine: 'server'; bind: string; steps: FaceStep[]; frames: string[]; found: (FaceFrame | null)[] };

export type GuardSignInResult =
  | { ok: true; session: GuardPhoneSession }
  | { ok: false; reason: 'pin' | 'face' | 'locked' | 'no_face'; message: string; lockedUntil: IsoDateTime | null };

/** Heartbeat state as CMS sees it. */
export type GuardPhoneState = 'live' | 'late' | 'offline';

/** Letters and digits that cannot be mistaken for one another when read out or typed on a phone. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomText(bytes: number, alphabet?: string): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  if (alphabet) return [...b].map((x) => alphabet[x % alphabet.length]).join('');
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Hash of a one-time code, bound to its phone row, so a code only works with its own link. */
export function guardCodeHash(phoneId: Id, code: string): string {
  return sha256Hex(`guard-phone-code.${phoneId}.${code.trim().toUpperCase().replace(/[\s-]/g, '')}`);
}

export function guardSecretHash(phoneId: Id, secret: string): string {
  return sha256Hex(`guard-phone-secret.${phoneId}.${secret}`);
}

/** Live within two heartbeats, late until the offline limit, then offline (JA requirements, 2 Nov 2026). */
export function guardPhoneState(lastSeenAt: IsoDateTime, nowMs: number): GuardPhoneState {
  const r = RULES.guardPhone.value;
  const age = nowMs - toMs(lastSeenAt);
  if (age <= 2 * r.heartbeatSec * 1000) return 'live';
  if (age <= r.offlineAfterMin * 60_000) return 'late';
  return 'offline';
}

/** The shift a guard is on now, with the duty margin either side; else null. Location is kept only inside it. */
export function dutyShift(shifts: Shift[], nowMs: number): Shift | null {
  const m = RULES.guardPhone.value.dutyMarginMin * 60_000;
  return (
    shifts
      .filter((s) => s.status === 'published' && toMs(s.start) - m <= nowMs && nowMs < toMs(s.end) + m)
      .sort((a, b) => Math.abs(toMs(a.start) - nowMs) - Math.abs(toMs(b.start) - nowMs))[0] ?? null
  );
}

function coordOk(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export class GuardPhoneService {
  constructor(
    private store: Store,
    private svc: PrimaService,
  ) {}

  private now(): IsoDateTime {
    return this.svc.now();
  }

  /** The guard's own sign-in: a guard (or officer) user tied to their own person record. */
  private guardUser(user: User): boolean {
    return !user.integration && (user.role === 'guard' || user.role === 'supervisor') && !!user.personId;
  }

  private async person(user: User): Promise<Person> {
    if (!this.guardUser(user)) throw new AccessDenied('view', '(guard phones are for guards and officers)');
    const p = await this.store.get('people', user.personId!);
    if (!p || !isOwnRecord(user, p) || p.role === 'office') throw new AccessDenied('view', '(no guard record)');
    return p;
  }

  // ---------- Office: issue a code, list, retire ----------

  private async officePerson(user: User, personId: Id): Promise<Person> {
    const p = await this.store.get('people', personId);
    if (!p) throw new NotFound('Person');
    if (!this.svc.mayManageGuardPhone(user, p)) throw new AccessDenied('view', '(the company office or HR enrols guard phones)');
    return p;
  }

  /** The guard's own sign-in user, which the phone signs in as. */
  private async guardLogin(p: Person): Promise<User> {
    const u = (await this.store.list('users', { personId: p.id })).find((x) => (x.role === 'guard' || x.role === 'supervisor') && !x.integration);
    if (!u) throw new BadRequest(`${p.name} has no guard sign-in yet. Ask IT to create it, then issue the code.`);
    return u;
  }

  /**
   * A one-time code for a guard to enrol their own phone. The code is shown once, here, and never kept as typed. An
   * earlier code that was not used is cancelled.
   */
  async issueCode(user: User, personId: Id) {
    const p = await this.officePerson(user, personId);
    if (user.personId === p.id) throw new BadRequest('Someone else enrols your phone.');
    if (p.role === 'office') throw new BadRequest('Phone sign-in with face and PIN is for guards and officers. Office staff use Microsoft.');
    if (!(await this.svc.guardPinUsable(p))) throw new BadRequest('This person is not active or has left, so their phone cannot be enrolled.');
    if (!p.pinHash) throw new BadRequest('Set the guard\'s PIN first. The phone signs in with face plus PIN.');
    const login = await this.guardLogin(p);
    const at = this.now();
    const r = RULES.guardPhone.value;
    const id = `gp-${randomText(8)}`;
    const code = randomText(8, CODE_ALPHABET);
    const row: GuardPhone = {
      id,
      userId: login.id,
      personId: p.id,
      companyId: p.companyId,
      status: 'issued',
      codeHash: guardCodeHash(id, code),
      codeExpiresAt: fromMs(toMs(at) + r.codeValidHours * 3_600_000),
      codeTries: 0,
      issuedBy: user.name,
      issuedById: user.id,
      issuedAt: at,
      secretHash: null,
      enrolledAt: null,
      deviceLabel: null,
      failedTries: 0,
      lockedUntil: null,
      signIns: 0,
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
    };
    const earlier = (await this.store.list('guardPhones', { personId: p.id })).filter((x) => x.status === 'issued');
    await this.store.transaction(async (tx) => {
      for (const e of earlier) await tx.update('guardPhones', e.id, { status: 'expired', codeHash: null });
      await tx.insert('guardPhones', row);
      await tx.audit({
        at,
        actor: user.name,
        companyId: p.companyId,
        action: 'guard_phone.code',
        entity: 'person',
        entityId: p.id,
        summary: `Phone enrolment code issued for ${p.staffNo} ${p.name}, valid ${r.codeValidHours} hours`,
      });
    });
    return { phoneId: id, userId: login.id, code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: row.codeExpiresAt!, staffNo: p.staffNo, name: p.name };
  }

  /** The company's guard phones for the office: who has one, since when, last seen; never a code or a secret. */
  async phones(user: User, companyId: Id) {
    const people = (await this.store.list('people', { companyId })).filter((p) => p.role !== 'office');
    const allowed = people.filter((p) => this.svc.mayManageGuardPhone(user, p));
    if (!allowed.length && people.length) throw new AccessDenied('view', '(the company office or HR enrols guard phones)');
    const ids = new Set(allowed.map((p) => p.id));
    const phones = (await this.store.list('guardPhones', { companyId })).filter((x) => ids.has(x.personId));
    const sessions = await this.store.list('guardPhoneSessions', { companyId, endedAt: null });
    const nowMs = toMs(this.now());
    const byId = new Map(allowed.map((p) => [p.id, p]));
    return phones
      .filter((x) => x.status === 'active' || (x.status === 'issued' && x.codeExpiresAt && toMs(x.codeExpiresAt) > nowMs))
      .map((x) => {
        const s = sessions.find((y) => y.phoneId === x.id && toMs(y.expiresAt) > nowMs) ?? null;
        const p = byId.get(x.personId);
        return {
          phoneId: x.id,
          personId: x.personId,
          name: p?.name ?? x.personId,
          staffNo: p?.staffNo ?? '',
          status: x.status,
          issuedBy: x.issuedBy,
          issuedAt: x.issuedAt,
          codeExpiresAt: x.status === 'issued' ? x.codeExpiresAt : null,
          enrolledAt: x.enrolledAt,
          deviceLabel: x.deviceLabel,
          locked: !!x.lockedUntil && toMs(x.lockedUntil) > nowMs,
          signedIn: !!s,
          state: s ? guardPhoneState(s.lastSeenAt, nowMs) : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Retire a phone (lost, changed, or the guard left): its secret stops working and any sign-in on it ends now. */
  async revoke(user: User, phoneId: Id, reason: string) {
    const ph = await this.store.get('guardPhones', phoneId);
    if (!ph) throw new NotFound('Guard phone');
    const p = await this.officePerson(user, ph.personId);
    const why = String(reason ?? '').trim().slice(0, 300);
    if (!why) throw new BadRequest('Give a reason for retiring the phone.');
    if (ph.status !== 'active' && ph.status !== 'issued') throw new BadRequest('This phone is already retired.');
    const at = this.now();
    await this.store.transaction(async (tx) => {
      await this.endSessions(tx, ph.id, at, 'revoked');
      await tx.update('guardPhones', ph.id, { status: 'revoked', codeHash: null, secretHash: null, revokedBy: user.name, revokedAt: at, revokeReason: why });
      await tx.audit({
        at,
        actor: user.name,
        companyId: ph.companyId,
        action: 'guard_phone.revoke',
        entity: 'person',
        entityId: p.id,
        summary: `Phone of ${p.staffNo} ${p.name} retired: ${why}`,
      });
    });
    return { phoneId, status: 'revoked' as const };
  }

  private async endSessions(tx: Store, phoneId: Id, at: IsoDateTime, why: NonNullable<GuardPhoneSession['endReason']>) {
    for (const s of await tx.list('guardPhoneSessions', { phoneId, endedAt: null })) await tx.update('guardPhoneSessions', s.id, { endedAt: at, endReason: why });
  }

  // ---------- The guard's phone: enrol, register the face, sign in ----------

  /**
   * Enrol this phone with the one-time code and the guard's own staff number. Returns the phone's secret once; the
   * phone keeps it and Prima keeps only its hash. Wrong codes count, and the code expires at the limit.
   */
  async enrol(user: User, input: { phoneId: Id; code: string; staffNo: string; deviceLabel?: string | null }): Promise<{ ok: true; device: GuardDevice } | { ok: false; message: string }> {
    const p = await this.person(user);
    const ph = await this.store.get('guardPhones', String(input.phoneId ?? ''));
    const at = this.now();
    if (!ph || ph.userId !== user.id || ph.status !== 'issued' || !ph.codeHash || !ph.codeExpiresAt || toMs(ph.codeExpiresAt) <= toMs(at))
      return { ok: false, message: 'This enrolment link is not valid any more. Ask the company office for a new code.' };
    const r = RULES.guardPhone.value;
    const codeOk = ph.codeHash === guardCodeHash(ph.id, String(input.code ?? ''));
    const staffOk = String(input.staffNo ?? '').trim().toUpperCase() === p.staffNo.toUpperCase();
    if (!codeOk || !staffOk) {
      const tries = ph.codeTries + 1;
      await this.store.transaction(async (tx) => {
        await tx.update('guardPhones', ph.id, tries >= r.maxFailedTries ? { codeTries: tries, status: 'expired', codeHash: null } : { codeTries: tries });
        await tx.audit({ at, actor: user.name, companyId: ph.companyId, action: 'guard_phone.enrol_refused', entity: 'person', entityId: p.id, summary: `Phone enrolment refused for ${p.staffNo}: wrong ${codeOk ? 'staff number' : 'code'} (try ${tries})` });
      });
      return { ok: false, message: tries >= r.maxFailedTries ? 'Too many wrong tries. Ask the company office for a new code.' : 'The code or staff number is not right. Check them and try again.' };
    }
    if (!(await this.svc.guardPinUsable(p))) return { ok: false, message: 'Your record is not active. Ask the company office.' };
    const secret = randomText(32);
    const label = typeof input.deviceLabel === 'string' ? input.deviceLabel.slice(0, 80) : null;
    const older = (await this.store.list('guardPhones', { personId: p.id })).filter((x) => x.id !== ph.id && x.status === 'active');
    await this.store.transaction(async (tx) => {
      for (const o of older) {
        await this.endSessions(tx, o.id, at, 'replaced');
        await tx.update('guardPhones', o.id, { status: 'revoked', secretHash: null, revokedBy: 'Prima', revokedAt: at, revokeReason: 'A new phone was enrolled' });
      }
      await tx.update('guardPhones', ph.id, { status: 'active', codeHash: null, secretHash: guardSecretHash(ph.id, secret), enrolledAt: at, deviceLabel: label });
      await tx.audit({
        at,
        actor: user.name,
        companyId: ph.companyId,
        action: 'guard_phone.enrol',
        entity: 'person',
        entityId: p.id,
        summary: `${p.staffNo} ${p.name} enrolled their own phone${older.length ? '; the earlier phone was retired' : ''}`,
      });
    });
    return { ok: true, device: { userId: user.id, phoneId: ph.id, secret } };
  }

  /** The active phone this device credential belongs to; refused otherwise, with nothing said about why. */
  private async device(user: User, d: Pick<GuardDevice, 'phoneId' | 'secret'>): Promise<GuardPhone> {
    const ph = typeof d?.phoneId === 'string' ? await this.store.get('guardPhones', d.phoneId) : undefined;
    if (!ph || ph.userId !== user.id || ph.status !== 'active' || !ph.secretHash || typeof d.secret !== 'string' || ph.secretHash !== guardSecretHash(ph.id, d.secret))
      throw new AccessDenied('view', '(this phone is not enrolled; ask the company office for a new code)');
    return ph;
  }

  private locked(ph: GuardPhone): boolean {
    return !!ph.lockedUntil && toMs(ph.lockedUntil) > toMs(this.now());
  }

  /** One more wrong PIN or failed face; locks the phone at the limit. Written even though the sign-in is refused. */
  private async failed(ph: GuardPhone, p: Person, user: User, what: 'pin' | 'face', detail: string): Promise<IsoDateTime | null> {
    const r = RULES.guardPhone.value;
    const at = this.now();
    const tries = ph.failedTries + 1;
    const lockedUntil = tries >= r.maxFailedTries ? fromMs(toMs(at) + r.lockMin * 60_000) : null;
    await this.store.transaction(async (tx) => {
      await tx.update('guardPhones', ph.id, { failedTries: lockedUntil ? 0 : tries, lockedUntil, signIns: ph.signIns + 1 });
      await tx.audit({
        at,
        actor: user.name,
        companyId: ph.companyId,
        action: 'guard_phone.sign_in_refused',
        entity: 'person',
        entityId: p.id,
        summary: `Phone sign-in refused for ${p.staffNo}: ${what === 'pin' ? 'wrong PIN' : 'face not accepted'}${detail ? ` (${detail})` : ''}${lockedUntil ? `; phone locked until ${lockedUntil}` : ''}`,
      });
    });
    return lockedUntil;
  }

  /** What the phone needs before signing in: whether a face is approved, and whether the phone is locked. */
  async status(user: User, d: GuardDevice) {
    const p = await this.person(user);
    const ph = await this.device(user, d);
    const face = await this.store.get('staffFaces', p.id);
    return {
      name: p.name,
      staffNo: p.staffNo,
      face: face?.status ?? ('none' as const),
      lockedUntil: this.locked(ph) ? ph.lockedUntil : null,
    };
  }

  /** The binding for this sign-in's face challenge: the phone and its attempt count, so a challenge is used once. */
  async challengeBind(user: User, d: GuardDevice): Promise<string> {
    await this.person(user);
    const ph = await this.device(user, d);
    if (this.locked(ph)) throw new BadRequest(`Too many wrong tries. This phone is locked until ${ph.lockedUntil!.slice(11, 16)}.`);
    return `guard-sign-in.${ph.id}.${ph.signIns}`;
  }

  /**
   * Register the guard's face on the enrolled phone, after their PIN (so a found phone cannot register a stranger). HR
   * approves it on the face list. With FACE_ENGINE=server the API has already read the photo itself.
   */
  async registerFace(user: User, d: GuardDevice, input: { pin: string; photo: string; descriptor: number[]; descriptorBy: 'phone' | 'server' }) {
    const p = await this.person(user);
    const ph = await this.device(user, d);
    if (this.locked(ph)) return { ok: false as const, message: `Too many wrong tries. This phone is locked until ${ph.lockedUntil!.slice(11, 16)}.` };
    if (!this.svc.guardPinMatches(p, String(input.pin ?? ''))) {
      const until = await this.failed(ph, p, user, 'pin', 'at face registration');
      return { ok: false as const, message: until ? `Too many wrong tries. This phone is locked until ${until.slice(11, 16)}.` : 'The PIN is not right.' };
    }
    if (typeof input.photo !== 'string' || !/^data:image\/jpeg;base64,/.test(input.photo)) throw new BadRequest('Take the photo with the app camera.');
    if (input.photo.length > 2_500_000) throw new BadRequest('The photo is too large.');
    if (!validFaceDescriptor(input.descriptor)) throw new BadRequest('No face was found in the photo. Face the camera in good light and try again.');
    const old = await this.store.get('staffFaces', p.id);
    if (old?.status === 'approved') throw new BadRequest('Your face is already registered. Ask HR to remove it before registering again.');
    const at = this.now();
    const row: StaffFace = {
      id: p.id,
      personId: p.id,
      userId: user.id,
      companyId: p.companyId,
      descriptor: input.descriptor,
      descriptorBy: input.descriptorBy,
      photo: input.photo,
      status: 'pending',
      submittedAt: at,
      decidedBy: null,
      decidedById: null,
      decidedAt: null,
      note: null,
    };
    await this.store.transaction(async (tx) => {
      if (ph.failedTries) await tx.update('guardPhones', ph.id, { failedTries: 0 });
      if (old) await tx.update('staffFaces', p.id, row);
      else await tx.insert('staffFaces', row);
      await tx.audit({ at, actor: user.name, companyId: p.companyId, action: 'staff.face_register', entity: 'person', entityId: p.id, summary: `${p.name} registered a face on their own phone for sign-in; waiting for HR` });
    });
    return { ok: true as const, face: 'pending' as const };
  }

  /**
   * Sign in on the enrolled phone with the PIN and the face. Both must pass: a right PIN with a face that does not match
   * or did not move is refused, and counts toward the lock. Each refusal is written to the audit log for HR.
   */
  async signIn(user: User, d: GuardDevice, input: { pin: string; face: GuardFaceProof }, analyse?: (image: string) => Promise<FaceFrame | null>): Promise<GuardSignInResult> {
    const p = await this.person(user);
    const ph = await this.device(user, d);
    if (this.locked(ph)) return { ok: false, reason: 'locked', message: `Too many wrong tries. This phone is locked until ${ph.lockedUntil!.slice(11, 16)}.`, lockedUntil: ph.lockedUntil };
    if (!(await this.svc.guardPinUsable(p))) throw new AccessDenied('view', '(your record is not active)');
    const reg = await this.store.get('staffFaces', p.id);
    if (reg?.status !== 'approved')
      return { ok: false, reason: 'no_face', message: reg?.status === 'pending' ? 'Your face is waiting for HR to approve it.' : 'Register your face first.', lockedUntil: null };
    if (!this.svc.guardPinMatches(p, String(input.pin ?? ''))) {
      const until = await this.failed(ph, p, user, 'pin', '');
      return { ok: false, reason: until ? 'locked' : 'pin', message: until ? `Too many wrong tries. This phone is locked until ${until.slice(11, 16)}.` : 'The PIN is not right.', lockedUntil: until };
    }
    // The face, judged on the server only.
    const min = RULES.faceMatchMin.value;
    let score = 0;
    let live = false;
    let reasons: string[] = [];
    let picture = '';
    const f = input.face;
    if (f.engine === 'server') {
      if (f.bind !== `guard-sign-in.${ph.id}.${ph.signIns}`) return { ok: false, reason: 'face', message: 'The face check was for an earlier try. Start it again.', lockedUntil: null };
      if (!analyse) throw new BadRequest('The face engine is not available.');
      const registered = reg.descriptorBy === 'server' ? reg.descriptor : ((await analyse(reg.photo))?.descriptor ?? []);
      const v = judgeFaceFrames(f.steps, f.found, registered);
      if (!validFaceDescriptor(registered)) v.reasons.push('the approved registration photo has no readable face; HR should ask for a new one');
      ({ score, live, reasons } = v);
      const facing = f.steps.indexOf('centre');
      picture = f.frames[facing >= 0 ? facing : 0] ?? '';
    } else {
      score = guardFaceScore(reg.descriptor, f.descriptor);
      live = f.live === true;
      if (!validFaceDescriptor(f.descriptor)) reasons.push('no face in the picture');
      if (!live) reasons.push('the movement check on the phone did not pass');
      picture = typeof f.photo === 'string' ? f.photo : '';
    }
    if (score < min) reasons.push(`face score ${score} is below ${min}`);
    if (score < min || !live) {
      const until = await this.failed(ph, p, user, 'face', reasons.join('; '));
      return {
        ok: false,
        reason: until ? 'locked' : 'face',
        message: until ? `Too many wrong tries. This phone is locked until ${until.slice(11, 16)}.` : 'Your face was not accepted. Face the camera in good light, follow the steps and try again.',
        lockedUntil: until,
      };
    }
    const at = this.now();
    const duty = await this.dutyNow(p, toMs(at));
    const session: GuardPhoneSession = {
      id: `gps-${ph.id}-${toMs(at)}-${ph.signIns + 1}`,
      phoneId: ph.id,
      userId: user.id,
      personId: p.id,
      companyId: p.companyId,
      shiftId: duty?.id ?? null,
      siteId: duty?.siteId ?? null,
      startedAt: at,
      expiresAt: fromMs(toMs(at) + RULES.guardPhone.value.sessionHours * 3_600_000),
      endedAt: null,
      endReason: null,
      face: { score, live, engine: f.engine, sha256: sha256Hex(picture) },
      lastSeenAt: at,
      battery: null,
      lastLat: null,
      lastLng: null,
      lastAccuracyM: null,
      lastPingAt: null,
      pings: 0,
    };
    await this.store.transaction(async (tx) => {
      await this.endSessions(tx, ph.id, at, 'replaced');
      await tx.update('guardPhones', ph.id, { failedTries: 0, lockedUntil: null, signIns: ph.signIns + 1 });
      await tx.insert('guardPhoneSessions', session);
      await tx.audit({
        at,
        actor: user.name,
        companyId: p.companyId,
        action: 'guard_phone.sign_in',
        entity: 'person',
        entityId: p.id,
        summary: `${p.staffNo} ${p.name} signed in on their own phone with PIN and face (${f.engine} engine, score ${score})`,
      });
    });
    return { ok: true, session };
  }

  // ---------- Signed in: heartbeat, location, sign out ----------

  private async dutyNow(p: Person, nowMs: number): Promise<Shift | null> {
    const today = this.svc.today();
    const shifts = (await this.store.list('shifts', { personId: p.id, date: [addDays(today, -1), today, addDays(today, 1)] })).filter((s) => s.companyId === p.companyId);
    return dutyShift(shifts, nowMs);
  }

  /** The open, unexpired session on this sign-in; the API checks the same before it lets the token in. */
  async openSession(user: User, sessionId: Id): Promise<GuardPhoneSession> {
    const s = await this.store.get('guardPhoneSessions', sessionId);
    if (!s || s.userId !== user.id || s.endedAt || toMs(s.expiresAt) <= toMs(this.now())) throw new AccessDenied('view', '(sign in again on your phone)');
    return s;
  }

  /**
   * The phone's heartbeat, every minute. It keeps the phone live on the CMS board. A location sent with it is kept only
   * on duty and not more often than the rule; otherwise it is dropped, and the answer says why.
   */
  async heartbeat(user: User, sessionId: Id, input: { lat?: unknown; lng?: unknown; accuracyM?: unknown; capturedAt?: unknown; battery?: unknown }) {
    const s = await this.openSession(user, sessionId);
    const p = await this.person(user);
    const ph = await this.store.get('guardPhones', s.phoneId);
    if (!ph || ph.status !== 'active') throw new AccessDenied('view', '(this phone was retired)');
    const r = RULES.guardPhone.value;
    const at = this.now();
    const nowMs = toMs(at);
    const duty = await this.dutyNow(p, nowMs);
    const battery = typeof input.battery === 'number' && input.battery >= 0 && input.battery <= 100 ? Math.round(input.battery) : null;
    let location: 'kept' | 'none' | 'off_duty' | 'too_soon' = 'none';
    let ping: GuardPing | null = null;
    if (coordOk(input.lat, input.lng)) {
      if (!duty) location = 'off_duty';
      else if (s.lastPingAt && nowMs - toMs(s.lastPingAt) < r.pingEverySec * 1000 - 5_000) location = 'too_soon';
      else {
        const site = await this.store.get('sites', duty.siteId);
        const lat = input.lat as number;
        const lng = input.lng as number;
        ping = {
          id: `gpp-${s.id}-${nowMs}`,
          sessionId: s.id,
          userId: user.id,
          personId: p.id,
          companyId: s.companyId,
          siteId: duty.siteId,
          shiftId: duty.id,
          capturedAt: typeof input.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(input.capturedAt) ? input.capturedAt.slice(0, 40) : at,
          receivedAt: at,
          lat,
          lng,
          accuracyM: typeof input.accuracyM === 'number' && Number.isFinite(input.accuracyM) ? Math.round(input.accuracyM) : null,
          distanceM: site && coordOk(site.lat, site.lng) ? Math.round(distanceM(lat, lng, site.lat, site.lng)) : null,
        };
        location = 'kept';
      }
    }
    const patch: Partial<GuardPhoneSession> = { lastSeenAt: at, battery, shiftId: duty?.id ?? null, siteId: duty?.siteId ?? null };
    if (ping) Object.assign(patch, { lastLat: ping.lat, lastLng: ping.lng, lastAccuracyM: ping.accuracyM, lastPingAt: at, pings: s.pings + 1 });
    // Off duty, the last location is cleared from the board, so nobody follows a guard after the shift.
    if (!duty) Object.assign(patch, { lastLat: null, lastLng: null, lastAccuracyM: null });
    const updated = await this.store.transaction(async (tx) => {
      if (ping) await tx.insert('guardPings', ping);
      return tx.update('guardPhoneSessions', s.id, patch);
    });
    return { session: updated, location, onDuty: !!duty, heartbeatSec: r.heartbeatSec, pingEverySec: r.pingEverySec };
  }

  /** The guard's own screen on the phone: the sign-in, the duty now and any SOS still open. */
  async me(user: User, sessionId: Id) {
    const s = await this.openSession(user, sessionId);
    const p = await this.person(user);
    const site = s.siteId ? await this.store.get('sites', s.siteId) : undefined;
    const shift = s.shiftId ? await this.store.get('shifts', s.shiftId) : undefined;
    const sos = (await this.store.list('siteAlarms', { companyId: p.companyId, kind: 'GUARD_SOS' })).filter((a) => a.personId === p.id && a.status !== 'closed');
    const r = RULES.guardPhone.value;
    return {
      name: p.name,
      staffNo: p.staffNo,
      session: { id: s.id, startedAt: s.startedAt, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt, pings: s.pings },
      duty: shift ? { siteName: site?.name ?? shift.siteId, start: shift.start, end: shift.end } : null,
      sos: sos.map((a) => ({ id: a.id, at: a.at, status: a.status, ackBy: a.ackBy })),
      rule: { heartbeatSec: r.heartbeatSec, pingEverySec: r.pingEverySec, ruleId: RULES.guardPhone.id },
    };
  }

  async signOut(user: User, sessionId: Id) {
    const s = await this.store.get('guardPhoneSessions', sessionId);
    if (!s || s.userId !== user.id || s.endedAt) return { ended: false };
    const at = this.now();
    await this.store.transaction(async (tx) => {
      await tx.update('guardPhoneSessions', s.id, { endedAt: at, endReason: 'signed_out', lastLat: null, lastLng: null, lastAccuracyM: null });
      await tx.audit({ at, actor: user.name, companyId: s.companyId, action: 'guard_phone.sign_out', entity: 'person', entityId: s.personId, summary: `${user.name} signed out on their phone` });
    });
    return { ended: true };
  }

  // ---------- SOS ----------

  /**
   * SOS from the guard's phone. It needs the enrolled phone only (a signed-in session, or the phone's own secret), never
   * a PIN or a face. It goes straight into the CMS alarm queue as a Guard SOS, with the location (sent at any time, to
   * get help to the guard). A second press while one is open adds nothing new; it updates the location.
   */
  async sos(user: User, by: { sessionId: Id } | { device: GuardDevice }, input: { lat?: unknown; lng?: unknown; accuracyM?: unknown }) {
    const p = await this.person(user);
    let phoneId: Id;
    let siteFromSession: Id | null = null;
    if ('sessionId' in by) {
      const s = await this.openSession(user, by.sessionId);
      phoneId = s.phoneId;
      siteFromSession = s.siteId;
    } else phoneId = (await this.device(user, by.device)).id;
    const at = this.now();
    const nowMs = toMs(at);
    const loc = coordOk(input.lat, input.lng)
      ? { lat: input.lat as number, lng: input.lng as number, accuracyM: typeof input.accuracyM === 'number' && Number.isFinite(input.accuracyM) ? Math.round(input.accuracyM) : null }
      : { lat: null, lng: null, accuracyM: null };
    const r = RULES.guardPhone.value;
    const open = (await this.store.list('siteAlarms', { companyId: p.companyId, kind: 'GUARD_SOS' })).find(
      (a) => a.personId === p.id && a.status !== 'closed' && nowMs - toMs(a.at) < r.sosRepeatMin * 60_000,
    );
    if (open) {
      if (loc.lat === null) return { alarm: open, repeated: true };
      const updated = await this.store.transaction((tx) => tx.update('siteAlarms', open.id, loc));
      return { alarm: updated, repeated: true };
    }
    // The site: the shift on now; else the last shift in the past 12 hours; else marked unknown for CMS to ask.
    let siteId = siteFromSession ?? (await this.dutyNow(p, nowMs))?.siteId ?? null;
    if (!siteId) {
      const today = this.svc.today();
      const recent = (await this.store.list('shifts', { personId: p.id, date: [addDays(today, -1), today] }))
        .filter((s) => s.companyId === p.companyId && s.status === 'published' && toMs(s.start) <= nowMs && nowMs - toMs(s.end) < 12 * 3_600_000)
        .sort((a, b) => b.end.localeCompare(a.end));
      siteId = recent[0]?.siteId ?? null;
    }
    const alarm: SiteAlarm = {
      id: `al-sos-${p.id}-${nowMs}`,
      companyId: p.companyId,
      siteId: siteId ?? `unknown-${p.companyId}`,
      kind: 'GUARD_SOS',
      source: `Guard phone: ${p.name} (${p.staffNo})`,
      at,
      status: 'new',
      ackAt: null,
      ackBy: null,
      verdict: null,
      caseId: null,
      note: null,
      falseReview: null,
      personId: p.id,
      ...loc,
      siteUnknown: !siteId,
    };
    await this.store.transaction(async (tx) => {
      await tx.insert('siteAlarms', alarm);
      await tx.audit({
        at,
        actor: user.name,
        companyId: p.companyId,
        action: 'guard_phone.sos',
        entity: 'site_alarm',
        entityId: alarm.id,
        summary: `SOS pressed on the phone of ${p.staffNo} ${p.name}${loc.lat === null ? ' (no location from the phone)' : ''}${siteId ? '' : '; site not known from the roster'} (phone ${phoneId})`,
      });
    });
    return { alarm, repeated: false };
  }

  // ---------- CMS ----------

  /**
   * CMS: every guard signed in on their phone in the companies CMS watches, live, late or offline, with the last
   * location kept on duty, and the SOS alarms from phones still open. Read only; acting on an SOS is the CMS alarm desk.
   */
  async board(user: User) {
    const companies: Company[] = await this.svc.cmsCompanies(user);
    const ids = companies.map((c) => c.id);
    const name = new Map(companies.map((c) => [c.id, c.name]));
    const nowMs = toMs(this.now());
    const sessions = (await this.store.list('guardPhoneSessions', { companyId: ids, endedAt: null })).filter((s) => toMs(s.expiresAt) > nowMs);
    const people = new Map((await this.store.list('people', { id: [...new Set(sessions.map((s) => s.personId))] })).map((p) => [p.id, p]));
    const sites = new Map((await this.store.list('sites', { id: [...new Set(sessions.map((s) => s.siteId).filter((x): x is Id => !!x))] })).map((x) => [x.id, x]));
    const sos = (await this.store.list('siteAlarms', { companyId: ids, kind: 'GUARD_SOS' })).filter((a) => a.status !== 'closed' && !!a.personId);
    const rows = sessions
      .map((s) => {
        const p = people.get(s.personId);
        const state = guardPhoneState(s.lastSeenAt, nowMs);
        return {
          sessionId: s.id,
          personId: s.personId,
          name: p?.name ?? s.personId,
          staffNo: p?.staffNo ?? '',
          companyId: s.companyId,
          companyName: name.get(s.companyId) ?? s.companyId,
          siteName: s.siteId ? (sites.get(s.siteId)?.name ?? s.siteId) : null,
          onDuty: !!s.shiftId,
          state,
          lastSeenAt: s.lastSeenAt,
          battery: s.battery,
          // Location only while on duty (the heartbeat clears it off duty).
          location: s.shiftId && s.lastLat !== null && s.lastLng !== null ? { lat: s.lastLat, lng: s.lastLng, accuracyM: s.lastAccuracyM, at: s.lastPingAt } : null,
          sos: sos.some((a) => a.personId === s.personId),
        };
      })
      .sort((a, b) => Number(b.sos) - Number(a.sos) || ['offline', 'late', 'live'].indexOf(a.state) - ['offline', 'late', 'live'].indexOf(b.state) || a.name.localeCompare(b.name));
    return {
      rule: { id: RULES.guardPhone.id, heartbeatSec: RULES.guardPhone.value.heartbeatSec, offlineAfterMin: RULES.guardPhone.value.offlineAfterMin },
      counts: {
        signedIn: rows.length,
        onDuty: rows.filter((r) => r.onDuty).length,
        live: rows.filter((r) => r.state === 'live').length,
        late: rows.filter((r) => r.state === 'late').length,
        offline: rows.filter((r) => r.state === 'offline').length,
        sos: sos.length,
      },
      phones: rows,
      sos: sos.map((a) => ({
        id: a.id,
        at: a.at,
        status: a.status,
        companyName: name.get(a.companyId) ?? a.companyId,
        source: a.source,
        siteUnknown: !!a.siteUnknown,
        location: a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng, accuracyM: a.accuracyM ?? null } : null,
      })),
    };
  }
}

/** The phone engine's comparison, as for the staff clock: a score from the server, never from the phone. */
export function guardFaceScore(registered: number[], descriptor: number[] | null): number {
  return validFaceDescriptor(descriptor) && validFaceDescriptor(registered) ? faceScore(registered, descriptor) : 0;
}