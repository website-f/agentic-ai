import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// The Agentic Office link (P66). Prima runs inside the office (one sign-in, at /prisma/), and the office's AI staff
// work in Prima for the person they act for. The office never holds a Prima password or token: it signs each call
// with OFFICE_SIGNING_SECRET (from the environment, never from code) and names the person by their Microsoft account
// (tenant + object ID), verified by the office's own Microsoft sign-in. Prima then links that object ID exactly as a
// Microsoft token is linked (userForEntra: by entraOid only, closed accounts and pilot rules refused), so every
// role, record rule and row-level policy applies unchanged. Calls older than 5 minutes are refused.

const SKEW_MS = 5 * 60_000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface OfficeCall {
  oid: string;
  tid: string;
  /** "person" (someone in Prima's screens) or "agent:<name>" (an AI acting for that person). */
  via: string;
}

export function officeSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.OFFICE_SIGNING_SECRET?.trim() ?? '';
  return s.length >= 32 ? s : null;
}

/** The string the office signs: the time, the method, the full path with its query, who, through what, and the body. */
export function officePayload(ts: string, method: string, url: string, call: OfficeCall, body: Buffer | string): Buffer {
  const head = `${ts}\n${method.toUpperCase()}\n${url}\n${call.oid}\n${call.tid}\n${call.via}\n`;
  return Buffer.concat([Buffer.from(head), Buffer.isBuffer(body) ? body : Buffer.from(body)]);
}

export function officeSign(secret: string, payload: Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function same(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/** True when the request carries the office's headers at all (then it must verify, or it is refused). */
export function isOfficeCall(headers: Record<string, unknown>): boolean {
  return headers['x-office-signature'] !== undefined;
}

/**
 * The verified office call, or null. The tenant must be Prima's own Microsoft tenant: a person from another
 * organisation can never be linked, whatever the office says.
 */
export function verifyOffice(
  headers: Record<string, unknown>,
  method: string,
  url: string,
  rawBody: Buffer | undefined,
  tenantId: string | null,
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): OfficeCall | null {
  const secret = officeSecret(env);
  if (!secret || !tenantId) return null;
  const ts = String(headers['x-office-ts'] ?? '');
  const sig = String(headers['x-office-signature'] ?? '').toLowerCase();
  const call: OfficeCall = {
    oid: String(headers['x-office-oid'] ?? '').toLowerCase(),
    tid: String(headers['x-office-tid'] ?? '').toLowerCase(),
    via: String(headers['x-office-via'] ?? ''),
  };
  const t = Date.parse(ts);
  if (!sig || Number.isNaN(t) || Math.abs(now - t) > SKEW_MS) return null;
  if (!GUID.test(call.oid) || call.tid !== tenantId.toLowerCase()) return null;
  if (!/^(person|agent:[^\n]{1,80})$/.test(call.via)) return null;
  const want = officeSign(secret, officePayload(ts, method, url, call, rawBody ?? Buffer.alloc(0)));
  return same(sig, want) ? call : null;
}
