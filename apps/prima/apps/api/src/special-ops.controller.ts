// Special Operations, Phase 4 slices 4B-4H (Fauzan, 1-2 Nov 2026): the API routes, in their own file so other
// department PRs do not collide in controllers.ts. Every route runs as the signed-in person through Db.asUser, so
// row-level security and the service's own checks both apply. The three system feeds (CMS app, vehicle trackers, the
// Asset Management developer system) use signed calls like the JA feed, each with its own key and signing secret.
import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Param, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { TradingOff, type ArmsRequest, type AmAsset, type SupplierPaper } from '@prima/core';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, name: string, max = 2000): string {
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${name} is missing or too long`);
  return v;
}
function opt(v: unknown, name: string, max = 200): string | null {
  return v == null || v === '' ? null : str(v, name, max);
}
function date(v: unknown, name: string): string {
  if (typeof v !== 'string' || !DATE.test(v)) throw new BadRequestException(`${name} must be a date like 2026-11-02`);
  return v;
}
function num(v: unknown, name: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new BadRequestException(`${name} must be a number`);
  return n;
}
function id(v: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(v)) throw new BadRequestException('id is not valid');
  return v;
}
function witness(v: unknown): { staffNo: string; pin: string } {
  const w = (v ?? {}) as Record<string, unknown>;
  return { staffNo: str(w.staffNo, 'witness.staffNo', 30), pin: str(w.pin, 'witness.pin', 12) };
}
function police(v: unknown, name: string): { ref: string; on: string } | null {
  if (v == null) return null;
  const p = v as Record<string, unknown>;
  return { ref: str(p.ref, `${name}.ref`, 60), on: date(p.on, `${name}.on`) };
}
function docs(v: unknown) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 3) throw new BadRequestException('proof must be a list of up to 3 documents');
  return v.map((x) => {
    const b = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (b.kind !== 'document') throw new BadRequestException('proof must be documents');
    return { kind: 'document' as const, name: str(b.name, 'proof.name', 120), data: str(b.data, 'proof.data', 1_000_000), caption: typeof b.caption === 'string' ? b.caption.slice(0, 200) : '' };
  });
}

const REQUEST_KINDS: ArmsRequest['kind'][] = ['ACQUIRE', 'MOVE', 'TRANSFER', 'SERVICE', 'DISPOSE', 'LOSS_REPORT', 'TRADE_BUY', 'TRADE_SELL', 'IMPORT'];
/** What a requester corrected when resubmitting a returned arms request. */
function changesOf(v: unknown) {
  if (v == null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('changes must be an object');
  const c = v as Record<string, unknown>;
  return {
    title: c.title == null ? undefined : str(c.title, 'changes.title', 140),
    note: c.note == null ? undefined : str(c.note, 'changes.note', 2000),
    quantity: c.quantity === undefined ? undefined : c.quantity === null ? null : num(c.quantity, 'changes.quantity'),
    estCost: c.estCost === undefined ? undefined : c.estCost === null ? null : num(c.estCost, 'changes.estCost'),
  };
}

const REQUEST_ACTIONS = ['resubmit', 'pass', 'return', 'authorise', 'refuse', 'legal_ok', 'legal_stop', 'spend', 'police', 'import', 'verify', 'reconcile', 'close'] as const;
const IMPORT_STEPS = ['cpo', 'kdn', 'customs', 'shipped', 'arrived', 'declared', 'endorsed'] as const;
const PAPER_KINDS: SupplierPaper['kind'][] = ['AGREEMENT', 'LETTER', 'QUOTATION', 'DEALER_LICENCE', 'EXPORT_LICENCE', 'END_USER_CERT', 'IMPORT_PERMIT', 'OTHER'];
const ASSET_CATEGORIES: AmAsset['category'][] = ['FURNITURE', 'FITTING', 'RENOVATION', 'OTHER'];

@Controller('api')
@UseGuards(AuthGuard)
export class SpecialOpsController {
  constructor(private db: Db) {}

  /** A refused trading action rolls back its own transaction, so the refusal is logged in a separate one. */
  private async loggingTradeRefusal<T>(uid: string, run: Promise<T>): Promise<T> {
    try {
      return await run;
    } catch (e) {
      if (e instanceof TradingOff) await this.db.asUser(uid, (svc, u) => svc.logTradeRefusal(u, e));
      throw e;
    }
  }

  // ---------- 4B arms register ----------

  @Post('vaults/:id/ammo/receive')
  receiveAmmo(@UserId() uid: string, @Param('id') vaultId: string, @Body() b: Record<string, unknown>) {
    const input = { vaultId: id(vaultId), calibre: str(b.calibre, 'calibre', 40), rounds: num(b.rounds, 'rounds'), ref: str(b.ref, 'ref', 80), witness: witness(b.witness) };
    return this.db.asUser(uid, (svc, u) => svc.receiveAmmo(u, input));
  }

  @Post('ammo/:id/count')
  countAmmo(@UserId() uid: string, @Param('id') stockId: string, @Body() b: Record<string, unknown>) {
    const input = { counted: num(b.counted, 'counted'), witness: witness(b.witness) };
    return this.db.asUser(uid, (svc, u) => svc.countAmmo(u, id(stockId), input));
  }

  @Post('vaults/:id/register-check')
  registerCheck(@UserId() uid: string, @Param('id') vaultId: string, @Body() b: Record<string, unknown>) {
    if (typeof b.matches !== 'boolean') throw new BadRequestException('matches must be true or false');
    const input = { matches: b.matches, note: b.note == null ? '' : str(b.note, 'note', 500) };
    return this.db.asUser(uid, (svc, u) => svc.checkRegisterBook(u, id(vaultId), input));
  }

  @Post('vault-watches/:id/check-in')
  watchCheckIn(@UserId() uid: string, @Param('id') watchId: string, @Body() b: Record<string, unknown>) {
    const how = (['call', 'camera', 'tag'] as const).find((x) => x === b.how);
    if (!how) throw new BadRequestException('how must be call, camera or tag');
    return this.db.asUser(uid, (svc, u) => svc.vaultWatchCheckIn(u, id(watchId), how));
  }

  @Post('firearms/:id/missing')
  missing(@UserId() uid: string, @Param('id') fid: string, @Body() b: Record<string, unknown>) {
    const note = str(b.note, 'note', 500);
    return this.db.asUser(uid, (svc, u) => svc.reportFirearmMissing(u, id(fid), note));
  }

  @Post('firearms/:id/police-report')
  policeReport(@UserId() uid: string, @Param('id') fid: string, @Body() b: Record<string, unknown>) {
    const input = { ref: str(b.ref, 'ref', 60), on: date(b.on, 'on') };
    return this.db.asUser(uid, (svc, u) => svc.recordPoliceReport(u, id(fid), input));
  }

  @Post('firearms/:id/found')
  found(@UserId() uid: string, @Param('id') fid: string, @Body() b: Record<string, unknown>) {
    const input = { note: str(b.note, 'note', 500), witness: witness(b.witness) };
    return this.db.asUser(uid, (svc, u) => svc.recordFirearmFound(u, id(fid), input));
  }

  @Post('firearms/:id/deposit')
  deposit(@UserId() uid: string, @Param('id') fid: string, @Body() b: Record<string, unknown>) {
    const input = { station: str(b.station, 'station', 120), on: date(b.on, 'on'), receiptRef: str(b.receiptRef, 'receiptRef', 60) };
    return this.db.asUser(uid, (svc, u) => svc.depositFirearm(u, id(fid), input));
  }

  @Post('firearms/:id/collect')
  collect(@UserId() uid: string, @Param('id') fid: string, @Body() b: Record<string, unknown>) {
    const input = { witness: witness(b.witness) };
    return this.db.asUser(uid, (svc, u) => svc.collectFirearm(u, id(fid), input));
  }

  @Post('companies/:id/range-sessions')
  range(@UserId() uid: string, @Param('id') companyId: string, @Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.personIds) || b.personIds.length > 200) throw new BadRequestException('personIds must be a list');
    const input = { companyId: id(companyId), on: date(b.on, 'on'), range: str(b.range, 'range', 120), instructor: str(b.instructor, 'instructor', 120), personIds: b.personIds.map((x) => id(String(x))) };
    return this.db.asUser(uid, (svc, u) => svc.recordRangeSession(u, input));
  }

  @Get('arms/renewals')
  renewals(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.armsRenewals(u));
  }

  // ---------- 4C arms requests and the supplier file ----------

  @Post('arms/requests')
  raise(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = REQUEST_KINDS.find((k) => k === b.kind);
    if (!kind) throw new BadRequestException(`kind must be one of ${REQUEST_KINDS.join(', ')}`);
    const buyer = b.buyer as Record<string, unknown> | null | undefined;
    const imp = b.importOrder as Record<string, unknown> | null | undefined;
    const input = {
      companyId: id(str(b.companyId, 'companyId', 120)),
      kind,
      title: str(b.title, 'title', 140),
      note: b.note == null ? '' : str(b.note, 'note', 1000),
      firearmIds: Array.isArray(b.firearmIds) ? b.firearmIds.slice(0, 50).map((x) => id(String(x))) : [],
      calibre: opt(b.calibre, 'calibre', 40),
      quantity: b.quantity == null ? null : num(b.quantity, 'quantity'),
      estCost: b.estCost == null ? null : num(b.estCost, 'estCost'),
      supplierId: b.supplierId ? id(String(b.supplierId)) : null,
      toVaultId: b.toVaultId ? id(String(b.toVaultId)) : null,
      fromState: opt(b.fromState, 'fromState', 40) ?? undefined,
      toState: opt(b.toState, 'toState', 40) ?? undefined,
      buyer: buyer
        ? { name: str(buyer.name, 'buyer.name', 120), licenceRef: str(buyer.licenceRef, 'buyer.licenceRef', 60), licenceExpiresOn: date(buyer.licenceExpiresOn, 'buyer.licenceExpiresOn'), policeApprovalRef: str(buyer.policeApprovalRef, 'buyer.policeApprovalRef', 60), endUserCertRef: str(buyer.endUserCertRef, 'buyer.endUserCertRef', 60) }
        : null,
      importOrder: imp ? { country: str(imp.country, 'importOrder.country', 60), exportLicenceRef: opt(imp.exportLicenceRef, 'importOrder.exportLicenceRef', 60), district: str(imp.district, 'importOrder.district', 80), appliedOn: date(imp.appliedOn, 'importOrder.appliedOn') } : null,
    };
    return this.loggingTradeRefusal(uid, this.db.asUser(uid, (svc, u) => svc.raiseArmsRequest(u, input)));
  }

  @Post('arms/requests/:id/step')
  step(@UserId() uid: string, @Param('id') rid: string, @Body() b: Record<string, unknown>) {
    const action = REQUEST_ACTIONS.find((x) => x === b.action);
    if (!action) throw new BadRequestException(`action must be one of ${REQUEST_ACTIONS.join(', ')}`);
    const importStep = b.importStep == null ? undefined : IMPORT_STEPS.find((x) => x === b.importStep);
    if (b.importStep != null && !importStep) throw new BadRequestException(`importStep must be one of ${IMPORT_STEPS.join(', ')}`);
    const port = b.port == null ? undefined : (['PORT_KLANG', 'KLIA'] as const).find((x) => x === b.port);
    if (b.port != null && !port) throw new BadRequestException('port must be PORT_KLANG or KLIA');
    const extra = {
      policeNotice: police(b.policeNotice, 'policeNotice'),
      policeApproval: police(b.policeApproval, 'policeApproval'),
      importStep,
      ref: opt(b.ref, 'ref', 60) ?? undefined,
      on: b.on == null ? undefined : date(b.on, 'on'),
      endsOn: b.endsOn == null ? undefined : date(b.endsOn, 'endsOn'),
      port,
      nextServiceOn: b.nextServiceOn == null ? undefined : date(b.nextServiceOn, 'nextServiceOn'),
      changes: changesOf(b.changes),
    };
    const reason = b.reason == null ? '' : str(b.reason, 'reason', 1000);
    return this.loggingTradeRefusal(uid, this.db.asUser(uid, (svc, u) => svc.armsRequestStep(u, id(rid), action, reason, extra)));
  }

  @Get('arms/legal-flags')
  legalFlags(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.specialOpsLegalFlags(u));
  }

  @Get('arms/suppliers/file')
  supplierFile(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.armsSupplierFile(u));
  }

  @Post('arms/suppliers/:id/file')
  updateSupplier(@UserId() uid: string, @Param('id') sid: string, @Body() b: Record<string, unknown>) {
    const list = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {})) : undefined);
    const people = list(b.people, 20)?.map((p) => ({ name: String(p.name ?? '').slice(0, 120), role: String(p.role ?? '').slice(0, 80), phone: String(p.phone ?? '').slice(0, 40), email: String(p.email ?? '').slice(0, 120) }));
    const links = list(b.links, 60)?.map((l) => ({ companyId: id(String(l.companyId ?? '')), relation: String(l.relation ?? '').slice(0, 80), since: typeof l.since === 'string' && DATE.test(l.since) ? l.since : null }));
    const input = {
      country: b.country === undefined ? undefined : opt(b.country, 'country', 60),
      registrationNo: b.registrationNo === undefined ? undefined : opt(b.registrationNo, 'registrationNo', 60),
      localAgent: b.localAgent === undefined ? undefined : opt(b.localAgent, 'localAgent', 120),
      currency: b.currency === undefined ? undefined : opt(b.currency, 'currency', 3),
      people,
      links,
    };
    return this.db.asUser(uid, (svc, u) => svc.updateArmsSupplierFile(u, id(sid), input));
  }

  @Post('arms/suppliers/:id/papers')
  addPaper(@UserId() uid: string, @Param('id') sid: string, @Body() b: Record<string, unknown>) {
    const kind = PAPER_KINDS.find((k) => k === b.kind);
    if (!kind) throw new BadRequestException(`kind must be one of ${PAPER_KINDS.join(', ')}`);
    const input = { kind, title: str(b.title, 'title', 140), ref: opt(b.ref, 'ref', 80), on: date(b.on, 'on'), expiresOn: b.expiresOn ? date(b.expiresOn, 'expiresOn') : null, proof: docs(b.proof) };
    return this.db.asUser(uid, (svc, u) => svc.addSupplierPaper(u, id(sid), input));
  }

  // ---------- 4D armed jobs and the CIT pack ----------

  @Get('arms/jobs/:id/check')
  jobCheck(@UserId() uid: string, @Param('id') jid: string) {
    return this.db.asUser(uid, (svc, u) => svc.armedJobCheck(u, id(jid)));
  }

  @Get('arms/agreements/:id/checklist')
  clientChecklist(@UserId() uid: string, @Param('id') aid: string) {
    return this.db.asUser(uid, (svc, u) => svc.armedClientChecklist(u, id(aid)));
  }

  @Get('companies/:id/cit-tender-pack')
  citPack(@UserId() uid: string, @Param('id') companyId: string) {
    return this.db.asUser(uid, (svc, u) => svc.citTenderPack(u, id(companyId)));
  }

  // ---------- 4E CMS ----------

  @Post('cms/shifts/:id/clock-in')
  seatClockIn(@UserId() uid: string, @Param('id') sid: string) {
    return this.db.asUser(uid, (svc, u) => svc.cmsSeatClockIn(u, id(sid)));
  }

  // ---------- 4F Transport ----------

  @Get('transport/board')
  transport(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.transportBoard(u));
  }

  // ---------- 4G Asset Management ----------

  @Get('am/rent-check')
  rentCheck(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.amRentCheck(u));
  }

  @Post('am/purchases')
  buy(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const category = ASSET_CATEGORIES.find((c) => c === b.category);
    if (!category) throw new BadRequestException(`category must be one of ${ASSET_CATEGORIES.join(', ')}`);
    const input = { description: str(b.description, 'description', 140), category, qty: num(b.qty, 'qty'), estCost: num(b.estCost, 'estCost'), location: str(b.location, 'location', 120), ownerEntity: str(b.ownerEntity, 'ownerEntity', 120), reason: str(b.reason, 'reason', 500) };
    return this.db.asUser(uid, (svc, u) => svc.amBuyRequest(u, input));
  }

  @Post('am/purchases/:id/decide')
  decideBuy(@UserId() uid: string, @Param('id') aid: string, @Body() b: Record<string, unknown>) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    const approve = b.approve;
    const reason = str(b.reason, 'reason', 500);
    const seen = b.estCost == null ? undefined : num(b.estCost, 'estCost');
    return this.db.asUser(uid, (svc, u) => svc.amBuyDecide(u, id(aid), approve, reason, seen));
  }

  @Post('am/purchases/:id/reprice')
  reprice(@UserId() uid: string, @Param('id') aid: string, @Body() b: Record<string, unknown>) {
    const est = num(b.estCost, 'estCost');
    const reason = str(b.reason, 'reason', 500);
    return this.db.asUser(uid, (svc, u) => svc.amBuyReprice(u, id(aid), est, reason));
  }

  @Post('am/purchases/:id/received')
  received(@UserId() uid: string, @Param('id') aid: string, @Body() b: Record<string, unknown>) {
    const input = { tag: str(b.tag, 'tag', 40), cost: num(b.cost, 'cost'), boughtOn: date(b.boughtOn, 'boughtOn') };
    return this.db.asUser(uid, (svc, u) => svc.amBuyReceived(u, id(aid), input));
  }

  // ---------- 4H trading and import ----------

  @Get('arms/trading')
  trading(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.armsTrading(u));
  }

  @Post('arms/trading')
  setTrading(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (typeof b.on !== 'boolean') throw new BadRequestException('on must be true or false');
    const on = b.on;
    const reason = str(b.reason, 'reason', 500);
    return this.db.asUser(uid, (svc, u) => svc.setArmsTrading(u, on, reason));
  }

  @Get('arms/imports')
  imports(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.armsImports(u));
  }

  @Get('companies/:id/dealer-return')
  dealerReturn(@UserId() uid: string, @Param('id') companyId: string, @Query('from') from: string, @Query('to') to: string) {
    const f = date(from, 'from');
    const t = date(to, 'to');
    return this.db.asUser(uid, (svc, u) => svc.dealerReturnDraft(u, id(companyId), f, t));
  }
}

// ---------- The three Special Ops feeds ----------

const SKEW_MS = 5 * 60_000;
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/**
 * The same signed-call rule as the JA feed (apps/api/src/auth.ts verifyFeed): X-Api-Key, X-Timestamp within 5
 * minutes, and X-Signature = HMAC-SHA256 of "timestamp.body" with the feed's own signing secret, all from the
 * environment. A feed with no key or secret set refuses every call.
 */
export function verifySpecialOpsFeed(headers: Record<string, unknown>, rawBody: Buffer | undefined, feed: 'CMS_FEED' | 'TRACKER_FEED' | 'AM_FEED', now = Date.now(), env: Record<string, string | undefined> = process.env): boolean {
  const key = env[`${feed}_API_KEY`];
  const secret = env[`${feed}_SIGNING_SECRET`];
  if (!key || !secret || !rawBody) return false;
  const got = String(headers['x-api-key'] ?? '');
  const ts = String(headers['x-timestamp'] ?? '');
  const sig = String(headers['x-signature'] ?? '').toLowerCase();
  const t = Date.parse(ts);
  if (!got || !sig || Number.isNaN(t) || Math.abs(now - t) > SKEW_MS) return false;
  const want = createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest('hex');
  return same(got, key) && same(sig, want);
}

function feedGuard(feed: 'CMS_FEED' | 'TRACKER_FEED' | 'AM_FEED') {
  @Injectable()
  class Guard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
      if (!verifySpecialOpsFeed(req.headers as Record<string, unknown>, req.rawBody, feed)) throw new UnauthorizedException('Feed key or signature not valid.');
      return true;
    }
  }
  return Guard;
}
export const CmsFeedGuard = feedGuard('CMS_FEED');
export const TrackerFeedGuard = feedGuard('TRACKER_FEED');
export const AmFeedGuard = feedGuard('AM_FEED');

/** The CMS Command Centre app (apps/cms): events and closed alarms in, and its directory out. */
@Controller('api/integrations/cms/v1')
@UseGuards(CmsFeedGuard)
export class CmsFeedController {
  constructor(private db: Db) {}

  @Post('events')
  events(@Body() body: { events?: unknown; closedAlarms?: unknown; handovers?: unknown }) {
    if (!Array.isArray(body?.events) && !Array.isArray(body?.closedAlarms) && !Array.isArray(body?.handovers))
      throw new BadRequestException('Send { "events": [...], "closedAlarms": [...], "handovers": [...] }.');
    return this.db.asUser(process.env.CMS_FEED_USER_ID ?? 'u-cms-link', (svc, u) => svc.cmsIngest(u, body));
  }

  /** A signed POST (the body can be {}), so the read is signed like every other feed call. */
  @Post('directory')
  directory() {
    return this.db.asUser(process.env.CMS_FEED_USER_ID ?? 'u-cms-link', (svc, u) => svc.cmsDirectory(u));
  }
}

@Controller('api/integrations/tracker/v1')
@UseGuards(TrackerFeedGuard)
export class TrackerFeedController {
  constructor(private db: Db) {}

  @Post('positions')
  positions(@Body() body: { records?: unknown }) {
    if (!Array.isArray(body?.records)) throw new BadRequestException('Send { "records": [...] }.');
    return this.db.asUser(process.env.TRACKER_FEED_USER_ID ?? 'u-tracker-feed', (svc, u) => svc.trackerIngest(u, body.records as unknown[]));
  }
}

@Controller('api/integrations/am/v1')
@UseGuards(AmFeedGuard)
export class AmFeedController {
  constructor(private db: Db) {}

  @Post('units')
  units(@Body() body: { records?: unknown }) {
    if (!Array.isArray(body?.records)) throw new BadRequestException('Send { "records": [...] }.');
    return this.db.asUser(process.env.AM_FEED_USER_ID ?? 'u-am-feed', (svc, u) => svc.amIngest(u, body.records as unknown[]));
  }
}

export const SPECIAL_OPS_CONTROLLERS = [SpecialOpsController, CmsFeedController, TrackerFeedController, AmFeedController];
