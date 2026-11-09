// P93 (Fitri, 9 Nov 2026): the clock-in error, the distance at log-out and movement out of station. Synthetic companies,
// staff, places and readings only.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MOVEMENT_DEFAULTS,
  MemoryStore,
  PrimaService,
  analyseMovement,
  checkinStateNow,
  cleanTrack,
  clockCarriesOver,
  fakeLocationCount,
  fromMs,
  generateDataset,
  haversineM,
  myt,
  pingDue,
  routeDistanceM,
  routeLengthM,
  stationTimeline,
  toMs,
  type CheckinEvent,
  type Company,
  type RawReading,
  type User,
} from '../src';

const TODAY = '2026-11-09';
const T0 = myt(TODAY, '08:30');
const M_PER_DEG = (Math.PI / 180) * 6_371_008.8;
const HQ = { lat: 3.1579, lng: 101.7123 };
const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / M_PER_DEG, lng: p.lng });
const east = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat, lng: p.lng + m / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)) });
const min = (n: number) => fromMs(toMs(T0) + n * 60_000);
const PLACE = [{ label: 'Head office', lat: HQ.lat, lng: HQ.lng, radiusM: 150 }];

/** A reading n minutes after 08:30 at a point, taken and received at the same moment unless said. */
const rd = (n: number, p: { lat: number; lng: number }, acc: number | null = 10, over: Partial<RawReading> = {}): RawReading => ({
  id: `r-${n}-${p.lat.toFixed(6)}-${acc}`,
  source: 'ping',
  capturedAt: min(n),
  receivedAt: min(n),
  lat: p.lat,
  lng: p.lng,
  accuracyM: acc,
  ...over,
});
/** A little deterministic GPS wobble around a point, within about 8 m. */
const wobble = (p: { lat: number; lng: number }, i: number) => east(north(p, 8 * Math.sin(i * 1.7)), 8 * Math.cos(i * 2.3));

describe('Distance (P93)', () => {
  it('does not count GPS jitter of a phone lying still as walking', () => {
    const raw = Array.from({ length: 60 }, (_, i) => rd(i * 2, wobble(HQ, i), 12));
    const naive = routeLengthM(raw.map((r) => ({ lat: r.lat!, lng: r.lng! })));
    expect(naive).toBeGreaterThan(400);
    const t = cleanTrack(raw, { from: T0, to: min(120), now: min(120) });
    expect(routeDistanceM(t.points)).toBeLessThan(25);
  });

  it('counts a real walk', () => {
    const raw = Array.from({ length: 11 }, (_, i) => rd(i * 2, north(HQ, i * 100), 8));
    const t = cleanTrack(raw, { from: T0, to: null, now: min(30) });
    expect(routeDistanceM(t.points)).toBeGreaterThan(980);
    expect(routeDistanceM(t.points)).toBeLessThan(1020);
  });

  it('leaves out a one-off far reading, and flags a jump the phone stays at', () => {
    const spike = [rd(0, HQ), rd(1, north(HQ, 8_000)), rd(2, HQ), rd(15, HQ)];
    const s = cleanTrack(spike, { from: T0, to: null, now: min(20) });
    expect(s.points).toHaveLength(3);
    expect(s.dropped.jump).toBe(1);
    expect(s.jumps).toEqual([expect.objectContaining({ confirmed: false })]);
    expect(routeDistanceM(s.points)).toBe(0);
    // 40 km in a minute, and the phone stays there: a real jump (mock location or another phone) for the manager.
    const far = north(HQ, 40_000);
    const jump = [rd(0, HQ), rd(1, far), rd(3, north(far, 30)), rd(5, north(far, 60))];
    const j = cleanTrack(jump, { from: T0, to: null, now: min(10) });
    expect(j.points).toHaveLength(4);
    expect(j.jumps).toEqual([expect.objectContaining({ confirmed: true, distanceM: 40_000 })]);
    const m = analyseMovement({ raw: jump, from: T0, to: null, now: min(10), targets: PLACE });
    expect(m.flags.map((f) => f.kind)).toContain('jump');
    // Driving at 80 km/h is travel, not a jump.
    const drive = Array.from({ length: 6 }, (_, i) => rd(i * 2, north(HQ, i * 2_667), 10));
    expect(cleanTrack(drive, { from: T0, to: null, now: min(15) }).jumps).toEqual([]);
  });

  it('orders by the phone time, uses the server time when the phone clock is ahead, and keeps a reading sent twice once', () => {
    const a = rd(10, north(HQ, 300));
    const b = rd(5, north(HQ, 100));
    // Queued while offline: taken at 08:45, received at 09:10.
    const queued = rd(15, north(HQ, 500), 10, { receivedAt: min(40) });
    // The phone says 09:30 but the server got it at 08:50: the phone clock is ahead.
    const ahead = rd(60, north(HQ, 600), 10, { receivedAt: min(20) });
    const t = cleanTrack([a, queued, b, a, { ...a, id: 'other-id' }, ahead], { from: T0, to: null, now: min(45) });
    expect(t.points.map((p) => p.t)).toEqual([min(5), min(10), min(15), min(20)]);
    expect(t.dropped.duplicate).toBe(2);
    expect(t.phoneAhead).toBe(1);
  });

  it('stops at the clock-out and starts at the clock-in, and leaves rough or missing readings out', () => {
    const raw = [
      rd(-30, HQ),
      rd(0, HQ, 8, { source: 'in' }),
      rd(10, north(HQ, 200)),
      rd(20, north(HQ, 400), 900),
      rd(25, north(HQ, 400), null),
      { ...rd(30, HQ), lat: null, lng: null },
      rd(40, north(HQ, 400), 10, { source: 'out' }),
      // After the clock-out at 09:10 (sent late): not part of the session.
      rd(55, north(HQ, 3_000)),
    ];
    const t = cleanTrack(raw, { from: T0, to: min(40), now: min(90) });
    expect(t.points.map((p) => p.source)).toEqual(['in', 'ping', 'out']);
    expect(t.dropped).toMatchObject({ before_start: 1, after_end: 1, rough: 2, no_location: 1 });
    expect(routeDistanceM(t.points)).toBe(400);
  });

  it('ignores a rough last reading at check-out instead of drawing a line to it (the log-out distance)', () => {
    const walk = [rd(0, HQ, 8, { source: 'in' }), rd(10, north(HQ, 100)), rd(20, north(HQ, 200))];
    const roughOut = rd(25, north(HQ, 2_500), 1_400, { source: 'out' });
    const m = analyseMovement({ raw: [...walk, roughOut], from: T0, to: min(25), now: min(25), targets: PLACE });
    expect(m.distanceM).toBe(200);
    expect(m.readings.dropped.rough).toBe(1);
  });
});

describe('Out of station (P93)', () => {
  const day = (outFrom: number, outTo: number) => {
    const raw: RawReading[] = [rd(0, HQ, 8, { source: 'in' })];
    for (let n = 5; n <= 120; n += 5) raw.push(rd(n, n >= outFrom && n < outTo ? north(HQ, 2_000) : wobble(HQ, n), 10));
    return raw;
  };

  it('splits the session into inside and outside, and flags outside for longer than the rule', () => {
    const m = analyseMovement({ raw: day(30, 60), from: T0, to: min(120), now: min(120), targets: PLACE });
    expect(m.measure).toBe('measured');
    expect(m.outsideMin).toBe(30);
    expect(m.insideMin).toBe(90);
    expect(m.unknownMin).toBe(0);
    const out = m.flags.filter((f) => f.kind === 'out_of_station');
    expect(out).toEqual([expect.objectContaining({ at: min(30), to: min(60), minutes: 30, place: 'Head office' })]);
    expect(out[0].distanceM).toBeGreaterThan(1_800);
    // 10 minutes out is under 15: recorded, not flagged.
    const short = analyseMovement({ raw: day(30, 40), from: T0, to: min(120), now: min(120), targets: PLACE });
    expect(short.outsideMin).toBe(10);
    expect(short.flags.some((f) => f.kind === 'out_of_station')).toBe(false);
    // The minutes are a rule: at 5 it is flagged.
    expect(analyseMovement({ raw: day(30, 40), from: T0, to: min(120), now: min(120), targets: PLACE, rules: { outOfStationMin: 5 } }).flags.some((f) => f.kind === 'out_of_station')).toBe(true);
  });

  it('gives a reading at the edge the benefit of its accuracy', () => {
    const edge = north(HQ, 170);
    const tl = stationTimeline([{ id: 'a', source: 'ping', t: T0, ...edge, accuracyM: 30 }], PLACE, { from: T0, to: min(10) });
    expect(tl[0].state).toBe('inside');
    const tl2 = stationTimeline([{ id: 'a', source: 'ping', t: T0, ...north(HQ, 260), accuracyM: 30 }], PLACE, { from: T0, to: min(10) });
    expect(tl2[0]).toMatchObject({ state: 'outside', outsideByM: 80 });
  });

  it('shows silence as unknown, never inside, and flags location that stopped', () => {
    const raw = [rd(0, HQ, 8, { source: 'in' }), rd(10, HQ), rd(20, HQ)];
    const m = analyseMovement({ raw, from: T0, to: null, now: min(120), targets: PLACE });
    expect(m.insideMin).toBe(50);
    expect(m.unknownMin).toBe(70);
    expect(m.flags).toEqual([expect.objectContaining({ kind: 'location_stopped', at: min(20), to: null, minutes: 100 })]);
  });

  it('says when it cannot measure: no place set, an outstation day, a home day', () => {
    const raw = day(30, 60);
    expect(analyseMovement({ raw, from: T0, to: min(120), now: min(120), targets: [] })).toMatchObject({ measure: 'no_place', outsideMin: 0 });
    const os = analyseMovement({ raw, from: T0, to: min(120), now: min(120), targets: PLACE, outstation: true });
    expect(os.measure).toBe('outstation');
    expect(os.flags.some((f) => f.kind === 'out_of_station')).toBe(false);
    expect(analyseMovement({ raw, from: T0, to: min(120), now: min(120), targets: PLACE, home: true })).toMatchObject({ measure: 'home', route: [], distanceM: 0 });
    expect(analyseMovement({ raw: [], from: T0, to: null, now: min(10), targets: PLACE }).measure).toBe('no_location');
  });

  it('flags a clock-in far from the place, a fake-looking location and a phone clock set ahead', () => {
    const far = north(HQ, 3_000);
    const m = analyseMovement({ raw: [rd(0, far, 8, { source: 'in' }), rd(10, far)], from: T0, to: null, now: min(20), targets: PLACE });
    expect(m.flags.find((f) => f.kind === 'far_clock_in')).toMatchObject({ place: 'Head office' });
    expect(m.flags.find((f) => f.kind === 'far_clock_in')!.distanceM).toBeGreaterThan(2_800);
    // Six times the exact same point claiming 3 m accuracy: real GPS always moves a little.
    const fake = Array.from({ length: 6 }, (_, i) => rd(i * 5, HQ, 3));
    expect(fakeLocationCount(cleanTrack(fake, { from: T0, to: null, now: min(40) }).points)).toBe(6);
    expect(analyseMovement({ raw: fake, from: T0, to: null, now: min(40), targets: PLACE }).flags.map((f) => f.kind)).toContain('fake_location');
    // A laptop's Wi-Fi location repeats too, but with tens of metres accuracy: not flagged.
    const laptop = Array.from({ length: 8 }, (_, i) => rd(i * 5, HQ, 35));
    expect(fakeLocationCount(cleanTrack(laptop, { from: T0, to: null, now: min(50) }).points)).toBe(0);
    const ahead = analyseMovement({ raw: [rd(0, HQ, 8, { source: 'in' }), rd(30, HQ, 10, { receivedAt: min(5) })], from: T0, to: null, now: min(10), targets: PLACE });
    expect(ahead.flags.map((f) => f.kind)).toContain('phone_time');
  });
});

describe('When the phone sends a reading (P93)', () => {
  const opts = { stillMin: 10, movingMin: 2, movedM: 100 };
  const base = { atMs: 0, ...HQ };
  it('sends about every 10 minutes when still, every 2 minutes when moving, and waits for a usable reading', () => {
    expect(pingDue(null, { atMs: 0, ...HQ, accuracyM: 10 }, opts)).toBe(true);
    expect(pingDue(base, { atMs: 5 * 60_000, ...north(HQ, 20), accuracyM: 10 }, opts)).toBe(false);
    expect(pingDue(base, { atMs: 10 * 60_000, ...HQ, accuracyM: 10 }, opts)).toBe(true);
    expect(pingDue(base, { atMs: 3 * 60_000, ...north(HQ, 300), accuracyM: 10 }, opts)).toBe(true);
    expect(pingDue(base, { atMs: 60_000, ...north(HQ, 300), accuracyM: 10 }, opts)).toBe(false);
    expect(pingDue(base, { atMs: 3 * 60_000, ...north(HQ, 300), accuracyM: 400 }, opts)).toBe(false);
    expect(pingDue(base, { atMs: 11 * 60_000, ...north(HQ, 300), accuracyM: 400 }, opts)).toBe(true);
  });
  it('uses the rule defaults', () => {
    expect(MOVEMENT_DEFAULTS).toMatchObject({ outOfStationMin: 15, maxAccuracyM: 100, maxSpeedKmh: 200 });
    expect(haversineM(HQ, north(HQ, 1000))).toBeCloseTo(1000, 3);
  });
});

// ---------- The service: idempotent clock-in, midnight, and the manager's review items ----------

const co = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, isPilot: false, headOfCompany: '', state: 'Selangor', guardCount: 0, siteCount: 0 }) as Company;
const person = (id: string, over: Partial<User>): User => ({ id, name: id, title: 'Staff', role: 'admin_exec', companyIds: ['co-t1'], siteIds: [], ...over }) as User;

function fresh(start = T0) {
  const ds = generateDataset({ today: TODAY, now: start });
  ds.companies.push(co('co-t1', 'Test One Sdn Bhd'), co('co-t2', 'Test Two Sdn Bhd'));
  ds.users.push(
    person('u-t-mgr', { name: 'Manager One', role: 'company_manager' }),
    person('u-t-mgr2', { name: 'Manager Two', role: 'company_manager', companyIds: ['co-t2'] }),
    person('u-t-staff', { name: 'Staff One' }),
    person('u-t-staff2', { name: 'Staff Two' }),
  );
  let now = start;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, later: (m: number) => (now = fromMs(Date.parse(now) + m * 60_000)), now: () => now, u: (id: string) => svc.user(id) };
}
const fix = (p: { lat: number; lng: number }, capturedAt: string, accuracyM = 10) => ({ ...p, accuracyM, capturedAt });

describe('Clock-in never asks to go out and come back (P93)', () => {
  it('opening Prima and checking in, in either order, make one clock and one check-in', async () => {
    for (const order of ['open-first', 'check-first'] as const) {
      const { svc, ds, u, now } = fresh();
      await svc.saveCheckinPlace(await u('u-t-mgr'), { companyId: 'co-t1', name: 'Head office', address: '', lat: HQ.lat, lng: HQ.lng });
      const staff = await u('u-t-staff');
      if (order === 'open-first') await svc.staffSessionStart(staff);
      const a = await svc.checkIn(staff, 'in', fix(HQ, now()));
      const b = await svc.checkIn(staff, 'in', fix(north(HQ, 30), now()));
      if (order === 'check-first') await svc.staffSessionStart(staff);
      expect(b.already).toBe(true);
      expect(b.event.id).toBe(a.event.id);
      expect(ds.staffClocks.filter((c) => c.userId === 'u-t-staff' && !c.out)).toHaveLength(1);
      expect(ds.checkinEvents.filter((e) => e.userId === 'u-t-staff')).toHaveLength(1);
      // The photo clock-in is idempotent too.
      const img = 'data:image/jpeg;base64,' + btoa(`p93-${order}`);
      const again = await svc.staffClockIn(staff, { image: img, capturedAt: now(), lat: HQ.lat, lng: HQ.lng, accuracyM: 8, face: null });
      expect(again.id).toBe(a.clock!.id);
    }
  });

  it('checks out after midnight a check-in made before it, and starts fresh the next morning after a forgotten one', async () => {
    const late = myt('2026-11-08', '22:00');
    const { svc, ds, u, later, now } = fresh(late);
    const staff = await u('u-t-staff');
    const r = await svc.checkIn(staff, 'in', fix(HQ, now()));
    later(30);
    await svc.staffPing(staff, fix(HQ, now()));
    later(120); // 00:30
    expect((await svc.myCheckin(staff)).state).toBe('in');
    // Opening Prima after midnight keeps the night clock (no "did not sign out").
    expect((await svc.staffSessionStart(staff))!.id).toBe(r.clock!.id);
    const out = await svc.checkIn(staff, 'out', fix(HQ, now()));
    expect(out.already).toBe(false);
    expect(ds.staffClocks.find((c) => c.id === r.clock!.id)!.out).not.toBeNull();

    // A check-in yesterday morning, never checked out, nothing since: today starts a new day.
    const f2 = fresh(myt('2026-11-08', '08:30'));
    const s2 = await f2.u('u-t-staff');
    const first = await f2.svc.checkIn(s2, 'in', fix(HQ, f2.now()));
    f2.later(24 * 60);
    expect((await f2.svc.myCheckin(s2)).state).toBe('none');
    const today = await f2.svc.checkIn(s2, 'in', fix(HQ, f2.now()));
    expect(today.already).toBe(false);
    expect(today.clock!.id).not.toBe(first.clock!.id);
    expect(f2.ds.staffClocks.find((c) => c.id === first.clock!.id)!.flags).toContain('NO_SIGN_OUT');
  });

  it('works out the state across midnight from the check-ins and the current clock', () => {
    const ev = (at: string, kind: 'in' | 'out', clockId: string) => ({ id: at, at, kind, clockId, outcome: 'accepted' }) as CheckinEvent;
    const now = myt(TODAY, '00:30');
    expect(checkinStateNow([ev(myt('2026-11-08', '22:00'), 'in', 'c1')], now, 'c1')).toBe('in');
    expect(checkinStateNow([ev(myt('2026-11-08', '22:00'), 'in', 'c1')], now, null)).toBe('none');
    expect(checkinStateNow([ev(myt('2026-11-08', '22:00'), 'out', 'c1')], now, 'c1')).toBe('none');
    expect(checkinStateNow([ev(myt(TODAY, '00:10'), 'out', 'c1')], now, null)).toBe('out');
    const clock = { in: { receivedAt: myt('2026-11-08', '22:00') }, lastPingAt: myt('2026-11-08', '23:50') } as never;
    expect(clockCarriesOver(clock, now)).toBe(true);
    expect(clockCarriesOver(clock, myt(TODAY, '08:00'))).toBe(false);
  });
});

describe('Movement on the staff clock (P93)', () => {
  async function trip() {
    const f = fresh();
    const { svc, u, later, now } = f;
    const place = await svc.saveCheckinPlace(await u('u-t-mgr'), { companyId: 'co-t1', name: 'Head office', address: '', lat: HQ.lat, lng: HQ.lng });
    await svc.setCheckinRules(await u('u-t-mgr'), ['u-t-staff'], { kind: 'place', placeId: place.id });
    const staff = await u('u-t-staff');
    await svc.checkIn(staff, 'in', fix(HQ, now(), 8));
    // 08:40 at the office, 08:50 to 09:20 two kilometres away, back by 09:30.
    for (const [m, p] of [
      [10, wobble(HQ, 1)],
      [10, north(HQ, 2_000)],
      [10, north(HQ, 2_010)],
      [10, north(HQ, 2_020)],
      [10, wobble(HQ, 2)],
      [10, wobble(HQ, 3)],
    ] as const) {
      later(m);
      await svc.staffPing(staff, fix(p, now()));
    }
    return f;
  }

  it('records the route, distance and time out of station, and puts it on the manager\'s board', async () => {
    const { svc, u } = await trip();
    const mine = await svc.myStaffClock(await u('u-t-staff'));
    const today = mine.today!.movement!;
    expect(today.measure).toBe('measured');
    expect(today.outsideMin).toBe(30);
    expect(today.distanceM).toBeGreaterThan(3_900);
    expect(today.distanceM).toBeLessThan(4_200);
    expect(today.flags.map((f) => f.kind)).toEqual(['out_of_station']);
    expect(mine.recent[0].movement).toMatchObject({ outsideMin: 30 });
    const board = await svc.staffClockBoard(await u('u-t-mgr'));
    expect(board.reviews).toEqual([expect.objectContaining({ userId: 'u-t-staff', kind: 'out_of_station', minutes: 30, place: 'Head office' })]);
    const row = board.rows.find((r) => r.userId === 'u-t-staff')!;
    expect(row.movement).toMatchObject({ outsideMin: 30 });
    const detail = await svc.staffClockDetail(await u('u-t-mgr'), row.clock!.id);
    expect(detail.movement!.route.length).toBeGreaterThan(5);
    expect(detail.movement!.periods.map((p) => p.state)).toEqual(['inside', 'outside', 'inside']);
  });

  it('shows each person their own record, the manager their team, and nobody else', async () => {
    const { svc, u } = await trip();
    const staff = await u('u-t-staff');
    const clockId = (await svc.myStaffClock(staff)).today!.clockId;
    expect((await svc.staffClockDetail(staff, clockId)).movement).not.toBeNull();
    await expect(svc.staffClockDetail(await u('u-t-staff2'), clockId)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.staffClockDetail(await u('u-t-mgr2'), clockId)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.staffClockBoard(staff)).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.staffClockBoard(await u('u-t-mgr2'))).reviews.some((r) => r.userId === 'u-t-staff')).toBe(false);
  });

  it('says when a person has no place to measure against, instead of guessing', async () => {
    const { svc, u, now, later } = fresh();
    const staff = await u('u-t-staff2');
    await svc.checkIn(staff, 'in', fix(HQ, now()));
    later(10);
    await svc.staffPing(staff, fix(north(HQ, 3_000), now()));
    const m = (await svc.myStaffClock(staff)).today!.movement!;
    expect(m.measure).toBe('no_place');
    expect(m.flags.some((f) => f.kind === 'out_of_station')).toBe(false);
  });

  it('keeps a reading sent twice once, and takes readings queued offline only inside the clock session', async () => {
    const { svc, ds, u, later, now } = fresh();
    const staff = await u('u-t-staff');
    await svc.checkIn(staff, 'in', fix(HQ, now()));
    later(5);
    const t1 = now();
    expect((await svc.staffPing(staff, fix(HQ, t1))).accepted).toBe(true);
    later(2);
    expect(await svc.staffPing(staff, fix(HQ, t1))).toMatchObject({ accepted: false, duplicate: true });
    later(30);
    const queued = [fix(north(HQ, 50), fromMs(Date.parse(now()) - 20 * 60_000)), fix(north(HQ, 80), fromMs(Date.parse(now()) - 10 * 60_000)), fix(HQ, t1)];
    expect(await svc.staffPings(staff, queued)).toEqual({ accepted: 2, skipped: 1 });
    await svc.checkIn(staff, 'out', fix(HQ, now()));
    later(60);
    // After the clock-out: a reading taken after it is never kept; one taken before it, sent late, is.
    const res = await svc.staffPings(staff, [fix(HQ, now()), fix(north(HQ, 10), fromMs(Date.parse(now()) - 65 * 60_000))]);
    expect(res).toEqual({ accepted: 1, skipped: 1 });
    expect(ds.locationPings.filter((p) => p.userId === 'u-t-staff')).toHaveLength(4);
  });
});
