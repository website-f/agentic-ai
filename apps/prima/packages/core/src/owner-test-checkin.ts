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
import { checkinCompanyOf, checkinTargets, haversineM, validLatLng, type CheckinTarget } from './checkin';
import { MOVEMENT_DEFAULTS, analyseMovement, type MovementSummary, type RawReading } from './movement';
import { SNAP_REASON_MIN, snapImageProblem } from './clock-snap';
import { validFaceDescriptor } from './face';
import { RULES } from './rules';
import { BadRequest } from './service';
import type { Store } from './store';
import { toMs } from './time';
import type { Id, IsoDateTime, User } from './types';

/** The most readings kept in one test session (a reading every 15 s is over 8 hours). */
export const OWNER_TEST_MAX_POINTS = 2000;
/** Readings closer together than this are not kept. */
export const OWNER_TEST_MIN_GAP_S = 10;
/** A reading rougher than this is not added to the route (it would draw a false zig-zag). P93: the staff clock's rule. */
export const OWNER_TEST_MAX_ACCURACY_M = MOVEMENT_DEFAULTS.maxAccuracyM;
/** P93: a check-out sent again within this many minutes (the answer was lost) returns the check-out already made. */
export const OWNER_TEST_RETRY_MIN = 10;
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
  /** P93: how it ended: a check-out, signing out of Prima (at its last reading), or Prima closing one left open. */
  endedBy?: 'check_out' | 'sign_out' | 'prima';
  note: string;
  /** P97: the face photo at the test check-in and check-out (the same camera as the staff check-in), on the owner's own row. */
  snaps?: { in?: OwnerTestSnap; out?: OwnerTestSnap };
}

/** P97: the test's face photo: the same face check as a staff check-in, never matched (the owner registers no face). */
export interface OwnerTestSnap {
  at: IsoDateTime;
  /** The compressed photo; '' with no camera. */
  image: string;
  /** The phone's face engine found a face, and saw it move. */
  faceFound: boolean;
  live: boolean;
  /** With no camera: what was written. */
  reason: string | null;
}

/** What the screen sends with a test check-in or check-out. */
export interface OwnerTestSnapInput {
  face?: { image: string; descriptor: number[]; live: boolean } | null;
  noCamera?: { reason: string } | null;
}

/** P97: the test sessions sent with their photos (the newest); older ones say a photo is kept without sending it. */
export const OWNER_TEST_LIST_PHOTOS = 5;

export interface OwnerTestFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  capturedAt?: IsoDateTime | null;
}

/** P93: a test session as the screen gets it: the distance worked out again, and its movement. */
export type OwnerTestView = OwnerTestCheckin & { savedDistanceM: number; movement: MovementSummary };

const NOT_OWNER = 'Test check-in is only for the owner. Staff check in on My clock.';

/** Who may use the test check-in: the owner only. Everyone else's screens and records are unchanged. */
export function mayTestCheckin(user: User): boolean {
  return isOwnerAdmin(user);
}

/** P97: the test's photo, checked as a staff check-in photo is; null when nothing was sent. */
function snapOf(input: OwnerTestSnapInput | null | undefined, at: IsoDateTime): OwnerTestSnap | null {
  if (!input || (!input.face && !input.noCamera)) return null;
  if (input.face) {
    const p = snapImageProblem(input.face.image);
    if (p) throw new BadRequest(p);
    return { at, image: input.face.image, faceFound: validFaceDescriptor(input.face.descriptor), live: input.face.live === true, reason: null };
  }
  const reason = typeof input.noCamera?.reason === 'string' ? input.noCamera.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500) : '';
  if (reason.length < SNAP_REASON_MIN) throw new BadRequest(`Write why the camera cannot be used (at least ${SNAP_REASON_MIN} characters).`);
  return { at, image: '', faceFound: false, live: false, reason };
}

function pointOf(fix: OwnerTestFix, at: IsoDateTime): OwnerTestPoint {
  if (!fix || !validLatLng(fix.lat, fix.lng)) throw new BadRequest('No location: allow location for Prima and try again.');
  const acc = typeof fix.accuracyM === 'number' && Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0 ? Math.round(fix.accuracyM) : null;
  const cap = typeof fix.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?$/.test(fix.capturedAt) ? fix.capturedAt.slice(0, 40) : null;
  return { at, capturedAt: cap, lat: Math.round(fix.lat * 1e6) / 1e6, lng: Math.round(fix.lng * 1e6) / 1e6, accuracyM: acc };
}

/**
 * Metres along a route, every step added. P93: kept for reference only; the distance shown is the staff clock's
 * (movement.ts), which leaves out rough readings, jumps and GPS jitter.
 */
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

/** P93: a test session's readings, as the staff clock reads its own (check-in first, check-out last). */
export function testReadings(s: Pick<OwnerTestCheckin, 'id' | 'trail' | 'out'>): RawReading[] {
  return s.trail.map((p, i) => ({
    id: `${s.id}:${i}`,
    source: i === 0 ? 'in' : s.out && i === s.trail.length - 1 && p.at === s.out.at ? 'out' : 'ping',
    capturedAt: p.capturedAt,
    receivedAt: p.at,
    lat: p.lat,
    lng: p.lng,
    accuracyM: p.accuracyM,
  }));
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

  /** P93: the places the owner's tests are measured against: their company's check-in places, else their base. */
  private async targets(user: User): Promise<CheckinTarget[]> {
    const companyId = checkinCompanyOf(user, null);
    const places = await this.store.list('checkinPlaces', { companyId });
    return checkinTargets(null, places, user.base).targets;
  }

  /** P93: the same movement reading as a staff clock: distance without jitter, time inside and outside, review items. */
  private movement(s: OwnerTestCheckin, targets: CheckinTarget[]): MovementSummary {
    const r = RULES.staffMovement.value;
    return analyseMovement({
      raw: testReadings(s),
      from: s.startedAt,
      to: s.endedAt,
      now: this.now(),
      targets,
      rules: { outOfStationMin: r.outOfStationMin, maxAccuracyM: r.maxAccuracyM, maxSpeedKmh: r.maxSpeedKmh, farClockInM: r.farClockInM, gapMin: RULES.staffTrackGapMin.value },
    });
  }

  /** P93: signing out of Prima ends an open test at its last reading, as signing out ends a staff clock. */
  async endAtSignOut(user: User): Promise<OwnerTestCheckin | null> {
    if (!mayTestCheckin(user)) return null;
    await this.store.lock?.('ownerTestCheckins', `user:${user.id}`);
    const open = (await this.sessions(user)).find((s) => !s.endedAt);
    if (!open) return null;
    const last = open.trail.at(-1) ?? open.in;
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const updated = await tx.update('ownerTestCheckins', open.id, { endedAt: last.at, out: last, endedBy: 'sign_out', distanceM: this.movement({ ...open, endedAt: last.at, out: last }, []).distanceM });
      await tx.audit({
        at,
        actor: user.name,
        companyId: null,
        action: 'owner_test.sign_out',
        entity: 'owner_test_checkin',
        entityId: open.id,
        summary: `${user.name} signed out of Prima with a TEST check-in open; it ended at its last reading (owner test only; not attendance, not pay)`,
      });
      return updated;
    });
  }

  /** The owner's test sessions (newest first) and the open one. Anyone else is told it is not for them; nothing is read. */
  async mine(user: User) {
    if (!mayTestCheckin(user))
      return { allowed: false as const, open: null as OwnerTestView | null, sessions: [] as OwnerTestView[], pingEveryS: OWNER_TEST_PING_S, maxPoints: OWNER_TEST_MAX_POINTS, now: this.now() };
    const all = await this.sessions(user);
    const open = all.find((s) => !s.endedAt) ?? null;
    const targets = await this.targets(user);
    // P93: the distance shown is worked out again from the readings each time (so a test saved before this fix shows the
    // right figure too), with the time inside and outside the owner's office and the review items a manager would see.
    const view = (s: OwnerTestCheckin, photos = true): OwnerTestView => {
      const movement = this.movement(s, targets);
      // P97: older tests' photos stay on their row; the list does not carry them (the screen says a photo is kept).
      const snaps = s.snaps && !photos ? Object.fromEntries(Object.entries(s.snaps).map(([k, v]) => [k, { ...v, image: v.image ? 'kept' : '' }])) : s.snaps;
      return { ...s, snaps, distanceM: movement.distanceM, savedDistanceM: s.distanceM, trail: thinRoute(s.trail, OWNER_TEST_LIST_POINTS), movement };
    };
    return {
      allowed: true as const,
      open: open ? view(open) : null,
      sessions: all.slice(0, OWNER_TEST_LIST).map((s, i) => view(s, i < OWNER_TEST_LIST_PHOTOS)),
      pingEveryS: OWNER_TEST_PING_S,
      maxPoints: OWNER_TEST_MAX_POINTS,
      now: this.now(),
    };
  }

  /**
   * Test check-in. One open session at a time; one left open from long ago is closed at its last reading first.
   * P93: pressing it again while a test is open (a second tap, another tab, a retry) returns the open test instead of
   * an error asking to check out first.
   */
  async start(user: User, fix: OwnerTestFix, photo?: OwnerTestSnapInput | null): Promise<OwnerTestCheckin> {
    this.assertOwner(user);
    await this.store.lock?.('ownerTestCheckins', `user:${user.id}`);
    const at = this.now();
    const point = pointOf(fix, at);
    const snap = snapOf(photo, at);
    const open = (await this.sessions(user)).find((s) => !s.endedAt) ?? null;
    if (open) {
      const last = open.trail.at(-1) ?? open.in;
      if (toMs(at) - toMs(last.at) < OWNER_TEST_STALE_H * 3_600_000) return open;
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
      ...(snap ? { snaps: { in: snap } } : {}),
    };
    return this.store.transaction(async (tx) => {
      if (open) {
        const last = open.trail.at(-1) ?? open.in;
        await tx.update('ownerTestCheckins', open.id, { endedAt: last.at, out: last, autoEnded: true, endedBy: 'prima' });
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
    const next = { ...open, trail: [...open.trail, point] };
    // P93: the staff clock's distance (jitter, rough readings and jumps left out), not every step added up.
    const distanceM = this.movement(next, []).distanceM;
    await this.store.transaction(async (tx) => {
      await tx.update('ownerTestCheckins', open.id, { trail: next.trail, distanceM });
    });
    return { accepted: true, reason: null, points: next.trail.length, distanceM };
  }

  /**
   * Test check-out: the last reading closes the route. P93: a check-out sent again just after one (the answer was lost)
   * returns that check-out; the distance leaves out a rough last reading instead of drawing a jump to it.
   */
  async end(user: User, fix: OwnerTestFix, photo?: OwnerTestSnapInput | null): Promise<OwnerTestCheckin> {
    this.assertOwner(user);
    await this.store.lock?.('ownerTestCheckins', `user:${user.id}`);
    const at = this.now();
    const point = pointOf(fix, at);
    const snap = snapOf(photo, at);
    const all = await this.sessions(user);
    const open = all.find((s) => !s.endedAt);
    if (!open) {
      const recent = all.find((s) => s.endedAt && s.endedBy !== 'prima' && toMs(at) - toMs(s.endedAt) <= OWNER_TEST_RETRY_MIN * 60_000);
      if (recent) return recent;
      throw new BadRequest('No test check-in is running. Press Check in (test) to start one.');
    }
    const trail = open.trail.length >= OWNER_TEST_MAX_POINTS ? [...open.trail.slice(0, -1), point] : [...open.trail, point];
    const distanceM = this.movement({ ...open, trail, out: point, endedAt: at }, []).distanceM;
    return this.store.transaction(async (tx) => {
      const updated = await tx.update('ownerTestCheckins', open.id, { out: point, endedAt: at, trail, distanceM, endedBy: 'check_out', ...(snap ? { snaps: { ...open.snaps, out: snap } } : {}) });
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
