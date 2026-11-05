// The one common event format (CMS plan, 2 Nov 2026). Every adaptor, whatever the brand, turns its device's message into a
// CmsEvent, so the dashboard, the alert rules and the Prima link never depend on a brand.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type Severity = 'critical' | 'high' | 'normal' | 'info';

/** What happened. New kinds are added here, never invented by an adaptor. */
export const EVENT_KINDS = {
  INTRUSION: 'critical',
  PANIC: 'critical',
  FIRE: 'critical',
  TAMPER: 'high',
  DOOR_FORCED: 'high',
  DOOR_HELD_OPEN: 'normal',
  VAULT_DOOR_UNMATCHED: 'critical',
  VAULT_WATCH_MISSED: 'high',
  FIREARM_OVERDUE: 'critical',
  GATE_PLATE_UNKNOWN: 'normal',
  GATE_PLATE_BLOCKED: 'high',
  GATE_PLATE_ALLOWED: 'info',
  GATE_VISITOR_ARRIVED: 'info',
  GUARD_NO_SHOW: 'high',
  GUARD_LEFT_POST: 'high',
  GUARD_CLOCKED_IN: 'info',
  PATROL_MISSED: 'normal',
  PATROL_CHECKPOINT: 'info',
  VEHICLE_PANIC: 'critical',
  VEHICLE_OFF_ROUTE: 'high',
  VEHICLE_SPEEDING: 'normal',
  DRIVER_OVER_HOURS: 'high',
  DEVICE_OFFLINE: 'normal',
  DEVICE_ONLINE: 'info',
  ALARM_RESTORED: 'info',
  SYSTEM_STATUS: 'info',
} as const satisfies Record<string, Severity>;

export type EventKind = keyof typeof EVENT_KINDS;

export interface CmsEvent {
  /** Unique id. Adaptors derive it from the device message so a resent message is the same event (no duplicates). */
  id: string;
  kind: EventKind;
  severity: Severity;
  companyId: string;
  siteId: string;
  /** The device or system that reported it, e.g. a camera, panel zone, gate lane, tracker or the JA app. */
  deviceId: string;
  /** Adaptor that made it, e.g. 'sia-dc09', 'anpr-json', 'tracker-json', 'ja-feed'. */
  source: string;
  /** Time the device says it happened (ISO). Falls back to received time when the device sent none. */
  occurredAt: string;
  receivedAt: string;
  /** Short plain words for the operator. */
  summary: string;
  /** Link to the video clip around the event, when the recorder gives one. */
  clipUrl?: string;
  /** Brand-free details, e.g. { plate: 'WXX1234', zone: 15 }. Never secrets. */
  detail: Record<string, string | number | boolean | null>;
}

export function severityOf(kind: EventKind): Severity {
  return EVENT_KINDS[kind];
}

export function isEventKind(k: unknown): k is EventKind {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(EVENT_KINDS, k);
}

/** A stable id from the parts that make a device message unique, so the same message sent twice is one event. */
export function stableId(...parts: (string | number)[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

export function newId(): string {
  return randomUUID();
}

export function makeEvent(e: Omit<CmsEvent, 'severity' | 'receivedAt' | 'occurredAt'> & { occurredAt?: string; receivedAt?: string }): CmsEvent {
  const receivedAt = e.receivedAt ?? new Date().toISOString();
  return { ...e, severity: severityOf(e.kind), receivedAt, occurredAt: e.occurredAt ?? receivedAt };
}

/** Checks an event that came from outside (a gateway or adaptor). Returns the reasons it is refused; empty means fine. */
export function problems(e: unknown): string[] {
  const out: string[] = [];
  if (!e || typeof e !== 'object') return ['not an object'];
  const x = e as Record<string, unknown>;
  for (const f of ['id', 'companyId', 'siteId', 'deviceId', 'source', 'summary'] as const)
    if (typeof x[f] !== 'string' || !(x[f] as string).trim()) out.push(`${f} missing`);
  if (!isEventKind(x.kind)) out.push('kind not known');
  for (const f of ['occurredAt', 'receivedAt'] as const) if (typeof x[f] !== 'string' || Number.isNaN(Date.parse(x[f] as string))) out.push(`${f} not a time`);
  if (!x.detail || typeof x.detail !== 'object' || Array.isArray(x.detail)) out.push('detail missing');
  else for (const [k, v] of Object.entries(x.detail)) if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) out.push(`detail.${k} not a plain value`);
  if (x.clipUrl !== undefined && (typeof x.clipUrl !== 'string' || !/^https:\/\//.test(x.clipUrl))) out.push('clipUrl must be https');
  return out;
}

// ---- Signing: the same scheme as Prima's JA, door and Planner feeds (HMAC-SHA256 of "timestamp.body", 5 minute window). ----

export const SKEW_MS = 5 * 60_000;

export interface Signed {
  'x-api-key': string;
  'x-timestamp': string;
  'x-signature': string;
}

export function sign(body: string, key: string, secret: string, now = Date.now()): Signed {
  const ts = new Date(now).toISOString();
  return { 'x-api-key': key, 'x-timestamp': ts, 'x-signature': createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex') };
}

function same(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export function verify(headers: Record<string, unknown>, body: string | Buffer, key: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!key || !secret) return false;
  const got = String(headers['x-api-key'] ?? '');
  const ts = String(headers['x-timestamp'] ?? '');
  const sig = String(headers['x-signature'] ?? '').toLowerCase();
  const t = Date.parse(ts);
  if (!got || !sig || Number.isNaN(t) || Math.abs(now - t) > SKEW_MS) return false;
  const want = createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');
  return same(got, key) && same(sig, want);
}
