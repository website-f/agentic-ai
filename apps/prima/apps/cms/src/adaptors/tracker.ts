// Vehicle trackers on CIT vans and company vehicles: panic, speed, route and driver hours.
// JPJ driver rules apply to CIT vans (Fauzan, 1 Nov 2026): at most 8 hours driving a day, a 30 minute break after
// 4 hours of driving. Driver health and dashcam monitoring are reviewed and may be on (Fauzan, 1 Nov 2026).
import { makeEvent, stableId, type CmsEvent } from '../event';
import type { DirectoryIndex } from '../directory';

export interface Fix {
  trackerId: string;
  at: string;
  lat: number;
  lon: number;
  speedKmh: number;
  ignition: boolean;
  panic: boolean;
}

export interface Route {
  trackerId: string;
  /** Points along the planned route. */
  points: { lat: number; lon: number }[];
  /** How far off the route counts as off route, in metres. PROPOSED default 500. */
  toleranceM: number;
}

export const SPEED_LIMIT_KMH = 90; // PROPOSED
export const MAX_DRIVING_MIN_PER_DAY = 8 * 60;
export const MAX_CONTINUOUS_MIN = 4 * 60;
export const MIN_BREAK_MIN = 30;

export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance from a point to the route, checking each leg (flat-earth projection, fine at route scale). */
export function offRouteBy(p: { lat: number; lon: number }, route: Route): number {
  if (route.points.length === 0) return 0;
  if (route.points.length === 1) return metres(p, route.points[0]);
  let best = Infinity;
  const k = Math.cos((p.lat * Math.PI) / 180);
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i];
    const b = route.points[i + 1];
    const ax = a.lon * k, ay = a.lat, bx = b.lon * k, by = b.lat, px = p.lon * k, py = p.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, metres(p, { lat: ay + t * dy, lon: (ax + t * dx) / k }));
  }
  return best;
}

export function fixEvents(fix: Fix, dir: DirectoryIndex, route: Route | undefined, receivedAt = new Date().toISOString()): CmsEvent[] | { refused: string } {
  const dev = dir.devices.get(fix.trackerId);
  if (!dev || dev.kind !== 'tracker') return { refused: `tracker ${fix.trackerId} not in the directory` };
  if (Number.isNaN(Date.parse(fix.at))) return { refused: 'time missing' };
  const site = dir.sites.get(dev.siteId)!;
  const base = { companyId: site.companyId, siteId: site.id, deviceId: dev.id, source: 'tracker', occurredAt: fix.at, receivedAt };
  const where = { lat: fix.lat, lon: fix.lon, speedKmh: fix.speedKmh };
  const out: CmsEvent[] = [];
  if (fix.panic) out.push(makeEvent({ ...base, id: stableId('trk-panic', dev.id, fix.at), kind: 'VEHICLE_PANIC', summary: `Panic from vehicle ${dev.id}`, detail: where }));
  if (fix.speedKmh > SPEED_LIMIT_KMH)
    out.push(makeEvent({ ...base, id: stableId('trk-speed', dev.id, fix.at), kind: 'VEHICLE_SPEEDING', summary: `Vehicle ${dev.id} at ${Math.round(fix.speedKmh)} km/h`, detail: where }));
  if (route) {
    const off = offRouteBy(fix, route);
    if (off > route.toleranceM)
      out.push(makeEvent({ ...base, id: stableId('trk-route', dev.id, fix.at), kind: 'VEHICLE_OFF_ROUTE', summary: `Vehicle ${dev.id} ${Math.round(off)} m off its route`, detail: { ...where, offRouteM: Math.round(off) } }));
  }
  return out;
}

/** A period the engine was on with this driver. */
export interface Drive {
  driverId: string;
  start: string;
  end: string;
}

export interface HoursCheck {
  drivingMin: number;
  /** Longest run of driving with no break of at least 30 minutes. */
  longestRunMin: number;
  overDay: boolean;
  noBreak: boolean;
}

/** JPJ hours for one driver on one day from their drives (sorted or not). */
export function driverHours(drives: Drive[]): HoursCheck {
  const ds = [...drives].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  let total = 0;
  let run = 0;
  let longest = 0;
  let lastEnd: number | null = null;
  for (const d of ds) {
    const s = Date.parse(d.start);
    const e = Date.parse(d.end);
    if (e <= s) continue;
    const mins = (e - s) / 60_000;
    total += mins;
    if (lastEnd !== null && (s - lastEnd) / 60_000 >= MIN_BREAK_MIN) run = 0;
    run += mins;
    longest = Math.max(longest, run);
    lastEnd = Math.max(lastEnd ?? e, e);
  }
  return { drivingMin: Math.round(total), longestRunMin: Math.round(longest), overDay: total > MAX_DRIVING_MIN_PER_DAY, noBreak: longest > MAX_CONTINUOUS_MIN };
}
