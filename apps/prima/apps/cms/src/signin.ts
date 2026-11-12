// E7 (P100, Fauzan 11 Nov 2026: "CMS operator Microsoft sign-in: BUILD"). Operators no longer type a personal key. They
// sign in to Prima the way everyone does (Microsoft, or the Agentic Office that opens Prima), open the CMS console from
// Prima, and Prima hands the browser a one-time ticket: who the person is on the CMS roster, signed with a secret only
// Prima and CMS hold (CMS_SIGNIN_SECRET), valid for 60 seconds and used once. Prima decides who may come in (active CMS
// roster staff with their own Prima account, or Arms Control); CMS checks the signature, the time and that the ticket
// was not used before, then keeps its own short session (HttpOnly, Secure, SameSite=Strict cookie): 15 minutes idle,
// 12 hours at most (one shift). The operator key path stays only as a sealed break-glass fallback, switched off unless
// CMS_BREAK_GLASS=true (docs/CMS_DURABILITY_AND_OPERATOR_SIGN_IN_PLAN.md section 3).
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const TICKET_PREFIX = 'cmst1.';
/** Longest a ticket may live, whatever it says (Prima issues them for 60 seconds). */
export const TICKET_MAX_S = 120;
export const SESSION_COOKIE = 'cms_session';

export interface TicketClaims {
  v: 1;
  /** Prima staff record id. */
  sub: string;
  /** The person's name on the CMS roster (the desk handover matches on it). */
  name: string;
  posts: string[];
  /** How the person signed in to Prima: microsoft (Entra), office (Agentic Office), dev (development only). */
  via: 'microsoft' | 'office' | 'dev';
  iat: number;
  exp: number;
  /** One-time number: a ticket is taken once. */
  n: string;
}

export interface SignInConfig {
  secret: string;
  /** Sign-in routes Prima vouched for that CMS accepts. Development sign-in only in the demo. */
  accept: TicketClaims['via'][];
  idleMin: number;
  maxHours: number;
  /** Where the "Sign in with Microsoft" button sends an operator (Prima's CMS screen). */
  primaUrl: string | null;
}

const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(`cms-signin.${payload}`).digest('base64url');

/** Prima's side: makes the ticket (apps/api/src/cms-signin.ts calls this shape; kept here so both use one format). */
export function signTicket(claims: TicketClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${TICKET_PREFIX}${payload}.${mac(secret, payload)}`;
}

export type TicketCheck = { ok: true; claims: TicketClaims } | { ok: false; reason: string };

/** Checks a ticket's signature, shape, time and route. Whether it was used before is the session store's check. */
export function verifyTicket(ticket: unknown, cfg: Pick<SignInConfig, 'secret' | 'accept'>, nowMs: number): TicketCheck {
  if (typeof ticket !== 'string' || !ticket.startsWith(TICKET_PREFIX) || ticket.length > 2000) return { ok: false, reason: 'not a ticket' };
  const [payload, sig, extra] = ticket.slice(TICKET_PREFIX.length).split('.');
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: 'not a ticket' };
  const a = createHash('sha256').update(mac(cfg.secret, payload)).digest();
  const b = createHash('sha256').update(sig).digest();
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'signature' };
  let c: Partial<TicketClaims>;
  try {
    c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TicketClaims>;
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const now = Math.floor(nowMs / 1000);
  if (c.v !== 1 || typeof c.sub !== 'string' || !c.sub || typeof c.name !== 'string' || !c.name.trim() || typeof c.n !== 'string' || c.n.length < 16) return { ok: false, reason: 'shape' };
  if (!Array.isArray(c.posts) || c.posts.some((p) => typeof p !== 'string')) return { ok: false, reason: 'shape' };
  if (typeof c.iat !== 'number' || typeof c.exp !== 'number' || c.exp <= c.iat || c.exp - c.iat > TICKET_MAX_S) return { ok: false, reason: 'time' };
  if (c.iat > now + 60 || c.exp < now) return { ok: false, reason: 'expired' };
  if (!c.via || !cfg.accept.includes(c.via)) return { ok: false, reason: 'sign-in route not accepted' };
  return { ok: true, claims: c as TicketClaims };
}

export interface Session {
  id: string;
  operator: string;
  sub: string;
  via: TicketClaims['via'];
  startedAt: number;
  lastAt: number;
}

/** CMS's own operator sessions. Kept in memory: a restart signs operators out (they open CMS from Prima again). */
export class Sessions {
  private readonly map = new Map<string, Session>();
  private readonly used = new Map<string, number>();

  constructor(private readonly cfg: Pick<SignInConfig, 'idleMin' | 'maxHours'>) {}

  /** Takes a checked ticket once: a second use of the same ticket is refused. */
  start(c: TicketClaims, nowMs: number): Session | null {
    for (const [n, exp] of this.used) if (exp * 1000 < nowMs) this.used.delete(n);
    if (this.used.has(c.n)) return null;
    this.used.set(c.n, c.exp);
    const s: Session = { id: randomBytes(32).toString('base64url'), operator: c.name.trim().slice(0, 120), sub: c.sub, via: c.via, startedAt: nowMs, lastAt: nowMs };
    this.map.set(s.id, s);
    return s;
  }

  /** The session behind a cookie, still inside its idle and shift limits; touching it keeps it alive. */
  get(id: string | null, nowMs: number): Session | null {
    if (!id) return null;
    const s = this.map.get(id);
    if (!s) return null;
    if (nowMs - s.lastAt > this.cfg.idleMin * 60_000 || nowMs - s.startedAt > this.cfg.maxHours * 3_600_000) {
      this.map.delete(id);
      return null;
    }
    s.lastAt = nowMs;
    return s;
  }

  end(id: string | null): Session | null {
    if (!id) return null;
    const s = this.map.get(id) ?? null;
    this.map.delete(id);
    return s;
  }
}

/** The session cookie's value from the request's Cookie header. */
export function sessionCookie(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join(';') : header ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return v.join('=') || null;
  }
  return null;
}

export function setCookie(id: string, maxAgeS: number): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeS}`;
}
export const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** Sign-in settings from the environment, or null when Microsoft sign-in through Prima is not set up. */
export function signInFromEnv(env: NodeJS.ProcessEnv = process.env, demo = false): SignInConfig | null {
  const secret = env.CMS_SIGNIN_SECRET ?? '';
  if (!secret) return null;
  if (secret.length < 32) throw new Error('CMS_SIGNIN_SECRET must be at least 32 characters (the same value Prima holds).');
  const accept = (env.CMS_SIGNIN_ACCEPT ?? 'microsoft,office')
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is TicketClaims['via'] => x === 'microsoft' || x === 'office' || (demo && x === 'dev'));
  if (!accept.length) throw new Error('CMS_SIGNIN_ACCEPT names no sign-in route (microsoft, office).');
  const url = (env.CMS_PRIMA_SIGNIN_URL ?? '').trim();
  if (url && !/^https:\/\//.test(url) && !demo) throw new Error('CMS_PRIMA_SIGNIN_URL must be an https address.');
  return { secret, accept, idleMin: 15, maxHours: 12, primaUrl: url || null };
}
