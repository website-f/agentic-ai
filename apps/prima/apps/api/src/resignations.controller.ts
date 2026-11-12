// E10 Staff resignation (Fauzan, 11 Nov 2026): the staff member's notice, HR's acceptance with the confirmed last day,
// and the HR Director's decision on a shorter notice. Every permission is checked in the core service
// (hr-resignation.ts); the table is the separate module hr-resignations-v1.sql.
import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { RESIGN_ACTIONS } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { stepBody } from './p100-input';

@Controller('api/resignations')
@UseGuards(AuthGuard)
export class ResignationsController {
  constructor(private readonly db: Db) {}

  /** The signed-in staff member's own resignation, the notice if they resigned today, and the procedure in both languages. */
  @Get('mine')
  @Header('Cache-Control', 'no-store')
  mine(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.resignations.mine(u));
  }

  /** HR's list of resignations with the next step for this person. */
  @Get()
  @Header('Cache-Control', 'no-store')
  board(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.resignations.board(u));
  }

  /** One step: give notice (or HR enters the signed letter), withdraw, accept with the last day, or decide a shorter notice. */
  @Post('act')
  @Header('Cache-Control', 'no-store')
  act(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const { action, body } = stepBody(b, RESIGN_ACTIONS);
    return this.db.asUser(uid, (svc, u) => svc.resignations.act(u, action, body));
  }
}
