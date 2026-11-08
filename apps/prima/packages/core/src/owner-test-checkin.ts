// P90 (Fitri, 9 Nov 2026): "for owner make it can check in and checkout as well to test the function, so they can check in
// and then check out and then see the movements from check-in until check-out."
//
// The owner (isOwnerAdmin: the CEO's own sign-in) has no staff record and no clock (hasOwnStaffRecord), so the real
// check-in is closed to them. This is a separate TEST check-in: the owner checks in, moves about, checks out, and sees the
// route between the two on a map. It lives in its own table (ownerTestCheckins, prima.owner_test_checkins), so no clock,
// check-in event, attendance day, KPI, report or pay run ever reads it: those all read their own tables. Only the owner
// may start one, and each person only ever reads or changes their own sessions (the service here, and row-level
// security in db/modules/owner-test-checkin-v1.sql). Nothing anyone else holds is touched.
import { isOwnerAdmin } from './access';
import { haversineM, validLatLng } from './checkin';
import { BadRequest } from './service';
import type { Store } from './store';
import { toMs } from './time';
import type { Id, IsoDateTime, User } from './types';

/** The most readings kept in one test session (a reading every 15 s is over 8 hours). */
export const OWNER_TEST_MAX_POINTS = 2000;
/** Readings closer together than this are not kept. */
export const OWNER_TEST_MIN_GAP_S = 10;
/** A reading rougher than this is not added to the route (it would draw a false zig-zag). */
export const OWNER_TEST_MAX_ACCURACY_M = 150;
/** A session left open longer than this is closed at its last reading when the next one starts. */
export const OWNER_TEST_STALE_H = 18;
/** Sessions listed on the screen. */
export const OWNER_TEST_LIST = 20;
/** Readings per session sent with the list (the route is thinned evenly beyond this; the record keeps all). */
export const OWNER_TEST_LIST_POINTS = 400;
/** How often the screen sends a reading while a test session is open. */
export const OWNER_TEST_PING_S = 15;

export interface OwnerTestPoint {
  /** Server time. */
  at: IsoDateTime;
  /** The phone's time, kept beside the server's. */
  capturedAt: IsoDateTime | null;
  lat: number;
  lng: number;
  accuracyM: number | null;
}

/** One owner test session, check-in to check-out. Never a clock, attendance or pay record. */
export interface OwnerTestCheckin {
  id: Id;
  userId: Id;
  userName: string;
  /** Always 'test'. Kept on the row so a copy of it anywhere still says what it is. */
  purpose: 'test';
  in: OwnerTestPoint;
  out: OwnerTestPoint | null;
  /** Every reading from check-in to check-out, in order (check-in first, check-out last). */
  trail: OwnerTestPoint[];
  /** Metres along the route. */
  distanceM: number;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  /** Closed by Prima because it was left open (at its last reading), not by a check-out. */
  autoEnded: boolean;
  note: string;
}

export interface OwnerTestFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  capturedAt?: IsoDateTime | null;
}

const NOT_OWNER = 'Test check-in is only for the owner. Staff check in on My clock.';

/** Who may use the test check-in: the owner only. Everyone else's screens and records are unchanged. */
export function mayTestCheckin(user: User): boolean {
  return isOwnerAdmin(user);
}

function pointOf(fix: OwnerTestFix, at: IsoDateTime): OwnerTestPoint {
  if (!fix || !validLatLng(fix.lat, fix.lng)) throw new BadRequest('No location: allow location for Prima and try again.');
  const acc = typeof fix.accuracyM === 'number' && Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0 ? Math.round(fix.accuracyM) : null;
  const cap = typeof fix.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?$/.test(fix.capturedAt) ? fix.capturedAt.slice(0, 40) : null;
  return { at, capturedAt: cap, lat: Math.round(fix.lat * 1e6) / 1e6, lng: Math.round(fix.lng * 1e6) / 1e6, accuracyM: acc };
}

/** Metres along a route. */
export function routeLengthM(points: Pick<OwnerTestPoint, 'lat' | 'lng'>[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += haversineM(points[i - 1], points[i]);
  return Math.round(m);
}

/** At most n points, evenly spaced, always keeping the first and the last. */
export function thinRoute<T>(points: T[], n: number): T[] {
  if (points.length <= n || n < 2) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Minutes from check-in to check-out (or to now while open). */
export function testMinutes(s: Pick<OwnerTestCheckin, 'startedAt' | 'endedAt'>, now: IsoDateTime): number {
  return Math.max(0, Math.round((toMs(s.endedAt ?? now) - toMs(s.startedAt)) / 60_000));
}

export class OwnerTestCheckinService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
  ) {}

  private assertOwner(user: User): void {
    if (!mayTestCheckin(user)) throw new BadRequest(NOT_OWNER);
  }

  private async sessions(user: User): Promise<OwnerTestCheckin[]> {
    // Filtered on the owner's own id here, and the database's row-level security shows nobody else's anyway.
    return (await this.store.list('ownerTestCheckins', { userId: user.id })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** The owner's test sessions (newest first) and the open one. Anyone else is told it is not for them; nothing is read. */
  async mine(user: User) {
    if (!mayTestCheckin(user))
      return { allowed: false as const, open: null, sessions: [] as OwnerTestCheckin[], pingEveryS: OWNER_TEST_PING_S, maxPoints: OWNER_TEST_MAX_POINTS, now: this.now() };
    const all = await this.sessions(user);
    const open = all.find((s) => !s.endedAt) ?? null;
    return {
      allowed: true as const,
      open: open ? { ...open, trail: thinRoute(open.trail, OWNER_TEST_LIST_POINTS) } : null,
      sessions: all.slice(0, OWNER_TEST_LIST).map((s) => ({ ...s, trail: thinRoute(s.trail, OWNER_TEST_LIST_POINTS) })),
      pingEveryS: OWNER_TEST_PING_S,
      maxPoints: OWNER_TEST_MAX_POINTS,
      now: this.now(),
    };
  }

  /** Test check-in. One open session at a time; one left open from long ago is closed at its last reading first. */
  async start(user: User, fix: OwnerTestFix): Promise<OwnerTestCheckin> {
    this.assertOwner(user);
    const at = this.now();
    const point = pointOf(fix, at);
    const open = (await this.sessions(user)).find((s) => !s.endedAt) ?? null;
    if (open) {
      const last = open.trail.at(-1) ?? open.in;
      if (toMs(at) - toMs(last.at) < OWNER_TEST_STALE_H * 3_600_000) throw new BadRequest('A test check-in is already open. Check out of it first.');
    }
    const row: OwnerTestCheckin = {
      id: `otc-${user.id}-${toMs(at)}`,
      userId: user.id,
      userName: user.name,
      purpose: 'test',
      in: point,
      out: null,
      trail: [point],
      distanceM: 0,
      startedAt: at,
      endedAt: null,
      autoEnded: false,
      note: 'Test only: not attendance, not a clock record, never in pay or reports.',
    };
    return this.store.transaction(async (tx) => {
      if (open) {
        const last = open.trail.at(-1) ?? open.in;
        await tx.update('ownerTestCheckins', open.id, { endedAt: last.at, out: last, autoEnded: true });
      }
      await tx.insert('ownerTestCheckins', row);
      await tx.audit({
        at,
        actor: user.name,
        companyId: null,
        action: 'owner_test.check_in',
        entity: 'owner_test_checkin',
        entityId: row.id,
        summary: `${user.name} started a TEST check-in (owner test only; not attendance, not pay)`,
      });
      return row;
    });
  }

  /** A reading on the way. Too soon after the last, too rough or past the limit: not kept, and said why. */
  async ping(user: User, fix: OwnerTestFix): Promise<{ accepted: boolean; reason: string | null; points: number; distanceM: number }> {
    this.assertOwner(user);
    const at = this.now();
    const point = pointOf(fix, at);
    const open = (await this.sessions(user)).find((s) => !s.endedAt);
    if (!open) throw new BadRequest('No test check-in is open. Check in first.');
    const last = open.trail.at(-1) ?? open.in;
    const skip = (reason: string) => ({ accepted: false, reason, points: open.trail.length, distanceM: open.distanceM });
    if (open.trail.length >= OWNER_TEST_MAX_POINTS) return skip('This test has the most readings one test keeps. Check out and start another.');
    if (toMs(at) - toMs(last.at) < OWNER_TEST_MIN_GAP_S * 1000) return skip('A reading was kept a moment ago.');
    if (point.accuracyM !== null && point.accuracyM > OWNER_TEST_MAX_ACCURACY_M) return skip(`The reading is only accurate to ${point.accuracyM} m, so it is not drawn on the route.`);
    const distanceM = open.distanceM + Math.round(haversineM(last, point));
    await this.store.transaction(async (tx) => {
      await tx.update('ownerTestCheckins', open.id, { trail: [...open.trail, point], distanceM });
    });
    return { accepted: true, reason: null, points: open.trail.length + 1, distanceM };
  }

  /** Test check-out: the last reading closes the route. */
  async end(user: User, fix: OwnerTestFix): Promise<OwnerTestCheckin> {
    this.assertOwner(user);
    const at = this.now();
    const point = pointOf(fix, at);
    const open = (await this.sessions(user)).find((s) => !s.endedAt);
    if (!open) throw new BadRequest('No test check-in is open.');
    const trail = open.trail.length >= OWNER_TEST_MAX_POINTS ? [...open.trail.slice(0, -1), point] : [...open.trail, point];
    const distanceM = routeLengthM(trail);
    return this.store.transaction(async (tx) => {
      const updated = await tx.update('ownerTestCheckins', open.id, { out: point, endedAt: at, trail, distanceM });
      await tx.audit({
        at,
        actor: user.name,
        companyId: null,
        action: 'owner_test.check_out',
        entity: 'owner_test_checkin',
        entityId: open.id,
        summary: `${user.name} ended a TEST check-in after ${testMinutes({ startedAt: open.startedAt, endedAt: at }, at)} min, ${trail.length} readings (owner test only; not attendance, not pay)`,
      });
      return updated;
    });
  }
}
