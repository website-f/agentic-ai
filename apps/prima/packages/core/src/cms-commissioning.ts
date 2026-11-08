import { addDays } from "./time";
import { dateOf } from "./time";
import { fromMs } from "./time";
import { myt } from "./time";
import { toMs } from "./time";
import type { CmsService } from "./types";
import type { CmsServiceKind } from "./types";
import type { IsoDateTime } from "./types";
import type { SiteSystem } from "./types";


export const CMS_SERVICE_KINDS: Record<CmsServiceKind, string> = {
  cctv: 'CCTV monitoring',
  alarm: 'Alarm panel response',
  attendance: 'Guard attendance watch',
  patrol: 'Patrol watch',
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A monitoring window in Malaysia time. "00:00" to "24:00" is the whole day; a "to" before "from" runs past midnight. */
export function windowProblem(from: string, to: string): string | null {
  if (!HHMM.test(from)) return `start time ${from} is not HH:MM`;
  if (to !== '24:00' && !HHMM.test(to)) return `end time ${to} is not HH:MM`;
  if (from === to) return 'the window has no length';
  return null;
}

function minuteOfDay(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** The contracted monitoring intervals (epoch ms) that overlap [startMs, toMs]. */
export function contractedIntervals(window: { from: string; to: string }, startMs: number, endMs: number): [number, number][] {
  const out: [number, number][] = [];
  const a = minuteOfDay(window.from);
  const b = window.to === '24:00' ? 1440 : minuteOfDay(window.to);
  const len = (b > a ? b - a : 1440 - a + b) * 60_000;
  // Every Malaysia day from the day before the period to the day it ends.
  for (let d = addDays(dateOf(fromMs(startMs)), -1); d <= dateOf(fromMs(endMs)); d = addDays(d, 1)) {
    const start = toMs(myt(d, window.from));
    const s = Math.max(start, startMs);
    const e = Math.min(start + len, endMs);
    if (e > s) out.push([s, e]);
  }
  return out;
}

/**
 * How long one "up" observation is evidence for (decided, Fauzan 3 Nov 07:42Z). The CMS app sends a device status snapshot to Prima every
 * CMS_STATUS_EVERY_MIN minutes; three missed snapshots and Prima no longer knows, so the time is Unknown.
 */
export const CMS_STATUS_EVERY_MIN = 5;
export const CMS_UP_EVIDENCE_MIN = 15;
const UP_MS = CMS_UP_EVIDENCE_MIN * 60_000;
const KEEP_SEGMENTS = 500;

export type ObservedSegment = NonNullable<SiteSystem['observed']>[number];

/**
 * Adds one observation (a status snapshot, a DEVICE_ONLINE/OFFLINE edge, or any event from the device) to a system's
 * evidence, in time order whatever order it arrived in (Arisha main, 3 Nov 05:24Z). A run of the same state is one segment
 * {state, from, last}: up observations no more than CMS_UP_EVIDENCE_MIN apart, or down observations with nothing between.
 * A late observation that contradicts a run splits it; the rest of that run, up to its last observation, then counts in the
 * late observation's state (the safe side: never more covered time than the evidence shows).
 */
export function observe(list: ObservedSegment[] | undefined, state: 'up' | 'down', at: IsoDateTime): ObservedSegment[] {
  const t = toMs(at);
  if (!Number.isFinite(t)) return [...(list ?? [])];
  const segs = [...(list ?? [])].map((x) => ({ ...x }));
  let i = -1;
  for (let k = 0; k < segs.length; k++) if (toMs(segs[k].from) <= t) i = k;
  const cur = i >= 0 ? segs[i] : null;
  const joins = (a: ObservedSegment, bFromMs: number) => a.state === 'down' || bFromMs - toMs(a.last) <= UP_MS;
  if (cur && cur.state === state && (t <= toMs(cur.last) || joins(cur, t))) {
    if (t > toMs(cur.last)) cur.last = at;
  } else if (cur && cur.state !== state && t <= toMs(cur.last)) {
    // A late observation inside a run: the run held its state until then; the late state lasts until the run's last
    // observation, which starts again as its own point.
    const lastWas = cur.last;
    cur.last = at;
    const add: ObservedSegment[] = [{ state, from: at, last: at }];
    if (toMs(lastWas) > t) add.push({ state: cur.state, from: lastWas, last: lastWas });
    segs.splice(i + 1, 0, ...add);
    i++;
  } else {
    segs.splice(i + 1, 0, { state, from: at, last: at });
    i++;
  }
  // Merge the touched segment with the next when they now run together.
  const a = segs[i];
  const b = segs[i + 1];
  if (b && a.state === b.state && joins(a, toMs(b.from))) {
    a.last = toMs(b.last) > toMs(a.last) ? b.last : a.last;
    segs.splice(i + 1, 1);
  }
  return segs.slice(-KEEP_SEGMENTS);
}

/** The newest observed state of a system, or unknown when it was never observed or the last up evidence ran out. */
export function observedStateAt(list: ObservedSegment[] | undefined, nowMs: number): 'up' | 'down' | 'unknown' {
  const tl = timeline(list, nowMs - 1, nowMs);
  return tl.length ? tl[tl.length - 1][2] : 'unknown';
}

/** A system's state over [startMs, endMs] from its observations; time no observation speaks for is unknown. */
export function timeline(list: ObservedSegment[] | undefined, startMs: number, endMs: number): [number, number, 'up' | 'down' | 'unknown'][] {
  const segs = (list ?? []).filter((x) => toMs(x.from) <= endMs).sort((x, y) => toMs(x.from) - toMs(y.from));
  const known: [number, number, 'up' | 'down'][] = [];
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    const from = toMs(s.from);
    const last = Math.min(toMs(s.last), endMs); // an observation in the future is not evidence
    const next = segs[k + 1] ? toMs(segs[k + 1].from) : Infinity;
    // Up holds until the evidence runs out; down holds until the next observation (the device came back then), or for
    // the evidence window after the last down observation when nothing followed.
    const until = s.state === 'up' ? Math.min(next, last + UP_MS) : Number.isFinite(next) ? next : last + UP_MS;
    const a = Math.max(from, startMs);
    const b = Math.min(until, endMs);
    if (b > a) known.push([a, b, s.state]);
  }
  const out: [number, number, 'up' | 'down' | 'unknown'][] = [];
  let at = startMs;
  for (const [a, b, st] of known) {
    if (a > at) out.push([at, a, 'unknown']);
    out.push([Math.max(a, at), b, st]);
    at = Math.max(at, b);
  }
  if (endMs > at) out.push([at, endMs, 'unknown']);
  return out.filter(([a, b]) => b > a);
}

export interface ContractedCoverage {
  siteId: string;
  contractedMin: number;
  /** Contracted minutes when CMS had evidence that at least one linked system was up. Not proof recordings are complete. */
  reachableMin: number;
  /** Contracted minutes when every linked system was observed down. */
  downMin: number;
  /** Contracted minutes CMS cannot speak for: no linked system, no observation, or the last evidence ran out. */
  unknownMin: number;
  reachablePct: number | null;
}

/**
 * Coverage of one contracted site over [startMs, endMs]. A minute is reachable when any linked system was observed up,
 * down when every linked system was observed down, and unknown otherwise. Unknown is never counted as covered.
 */
export function contractedCoverage(siteId: string, window: { from: string; to: string }, systems: SiteSystem[], startMs: number, endMs: number): ContractedCoverage {
  const contracted = contractedIntervals(window, startMs, endMs);
  const contractedMs = contracted.reduce((n, [s, e]) => n + (e - s), 0);
  const linked = systems.filter((s) => s.siteId === siteId && s.linked);
  let up = 0;
  let down = 0;
  for (const [cs, ce] of contracted) {
    const lines = linked.map((s) => timeline(s.observed, cs, ce));
    const cuts = [...new Set([cs, ce, ...lines.flatMap((l) => l.flatMap(([a, b]) => [a, b]))])].sort((x, y) => x - y);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [a, b] = [cuts[k], cuts[k + 1]];
      const states = lines.map((l) => l.find(([x, y]) => x <= a && y >= b)?.[2] ?? 'unknown');
      if (states.includes('up')) up += b - a;
      else if (states.length && states.every((x) => x === 'down')) down += b - a;
    }
  }
  const min = (ms: number) => Math.round(ms / 60_000);
  const unknown = contractedMs - up - down;
  return {
    siteId,
    contractedMin: min(contractedMs),
    reachableMin: min(up),
    downMin: min(down),
    unknownMin: min(unknown),
    reachablePct: contractedMs ? Math.round((up / contractedMs) * 1000) / 10 : null,
  };
}

/** The equipment Prima can check for each service; attendance and patrol run through the JA app, which Prima cannot see. */
export const CMS_SERVICE_EQUIPMENT: Record<CmsServiceKind, SiteSystem['kind'] | null> = { cctv: 'CCTV', alarm: 'ALARM_PANEL', attendance: null, patrol: null };

/** Each signed service needs its equipment linked at every scoped site, and an acceptance test recorded per site. */
export function serviceTestGaps(svc: CmsService, systems: SiteSystem[], siteName: (id: string) => string): string[] {
  const out: string[] = [];
  for (const service of svc.services) {
    const kind = CMS_SERVICE_EQUIPMENT[service];
    for (const x of svc.sites) {
      if (kind && !systems.some((s) => s.siteId === x.siteId && s.linked && s.kind === kind))
        out.push(`${CMS_SERVICE_KINDS[service]}: no ${kind === 'CCTV' ? 'CCTV' : 'alarm panel'} linked at ${siteName(x.siteId)}`);
      else if (!(svc.tests ?? []).some((t) => t.service === service && t.siteId === x.siteId)) out.push(`${CMS_SERVICE_KINDS[service]}: no acceptance test recorded at ${siteName(x.siteId)}`);
    }
  }
  return out;
}

/** What is still missing before CMS commissioning is complete (besides the technical check). */
export function commissioningGaps(svc: CmsService | null | undefined): string[] {
  if (!svc) return ['no signed CMS service scope recorded'];
  const out: string[] = [];
  const unverified = svc.contacts.filter((c) => !c.verifiedAt);
  if (unverified.length) out.push(`call-out contacts not verified by a CMS test call: ${unverified.map((c) => c.name).join(', ')}`);
  if (!svc.operatorAcceptance) out.push('no CMS operator acceptance (Arms Control)');
  if (!svc.clientAcceptance) out.push("no client acceptance recorded");
  return out;
}