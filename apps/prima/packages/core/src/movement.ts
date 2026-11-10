// P93 (Fitri, 9 Nov 2026): "the distance history seems wrong when I logged out ... my movements and all must be recorded
// nicely, to know if the staff are out of station, for example if they go out of the range of the site, to prevent
// violations and fraud."
//
// The pure rules for a clock session's movement, read the same way by the staff clock, the Staff clock board and the
// owner's TEST check-in:
//   1. clean the readings: no location, too rough, before clock-in, after clock-out, sent twice, impossible jumps;
//   2. order them by the phone's time, unless the phone's time is ahead of the server's (then the server's);
//   3. measure the route without counting GPS jitter as walking;
//   4. split the session into time inside the person's place, outside it, and unknown (no reading);
//   5. raise review items: out of station longer than N minutes, a location jump, signs of a fake location, a clock-in
//      far from the place, a phone clock set ahead, location stopping mid-session.
// Nothing here reads the database or the time of day: the caller passes the readings, the places and the rules.
import { haversineM, validLatLng, type CheckinTarget, type LatLng } from './checkin';
import { fromMs, toMs } from './time';
import type { IsoDateTime } from './types';

export interface MovementRules {
  /** Outside the place longer than this is an out-of-station period for the manager. */
  outOfStationMin: number;
  /** Readings rougher than this are kept on the record but not used for distance or place. */
  maxAccuracyM: number;
  /** Faster than this between two readings is a jump, not travel. */
  maxSpeedKmh: number;
  /** A clock-in further than this outside the place is a review item. */
  farClockInM: number;
  /** A step shorter than this (or than the readings' accuracy) is jitter, not movement. */
  minStepM: number;
  /** The phone's time may run ahead of the server's by this much; more and the server's time is used. */
  phoneAheadMin: number;
  /** No reading for longer than this is Unknown, never assumed inside. */
  gapMin: number;
}

export const MOVEMENT_DEFAULTS: MovementRules = {
  outOfStationMin: 15,
  maxAccuracyM: 100,
  maxSpeedKmh: 200,
  farClockInM: 1_000,
  minStepM: 20,
  phoneAheadMin: 5,
  gapMin: 30,
};

/** The most route points sent to a screen (the record keeps every reading). */
export const MOVEMENT_ROUTE_POINTS = 400;

/** One reading as stored: the clock-in or check-in point, a location ping, or the clock-out point. */
export interface RawReading {
  id?: string;
  source: 'in' | 'ping' | 'out';
  capturedAt?: IsoDateTime | null;
  receivedAt: IsoDateTime;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
}

export interface TrackPoint extends LatLng {
  id: string;
  source: RawReading['source'];
  /** The time used: the phone's, or the server's when the phone's was ahead. */
  t: IsoDateTime;
  accuracyM: number | null;
}

export type DropReason = 'no_location' | 'rough' | 'before_start' | 'after_end' | 'duplicate' | 'jump';

export interface Jump {
  from: IsoDateTime;
  to: IsoDateTime;
  distanceM: number;
  minutes: number;
  kmh: number;
  /** The phone stayed at the new place (a real jump: mock location, or a second phone), not a one-off bad reading. */
  confirmed: boolean;
}

export interface CleanTrack {
  points: TrackPoint[];
  dropped: Record<DropReason, number>;
  jumps: Jump[];
  /** Readings whose phone time was ahead of the server's by more than the rule allows. */
  phoneAhead: number;
}

const ZERO_DROPS = (): Record<DropReason, number> => ({ no_location: 0, rough: 0, before_start: 0, after_end: 0, duplicate: 0, jump: 0 });
const ORDER: Record<RawReading['source'], number> = { in: 0, ping: 1, out: 2 };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function validTime(t: unknown): t is IsoDateTime {
  return typeof t === 'string' && ISO.test(t) && !Number.isNaN(Date.parse(t));
}

/** Metres two readings may differ by and still be the same place: the larger of their accuracies (unknown counts as 0). */
function slack(a: TrackPoint, b: TrackPoint): number {
  return (a.accuracyM ?? 0) + (b.accuracyM ?? 0);
}

function tooFast(a: TrackPoint, b: TrackPoint, maxMps: number): boolean {
  const d = Math.max(0, haversineM(a, b) - slack(a, b));
  const s = Math.max(1, (toMs(b.t) - toMs(a.t)) / 1000);
  // A jump must be a real distance too: a few hundred metres in a second is a GPS correction, not fraud.
  return d > 200 && d / s > maxMps;
}

function jumpOf(a: TrackPoint, b: TrackPoint, confirmed: boolean): Jump {
  const d = haversineM(a, b);
  const min = Math.max(0, (toMs(b.t) - toMs(a.t)) / 60_000);
  return { from: a.t, to: b.t, distanceM: Math.round(d), minutes: Math.round(min * 10) / 10, kmh: Math.round(d / 1000 / Math.max(min / 60, 1 / 3600)), confirmed };
}

/**
 * The readings of one session, cleaned and in time order. `from` is the clock-in, `to` the clock-out (null while open,
 * then `now` is the end). Nothing after the clock-out counts: a reading queued on the phone and sent late is placed at
 * the phone's time, and dropped if that time is after the clock-out.
 */
export function cleanTrack(raw: RawReading[], opts: { from: IsoDateTime; to: IsoDateTime | null; now: IsoDateTime; rules?: Partial<MovementRules> }): CleanTrack {
  const r = { ...MOVEMENT_DEFAULTS, ...opts.rules };
  const dropped = ZERO_DROPS();
  let phoneAhead = 0;
  const startMs = toMs(opts.from);
  const endMs = toMs(opts.to ?? opts.now);
  const aheadMs = r.phoneAheadMin * 60_000;
  const seen = new Set<string>();
  const pts: (TrackPoint & { rec: number })[] = [];
  raw.forEach((x, i) => {
    if (!validLatLng(x.lat, x.lng) || !validTime(x.receivedAt)) return void dropped.no_location++;
    const rec = toMs(x.receivedAt);
    let t = x.receivedAt;
    if (validTime(x.capturedAt)) {
      // The phone's time orders the readings (a reading queued offline keeps the time it was taken), unless the phone
      // says it was taken after the server got it: then the phone's clock is ahead and the server's time is used.
      if (toMs(x.capturedAt) <= rec + aheadMs) t = fromMs(Math.min(toMs(x.capturedAt), rec));
      else phoneAhead++;
    }
    const ms = toMs(t);
    if (ms < startMs - aheadMs) return void dropped.before_start++;
    if (ms > endMs + 60_000) return void dropped.after_end++;
    const acc = typeof x.accuracyM === 'number' && Number.isFinite(x.accuracyM) && x.accuracyM >= 0 ? Math.round(x.accuracyM) : null;
    if (acc === null || acc > r.maxAccuracyM) return void dropped.rough++;
    const key = x.id ?? `${x.source}|${Math.round(ms / 1000)}|${x.lat!.toFixed(6)}|${x.lng!.toFixed(6)}`;
    const same = `${Math.round(ms / 1000)}|${x.lat!.toFixed(6)}|${x.lng!.toFixed(6)}`;
    if (seen.has(key) || seen.has(same)) return void dropped.duplicate++;
    seen.add(key);
    seen.add(same);
    pts.push({ id: x.id ?? `r${i}`, source: x.source, t: fromMs(Math.max(ms, startMs)), lat: x.lat!, lng: x.lng!, accuracyM: acc, rec });
  });
  pts.sort((a, b) => toMs(a.t) - toMs(b.t) || ORDER[a.source] - ORDER[b.source] || a.rec - b.rec);
  // Impossible jumps. One far reading between two near ones is a bad reading and is left out. When the next reading
  // agrees with the far one, the phone really is somewhere else now: the route continues from there and the jump is
  // kept for the manager (a mock-location app, or the phone handed to someone else).
  const maxMps = (r.maxSpeedKmh * 1000) / 3600;
  const kept: TrackPoint[] = [];
  const jumps: Jump[] = [];
  let pending: TrackPoint | null = null;
  for (const p0 of pts) {
    const { rec: _rec, ...p } = p0;
    void _rec;
    const last = kept.at(-1);
    if (!last) {
      kept.push(p);
      continue;
    }
    if (!pending) {
      if (tooFast(last, p, maxMps)) pending = p;
      else kept.push(p);
      continue;
    }
    if (!tooFast(last, p, maxMps)) {
      jumps.push(jumpOf(last, pending, false));
      dropped.jump++;
      pending = null;
      kept.push(p);
    } else if (!tooFast(pending, p, maxMps)) {
      jumps.push(jumpOf(last, pending, true));
      kept.push(pending, p);
      pending = null;
    } else {
      jumps.push(jumpOf(last, pending, false));
      dropped.jump++;
      pending = p;
    }
  }
  if (pending) {
    // A last reading far from everything before it, with nothing after to confirm it: left out of the route.
    const last = kept.at(-1)!;
    jumps.push(jumpOf(last, pending, false));
    dropped.jump++;
  }
  return { points: kept, dropped, jumps, phoneAhead };
}

/**
 * Metres along the route. Readings that stay within reach of each other (the two readings' accuracies together, and at
 * least minStepM) are one stop, measured from their average point; only a reading beyond that is a move. A phone lying
 * on a desk reports points metres apart every time, scattered around where it lies, and adding those up made an hour at
 * the desk look like a long walk.
 */
export function routeDistanceM(points: TrackPoint[], minStepM = MOVEMENT_DEFAULTS.minStepM): number {
  if (points.length < 2) return 0;
  let total = 0;
  // The current stop: the average of its readings and their average accuracy.
  let stop = { lat: points[0].lat, lng: points[0].lng, acc: points[0].accuracyM ?? 0, n: 1 };
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const d = haversineM(stop, p);
    if (d < Math.max(minStepM, stop.acc + (p.accuracyM ?? 0))) {
      const n = stop.n + 1;
      stop = { lat: stop.lat + (p.lat - stop.lat) / n, lng: stop.lng + (p.lng - stop.lng) / n, acc: stop.acc + ((p.accuracyM ?? 0) - stop.acc) / n, n };
      continue;
    }
    total += d;
    stop = { lat: p.lat, lng: p.lng, acc: p.accuracyM ?? 0, n: 1 };
  }
  return Math.round(total);
}

export type StationState = 'inside' | 'outside' | 'unknown';

export interface StationPeriod {
  state: StationState;
  from: IsoDateTime;
  to: IsoDateTime;
  minutes: number;
  /** Outside: the furthest it went beyond the edge of the nearest place, and that place. */
  outsideByM: number | null;
  place: string | null;
}

/** Inside the nearest circle, giving the reading the benefit of its accuracy (up to 50 m) at the edge. */
export function placeOf(p: TrackPoint, targets: Pick<CheckinTarget, 'label' | 'lat' | 'lng' | 'radiusM'>[]): { inside: boolean; outsideByM: number; place: string | null } {
  let best: { by: number; label: string } | null = null;
  for (const t of targets) {
    const by = haversineM(p, t) - Math.min(p.accuracyM ?? 0, 50) - t.radiusM;
    if (!best || by < best.by) best = { by, label: t.label };
  }
  if (!best) return { inside: false, outsideByM: 0, place: null };
  return { inside: best.by <= 0, outsideByM: Math.max(0, Math.round(best.by)), place: best.label };
}

/**
 * The session split into inside, outside and unknown. Each reading stands for the time until the next one, at most
 * gapMin: after that, without a reading, the time is Unknown (never assumed inside).
 */
export function stationTimeline(
  points: TrackPoint[],
  targets: Pick<CheckinTarget, 'label' | 'lat' | 'lng' | 'radiusM'>[],
  opts: { from: IsoDateTime; to: IsoDateTime; gapMin?: number },
): StationPeriod[] {
  const gapMs = (opts.gapMin ?? MOVEMENT_DEFAULTS.gapMin) * 60_000;
  const start = toMs(opts.from);
  const end = Math.max(start, toMs(opts.to));
  const raw: { state: StationState; a: number; b: number; by: number | null; place: string | null }[] = [];
  const push = (state: StationState, a: number, b: number, by: number | null = null, place: string | null = null) => {
    if (b > a) raw.push({ state, a, b, by, place });
  };
  const inWindow = points.filter((p) => toMs(p.t) <= end);
  if (!inWindow.length) push('unknown', start, end);
  else {
    push('unknown', start, Math.max(start, toMs(inWindow[0].t)));
    inWindow.forEach((p, i) => {
      const a = Math.max(start, toMs(p.t));
      const next = i + 1 < inWindow.length ? toMs(inWindow[i + 1].t) : end;
      const known = Math.min(next, a + gapMs);
      const w = placeOf(p, targets);
      push(w.inside ? 'inside' : 'outside', a, known, w.inside ? null : w.outsideByM, w.place);
      push('unknown', known, next);
    });
  }
  const out: StationPeriod[] = [];
  for (const s of raw) {
    const prev = out.at(-1);
    if (prev && prev.state === s.state && toMs(prev.to) === s.a) {
      prev.to = fromMs(s.b);
      if (s.by !== null && (prev.outsideByM === null || s.by > prev.outsideByM)) {
        prev.outsideByM = s.by;
        prev.place = s.place;
      }
      continue;
    }
    out.push({ state: s.state, from: fromMs(s.a), to: fromMs(s.b), minutes: 0, outsideByM: s.by, place: s.place });
  }
  for (const p of out) p.minutes = Math.round((toMs(p.to) - toMs(p.from)) / 60_000);
  return out.filter((p) => p.minutes > 0 || out.length === 1);
}

export type MovementFlagKind = 'out_of_station' | 'jump' | 'fake_location' | 'far_clock_in' | 'phone_time' | 'location_stopped';

/** One thing for the manager to look at, in plain numbers; the screen words it. */
export interface MovementFlag {
  kind: MovementFlagKind;
  at: IsoDateTime;
  to: IsoDateTime | null;
  minutes: number | null;
  distanceM: number | null;
  place: string | null;
  count: number | null;
}

/** Why time inside or outside is not measured for this session. */
export type MovementMeasure = 'measured' | 'no_place' | 'outstation' | 'home' | 'no_location';

/**
 * P97 (Fitri, 11 Nov 2026: "the location must be logged even if they close the thing"): what the phone said about its own
 * following, so a gap can be explained honestly instead of guessed. 'hidden': Prima went to the background or was closed;
 * 'visible': back on the screen; 'denied': location permission off; 'no_fix': the phone gave no position; 'offline' and
 * 'online': the signal; 'native': the Prima app's background following started; 'stopped': following stopped.
 */
export type TrackerNoteKind = 'hidden' | 'visible' | 'denied' | 'no_fix' | 'offline' | 'online' | 'native' | 'stopped';
export const TRACKER_NOTE_KINDS: TrackerNoteKind[] = ['hidden', 'visible', 'denied', 'no_fix', 'offline', 'online', 'native', 'stopped'];
export interface TrackerNote {
  at: IsoDateTime;
  kind: TrackerNoteKind;
}
/** The most notes one clock session keeps (the newest). */
export const TRACKER_NOTES_MAX = 80;

/** Why no position came for a while, from the phone's own notes; 'unknown' when it said nothing (asleep, off, closed). */
export type GapCause = 'closed' | 'denied' | 'offline' | 'no_fix' | 'unknown';

export interface MovementGap {
  from: IsoDateTime;
  /** null: still no position now. */
  to: IsoDateTime | null;
  minutes: number;
  cause: GapCause;
}

/** A piece of the route for the map: inside the place, outside it, not measured, or a gap (no position in between). */
export interface RouteSegment {
  kind: 'inside' | 'outside' | 'free' | 'gap';
  path: { lat: number; lng: number; t: IsoDateTime }[];
}

/** The most points the map segments carry together (each segment keeps its two ends). */
export const MOVEMENT_SEGMENT_POINTS = 600;

const CAUSE_RANK: Record<GapCause, number> = { denied: 4, closed: 3, offline: 2, no_fix: 1, unknown: 0 };
const NOTE_CAUSE: Partial<Record<TrackerNoteKind, GapCause>> = { denied: 'denied', hidden: 'closed', stopped: 'closed', offline: 'offline', no_fix: 'no_fix' };

/**
 * The cause of a gap: the strongest note the phone sent from the last reading before the gap (up to `leadMin` before it
 * starts) to its end. A note that following resumed ('visible', 'online', 'native') after a cause clears that cause.
 */
export function gapCause(notes: TrackerNote[], from: IsoDateTime, to: IsoDateTime, leadMin: number): GapCause {
  const a = toMs(from) - (leadMin + 1) * 60_000;
  const b = toMs(to);
  let best: GapCause = 'unknown';
  const inside = notes.filter((n) => validTime(n.at) && toMs(n.at) >= a && toMs(n.at) <= b).sort((x, y) => x.at.localeCompare(y.at));
  for (const n of inside) {
    const c = NOTE_CAUSE[n.kind];
    if (c && CAUSE_RANK[c] > CAUSE_RANK[best]) best = c;
  }
  // The latest note before the gap's own start decides when it is a "resumed" note and nothing stronger came later.
  const lastBefore = inside.filter((n) => toMs(n.at) <= toMs(from)).at(-1);
  if (lastBefore && !NOTE_CAUSE[lastBefore.kind] && !inside.some((n) => toMs(n.at) > toMs(from) && NOTE_CAUSE[n.kind])) return 'unknown';
  return best;
}

/**
 * Every time no position came for longer than `gapMin` while clocked in: from the clock-in (or a reading) to the next
 * reading (or the clock-out, or now: then `to` is null). The real silence, from the last position to the next one.
 */
export function silences(points: TrackPoint[], opts: { from: IsoDateTime; to: IsoDateTime | null; now: IsoDateTime; gapMin: number }): Omit<MovementGap, 'cause'>[] {
  const out: Omit<MovementGap, 'cause'>[] = [];
  const end = opts.to ?? opts.now;
  const times = [opts.from, ...points.map((p) => p.t).filter((t) => toMs(t) > toMs(opts.from) && toMs(t) <= toMs(end)), end];
  for (let i = 1; i < times.length; i++) {
    const minutes = Math.round((toMs(times[i]) - toMs(times[i - 1])) / 60_000);
    if (minutes <= opts.gapMin) continue;
    const last = i === times.length - 1;
    out.push({ from: times[i - 1], to: last && !opts.to ? null : times[i], minutes });
  }
  return out;
}

/**
 * The route cut into pieces for the map. Two readings further apart in time than `gapMin` are joined by a GAP piece
 * (drawn dashed: no position came in between, the straight line only joins the two readings and is never a path). A
 * step that ends or starts outside every place is OUTSIDE (drawn highlighted); otherwise INSIDE. Without a place to
 * measure against, steps are FREE. Also the metres the gaps' straight lines add to the distance.
 */
export function routeSegments(
  points: TrackPoint[],
  targets: Pick<CheckinTarget, 'label' | 'lat' | 'lng' | 'radiusM'>[],
  opts: { gapMin: number; measured: boolean; minStepM?: number },
): { segments: RouteSegment[]; gapDistanceM: number } {
  const segments: RouteSegment[] = [];
  let gapDistanceM = 0;
  const gapMs = opts.gapMin * 60_000;
  const inside = points.map((p) => (opts.measured ? placeOf(p, targets).inside : true));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const gap = toMs(b.t) - toMs(a.t) > gapMs;
    const kind: RouteSegment['kind'] = gap ? 'gap' : !opts.measured ? 'free' : inside[i - 1] && inside[i] ? 'inside' : 'outside';
    if (gap) {
      const d = haversineM(a, b);
      if (d >= Math.max(opts.minStepM ?? MOVEMENT_DEFAULTS.minStepM, (a.accuracyM ?? 0) + (b.accuracyM ?? 0))) gapDistanceM += d;
    }
    const last = segments.at(-1);
    const pa = { lat: a.lat, lng: a.lng, t: a.t };
    const pb = { lat: b.lat, lng: b.lng, t: b.t };
    if (last && last.kind === kind && kind !== 'gap') last.path.push(pb);
    else segments.push({ kind, path: [pa, pb] });
  }
  // Thin long pieces so the screen gets at most MOVEMENT_SEGMENT_POINTS points, each piece keeping its two ends.
  const total = segments.reduce((n, s) => n + s.path.length, 0);
  if (total > MOVEMENT_SEGMENT_POINTS)
    for (const s of segments) s.path = thin(s.path, Math.max(2, Math.floor((s.path.length / total) * MOVEMENT_SEGMENT_POINTS)));
  return { segments, gapDistanceM: Math.round(gapDistanceM) };
}

export interface MovementSummary {
  measure: MovementMeasure;
  distanceM: number;
  /** P97: of distanceM, the metres of straight lines across gaps (no position came in between: the real way is unknown). */
  gapDistanceM: number;
  /** P97: the route in pieces for the map: inside, outside (highlighted), not measured, and gaps (dashed). */
  segments: RouteSegment[];
  /** P97: each time no position came while clocked in, with what the phone said about why. */
  gaps: MovementGap[];
  /** The cleaned route, thinned for the screen. */
  route: { t: IsoDateTime; lat: number; lng: number; accuracyM: number | null; source: RawReading['source'] }[];
  readings: { total: number; used: number; dropped: Record<DropReason, number> };
  insideMin: number;
  outsideMin: number;
  unknownMin: number;
  periods: StationPeriod[];
  flags: MovementFlag[];
  targets: { label: string; lat: number; lng: number; radiusM: number }[];
  rules: Pick<MovementRules, 'outOfStationMin' | 'maxAccuracyM' | 'maxSpeedKmh' | 'farClockInM' | 'gapMin'>;
}

/** At most n points, evenly spaced, keeping the first and the last. */
function thin<T>(points: T[], n: number): T[] {
  if (points.length <= n || n < 2) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/**
 * Signs of a fake location: a reading claiming perfect accuracy (0 m), or the exact same point to the last decimal again
 * and again with a phone-GPS accuracy (5 m or better). Real phone GPS always moves a little. A laptop's Wi-Fi location
 * repeats the same point, but with an accuracy of tens of metres, so it is not counted.
 */
export function fakeLocationCount(points: TrackPoint[]): number {
  const zero = points.filter((p) => p.accuracyM === 0).length;
  const same = new Map<string, number>();
  for (const p of points) if (p.accuracyM !== null && p.accuracyM <= 5) same.set(`${p.lat}|${p.lng}|${p.accuracyM}`, (same.get(`${p.lat}|${p.lng}|${p.accuracyM}`) ?? 0) + 1);
  const repeats = Math.max(0, ...same.values());
  return zero + (repeats >= 6 ? repeats : 0);
}

/**
 * Everything about one session's movement. Time inside or outside is measured only against a place the person is
 * assigned to (their check-in place, the company offices, their field areas or the older personal base). With none,
 * the screen says so instead of guessing; on an outstation day anywhere is allowed; on a home day the location is
 * checked once and not followed.
 */
export function analyseMovement(input: {
  raw: RawReading[];
  from: IsoDateTime;
  to: IsoDateTime | null;
  now: IsoDateTime;
  targets: Pick<CheckinTarget, 'label' | 'lat' | 'lng' | 'radiusM'>[];
  outstation?: boolean;
  home?: boolean;
  rules?: Partial<MovementRules>;
  /** P97: what the phone said about its following (background, permission off, no signal), to explain gaps. */
  notes?: TrackerNote[];
}): MovementSummary {
  const r = { ...MOVEMENT_DEFAULTS, ...input.rules };
  const end = input.to ?? input.now;
  const clean = cleanTrack(input.raw, { from: input.from, to: input.to, now: input.now, rules: r });
  const pts = clean.points;
  const targets = input.targets.map((t) => ({ label: t.label, lat: t.lat, lng: t.lng, radiusM: t.radiusM }));
  const measure: MovementMeasure = input.home ? 'home' : !pts.length ? 'no_location' : !targets.length ? 'no_place' : input.outstation ? 'outstation' : 'measured';
  // With no place to measure against, the time is still split into "location known" and "unknown" so gaps show.
  const periods = measure === 'home' ? [] : stationTimeline(pts, measure === 'measured' ? targets : [], { from: input.from, to: end, gapMin: r.gapMin }).map((p) =>
    measure === 'measured' || p.state === 'unknown' ? p : { ...p, state: 'inside' as StationState, outsideByM: null, place: null },
  );
  const sum = (s: StationState) => periods.filter((p) => p.state === s).reduce((a, p) => a + p.minutes, 0);
  const flags: MovementFlag[] = [];
  const flag = (f: Partial<MovementFlag> & Pick<MovementFlag, 'kind' | 'at'>) =>
    flags.push({ to: null, minutes: null, distanceM: null, place: null, count: null, ...f });
  if (measure === 'measured') {
    for (const p of periods)
      if (p.state === 'outside' && p.minutes >= r.outOfStationMin) flag({ kind: 'out_of_station', at: p.from, to: p.to, minutes: p.minutes, distanceM: p.outsideByM, place: p.place });
    const first = pts.find((p) => p.source === 'in');
    if (first) {
      const w = placeOf(first, targets);
      if (!w.inside && w.outsideByM > r.farClockInM) flag({ kind: 'far_clock_in', at: first.t, distanceM: w.outsideByM, place: w.place });
    }
  }
  if (measure !== 'home') {
    for (const j of clean.jumps.filter((x) => x.confirmed)) flag({ kind: 'jump', at: j.from, to: j.to, minutes: j.minutes, distanceM: j.distanceM });
    const fake = fakeLocationCount(pts);
    if (fake) flag({ kind: 'fake_location', at: pts[0].t, count: fake });
    if (clean.phoneAhead) flag({ kind: 'phone_time', at: input.from, count: clean.phoneAhead });
    // Location that was followed and then stopped while still clocked in (phone off, app closed, location turned off):
    // no reading for longer than the gap rule, from the last reading to the next one (or to the clock-out, or now).
    if (pts.some((p) => p.source === 'ping'))
      pts.forEach((p, i) => {
        const next = i + 1 < pts.length ? pts[i + 1].t : end;
        const minutes = Math.round((toMs(next) - toMs(p.t)) / 60_000);
        if (minutes > r.gapMin) flag({ kind: 'location_stopped', at: p.t, to: i + 1 < pts.length || input.to ? next : null, minutes });
      });
  }
  flags.sort((a, b) => a.at.localeCompare(b.at));
  // P97: the map's pieces and every gap with its likely cause. A gap is never filled with invented positions.
  const notes = (input.notes ?? []).filter((n) => n && validTime(n.at) && TRACKER_NOTE_KINDS.includes(n.kind));
  const pieces = measure === 'home' ? { segments: [], gapDistanceM: 0 } : routeSegments(pts, targets, { gapMin: r.gapMin, measured: measure === 'measured', minStepM: r.minStepM });
  const gaps = measure === 'home' ? [] : silences(pts, { from: input.from, to: input.to, now: input.now, gapMin: r.gapMin }).map((g) => ({ ...g, cause: gapCause(notes, g.from, g.to ?? input.now, 0) }));
  return {
    measure,
    gapDistanceM: pieces.gapDistanceM,
    segments: pieces.segments,
    gaps,
    distanceM: measure === 'home' ? 0 : routeDistanceM(pts, r.minStepM),
    route: measure === 'home' ? [] : thin(pts, MOVEMENT_ROUTE_POINTS).map((p) => ({ t: p.t, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, source: p.source })),
    readings: { total: input.raw.length, used: pts.length, dropped: clean.dropped },
    insideMin: sum('inside'),
    outsideMin: sum('outside'),
    unknownMin: sum('unknown'),
    periods,
    flags,
    targets,
    rules: { outOfStationMin: r.outOfStationMin, maxAccuracyM: r.maxAccuracyM, maxSpeedKmh: r.maxSpeedKmh, farClockInM: r.farClockInM, gapMin: r.gapMin },
  };
}

/**
 * When the phone sends its next location reading while clocked in: about every `stillMin` minutes when the person is
 * still, every `movingMin` minutes when they have moved `movedM` or more since the last one sent (battery friendly:
 * the phone is not asked more often than it needs). A rough reading waits for a better one, unless nothing has been
 * sent for `stillMin` minutes (so the manager sees "rough" rather than nothing).
 */
export function pingDue(
  last: { atMs: number; lat: number; lng: number } | null,
  fix: { atMs: number; lat: number; lng: number; accuracyM: number },
  opts: { stillMin: number; movingMin: number; movedM?: number; maxAccuracyM?: number },
): boolean {
  if (!last) return true;
  const since = fix.atMs - last.atMs;
  const rough = fix.accuracyM > (opts.maxAccuracyM ?? MOVEMENT_DEFAULTS.maxAccuracyM);
  if (since >= opts.stillMin * 60_000) return true;
  if (rough) return false;
  const moved = haversineM(last, fix) >= Math.max(opts.movedM ?? 100, fix.accuracyM);
  return moved && since >= opts.movingMin * 60_000;
}
