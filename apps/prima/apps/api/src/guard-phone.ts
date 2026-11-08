/**
 * Guards on their own phones (third audit item 2, Fauzan 5 Nov 2026): the switch and the phone's sign-in token.
 *
 * Off unless GUARD_PHONE=on. With it on, GUARD_PHONE_SECRET (32+ characters, a Key Vault secret) signs the token a
 * phone gets after face plus PIN. The token names the guard and the sign-in session; every request also checks in the
 * database that the session is still open, so retiring a phone or signing out ends it at once, not at expiry.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GuardPhoneConfig {
  on: boolean;
  secret: string | null;
}

export function guardPhoneConfig(env: NodeJS.ProcessEnv = process.env): GuardPhoneConfig {
  const on = env.GUARD_PHONE === 'on';
  const secret = env.GUARD_PHONE_SECRET && env.GUARD_PHONE_SECRET.length >= 32 ? env.GUARD_PHONE_SECRET : null;
  if (on && !secret) throw new Error('GUARD_PHONE=on needs GUARD_PHONE_SECRET (at least 32 characters).');
  if (on && secret && secret === env.DEV_TOKEN_SECRET) throw new Error('GUARD_PHONE_SECRET must not be the same as DEV_TOKEN_SECRET.');
  return { on, secret };
}

/** Guard phone tokens start with this, so they are never mistaken for a Microsoft or development token. */
export const GUARD_TOKEN_PREFIX = 'gp1.';

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(`guard-phone-token.${body}`).digest('base64url');

export function issueGuardToken(secret: string, userId: string, sessionId: string, expiresAtMs: number): string {
  const body = Buffer.from(JSON.stringify({ sub: userId, s: sessionId, exp: expiresAtMs })).toString('base64url');
  return `${GUARD_TOKEN_PREFIX}${body}.${sign(secret, body)}`;
}

/** The guard and session of a token this server signed and that has not expired; otherwise null. */
export function verifyGuardToken(secret: string, token: string, now = Date.now()): { userId: string; sessionId: string } | null {
  if (!token.startsWith(GUARD_TOKEN_PREFIX) || token.length > 600) return null;
  const [body, mac, extra] = token.slice(GUARD_TOKEN_PREFIX.length).split('.');
  if (!body || !mac || extra !== undefined) return null;
  const want = Buffer.from(sign(secret, body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: unknown; s?: unknown; exp?: unknown };
    if (typeof t.sub !== 'string' || typeof t.s !== 'string' || typeof t.exp !== 'number' || t.exp <= now) return null;
    return { userId: t.sub, sessionId: t.s };
  } catch {
    return null;
  }
}

/**
 * A tighter limit for the routes a phone calls before it is signed in (enrol, face, sign-in): per address and route,
 * on top of the general limit. Wrong PINs and faces also lock the phone itself (rule OPS-GUARD-PHONE).
 */
export class GuardPhoneLimiter {
  private hits = new Map<string, { n: number; until: number }>();

  constructor(
    private max = 20,
    private windowMs = 60_000,
    private now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    let h = this.hits.get(key);
    if (!h || h.until <= t) {
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.until <= t) this.hits.delete(k);
      h = { n: 0, until: t + this.windowMs };
      this.hits.set(key, h);
    }
    h.n += 1;
    return h.n <= this.max;
  }
}
