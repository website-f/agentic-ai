// E8 Foreign workers (Fauzan, 11 Nov 2026): who lives in each hostel, the check-out memo, and the permit task while a
// worker is on long SOCSO MC. Every permission is checked in the core service (fw-extras.ts).
import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { FW_EXTRA_ACTIONS } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { stepBody } from './p100-input';

@Controller('api/fw-extras')
@UseGuards(AuthGuard)
export class FwExtrasController {
  constructor(private readonly db: Db) {}

  /** Each hostel with who lives there now, free beds, and the check-out memos with their step. */
  @Get('hostel-stays')
  @Header('Cache-Control', 'no-store')
  hostelStays(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.fwExtras.staysBoard(u));
  }

  /** Foreign workers on long SOCSO MC whose permit comes due before the MC ends, and whether FWM sent the task. */
  @Get('permits-on-mc')
  @Header('Cache-Control', 'no-store')
  permitsOnMc(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.fwExtras.permitsBoard(u));
  }

  /** One step: check a worker in, prepare or decide a check-out memo, or send the permit task during SOCSO MC. */
  @Post('act')
  @Header('Cache-Control', 'no-store')
  act(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const { action, body } = stepBody(b, FW_EXTRA_ACTIONS);
    return this.db.asUser(uid, (svc, u) => svc.fwExtras.act(u, action, body));
  }
}
