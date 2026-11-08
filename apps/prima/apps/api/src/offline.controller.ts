import { Body, Controller, ForbiddenException, Get, Header, Param, Post, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { OfflineSyncService, User } from '@prima/core';
import { AuthGuard, verifiedEntraAssertion } from './auth';
import { Db } from './db';

/** Off until OFFLINE_SYNC_ENABLED is exactly "true"; even then only for the user IDs in OFFLINE_SYNC_USERS. */
export function offlineConfig(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; users: string[] } {
  const users = (env.OFFLINE_SYNC_USERS ?? '').split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9-]{2,40}$/.test(s));
  return { enabled: env.OFFLINE_SYNC_ENABLED === 'true', users };
}

/**
 * Offline work (Fauzan, 31 Oct 2026; docs/OFFLINE_SYNC.md). Every route needs a current Microsoft sign-in whose object ID
 * is the one linked to the account: the sign-in at sync is what proves who is sending, never the device. Nothing here
 * replays any other route: only the two offline operations exist.
 */
@Controller('api/offline')
@UseGuards(AuthGuard)
export class OfflineController {
  constructor(private readonly db: Db) {}

  private run<R>(req: object, fn: (offline: OfflineSyncService, user: User) => Promise<R>): Promise<R> {
    const cfg = offlineConfig();
    if (!cfg.enabled) throw new ServiceUnavailableException('Offline work is not switched on.');
    const assertion = verifiedEntraAssertion(req);
    if (!assertion) throw new ForbiddenException('Sign in with Microsoft to sync offline work.');
    return this.db.asUser(assertion.userId, async (svc, user) => {
      if (typeof user.entraOid !== 'string' || user.entraOid.toLowerCase() !== assertion.oid.toLowerCase())
        throw new ForbiddenException('Sign in with Microsoft to sync offline work.');
      return fn(svc.offlineSync(cfg.users), user);
    });
  }

  @Post('lease')
  @Header('Cache-Control', 'no-store')
  lease(@Req() req: object, @Body() body: unknown) {
    return this.run(req, (o, u) => o.lease(u, body));
  }

  @Post('ops')
  @Header('Cache-Control', 'no-store')
  sync(@Req() req: object, @Body() body: unknown) {
    return this.run(req, (o, u) => o.sync(u, body));
  }

  /** Receipts: ?opIds=a,b (settle a lost answer before sending again) or ?since=<time>. */
  @Get('ops')
  @Header('Cache-Control', 'no-store')
  receipts(@Req() req: object, @Query('opIds') opIds?: string, @Query('since') since?: string) {
    const ids = opIds ? opIds.split(',').slice(0, 50) : undefined;
    return this.run(req, (o, u) => o.receipts(u, { opIds: ids, since }));
  }

  @Post('ops/:opId/resolve')
  @Header('Cache-Control', 'no-store')
  resolve(@Req() req: object, @Param('opId') opId: string, @Body() body: unknown) {
    return this.run(req, (o, u) => o.resolve(u, opId, body));
  }
}
