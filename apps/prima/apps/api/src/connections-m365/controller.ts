import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, UserId } from '../auth';
import { Db } from '../db';
import { delegatedActor, noQuery } from '../connections-mail/delegated';
import { M365_CAPABILITIES, M365_CONTROL_OWNERSHIP } from './capabilities';
import { M365Connections } from './service';

function only(body: unknown, keys: string[]): Record<string, unknown> {
  if (body == null) return {};
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k))) throw new BadRequestException('Unsupported input.');
  return body as Record<string, unknown>;
}

/**
 * One Connections entry per person for Outlook, Teams and SharePoint. Reads are the person's own delegated Microsoft
 * identity; nothing here sends mail, posts to Teams, writes to SharePoint, grants consent or applies approvals.
 */
@Controller('api/connections/m365')
@UseGuards(AuthGuard)
export class M365ConnectionsController {
  constructor(private readonly db: Db, private readonly m365: M365Connections) {}

  @Get('status')
  async status(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>) {
    noQuery(q);
    return this.m365.status(await delegatedActor(this.db, uid, req));
  }

  /** The capability and permission matrix and control ownership: public facts about this build, no tenant values. */
  @Get('matrix')
  matrix(@Query() q: Record<string, unknown>) {
    noQuery(q);
    return { capabilities: M365_CAPABILITIES, controlOwnership: M365_CONTROL_OWNERSHIP };
  }

  @Post('teams/link')
  async teamsLink(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q);
    const { url } = only(body, ['url']);
    return this.m365.teamsLink(await delegatedActor(this.db, uid, req), url);
  }

  @Post('sharepoint/link')
  async sharePointLink(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q);
    const { url } = only(body, ['url']);
    return this.m365.sharePointLink(await delegatedActor(this.db, uid, req), url);
  }

  @Post(':service/check')
  async check(@UserId() uid: string, @Req() req: Request, @Param('service') service: string, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q);
    const { resourceKey } = only(body, ['resourceKey']);
    return this.m365.check(await delegatedActor(this.db, uid, req), service, resourceKey);
  }

  @Post(':service/disconnect')
  async disconnect(@UserId() uid: string, @Req() req: Request, @Param('service') service: string, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q);
    only(body, []);
    return this.m365.disconnect(await delegatedActor(this.db, uid, req), service);
  }
}

/** Off by default: every service reports not_configured until M365_CONNECTIONS_ENABLED and its own switches are set. */
export const m365ConnectionsModule = () => ({
  controllers: [M365ConnectionsController],
  providers: [{ provide: M365Connections, useFactory: () => new M365Connections() }],
});
