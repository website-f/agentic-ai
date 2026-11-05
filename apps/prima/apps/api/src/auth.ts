import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { RULES, accessClosed, dateOf, fromMs, inPilot, type User } from '@prima/core';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Db } from './db';
import { EntraTokenError, entraConfig, microsoftKeys, verifyEntraToken, type EntraConfig, type EntraIdentity, type KeySource } from './entra';
import { leadershipOnboardingPermits } from './arisha-pilot';
import { isOfficeCall, verifyOffice, type OfficeCall } from './office';

// Office staff sign in with Microsoft Entra ID (entra.ts). The HMAC tokens below are for development and the test
// build only, and are accepted only while ALLOW_DEV_LOGIN=true. Shared site devices use enrolment plus PIN (plan 6.4).

const TOKEN_TTL_MS = 12 * 3_600_000;

function secret(): string {
  const s = process.env.DEV_TOKEN_SECRET;
  if (!s) throw new Error('DEV_TOKEN_SECRET is not set');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issueToken(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: now + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string, now = Date.now()): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string; exp: number };
    return body.exp > now ? body.sub : null;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  userId?: string;
  /** Set when the Agentic Office made this call (P66): who it named and whether a person or an AI acted. */
  office?: OfficeCall;
}

/** Request-local assertion, minted only after Microsoft verification AND Prima identity linking. */
export interface VerifiedEntraAssertion {
  readonly userId: string;
  readonly oid: string;
  readonly tenantId: string;
  readonly accessToken: string;
}
const verifiedEntraAssertions = new WeakMap<object, VerifiedEntraAssertion>();
export function verifiedEntraAssertion(request: object): VerifiedEntraAssertion | null {
  return verifiedEntraAssertions.get(request) ?? null;
}

export function devLoginOn(): boolean {
  return process.env.ALLOW_DEV_LOGIN === 'true';
}

let entra: { cfg: EntraConfig; keys: KeySource } | null | undefined;

/** The Entra settings and Microsoft's key source, read once from the environment. Tests may swap the key source. */
export function entraSetup(keys?: KeySource): { cfg: EntraConfig; keys: KeySource } | null {
  if (entra === undefined || keys) {
    const cfg = entraConfig();
    entra = cfg ? { cfg, keys: keys ?? microsoftKeys(cfg.tenantId) } : null;
  }
  return entra;
}

/** Forget the cached settings (tests change the environment). */
export function resetEntraSetup(): void {
  entra = undefined;
}

/**
 * The Prima staff record a verified Microsoft account is linked to. Linking is by object ID only (User.entraOid,
 * recorded by IT); an unlinked account, a system feed or someone outside the pilot is refused.
 */
export async function userForEntra(db: Db, who: EntraIdentity): Promise<User> {
  const res = await db.pool.query(`SELECT data FROM prima.users WHERE lower(data->>'entraOid') = $1`, [who.oid]);
  if (res.rowCount !== 1) {
    throw new ForbiddenException(
      res.rowCount === 0
        ? `This Microsoft account is not linked to a Prima staff record yet. Ask IT to link account ID ${who.oid}.`
        : 'This Microsoft account is linked to more than one staff record. IT must fix the link before you can sign in.',
    );
  }
  return admitted(res.rows[0].data as User);
}

/** The sign-in rules every way in applies, before anything is shown: no system feed, no closed account, the pilot. */
function admitted(user: User): User {
  if (user.integration) throw new ForbiddenException('A system feed cannot sign in to screens.');
  // Offboarding: a closed account is refused before anything else is checked or shown.
  if (accessClosed(user, dateOf(fromMs(Date.now()))))
    throw new ForbiddenException(`This Prima account was closed from ${user.accessClosedFrom}. If you still work here, ask HR.`);
  if (pilotSignInOnly() && !inPilot(user)) throw new ForbiddenException('You are not part of the pilot yet.');
  if (!leadershipOnboardingPermits(user)) throw new ForbiddenException('Prima is in leadership-only onboarding mode.');
  return user;
}

/**
 * Whether only the pilot group may sign in. PRIMA_SIGNIN_EVERYONE=true (the Agentic Office, P68: everyone opens Prima
 * from their office sign-in) lets every linked staff record in; the pilot's own workflow rules are unchanged.
 */
export function pilotSignInOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return RULES.pilot.value.on && env.PRIMA_SIGNIN_EVERYONE !== 'true';
}

/** The staff record the Agentic Office named on a verified call (office.ts), under the same sign-in rules. */
export async function userForOffice(db: Db, userId: string): Promise<User> {
  const res = await db.pool.query(`SELECT data FROM prima.users WHERE id = $1`, [userId]);
  if (res.rowCount !== 1) throw new ForbiddenException('This office account is linked to a Prima staff record that no longer exists. Ask the office owner to link it again.');
  return admitted(res.rows[0].data as User);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    // Never trust a header/body property or a reused development request as an OBO assertion.
    verifiedEntraAssertions.delete(req);
    delete req.office;
    // The Agentic Office (office.ts): a signed call naming a Microsoft account. Once the headers are present the call
    // must verify; it never falls through to another way in.
    if (isOfficeCall(req.headers as Record<string, unknown>)) {
      const call = verifyOffice(req.headers as Record<string, unknown>, req.method, req.originalUrl, (req as AuthedRequest & { rawBody?: Buffer }).rawBody);
      // A system call (no person) only lists staff for linking (OfficeController), never a screen or a record.
      if (!call || call.via === 'system') throw new UnauthorizedException('Open Prima from the office again.');
      req.userId = (await userForOffice(this.db, call.user)).id;
      req.office = call;
      return true;
    }
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const setup = entraSetup();
    if (setup && token.split('.').length === 3) {
      let who: EntraIdentity;
      try {
        who = await verifyEntraToken(token, setup.cfg, setup.keys);
      } catch (e) {
        if (e instanceof EntraTokenError) throw new UnauthorizedException('Sign in again with Microsoft.');
        // Microsoft's signing keys could not be fetched: a passing outage, not the person's fault.
        console.error(`Microsoft sign-in check failed: ${(e as Error).message}`);
        throw new ServiceUnavailableException('Microsoft sign-in cannot be checked right now. Try again in a minute.');
      }
      req.userId = (await userForEntra(this.db, who)).id;
      verifiedEntraAssertions.set(req, Object.freeze({ userId: req.userId, oid: who.oid, tenantId: who.tid, accessToken: token }));
      return true;
    }
    const userId = token && devLoginOn() ? verifyToken(token) : null;
    if (!userId) throw new UnauthorizedException('Sign in again.');
    if (process.env.LEADERSHIP_ONBOARDING_ONLY === 'true') {
      const user = await this.db.asUser(userId, async (_svc, u) => u);
      if (!leadershipOnboardingPermits(user)) throw new ForbiddenException('Prima is in leadership-only onboarding mode.');
    }
    req.userId = userId;
    return true;
  }
}

export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().userId!;
});

/**
 * The JA Group app feed (Fauzan, 26 Oct 2026). Each call carries the API key, a timestamp and an HMAC-SHA256 signature
 * of "timestamp.body" made with a separate signing secret. Both secrets come from the environment, never from code;
 * calls older than 5 minutes are refused so a captured call cannot be replayed later.
 */
const FEED_SKEW_MS = 5 * 60_000;

function same(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

export function verifyFeed(headers: Record<string, unknown>, rawBody: Buffer | undefined, now = Date.now(), feed: 'JA' | 'DOOR' | 'PLANNER' = 'JA'): boolean {
  const key = process.env[`${feed}_API_KEY`];
  const secret = process.env[`${feed}_SIGNING_SECRET`];
  if (!key || !secret || !rawBody) return false;
  const got = String(headers['x-api-key'] ?? '');
  const ts = String(headers['x-timestamp'] ?? '');
  const sig = String(headers['x-signature'] ?? '');
  const t = Date.parse(ts);
  if (!got || !sig || Number.isNaN(t) || Math.abs(now - t) > FEED_SKEW_MS) return false;
  const want = createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest('hex');
  return same(got, key) && same(sig.toLowerCase(), want);
}

@Injectable()
export class FeedGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    if (!verifyFeed(req.headers as Record<string, unknown>, req.rawBody)) throw new UnauthorizedException('Feed key or signature not valid.');
    return true;
  }
}

/** The office door feed: the same signed calls as the JA feed, with DOOR_API_KEY and DOOR_SIGNING_SECRET from the environment. */
@Injectable()
export class DoorFeedGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    if (!verifyFeed(req.headers as Record<string, unknown>, req.rawBody, Date.now(), 'DOOR'))
      throw new UnauthorizedException('Feed key or signature not valid.');
    return true;
  }
}

/** The Microsoft Planner feed: the same signed calls, with PLANNER_API_KEY and PLANNER_SIGNING_SECRET from the environment. */
@Injectable()
export class PlannerFeedGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    if (!verifyFeed(req.headers as Record<string, unknown>, req.rawBody, Date.now(), 'PLANNER'))
      throw new UnauthorizedException('Feed key or signature not valid.');
    return true;
  }
}

/**
 * The Agentic Office itself (office.ts, via "system"): only for OfficeController, which lists staff records so the
 * office can link its people. A person's or an AI's call is refused here.
 */
@Injectable()
export class OfficeSystemGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const call = verifyOffice(req.headers as Record<string, unknown>, req.method, req.originalUrl, req.rawBody);
    if (!call || call.via !== 'system') throw new UnauthorizedException('Only the Agentic Office may ask this.');
    return true;
  }
}
