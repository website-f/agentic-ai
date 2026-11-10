// P81 (staff check-in by place, 6 Nov 2026): the service behind the Check-in places screen, the review list and each
// staff member's check-in and check-out. The rules themselves are in checkin.ts. PrimaService wires it in (service.ts,
// "Check-in places") with the staff clock steps it needs, so the clock stays in one place.
import { AccessDenied, CENTRAL_EMPLOYER_IDS, accessClosed, centralStaffName } from './access';
import {
  CHECKIN_DEFAULT_RADIUS_M,
  CHECKIN_MAX_ACCURACY_M,
  CHECKIN_MAX_OUTSTATION,
  CHECKIN_MAX_PLACES,
  CHECKIN_MAX_ZONES,
  CHECKIN_NOTICE,
  CHECKIN_PLACE_RADIUS,
  CHECKIN_REASON_MIN,
  CHECKIN_ZONE_RADIUS,
  accuracyProblem,
  checkinCompanyOf,
  checkinDecision,
  checkinScope,
  checkinTargets,
  evaluateCheckin,
  isOutstation,
  mayEditCheckin,
  validLatLng,
  type CheckinAddressStatus,
  type CheckinEvent,
  type CheckinOutstation,
  type CheckinPlace,
  type CheckinPolicy,
  type CheckinRule,
  type CheckinRuleKind,
  type CheckinZone,
} from './checkin';
import { validFaceDescriptor } from './face';
import { BadRequest, NotFound, requireApprovalReason } from './service';
import type { Store } from './store';
import { addDays, dateOf, isRealDate, toMs } from './time';
import type { FaceCapture, Id, IsoDate, IsoDateTime, StaffClock, StaffClockShot, User } from './types';

export interface CheckinFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** The phone's time; the server's own time is the record. */
  capturedAt?: IsoDateTime | null;
}

export interface CheckinInput extends CheckinFix {
  /** Required when the check-in is outside the allowed area and the company allows it with a reason. */
  reason?: string | null;
  /**
   * The face photo with the descriptor the phone's engine made (empty when taken without the phone engine). P97: sent at
   * every check-in and check-out (rule HR-STAFF-SNAP); at a check-in it also does the sign-in clock's face check.
   */
  face?: { image: string; descriptor: number[]; live: boolean } | null;
  /** P97: no camera (blocked, broken, none): what the person wrote, for their manager or HR to look at. */
  noCamera?: { reason: string } | null;
  /** P97: set by the API from its own setting, never by the phone: where the face engine runs. */
  faceEngine?: 'phone' | 'server';
}

/** The street address the API looked up for the point (never sent by the phone). */
export interface CheckinAddress {
  status: CheckinAddressStatus;
  text: string | null;
}

export interface CheckinRuleInput {
  kind: CheckinRuleKind;
  placeId?: Id | null;
  zones?: CheckinZone[];
  outstationWeekdays?: number[];
  outstation?: CheckinOutstation[];
  note?: string;
}

export interface CheckinPlaceInput {
  id?: Id | null;
  companyId: Id;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusM?: number | null;
}

/** The staff clock steps the check-in needs, from PrimaService. */
export interface CheckinDeps {
  allowed(user: User): boolean;
  openClock(user: User): Promise<StaffClock | null>;
  /** Open (or keep) today's clock for a check-in. */
  ensureClock(user: User): Promise<StaffClock | null>;
  /** Close the clock at check-out, with the place on the out record. */
  closeClock(user: User, place: Pick<StaffClockShot, 'lat' | 'lng' | 'accuracyM' | 'distanceM'>): Promise<StaffClock | null>;
  /** The existing face check, scored on the server. */
  faceCheck(user: User, input: { image: string; capturedAt: IsoDateTime; descriptor: number[]; live: boolean }): Promise<StaffClock>;
  faceEnrolled(user: User): Promise<boolean>;
}

const RULE_KINDS: CheckinRuleKind[] = ['office', 'place', 'field'];
const POLICIES: CheckinPolicy[] = ['block', 'flag'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const hhmm = (t: IsoDateTime) => t.slice(11, 16);

/** Where the person stands today: checked in, checked out, or neither. A refused attempt does not count. */
export function checkinState(events: CheckinEvent[]): 'none' | 'in' | 'out' {
  const last = events.filter((e) => e.outcome !== 'blocked').sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return last ? last.kind : 'none';
}

/** P93: a clock opened on an earlier day still runs past midnight when it began within this many hours... */
export const CLOCK_CARRY_MAX_H = 16;
/** ...and was active (opened, or a location reading) within this many hours: night work, not a forgotten sign-out. */
export const CLOCK_CARRY_ACTIVE_H = 4;

/**
 * P93 (Fitri: "sometimes an error asking me to go out and clock in again"): whether an open clock from an earlier day
 * is still the working session. Someone working past midnight keeps their clock and can still check out; a clock left
 * open from yesterday morning is closed by Prima instead (staffSessionStart), as before.
 */
export function clockCarriesOver(c: Pick<StaffClock, 'in' | 'lastPingAt'>, now: IsoDateTime): boolean {
  const n = toMs(now);
  const started = toMs(c.in.receivedAt);
  const active = Math.max(started, c.lastPingAt ? toMs(c.lastPingAt) : 0);
  return n - started <= CLOCK_CARRY_MAX_H * 3_600_000 && n - active <= CLOCK_CARRY_ACTIVE_H * 3_600_000;
}

/** The open clock that is today's working session (today's, or carried past midnight), else null. */
export function currentClock<C extends Pick<StaffClock, 'id' | 'in' | 'lastPingAt'>>(open: C | null | undefined, now: IsoDateTime): C | null {
  if (!open) return null;
  return dateOf(open.in.receivedAt) === dateOf(now) || clockCarriesOver(open, now) ? open : null;
}

/**
 * P93: where the person stands now, across midnight. Today's last check-in or check-out decides; a check-in from an
 * earlier day still counts only while its clock is the current one (night work), so nobody is told to check out of
 * yesterday before they can start today, nor that they never checked in when they did so before midnight.
 */
export function checkinStateNow(events: CheckinEvent[], now: IsoDateTime, currentClockId: Id | null): 'none' | 'in' | 'out' {
  const last = events.filter((e) => e.outcome !== 'blocked').sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (!last) return 'none';
  if (dateOf(last.at) === dateOf(now)) return last.kind;
  return last.kind === 'in' && !!currentClockId && last.clockId === currentClockId ? 'in' : 'none';
}

export class CheckinService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private deps: CheckinDeps,
  ) {}

  private today(): IsoDate {
    return dateOf(this.clock());
  }

  private need(user: User): void {
    if (!this.deps.allowed(user)) throw new BadRequest('Guards clock in on the site device.');
  }

  /** The person's company, its places and policy, and their own rule. */
  private async context(user: User) {
    const person = user.personId ? await this.store.get('people', user.personId) : undefined;
    const companyId = checkinCompanyOf(user, person?.companyId);
    const [places, rule, settings] = await Promise.all([
      this.store.list('checkinPlaces', { companyId }),
      this.store.get('checkinRules', user.id),
      this.store.get('checkinSettings', companyId),
    ]);
    return { companyId, places, rule: rule ?? null, policy: (settings?.outOfArea ?? 'flag') as CheckinPolicy };
  }

  private async todayEvents(userId: Id): Promise<CheckinEvent[]> {
    const d = this.today();
    return (await this.store.list('checkinEvents', { userId }, { field: 'at', from: d, before: addDays(d, 1) })).sort((a, b) => a.at.localeCompare(b.at));
  }

  /** Yesterday's and today's check-ins (a check-in before midnight can still be open), oldest first. */
  private async recentEvents(userId: Id): Promise<CheckinEvent[]> {
    const d = this.today();
    return (await this.store.list('checkinEvents', { userId }, { field: 'at', from: addDays(d, -1), before: addDays(d, 1) })).sort((a, b) => a.at.localeCompare(b.at));
  }

  /** Where the person stands now (P93: across midnight), with the open clock that is their current session. */
  private async stateNow(user: User) {
    const [events, open] = await Promise.all([this.recentEvents(user.id), this.deps.openClock(user)]);
    const current = currentClock(open, this.clock());
    const state = checkinStateNow(events, this.clock(), current?.id ?? null);
    return { events, open, current, state, last: events.filter((e) => e.outcome !== 'blocked').at(-1) ?? null };
  }

  private async companyName(id: Id): Promise<string> {
    return (await this.store.get('companies', id))?.name ?? centralStaffName(id);
  }

  /** The staff member's own check-in card: their rule, today's check-ins and what happens outside the area. */
  async mine(user: User) {
    const allowed = this.deps.allowed(user);
    const notice = CHECKIN_NOTICE;
    if (!allowed) return { allowed, notice, maxAccuracyM: CHECKIN_MAX_ACCURACY_M, reasonMin: CHECKIN_REASON_MIN, state: 'none' as const, today: [] as CheckinEvent[], mine: null };
    const ctx = await this.context(user);
    const today = this.today();
    const now = await this.stateNow(user);
    const open = now.open;
    // Today's list, plus a check-in from before midnight that is still open (night work).
    const events = now.events.filter((e) => dateOf(e.at) === today || (now.state === 'in' && e.id === now.last?.id));
    const t = checkinTargets(ctx.rule, ctx.places, user.base);
    return {
      allowed,
      notice,
      maxAccuracyM: CHECKIN_MAX_ACCURACY_M,
      reasonMin: CHECKIN_REASON_MIN,
      state: now.state,
      today: events,
      mine: {
        companyId: ctx.companyId,
        companyName: await this.companyName(ctx.companyId),
        policy: ctx.policy,
        rule: t.rule,
        targets: t.targets,
        outstationToday: isOutstation(ctx.rule, today),
        outstationWeekdays: ctx.rule?.kind === 'field' ? ctx.rule.outstationWeekdays : [],
        outstation: ctx.rule?.kind === 'field' ? ctx.rule.outstation.filter((o) => o.to >= today).slice(0, 6) : [],
        note: ctx.rule?.note ?? '',
        faceEnrolled: await this.deps.faceEnrolled(user),
        facePending: !!open?.flags.includes('FACE_PENDING'),
      },
    };
  }

  /** What the server would decide for this reading, before the person commits (nothing is saved). */
  async preview(user: User, fix: CheckinFix, address: CheckinAddress) {
    this.need(user);
    if (!validLatLng(fix.lat, fix.lng)) throw new BadRequest('No location from the phone. Allow location and try again.');
    const ctx = await this.context(user);
    const kind = (await this.stateNow(user)).state === 'in' ? ('out' as const) : ('in' as const);
    const ev = evaluateCheckin({ lat: fix.lat, lng: fix.lng, date: this.today(), rule: ctx.rule, places: ctx.places, base: user.base });
    const d = checkinDecision(ev.verdict, ctx.policy, kind);
    const problem = accuracyProblem(fix.accuracyM);
    return { kind, accuracyOk: !problem, accuracyProblem: problem, ...ev, policy: ctx.policy, outcome: d.outcome, reasonNeeded: d.reasonNeeded, address: address.text, addressStatus: address.status };
  }

  /**
   * One check-in or check-out. The server decides in or out of the area; a rough reading is refused; outside the area it
   * is refused (company blocks; recorded for review) or needs a reason (company allows with a flag).
   */
  async record(user: User, kind: 'in' | 'out', input: CheckinInput, address: CheckinAddress) {
    this.need(user);
    // P93: one clock step at a time per person (the sign-in clock, a second tab, a second phone, a retry), so two of
    // them never both open a clock or both check in.
    await this.store.lock?.('staffClocks', `user:${user.id}`);
    const now = await this.stateNow(user);
    const { state } = now;
    // P93 (Fitri: "an error asking me to go out and clock in again"): a check-in when already checked in, or a
    // check-out when already checked out, is the same step again (a second tap, another tab or phone, or a retry after
    // the answer was lost on a weak signal). It returns the step already made instead of an error telling the person to
    // check out and check in again.
    if (kind === 'in' && state === 'in' && now.last) {
      let clock = now.current;
      if (input.face && validFaceDescriptor(input.face.descriptor) && clock?.flags.includes('FACE_PENDING'))
        clock = await this.deps.faceCheck(user, { image: input.face.image, capturedAt: this.clock(), descriptor: input.face.descriptor, live: input.face.live === true });
      return { event: now.last, blocked: false as const, clock, already: true as const };
    }
    if (kind === 'out' && state === 'out' && now.last) return { event: now.last, blocked: false as const, clock: null, already: true as const };
    if (kind === 'out' && state !== 'in') throw new BadRequest('You have not checked in today, so there is nothing to check out. Press Check in when you start work.');
    if (!validLatLng(input.lat, input.lng)) throw new BadRequest('No location from the phone. Allow location and try again.');
    const problem = accuracyProblem(input.accuracyM);
    if (problem) throw new BadRequest(problem);
    const ctx = await this.context(user);
    const events = now.events.filter((e) => dateOf(e.at) === this.today());
    const at = this.clock();
    const ev = evaluateCheckin({ lat: input.lat, lng: input.lng, date: this.today(), rule: ctx.rule, places: ctx.places, base: user.base });
    const d = checkinDecision(ev.verdict, ctx.policy, kind);
    const reason = text(input.reason, 500) || null;
    if (d.reasonNeeded && (!reason || reason.length < CHECKIN_REASON_MIN)) {
      const n = ev.nearest;
      throw new BadRequest(
        `${n ? `You are ${n.outsideByM.toLocaleString('en-MY')} m outside ${n.label}. ` : ''}Write a short reason (at least ${CHECKIN_REASON_MIN} characters) to check ${kind} here. Your manager will see it.`,
      );
    }
    const capturedAt = typeof input.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(input.capturedAt) && !Number.isNaN(Date.parse(input.capturedAt)) ? input.capturedAt : at;
    const base: CheckinEvent = {
      // The day's count keeps a refused attempt and the check-in right after it (same second) apart.
      id: `ci-${user.id}-${toMs(at)}-${kind}-${events.length + 1}`,
      userId: user.id,
      userName: user.name,
      companyId: ctx.companyId,
      kind,
      clockId: null,
      at,
      capturedAt,
      lat: input.lat,
      lng: input.lng,
      accuracyM: Math.round(input.accuracyM!),
      address: address.text,
      addressStatus: address.status,
      verdict: ev.verdict,
      rule: ev.rule,
      outstation: ev.outstation,
      matched: ev.matched,
      nearest: ev.nearest,
      targets: ev.targets,
      outcome: d.outcome,
      reason,
      face: null,
      review: d.outcome === 'accepted' ? null : { status: 'open', by: null, byId: null, at: null, note: '' },
    };
    const where = ev.matched ? ` at ${ev.matched.label}` : ev.nearest ? `, ${ev.nearest.outsideByM} m outside ${ev.nearest.label}` : '';
    if (d.outcome === 'blocked') {
      // The attempt is kept for the manager to see; the check-in itself is refused (PrimaService raises RefusedAfterSave).
      await this.store.transaction(async (tx) => {
        await tx.insert('checkinEvents', base);
        await tx.audit({ at, actor: user.name, companyId: ctx.companyId, action: 'checkin.blocked', entity: 'checkin_event', entityId: base.id, summary: `${user.name} tried to check in outside the allowed area${where}; refused by the company's rule` });
      });
      return { event: base, blocked: true as const, clock: null, already: false as const };
    }
    let clock = kind === 'in' ? await this.deps.ensureClock(user) : now.open;
    let face: FaceCapture | null = null;
    if (kind === 'in' && input.face && validFaceDescriptor(input.face.descriptor) && clock?.flags.includes('FACE_PENDING')) {
      clock = await this.deps.faceCheck(user, { image: input.face.image, capturedAt, descriptor: input.face.descriptor, live: input.face.live === true });
      face = clock.faceCheck?.face ?? null;
    }
    const event: CheckinEvent = { ...base, clockId: clock?.id ?? null, face };
    await this.store.transaction(async (tx) => {
      await tx.insert('checkinEvents', event);
      if (clock && d.outcome === 'flagged' && !clock.flags.includes('OUT_OF_AREA'))
        clock = await tx.update('staffClocks', clock.id, { flags: [...clock.flags, 'OUT_OF_AREA' as const] });
      await tx.audit({
        at,
        actor: user.name,
        companyId: ctx.companyId,
        action: kind === 'in' ? 'checkin.in' : 'checkin.out',
        entity: 'checkin_event',
        entityId: event.id,
        summary: `${user.name} checked ${kind}${where}${ev.outstation ? ' (outstation day)' : ''}${d.outcome === 'flagged' ? `, outside the allowed area: ${reason}` : ''}${ev.verdict === 'no_place' ? ' (no check-in place set)' : ''}`,
      });
    });
    if (kind === 'out') {
      const m = ev.matched ?? ev.nearest;
      clock = await this.deps.closeClock(user, { lat: input.lat, lng: input.lng, accuracyM: event.accuracyM, distanceM: m ? m.distanceM : null });
    }
    return { event, blocked: false as const, clock, already: false as const };
  }

  /** The address the API found after the check-in was saved (a slow lookup). Only the person's own, only once. */
  async setAddress(user: User, id: Id, address: CheckinAddress): Promise<boolean> {
    const e = await this.store.get('checkinEvents', id);
    if (!e || e.userId !== user.id || e.addressStatus !== 'pending' || address.status === 'pending') return false;
    await this.store.transaction(async (tx) => {
      await tx.update('checkinEvents', id, { address: address.text, addressStatus: address.status });
    });
    return true;
  }

  /** The same for a refused attempt, whose id the caller never got: today's pending one at exactly this point. */
  async setAddressAt(user: User, lat: number, lng: number, address: CheckinAddress): Promise<boolean> {
    const e = (await this.todayEvents(user.id)).filter((x) => x.addressStatus === 'pending' && x.lat === lat && x.lng === lng).at(-1);
    return e ? this.setAddress(user, e.id, address) : false;
  }

  // ---------- The Check-in places screen ----------

  private scope(user: User): 'all' | Id[] {
    const s = checkinScope(user);
    if (!s) throw new AccessDenied('hr.monitor', '(check-in places: HR and managers)');
    return s;
  }

  private inScope(s: 'all' | Id[], companyId: Id): boolean {
    return s === 'all' || s.includes(companyId);
  }

  private async companies(s: 'all' | Id[]) {
    const list = (await this.store.list('companies')).filter((c) => this.inScope(s, c.id)).map((c) => ({ id: c.id, name: c.name }));
    if (s === 'all') for (const id of CENTRAL_EMPLOYER_IDS) if (!list.some((c) => c.id === id)) list.push({ id, name: centralStaffName(id) });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Each company's places and out-of-area choice, and its staff with the rule each one has. */
  async setup(user: User) {
    const s = this.scope(user);
    const companies = await this.companies(s);
    const ids = companies.map((c) => c.id);
    const today = this.today();
    const [places, settings, rules, users] = await Promise.all([
      this.store.list('checkinPlaces', { companyId: ids }),
      this.store.list('checkinSettings', { companyId: ids }),
      this.store.list('checkinRules', { companyId: ids }),
      this.store.list('users'),
    ]);
    const staffUsers = users.filter((u) => this.deps.allowed(u) && !accessClosed(u, today));
    const personIds = staffUsers.map((u) => u.personId).filter((x): x is Id => !!x);
    const people = new Map((personIds.length ? await this.store.list('people', { id: personIds }) : []).map((p) => [p.id, p]));
    const ruleOf = new Map(rules.map((r) => [r.userId, r]));
    const staff = staffUsers
      .map((u) => {
        const p = u.personId ? people.get(u.personId) : undefined;
        const companyId = checkinCompanyOf(u, p?.companyId);
        const r = ruleOf.get(u.id);
        return {
          userId: u.id,
          name: u.name,
          title: u.title,
          companyId,
          department: u.department ?? p?.department ?? null,
          hasBase: !!u.base,
          own: u.id === user.id,
          rule: r ? { kind: r.kind, placeId: r.placeId, zones: r.zones, outstationWeekdays: r.outstationWeekdays, outstation: r.outstation, note: r.note, updatedAt: r.updatedAt, updatedBy: r.updatedBy } : null,
        };
      })
      .filter((x) => this.inScope(s, x.companyId) && ids.includes(x.companyId))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      companies: companies.map((c) => ({
        ...c,
        policy: (settings.find((x) => x.companyId === c.id)?.outOfArea ?? 'flag') as CheckinPolicy,
        places: places.filter((p) => p.companyId === c.id).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
      })),
      staff,
      limits: { place: CHECKIN_PLACE_RADIUS, zone: CHECKIN_ZONE_RADIUS, defaultRadiusM: CHECKIN_DEFAULT_RADIUS_M, maxZones: CHECKIN_MAX_ZONES, maxOutstation: CHECKIN_MAX_OUTSTATION },
    };
  }

  private editable(user: User, companyId: Id): void {
    if (!mayEditCheckin(user, companyId)) throw new AccessDenied('hr.monitor', '(check-in places of this company)');
  }

  /** Add or change an office or place: a pin on the map and its allowed radius (150 m when not set). */
  async savePlace(user: User, input: CheckinPlaceInput): Promise<CheckinPlace> {
    if (typeof input.companyId !== 'string') throw new BadRequest('Choose the company.');
    this.editable(user, input.companyId);
    const name = text(input.name, 80);
    if (name.length < 2) throw new BadRequest('Give the place a name, for example "Head office".');
    if (!validLatLng(input.lat, input.lng)) throw new BadRequest('Drop the pin on the map to set where the place is.');
    const r = input.radiusM == null ? CHECKIN_DEFAULT_RADIUS_M : Math.round(Number(input.radiusM));
    if (!Number.isFinite(r) || r < CHECKIN_PLACE_RADIUS.min || r > CHECKIN_PLACE_RADIUS.max)
      throw new BadRequest(`The allowed radius must be between ${CHECKIN_PLACE_RADIUS.min} m and ${CHECKIN_PLACE_RADIUS.max / 1000} km.`);
    const at = this.clock();
    const fields = { name, address: text(input.address, 300), lat: Math.round(input.lat * 1e6) / 1e6, lng: Math.round(input.lng * 1e6) / 1e6, radiusM: r };
    return this.store.transaction(async (tx) => {
      let row: CheckinPlace;
      if (input.id) {
        const old = await tx.get('checkinPlaces', input.id);
        if (!old || old.companyId !== input.companyId) throw new NotFound('Check-in place');
        row = await tx.update('checkinPlaces', old.id, { ...fields, updatedAt: at, updatedBy: user.name });
      } else {
        const count = (await tx.list('checkinPlaces', { companyId: input.companyId })).filter((p) => p.active).length;
        if (count >= CHECKIN_MAX_PLACES) throw new BadRequest(`A company can have up to ${CHECKIN_MAX_PLACES} check-in places. Archive one first.`);
        row = { id: `cp-${input.companyId}-${toMs(at)}`, companyId: input.companyId, ...fields, active: true, createdAt: at, createdBy: user.name, updatedAt: at, updatedBy: user.name };
        await tx.insert('checkinPlaces', row);
      }
      await tx.audit({
        at,
        actor: user.name,
        companyId: input.companyId,
        action: 'checkin.place_save',
        entity: 'checkin_place',
        entityId: row.id,
        summary: `${input.id ? 'Changed' : 'Added'} check-in place ${name}: ${fields.lat}, ${fields.lng}, within ${r} m`,
      });
      return row;
    });
  }

  /** Archive a place (nobody checks in at it any more) or bring it back. Its history stays. */
  async setPlaceActive(user: User, id: Id, active: boolean): Promise<CheckinPlace> {
    const p = await this.store.get('checkinPlaces', id);
    if (!p) throw new NotFound('Check-in place');
    this.editable(user, p.companyId);
    const at = this.clock();
    return this.store.transaction(async (tx) => {
      const row = await tx.update('checkinPlaces', id, { active, updatedAt: at, updatedBy: user.name });
      await tx.audit({ at, actor: user.name, companyId: p.companyId, action: active ? 'checkin.place_restore' : 'checkin.place_archive', entity: 'checkin_place', entityId: id, summary: `${active ? 'Restored' : 'Archived'} check-in place ${p.name}` });
      return row;
    });
  }

  /** A company's choice for check-ins outside the allowed area. */
  async setPolicy(user: User, companyId: Id, outOfArea: CheckinPolicy) {
    this.editable(user, companyId);
    if (!POLICIES.includes(outOfArea)) throw new BadRequest('Choose block or allow with a reason.');
    const at = this.clock();
    return this.store.transaction(async (tx) => {
      const row = { id: companyId, companyId, outOfArea, updatedAt: at, updatedBy: user.name };
      if (await tx.get('checkinSettings', companyId)) await tx.update('checkinSettings', companyId, row);
      else await tx.insert('checkinSettings', row);
      await tx.audit({
        at,
        actor: user.name,
        companyId,
        action: 'checkin.policy',
        entity: 'checkin_settings',
        entityId: companyId,
        summary: outOfArea === 'block' ? 'Check-ins outside the allowed area are now refused' : 'Check-ins outside the allowed area are now taken with a reason and flagged',
      });
      return row;
    });
  }

  private cleanRule(input: CheckinRuleInput): Omit<CheckinRule, 'id' | 'userId' | 'userName' | 'companyId' | 'updatedAt' | 'updatedBy'> {
    if (!RULE_KINDS.includes(input.kind)) throw new BadRequest('Choose the company office, a specific place, or flexible field work.');
    const note = text(input.note, 300);
    if (input.kind === 'office') return { kind: 'office', placeId: null, zones: [], outstationWeekdays: [], outstation: [], note };
    if (input.kind === 'place') {
      if (typeof input.placeId !== 'string' || !input.placeId) throw new BadRequest('Choose the place.');
      return { kind: 'place', placeId: input.placeId, zones: [], outstationWeekdays: [], outstation: [], note };
    }
    const zones = (Array.isArray(input.zones) ? input.zones : []).map((z, i) => {
      const label = text(z?.label, 80);
      const r = Math.round(Number(z?.radiusM));
      if (!label) throw new BadRequest(`Name zone ${i + 1}, for example "Kuantan and around".`);
      if (!validLatLng(z?.lat, z?.lng)) throw new BadRequest(`Set where zone ${i + 1} is on the map.`);
      if (!Number.isFinite(r) || r < CHECKIN_ZONE_RADIUS.min || r > CHECKIN_ZONE_RADIUS.max)
        throw new BadRequest(`Zone ${i + 1}: the radius must be between ${CHECKIN_ZONE_RADIUS.min} m and ${CHECKIN_ZONE_RADIUS.max / 1000} km.`);
      return { label, lat: Math.round(z.lat * 1e6) / 1e6, lng: Math.round(z.lng * 1e6) / 1e6, radiusM: r };
    });
    if (!zones.length) throw new BadRequest('Add at least one working area for field work.');
    if (zones.length > CHECKIN_MAX_ZONES) throw new BadRequest(`Up to ${CHECKIN_MAX_ZONES} working areas.`);
    const days = [...new Set(Array.isArray(input.outstationWeekdays) ? input.outstationWeekdays : [])];
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new BadRequest('Outstation weekdays are 1 (Monday) to 7 (Sunday).');
    const outstation = (Array.isArray(input.outstation) ? input.outstation : []).map((o, i) => {
      if (!isRealDate(o?.from) || !isRealDate(o?.to) || o.from > o.to) throw new BadRequest(`Outstation trip ${i + 1}: give a real start and end date, the start first.`);
      return { from: o.from, to: o.to, note: text(o.note, 200) };
    });
    if (outstation.length > CHECKIN_MAX_OUTSTATION) throw new BadRequest(`Up to ${CHECKIN_MAX_OUTSTATION} outstation trips; remove past ones first.`);
    return { kind: 'field', placeId: null, zones, outstationWeekdays: days.sort(), outstation: outstation.sort((a, b) => a.from.localeCompare(b.from)), note };
  }

  /**
   * Set where people check in, one person or many at once (a department in bulk). Nobody sets their own: a person who
   * sets places and rules still has theirs set by someone else.
   */
  async setRules(user: User, userIds: Id[], input: CheckinRuleInput) {
    const s = this.scope(user);
    const ids = [...new Set(Array.isArray(userIds) ? userIds.filter((x) => typeof x === 'string') : [])];
    if (!ids.length) throw new BadRequest('Choose at least one staff member.');
    if (ids.length > 1000) throw new BadRequest('Up to 1,000 staff at a time.');
    if (ids.includes(user.id)) throw new BadRequest('Someone else sets where you check in.');
    const rule = this.cleanRule(input);
    const place = rule.placeId ? await this.store.get('checkinPlaces', rule.placeId) : null;
    if (rule.kind === 'place' && (!place || !place.active)) throw new BadRequest('That place is not available. Choose an active place.');
    const targets = await this.store.list('users', { id: ids });
    if (targets.length !== ids.length) throw new NotFound('Staff member');
    const persons = new Map((await this.store.list('people', { id: targets.map((u) => u.personId).filter((x): x is Id => !!x) })).map((p) => [p.id, p]));
    const rows = targets.map((u) => {
      if (!this.deps.allowed(u)) throw new BadRequest(`${u.name} clocks in on the site device, not with a check-in.`);
      const companyId = checkinCompanyOf(u, u.personId ? persons.get(u.personId)?.companyId : null);
      if (!this.inScope(s, companyId) || !mayEditCheckin(user, companyId)) throw new AccessDenied('hr.monitor', `(where ${u.name} checks in)`);
      if (place && place.companyId !== companyId) throw new BadRequest(`${place.name} belongs to another company than ${u.name}'s. Choose a place of their company.`);
      return { u, companyId };
    });
    const at = this.clock();
    const label = rule.kind === 'office' ? 'the company office' : rule.kind === 'place' ? place!.name : `field work in ${rule.zones.map((z) => z.label).join(', ')}`;
    await this.store.transaction(async (tx) => {
      for (const { u, companyId } of rows) {
        const row: CheckinRule = { id: u.id, userId: u.id, userName: u.name, companyId, ...rule, updatedAt: at, updatedBy: user.name };
        const old = await tx.get('checkinRules', u.id);
        if (old) await tx.update('checkinRules', u.id, row);
        else await tx.insert('checkinRules', row);
        await tx.audit({ at, actor: user.name, companyId, action: 'checkin.rule', entity: 'checkin_rule', entityId: u.id, summary: `${u.name} now checks in at ${label}${rule.note ? `: ${rule.note}` : ''}` });
      }
    });
    return { updated: rows.length };
  }

  /** A company's sites, to add as a field worker's working area. */
  async sites(user: User, companyId: Id) {
    this.editable(user, companyId);
    return (await this.store.list('sites', { companyId }))
      .filter((x) => validLatLng(x.lat, x.lng))
      .map((x) => ({ id: x.id, code: x.code, name: x.name, lat: x.lat, lng: x.lng, radiusM: Math.max(CHECKIN_ZONE_RADIUS.min, Math.round(x.geofenceM || 0)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every check-in and check-out of a day, for the Staff clock board. */
  async day(user: User, date?: IsoDate) {
    const s = this.scope(user);
    const d = date && isRealDate(date) ? date : this.today();
    const events = (await this.store.list('checkinEvents', {}, { field: 'at', from: d, before: addDays(d, 1) })).filter((e) => this.inScope(s, e.companyId));
    return { date: d, events: events.sort((a, b) => a.at.localeCompare(b.at)) };
  }

  /** Check-ins outside the allowed area for the manager or HR: open first, then the last 30 days' decisions. */
  async reviews(user: User) {
    const s = this.scope(user);
    const since = addDays(this.today(), -60);
    const recent = addDays(this.today(), -30);
    const all = (await this.store.list('checkinEvents', {}, { field: 'at', from: since })).filter((e) => e.review && this.inScope(s, e.companyId));
    const row = (e: CheckinEvent) => ({ ...e, own: e.userId === user.id });
    return {
      open: all.filter((e) => e.review!.status === 'open').sort((a, b) => b.at.localeCompare(a.at)).map(row),
      decided: all
        .filter((e) => e.review!.status !== 'open' && (e.review!.at ?? '') >= recent)
        .sort((a, b) => (b.review!.at ?? '').localeCompare(a.review!.at ?? ''))
        .slice(0, 100)
        .map(row),
    };
  }

  /** The manager or HR closes a flagged check-in: reason accepted, or not (a follow-up), always with a comment. */
  async decide(user: User, id: Id, decision: 'cleared' | 'upheld', note: string) {
    const s = this.scope(user);
    if (decision !== 'cleared' && decision !== 'upheld') throw new BadRequest('Choose accept the reason or follow up.');
    const e = await this.store.get('checkinEvents', id);
    if (!e || !this.inScope(s, e.companyId)) throw new NotFound('Check-in');
    if (e.userId === user.id) throw new BadRequest('Someone else reviews your own check-ins.');
    if (e.review?.status !== 'open') throw new BadRequest('This check-in was already reviewed.');
    const why = requireApprovalReason(note, decision === 'cleared' ? 'accept the reason' : 'follow it up');
    const at = this.clock();
    return this.store.transaction(async (tx) => {
      const row = await tx.update('checkinEvents', id, { review: { status: decision, by: user.name, byId: user.id, at, note: why } });
      await tx.audit({
        at,
        actor: user.name,
        companyId: e.companyId,
        action: 'checkin.review',
        entity: 'checkin_event',
        entityId: id,
        summary: `${e.userName}'s check-${e.kind} on ${hhmm(e.at)} ${dateOf(e.at)} outside the area: ${decision === 'cleared' ? 'reason accepted' : 'followed up'}: ${why}`,
      });
      return row;
    });
  }
}
