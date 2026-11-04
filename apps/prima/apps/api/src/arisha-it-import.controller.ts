import { Body, Controller, ConflictException, ForbiddenException, Get, Header, Param, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ReviewConflict, arishaLeader, type PrimaService, type User } from '@prima/core';
import { AuthGuard, verifiedEntraAssertion } from './auth';
import { Db } from './db';

/** The handoff stays off until ARISHA_IT_IMPORT_ENABLED is exactly "true" (default off; Arisha main verifies first). */
export function itImportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ARISHA_IT_IMPORT_ENABLED === 'true';
}

/**
 * Arisha's reviewed handoff into the T9 IT import (Fauzan, 31 Oct 2026; docs/ARISHA_T9_HANDOFF_PROPOSAL.md). Every
 * route needs a real Microsoft sign-in whose object ID is the one linked to the CEO's own account: a development token
 * never qualifies, whatever ALLOW_DEV_LOGIN says. The core service checks the CEO again on every call, and the database
 * a third time. The only write to IT records is still the T9 approval. While the switch is off every review route
 * answers 503 and nothing is read or written; the status route says whether the screen can be offered.
 */
@Controller('api/arisha/it-import')
@UseGuards(AuthGuard)
export class ItImportReviewController {
  constructor(private readonly db: Db) {}

  private signedIn<R>(req: object, fn: (svc: PrimaService, user: User) => Promise<R>): Promise<R> {
    const assertion = verifiedEntraAssertion(req);
    if (!assertion) throw new ForbiddenException('Sign in with Microsoft to import IT work.');
    return this.db.asUser(assertion.userId, async (svc, user) => {
      if (typeof user.entraOid !== 'string' || user.entraOid.toLowerCase() !== assertion.oid.toLowerCase())
        throw new ForbiddenException('Sign in with Microsoft to import IT work.');
      return fn(svc, user);
    });
  }

  private run<R>(req: object, fn: (svc: PrimaService, user: User) => Promise<R>): Promise<R> {
    if (!itImportEnabled()) throw new ServiceUnavailableException('Batch import from Arisha is not switched on.');
    return this.signedIn(req, async (svc, user) => {
      const problems = await svc.itImportReviews.problems();
      if (problems.length) throw new ServiceUnavailableException('Batch import from Arisha is not ready in the database.');
      return fn(svc, user);
    }).catch((e) => {
      if (e instanceof ReviewConflict) throw new ConflictException(e.message);
      throw e;
    });
  }

  /**
   * Whether the switch is on, whether the database has the ledger with its protections and the app role's rights, and
   * whether this signed-in account may use the handoff (the CEO only). Never a 503. Only the CEO sees the problems.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  status(@Req() req: object) {
    const enabled = itImportEnabled();
    return this.signedIn(req, async (svc, user) => {
      const ceo = arishaLeader(user) === 'ceo';
      const problems = ceo ? await svc.itImportReviews.problems() : [];
      return { enabled, ready: enabled && ceo && problems.length === 0, ...(ceo ? { problems } : {}) };
    });
  }

  @Post('reviews')
  @Header('Cache-Control', 'no-store')
  create(@Req() req: object, @Body() body: unknown) {
    return this.run(req, (svc, user) => svc.itImportReviews.create(user, body));
  }

  @Get('reviews/:id')
  @Header('Cache-Control', 'no-store')
  get(@Req() req: object, @Param('id') id: string) {
    return this.run(req, (svc, user) => svc.itImportReviews.get(user, id));
  }

  @Post('reviews/:id')
  @Header('Cache-Control', 'no-store')
  update(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    return this.run(req, (svc, user) => svc.itImportReviews.update(user, id, body));
  }

  @Post('reviews/:id/refresh')
  @Header('Cache-Control', 'no-store')
  refresh(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    return this.run(req, (svc, user) => svc.itImportReviews.refresh(user, id, body));
  }

  @Post('reviews/:id/approve')
  @Header('Cache-Control', 'no-store')
  approve(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    return this.run(req, (svc, user) => svc.itImportReviews.approve(user, id, body));
  }

  @Post('reviews/:id/abandon')
  @Header('Cache-Control', 'no-store')
  abandon(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    return this.run(req, (svc, user) => svc.itImportReviews.abandon(user, id, body));
  }
}
