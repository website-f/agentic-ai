// Guards on their own phones (third audit item 2, Fauzan 5 Nov 2026): enrol, face plus PIN sign-in, heartbeat,
// on-duty location (no notice step, Fauzan 5 Nov 2026), SOS to CMS. Mock data only; faces are synthetic numbers, never a real face.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  FACE_DESCRIPTOR_LEN,
  MemoryStore,
  PrimaService,
  RULES,
  generateDataset,
  guardPhoneState,
  myt,
  toMs,
  type FaceFrame,
  type FaceStep,
  type GuardDevice,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '08:40');
const me = Array.from({ length: FACE_DESCRIPTOR_LEN }, (_, i) => Math.sin(i + 1) / 10);
const other = me.map((x, i) => x + (i % 2 ? 0.12 : -0.12));
const pic = (name: string) => 'data:image/jpeg;base64,' + btoa(name);
const GUARD = 'u-guard-sasa-1';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let now = NOW;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  const at = (iso: string) => (now = iso);
  const later = (min: number) => (now = new Date(Date.parse(now) + min * 60_000).toISOString());
  return { ds, svc, at, later, now: () => now };
}

/** The guard's demo PIN, set by the company office as in real life (the mock data's own PINs are not used here). */
const PIN = '4826';

async function enrolled() {
  const f = fresh();
  const cm = await f.svc.user('u-cm-sasa');
  const g = await f.svc.user(GUARD);
  const person = f.ds.people.find((p) => p.id === g.personId)!;
  await f.svc.setStaffPin(cm, person.id, PIN);
  const code = await f.svc.guardPhone.issueCode(cm, person.id);
  const r = await f.svc.guardPhone.enrol(g, { phoneId: code.phoneId, code: code.code, staffNo: person.staffNo, deviceLabel: 'Android test' });
  if (!r.ok) throw new Error(r.message);
  return { ...f, cm, g, person, code, device: r.device };
}

async function withFace(by: 'phone' | 'server' = 'phone') {
  const f = await enrolled();
  const reg = await f.svc.guardPhone.registerFace(f.g, f.device, { pin: PIN, photo: pic('reg'), descriptor: me, descriptorBy: by });
  expect(reg.ok).toBe(true);
  await f.svc.decideFace(await f.svc.user('u-pwvsb-hr'), f.person.id, true, 'Matches the guard card photo');
  return f;
}

const phoneFace = (d = me, live = true) => ({ engine: 'phone' as const, descriptor: d, live, photo: pic('signin') });

async function signedIn() {
  const f = await withFace();
  const r = await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace() });
  if (!r.ok) throw new Error(r.message);
  return { ...f, session: r.session };
}

describe('Guard phone: enrolment', () => {
  it('the company office issues a one-time code; the guard enrols with it and their staff number', async () => {
    const { ds, code, device, person } = await enrolled();
    expect(code.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const row = ds.guardPhones.find((x) => x.id === device.phoneId)!;
    expect(row.status).toBe('active');
    expect(row.codeHash).toBeNull();
    // Only hashes are kept: the code and the secret never appear in the row.
    expect(JSON.stringify(row)).not.toContain(device.secret);
    expect(JSON.stringify(row)).not.toContain(code.code.replace('-', ''));
    expect(ds.audit.some((a) => a.action === 'guard_phone.enrol' && a.entityId === person.id)).toBe(true);
  });

  it('refuses a wrong code or staff number, and cancels the code after the limit', async () => {
    const f = fresh();
    const cm = await f.svc.user('u-cm-sasa');
    const g = await f.svc.user(GUARD);
    await f.svc.setStaffPin(cm, g.personId!, PIN);
    const code = await f.svc.guardPhone.issueCode(cm, g.personId!);
    const staffNo = f.ds.people.find((p) => p.id === g.personId)!.staffNo;
    expect((await f.svc.guardPhone.enrol(g, { phoneId: code.phoneId, code: 'AAAA-AAAA', staffNo })).ok).toBe(false);
    expect((await f.svc.guardPhone.enrol(g, { phoneId: code.phoneId, code: code.code, staffNo: 'X999' })).ok).toBe(false);
    for (let i = 0; i < RULES.guardPhone.value.maxFailedTries - 2; i++) await f.svc.guardPhone.enrol(g, { phoneId: code.phoneId, code: 'BBBB-BBBB', staffNo });
    const late = await f.svc.guardPhone.enrol(g, { phoneId: code.phoneId, code: code.code, staffNo });
    expect(late.ok).toBe(false);
    expect(f.ds.guardPhones.find((x) => x.id === code.phoneId)!.status).toBe('expired');
  });

  it('refuses an expired code, a guard without a PIN, and anyone who does not set PINs', async () => {
    const f = fresh();
    const cm = await f.svc.user('u-cm-sasa');
    const g = await f.svc.user(GUARD);
    f.ds.people.find((p) => p.id === g.personId)!.pinHash = null;
    await expect(f.svc.guardPhone.issueCode(cm, g.personId!)).rejects.toThrow(/PIN first/);
    await f.svc.setStaffPin(cm, g.personId!, PIN);
    await expect(f.svc.guardPhone.issueCode(await f.svc.user('u-cm-inas'), g.personId!)).rejects.toBeInstanceOf(AccessDenied);
    await expect(f.svc.guardPhone.issueCode(g, g.personId!)).rejects.toBeInstanceOf(AccessDenied);
    const code = await f.svc.guardPhone.issueCode(cm, g.personId!);
    f.later(RULES.guardPhone.value.codeValidHours * 60 + 1);
    const staffNo = f.ds.people.find((p) => p.id === g.personId)!.staffNo;
    expect((await f.svc.guardPhone.enrol(g, { phoneId: code.phoneId, code: code.code, staffNo })).ok).toBe(false);
  });

  it('a code made for one guard cannot enrol another guard', async () => {
    const f = fresh();
    const cm = await f.svc.user('u-cm-sasa');
    const g1 = await f.svc.user(GUARD);
    const g2 = await f.svc.user('u-guard-sasa-2');
    await f.svc.setStaffPin(cm, g1.personId!, PIN);
    const code = await f.svc.guardPhone.issueCode(cm, g1.personId!);
    const staffNo2 = f.ds.people.find((p) => p.id === g2.personId)!.staffNo;
    expect((await f.svc.guardPhone.enrol(g2, { phoneId: code.phoneId, code: code.code, staffNo: staffNo2 })).ok).toBe(false);
  });

  it('a new phone retires the old one and ends its sign-in', async () => {
    const f = await signedIn();
    const code = await f.svc.guardPhone.issueCode(f.cm, f.person.id);
    const r = await f.svc.guardPhone.enrol(f.g, { phoneId: code.phoneId, code: code.code, staffNo: f.person.staffNo });
    expect(r.ok).toBe(true);
    expect(f.ds.guardPhones.find((x) => x.id === f.device.phoneId)!.status).toBe('revoked');
    expect(f.ds.guardPhoneSessions.find((s) => s.id === f.session.id)!.endReason).toBe('replaced');
    await expect(f.svc.guardPhone.status(f.g, f.device)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Guard phone: face plus PIN sign-in', () => {
  it('a face must be registered on the phone after the PIN, then approved by HR, before sign-in', async () => {
    const f = await enrolled();
    const none = await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace() });
    expect(none).toMatchObject({ ok: false, reason: 'no_face' });
    const wrongPin = await f.svc.guardPhone.registerFace(f.g, f.device, { pin: '0000', photo: pic('reg'), descriptor: me, descriptorBy: 'phone' });
    expect(wrongPin.ok).toBe(false);
    expect((await f.svc.guardPhone.registerFace(f.g, f.device, { pin: PIN, photo: pic('reg'), descriptor: me, descriptorBy: 'phone' })).ok).toBe(true);
    expect((await f.svc.guardPhone.status(f.g, f.device)).face).toBe('pending');
    expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace() })).toMatchObject({ ok: false, reason: 'no_face' });
    // The guard's face shows on HR's ordinary face list.
    const hr = await f.svc.user('u-pwvsb-hr');
    expect((await f.svc.faceReviews(hr)).pending.some((x) => x.personId === f.person.id)).toBe(true);
  });

  it('signs in with the right PIN and a matching, moving face', async () => {
    const { session, ds, person } = await signedIn();
    expect(session.face).toMatchObject({ score: 1, live: true, engine: 'phone' });
    expect(ds.audit.at(-1)!.action).toBe('guard_phone.sign_in');
    expect(ds.audit.at(-1)!.entityId).toBe(person.id);
  });

  it('never signs in on the PIN alone: no face, another face or a still photo is refused', async () => {
    const f = await withFace();
    expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace(null as unknown as number[]) })).toMatchObject({ ok: false, reason: 'face' });
    expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace(other) })).toMatchObject({ ok: false, reason: 'face' });
    expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace(me, false) })).toMatchObject({ ok: false, reason: 'face' });
    expect(f.ds.guardPhoneSessions).toHaveLength(0);
    expect(f.ds.audit.filter((a) => a.action === 'guard_phone.sign_in_refused')).toHaveLength(3);
  });

  it('never signs in on the face alone: a wrong PIN is refused', async () => {
    const f = await withFace();
    expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: '9999', face: phoneFace() })).toMatchObject({ ok: false, reason: 'pin' });
  });

  it('locks the phone after too many wrong tries, then lets the guard in after the lock', async () => {
    const f = await withFace();
    const max = RULES.guardPhone.value.maxFailedTries;
    let last;
    for (let i = 0; i < max; i++) last = await f.svc.guardPhone.signIn(f.g, f.device, { pin: '9999', face: phoneFace() });
    expect(last).toMatchObject({ ok: false, reason: 'locked' });
    expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace() })).toMatchObject({ ok: false, reason: 'locked' });
    f.later(RULES.guardPhone.value.lockMin + 1);
    expect((await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace() })).ok).toBe(true);
  });

  it("refuses a stranger's phone secret and another guard's phone", async () => {
    const f = await withFace();
    const fake: GuardDevice = { ...f.device, secret: 'not-the-secret' };
    await expect(f.svc.guardPhone.signIn(f.g, fake, { pin: PIN, face: phoneFace() })).rejects.toBeInstanceOf(AccessDenied);
    const g2 = await f.svc.user('u-guard-sasa-2');
    await expect(f.svc.guardPhone.signIn(g2, f.device, { pin: PIN, face: phoneFace() })).rejects.toBeInstanceOf(AccessDenied);
  });

  describe("with Prima's own face engine on the server", () => {
    const TURN: Record<FaceStep, number> = { centre: 0.02, left: 0.25, right: -0.25 };
    const frame = (s: FaceStep, d = me): FaceFrame => ({ descriptor: d, turn: TURN[s], faces: 1 });
    const steps: FaceStep[] = ['centre', 'left', 'centre', 'right'];
    const frames = steps.map((_, i) => pic(`f${i}`));

    it('passes the right person who followed the steps, once per challenge', async () => {
      const f = await withFace('server');
      const bind = await f.svc.guardPhone.challengeBind(f.g, f.device);
      const face = { engine: 'server' as const, bind, steps, frames, found: steps.map((s) => frame(s)) };
      const r = await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face }, async () => frame('centre'));
      expect(r.ok).toBe(true);
      // The same challenge cannot be used again.
      const again = await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face }, async () => frame('centre'));
      expect(again).toMatchObject({ ok: false, reason: 'face' });
    });

    it('refuses a held-up photo and another person', async () => {
      const f = await withFace('server');
      const still = { engine: 'server' as const, bind: await f.svc.guardPhone.challengeBind(f.g, f.device), steps, frames, found: steps.map(() => frame('centre')) };
      expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: still }, async () => frame('centre'))).toMatchObject({ ok: false, reason: 'face' });
      const bind = await f.svc.guardPhone.challengeBind(f.g, f.device);
      const stranger = { engine: 'server' as const, bind, steps, frames, found: steps.map((s) => frame(s, other)) };
      expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: stranger }, async () => frame('centre'))).toMatchObject({ ok: false, reason: 'face' });
    });
  });
});

describe('Guard phone: heartbeat and on-duty location', () => {
  /** The guard's first shift today, and a time inside it. */
  function onShift(f: Awaited<ReturnType<typeof signedIn>>) {
    const s = f.ds.shifts.filter((x) => x.personId === f.person.id && x.status === 'published').sort((a, b) => a.start.localeCompare(b.start));
    const shift = s.find((x) => x.date === TODAY) ?? s.at(-1)!;
    return shift;
  }

  it('keeps location on duty without a notice step, and never off duty; the heartbeat keeps the phone live for CMS', async () => {
    const f = await signedIn();
    const shift = onShift(f);
    f.at(new Date(toMs(shift.start) + 30 * 60_000).toISOString());
    const where = { lat: 3.1, lng: 101.6, accuracyM: 12 };
    const kept = await f.svc.guardPhone.heartbeat(f.g, f.session.id, where);
    expect(kept).toMatchObject({ location: 'kept', onDuty: true });
    expect(f.ds.guardPings).toHaveLength(1);
    expect(f.ds.guardPings[0]).toMatchObject({ siteId: shift.siteId, shiftId: shift.id, personId: f.person.id });
    expect(typeof f.ds.guardPings[0].distanceM).toBe('number');
    // Not more often than the rule.
    expect((await f.svc.guardPhone.heartbeat(f.g, f.session.id, where)).location).toBe('too_soon');
    // Off duty: nothing kept, and the last location is cleared from the board.
    f.at(new Date(toMs(shift.end) + (RULES.guardPhone.value.dutyMarginMin + 5) * 60_000).toISOString());
    const off = await f.svc.guardPhone.heartbeat(f.g, f.session.id, where);
    expect(off).toMatchObject({ location: 'off_duty', onDuty: false });
    expect(off.session.lastLat).toBeNull();
    expect(f.ds.guardPings).toHaveLength(1);
  });

  it('CMS sees each signed-in phone live, late or offline, and only CMS (or those above it) may look', async () => {
    const f = await signedIn();
    const shift = onShift(f);
    f.at(new Date(toMs(shift.start) + 10 * 60_000).toISOString());
    await f.svc.guardPhone.heartbeat(f.g, f.session.id, { lat: 3.1, lng: 101.6 });
    const cms = await f.svc.user('u-cms-head');
    const live = await f.svc.guardPhone.board(cms);
    const row = live.phones.find((x) => x.personId === f.person.id)!;
    expect(row).toMatchObject({ state: 'live', onDuty: true });
    expect(row.location).toMatchObject({ lat: 3.1, lng: 101.6 });
    f.later(3);
    expect((await f.svc.guardPhone.board(cms)).phones.find((x) => x.personId === f.person.id)!.state).toBe('late');
    f.later(RULES.guardPhone.value.offlineAfterMin);
    const off = await f.svc.guardPhone.board(cms);
    expect(off.phones.find((x) => x.personId === f.person.id)!.state).toBe('offline');
    expect(off.counts.offline).toBeGreaterThanOrEqual(1);
    await expect(f.svc.guardPhone.board(f.g)).rejects.toBeInstanceOf(AccessDenied);
    await expect(f.svc.guardPhone.board(await f.svc.user('u-ae-arsh'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('works out live, late and offline from the last heartbeat', () => {
    const t = Date.parse(NOW);
    expect(guardPhoneState(NOW, t + 60_000)).toBe('live');
    expect(guardPhoneState(NOW, t + 3 * 60_000)).toBe('late');
    expect(guardPhoneState(NOW, t + 6 * 60_000)).toBe('offline');
  });

  it('signing out or retiring the phone ends the session at once', async () => {
    const f = await signedIn();
    await f.svc.guardPhone.signOut(f.g, f.session.id);
    await expect(f.svc.guardPhone.heartbeat(f.g, f.session.id, {})).rejects.toBeInstanceOf(AccessDenied);
    const r = await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: phoneFace() });
    if (!r.ok) throw new Error(r.message);
    await expect(f.svc.guardPhone.revoke(f.cm, f.device.phoneId, '')).rejects.toThrow(/reason/);
    await f.svc.guardPhone.revoke(f.cm, f.device.phoneId, 'Phone lost');
    await expect(f.svc.guardPhone.me(f.g, r.session.id)).rejects.toBeInstanceOf(AccessDenied);
    await expect(f.svc.guardPhone.status(f.g, f.device)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('the office list shows phones without any code or secret', async () => {
    const f = await signedIn();
    const list = await f.svc.guardPhone.phones(f.cm, 'co-sasa');
    const row = list.find((x) => x.personId === f.person.id)!;
    expect(row).toMatchObject({ status: 'active', signedIn: true, deviceLabel: 'Android test' });
    expect(JSON.stringify(list)).not.toMatch(/secretHash|codeHash/);
    expect(JSON.stringify(list)).not.toContain(f.device.secret);
    await expect(f.svc.guardPhone.phones(await f.svc.user('u-cm-inas'), 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Guard phone: SOS', () => {
  it('raises a Guard SOS in the CMS queue with the location, and a second press updates it', async () => {
    const f = await signedIn();
    const first = await f.svc.guardPhone.sos(f.g, { sessionId: f.session.id }, { lat: 3.2, lng: 101.7, accuracyM: 8 });
    expect(first.repeated).toBe(false);
    expect(first.alarm).toMatchObject({ kind: 'GUARD_SOS', status: 'new', personId: f.person.id, lat: 3.2, companyId: 'co-sasa' });
    const again = await f.svc.guardPhone.sos(f.g, { sessionId: f.session.id }, { lat: 3.21, lng: 101.71 });
    expect(again.repeated).toBe(true);
    expect(f.ds.siteAlarms.filter((a) => a.personId === f.person.id)).toHaveLength(1);
    expect(f.ds.siteAlarms.find((a) => a.id === first.alarm.id)!.lat).toBe(3.21);
    // It is the ordinary CMS alarm: CMS sees it and acknowledges it on the alarm desk.
    const cms = await f.svc.user('u-cms-head');
    expect((await f.svc.guardPhone.board(cms)).sos.some((a) => a.id === first.alarm.id)).toBe(true);
    await f.svc.acknowledgeAlarm(cms, first.alarm.id);
    expect(f.ds.siteAlarms.find((a) => a.id === first.alarm.id)!.status).toBe('acknowledged');
  });

  it('works with the enrolled phone alone, without a PIN or face, even off duty', async () => {
    const f = await enrolled();
    const r = await f.svc.guardPhone.sos(f.g, { device: f.device }, { lat: 3.0, lng: 101.5 });
    expect(r.alarm.kind).toBe('GUARD_SOS');
    expect(r.alarm.lat).toBe(3.0);
    await expect(f.svc.guardPhone.sos(f.g, { device: { ...f.device, secret: 'x' } }, {})).rejects.toBeInstanceOf(AccessDenied);
  });

  it('marks the site unknown when the roster does not say where the guard is', async () => {
    const f = await enrolled();
    for (const s of f.ds.shifts) if (s.personId === f.person.id) s.personId = null;
    const r = await f.svc.guardPhone.sos(f.g, { device: f.device }, {});
    expect(r.alarm.siteUnknown).toBe(true);
    expect(r.alarm.lat).toBeNull();
  });
});
