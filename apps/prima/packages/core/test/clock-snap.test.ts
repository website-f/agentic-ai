// P97 (Fitri, 11 Nov 2026): the face photo at check-in and check-out, the shift route's pieces and gaps, and the
// phone's following notes. Synthetic companies, staff, places, photos and readings only.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  BadRequest,
  MemoryStore,
  PrimaService,
  RULES,
  SNAP_MAX_CHARS,
  analyseMovement,
  fromMs,
  gapCause,
  generateDataset,
  myt,
  routeSegments,
  silences,
  snapImageProblem,
  snapReviewWhy,
  snapView,
  toMs,
  type ClockSnap,
  type RawReading,
  type TrackPoint,
} from '../src';

const TODAY = '2026-11-11';
const T0 = myt(TODAY, '08:00');
const M_PER_DEG = (Math.PI / 180) * 6_371_008.8;
const HQ = { lat: 3.1579, lng: 101.7123 };
const north = (m: number) => ({ lat: HQ.lat + m / M_PER_DEG, lng: HQ.lng });
const min = (n: number) => fromMs(toMs(T0) + n * 60_000);
const PLACE = [{ label: 'Head office', lat: HQ.lat, lng: HQ.lng, radiusM: 150 }];
const rd = (n: number, m: number, source: RawReading['source'] = 'ping'): RawReading => ({ id: `r${n}`, source, capturedAt: min(n), receivedAt: min(n), ...north(m), accuracyM: 10 });
const tp = (n: number, m: number): TrackPoint => ({ id: `p${n}`, source: 'ping', t: min(n), ...north(m), accuracyM: 10 });
/** A tiny real JPEG data URL is not needed: the shape is what is checked. */
const JPEG = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
const DESC = Array.from({ length: 128 }, (_, i) => Math.round(Math.sin(i + 1) * 1000) / 10000);

describe('shift route pieces and gaps (P97)', () => {
  it('cuts the route into inside, outside (highlighted) and gap (dashed) pieces, and counts the gap line apart', () => {
    // 08:00-08:20 at the office, 08:30-08:40 two km out, then nothing for 50 minutes, back at 09:30.
    const pts = [tp(0, 5), tp(10, 8), tp(20, 6), tp(30, 2_000), tp(40, 2_050), tp(90, 10), tp(95, 12)];
    const { segments, gapDistanceM } = routeSegments(pts, PLACE, { gapMin: 30, measured: true });
    expect(segments.map((s) => s.kind)).toEqual(['inside', 'outside', 'gap', 'inside']);
    // The gap joins the last position before it to the first after it: nothing in between is made up.
    const gap = segments[2];
    expect(gap.path).toHaveLength(2);
    expect(gap.path[0].t).toBe(min(40));
    expect(gap.path[1].t).toBe(min(90));
    expect(gapDistanceM).toBeGreaterThan(1_990);
    expect(gapDistanceM).toBeLessThan(2_060);
    // Without a place: the pieces are free, gaps still dashed.
    expect(routeSegments(pts, [], { gapMin: 30, measured: false }).segments.map((s) => s.kind)).toEqual(['free', 'gap', 'free']);
  });

  it('lists every silence longer than the gap rule, from the clock-in, between readings, and to now while open', () => {
    const pts = [tp(40, 0), tp(50, 0), tp(120, 0)];
    expect(silences(pts, { from: min(0), to: null, now: min(200), gapMin: 30 })).toEqual([
      { from: min(0), to: min(40), minutes: 40 },
      { from: min(50), to: min(120), minutes: 70 },
      { from: min(120), to: null, minutes: 80 },
    ]);
    // After a clock-out the last silence ends at the clock-out.
    expect(silences(pts, { from: min(30), to: min(160), now: min(200), gapMin: 30 }).at(-1)).toEqual({ from: min(120), to: min(160), minutes: 40 });
  });

  it('gives each gap the cause the phone noted, and Unknown when it said nothing', () => {
    const notes = [
      { at: min(51), kind: 'hidden' as const },
      { at: min(119), kind: 'visible' as const },
      { at: min(200), kind: 'denied' as const },
    ];
    expect(gapCause(notes, min(50), min(120), 0)).toBe('closed');
    expect(gapCause(notes, min(190), min(260), 0)).toBe('denied');
    expect(gapCause(notes, min(300), min(400), 0)).toBe('unknown');
    // Denied beats closed in the same gap.
    expect(gapCause([...notes, { at: min(60), kind: 'denied' }], min(50), min(120), 0)).toBe('denied');
  });

  it('puts pieces and gaps on the movement summary, never inventing positions', () => {
    const raw = [rd(0, 5, 'in'), rd(10, 6), rd(20, 2_000), rd(30, 2_010), rd(100, 8), rd(110, 9)];
    const m = analyseMovement({ raw, from: min(0), to: min(110), now: min(200), targets: PLACE, notes: [{ at: min(31), kind: 'hidden' }] });
    expect(m.segments.some((s) => s.kind === 'outside')).toBe(true);
    expect(m.segments.filter((s) => s.kind === 'gap')).toHaveLength(1);
    expect(m.gaps).toEqual([{ from: min(30), to: min(100), minutes: 70, cause: 'closed' }]);
    // Every point drawn is a reading that came; the pieces add none.
    const drawn = new Set(m.segments.flatMap((s) => s.path.map((p) => p.t)));
    for (const t of drawn) expect(raw.some((r) => r.receivedAt === t)).toBe(true);
    expect(m.gapDistanceM).toBeGreaterThan(1_900);
    // A home day: nothing followed, no pieces.
    expect(analyseMovement({ raw, from: min(0), to: min(110), now: min(200), targets: PLACE, home: true }).segments).toEqual([]);
  });
});

describe('face photo rules (P97)', () => {
  it('takes only an app camera JPEG of a sensible size', () => {
    expect(snapImageProblem(JPEG)).toBeNull();
    expect(snapImageProblem('data:image/png;base64,AAAA')).toMatch(/app camera/);
    expect(snapImageProblem(`data:image/jpeg;base64,${'A'.repeat(SNAP_MAX_CHARS)}`)).toMatch(/too large/);
    expect(snapImageProblem('<script>')).toMatch(/app camera/);
  });

  it('says what a manager or HR looks at', () => {
    const base = { mode: 'photo' as const, enrolled: false, faceFound: true, live: true, face: null, reason: null };
    expect(snapReviewWhy(base)).toEqual([]);
    expect(snapReviewWhy({ ...base, live: false })).toEqual(['not_live']);
    expect(snapReviewWhy({ ...base, faceFound: false })).toEqual(['no_face']);
    // Prima's own engine on the server: the phone makes no face numbers, which is not a problem by itself.
    expect(snapReviewWhy({ ...base, faceFound: false }, false)).toEqual([]);
    expect(snapReviewWhy({ ...base, mode: 'face', enrolled: true, face: { score: 0.4, matched: false } })).toEqual(['not_matched']);
    expect(snapReviewWhy({ ...base, mode: 'none', faceFound: false, reason: 'front camera broken' })).toEqual(['no_camera']);
    expect(snapReviewWhy({ ...base, mode: 'none', faceFound: false })).toEqual(['no_photo']);
  });

  it('drops the picture after its keeping day', () => {
    const s = { image: JPEG, keepUntil: '2026-11-20' } as ClockSnap;
    expect(snapView(s, '2026-11-20').image).toBe(JPEG);
    expect(snapView(s, '2026-11-21')).toMatchObject({ image: '', kept: false });
  });

  it('is on by default (rule HR-STAFF-SNAP)', () => {
    expect(RULES.staffClockSnap.id).toBe('HR-STAFF-SNAP');
    expect(RULES.staffClockSnap.value.on).toBe(true);
  });
});

function setup() {
  const ds = generateDataset({ today: TODAY, now: T0 });
  const store = new MemoryStore(ds);
  const at = { now: T0 };
  const svc = new PrimaService(store, () => at.now);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  const later = (m: number) => (at.now = fromMs(toMs(at.now) + m * 60_000));
  return { ds, store, svc, user, later, at };
}

describe('face photo at check-in and check-out (P97, service)', () => {
  const STAFF = 'u-ae-arsh';
  const PEER = 'u-ae-arsh-2';
  const MANAGER = 'u-cm-arsh';
  const OTHER_MANAGER = 'u-cm-sasa';
  /** The mock Arrow Shield office (the staff member's base), and points north of it. */
  const OFFICE = { lat: 3.1073, lng: 101.6067 };
  const fix = (m: number) => ({ lat: OFFICE.lat + m / M_PER_DEG, lng: OFFICE.lng, accuracyM: 10 });

  it('keeps the photo with the check-in and the check-out, shows it on the record, and to the right people only', async () => {
    const { svc, user, later, store } = setup();
    const staff = user(STAFF);
    const r = await svc.checkIn(staff, 'in', { ...fix(5), face: { image: JPEG, descriptor: DESC, live: true } });
    expect(r.photo.kept).toBe(true);
    expect(r.photo.snap).toMatchObject({ kind: 'in', mode: 'photo', faceFound: true, live: true, review: null });
    expect(r.photo.snap).not.toHaveProperty('image');
    later(60);
    await svc.staffPing(staff, { ...fix(10), capturedAt: (svc as unknown as { now(): string }).now() });
    later(60);
    // Check-out without a camera: still recorded, with the reason, for the manager to look at.
    const o = await svc.checkIn(staff, 'out', { ...fix(8), noCamera: { reason: 'Front camera cracked this morning' } });
    expect(o.photo.snap).toMatchObject({ kind: 'out', mode: 'none', reason: 'Front camera cracked this morning', reviewOpen: true });
    const clockId = o.clock!.id;
    const own = await svc.staffClockDetail(staff, clockId);
    expect(own.snaps.map((s) => [s.kind, !!s.image])).toEqual([
      ['in', true],
      ['out', false],
    ]);
    // The manager sees the record and the photo to look at; the peer and another company's manager do not.
    const mgr = await svc.staffClockDetail(user(MANAGER), clockId);
    expect(mgr.snaps).toHaveLength(2);
    const rev = await svc.clockSnapReviews(user(MANAGER));
    expect(rev.open.map((s) => s.userId)).toEqual([STAFF]);
    expect((await svc.clockSnapReviews(user(OTHER_MANAGER))).open).toEqual([]);
    await expect(svc.clockSnapReviews(user(PEER))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideClockSnap(user(OTHER_MANAGER), rev.open[0].id, 'cleared', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    // A comment is needed; then it is decided once.
    await expect(svc.decideClockSnap(user(MANAGER), rev.open[0].id, 'cleared', '  ')).rejects.toBeInstanceOf(BadRequest);
    const d = await svc.decideClockSnap(user(MANAGER), rev.open[0].id, 'cleared', 'Seen at the office desk, camera is broken');
    expect(d.review).toMatchObject({ status: 'cleared', byId: MANAGER });
    expect(d.reviewOpen).toBe(false);
    await expect(svc.decideClockSnap(user(MANAGER), rev.open[0].id, 'upheld', 'again')).rejects.toBeInstanceOf(BadRequest);
    // Kept in its own table, nothing more.
    expect((await store.list('clockSnaps', { userId: STAFF })).length).toBe(2);
  });

  it('refuses a broken photo before anything is saved, and a too-short no-camera reason', async () => {
    const { svc, user, store } = setup();
    const staff = user(STAFF);
    await expect(svc.checkIn(staff, 'in', { ...fix(5), face: { image: 'data:image/png;base64,AAAA', descriptor: [], live: false } })).rejects.toThrow(/app camera/);
    await expect(svc.checkIn(staff, 'in', { ...fix(5), noCamera: { reason: 'no' } })).rejects.toThrow(/at least 10/);
    expect(await store.list('checkinEvents', { userId: STAFF })).toEqual([]);
  });

  it('records a check-in from an older app without any photo, for a look, never refusing it', async () => {
    const { svc, user } = setup();
    const r = await svc.checkIn(user(STAFF), 'in', fix(5));
    expect(r.event.outcome).toBe('accepted');
    expect(r.photo.snap).toMatchObject({ mode: 'none', reason: null, review: { status: 'open', why: ['no_photo'] } });
  });

  it('nobody decides their own photo', async () => {
    const { svc, user } = setup();
    const mgr = user(MANAGER);
    const r = await svc.checkIn(mgr, 'in', { ...fix(5), face: { image: JPEG, descriptor: DESC, live: false } });
    expect(r.photo.snap?.review?.why).toEqual(['not_live']);
    expect((await svc.clockSnapReviews(mgr)).open).toEqual([]);
    await expect(svc.decideClockSnap(mgr, r.photo.snap!.id, 'cleared', 'mine')).rejects.toThrow(/someone else/);
  });

  it('keeps the phone notes on the open clock only, and they explain the gap', async () => {
    const { svc, user, later, at } = setup();
    const staff = user(STAFF);
    await svc.checkIn(staff, 'in', { ...fix(5), face: { image: JPEG, descriptor: DESC, live: true } });
    later(5);
    const hidden = at.now;
    later(55);
    const r = await svc.staffPings(staff, [{ ...fix(6), capturedAt: at.now }], [
      { at: hidden, kind: 'hidden' },
      { at: hidden, kind: 'hidden' },
      { at: '2026-11-10T08:00:00+08:00', kind: 'denied' },
      { at: at.now, kind: 'bogus' as never },
    ]);
    expect(r).toMatchObject({ accepted: 1, notes: 1 });
    const mine = await svc.myStaffClock(staff);
    expect(mine.open?.trackNotes).toEqual([{ at: hidden, kind: 'hidden' }]);
    expect(mine.today?.movement?.gaps[0]).toMatchObject({ cause: 'closed' });
  });
});

describe('owner TEST check-in photo (P97)', () => {
  it('keeps the test photo on the owner row, and checks it like a staff photo', async () => {
    const { svc, user, later } = setup();
    const owner = user('u-fauzan');
    const KL = { lat: 3.1478, lng: 101.6953, accuracyM: 8 };
    await expect(svc.ownerTestCheckins.start(owner, KL, { face: { image: 'nope', descriptor: [], live: false } })).rejects.toThrow(/app camera/);
    const s = await svc.ownerTestCheckins.start(owner, KL, { face: { image: JPEG, descriptor: DESC, live: true } });
    expect(s.snaps?.in).toMatchObject({ image: JPEG, faceFound: true, live: true, reason: null });
    later(20);
    const e = await svc.ownerTestCheckins.end(owner, { ...KL, lat: KL.lat + 0.002 }, { noCamera: { reason: 'Testing without the camera' } });
    expect(e.snaps).toMatchObject({ in: { image: JPEG }, out: { image: '', reason: 'Testing without the camera' } });
    const mine = await svc.ownerTestCheckins.mine(owner);
    expect(mine.sessions[0].snaps?.in?.image).toBe(JPEG);
    expect(mine.sessions[0].movement.segments.length).toBeGreaterThan(0);
  });
});
