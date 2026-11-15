// Guard roster engine screens (Part O, Fauzan 13-14 Nov 2026). Every permission is checked in the core service (who
// prepares, verifies, publishes, decides, approves and signs); this layer only shapes and bounds the input. The
// database part (db/modules/guard-roster-v1.sql) is not installed until the CEO says; until then each call answers
// that the guard roster is not installed.

import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { RosterStatus } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';

const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['WORK_D', 'WORK_N', 'OFF_REST', 'OFF_ADD', 'AL', 'MC', 'HOSP', 'PH', 'UPL', 'ABS', 'RELIEF_D', 'RELIEF_N', 'TRF', 'END', 'PENDING']);

function id(v: unknown, name: string): string {
  if (typeof v !== 'string' || !ID.test(v)) throw new BadRequestException(`${name} is not valid`);
  return v;
}
function month(v: unknown): string {
  if (typeof v !== 'string' || !MONTH.test(v)) throw new BadRequestException('month must be YYYY-MM');
  return v;
}
function text(v: unknown, name: string, max = 500): string {
  if (v == null) return '';
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${name} is too long`);
  return v;
}
function status(v: unknown): RosterStatus {
  if (typeof v !== 'string' || !STATUSES.has(v)) throw new BadRequestException('status is not a roster status');
  return v as RosterStatus;
}
function time(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length > 40 || Number.isNaN(Date.parse(v))) throw new BadRequestException(`${name} must be a date and time`);
  return v;
}
function optTime(v: unknown, name: string): string | null {
  return v == null || v === '' ? null : time(v, name);
}
function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BadRequestException(`${name} is missing`);
  return v as Record<string, unknown>;
}

@UseGuards(AuthGuard)
@Controller('api')
export class RosterController {
  constructor(private db: Db) {}

  @Get('roster/sites/:siteId')
  board(@UserId() uid: string, @Param('siteId') siteId: string, @Query('month') m?: string) {
    return this.db.asUser(uid, (svc, u) => svc.rosterBoard(u, id(siteId, 'siteId'), month(m)));
  }

  @Put('roster/sites/:siteId/coverage')
  coverage(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    if (JSON.stringify(b ?? {}).length > 40_000) throw new BadRequestException('coverage is too long');
    return this.db.asUser(uid, (svc, u) => svc.saveSiteCoverage(u, id(siteId, 'siteId'), obj(b, 'coverage') as never));
  }

  @Put('roster/sites/:siteId/months/:month')
  draft(@UserId() uid: string, @Param('siteId') siteId: string, @Param('month') m: string, @Body() b: { days?: unknown; changeReason?: unknown }) {
    if (!Array.isArray(b.days) || b.days.length > 3000) throw new BadRequestException('days must be a list (at most 3000 lines)');
    const days = b.days.map((x, i) => {
      const d = obj(x, `days[${i}]`);
      if (typeof d.date !== 'string' || !DATE.test(d.date)) throw new BadRequestException(`days[${i}].date must be YYYY-MM-DD`);
      return {
        personId: id(d.personId, `days[${i}].personId`),
        postId: d.postId == null ? null : id(d.postId, `days[${i}].postId`),
        date: d.date,
        planned: status(d.planned),
        plannedStart: optTime(d.plannedStart, `days[${i}].plannedStart`),
        plannedEnd: optTime(d.plannedEnd, `days[${i}].plannedEnd`),
      };
    });
    return this.db.asUser(uid, (svc, u) => svc.saveRosterDraft(u, id(siteId, 'siteId'), month(m), { days, changeReason: text(b.changeReason, 'changeReason') }));
  }

  @Post('roster/versions/:id/step')
  step(@UserId() uid: string, @Param('id') vid: string, @Body() b: { action?: unknown; reason?: unknown }) {
    const action = b.action;
    if (action !== 'submit' && action !== 'verify' && action !== 'publish' && action !== 'return') throw new BadRequestException('action must be submit, verify, publish or return');
    return this.db.asUser(uid, (svc, u) => svc.rosterStep(u, id(vid, 'id'), action, text(b.reason, 'reason')));
  }

  @Post('roster/days/:id/actual')
  actual(@UserId() uid: string, @Param('id') did: string, @Body() b: { status?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.recordRosterActual(u, id(did, 'id'), status(b.status)));
  }

  @Post('roster/days/:id/correction')
  correction(@UserId() uid: string, @Param('id') did: string, @Body() b: { to?: unknown; evidence?: unknown; reason?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.proposeRosterCorrection(u, id(did, 'id'), { to: status(b.to), evidence: text(b.evidence, 'evidence', 200), reason: text(b.reason, 'reason') }));
  }

  @Post('roster/days/:id/correction/decide')
  decideCorrection(@UserId() uid: string, @Param('id') did: string, @Body() b: { approve?: unknown; reason?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.decideRosterCorrection(u, id(did, 'id'), b.approve === true, text(b.reason, 'reason')));
  }

  @Post('roster/days/:id/absence')
  absence(@UserId() uid: string, @Param('id') did: string, @Body() b: { unpaid?: unknown; reason?: unknown }) {
    if (typeof b.unpaid !== 'boolean') throw new BadRequestException('unpaid must be true or false');
    const unpaid = b.unpaid;
    return this.db.asUser(uid, (svc, u) => svc.decideRosterAbsence(u, id(did, 'id'), unpaid, text(b.reason, 'reason')));
  }

  @Post('roster/days/:id/breaks')
  addBreak(@UserId() uid: string, @Param('id') did: string, @Body() b: Record<string, unknown>) {
    const minutes = b.interruptedMinutes == null ? 0 : Number(b.interruptedMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 720) throw new BadRequestException('interruptedMinutes is not valid');
    return this.db.asUser(uid, (svc, u) =>
      svc.recordRosterBreak(u, id(did, 'id'), { slot: text(b.slot, 'slot', 10), start: time(b.start, 'start'), end: time(b.end, 'end'), relieved: b.relieved === true, interruptedMinutes: minutes, confirm: b.confirm === true }),
    );
  }

  @Post('roster/breaks/:id/confirm')
  confirmBreak(@UserId() uid: string, @Param('id') bid: string) {
    return this.db.asUser(uid, (svc, u) => svc.confirmRosterBreak(u, id(bid, 'id')));
  }

  @Post('roster/sites/:siteId/evidence')
  evidence(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    const personIds = b.personIds == null ? [] : Array.isArray(b.personIds) && b.personIds.length <= 200 ? b.personIds.map((p, i) => id(p, `personIds[${i}]`)) : (() => { throw new BadRequestException('personIds is not valid'); })();
    return this.db.asUser(uid, (svc, u) =>
      svc.recordRosterEvidence(u, id(siteId, 'siteId'), { rule: text(b.rule, 'rule', 40) as never, kind: text(b.kind, 'kind', 40) as never, documentRef: text(b.documentRef, 'documentRef', 200), personIds, from: text(b.from, 'from', 10), to: text(b.to, 'to', 10), conditions: text(b.conditions, 'conditions') }),
    );
  }

  @Post('roster/evidence/:id/check')
  checkEvidence(@UserId() uid: string, @Param('id') eid: string, @Body() b: { result?: unknown; note?: unknown }) {
    const result = b.result;
    if (result !== 'ok' && result !== 'query') throw new BadRequestException('result must be ok or query');
    return this.db.asUser(uid, (svc, u) => svc.checkRosterEvidence(u, id(eid, 'id'), result, text(b.note, 'note')));
  }

  @Post('roster/sites/:siteId/months/:month/proposal')
  proposal(@UserId() uid: string, @Param('siteId') siteId: string, @Param('month') m: string, @Body() b: { pattern?: unknown; personIds?: unknown }) {
    const pattern = b.pattern;
    if (pattern !== '5on2off' && pattern !== '6on1off') throw new BadRequestException('pattern must be 5on2off or 6on1off');
    if (!Array.isArray(b.personIds) || b.personIds.length > 200) throw new BadRequestException('personIds must be a list (at most 200)');
    const personIds = b.personIds.map((p, i) => id(p, `personIds[${i}]`));
    return this.db.asUser(uid, (svc, u) => svc.proposeRosterMonth(u, id(siteId, 'siteId'), month(m), { pattern, personIds }));
  }

  @Post('roster/sites/:siteId/allowances')
  allowance(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    if (JSON.stringify(b ?? {}).length > 4000) throw new BadRequestException('allowance is too long');
    return this.db.asUser(uid, (svc, u) => svc.proposeGuardAllowance(u, id(siteId, 'siteId'), obj(b, 'allowance') as never));
  }

  @Post('roster/allowances/:id/decide')
  decideAllowance(@UserId() uid: string, @Param('id') aid: string, @Body() b: { step?: unknown; approve?: unknown; reason?: unknown }) {
    const step = b.step;
    if (step !== 'verify' && step !== 'approve') throw new BadRequestException('step must be verify or approve');
    return this.db.asUser(uid, (svc, u) => svc.decideGuardAllowance(u, id(aid, 'id'), step, b.approve === true, text(b.reason, 'reason')));
  }

  @Post('roster/sites/:siteId/lump-sums')
  proposeLumpSum(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    const language = b.language === 'en' || b.language === 'ne' || b.language === 'other' ? b.language : 'ms';
    return this.db.asUser(uid, (svc, u) =>
      svc.proposeLumpSum(u, id(siteId, 'siteId'), { personId: id(b.personId, 'personId'), target: Number(b.target), from: month(b.from), to: b.to == null || b.to === '' ? null : month(b.to), language }),
    );
  }

  @Post('roster/lump-sums/:id/approve')
  approveLumpSum(@UserId() uid: string, @Param('id') lid: string, @Body() b: { reason?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.approveLumpSum(u, id(lid, 'id'), text(b.reason, 'reason')));
  }

  @Post('roster/sites/:siteId/lump-sum-switch')
  lumpSumSwitch(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: { on?: unknown; reason?: unknown }) {
    if (typeof b.on !== 'boolean') throw new BadRequestException('on must be true or false');
    const on = b.on;
    return this.db.asUser(uid, (svc, u) => svc.setLumpSumSwitch(u, id(siteId, 'siteId'), on, text(b.reason, 'reason')));
  }

  // The guard's own screens: their published roster and their own decision on an agreement.
  @Get('me/roster')
  myRoster(@UserId() uid: string, @Query('month') m?: string) {
    return this.db.asUser(uid, (svc, u) => svc.myRoster(u, month(m)));
  }

  @Post('me/lump-sums/:id')
  myLumpSum(@UserId() uid: string, @Param('id') lid: string, @Body() b: { decision?: unknown }) {
    const decision = b.decision;
    if (decision !== 'sign' && decision !== 'refuse' && decision !== 'withdraw') throw new BadRequestException('decision must be sign, refuse or withdraw');
    return this.db.asUser(uid, (svc, u) => svc.decideMyLumpSum(u, id(lid, 'id'), decision));
  }
}
