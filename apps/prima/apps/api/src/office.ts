import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// The Agentic Office link (P66, P67). Prima runs inside the office: people sign in to the office once, and the office's
// AI staff work in Prima for the person they act for. The office is the sign-in: it links each of its people to one
// Prima staff record (automatically when their verified Microsoft account is the one IT recorded here, else when the
// office owner confirms it), and names that record on every call. It holds no Prima password or token: each call is
// signed with OFFICE_SIGNING_SECRET (from the environment, never from code). Prima then applies, unchanged, every
// sign-in rule (closed accounts, the pilot, leadership-only mode, no system feeds) and every role, record rule and
// row-level policy. Calls older than 5 minutes are refused.
//
// via: "person" (someone in Prima's screens), "agent:<name>" (an AI acting for that person), or "system" (the office
// itself, with no person: only the office controller's staff list, never a screen or record).

const SKEW_MS = 5 * 60_000;
const USER_ID = /^[A-Za-z0-9_.:-]{1,100}$/;

export interface OfficeCall {
  /** The Prima staff record the office names ("" for a system call). */
  user: string;
  via: string;
}

export function officeSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.OFFICE_SIGNING_SECRET?.trim() ?? '';
  return s.length >= 32 ? s : null;
}

/** The bytes the office signs: the time, the method, the full path with its query, who, through what, and the body. */
export function officePayload(ts: string, method: string, url: string, call: OfficeCall, body: Buffer | string): Buffer {
  const head = `${ts}\n${method.toUpperCase()}\n${url}\n${call.user}\n${call.via}\n`;
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

/** The verified office call, or null. A person or agent call names a staff record; a system call names none. */
export function verifyOffice(
  headers: Record<string, unknown>,
  method: string,
  url: string,
  rawBody: Buffer | undefined,
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): OfficeCall | null {
  const secret = officeSecret(env);
  if (!secret) return null;
  const ts = String(headers['x-office-ts'] ?? '');
  const sig = String(headers['x-office-signature'] ?? '').toLowerCase();
  const call: OfficeCall = { user: String(headers['x-office-user'] ?? ''), via: String(headers['x-office-via'] ?? '') };
  const t = Date.parse(ts);
  if (!sig || Number.isNaN(t) || Math.abs(now - t) > SKEW_MS) return null;
  if (call.via === 'system') {
    if (call.user !== '') return null;
  } else if (!/^(person|agent:[^\n]{1,80})$/.test(call.via) || !USER_ID.test(call.user)) return null;
  const want = officeSign(secret, officePayload(ts, method, url, call, rawBody ?? Buffer.alloc(0)));
  return same(sig, want) ? call : null;
}
