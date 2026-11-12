// E4 SOCSO extras (Fauzan, 11 Nov 2026): the LINDUNG claim form, the company's payments to dependants abroad, and the
// SOCSO and DOSH reminders. Every permission is checked in the core service (socso-extras.ts).
import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { SOCSO_EXTRA_ACTIONS } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { stepBody } from './p100-input';

@Controller('api/socso-extras')
@UseGuards(AuthGuard)
export class SocsoExtrasController {
  constructor(private readonly db: Db) {}

  /** Payments to dependants abroad for the Finance Director, the CEO and Finance: who, how much, why and the next step. */
  @Get('payments-abroad')
  @Header('Cache-Control', 'no-store')
  paymentsAbroad(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.socsoExtras.board(u));
  }

  /** One step on a SOCSO claim: prepare or check the LINDUNG form; raise, decide, pay or confirm a payment abroad. */
  @Post('act')
  @Header('Cache-Control', 'no-store')
  act(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const { action, body } = stepBody(b, SOCSO_EXTRA_ACTIONS);
    return this.db.asUser(uid, (svc, u) => svc.socsoExtras.act(u, action, body));
  }
}
