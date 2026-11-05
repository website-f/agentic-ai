// The link to Prima Secure App (plan section 3). Prima -> CMS: the directory (signed push to /ingest/directory).
// CMS -> Prima: events and closed alarms, signed the same way as Prima's JA feed, to Prima's CMS event endpoint
// (slice 4E: <staging-api-url>/api/integrations/cms/v1/events). The CMS app can also pull the directory from Prima
// (<staging-api-url>/api/integrations/cms/v1/directory) with the same key. Both stay off unless PRIMA_EVENTS_URL is set.
// Prima's side of this key is CMS_FEED_API_KEY / CMS_FEED_SIGNING_SECRET; here it is CMS_TO_PRIMA_KEY / _SECRET.
import { directoryProblems, type Directory } from './directory';
import { sign, type CmsEvent } from './event';
import type { Alarm } from './hub';

export interface PrimaLinkConfig {
  url: string;
  /** Prima's directory route. Defaults to the events URL with /events replaced by /directory. */
  directoryUrl: string;
  key: string;
  secret: string;
}

export function primaConfig(env: NodeJS.ProcessEnv = process.env): PrimaLinkConfig | null {
  const url = env.PRIMA_EVENTS_URL;
  const key = env.CMS_TO_PRIMA_KEY;
  const secret = env.CMS_TO_PRIMA_SECRET;
  if (!url || !key || !secret) return null;
  if (!/^https:\/\//.test(url)) throw new Error('PRIMA_EVENTS_URL must be https.');
  const directoryUrl = env.PRIMA_DIRECTORY_URL ?? url.replace(/\/events$/, '/directory');
  if (!/^https:\/\//.test(directoryUrl) || directoryUrl === url) throw new Error('PRIMA_DIRECTORY_URL must be an https URL other than the events URL.');
  return { url, directoryUrl, key, secret };
}

export interface PrimaBatch {
  events: CmsEvent[];
  /** Closed alarms: a real one opens the company's own case in Prima; a false one is kept for the false-alarm rate. */
  closedAlarms: Pick<Alarm, 'id' | 'kind' | 'companyId' | 'siteId' | 'summary' | 'openedAt' | 'outcome' | 'closingNote' | 'closedBy' | 'closedAt' | 'eventIds'>[];
  /**
   * What the hub knows about each device right now. Sent every STATUS_EVERY_MIN minutes even with nothing else queued, so
   * Prima has evidence a device was up; when the snapshots stop, Prima counts the time as Unknown, not covered.
   */
  status?: DeviceStatus;
}

export interface DeviceStatus {
  at: string;
  devices: { deviceId: string; state: 'online' | 'offline' | 'unknown' }[];
}

/** Decided (Fauzan, 3 Nov 07:42Z): how often the hub sends Prima its device status (Prima holds each up report as evidence for 15 minutes). */
export const STATUS_EVERY_MIN = 5;

export function signedRequest(batch: PrimaBatch, cfg: PrimaLinkConfig, now = Date.now()): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const body = JSON.stringify(batch);
  return { url: cfg.url, init: { method: 'POST', headers: { 'content-type': 'application/json', ...sign(body, cfg.key, cfg.secret, now) }, body } };
}

export interface PrimaLinkState {
  /** One send at a time: a second flush while one is running does nothing, so two sends never race on the queue. */
  inFlight: boolean;
  /** Tries per item (event id or alarm id) that Prima refused. */
  attempts: Map<string, number>;
  /** Items Prima refused MAX_REFUSALS times: kept and shown to the operator, never silently dropped. */
  parked: { at: string; kind: 'event' | 'closed alarm'; id: string; reason: string; attempts: number }[];
}

export const MAX_REFUSALS = 5;

export function newLinkState(): PrimaLinkState {
  return { inFlight: false, attempts: new Map(), parked: [] };
}

type Refusal = { list?: unknown; id?: unknown; index?: unknown; reason?: unknown };

/**
 * Sends what is waiting. Only the items actually sent are taken off the queues (by identity, never by position), so an
 * event queued while a send is running is never lost. On a network or HTTP failure everything stays queued. On HTTP 2xx,
 * items Prima refused stay queued for the next try; after MAX_REFUSALS tries they move to the parked list for the operator.
 */
export async function flush(
  queue: CmsEvent[],
  closed: Alarm[],
  cfg: PrimaLinkConfig,
  send: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }> = fetch,
  state: PrimaLinkState = newLinkState(),
  now: () => Date = () => new Date(),
  status?: () => DeviceStatus,
): Promise<{ sent: number; refused: number; parked: number; busy?: boolean; error?: string }> {
  if (state.inFlight) return { sent: 0, refused: 0, parked: 0, busy: true };
  if (!queue.length && !closed.length && !status) return { sent: 0, refused: 0, parked: 0 };
  state.inFlight = true;
  try {
    const events = queue.slice(0, 200);
    const alarms = closed.slice(0, 200);
    const req = signedRequest(
      {
        events,
        closedAlarms: alarms.map((a) => ({
          id: a.id,
          kind: a.kind,
          companyId: a.companyId,
          siteId: a.siteId,
          summary: a.summary,
          openedAt: a.openedAt,
          outcome: a.outcome,
          closingNote: a.closingNote,
          closedBy: a.closedBy,
          closedAt: a.closedAt,
          eventIds: a.eventIds,
        })),
        ...(status ? { status: status() } : {}),
      },
      cfg,
    );
    let res: Awaited<ReturnType<typeof send>>;
    try {
      res = await send(req.url, req.init);
    } catch (e) {
      return { sent: 0, refused: 0, parked: 0, error: e instanceof Error ? e.message : 'send failed' };
    }
    if (!res.ok) return { sent: 0, refused: 0, parked: 0, error: `Prima answered ${res.status}` };
    // A 2xx is an acknowledgement only when Prima says how many of each list it read and names every refusal so it
    // can be matched to an item sent. Anything else (no body, wrong counts, a refusal that matches nothing) keeps the
    // whole batch for the next try: a malformed answer never clears the queue (Arisha main review, round 2).
    const body = (res.json ? await res.json().catch(() => null) : null) as { received?: { events?: unknown; closedAlarms?: unknown }; refused?: unknown } | null;
    const malformed = (why: string) => ({ sent: 0, refused: 0, parked: 0, error: `Prima's answer was not a valid acknowledgement (${why}); kept for the next try` });
    if (!body || typeof body !== 'object' || !body.received || body.received.events !== events.length || body.received.closedAlarms !== alarms.length) return malformed('counts missing or different');
    if (body.refused !== undefined && !Array.isArray(body.refused)) return malformed('refusals not a list');
    const refusedEvents = new Map<CmsEvent, string>();
    const refusedAlarms = new Map<Alarm, string>();
    for (const r of (body.refused ?? []) as Refusal[]) {
      const reason = String(r?.reason ?? 'refused').slice(0, 200);
      if (r?.list !== 'events' && r?.list !== 'closedAlarms') return malformed('a refusal names no list');
      const inAlarms = r.list === 'closedAlarms';
      const list: (CmsEvent | Alarm)[] = inAlarms ? alarms : events;
      const byId = typeof r.id === 'string' ? list.find((x) => x.id === r.id) : undefined;
      const byIndex = typeof r.index === 'number' ? list[r.index] : undefined;
      // The id wins; an index alone is used only when the id is missing, and both must agree when both are given.
      const hit = byId ?? (typeof r.id === 'string' ? undefined : byIndex);
      if (!hit || (byId && byIndex && byId !== byIndex)) return malformed('a refusal matches no item sent');
      if (inAlarms) refusedAlarms.set(hit as Alarm, reason);
      else refusedEvents.set(hit as CmsEvent, reason);
    }
    let parked = 0;
    const settle = <T extends { id: string }>(sent: T[], refused: Map<T, string>, kind: 'event' | 'closed alarm', target: T[]) => {
      const drop = new Set<T>();
      for (const x of sent) {
        const reason = refused.get(x);
        if (reason === undefined) {
          drop.add(x);
          state.attempts.delete(`${kind}:${x.id}`);
          continue;
        }
        const n = (state.attempts.get(`${kind}:${x.id}`) ?? 0) + 1;
        state.attempts.set(`${kind}:${x.id}`, n);
        if (n >= MAX_REFUSALS) {
          drop.add(x);
          state.attempts.delete(`${kind}:${x.id}`);
          state.parked.push({ at: now().toISOString(), kind, id: x.id, reason, attempts: n });
          if (state.parked.length > 500) state.parked.shift();
          parked++;
        }
      }
      // Remove by identity: anything queued while the send was running stays.
      for (let i = target.length - 1; i >= 0; i--) if (drop.has(target[i])) target.splice(i, 1);
    };
    settle(events, refusedEvents, 'event', queue);
    settle(alarms, refusedAlarms, 'closed alarm', closed);
    return { sent: events.length + alarms.length - refusedEvents.size - refusedAlarms.size, refused: refusedEvents.size + refusedAlarms.size, parked };
  } finally {
    state.inFlight = false;
  }
}

/**
 * Pulls the directory from Prima (signed, empty body). A directory that fails the checks is refused and the copy the
 * app already holds stays in use, so a bad answer never empties the call-out lists.
 */
export async function pullDirectory(
  cfg: PrimaLinkConfig,
  send: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> = fetch,
  now = Date.now(),
): Promise<{ directory?: Directory; error?: string }> {
  const body = '{}';
  try {
    const res = await send(cfg.directoryUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...sign(body, cfg.key, cfg.secret, now) }, body });
    if (!res.ok) return { error: `Prima answered ${res.status}` };
    const d = await res.json();
    const bad = directoryProblems(d);
    if (bad.length) return { error: `Directory refused: ${bad.slice(0, 5).join('; ')}` };
    return { directory: d as Directory };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'pull failed' };
  }
}
