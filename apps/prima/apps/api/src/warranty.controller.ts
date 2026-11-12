// J2 Equipment warranty claims (Fauzan, 11 Nov 2026): from an item of the items register, a claim to the supplier,
// tracked to repaired, replaced or refused with proof. Every permission is checked in the core service
// (item-warranty.ts); the table is the separate module item-warranty-v1.sql.
import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { WARRANTY_ACTIONS } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { stepBody } from './p100-input';

@Controller('api/items/warranty')
@UseGuards(AuthGuard)
export class WarrantyController {
  constructor(private readonly db: Db) {}

  /** Warranty claims of the companies whose items this person works, with the next step, and the items a claim can be raised on. */
  @Get()
  @Header('Cache-Control', 'no-store')
  board(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.warranty.board(u));
  }

  /** One step: raise, approve or refuse, sent to the supplier, the supplier's outcome, or close. */
  @Post('act')
  @Header('Cache-Control', 'no-store')
  act(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const { action, body } = stepBody(b, WARRANTY_ACTIONS);
    return this.db.asUser(uid, (svc, u) => svc.warranty.act(u, action, body));
  }
}
