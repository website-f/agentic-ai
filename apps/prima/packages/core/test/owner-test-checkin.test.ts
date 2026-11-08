import { describe, expect, it } from 'vitest';
import { BadRequest, MemoryStore, OWNER_TEST_MIN_GAP_S, PrimaService, generateDataset, mayTestCheckin, myt, routeLengthM, thinRoute, type User } from '../src';

// P90: the owner's TEST check-in and check-out with the route between. Synthetic mock data only.
const TODAY = '2026-11-09';
const NOW = myt(TODAY, '09:00');
const OWNER = 'u-fauzan';

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const at = { now: NOW };
  const svc = new PrimaService(store, () => at.now);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  const later = (sec: number) => (at.now = new Date(Date.parse(at.now) + sec * 1000).toISOString().replace('Z', '+00:00'));
  return { ds, store, at, svc, user, later };
}

const KL = { lat: 3.1478, lng: 101.6953, accuracyM: 8 };
const step = (n: number) => ({ lat: KL.lat + n * 0.0009, lng: KL.lng, accuracyM: 9 });

describe('owner test check-in (P90)', () => {
  it('is for the owner only', () => {
    const { ds, user } = setup();
    expect(mayTestCheckin(user(OWNER))).toBe(true);
    const others = ds.users.filter((u) => u.id !== OWNER && !(u.opsTier === 'ceo' && (u.role === 'director' || u.role === 'pwvsb_officer')));
    expect(others.length).toBeGreaterThan(10);
    for (const u of others) expect(mayTestCheckin(u)).toBe(false);
  });

  it('checks in, keeps readings on the way, checks out, and lists the session with its route', async () => {
    const { svc, user, later } = setup();
    const owner = user(OWNER);
    const s = await svc.ownerTestCheckins.start(owner, KL);
    expect(s.purpose).toBe('test');
    expect(s.trail).toHaveLength(1);
    // Too soon after the last reading: not kept.
    later(2);
    expect((await svc.ownerTestCheckins.ping(owner, step(1))).accepted).toBe(false);
    later(OWNER_TEST_MIN_GAP_S + 5);
    const p1 = await svc.ownerTestCheckins.ping(owner, step(1));
    expect(p1.accepted).toBe(true);
    expect(p1.distanceM).toBeGreaterThan(90);
    later(20);
    // A rough reading is not drawn on the route.
    const rough = await svc.ownerTestCheckins.ping(owner, { ...step(2), accuracyM: 900 });
    expect(rough.accepted).toBe(false);
    later(20);
    expect((await svc.ownerTestCheckins.ping(owner, step(2))).accepted).toBe(true);
    // A second check-in while one is open is refused.
    await expect(svc.ownerTestCheckins.start(owner, KL)).rejects.toBeInstanceOf(BadRequest);
    later(600);
    const done = await svc.ownerTestCheckins.end(owner, step(3));
    expect(done.endedAt).toBeTruthy();
    expect(done.trail).toHaveLength(4);
    expect(done.out?.lat).toBeCloseTo(step(3).lat, 5);
    expect(done.distanceM).toBe(routeLengthM(done.trail));
    expect(done.distanceM).toBeGreaterThan(250);
    const mine = await svc.ownerTestCheckins.mine(owner);
    expect(mine.allowed).toBe(true);
    expect(mine.open).toBeNull();
    expect(mine.sessions.map((x) => x.id)).toEqual([s.id]);
    // Nothing more after the check-out.
    await expect(svc.ownerTestCheckins.ping(owner, step(4))).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.ownerTestCheckins.end(owner, step(4))).rejects.toBeInstanceOf(BadRequest);
  });

  it('never touches the clock, check-ins, location readings or attendance, and the staff board does not show it', async () => {
    const { ds, svc, user, later } = setup();
    const owner = user(OWNER);
    const before = {
      clocks: ds.staffClocks.length,
      events: ds.checkinEvents.length,
      pings: ds.locationPings.length,
      attendance: ds.attendance.length,
      days: ds.attendanceDays.length,
    };
    await svc.ownerTestCheckins.start(owner, KL);
    later(30);
    await svc.ownerTestCheckins.ping(owner, step(1));
    later(30);
    await svc.ownerTestCheckins.end(owner, step(2));
    expect({
      clocks: ds.staffClocks.length,
      events: ds.checkinEvents.length,
      pings: ds.locationPings.length,
      attendance: ds.attendance.length,
      days: ds.attendanceDays.length,
    }).toEqual(before);
    expect(ds.ownerTestCheckins).toHaveLength(1);
    const clock = await svc.myStaffClock(owner);
    expect(clock.allowed).toBe(false);
    expect(clock.open).toBeNull();
    const board = await svc.staffClockBoard(owner);
    expect(board.rows.some((r) => r.userId === OWNER)).toBe(false);
  });

  it('refuses everyone else, who see nothing of it', async () => {
    const { ds, svc, user } = setup();
    await svc.ownerTestCheckins.start(user(OWNER), KL);
    for (const id of ['u-pwvsb-hr', 'u-cos']) {
      const u = user(id);
      if (!u) continue;
      await expect(svc.ownerTestCheckins.start(u, KL)).rejects.toBeInstanceOf(BadRequest);
      await expect(svc.ownerTestCheckins.ping(u, KL)).rejects.toBeInstanceOf(BadRequest);
      await expect(svc.ownerTestCheckins.end(u, KL)).rejects.toBeInstanceOf(BadRequest);
      const mine = await svc.ownerTestCheckins.mine(u);
      expect(mine.allowed).toBe(false);
      expect(mine.sessions).toEqual([]);
    }
    expect(ds.ownerTestCheckins).toHaveLength(1);
  });

  it("a second owner sign-in sees only their own tests", async () => {
    const { ds, svc, user } = setup();
    const other: User = { ...user(OWNER), id: 'u-owner-two', name: 'Second owner (mock)' };
    ds.users.push(other);
    await svc.ownerTestCheckins.start(user(OWNER), KL);
    expect((await svc.ownerTestCheckins.mine(other)).sessions).toEqual([]);
    await expect(svc.ownerTestCheckins.end(other, KL)).rejects.toBeInstanceOf(BadRequest);
  });

  it('closes a test left open long ago at its last reading when the next one starts', async () => {
    const { svc, user, later } = setup();
    const owner = user(OWNER);
    const first = await svc.ownerTestCheckins.start(owner, KL);
    later(20 * 3600);
    const second = await svc.ownerTestCheckins.start(owner, step(1));
    const mine = await svc.ownerTestCheckins.mine(owner);
    const old = mine.sessions.find((s) => s.id === first.id)!;
    expect(old.autoEnded).toBe(true);
    expect(old.endedAt).toBe(first.startedAt);
    expect(mine.open?.id).toBe(second.id);
  });

  it('refuses a missing or impossible location', async () => {
    const { svc, user } = setup();
    await expect(svc.ownerTestCheckins.start(user(OWNER), { lat: 95, lng: 10, accuracyM: 5 })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.ownerTestCheckins.start(user(OWNER), { lat: Number.NaN, lng: 10, accuracyM: 5 })).rejects.toBeInstanceOf(BadRequest);
  });

  it('thins a long route evenly, keeping the first and last reading', () => {
    const pts = Array.from({ length: 1001 }, (_, i) => i);
    const t = thinRoute(pts, 400);
    expect(t).toHaveLength(400);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBe(1000);
    expect(thinRoute([1, 2, 3], 400)).toEqual([1, 2, 3]);
  });
});
