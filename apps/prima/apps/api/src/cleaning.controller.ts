// Cleaning operations, site fittings, Inventory's site board and guard/officer duty plans (Fauzan, 4 Nov 2026).
// Every permission is checked in the core service; this layer only shapes and bounds the input.

import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { CleaningProofInput, CleaningSetupInput } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function id(v: unknown, name: string): string {
  if (typeof v !== 'string' || !ID.test(v)) throw new BadRequestException(`${name} is not valid`);
  return v;
}
function date(v: unknown, name = 'date'): string {
  if (typeof v !== 'string' || !DATE.test(v)) throw new BadRequestException(`${name} must be YYYY-MM-DD`);
  return v;
}
function optDate(v: unknown): string | undefined {
  return v === undefined || v === '' ? undefined : date(v);
}
function note(v: unknown): string {
  if (v == null) return '';
  if (typeof v !== 'string' || v.length > 1000) throw new BadRequestException('note is too long');
  return v;
}
function version(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new BadRequestException('expectedVersion is not valid');
  return v;
}
/** A time-marked photo: the image and the time printed on it. */
function proof(v: unknown): CleaningProofInput | null {
  if (v == null) return null;
  const p = v as Record<string, unknown>;
  if (typeof p.image !== 'string' || p.image.length > 1_000_000) throw new BadRequestException('proof.image must be a photo (under 700 KB)');
  if (typeof p.stampedAt !== 'string' || p.stampedAt.length > 20) throw new BadRequestException('proof.stampedAt is the time printed on the photo');
  return { image: p.image, stampedAt: p.stampedAt, caption: typeof p.caption === 'string' ? p.caption.slice(0, 200) : undefined };
}
function lines(v: unknown, max = 200): unknown[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) throw new BadRequestException('lines are not valid');
  return v;
}

@UseGuards(AuthGuard)
@Controller('api')
export class CleaningController {
  constructor(private db: Db) {}

  @Get('cleaning/board')
  board(@UserId() uid: string, @Query('date') d?: string) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.board(u, optDate(d)));
  }

  @Get('cleaning/sites/:siteId')
  site(@UserId() uid: string, @Param('siteId') siteId: string, @Query('date') d?: string) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.site(u, id(siteId, 'siteId'), optDate(d)));
  }

  @Get('cleaning/sites/:siteId/proof/:docId')
  proof(@UserId() uid: string, @Param('siteId') siteId: string, @Param('docId') docId: string) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.proof(u, id(siteId, 'siteId'), id(docId, 'docId')));
  }

  @Put('cleaning/sites/:siteId/setup')
  saveSetup(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    if (typeof b.setup !== 'object' || b.setup === null) throw new BadRequestException('setup is missing');
    return this.db.asUser(uid, (svc, u) => svc.cleaning.saveSetup(u, id(siteId, 'siteId'), b.setup as CleaningSetupInput, version(b.expectedVersion)));
  }

  @Post('cleaning/sites/:siteId/map')
  setMap(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    if (typeof b.data !== 'string' || b.data.length > 2_800_000) throw new BadRequestException('data must be the map file (under 2 MB)');
    const v = version(b.expectedVersion);
    if (v === null) throw new BadRequestException('expectedVersion is missing');
    return this.db.asUser(uid, (svc, u) => svc.cleaning.setMap(u, id(siteId, 'siteId'), { name: typeof b.name === 'string' ? b.name.slice(0, 120) : '', data: b.data as string }, v));
  }

  @Post('cleaning/sites/:siteId/days/:date/plan')
  plan(@UserId() uid: string, @Param('siteId') siteId: string, @Param('date') d: string, @Body() b: Record<string, unknown>) {
    const absent = lines(b.absentIds, 200).map((x) => id(x, 'absentIds'));
    return this.db.asUser(uid, (svc, u) => svc.cleaning.makePlan(u, id(siteId, 'siteId'), date(d), absent));
  }

  @Post('cleaning/sites/:siteId/days/:date/publish')
  publish(@UserId() uid: string, @Param('siteId') siteId: string, @Param('date') d: string) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.publish(u, id(siteId, 'siteId'), date(d)));
  }

  @Post('cleaning/sites/:siteId/days/:date/record')
  record(@UserId() uid: string, @Param('siteId') siteId: string, @Param('date') d: string, @Body() b: Record<string, unknown>) {
    const taskIds = lines(b.taskIds, 30).map((x) => id(x, 'taskIds'));
    if (b.action !== 'done' && b.action !== 'checked' && b.action !== 'redo' && b.action !== 'missed' && b.action !== 'not_needed') throw new BadRequestException('action is not valid');
    const action: 'done' | 'checked' | 'redo' | 'missed' | 'not_needed' = b.action;
    let expectedStatuses: Record<string, 'planned' | 'done' | 'checked' | 'redo' | 'missed' | 'not_needed'> | undefined;
    if (b.expectedStatuses != null) {
      if (typeof b.expectedStatuses !== 'object') throw new BadRequestException('expectedStatuses is not valid');
      expectedStatuses = {};
      for (const [k, v] of Object.entries(b.expectedStatuses as Record<string, unknown>).slice(0, 30)) {
        if (v !== 'planned' && v !== 'done' && v !== 'checked' && v !== 'redo' && v !== 'missed' && v !== 'not_needed') throw new BadRequestException('expectedStatuses is not valid');
        expectedStatuses[id(k, 'task id')] = v;
      }
    }
    return this.db.asUser(uid, (svc, u) => svc.cleaning.recordTasks(u, id(siteId, 'siteId'), date(d), { taskIds, action, note: note(b.note), proof: proof(b.proof), expectedStatuses }));
  }

  @Post('cleaning/sites/:siteId/deliveries')
  delivery(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.recordDelivery(u, id(siteId, 'siteId'), { date: date(b.date), supplies: lines(b.supplies), equipment: lines(b.equipment), note: note(b.note) }));
  }

  @Post('cleaning/sites/:siteId/deliveries/:entryId/receive')
  receive(@UserId() uid: string, @Param('siteId') siteId: string, @Param('entryId') entryId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.cleaning.receiveDelivery(u, id(siteId, 'siteId'), id(entryId, 'entryId'), { supplies: lines(b.supplies), equipment: lines(b.equipment), note: note(b.note), proof: proof(b.proof)! }),
    );
  }

  @Post('cleaning/sites/:siteId/stock-checks')
  stockCheck(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.cleaning.stockCheck(u, id(siteId, 'siteId'), { date: date(b.date), supplies: lines(b.supplies), equipment: lines(b.equipment), note: note(b.note), proof: proof(b.proof)! }),
    );
  }

  @Post('cleaning/sites/:siteId/client-slips')
  clientSlip(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    const slip = (b.slip ?? {}) as Record<string, unknown>;
    if (typeof slip.data !== 'string' || slip.data.length > 2_800_000) throw new BadRequestException('slip must be the scanned slip (under 2 MB)');
    const outcome = b.outcome === 'accepted' || b.outcome === 'not_accepted' ? b.outcome : null;
    if (!outcome) throw new BadRequestException('outcome must be accepted or not_accepted');
    const areaIds = lines(b.areaIds, 30).map((x) => id(x, 'areaId'));
    const s = (v: unknown, n: string, max: number) => {
      if (v == null) return '';
      if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${n} is too long`);
      return v;
    };
    return this.db.asUser(uid, (svc, u) =>
      svc.cleaning.recordClientAck(u, id(siteId, 'siteId'), {
        signedOn: date(b.signedOn, 'signedOn'),
        from: date(b.from, 'from'),
        to: date(b.to, 'to'),
        areaIds,
        signer: s(b.signer, 'signer', 120),
        outcome,
        comment: s(b.comment, 'comment', 1000),
        action: s(b.action, 'action', 500),
        slip: { name: s(slip.name, 'slip.name', 120), data: slip.data as string },
      }),
    );
  }

  @Get('cleaning/sites/:siteId/monthly')
  monthly(@UserId() uid: string, @Param('siteId') siteId: string, @Query('month') month: string) {
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
    return this.db.asUser(uid, (svc, u) => svc.cleaning.monthly(u, id(siteId, 'siteId'), month));
  }

  @Get('inventory/sites')
  inventory(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.inventoryBoard(u));
  }

  @Get('sites/:siteId/kit')
  kit(@UserId() uid: string, @Param('siteId') siteId: string) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.siteKit(u, id(siteId, 'siteId')));
  }

  @Put('sites/:siteId/kit')
  saveKit(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.saveSiteKit(u, id(siteId, 'siteId'), lines(b.items, 100), version(b.expectedVersion)));
  }

  @Post('sites/:siteId/kit/records')
  kitRecord(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    if (b.kind !== 'install' && b.kind !== 'check') throw new BadRequestException('kind is not valid');
    const kind: 'install' | 'check' = b.kind;
    const v = version(b.expectedVersion);
    if (v === null) throw new BadRequestException('expectedVersion is missing');
    return this.db.asUser(uid, (svc, u) => svc.cleaning.recordSiteKit(u, id(siteId, 'siteId'), { kind, date: date(b.date), lines: lines(b.lines, 100), note: note(b.note), proof: proof(b.proof)! }, v));
  }

  @Post('sites/:siteId/kit/gifts')
  gift(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    if (typeof b.ref !== 'string' || !/^(kit|clean):[a-z0-9-]{1,40}$/.test(b.ref)) throw new BadRequestException('ref is not valid');
    const ref: string = b.ref;
    return this.db.asUser(uid, (svc, u) => svc.cleaning.approveGift(u, id(siteId, 'siteId'), { ref, qty: Number(b.qty), reason: note(b.reason) }));
  }

  @Get('sites/:siteId/close-out')
  closeOut(@UserId() uid: string, @Param('siteId') siteId: string) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.closeOutList(u, id(siteId, 'siteId')));
  }

  @Post('sites/:siteId/close-out')
  takeBack(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.cleaning.recordTakeBack(u, id(siteId, 'siteId'), { date: date(b.date), lines: lines(b.lines, 200), note: note(b.note), proof: proof(b.proof)! }));
  }

  @Get('duty/sites/:siteId')
  duty(@UserId() uid: string, @Param('siteId') siteId: string, @Query('date') d: string) {
    return this.db.asUser(uid, (svc, u) => svc.duty.posts(u, id(siteId, 'siteId'), date(d)));
  }

  @Post('duty/sites/:siteId/publish')
  publishDuty(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.duty.publishPosts(u, id(siteId, 'siteId'), date(b.date)));
  }

  @Put('duty/sites/:siteId/terms')
  dutyTerms(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    if (typeof b.terms !== 'object' || b.terms === null) throw new BadRequestException('terms is missing');
    return this.db.asUser(uid, (svc, u) => svc.duty.saveTerms(u, id(siteId, 'siteId'), b.terms, version(b.expectedVersion)));
  }

  @Get('duty/officers')
  officers(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.duty.officers(u));
  }

  @Get('duty/officers/:officerId')
  route(@UserId() uid: string, @Param('officerId') officerId: string, @Query('date') d: string, @Query('start') start?: string, @Query('end') end?: string, @Query('meal') meal?: string) {
    // The OM's hours for the officer (flexible, day or night); checked in the core service.
    const hours = start || end ? { start, end, mealMin: meal === undefined || meal === '' ? 60 : Number(meal) } : undefined;
    return this.db.asUser(uid, (svc, u) => svc.duty.route(u, id(officerId, 'officerId'), date(d), hours));
  }

  @Post('duty/officers/:officerId/publish')
  publishRoute(@UserId() uid: string, @Param('officerId') officerId: string, @Body() b: Record<string, unknown>) {
    const expect = b.expectPublishedAt == null ? null : typeof b.expectPublishedAt === 'string' && b.expectPublishedAt.length <= 40 ? b.expectPublishedAt : null;
    return this.db.asUser(uid, (svc, u) => svc.duty.publishRoute(u, id(officerId, 'officerId'), date(b.date), expect, b.hours ?? null));
  }
}
