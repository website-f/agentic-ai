// E9 PIKM records (Fauzan, 11 Nov 2026): the yearly medical for guards 56 and over, the site risk briefing before
// deployment, personnel files kept 7 years, the client information pack, and office alarm and CCTV records. Every
// permission is checked in the core service (quality-pikm.ts); the table is the separate module quality-pikm-v1.sql.
import { BadRequestException, Body, Controller, Get, Header, Post, Query, UseGuards } from '@nestjs/common';
import { PIKM_ACTIONS } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { stepBody } from './p100-input';

@Controller('api/pikm')
@UseGuards(AuthGuard)
export class PikmController {
  constructor(private readonly db: Db) {}

  /** The PIKM records this person works, with what is due: medicals, briefings, files kept, client packs, alarm and CCTV. */
  @Get()
  @Header('Cache-Control', 'no-store')
  board(@UserId() uid: string, @Query('companyId') companyId?: string) {
    if (companyId !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(companyId)) throw new BadRequestException('companyId is not valid');
    return this.db.asUser(uid, (svc, u) => svc.pikm.board(u, { companyId }));
  }

  /** One PIKM step: record, check, propose, decide, prepare, send or record a service visit. */
  @Post('act')
  @Header('Cache-Control', 'no-store')
  act(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const { action, body } = stepBody(b, PIKM_ACTIONS);
    return this.db.asUser(uid, (svc, u) => svc.pikm.act(u, action, body));
  }
}
