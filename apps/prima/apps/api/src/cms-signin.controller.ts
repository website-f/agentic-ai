// E7 (P100, Fauzan 11 Nov 2026: "CMS operator Microsoft sign-in: BUILD"). CMS operators sign in to Prima the way
// everyone does (Microsoft, or the Agentic Office that opens Prima) and open the CMS console from here. Prima decides who
// may (packages/core/src/cms-console.ts) and gives the browser a one-time ticket, signed with CMS_SIGNIN_SECRET (the same
// secret the CMS holds), valid 60 seconds; the browser carries it to the CMS after "#ticket=" (never in a query string,
// so it is not in any server log), and the CMS keeps its own session (apps/cms/src/signin.ts). Off until both CMS_URL
// and CMS_SIGNIN_SECRET are set: no ticket is ever made without them.
import { createHmac, randomBytes } from 'node:crypto';
import { Controller, Get, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { AuthGuard, UserId, verifiedEntraAssertion, type AuthedRequest } from './auth';
import { Db } from './db';

export const CMS_TICKET_PREFIX = 'cmst1.';
export const CMS_TICKET_LIFE_S = 60;

export interface CmsTicketClaims {
  v: 1;
  sub: string;
  name: string;
  posts: string[];
  via: 'microsoft' | 'office' | 'dev';
  iat: number;
  exp: number;
  n: string;
}

/** The same format the CMS checks (apps/cms/src/signin.ts signTicket/verifyTicket); a shared test vector keeps them equal. */
export function signCmsTicket(claims: CmsTicketClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${CMS_TICKET_PREFIX}${payload}.${createHmac('sha256', secret).update(`cms-signin.${payload}`).digest('base64url')}`;
}

/** The CMS address and the shared secret, or null when the CMS sign-in is not set up. */
export function cmsSignInSetup(env: NodeJS.ProcessEnv = process.env): { url: string; secret: string } | null {
  const url = (env.CMS_URL ?? '').trim().replace(/\/+$/, '');
  const secret = env.CMS_SIGNIN_SECRET ?? '';
  if (!url || secret.length < 32) return null;
  if (!/^https:\/\//.test(url) && env.NODE_ENV === 'production') return null;
  return { url, secret };
}

/** How this request signed in to Prima: the office, Microsoft, or (development only) the dev token. */
export function signedInVia(req: AuthedRequest): CmsTicketClaims['via'] {
  if (req.office) return 'office';
  if (verifiedEntraAssertion(req)) return 'microsoft';
  return 'dev';
}

@Controller('api')
@UseGuards(AuthGuard)
export class CmsSignInController {
  constructor(private db: Db) {}

  /** Whether the CMS console can be opened from here (no secret, no address beyond the CMS's own). */
  @Get('cms/console')
  async status(@UserId() uid: string) {
    const setup = cmsSignInSetup();
    const may = await this.db.asUser(uid, (svc, u) => svc.cmsConsoleMay(u));
    return { on: !!setup, url: setup?.url ?? null, may };
  }

  /** A one-time ticket for the CMS console, for a person Prima allows (roster staff or Arms Control). */
  @Post('cms/console/sign-in')
  async signIn(@UserId() uid: string, @Req() req: AuthedRequest) {
    const setup = cmsSignInSetup();
    if (!setup) throw new ServiceUnavailableException('CMS sign-in is not set up yet (CMS_URL and CMS_SIGNIN_SECRET).');
    if (req.guardSessionId) throw new ServiceUnavailableException('The CMS console is not opened from a guard phone.');
    const via = signedInVia(req);
    const person = await this.db.asUser(uid, (svc, u) => svc.cmsConsoleSignIn(u, via));
    const iat = Math.floor(Date.now() / 1000);
    const ticket = signCmsTicket({ v: 1, sub: person.sub, name: person.name, posts: person.posts, via, iat, exp: iat + CMS_TICKET_LIFE_S, n: randomBytes(18).toString('base64url') }, setup.secret);
    return { url: `${setup.url}/#ticket=${ticket}`, expiresInS: CMS_TICKET_LIFE_S, name: person.name };
  }
}
