/**
 * P120 (Fitri, 20 Nov 2026: "enhance the check-in, detect the current location accurately, super accurate, do an
 * algorithm"): one check-in location made from many readings instead of the single best one.
 *
 * A phone's first readings are often old (cached) or come from Wi-Fi and cell towers (hundreds of metres off), and GPS
 * readings wander a few metres around the true spot and sometimes jump. So while the person holds still, every reading
 * is kept and:
 * 1. `usable`: readings taken before the search started (cached), with no or absurd accuracy, or that jump faster than a
 *    car could move (a glitch or a fake location) are dropped;
 * 2. `fuse`: only the precise cluster counts (within twice the best accuracy); its centre is the accuracy-weighted mean
 *    (weight 1/accuracy², the standard inverse-variance mean), and readings far from that centre are dropped and the
 *    centre worked out again (three rounds), so one stray reading cannot pull it away;
 * 3. `settled`: the reading is taken once it is precise and stable (enough readings, and the newest one no longer moves
 *    the centre), after a short warm-up; or, at the time limit, the best there is.
 *
 * The accuracy reported is never better than the best the phone itself measured (nor than how far the used readings
 * spread): averaging steadies the point but the server's accuracy rule still sees an honest number. Pure functions (no
 * browser APIs), tested in scripts/location-fix.test.mjs.
 */

export interface Reading {
  lat: number;
  lng: number;
  accuracyM: number;
  /** When the phone took it (ms since 1970). */
  at: number;
}

export interface Fused {
  lat: number;
  lng: number;
  /** Honest accuracy: the best reading's, or the spread of the readings used, whichever is larger. */
  accuracyM: number;
  /** Readings that made the point. */
  used: number;
  /** How far the readings used lie from the point (root mean square), metres. */
  spreadM: number;
}

const EARTH_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Faster than this between two readings is not a person moving: a glitch or a faked location. */
export const MAX_SPEED_MPS = 55;
/** Readings rougher than this never help (cell-tower guesses). */
export const WORST_M = 3000;

/** The readings worth using, oldest first: taken since `since` (ms; a second of grace), with a real accuracy, and
 * without impossible jumps from the reading before. */
export function usable(readings: Reading[], since: number): Reading[] {
  const fresh = readings
    .filter(
      (r) =>
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng) &&
        Math.abs(r.lat) <= 90 &&
        Math.abs(r.lng) <= 180 &&
        !(r.lat === 0 && r.lng === 0) &&
        Number.isFinite(r.accuracyM) &&
        r.accuracyM > 0 &&
        r.accuracyM <= WORST_M &&
        r.at >= since - 1000,
    )
    .sort((a, b) => a.at - b.at);
  const out: Reading[] = [];
  for (const r of fresh) {
    const prev = out.at(-1);
    if (prev) {
      const d = distanceM(prev, r);
      const s = Math.max((r.at - prev.at) / 1000, 0.5);
      // A jump beyond both readings' own error, faster than any vehicle: keep the earlier one.
      if (d > prev.accuracyM + r.accuracyM && d / s > MAX_SPEED_MPS) continue;
    }
    out.push(r);
  }
  return out;
}

function weightedCentre(rs: Reading[]): { lat: number; lng: number } {
  let w = 0;
  let lat = 0;
  let lng = 0;
  for (const r of rs) {
    const k = 1 / (r.accuracyM * r.accuracyM);
    w += k;
    lat += r.lat * k;
    lng += r.lng * k;
  }
  return { lat: lat / w, lng: lng / w };
}

/** One point from the readings (see the top of the file), or null with none. */
export function fuse(readings: Reading[]): Fused | null {
  if (!readings.length) return null;
  const best = Math.min(...readings.map((r) => r.accuracyM));
  // Only the precise cluster: a 300 m Wi-Fi guess says nothing next to 8 m GPS readings.
  let keep = readings.filter((r) => r.accuracyM <= Math.max(best * 2, best + 15));
  let centre = weightedCentre(keep);
  for (let round = 0; round < 3; round++) {
    const near = keep.filter((r) => distanceM(centre, r) <= Math.max(2 * r.accuracyM, 2 * best, 6));
    if (!near.length || near.length === keep.length) break;
    keep = near;
    centre = weightedCentre(keep);
  }
  const spread = Math.sqrt(keep.reduce((s, r) => s + distanceM(centre, r) ** 2, 0) / keep.length);
  const bestKept = Math.min(...keep.map((r) => r.accuracyM));
  return {
    lat: centre.lat,
    lng: centre.lng,
    accuracyM: Math.max(1, Math.round(Math.max(bestKept, spread))),
    used: keep.length,
    spreadM: Math.round(spread * 10) / 10,
  };
}

export interface SettleRules {
  /** Precise enough to take at once (metres). */
  goodM: number;
  /** The most the server accepts (metres). */
  maxM: number;
  /** Warm-up: before this, only a very precise reading is taken (ms). */
  warmMs: number;
  /** After this, the best there is (if within maxM) is taken (ms). */
  waitMs: number;
}

export const SETTLE: SettleRules = { goodM: 20, maxM: 100, warmMs: 3000, waitMs: 15_000 };
/** So precise that warming up further gains nothing. */
const SHARP_M = 8;

/** Whether to take the location now. `elapsedMs`: since the search started. */
export function settled(readings: Reading[], elapsedMs: number, rules: SettleRules = SETTLE): boolean {
  const now = fuse(readings);
  if (!now) return false;
  if (now.accuracyM <= SHARP_M && now.used >= 2) return true;
  if (elapsedMs < rules.warmMs) return false;
  // Stable: the newest reading no longer moves the point by more than a few metres.
  const before = readings.length > 1 ? fuse(readings.slice(0, -1)) : null;
  const drift = before ? distanceM(before, now) : Infinity;
  const steady = drift <= Math.max(4, now.accuracyM / 2);
  if (now.accuracyM <= rules.goodM && now.used >= 3 && steady) return true;
  return elapsedMs >= rules.waitMs && now.accuracyM <= rules.maxM && (steady || elapsedMs >= rules.waitMs * 2);
}
