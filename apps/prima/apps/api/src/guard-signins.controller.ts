// J5 (P100, Fauzan 11 Nov 2026): guard sign-ins in bulk with a review step (packages/core/src/guard-signins.ts). Every
// route runs as the signed-in person (Db.asUser); the sign-ins themselves are made by the database's own function
// (db/modules/guard-signins-v1.sql) at the approval. The guard phone stays switched off.
import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';

const str = (v: unknown, name: string, max: number): string => {
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${name} is missing or too long`);
  return v;
};
const rid = (v: unknown, name = 'id'): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(v)) throw new BadRequestException(`${name} is not valid`);
  return v;
};

@Controller('api')
@UseGuards(AuthGuard)
export class GuardSignInsController {
  constructor(private db: Db) {}

  @Get('guard-signins')
  board(@UserId() uid: string, @Query('companyId') companyId?: string) {
    return this.db.asUser(uid, (svc, u) => svc.guardSignInBoard(u, companyId ? rid(companyId, 'companyId') : undefined));
  }

  @Post('guard-signins')
  prepare(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.personIds) || b.personIds.length > 500) throw new BadRequestException('personIds must be a list of up to 500');
    const ids = (b.personIds as unknown[]).map((x) => rid(x, 'personId'));
    return this.db.asUser(uid, (svc, u) => svc.prepareGuardSignIns(u, rid(b.companyId, 'companyId'), ids, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('guard-signins/:id/decide')
  decide(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.decideGuardSignIns(u, rid(id), b.approve as boolean, str(b.note ?? '', 'note', 500)));
  }

  @Post('guard-signins/:id/cancel')
  cancel(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.cancelGuardSignIns(u, rid(id), str(b.reason ?? '', 'reason', 300)));
  }
}
