// P81 (staff check-in by place, 6 Nov 2026). The owner: "all staff will be using this to login and checkin ... HR/manager
// will determine the staff radius location, which radius they are allowed to checkin and which are not allowed ... for
// on-ground operations staff the HR can set their flexibility, cause they will need to go to outstation".
//
// The pure rules live here (distance, which places a person may check in at, outstation days, the out-of-area outcome,
// who may set them), so the service, the API and the tests all read the same thing. The server always decides: a verdict
// sent by the phone is never read.
import { CENTRAL_EMPLOYER_IDS, GROUP_EMPLOYER_ID, isCentralEmployer, isGroupLeader, isGroupRole, isOwnerAdmin } from './access';
import { hrKeeps } from './hr';
import { weekdayOf } from './remote';
import type { FaceCapture, Id, IsoDate, IsoDateTime, User } from './types';

/** An office's allowed radius when HR does not set one (the owner's brief: 150 m). */
export const CHECKIN_DEFAULT_RADIUS_M = 150;
/** An office or place radius: small enough to mean "at the office", large enough for a big compound. */
export const CHECKIN_PLACE_RADIUS = { min: 25, max: 5_000 } as const;
/** A field zone radius: from a single site (100 m) to a whole region (300 km). */
export const CHECKIN_ZONE_RADIUS = { min: 100, max: 300_000 } as const;
/** A reading rougher than this is refused and the phone asked to try again; it is never accepted quietly. */
export const CHECKIN_MAX_ACCURACY_M = 100;
/** The shortest reason accepted for an out-of-area check-in. */
export const CHECKIN_REASON_MIN = 5;
export const CHECKIN_MAX_PLACES = 50;
export const CHECKIN_MAX_ZONES = 12;
export const CHECKIN_MAX_OUTSTATION = 24;

export interface LatLng {
  lat: number;
  lng: number;
}

/** One office or check-in place of a company, set on the Check-in places screen with a pin on the map. */
export interface CheckinPlace {
  id: Id;
  companyId: Id;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** Archived places stay for the history of earlier check-ins; nobody checks in at them. */
  active: boolean;
  createdAt: IsoDateTime;
  createdBy: string;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

/** A circle a field worker may check in inside: a state capital with 50 km, or a site they cover. */
export interface CheckinZone {
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
}

/** Days a field worker is away outstation: anywhere is allowed that day, and still recorded. */
export interface CheckinOutstation {
  from: IsoDate;
  to: IsoDate;
  note: string;
}

export type CheckinRuleKind = 'office' | 'place' | 'field';

/** Where one staff member may check in. No rule means their company's offices. */
export interface CheckinRule {
  /** The staff member's user id: one rule per person. */
  id: Id;
  userId: Id;
  userName: string;
  companyId: Id;
  kind: CheckinRuleKind;
  /** kind 'place': the one place they check in at. */
  placeId: Id | null;
  /** kind 'field': their working area. */
  zones: CheckinZone[];
  /** kind 'field': weekdays they are outstation every week, 1 Monday to 7 Sunday. */
  outstationWeekdays: number[];
  /** kind 'field': dated outstation trips. */
  outstation: CheckinOutstation[];
  note: string;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export type CheckinPolicy = 'block' | 'flag';

/** A company's choice for a check-in outside the allowed area: refuse it, or take it with a reason and flag it. */
export interface CheckinSettings {
  /** The company id. */
  id: Id;
  companyId: Id;
  outOfArea: CheckinPolicy;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export type CheckinVerdict = 'in_area' | 'out_of_area' | 'no_place';
export type CheckinOutcome = 'accepted' | 'flagged' | 'blocked';
/** 'pending': the address lookup is still running; 'none': it found nothing or failed; 'off': no lookup here. */
export type CheckinAddressStatus = 'found' | 'pending' | 'none' | 'off';

export interface CheckinTarget extends CheckinZone {
  /** Where the circle came from. */
  source: 'place' | 'zone' | 'base';
  placeId?: Id;
}

export interface CheckinMatch {
  label: string;
  distanceM: number;
  radiusM: number;
  /** Metres beyond the edge of the circle; 0 inside it. */
  outsideByM: number;
}

/** One check-in or check-out: where the phone was, what the server decided and, if flagged, the review. */
export interface CheckinEvent {
  id: Id;
  userId: Id;
  userName: string;
  companyId: Id;
  kind: 'in' | 'out';
  /** The staff clock this belongs to (null for a blocked attempt). */
  clockId: Id | null;
  /** Server time. */
  at: IsoDateTime;
  /** The phone's time, kept beside the server's. */
  capturedAt: IsoDateTime;
  lat: number;
  lng: number;
  accuracyM: number;
  address: string | null;
  addressStatus: CheckinAddressStatus;
  verdict: CheckinVerdict;
  /** Which rule applied: the company's offices, one place, a field area, the older personal base, or none set. */
  rule: CheckinRuleKind | 'base' | 'none';
  outstation: boolean;
  matched: CheckinMatch | null;
  nearest: CheckinMatch | null;
  /** The circles checked, kept with the record so a later change of rule does not rewrite history. */
  targets: CheckinTarget[];
  outcome: CheckinOutcome;
  reason: string | null;
  /** The face check done with this check-in, scored on the server; null when none was done here. */
  face: FaceCapture | null;
  review: { status: 'open' | 'cleared' | 'upheld'; by: string | null; byId: Id | null; at: IsoDateTime | null; note: string } | null;
}

export interface CheckinEvaluation {
  verdict: CheckinVerdict;
  rule: CheckinEvent['rule'];
  outstation: boolean;
  matched: CheckinMatch | null;
  nearest: CheckinMatch | null;
  targets: CheckinTarget[];
}

/** Great-circle distance in metres, unrounded (the edge of a circle is decided on the exact figure). */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_008.8;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validLatLng(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Why a reading cannot be used, or null. Missing accuracy counts as unknown, so as too rough. */
export function accuracyProblem(accuracyM: number | null | undefined): string | null {
  if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM < 0)
    return 'Your phone did not say how accurate the location is. Turn on precise location and try again.';
  if (accuracyM > CHECKIN_MAX_ACCURACY_M)
    return `Your location is only accurate to about ${Math.round(accuracyM)} m (it must be within ${CHECKIN_MAX_ACCURACY_M} m). Move near a window or outside, turn on precise location, and try again.`;
  return null;
}

/** Who sets check-in places and rules: the owner, group leadership and HR for every company; a company manager for theirs. */
export function checkinScope(user: User): 'all' | Id[] | null {
  if (user.integration) return null;
  if (isOwnerAdmin(user) || isGroupLeader(user) || hrKeeps(user)) return 'all';
  if (user.role === 'company_manager') return user.companyIds;
  return null;
}

export function mayEditCheckin(user: User, companyId: Id): boolean {
  const s = checkinScope(user);
  return s === 'all' || (s !== null && s.includes(companyId));
}

/**
 * The company a person checks in for. Company staff: their home company. Central staff (PWVSB, Merdeka Network, Goodwill
 * Empire, Sasa Team): the central employer on their staff record, or PWVSB.
 */
export function checkinCompanyOf(user: User, personCompanyId?: Id | null): Id {
  if (isGroupRole(user)) {
    if (personCompanyId && isCentralEmployer(personCompanyId)) return personCompanyId;
    return user.companyIds.find((c) => CENTRAL_EMPLOYER_IDS.includes(c)) ?? GROUP_EMPLOYER_ID;
  }
  return user.homeCompanyId ?? user.companyIds[0] ?? GROUP_EMPLOYER_ID;
}

/** Whether a field worker is outstation on this date (a dated trip or a weekly outstation day). */
export function isOutstation(rule: Pick<CheckinRule, 'kind' | 'outstation' | 'outstationWeekdays'> | null | undefined, date: IsoDate): boolean {
  if (!rule || rule.kind !== 'field') return false;
  if (rule.outstationWeekdays.includes(weekdayOf(date))) return true;
  return rule.outstation.some((o) => o.from <= date && date <= o.to);
}

/** The circles a person may check in inside today, and which rule gave them. */
export function checkinTargets(
  rule: CheckinRule | null | undefined,
  places: CheckinPlace[],
  base: User['base'] | null | undefined,
): { rule: CheckinEvent['rule']; targets: CheckinTarget[] } {
  const offices = places.filter((p) => p.active).map(placeTarget);
  if (rule?.kind === 'place') {
    const p = places.find((x) => x.id === rule.placeId && x.active);
    if (p) return { rule: 'place', targets: [placeTarget(p)] };
    // The chosen place was archived: the person falls back to their company's offices, never to "anywhere".
  }
  if (rule?.kind === 'field') {
    // A field worker may also check in at the company's own offices.
    return { rule: 'field', targets: [...rule.zones.map((z) => ({ ...z, source: 'zone' as const })), ...offices] };
  }
  if (offices.length) return { rule: 'office', targets: offices };
  if (base) return { rule: 'base', targets: [{ label: base.name, lat: base.lat, lng: base.lng, radiusM: base.radiusM, source: 'base' }] };
  return { rule: 'none', targets: [] };
}

function placeTarget(p: CheckinPlace): CheckinTarget {
  return { label: p.name, lat: p.lat, lng: p.lng, radiusM: p.radiusM, source: 'place', placeId: p.id };
}

/** In or out of the allowed area. The edge counts as inside (distance equal to the radius). */
export function evaluateCheckin(input: {
  lat: number;
  lng: number;
  date: IsoDate;
  rule: CheckinRule | null | undefined;
  places: CheckinPlace[];
  base?: User['base'] | null;
}): CheckinEvaluation {
  const { rule, targets } = checkinTargets(input.rule, input.places, input.base);
  const outstation = isOutstation(input.rule, input.date);
  const scored = targets.map((t) => {
    const d = haversineM(input, t);
    return { t, d, m: { label: t.label, distanceM: Math.round(d), radiusM: t.radiusM, outsideByM: Math.max(0, Math.round(d - t.radiusM)) } };
  });
  const inside = scored.filter((s) => s.d <= s.t.radiusM).sort((a, b) => a.d - b.d);
  const nearest = [...scored].sort((a, b) => a.d - a.t.radiusM - (b.d - b.t.radiusM))[0] ?? null;
  const matched = inside[0]?.m ?? null;
  const verdict: CheckinVerdict = matched || outstation ? 'in_area' : targets.length ? 'out_of_area' : 'no_place';
  return { verdict, rule, outstation: outstation && !matched, matched, nearest: nearest?.m ?? null, targets: targets.slice(0, CHECKIN_MAX_ZONES + CHECKIN_MAX_PLACES) };
}

/**
 * What happens to a check-in: inside the area (or no place set yet) it is taken; outside it is refused when the company
 * blocks, otherwise taken with a reason and flagged for review. A check-out is never refused (nobody is trapped at
 * work), only flagged with a reason.
 */
export function checkinDecision(verdict: CheckinVerdict, policy: CheckinPolicy, kind: 'in' | 'out'): { outcome: CheckinOutcome; reasonNeeded: boolean } {
  if (verdict !== 'out_of_area') return { outcome: 'accepted', reasonNeeded: false };
  if (kind === 'in' && policy === 'block') return { outcome: 'blocked', reasonNeeded: false };
  return { outcome: 'flagged', reasonNeeded: true };
}

/** What is recorded and why, shown before every check-in (PDPA notice). */
export const CHECKIN_NOTICE: string[] = [
  'When you check in or out, Prima records your location (latitude, longitude and how accurate it is), the server time and the street address found for that point.',
  'Your location is taken only at check-in and check-out. It is not followed in between, except the clock location readings you already agreed to.',
  'Your company uses it to confirm you work where you are allowed to, and to prevent false check-ins. Your manager and HR see it; check-ins outside your area are flagged for them to review.',
  'The address is looked up through OpenStreetMap from our server; your phone does not contact it. You may ask the PDPA officer for a copy or a correction of your records.',
];

/** State capitals and federal territories, as quick starting points for a field zone (approximate city centres). */
export const STATE_CAPITALS: { state: string; city: string; lat: number; lng: number }[] = [
  { state: 'Kuala Lumpur', city: 'Kuala Lumpur', lat: 3.139, lng: 101.6869 },
  { state: 'Putrajaya', city: 'Putrajaya', lat: 2.9264, lng: 101.6964 },
  { state: 'Selangor', city: 'Shah Alam', lat: 3.0733, lng: 101.5185 },
  { state: 'Johor', city: 'Johor Bahru', lat: 1.4927, lng: 103.7414 },
  { state: 'Kedah', city: 'Alor Setar', lat: 6.1248, lng: 100.3678 },
  { state: 'Perlis', city: 'Kangar', lat: 6.4414, lng: 100.1986 },
  { state: 'Kelantan', city: 'Kota Bharu', lat: 6.1254, lng: 102.2381 },
  { state: 'Melaka', city: 'Melaka', lat: 2.1896, lng: 102.2501 },
  { state: 'Negeri Sembilan', city: 'Seremban', lat: 2.7259, lng: 101.9424 },
  { state: 'Pahang', city: 'Kuantan', lat: 3.8077, lng: 103.326 },
  { state: 'Perak', city: 'Ipoh', lat: 4.5975, lng: 101.0901 },
  { state: 'Pulau Pinang', city: 'George Town', lat: 5.4141, lng: 100.3288 },
  { state: 'Sabah', city: 'Kota Kinabalu', lat: 5.9804, lng: 116.0735 },
  { state: 'Sarawak', city: 'Kuching', lat: 1.5535, lng: 110.3593 },
  { state: 'Terengganu', city: 'Kuala Terengganu', lat: 5.3302, lng: 103.1408 },
  { state: 'Labuan', city: 'Labuan', lat: 5.2831, lng: 115.2308 },
];
