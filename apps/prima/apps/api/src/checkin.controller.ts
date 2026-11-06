// P81 (staff check-in by place, 6 Nov 2026): the API routes, in their own file so other PRs do not collide in
// controllers.ts. Every route runs as the signed-in person through Db.asUser (row-level security and the service's own
// checks). The street address of a check-in is looked up here, on the server, through the shared Nominatim queue
// (geocode.ts), outside the database transaction; a slow lookup is saved later instead of holding the check-in up.
import { BadRequestException, Body, Controller, Get, HttpException, Param, Post, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { AccessDenied, RefusedAfterSave, checkinScope, type CheckinAddress, type CheckinInput, type CheckinRuleInput } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { GeocodeBusy, GeocodeOff, geocoderFromEnv, type Geocoder } from './geocode';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, name: string, max = 2000): string {
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${name} is missing or too long`);
  return v;
}
function opt(v: unknown, name: string, max: number): string | null {
  return v == null || v === '' ? null : str(v, name, max);
}
function num(v: unknown, name: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new BadRequestException(`${name} must be a number`);
  return n;
}
function id(v: unknown, name = 'id'): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.:@-]{1,120}$/.test(v)) throw new BadRequestException(`${name} is not valid`);
  return v;
}

/** Where the phone was. Nothing else from the phone is read: the server decides in or out of the area. */
function fixOf(b: Record<string, unknown>) {
  const lat = num(b.lat, 'lat');
  const lng = num(b.lng, 'lng');
  const accuracyM = typeof b.accuracyM === 'number' && Number.isFinite(b.accuracyM) ? b.accuracyM : null;
  return { lat, lng, accuracyM, capturedAt: typeof b.capturedAt === 'string' ? b.capturedAt.slice(0, 40) : null };
}

function checkinInput(b: Record<string, unknown>): CheckinInput {
  let face: CheckinInput['face'] = null;
  if (b.face != null) {
    const f = b.face as Record<string, unknown>;
    const image = str(f.image, 'face.image', 2_500_000);
    if (!/^data:image\/jpeg;base64,/.test(image)) throw new BadRequestException('Take the photo with the app camera.');
    const d = f.descriptor;
    if (!Array.isArray(d) || d.length !== 128 || !d.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new BadRequestException('face.descriptor must be 128 numbers');
    face = { image, descriptor: d as number[], live: f.live === true };
  }
  return { ...fixOf(b), reason: opt(b.reason, 'reason', 500), face };
}

function ruleInput(v: unknown): CheckinRuleInput {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const list = (x: unknown, name: string, max: number) => {
    if (x == null) return [];
    if (!Array.isArray(x) || x.length > max) throw new BadRequestException(`${name} must be a list of up to ${max}`);
    return x as unknown[];
  };
  return {
    kind: str(r.kind, 'rule.kind', 10) as CheckinRuleInput['kind'],
    placeId: r.placeId == null ? null : id(r.placeId, 'rule.placeId'),
    zones: list(r.zones, 'rule.zones', 12).map((z, i) => {
      const o = (z ?? {}) as Record<string, unknown>;
      return { label: str(o.label, `rule.zones[${i}].label`, 80), lat: num(o.lat, 'lat'), lng: num(o.lng, 'lng'), radiusM: num(o.radiusM, 'radiusM') };
    }),
    outstationWeekdays: list(r.outstationWeekdays, 'rule.outstationWeekdays', 7).map((d) => num(d, 'weekday')),
    outstation: list(r.outstation, 'rule.outstation', 24).map((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { from: str(o.from, `rule.outstation[${i}].from`, 10), to: str(o.to, `rule.outstation[${i}].to`, 10), note: o.note == null ? '' : str(o.note, 'note', 200) };
    }),
    note: r.note == null ? '' : str(r.note, 'rule.note', 300),
  };
}

/** Lookups per person per minute on the Check-in places map (the queue itself holds everyone to one a second). */
const PER_USER_PER_MIN = 20;

@Controller('api')
@UseGuards(AuthGuard)
export class CheckinController {
  /** One queue for the whole server, so the one-a-second limit holds across every user. */
  static geocoder: Geocoder = geocoderFromEnv();
  private static recent = new Map<string, number[]>();

  constructor(private db: Db) {}

  private get geo(): Geocoder {
    return CheckinController.geocoder;
  }

  /** The street address for a check-in, waiting a little; when slower, it is saved after the check-in (fill). */
  private async address(lat: number, lng: number, waitMs: number): Promise<{ address: CheckinAddress; later: Promise<string | null> | null }> {
    if (!this.geo.enabled) return { address: { status: 'off', text: null }, later: null };
    const p = this.geo.reverse(lat, lng);
    const first = await Promise.race([p.then((text) => ({ text })), new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
    if (first) return { address: first.text ? { status: 'found', text: first.text } : { status: 'none', text: null }, later: null };
    return { address: { status: 'pending', text: null }, later: p };
  }

  /** Only people who set check-in places use the map's address search. */
  private async editor(uid: string): Promise<void> {
    await this.db.asUser(uid, async (_svc, u) => {
      if (!checkinScope(u)) throw new AccessDenied('hr.monitor', '(address search for check-in places)');
    });
    const now = Date.now();
    const mine = (CheckinController.recent.get(uid) ?? []).filter((t) => now - t < 60_000);
    if (mine.length >= PER_USER_PER_MIN) throw new HttpException('Too many address searches in a minute. Wait a moment, or drop the pin on the map.', 429);
    mine.push(now);
    CheckinController.recent.set(uid, mine);
  }

  @Get('me/checkin')
  mine(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myCheckin(u));
  }

  @Post('me/checkin/preview')
  async preview(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const fix = fixOf(b);
    const { address } = await this.address(fix.lat, fix.lng, 2_500);
    return this.db.asUser(uid, (svc, u) => svc.checkinPreview(u, fix, address));
  }

  @Post('me/checkin/in')
  checkIn(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.record(uid, 'in', b);
  }

  @Post('me/checkin/out')
  checkOut(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.record(uid, 'out', b);
  }

  private async record(uid: string, kind: 'in' | 'out', b: Record<string, unknown>) {
    const input = checkinInput(b);
    const { address, later } = await this.address(input.lat, input.lng, 2_500);
    const found = (text: string | null): CheckinAddress => (text ? { status: 'found', text } : { status: 'none', text: null });
    let r;
    try {
      r = await this.db.asUser(uid, (svc, u) => svc.checkIn(u, kind, input, address));
    } catch (e) {
      // A refused attempt is kept (RefusedAfterSave); its address is filled in the same way.
      if (later && e instanceof RefusedAfterSave)
        void later.then((text) => this.db.asUser(uid, (svc, u) => svc.checkinSetAddressAt(u, input.lat, input.lng, found(text)))).catch(() => undefined);
      throw e;
    }
    const eventId = r.event.id;
    // Saved without the address; it is filled in when the lookup answers. Nothing waits on this.
    if (later) void later.then((text) => this.db.asUser(uid, (svc, u) => svc.checkinSetAddress(u, eventId, found(text)))).catch(() => undefined);
    return r;
  }

  @Get('checkin/setup')
  setup(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.checkinSetup(u));
  }

  @Post('checkin/places')
  savePlace(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const input = {
      id: b.id == null ? null : id(b.id),
      companyId: id(b.companyId, 'companyId'),
      name: str(b.name, 'name', 80),
      address: b.address == null ? '' : str(b.address, 'address', 300),
      lat: num(b.lat, 'lat'),
      lng: num(b.lng, 'lng'),
      radiusM: b.radiusM == null ? null : num(b.radiusM, 'radiusM'),
    };
    return this.db.asUser(uid, (svc, u) => svc.saveCheckinPlace(u, input));
  }

  @Post('checkin/places/:id/active')
  placeActive(@UserId() uid: string, @Param('id') pid: string, @Body() b: Record<string, unknown>) {
    if (typeof b.active !== 'boolean') throw new BadRequestException('active must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.setCheckinPlaceActive(u, id(pid), b.active as boolean));
  }

  @Post('checkin/policy')
  policy(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const p = b.outOfArea === 'block' || b.outOfArea === 'flag' ? b.outOfArea : null;
    if (!p) throw new BadRequestException('outOfArea must be block or flag');
    return this.db.asUser(uid, (svc, u) => svc.setCheckinPolicy(u, id(b.companyId, 'companyId'), p));
  }

  @Post('checkin/rules')
  rules(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.userIds) || b.userIds.length > 1000) throw new BadRequestException('userIds must be a list of up to 1,000');
    const userIds = b.userIds.map((x, i) => id(x, `userIds[${i}]`));
    const rule = ruleInput(b.rule);
    return this.db.asUser(uid, (svc, u) => svc.setCheckinRules(u, userIds, rule));
  }

  @Get('checkin/sites')
  sites(@UserId() uid: string, @Query('companyId') companyId?: string) {
    return this.db.asUser(uid, (svc, u) => svc.checkinSites(u, id(companyId, 'companyId')));
  }

  @Get('checkin/day')
  day(@UserId() uid: string, @Query('date') d?: string) {
    if (d != null && !DATE.test(d)) throw new BadRequestException('date must be like 2026-11-06');
    return this.db.asUser(uid, (svc, u) => svc.checkinDay(u, d));
  }

  @Get('checkin/reviews')
  reviews(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.checkinReviews(u));
  }

  @Post('checkin/reviews/:id')
  decide(@UserId() uid: string, @Param('id') eid: string, @Body() b: Record<string, unknown>) {
    const decision = b.decision === 'cleared' || b.decision === 'upheld' ? b.decision : null;
    if (!decision) throw new BadRequestException('decision must be cleared or upheld');
    return this.db.asUser(uid, (svc, u) => svc.decideCheckin(u, id(eid), decision, b.note == null ? '' : str(b.note, 'note', 500)));
  }

  @Get('geo/search')
  async search(@UserId() uid: string, @Query('q') q?: string) {
    const text = str(q ?? '', 'q', 200);
    await this.editor(uid);
    try {
      return { results: await this.geo.search(text) };
    } catch (e) {
      if (e instanceof GeocodeBusy || e instanceof GeocodeOff) throw new ServiceUnavailableException(e.message);
      throw e;
    }
  }

  @Get('geo/reverse')
  async reverse(@UserId() uid: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    const a = num(lat, 'lat');
    const b = num(lng, 'lng');
    if (Math.abs(a) > 90 || Math.abs(b) > 180) throw new BadRequestException('lat and lng are out of range');
    await this.editor(uid);
    if (!this.geo.enabled) return { address: null, status: 'off' as const };
    const address = await this.geo.reverse(a, b);
    return { address, status: address ? ('found' as const) : ('none' as const) };
  }
}
