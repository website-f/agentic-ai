import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, UserId } from '../auth';
import { delegatedActor, noBody, noQuery } from '../connections-mail/delegated';
import { Db } from '../db';
import { PowerBiReports } from './power-bi';

@Controller('api/connections/powerbi')
@UseGuards(AuthGuard)
export class PowerBiConnectionsController {
  constructor(private readonly db: Db, private readonly powerBi: PowerBiReports) {}

  @Get()
  async status(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>) {
    noQuery(q); return this.powerBi.status(await delegatedActor(this.db, uid, req));
  }
  @Post(':reportKey/check')
  async check(@UserId() uid: string, @Req() req: Request, @Param('reportKey') key: string, @Query() q: Record<string, unknown>, @Body() body?: unknown) {
    noQuery(q); noBody(body); return this.powerBi.check(await delegatedActor(this.db, uid, req), key);
  }
  @Post(':reportKey/embed')
  async embed(@UserId() uid: string, @Req() req: Request, @Param('reportKey') key: string, @Query() q: Record<string, unknown>, @Body() body?: unknown) {
    noQuery(q); noBody(body); return this.powerBi.embed(await delegatedActor(this.db, uid, req), key);
  }
}

/** Registration for the Connections owner (not applied here). */
export const powerBiConnectionsModule = () => ({
  controllers: [PowerBiConnectionsController],
  providers: [{ provide: PowerBiReports, useFactory: () => new PowerBiReports() }],
});
