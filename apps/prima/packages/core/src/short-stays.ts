// Part P19-P39 (Fitri package, Fauzan 14 Nov 2026): short stays on the Asset Management homestay houses. One booking
// engine (the resort front desk, am-extras), one calendar per house, three channels: direct homestay bookings (papers
// K1-K4, PRWM-UPA 2026/017), Airbnb bookings (K5-K8, 2026/018) and staff stays for Government Operations and HQ
// departments (H1-H4, 2026/015; answer 30: staff houses ARE the homestay houses). Cleaning, complaints and inventory
// follow the three draft SOPs (2026-11-14 short-stay SOPs A, B, C); every number is a setting the Asset Director changes.
// Fauzan's answers 30-35 and 37-51 (14 Nov 2026 03:12Z) and SOP-1..4 (03:26Z) decide the rules here.
//
// Not here: the foreign worker hostels (fw-moves.ts, FWM) and rental tenancies (Part V). Prima never logs in to
// Airbnb, sends WhatsApp, or links a platform calendar: those stay off until separately verified.

import { isOgm, isOpsDirector } from './ops-access';
import { AccessDenied, assetRole } from './access';
import { bookingBill, bookingHolds, bookingPaid, cancelSettlement, isDate, isHhmm, maskPhone, nights, nightsTaken, sellable } from './am-extras';
import type { AmBooking, AmStaySetup, AmStayTerms } from './am-extras';
import { sha256Hex } from './audit';
import { addWorkingDaysExcept, photoList } from './fw-moves';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { addDays, dateOf, daysBetween, toMs } from './time';
import { registerWall } from './walls';
import type { AmProperty, AmWorkOrder, Id, IsoDate, IsoDateTime, User } from './types';

type Body = Record<string, unknown>;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);
const why = (v: unknown, what = 'Say why') => {
  const s = text(v, 500);
  if (s.length < 5) throw new BadRequest(`${what} (a few words).`);
  return s;
};

// ---------- Types ----------

export const SS_CHANNELS = ['DIRECT', 'AIRBNB', 'OTHER', 'STAFF'] as const;
export type SsChannel = (typeof SS_CHANNELS)[number];
export const SS_CHANNEL_LABEL: Record<SsChannel, string> = { DIRECT: 'Direct homestay', AIRBNB: 'Airbnb', OTHER: 'Other platform', STAFF: 'Staff stay' };
export const SS_RATE_BASES = ['PER_UNIT_NIGHT', 'PER_PERSON_NIGHT', 'PER_PERSON_STAY', 'PER_PERSON_MONTH'] as const;
export type SsRateBasis = (typeof SS_RATE_BASES)[number];
export const SS_KEY_METHODS = ['KEY', 'LOCKBOX', 'SMART_LOCK'] as const;
export const AIRBNB_CANCEL = ['FLEXIBLE', 'MODERATE', 'FIRM', 'STRICT'] as const;

/** SOP A4 cleaning checklist and the H3 sec. 10 / K7 step 8 inspection list (one tick + photo per area). */
export const SS_CHECKLIST = [
  'Building, doors and windows',
  'Living room',
  'Bedrooms and linen',
  'Toilets and water heater',
  'Kitchen and utensils',
  'Corridor and balcony',
  'Water and electricity',
  'Air-con, fans and Wi-Fi',
  'Keys / lock / access code',
  'Safety items (smoke detector, fire extinguisher, emergency card)',
  'Inventory against the house list',
  'Existing damage noted',
] as const;

export interface SsInventoryLine {
  item: string;
  qty: number;
  room: string;
  /** Replacement value for damage claims (RM). */
  value: number;
  condition: 'good' | 'worn' | 'damaged';
}

/** A homestay house's short-stay set-up (P19, P26, P32, P34, P36). Kept on the property's stay set-up. */
export interface SsHouse {
  /** One use at a time (answer 33): a rental tenancy takes the house out of every short-stay channel. */
  use: 'SHORT_STAY' | 'RENTAL';
  beds: number;
  maxGuests: number;
  keys: number;
  keyMethod: (typeof SS_KEY_METHODS)[number];
  /** Housekeeping status of the whole house (dirty -> clean -> inspected). */
  hk: 'dirty' | 'clean' | 'inspected';
  hkBy: string;
  hkById: Id | null;
  hkAt: IsoDateTime;
  /** An open safety defect blocks hand-over (H1 4.4, SOP A3 step 9). */
  safetyDefect: { note: string; workOrderId: Id | null; by: string; at: IsoDateTime } | null;
  /** Outside platforms the house is listed on (P32); each held booking needs a "blocked on" tick for every one. */
  platforms: string[];
  airbnb: { listed: boolean; listing: string; cancelPolicy: (typeof AIRBNB_CANCEL)[number] } | null;
  /** Direct homestay deposit, % of the stay (answer 37 default 50). */
  depositPct: number;
  /** Refundable damage deposit, default OFF (answer 39). */
  damageDeposit: number | null;
  rules: string[];
  licence: { name: string; number: string; expiresOn: IsoDate | null } | null;
  inventory: SsInventoryLine[];
  /** For the deep clean every 3 months or 20 stays (SOP A2 c). */
  lastDeepCleanOn: IsoDate | null;
  staysSinceDeepClean: number;
  lastFullCountOn: IsoDate | null;
  setBy: string;
  setAt: IsoDateTime;
}

export interface SsSettings {
  id: 'ss-settings';
  kind: 'settings';
  /** Staff stay rate (answer 30): RM300 a person a night, dated; the Asset Director may change the basis. */
  staffRates: { from: IsoDate; amount: number; basis: SsRateBasis; by: string; reason: string }[];
  /** The staff stay papers' step times (H2 table), hours. */
  staffStepHours: { request: number; check: number; prepare: number; keysIn: number; clean: number; record: number };
  holdWorkingDays: number;
  freeCancelDays: number;
  lateCancelKeepPct: number;
  noShowKeepPct: number;
  fullPayDaysBefore: number;
  followUpDaysBefore: number;
  prepareDaysBefore: number;
  lateKeysHours: number;
  airbnbAnswerHours: number;
  payoutWorkingDays: number;
  payoutDiffRm: number;
  claimDeadlineDays: number;
  claimRemindDaysBefore: number;
  complaintAnswerHours: { URGENT: number; NORMAL: number; REVIEW: number };
  complaintCloseDays: number;
  /** Goodwill refund the Asset Director may approve: up to one night's rate or this, whichever is lower (SOP-3). */
  goodwillCapRm: number;
  deepCleanMonths: number;
  deepCleanStays: number;
  fullCountMonths: number;
  countDiffRm: number;
  /** Deputies who may close complaints with the Asset Director (by user; named in the app). */
  deputyIds: Id[];
  by: string;
  at: IsoDateTime;
}

export const SS_DEFAULTS: Omit<SsSettings, 'by' | 'at'> = {
  id: 'ss-settings',
  kind: 'settings',
  staffRates: [{ from: '2026-10-01', amount: 300, basis: 'PER_PERSON_NIGHT', by: 'Policy PRWM-UPA/POL/2026/015 (answer 30)', reason: 'RM300 a person a night, company pays' }],
  staffStepHours: { request: 0.17, check: 0.17, prepare: 16, keysIn: 1, clean: 16, record: 2 },
  holdWorkingDays: 3,
  freeCancelDays: 7,
  lateCancelKeepPct: 50,
  noShowKeepPct: 100,
  fullPayDaysBefore: 3,
  followUpDaysBefore: 7,
  prepareDaysBefore: 3,
  lateKeysHours: 2,
  airbnbAnswerHours: 20,
  payoutWorkingDays: 5,
  payoutDiffRm: 1,
  claimDeadlineDays: 14,
  claimRemindDaysBefore: 4,
  complaintAnswerHours: { URGENT: 0.5, NORMAL: 24, REVIEW: 72 },
  complaintCloseDays: 7,
  goodwillCapRm: 300,
  deepCleanMonths: 3,
  deepCleanStays: 20,
  fullCountMonths: 3,
  countDiffRm: 500,
  deputyIds: [],
};

export interface SsSign {
  by: string;
  byId: Id;
  at: IsoDateTime;
}
export interface SsDamage {
  id: Id;
  what: string;
  amount: number;
  inventoryItem: string | null;
  photo: { sha256: string; data: string };
  /** The Asset Director's finding: negligence, misuse or the occupant's act, not wear and tear. */
  reason: string;
  decided: SsSign;
  /** Staff stay: the staff member it is recovered from, who must acknowledge it first (answer 32). */
  staffUserId: Id | null;
  ack: (SsSign & { consent: string }) | null;
  /** Airbnb: claimed through Airbnb only (answer 49). */
  claim: { filedOn: IsoDate; caseNo: string; deadline: IsoDate; outcome: 'open' | 'paid' | 'part' | 'refused'; received: number; banked: { on: IsoDate; slipRef: string; by: string } | null } | null;
}

/** The short-stay part of a booking (P20-P38). The booking itself is the occupant record (H3 step 8). */
export interface SsBookingInfo {
  channel: SsChannel;
  platform: string;
  platformRef: string;
  purpose: string;
  /** Private stays pay upfront (answer 34); work stays are billed to the department. */
  work: boolean;
  needs: string;
  consent: SsSign | null;
  requestId: Id | null;
  checked: (SsSign & { ok: boolean; note: string }) | null;
  customer: (SsSign & { confirmed: boolean; note: string }) | null;
  blocked: Record<string, SsSign>;
  followUp: (SsSign & { arrival: string; note: string }) | null;
  prepared: (SsSign & { ticks: string[]; photos: { sha256: string; data: string }[] }) | null;
  keyException: (SsSign & { reason: string }) | null;
  keysOut: (SsSign & { n: number; to: string }) | null;
  keysBack: (SsSign & { n: number; lost: number; note: string }) | null;
  after: (SsSign & { ticks: string[]; photos: { sha256: string; data: string }[]; missing: string[] }) | null;
  /** Access code for a lockbox or smart lock: team only, never in history, audit or messages to other staff. */
  accessCode: string | null;
  codeChanged: SsSign | null;
  damages: SsDamage[];
  lateNights: { nights: number; waived: string | null; by: string; at: IsoDateTime } | null;
  hostCancel: (SsSign & { reason: string }) | null;
  goodwill: (SsSign & { amount: number; reason: string; approver: 'asset_director' | 'coo' }) | null;
  airbnb: {
    code: string;
    guestName: string;
    guestTotal: number;
    hostFee: number;
    taxKept: number;
    expectedPayout: number;
    copy: { sha256: string; data: string } | null;
    requestAt: IsoDateTime;
    answered: (SsSign & { accepted: boolean }) | null;
    cancelPolicy: string;
    payoutId: Id | null;
  } | null;
  closed: SsSign | null;
}

export type StayRequestStatus = 'submitted' | 'returned' | 'not_available' | 'held' | 'confirmed' | 'in_stay' | 'done' | 'cancelled';
/** A staff stay request from Government Operations or an HQ department (P20). Seen by the applicant and occupants. */
export interface StayRequest {
  id: Id;
  ref: string;
  requesterId: Id;
  requester: string;
  department: string;
  propertyId: Id | null;
  town: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  persons: number;
  purpose: string;
  purposeNote: string;
  occupants: { userId: Id | null; name: string; phone: string }[];
  occupantUserIds: Id[];
  keyReceiver: string;
  /** Work stays are billed to the department; private stays pay by transfer with proof (answer 34). */
  work: boolean;
  proof: { sha256: string; data: string } | null;
  price: number;
  status: StayRequestStatus;
  bookingId: Id | null;
  note: string;
  /** Damage lines the occupants must acknowledge (copied from the booking; no other booking detail). */
  damages: { id: Id; what: string; amount: number; photoSha: string; reason: string; staffUserId: Id | null; ack: (SsSign & { consent: string }) | null }[];
  /** SOP B6: the requesting department raises a complaint on its own stay; the Asset team logs it with a number. */
  complaints?: { at: IsoDateTime; by: string; level: SsComplaintLevel; what: string; loggedRef: string | null }[];
  history: { at: IsoDateTime; by: string; what: string }[];
  at: IsoDateTime;
}

export interface SsEnquiry {
  id: Id;
  kind: 'enquiry';
  propertyId: Id | null;
  channel: string;
  from: IsoDate;
  to: IsoDate;
  guests: number;
  answer: 'available' | 'not_available' | 'other_dates';
  wentOn: boolean;
  by: string;
  at: IsoDateTime;
}
export interface SsPayout {
  id: Id;
  kind: 'payout';
  on: IsoDate;
  amount: number;
  bankRef: string;
  account: string;
  report: { sha256: string; name: string } | null;
  lines: { bookingId: Id; code: string; guestTotal: number; hostFee: number; taxKept: number; net: number }[];
  diff: number;
  explained: string;
  status: 'recorded' | 'confirmed';
  by: string;
  at: IsoDateTime;
  confirmed: (SsSign & { slipRef: string }) | null;
}
export type SsComplaintLevel = 'URGENT' | 'NORMAL' | 'REVIEW';
export interface SsComplaint {
  id: Id;
  kind: 'complaint';
  ref: string;
  level: SsComplaintLevel;
  bookingId: Id | null;
  propertyId: Id | null;
  channel: string;
  from: string;
  what: string;
  stars: number | null;
  /** The staff member complained about (never closes it). */
  aboutUserId: Id | null;
  raisedById: Id;
  raisedBy: string;
  at: IsoDateTime;
  answered: (SsSign & { note: string }) | null;
  investigatedBy: string;
  action: string;
  status: 'open' | 'closed';
  closed: (SsSign & { note: string }) | null;
}
export interface SsClean {
  id: Id;
  kind: 'clean';
  propertyId: Id;
  bookingId: Id | null;
  type: 'TURNOVER' | 'FINAL' | 'DEEP' | 'NEEDED';
  cleaner: string;
  vendor: string;
  start: IsoDateTime;
  finish: IsoDateTime;
  ticks: string[];
  photos: { sha256: string; data: string }[];
  by: string;
  byId: Id;
  checked: SsSign | null;
  at: IsoDateTime;
}
export interface SsRecovery {
  id: Id;
  kind: 'recovery';
  userId: Id;
  personId: Id | null;
  name: string;
  bookingId: Id;
  damageId: Id;
  amount: number;
  consent: string;
  ackAt: IsoDateTime;
  status: 'due' | 'recovered';
  recovered: { period: string; by: string; at: IsoDateTime } | null;
}
export interface SsCount {
  id: Id;
  kind: 'count';
  propertyId: Id;
  lines: { item: string; listed: number; counted: number; value: number }[];
  diffValue: number;
  photos: { sha256: string; data: string }[];
  counted: SsSign;
  verified: SsSign | null;
  note: string;
  at: IsoDateTime;
}
export interface SsCleanerChoice {
  id: Id;
  kind: 'cleaner';
  area: string;
  options: { name: string; own: boolean; turnover: number; deep: number; linen: number; travel: number; responseHours: number }[];
  picked: (SsSign & { name: string; reason: string }) | null;
  by: string;
  at: IsoDateTime;
}
export type SsRec = SsSettings | SsEnquiry | SsPayout | SsComplaint | SsClean | SsRecovery | SsCount | SsCleanerChoice;

/** The consent wording on the staff acknowledgement screen (answer 32; Employment Act s.24 written consent). */
export const SS_DEDUCTION_CONSENT =
  'Saya mengaku kerosakan / kehilangan ini dan bersetuju jumlah di atas dipotong daripada gaji atau tuntutan saya. / I acknowledge this damage or loss and agree in writing that the amount above is deducted from my salary or claims (Employment Act 1955 s.24).';

// ---------- Pure helpers ----------

/** Units a booking is charged for under its rate basis (P19). Resorts keep per unit per night. */
export function rateUnits(b: Pick<AmBooking, 'checkIn' | 'checkOut' | 'qty'> & { rateBasis?: SsRateBasis | null; persons?: number | null }) {
  const n = nights(b);
  const p = Math.max(1, b.persons ?? 1);
  switch (b.rateBasis) {
    case 'PER_PERSON_NIGHT':
      return p * n;
    case 'PER_PERSON_STAY':
      return p;
    case 'PER_PERSON_MONTH':
      return p * Math.max(1, Math.ceil(n / 30));
    default:
      return b.qty * n;
  }
}

/** The staff rate in force on a day (settings keep every dated rate). */
export function staffRateOn(s: Pick<SsSettings, 'staffRates'>, on: IsoDate) {
  return [...s.staffRates].sort((a, b) => a.from.localeCompare(b.from)).filter((r) => r.from <= on).at(-1) ?? s.staffRates[0];
}

/** Complaint numbers run in order per year: SC-YYYY-NNNN. */
export const complaintRef = (year: string, n: number) => `SC-${year}-${String(n).padStart(4, '0')}`;

/** Why a direct booking may not be checked in: all six K3 conditions (P30). */
export function directCheckInBlocks(k: AmBooking, h: SsHouse) {
  const ss = k.ss!;
  const deposit = r2((bookingBill(k).total * h.depositPct) / 100);
  const bankedPaid = r2(k.payments.filter((p) => p.banked).reduce((n, p) => n + p.amount, 0));
  const out: string[] = [];
  if (k.status !== 'confirmed') out.push('booking not confirmed');
  if (!ss.keyException && bankedPaid + 0.001 < deposit) out.push('deposit not confirmed by Finance');
  if (!ss.keyException && bankedPaid + 0.001 < bookingBill(k).total) out.push('full payment not confirmed by Finance');
  if (!ss.customer?.confirmed) out.push('customer has not confirmed the terms');
  if (h.hk !== 'inspected') out.push('house not inspected');
  if (h.safetyDefect) out.push('open safety defect');
  return out;
}

const SS_TABLES = ['stayRequests', 'ssRecs'] as const;

/** Who may ask for a staff stay (answer 31): Government Operations or an HQ department / division. */
export function ssRequester(user: User) {
  return !user.integration && (user.role === 'pwvsb_officer' || isOgm(user) || isOpsDirector(user) || user.opsTier === 'coo');
}
// Applicants read the homestay houses (name, town, price) to choose one; nothing about guests.
registerWall('ss_requester', ssRequester);
// Staff payroll (HR prepares, Finance pays) reads consented recoveries.
registerWall('ss_recovery', (u) => !u.integration && (u.department === 'hr' || u.department === 'finance' || u.leadership === 'finance_director' || u.leadership === 'cos' || u.leadership === 'deputy_cos'));

// ---------- Service ----------

export class ShortStayService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
  ) {}

  private now() {
    return this.clock();
  }
  private today() {
    return dateOf(this.clock());
  }
  private newId(prefix: string) {
    return `${prefix}-${toMs(this.now())}-${Math.random().toString(36).slice(2, 7)}`;
  }
  private sign(user: User): SsSign {
    return { by: user.name, byId: user.id, at: this.now() };
  }

  // Who is who.
  team(user: User) {
    return !user.integration && assetRole(user) === 'team';
  }
  director(user: User) {
    return this.team(user) && user.assetRole === 'director';
  }
  finance(user: User) {
    return !user.integration && (user.leadership === 'finance_director' || (user.role === 'pwvsb_officer' && user.department === 'finance'));
  }
  coo(user: User) {
    return !user.integration && (user.opsTier === 'coo' || user.opsTier === 'ceo');
  }
  /** Government Operations (answer 31) or an HQ department / division may ask for a staff stay. */
  requester(user: User) {
    return ssRequester(user);
  }
  private mustTeam(user: User, what: string) {
    if (!this.team(user)) throw new AccessDenied('view', `(the Asset Management team ${what})`);
  }
  private mustDirector(user: User, what: string) {
    if (!this.director(user)) throw new AccessDenied('view', `(the Asset Director ${what})`);
  }

  private async installed() {
    if (!this.store.hasTable) return true;
    for (const t of SS_TABLES) if (!(await this.store.hasTable(t))) return false;
    return true;
  }
  private async need() {
    if (!(await this.installed())) throw new BadRequest('Short stays are not installed in this database yet (module short-stays-v1, run by the CEO).');
  }

  async settings(): Promise<SsSettings> {
    const s = (await this.installed()) ? ((await this.store.get('ssRecs', 'ss-settings')) as SsSettings | undefined) : undefined;
    return { ...SS_DEFAULTS, by: 'default', at: '2026-11-14T00:00:00+08:00', ...(s ?? {}) } as SsSettings;
  }

  async setSettings(user: User, b: Body) {
    this.mustDirector(user, 'sets the short-stay numbers');
    await this.need();
    const reason = why(b.reason, 'Say why the numbers change');
    const cur = await this.settings();
    const next: SsSettings = { ...cur, by: user.name, at: this.now() };
    const ints: (keyof SsSettings)[] = ['holdWorkingDays', 'freeCancelDays', 'fullPayDaysBefore', 'followUpDaysBefore', 'prepareDaysBefore', 'lateKeysHours', 'airbnbAnswerHours', 'payoutWorkingDays', 'claimDeadlineDays', 'claimRemindDaysBefore', 'complaintCloseDays', 'deepCleanMonths', 'deepCleanStays', 'fullCountMonths'];
    for (const k of ints)
      if (b[k] != null) {
        const v = num(b[k]);
        if (!(Number.isFinite(v) && v >= 0 && v <= 365)) throw new BadRequest(`Give ${String(k)} as a number from 0 to 365.`);
        (next as unknown as Record<string, number>)[k] = v;
      }
    for (const k of ['lateCancelKeepPct', 'noShowKeepPct'] as const)
      if (b[k] != null) {
        const v = num(b[k]);
        if (!(v >= 0 && v <= 100)) throw new BadRequest('Give the % kept, 0 to 100.');
        next[k] = v;
      }
    for (const k of ['payoutDiffRm', 'goodwillCapRm', 'countDiffRm'] as const)
      if (b[k] != null) {
        const v = money(b[k]);
        if (!(v >= 0 && v <= 100_000)) throw new BadRequest('Give the amount in RM.');
        next[k] = v;
      }
    if (b.staffRate && typeof b.staffRate === 'object') {
      const r = b.staffRate as Body;
      const from = text(r.from, 10);
      const amount = money(r.amount);
      const basis = pick(SS_RATE_BASES, r.basis);
      if (!isDate(from) || from < this.today()) throw new BadRequest('A new staff rate starts today or later.');
      if (!(amount > 0) || !basis) throw new BadRequest('Give the staff rate in RM and its basis.');
      next.staffRates = [...cur.staffRates.filter((x) => x.from !== from), { from, amount, basis, by: user.name, reason }];
    }
    if (Array.isArray(b.deputyIds)) {
      const ids = (b.deputyIds as unknown[]).map((x) => text(x, 80)).filter(Boolean);
      for (const id of ids) {
        const u = await this.store.get('users', id);
        if (!u || assetRole(u) !== 'team') throw new BadRequest('A deputy must be in the Asset Management team.');
      }
      next.deputyIds = ids;
    }
    return this.store.transaction(async (tx) => {
      await tx.lock?.('ssRecs', 'ss-settings');
      if (await tx.get('ssRecs', 'ss-settings')) await tx.update('ssRecs', 'ss-settings', next as never);
      else await tx.insert('ssRecs', next as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.settings', entity: 'ss_settings', entityId: 'ss-settings', summary: `Short-stay settings changed: ${reason}` });
      return next;
    });
  }

  // ---------- Houses (P19, P26, P32, P34) ----------

  private houseOf(p: AmProperty | undefined): SsHouse {
    if (!p || p.kind !== 'HOMESTAY') throw new NotFound('Homestay house');
    const h = (p.stay as (AmStaySetup & { house?: SsHouse }) | null | undefined)?.house;
    if (!h) throw new BadRequest('The Asset Director sets this house up first (beds, keys, price, terms).');
    return h;
  }

  async houseSetup(user: User, propertyId: Id, b: Body) {
    this.mustDirector(user, 'sets up homestay houses');
    const p = await this.store.get('amProperties', propertyId);
    if (!p || p.kind !== 'HOMESTAY') throw new NotFound('Homestay house');
    const st = await this.settings();
    const beds = Math.round(num(b.beds));
    const maxGuests = Math.round(num(b.maxGuests ?? b.beds));
    const keys = Math.round(num(b.keys));
    const keyMethod = pick(SS_KEY_METHODS, b.keyMethod) ?? 'KEY';
    const rate = money(b.rate);
    const checkInTime = text(b.checkInTime, 5) || '15:00';
    const checkOutTime = text(b.checkOutTime, 5) || '12:00';
    if (!(beds >= 1 && beds <= 50) || !(maxGuests >= 1 && maxGuests <= 60)) throw new BadRequest('Give the beds and the most guests (1 to 50).');
    if (!(keys >= 1 && keys <= 20)) throw new BadRequest('Give how many keys or key cards the house has.');
    if (!(rate > 0)) throw new BadRequest('Give the price per night for the whole house.');
    if (!isHhmm(checkInTime) || !isHhmm(checkOutTime)) throw new BadRequest('Give check-in and check-out times as HH:MM.');
    const depositPct = b.depositPct == null ? 50 : num(b.depositPct);
    if (!(depositPct >= 0 && depositPct <= 100)) throw new BadRequest('Give the deposit %, 0 to 100.');
    const damageDeposit = b.damageDeposit == null || b.damageDeposit === '' ? null : money(b.damageDeposit);
    if (damageDeposit != null && !(damageDeposit >= 0)) throw new BadRequest('Give the damage deposit in RM, or leave it off.');
    const platforms = Array.isArray(b.platforms) ? [...new Set((b.platforms as unknown[]).map((x) => text(x, 40)).filter(Boolean))].slice(0, 6) : [];
    const ab = b.airbnb && typeof b.airbnb === 'object' ? (b.airbnb as Body) : null;
    const airbnb = ab?.listed ? { listed: true, listing: text(ab.listing, 80), cancelPolicy: pick(AIRBNB_CANCEL, ab.cancelPolicy) ?? 'MODERATE' } : null;
    if (airbnb && airbnb.listing.length < 3) throw new BadRequest('Give the Airbnb listing name or number.');
    if (airbnb && !platforms.includes('Airbnb')) platforms.unshift('Airbnb');
    const lic = b.licence && typeof b.licence === 'object' ? (b.licence as Body) : null;
    const licence = lic && text(lic.number, 60) ? { name: text(lic.name, 80) || 'Council licence', number: text(lic.number, 60), expiresOn: isDate(lic.expiresOn) ? (lic.expiresOn as IsoDate) : null } : null;
    const rules = Array.isArray(b.rules) ? (b.rules as unknown[]).map((x) => text(x, 200)).filter(Boolean).slice(0, 20) : [];
    return this.store.transaction(async (tx) => {
      await tx.lock?.('amProperties', p.id);
      const fresh = (await tx.get('amProperties', p.id))!;
      const old = (fresh.stay as (AmStaySetup & { house?: SsHouse }) | null | undefined)?.house;
      const house: SsHouse = {
        use: old?.use ?? 'SHORT_STAY',
        beds,
        maxGuests,
        keys,
        keyMethod,
        hk: old?.hk ?? 'dirty',
        hkBy: old?.hkBy ?? user.name,
        hkById: old?.hkById ?? null,
        hkAt: old?.hkAt ?? this.now(),
        safetyDefect: old?.safetyDefect ?? null,
        platforms,
        airbnb,
        depositPct,
        damageDeposit,
        rules: rules.length ? rules : ['Approved purpose only', 'Keep the house clean', 'No illegal activity', 'No changes without written approval', 'Report damage at once', 'Return the keys at the end', 'Never more guests than allowed'],
        licence,
        inventory: old?.inventory ?? [],
        lastDeepCleanOn: old?.lastDeepCleanOn ?? null,
        staysSinceDeepClean: old?.staysSinceDeepClean ?? 0,
        lastFullCountOn: old?.lastFullCountOn ?? null,
        setBy: user.name,
        setAt: this.now(),
      };
      const stay = {
        ...(fresh.stay ?? {}),
        capacity: { HOUSE: 1 },
        rates: { HOUSE: rate },
        setBy: user.name,
        setAt: this.now(),
        policy: {
          sstRegistered: fresh.stay?.policy?.sstRegistered ?? false,
          motacNo: fresh.stay?.policy?.motacNo ?? '',
          motacExpiresOn: fresh.stay?.policy?.motacExpiresOn ?? null,
          checkInTime,
          checkOutTime,
          freeCancelDays: st.freeCancelDays,
          lateCancelKeepPct: st.lateCancelKeepPct,
          noShowKeepPct: st.noShowKeepPct,
          setBy: user.name,
          setAt: this.now(),
        },
        house,
      };
      await tx.update('amProperties', p.id, { stay } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.house', entity: 'am_property', entityId: p.id, summary: `${p.name}: house set up, RM${rate} a night, ${beds} beds, ${keys} keys, platforms ${platforms.join(', ') || 'none'}` });
      return (await tx.get('amProperties', p.id))!;
    });
  }

  private async patchHouse(user: User, propertyId: Id, action: string, summary: string, fn: (h: SsHouse, p: AmProperty, all: AmBooking[]) => Partial<SsHouse>) {
    return this.store.transaction(async (tx) => {
      await tx.lock?.('amProperties', propertyId);
      const p = await tx.get('amProperties', propertyId);
      const h = this.houseOf(p);
      const all = await tx.list('amBookings', { propertyId });
      const patch = fn(h, p!, all);
      await tx.update('amProperties', propertyId, { stay: { ...p!.stay!, house: { ...h, ...patch } } } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action, entity: 'am_property', entityId: propertyId, summary: `${p!.name}: ${summary}` });
      return { id: propertyId };
    });
  }

  /** Answer 33: one use at a time; switching to a rental tenancy is blocked while any short stay is open. */
  async houseUse(user: User, propertyId: Id, b: Body) {
    this.mustDirector(user, 'switches a house between short stays and rental');
    const use = pick(['SHORT_STAY', 'RENTAL'] as const, b.use);
    if (!use) throw new BadRequest('Choose short stays or rental.');
    const reason = why(b.reason);
    const today = this.today();
    return this.patchHouse(user, propertyId, 'asset.ss.use', `use → ${use}: ${reason}`, (h, _p, all) => {
      if (use === 'RENTAL' && all.some((k) => (bookingHolds(k, today) || k.status === 'checked_in') && k.checkOut > today))
        throw new BadRequest('A short stay is still open on this house. Finish or cancel it first.');
      return { use };
    });
  }

  async houseInventory(user: User, propertyId: Id, b: Body) {
    this.mustDirector(user, 'sets a house inventory list');
    const raw = Array.isArray(b.lines) ? (b.lines as Body[]) : [];
    if (!raw.length) throw new BadRequest('Give at least one item.');
    const lines: SsInventoryLine[] = raw.slice(0, 200).map((l) => {
      const item = text(l.item, 80);
      const qty = Math.round(num(l.qty));
      const value = money(l.value ?? 0);
      if (item.length < 2 || !(qty >= 0)) throw new BadRequest('Each line needs an item and a quantity.');
      return { item, qty, room: text(l.room, 40) || 'House', value: value >= 0 ? value : 0, condition: pick(['good', 'worn', 'damaged'] as const, l.condition) ?? 'good' };
    });
    return this.patchHouse(user, propertyId, 'asset.ss.inventory', `inventory list set (${lines.length} lines)`, () => ({ inventory: lines }));
  }

  /** House status: dirty -> clean -> inspected; whoever cleaned does not inspect (SOP A3 step 7). */
  async houseStatus(user: User, propertyId: Id, b: Body) {
    this.mustTeam(user, 'runs housekeeping');
    const hk = pick(['dirty', 'clean', 'inspected'] as const, b.hk);
    if (!hk) throw new BadRequest('Choose dirty, clean or inspected.');
    return this.patchHouse(user, propertyId, 'asset.ss.hk', `house ${hk}`, (h) => {
      if (hk === 'inspected' && h.hk === 'dirty') throw new BadRequest('Clean the house before it is inspected.');
      if (hk === 'inspected' && h.hk === 'clean' && h.hkById === user.id) throw new BadRequest('You recorded the clean, so someone else inspects it.');
      if (hk === 'inspected') photoList(b.photos, 1, 'the inspected house');
      return { hk, hkBy: user.name, hkById: user.id, hkAt: this.now() };
    });
  }

  /** A safety defect blocks hand-over until fixed; it raises an Asset Management work order. */
  async houseDefect(user: User, propertyId: Id, b: Body) {
    this.mustTeam(user, 'records defects');
    const step = pick(['raise', 'fixed'] as const, b.step);
    if (!step) throw new BadRequest('Unknown step.');
    return this.store.transaction(async (tx) => {
      await tx.lock?.('amProperties', propertyId);
      const p = await tx.get('amProperties', propertyId);
      const h = this.houseOf(p);
      let next: SsHouse;
      let what: string;
      if (step === 'raise') {
        const note = why(b.note, 'Say what the defect is');
        const safety = b.safety === true;
        const wo: AmWorkOrder = { id: this.newId('am-wo'), unitId: null, propertyId, title: `${p!.name}: ${note}`.slice(0, 160), source: 'inspection', raisedOn: this.today(), dueOn: addDays(this.today(), safety ? 1 : 7), status: 'open', cost: null, contractor: null, doneOn: null };
        await tx.insert('amWorkOrders', wo);
        next = safety ? { ...h, safetyDefect: { note, workOrderId: wo.id, by: user.name, at: this.now() } } : h;
        what = `${safety ? 'Safety defect' : 'Defect'}: ${note} (work order ${wo.id})`;
      } else {
        if (!h.safetyDefect) throw new BadRequest('No safety defect is open.');
        const wo = h.safetyDefect.workOrderId ? await tx.get('amWorkOrders', h.safetyDefect.workOrderId) : null;
        if (wo && wo.status !== 'done') throw new BadRequest('Close the work order first.');
        next = { ...h, safetyDefect: null, hk: h.hk === 'inspected' ? 'clean' : h.hk };
        what = 'Safety defect fixed; re-inspect before hand-over';
      }
      await tx.update('amProperties', propertyId, { stay: { ...p!.stay!, house: next } } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: `asset.ss.defect.${step}`, entity: 'am_property', entityId: propertyId, summary: `${p!.name}: ${what}` });
      return { id: propertyId };
    });
  }

  // ---------- Bookings: one calendar per house for every channel ----------

  private async insertBooking(user: User, p: AmProperty, h: SsHouse, row: AmBooking, summary: string) {
    const today = this.today();
    return this.store.transaction(async (tx) => {
      // One booking at a time per house (the resort lock), so no two channels take the same nights.
      await tx.lock?.('amProperties', p.id);
      const fresh = (await tx.get('amProperties', p.id))!;
      if (this.houseOf(fresh).use !== 'SHORT_STAY') throw new BadRequest('This house is let as a rental home now; no short stays.');
      const all = await tx.list('amBookings', { propertyId: p.id });
      const clash = nightsTaken(all, p.id, 'HOUSE', row.checkIn, row.checkOut, today).filter((n) => n.taken + 1 > sellable(fresh.stay, 'HOUSE', n.night));
      if (clash.length) throw new BadRequest(`The house is already taken on ${clash.map((n) => n.night).join(', ')} (all channels share one calendar).`);
      if (row.ss?.airbnb && all.some((x) => x.ss?.airbnb?.code === row.ss!.airbnb!.code)) throw new BadRequest('That Airbnb confirmation code is already on a booking.');
      await tx.insert('amBookings', row);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.book', entity: 'amBookings', entityId: row.id, summary });
      return row;
    });
  }

  private baseBooking(user: User, p: AmProperty, h: SsHouse, f: { guest: string; phone: string; checkIn: IsoDate; checkOut: IsoDate; persons: number; rate: number; listRate: number; discountReason: string; internal: boolean; billTo: string; rateBasis: SsRateBasis; status: AmBooking['status']; holdUntil: IsoDate; ss: SsBookingInfo; what: string }): AmBooking {
    const pol = p.stay!.policy;
    const terms: AmStayTerms | null = pol ? { checkInTime: pol.checkInTime, checkOutTime: pol.checkOutTime, freeCancelDays: pol.freeCancelDays, lateCancelKeepPct: pol.lateCancelKeepPct, noShowKeepPct: pol.noShowKeepPct } : null;
    return {
      id: this.newId('am-b'),
      ref: `SS-${p.id.replace(/\D/g, '')}-${toMs(this.now()) % 100000}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      propertyId: p.id,
      guest: f.guest,
      phone: f.phone,
      internal: f.internal,
      billTo: f.billTo,
      type: 'HOUSE',
      qty: 1,
      checkIn: f.checkIn,
      checkOut: f.checkOut,
      rate: f.rate,
      listRate: f.listRate,
      discountReason: f.discountReason,
      status: f.status,
      holdUntil: f.holdUntil,
      payments: [],
      by: user.name,
      byId: user.id,
      at: this.now(),
      history: [{ at: this.now(), by: user.name, what: f.what }],
      version: 1,
      taxRates: p.stay!.taxes ? { ...p.stay!.taxes, sstPct: pol && !pol.sstRegistered ? 0 : p.stay!.taxes.sstPct } : null,
      terms,
      settlement: null,
      foreign: false,
      register: null,
      roomNos: [],
      charges: [],
      rateBasis: f.rateBasis,
      persons: f.persons,
      ss: f.ss,
    };
  }

  private blankInfo(channel: SsChannel, extra: Partial<SsBookingInfo>): SsBookingInfo {
    return {
      channel,
      platform: '',
      platformRef: '',
      purpose: '',
      work: false,
      needs: '',
      consent: null,
      requestId: null,
      checked: null,
      customer: null,
      blocked: {},
      followUp: null,
      prepared: null,
      keyException: null,
      keysOut: null,
      keysBack: null,
      after: null,
      accessCode: null,
      codeChanged: null,
      damages: [],
      lateNights: null,
      hostCancel: null,
      goodwill: null,
      airbnb: null,
      closed: null,
      ...extra,
    };
  }

  private dates(b: Body) {
    const checkIn = text(b.checkIn, 10);
    const checkOut = text(b.checkOut, 10);
    if (!isDate(checkIn) || checkIn < this.today()) throw new BadRequest('Give the check-in date, today or later.');
    if (!isDate(checkOut) || checkOut <= checkIn) throw new BadRequest('Give the check-out date, after check-in.');
    if (daysBetween(checkIn, checkOut) > 30) throw new BadRequest('Longer than 30 nights: the Asset Director decides (it may be a tenancy).');
    return { checkIn: checkIn as IsoDate, checkOut: checkOut as IsoDate };
  }

  /** P27: the booking form, keyed in by the team while talking to the customer. Returns the message to copy. */
  async bookDirect(user: User, b: Body) {
    this.mustTeam(user, 'takes homestay bookings');
    await this.need();
    const p = await this.store.get('amProperties', text(b.propertyId, 80));
    const h = this.houseOf(p);
    const st = await this.settings();
    const { checkIn, checkOut } = this.dates(b);
    const guest = text(b.guest, 120);
    const phone = text(b.phone, 30);
    const persons = Math.round(num(b.persons));
    const channel = pick(['DIRECT', 'OTHER'] as const, b.channel) ?? 'DIRECT';
    const platform = text(b.platform, 40);
    const platformRef = text(b.platformRef, 60);
    if (guest.length < 2) throw new BadRequest('Give the customer name.');
    if (!/^[0-9+\-\s]{8,20}$/.test(phone)) throw new BadRequest('Give the customer phone number.');
    if (!(persons >= 1)) throw new BadRequest('Give the number of guests.');
    if (persons > h.maxGuests) throw new BadRequest(`This house takes at most ${h.maxGuests} guests.`);
    if (channel === 'OTHER' && (platform.length < 2 || platformRef.length < 3)) throw new BadRequest('Give the platform name and its booking reference.');
    if (b.consent !== true) throw new BadRequest('Tick that the customer’s written consent was taken (PDPA).');
    const listRate = p!.stay!.rates.HOUSE!;
    const rate = b.rate == null || b.rate === '' ? listRate : money(b.rate);
    const discountReason = text(b.discountReason, 300);
    if (!(rate > 0)) throw new BadRequest('Give the price per night.');
    if (rate > listRate) throw new BadRequest(`The price list says RM${listRate}. Ask the Asset Director to change the list instead of charging more.`);
    if (rate < listRate && discountReason.length < 5) throw new BadRequest(`RM${rate} is under the price list (RM${listRate}). Say why.`);
    const holdUntil = addWorkingDaysExcept(this.today(), st.holdWorkingDays, new Set());
    const row = this.baseBooking(user, p!, h, {
      guest,
      phone,
      checkIn,
      checkOut,
      persons,
      rate,
      listRate,
      discountReason: rate < listRate ? discountReason : '',
      internal: false,
      billTo: '',
      rateBasis: 'PER_UNIT_NIGHT',
      status: 'held',
      holdUntil,
      ss: this.blankInfo(channel, { platform, platformRef, purpose: text(b.purpose, 120), needs: text(b.needs, 300), consent: this.sign(user) }),
      what: `Booking form taken (${channel === 'OTHER' ? platform : 'direct'}); held on the calendar until ${holdUntil} for the deposit`,
    });
    const saved = await this.insertBooking(user, p!, h, row, `${p!.name}: ${checkIn} to ${checkOut}, ${persons} guests, RM${rate}/night (${channel})`);
    return { ...saved, message: this.message(saved, h, p!) };
  }

  /** The BM / English booking summary the team copies into WhatsApp (Prima does not send it). */
  message(k: AmBooking, h: SsHouse, p: AmProperty) {
    const bill = bookingBill(k);
    const dep = r2((bill.total * h.depositPct) / 100);
    const t = k.terms;
    return [
      `Tempahan ${k.ref} / Booking ${k.ref}: ${p.name}, ${k.checkIn} - ${k.checkOut} (${nights(k)} malam/nights), ${k.persons ?? 1} tetamu/guests.`,
      `Jumlah / Total RM${bill.total}. Deposit RM${dep} (${h.depositPct}%) dalam ${k.holdUntil} / by ${k.holdUntil}. Baki penuh 3 hari sebelum daftar masuk / Full payment 3 days before check-in.`,
      t ? `Daftar masuk ${t.checkInTime}, keluar ${t.checkOutTime}. Batal ${t.freeCancelDays} hari atau lebih awal: deposit dipulangkan penuh; lewat: ${t.lateCancelKeepPct}% disimpan; tidak hadir: ${t.noShowKeepPct}% disimpan. / Check-in ${t.checkInTime}, check-out ${t.checkOutTime}. Cancel ${t.freeCancelDays}+ days before: full deposit back; later: ${t.lateCancelKeepPct}% kept; no-show: ${t.noShowKeepPct}% kept.` : '',
      `Peraturan / House rules: ${h.rules.join('; ')}.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** P34: an Airbnb reservation keyed in by the team; the reservation IS the booking form (answer 45). */
  async bookAirbnb(user: User, b: Body) {
    this.mustTeam(user, 'records Airbnb bookings');
    await this.need();
    const p = await this.store.get('amProperties', text(b.propertyId, 80));
    const h = this.houseOf(p);
    if (!h.airbnb?.listed) throw new BadRequest('This house is not listed on Airbnb.');
    const { checkIn, checkOut } = this.dates(b);
    const code = text(b.code, 20).toUpperCase();
    const guestName = text(b.guestName, 120);
    const persons = Math.round(num(b.persons));
    const guestTotal = money(b.guestTotal);
    const hostFee = money(b.hostFee ?? 0);
    const taxKept = money(b.taxKept ?? 0);
    if (!/^[A-Z0-9]{6,20}$/.test(code)) throw new BadRequest('Give the Airbnb confirmation code.');
    if (guestName.length < 2) throw new BadRequest('Give the guest name as shown on Airbnb.');
    if (!(persons >= 1)) throw new BadRequest('Give the number of guests.');
    if (persons > h.maxGuests) throw new BadRequest(`This house takes at most ${h.maxGuests} guests.`);
    if (!(guestTotal > 0) || !(hostFee >= 0) || !(taxKept >= 0)) throw new BadRequest('Give what the guest paid and the Airbnb fee.');
    const copy = b.copy ? photoList([b.copy], 1, 'the Airbnb reservation copy')[0] : null;
    const accepted = b.accepted === true;
    const expectedPayout = r2(guestTotal - hostFee - taxKept);
    const n = Math.max(1, daysBetween(checkIn, checkOut));
    const row = this.baseBooking(user, p!, h, {
      guest: guestName,
      phone: '',
      checkIn,
      checkOut,
      persons,
      rate: r2(expectedPayout / n),
      listRate: p!.stay!.rates.HOUSE!,
      discountReason: 'Airbnb price (set on the listing)',
      internal: false,
      billTo: '',
      rateBasis: 'PER_UNIT_NIGHT',
      // A request holds the nights until it is answered; an instant or accepted booking is confirmed.
      status: accepted ? 'confirmed' : 'held',
      holdUntil: addDays(this.today(), 1),
      ss: this.blankInfo('AIRBNB', {
        platform: 'Airbnb',
        platformRef: code,
        airbnb: { code, guestName, guestTotal, hostFee, taxKept, expectedPayout, copy, requestAt: this.now(), answered: accepted ? { ...this.sign(user), accepted: true } : null, cancelPolicy: h.airbnb.cancelPolicy, payoutId: null },
        // The Airbnb reservation counts as the form and Airbnb checks the guest, so steps 3-5 are one step.
        checked: accepted ? { ...this.sign(user), ok: true, note: 'Accepted on Airbnb' } : null,
        customer: accepted ? { ...this.sign(user), confirmed: true, note: 'Airbnb reservation' } : null,
        blocked: { Airbnb: this.sign(user) },
      }),
      what: accepted ? `Airbnb ${code} accepted and on the calendar` : `Airbnb request ${code}: answer on Airbnb within the set hours`,
    });
    return this.insertBooking(user, p!, h, row, `${p!.name}: Airbnb ${code} ${checkIn} to ${checkOut}, ${persons} guests, payout RM${expectedPayout}`);
  }

  /** A change to one short-stay booking, under the house lock, with one audit line (no access code in it). */
  private async onBooking(user: User, id: Id, version: number | undefined, action: string, fn: (k: AmBooking, h: SsHouse, p: AmProperty) => { patch: Partial<AmBooking>; house?: Partial<SsHouse>; what: string; extra?: (tx: Parameters<Parameters<Store['transaction']>[0]>[0]) => Promise<void> }) {
    return this.store.transaction(async (tx) => {
      const k0 = await tx.get('amBookings', id);
      if (!k0 || !k0.ss) throw new NotFound('Short-stay booking');
      await tx.lock?.('amProperties', k0.propertyId);
      await tx.lock?.('amBookings', id);
      const k = (await tx.get('amBookings', id))!;
      if (version != null && Number.isFinite(version) && version !== k.version) throw new BadRequest('Someone changed this booking a moment ago. Reload and try again.');
      const p = (await tx.get('amProperties', k.propertyId))!;
      const h = this.houseOf(p);
      const r = fn(k, h, p);
      await tx.update('amBookings', id, { ...r.patch, history: [...k.history, { at: this.now(), by: user.name, what: r.what }], version: k.version + 1 } as never);
      if (r.house) await tx.update('amProperties', p.id, { stay: { ...p.stay!, house: { ...h, ...r.house } } } as never);
      if (r.extra) await r.extra(tx);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: `asset.ss.${action}`, entity: 'amBookings', entityId: id, summary: `${k.ref}: ${r.what}` });
      return (await tx.get('amBookings', id))!;
    });
  }

  /** Every booking step (P21-P38). The team runs them; some need the Asset Director; Finance has its own steps. */
  async step(user: User, id: Id, b: Body) {
    const step = text(b.step, 30);
    const version = b.version == null ? undefined : Number(b.version);
    const today = this.today();
    const st = await this.settings();
    const team = () => this.mustTeam(user, 'runs short stays');
    switch (step) {
      case 'checked': {
        team();
        const ok = b.ok === true;
        const note = ok ? text(b.note, 300) : why(b.note, 'Say why it is not approved (the customer is told)');
        return this.onBooking(user, id, version, 'checked', (k) => {
          if (k.status !== 'held' || k.ss!.channel === 'AIRBNB') throw new BadRequest('Only a held direct booking is checked.');
          const ss = { ...k.ss!, checked: { ...this.sign(user), ok, note } };
          return ok ? { patch: { ss }, what: 'Checked: dates, terms and details fine' } : { patch: { ss, status: 'cancelled', settlement: { keepPct: 0, keep: 0, refundDue: bookingPaid(k), refunded: 0 } }, what: `Not approved: ${note}` };
        });
      }
      case 'answer': {
        team();
        const accepted = b.accepted === true;
        const note = accepted ? 'Accepted on Airbnb' : why(b.note, 'Say why it was declined');
        return this.onBooking(user, id, version, 'airbnb.answer', (k) => {
          const a = k.ss!.airbnb;
          if (!a || a.answered) throw new BadRequest('Only an Airbnb request waiting for an answer.');
          const ss = { ...k.ss!, airbnb: { ...a, answered: { ...this.sign(user), accepted } }, checked: { ...this.sign(user), ok: accepted, note }, customer: accepted ? { ...this.sign(user), confirmed: true, note: 'Airbnb reservation' } : null };
          return { patch: { ss, status: accepted ? 'confirmed' : 'cancelled' }, what: accepted ? `Airbnb ${a.code} accepted` : `Airbnb ${a.code} declined: ${note}` };
        });
      }
      case 'block': {
        team();
        const platform = text(b.platform, 40);
        return this.onBooking(user, id, version, 'block', (k, h) => {
          if (!h.platforms.includes(platform)) throw new BadRequest('That platform is not on this house’s list.');
          return { patch: { ss: { ...k.ss!, blocked: { ...k.ss!.blocked, [platform]: this.sign(user) } } }, what: `Dates blocked on ${platform}` };
        });
      }
      case 'pay': {
        team();
        const amount = money(b.amount);
        const method = pick(['CASH', 'TRANSFER', 'CARD', 'ONLINE'] as const, b.method);
        const ref = text(b.ref, 60);
        const proof = method === 'CASH' ? null : photoList(b.proof ? [b.proof] : [], 1, 'the payment proof')[0];
        return this.onBooking(user, id, version, 'pay', (k) => {
          if (k.ss!.channel === 'AIRBNB') throw new BadRequest('An Airbnb guest pays Airbnb, never the company (answer 44).');
          if (k.internal) throw new BadRequest('A work stay is billed to the department.');
          if (!['held', 'confirmed', 'checked_in'].includes(k.status)) throw new BadRequest('This booking is closed.');
          if (!(amount > 0) || !method) throw new BadRequest('Give the amount and how it was paid.');
          if (method !== 'CASH' && ref.length < 3) throw new BadRequest('Give the bank or online reference.');
          // The team records the payment and proof; Finance confirms it and issues the official receipt (P29).
          const pay = { id: `sp-${k.id}-${k.payments.length + 1}`, on: today, amount, method, receiptNo: '', ref: proof ? `${ref} · proof ${proof.sha256.slice(0, 12)}` : ref, by: user.name, at: this.now(), banked: null };
          return { patch: { payments: [...k.payments, pay] }, what: `RM${amount} recorded (${method.toLowerCase()}), waiting for Finance to confirm and issue the receipt` };
        });
      }
      case 'customer': {
        team();
        const confirmed = b.confirmed === true;
        const note = text(b.note, 300);
        return this.onBooking(user, id, version, 'customer', (k, h) => {
          if (k.status !== 'held' || k.ss!.channel === 'AIRBNB') throw new BadRequest('Only a held direct booking.');
          if (!k.ss!.checked?.ok) throw new BadRequest('Check the booking first.');
          const banked = r2(k.payments.filter((x) => x.banked).reduce((n, x) => n + x.amount, 0));
          const dep = r2((bookingBill(k).total * h.depositPct) / 100);
          if (!confirmed) {
            // Answer 37: a customer who does not confirm gets the full deposit back.
            return { patch: { status: 'cancelled', ss: { ...k.ss!, customer: { ...this.sign(user), confirmed: false, note } }, settlement: { keepPct: 0, keep: 0, refundDue: bookingPaid(k), refunded: 0 } }, what: `Customer did not confirm; RM${bookingPaid(k)} to refund in full` };
          }
          if (banked + 0.001 < dep) throw new BadRequest(`Finance has not yet confirmed the deposit of RM${dep} (${h.depositPct}%).`);
          const missing = h.platforms.filter((x) => !k.ss!.blocked[x]);
          if (missing.length) throw new BadRequest(`Block the dates on ${missing.join(', ')} first.`);
          return { patch: { status: 'confirmed', ss: { ...k.ss!, customer: { ...this.sign(user), confirmed: true, note } } }, what: 'Customer confirmed dates and terms; booking confirmed' };
        });
      }
      case 'followup': {
        team();
        const arrival = text(b.arrival, 40);
        const note = text(b.note, 300);
        return this.onBooking(user, id, version, 'followup', (k) => {
          if (k.status !== 'confirmed') throw new BadRequest('Follow up a confirmed booking.');
          return { patch: { ss: { ...k.ss!, followUp: { ...this.sign(user), arrival, note } } }, what: `Follow-up done${arrival ? `, arriving ${arrival}` : ''}` };
        });
      }
      case 'prepare': {
        team();
        const ticks = Array.isArray(b.ticks) ? (b.ticks as unknown[]).map((x) => text(x, 120)) : [];
        const photos = photoList(b.photos, 2, 'the prepared house');
        return this.onBooking(user, id, version, 'prepare', (k, h) => {
          if (!['confirmed', 'held'].includes(k.status)) throw new BadRequest('Prepare the house for a booking that is coming.');
          const missing = SS_CHECKLIST.filter((c) => !ticks.includes(c));
          if (missing.length) throw new BadRequest(`Tick every line of the checklist: ${missing.join(', ')}.`);
          if (h.safetyDefect) throw new BadRequest('Fix the open safety defect first.');
          if (h.hk === 'dirty') throw new BadRequest('The house is still dirty. Clean it first.');
          // The person who recorded the clean does not inspect it (SOP A3 step 7).
          if (h.hk === 'clean' && h.hkById === user.id) throw new BadRequest('You recorded the clean, so someone else does the final check.');
          return { patch: { ss: { ...k.ss!, prepared: { ...this.sign(user), ticks, photos } } }, house: { hk: 'inspected', hkBy: user.name, hkById: user.id, hkAt: this.now() }, what: 'House prepared and inspected for check-in' };
        });
      }
      case 'keyException': {
        // Answer 43: the Asset Director may release keys before Finance confirms, with a reason and the guest's proof.
        this.mustDirector(user, 'releases keys before Finance confirms');
        const reason = why(b.reason);
        return this.onBooking(user, id, version, 'key_exception', (k) => {
          if (k.ss!.channel === 'AIRBNB' || k.internal) throw new BadRequest('Only a direct paid booking needs this.');
          if (!k.payments.some((x) => !x.banked && x.amount > 0)) throw new BadRequest('Record the guest’s transfer proof first.');
          return { patch: { ss: { ...k.ss!, keyException: { ...this.sign(user), reason } } }, what: `Keys may be released before Finance confirms: ${reason} (Finance checks next working day)` };
        });
      }
      case 'checkin':
        team();
        return this.checkIn(user, id, b, version);
      case 'checkout': {
        team();
        const n = Math.round(num(b.keysBack));
        const lost = Math.round(num(b.lost ?? 0));
        const note = text(b.note, 300);
        return this.onBooking(user, id, version, 'checkout', (k, h) => {
          if (k.status !== 'checked_in') throw new BadRequest('Only a booking that checked in checks out.');
          const out = k.ss!.keysOut?.n ?? 0;
          if (!(n >= 0) || !(lost >= 0)) throw new BadRequest('Give the keys returned.');
          if (n + lost !== out) throw new BadRequest(`${out} key(s) were handed over. Count them back, or record the lost ones.`);
          if (lost && note.length < 5) throw new BadRequest('Say how the key was lost (reported at once, H3 sec. 9).');
          const late = today > k.checkOut ? daysBetween(k.checkOut, today) : 0;
          return {
            patch: { status: 'checked_out', ss: { ...k.ss!, keysBack: { ...this.sign(user), n, lost, note }, lateNights: late ? { nights: late, waived: null, by: user.name, at: this.now() } : null } },
            house: { hk: 'dirty', hkBy: user.name, hkById: user.id, hkAt: this.now(), staysSinceDeepClean: h.staysSinceDeepClean + 1 },
            what: `Checked out; ${n} key(s) back${lost ? `, ${lost} lost (${note})` : ''}${late ? `; ${late} extra night(s) to charge unless waived` : ''}`,
          };
        });
      }
      case 'after': {
        team();
        const ticks = Array.isArray(b.ticks) ? (b.ticks as unknown[]).map((x) => text(x, 120)) : [];
        const photos = photoList(b.photos, 2, 'the house after the stay');
        const missing = Array.isArray(b.missing) ? (b.missing as unknown[]).map((x) => text(x, 120)).filter(Boolean) : [];
        return this.onBooking(user, id, version, 'after', (k) => {
          if (k.status !== 'checked_out') throw new BadRequest('The after-stay inspection follows check-out.');
          if (k.ss!.after) throw new BadRequest('Already inspected.');
          return { patch: { ss: { ...k.ss!, after: { ...this.sign(user), ticks, photos, missing } } }, what: `After-stay inspection done${missing.length ? `; missing or damaged: ${missing.join(', ')}` : '; nothing missing'}` };
        });
      }
      case 'late': {
        // Answer 35 / P31: each extra night is charged at the rate unless the Asset Director waives it with a reason.
        const waive = b.waive === true;
        if (waive) this.mustDirector(user, 'waives a late check-out');
        else team();
        const reason = waive ? why(b.reason) : '';
        return this.onBooking(user, id, version, 'late', (k) => {
          const l = k.ss!.lateNights;
          if (!l || l.waived) throw new BadRequest('No late nights to settle.');
          if (waive) return { patch: { ss: { ...k.ss!, lateNights: { ...l, waived: reason, by: user.name, at: this.now() } } }, what: `${l.nights} late night(s) waived: ${reason}` };
          const amount = r2(k.rate * l.nights * (k.rateBasis === 'PER_PERSON_NIGHT' ? Math.max(1, k.persons ?? 1) : 1));
          const charges = [...(k.charges ?? []), { id: `ch-${k.id}-${(k.charges ?? []).length + 1}`, on: today, what: `Late check-out, ${l.nights} night(s)`, amount, reason: 'Extra night at the rate (answer 35)', by: user.name, at: this.now() }];
          return { patch: { charges, ss: { ...k.ss!, lateNights: { ...l, waived: 'charged', by: user.name, at: this.now() } } }, what: `${l.nights} late night(s) charged, RM${amount}` };
        });
      }
      case 'damage':
        return this.damage(user, id, b, version);
      case 'claim': {
        team();
        const damageId = text(b.damageId, 80);
        const filedOn = text(b.filedOn, 10) || today;
        const caseNo = text(b.caseNo, 40);
        return this.onBooking(user, id, version, 'claim', (k) => {
          if (k.ss!.channel !== 'AIRBNB') throw new BadRequest('Claims through Airbnb are for Airbnb bookings.');
          const d = k.ss!.damages.find((x) => x.id === damageId);
          if (!d || !d.claim) throw new NotFound('Damage line');
          if (caseNo.length < 3 || !isDate(filedOn)) throw new BadRequest('Give the Airbnb case number and the date filed.');
          if (filedOn > d.claim.deadline) throw new BadRequest(`Airbnb's deadline was ${d.claim.deadline}.`);
          const damages = k.ss!.damages.map((x) => (x.id === d.id ? { ...x, claim: { ...x.claim!, filedOn: filedOn as IsoDate, caseNo } } : x));
          return { patch: { ss: { ...k.ss!, damages } }, what: `Damage claim filed on Airbnb, case ${caseNo}` };
        });
      }
      case 'claimOutcome': {
        team();
        const damageId = text(b.damageId, 80);
        const outcome = pick(['paid', 'part', 'refused'] as const, b.outcome);
        const received = money(b.received ?? 0);
        return this.onBooking(user, id, version, 'claim_outcome', (k) => {
          const d = k.ss!.damages.find((x) => x.id === damageId);
          if (!d?.claim?.caseNo) throw new BadRequest('File the claim first.');
          if (!outcome) throw new BadRequest('Choose paid, part or refused.');
          if (outcome !== 'refused' && !(received > 0)) throw new BadRequest('Give what Airbnb paid.');
          const damages = k.ss!.damages.map((x) => (x.id === d.id ? { ...x, claim: { ...x.claim!, outcome, received: outcome === 'refused' ? 0 : received } } : x));
          return { patch: { ss: { ...k.ss!, damages } }, what: `Airbnb claim ${d.claim.caseNo}: ${outcome}${received ? ` RM${received}` : ''} (counts once Finance confirms)` };
        });
      }
      case 'code': {
        team();
        const code = text(b.code, 20);
        return this.onBooking(user, id, version, 'code', (k, h) => {
          if (h.keyMethod === 'KEY') throw new BadRequest('This house uses a physical key.');
          if (!['confirmed', 'held'].includes(k.status)) throw new BadRequest('Set the code before check-in.');
          if (!/^[0-9A-Za-z#*]{4,12}$/.test(code)) throw new BadRequest('Give a 4 to 12 character code.');
          return { patch: { ss: { ...k.ss!, accessCode: code } }, what: 'New access code set for this stay (shown to the team only)' };
        });
      }
      case 'codeChanged': {
        team();
        return this.onBooking(user, id, version, 'code_changed', (k, h) => {
          if (h.keyMethod === 'KEY') throw new BadRequest('This house uses a physical key.');
          if (k.status !== 'checked_out') throw new BadRequest('Change the code after check-out.');
          return { patch: { ss: { ...k.ss!, codeChanged: this.sign(user), accessCode: null } }, what: 'Access code changed after the stay' };
        });
      }
      case 'cancel': {
        team();
        const reason = why(b.reason);
        const host = b.host === true;
        if (host) this.mustDirector(user, 'cancels an Airbnb guest (host cancellation)');
        return this.onBooking(user, id, version, 'cancel', (k) => {
          if (!['held', 'confirmed'].includes(k.status)) throw new BadRequest('Only a held or confirmed booking is cancelled.');
          if (k.ss!.channel === 'AIRBNB') {
            const who = host ? 'host (company)' : 'guest';
            return { patch: { status: 'cancelled', ss: { ...k.ss!, hostCancel: host ? { ...this.sign(user), reason } : null } }, what: `Airbnb booking cancelled by the ${who}: ${reason}. Airbnb refunds under the ${k.ss!.airbnb?.cancelPolicy ?? ''} setting; dates reopened.` };
          }
          if (host) throw new BadRequest('A host cancellation is for Airbnb bookings.');
          const set = cancelSettlement(bookingPaid(k), k.terms, 'cancel', daysBetween(today, k.checkIn));
          return { patch: { status: 'cancelled', settlement: set ? { ...set, refunded: 0 } : null }, what: `Cancelled: ${reason}${set ? `. RM${set.keep} kept (${set.keepPct}%), RM${set.refundDue} owed back` : ''}; dates reopened` };
        });
      }
      case 'goodwill': {
        const amount = money(b.amount);
        const reason = why(b.reason);
        const k0 = await this.store.get('amBookings', id);
        if (!k0?.ss) throw new NotFound('Short-stay booking');
        const cap = Math.min(st.goodwillCapRm, k0.rate);
        const approver = amount > cap ? 'coo' : 'asset_director';
        if (approver === 'coo' ? !this.coo(user) : !this.director(user)) throw new AccessDenied('view', approver === 'coo' ? `(above RM${cap} the COO approves a goodwill refund)` : '(the Asset Director approves a goodwill refund)');
        return this.onBooking(user, id, version, 'goodwill', (k) => {
          if (!(amount > 0)) throw new BadRequest('Give the amount.');
          if (k.ss!.goodwill) throw new BadRequest('A goodwill refund is already on this booking.');
          // Review B5: a goodwill refund is never more than the guest paid, less what is already owed back (any approver).
          const paid = k.ss!.channel === 'AIRBNB' ? (k.ss!.airbnb?.guestTotal ?? 0) : bookingPaid(k);
          const ceiling = Math.max(0, Math.round((paid - (k.settlement?.refundDue ?? 0)) * 100) / 100);
          if (amount > ceiling + 0.001) throw new BadRequest(`A goodwill refund is never more than the guest paid: at most RM${ceiling.toFixed(2)} on this booking.`);
          return { patch: { ss: { ...k.ss!, goodwill: { ...this.sign(user), amount, reason, approver } } }, what: `Goodwill refund RM${amount} approved (${approver === 'coo' ? 'COO' : 'Asset Director'}): ${reason}${k.ss!.channel === 'AIRBNB' ? '; paid through Airbnb' : '; Finance pays and confirms'}` };
        });
      }
      case 'close': {
        team();
        // The staff member's acknowledgement sits on the request (the applicant's side of the wall).
        const k1 = await this.store.get('amBookings', id);
        const rq = k1?.ss?.requestId ? await this.store.get('stayRequests', k1.ss.requestId) : null;
        const acked = new Set((rq?.damages ?? []).filter((d) => d.ack).map((d) => d.id));
        return this.onBooking(user, id, version, 'close', (k, h) => {
          const why2 = this.closeBlocks(k, h, acked);
          if (why2.length) throw new BadRequest(`Not yet: ${why2.join('; ')}.`);
          return { patch: { ss: { ...k.ss!, closed: this.sign(user) } }, what: 'Stay closed: keys back, inspected, damage recorded, record kept' };
        });
      }
      default:
        throw new BadRequest('Unknown short-stay step.');
    }
  }

  /** The H3 step-9 conditions, plus the Airbnb payout match (P35) and the damage steps. */
  closeBlocks(k: AmBooking, h: SsHouse, acked: Set<Id> = new Set()) {
    const ss = k.ss!;
    const out: string[] = [];
    if (ss.closed) out.push('already closed');
    if (k.status !== 'checked_out') out.push('not checked out');
    if (!ss.keysBack) out.push('keys not back');
    if (!ss.after) out.push('after-stay inspection not done');
    if (ss.lateNights && !ss.lateNights.waived) out.push('late nights not settled');
    if (h.keyMethod !== 'KEY' && !ss.codeChanged) out.push('access code not changed');
    if (ss.channel === 'AIRBNB' && !ss.airbnb?.payoutId) out.push('Airbnb payout not matched by Finance');
    if (ss.damages.some((d) => d.staffUserId && !d.ack && !acked.has(d.id))) out.push('damage not yet acknowledged by the staff member');
    if (ss.damages.some((d) => d.claim && d.claim.outcome === 'open')) out.push('Airbnb damage claim still open');
    if (!k.internal && ss.channel !== 'AIRBNB') {
      const due = r2(bookingBill(k).total - k.payments.filter((p) => p.banked).reduce((n, p) => n + p.amount, 0));
      if (due > 0.001) out.push(`RM${due} not confirmed by Finance`);
    }
    return out;
  }

  private async checkIn(user: User, id: Id, b: Body, version?: number) {
    const today = this.today();
    const n = Math.round(num(b.keys));
    const to = text(b.to, 120);
    return this.onBooking(user, id, version, 'checkin', (k, h) => {
      const ss = k.ss!;
      if (today < k.checkIn) throw new BadRequest(`Check-in is from ${k.checkIn}.`);
      if (today >= k.checkOut) throw new BadRequest('The stay dates have passed.');
      if (h.hk !== 'inspected') throw new BadRequest('The house is not inspected yet.');
      if (h.safetyDefect) throw new BadRequest('An open safety defect blocks hand-over.');
      if ((k.persons ?? 1) > h.maxGuests) throw new BadRequest('More guests than the house allows.');
      if (h.keyMethod !== 'KEY' && !ss.accessCode) throw new BadRequest('Set a new access code for this stay first.');
      if (h.keyMethod === 'KEY' && !(n >= 1 && n <= h.keys)) throw new BadRequest(`Give the keys handed over (1 to ${h.keys}).`);
      let register = k.register ?? null;
      if (ss.channel === 'AIRBNB') {
        if (k.status !== 'confirmed' || !ss.airbnb?.answered?.accepted) throw new BadRequest('Accepted on Airbnb and not cancelled first.');
        if (to.length < 2) throw new BadRequest('Give the name of the guest who arrived.');
        if (to.toLowerCase() !== ss.airbnb.guestName.toLowerCase()) throw new BadRequest('The person must match the Airbnb guest name.');
        // Self check-in: main guest and number from Airbnb; full ID when the guest is met (answer 50).
        const idNo = text(b.idNo, 30);
        if (idNo) register = this.register(user, b);
      } else if (ss.channel === 'STAFF') {
        if (k.status !== 'confirmed') throw new BadRequest('Only a confirmed stay checks in.');
        if (to.length < 2) throw new BadRequest('Give who received the keys.');
      } else {
        const blocks = directCheckInBlocks(k, h);
        if (blocks.length) throw new BadRequest(`Keys cannot be handed over: ${blocks.join('; ')}.`);
        register = this.register(user, b);
        if (to.toLowerCase() !== k.guest.toLowerCase()) throw new BadRequest('The person who came must be the customer on record.');
      }
      const keys = h.keyMethod === 'KEY' ? n : 0;
      return {
        patch: { status: 'checked_in', register, foreign: register ? !/^(malaysia|malaysian|my)$/i.test(register.nationality) : k.foreign, ss: { ...ss, keysOut: { ...this.sign(user), n: keys, to } } },
        what: `Checked in; ${h.keyMethod === 'KEY' ? `${keys} key(s) to ${to}` : `access by ${h.keyMethod.toLowerCase().replace('_', ' ')}`}. House rules given.`,
        extra: async (tx) => {
          if (ss.requestId) {
            const r = await tx.get('stayRequests', ss.requestId);
            if (r) await tx.update('stayRequests', r.id, { status: 'in_stay', history: [...r.history, { at: this.now(), by: user.name, what: `Keys to ${to}` }] } as never);
          }
        },
      };
    });
  }

  private register(user: User, b: Body) {
    const idType = pick(['MYKAD', 'PASSPORT', 'OTHER'] as const, b.idType);
    const idNo = text(b.idNo, 30);
    const nationality = text(b.nationality, 60);
    if (!idType || idNo.length < 5 || nationality.length < 2) throw new BadRequest('Record the guest’s ID (type, number) and nationality (Innkeepers Act 1952).');
    return { idType, idNo, nationality, by: user.name, at: this.now() };
  }

  /** P24, P31, P37: a damage line needs a photo and the Asset Director's finding; the next step depends on the channel. */
  private async damage(user: User, id: Id, b: Body, version?: number) {
    this.mustDirector(user, 'decides damage');
    const st = await this.settings();
    const what = why(b.what, 'Say what was damaged or lost');
    const reason = why(b.reason, 'Give the finding: negligence, misuse or the occupant’s act (not wear and tear)');
    const photo = photoList(b.photo ? [b.photo] : [], 1, 'the damage')[0];
    const inventoryItem = text(b.inventoryItem, 80) || null;
    const amount = money(b.amount);
    const staffUserId = text(b.staffUserId, 80) || null;
    if (!(amount > 0)) throw new BadRequest('Give the cost (repair or replacement).');
    const k0 = await this.store.get('amBookings', id);
    if (!k0?.ss) throw new NotFound('Short-stay booking');
    if (k0.ss.channel === 'AIRBNB' && !inventoryItem) throw new BadRequest('Name the inventory line for an Airbnb claim.');
    if (k0.ss.channel === 'STAFF' && (!staffUserId || !k0.ss.requestId)) throw new BadRequest('Name the staff member it is recovered from.');
    if (staffUserId) {
      const r = await this.store.get('stayRequests', k0.ss.requestId!);
      if (!r || !r.occupantUserIds.includes(staffUserId)) throw new BadRequest('That staff member did not stay on this booking.');
    }
    const today = this.today();
    const d: SsDamage = {
      id: `dm-${id}-${toMs(this.now()) % 100000}-${Math.random().toString(36).slice(2, 5)}`,
      what,
      amount,
      inventoryItem,
      photo,
      reason,
      decided: this.sign(user),
      staffUserId: k0.ss.channel === 'STAFF' ? staffUserId : null,
      ack: null,
      claim: k0.ss.channel === 'AIRBNB' ? { filedOn: '' as IsoDate, caseNo: '', deadline: addDays(k0.checkOut, st.claimDeadlineDays), outcome: 'open', received: 0, banked: null } : null,
    };
    return this.onBooking(user, id, version, 'damage', (k) => {
      if (!['checked_in', 'checked_out'].includes(k.status)) throw new BadRequest('Damage is recorded during or after a stay.');
      // Direct and staff stays: on the bill (the department pays a staff stay). Airbnb: never charged outside Airbnb.
      const charges = k.ss!.channel === 'AIRBNB' ? k.charges ?? [] : [...(k.charges ?? []), { id: `ch-${k.id}-${(k.charges ?? []).length + 1}`, on: today, what: `Damage / loss: ${what}`, amount, reason, by: user.name, at: this.now() }];
      return {
        patch: { charges, ss: { ...k.ss!, damages: [...k.ss!.damages, d] } },
        what: `Damage RM${amount}: ${what} (${k.ss!.channel === 'AIRBNB' ? `claim through Airbnb by ${d.claim!.deadline}` : k.ss!.channel === 'STAFF' ? 'department pays; recovered from the staff member once acknowledged' : 'customer pays on the bill'})`,
        extra: async (tx) => {
          if (k.ss!.requestId) {
            const r = await tx.get('stayRequests', k.ss!.requestId);
            if (r) await tx.update('stayRequests', r.id, { damages: [...r.damages, { id: d.id, what, amount, photoSha: photo.sha256, reason, staffUserId: d.staffUserId, ack: null }] } as never);
          }
        },
      };
    });
  }

  // ---------- Finance (P29, P35, P37) ----------

  async finance_(user: User, action: string, id: Id, b: Body) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance confirms money in the bank)');
    const version = b.version == null ? undefined : Number(b.version);
    if (action === 'receipt') {
      const paymentId = text(b.paymentId, 120);
      const on = text(b.on, 10);
      const slipRef = text(b.slipRef, 40);
      const receiptNo = text(b.receiptNo, 40);
      return this.onBooking(user, id, version, 'receipt', (k) => {
        const p = k.payments.find((x) => x.id === paymentId);
        if (!p) throw new NotFound('Payment');
        if (p.banked) throw new BadRequest('Already confirmed.');
        if (!isDate(on) || on < p.on || on > this.today() || slipRef.length < 3) throw new BadRequest('Give the bank date and the statement reference.');
        if (receiptNo.length < 3) throw new BadRequest('Give the official receipt number (or the SQL Account receipt).');
        const payments = k.payments.map((x) => (x.id === p.id ? { ...x, receiptNo, banked: { on: on as IsoDate, slipRef, by: user.name } } : x));
        return { patch: { payments }, what: `Finance confirmed RM${p.amount} in the bank; receipt ${receiptNo} issued` };
      });
    }
    if (action === 'claimMoney') {
      const damageId = text(b.damageId, 80);
      const on = text(b.on, 10);
      const slipRef = text(b.slipRef, 40);
      return this.onBooking(user, id, version, 'claim_money', (k) => {
        const d = k.ss!.damages.find((x) => x.id === damageId);
        if (!d?.claim || !(d.claim.received > 0)) throw new BadRequest('No claim money to confirm.');
        if (d.claim.banked) throw new BadRequest('Already confirmed.');
        if (!isDate(on) || slipRef.length < 3) throw new BadRequest('Give the bank date and reference.');
        const damages = k.ss!.damages.map((x) => (x.id === d.id ? { ...x, claim: { ...x.claim!, banked: { on: on as IsoDate, slipRef, by: user.name } } } : x));
        return { patch: { ss: { ...k.ss!, damages } }, what: `Finance confirmed Airbnb claim money RM${d.claim.received}` };
      });
    }
    if (action === 'payout') return this.payout(user, b);
    if (action === 'payoutConfirm') return this.payoutConfirm(user, id, b);
    throw new BadRequest('Unknown Finance step.');
  }

  /** P35: Finance records an Airbnb payout with its lines and the earnings report. */
  private async payout(user: User, b: Body) {
    await this.need();
    const on = text(b.on, 10);
    const amount = money(b.amount);
    const bankRef = text(b.bankRef, 60);
    const account = text(b.account, 60);
    if (!isDate(on) || on > this.today()) throw new BadRequest('Give the date the payout came in.');
    if (!(amount > 0) || bankRef.length < 3 || account.length < 3) throw new BadRequest('Give the amount, bank reference and the company bank account.');
    const report = b.report && typeof b.report === 'object' ? { sha256: sha256Hex(String((b.report as Body).data ?? '')), name: text((b.report as Body).name, 120) } : typeof b.reportFile === 'string' && b.reportFile.length > 20 ? { sha256: sha256Hex(b.reportFile), name: 'Airbnb earnings report' } : null;
    if (!report || report.name.length < 3) throw new BadRequest('Upload the Airbnb earnings report.');
    const raw = (Array.isArray(b.lines) ? (b.lines as unknown[]) : []).map((l) => (typeof l === 'string' ? { bookingId: l } : (l as Body)));
    if (!raw.length) throw new BadRequest('Give at least one booking line.');
    const lines: SsPayout['lines'] = [];
    for (const l of raw.slice(0, 60)) {
      const k = await this.store.get('amBookings', text(l.bookingId, 80));
      if (!k?.ss?.airbnb) throw new BadRequest('Each line must be an Airbnb booking.');
      if (k.ss.airbnb.payoutId) throw new BadRequest(`${k.ss.airbnb.code} is already on a payout.`);
      const guestTotal = money(l.guestTotal ?? k.ss.airbnb.guestTotal);
      const hostFee = money(l.hostFee ?? k.ss.airbnb.hostFee);
      const taxKept = money(l.taxKept ?? k.ss.airbnb.taxKept);
      lines.push({ bookingId: k.id, code: k.ss.airbnb.code, guestTotal, hostFee, taxKept, net: r2(guestTotal - hostFee - taxKept) });
    }
    const diff = r2(amount - lines.reduce((n, l) => n + l.net, 0));
    const row: SsPayout = { id: this.newId('ss-po'), kind: 'payout', on: on as IsoDate, amount, bankRef, account, report, lines, diff, explained: text(b.explained, 500), status: 'recorded', by: user.name, at: this.now(), confirmed: null };
    return this.store.transaction(async (tx) => {
      await tx.insert('ssRecs', row as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.payout', entity: 'ss_recs', entityId: row.id, summary: `Airbnb payout RM${amount} (${lines.length} booking(s)), difference RM${diff}` });
      return row;
    });
  }

  private async payoutConfirm(user: User, id: Id, b: Body) {
    const st = await this.settings();
    const slipRef = text(b.slipRef, 40);
    const explained = text(b.explained, 500);
    return this.store.transaction(async (tx) => {
      await tx.lock?.('ssRecs', id);
      const po = (await tx.get('ssRecs', id)) as SsPayout | undefined;
      if (!po || po.kind !== 'payout') throw new NotFound('Payout');
      if (po.status === 'confirmed') throw new BadRequest('Already confirmed.');
      if (slipRef.length < 3) throw new BadRequest('Give the bank statement reference.');
      const why2 = explained || po.explained;
      if (Math.abs(po.diff) > st.payoutDiffRm && why2.length < 5) throw new BadRequest(`The payout differs by RM${po.diff} from the bookings. Write what it is before confirming (the Asset Director is told).`);
      for (const l of po.lines) {
        const k = await tx.get('amBookings', l.bookingId);
        if (!k?.ss?.airbnb) continue;
        await tx.update('amBookings', k.id, { ss: { ...k.ss, airbnb: { ...k.ss.airbnb, payoutId: po.id } }, history: [...k.history, { at: this.now(), by: user.name, what: `Payout matched by Finance: RM${l.net}` }], version: k.version + 1 } as never);
      }
      await tx.update('ssRecs', id, { status: 'confirmed', explained: why2, confirmed: { ...this.sign(user), slipRef } } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.payout_confirm', entity: 'ss_recs', entityId: id, summary: `Airbnb payout RM${po.amount} confirmed in the bank (${slipRef})${po.diff ? `; difference RM${po.diff}: ${why2}` : ''}` });
      return { id };
    });
  }

  // ---------- Staff stay requests (P20, P21, P24) ----------

  async request(user: User, b: Body) {
    if (!this.requester(user)) throw new AccessDenied('view', '(Government Operations and HQ departments ask for staff stays)');
    await this.need();
    const st = await this.settings();
    const { checkIn, checkOut } = this.dates(b);
    const propertyId = text(b.propertyId, 80) || null;
    const town = text(b.town, 80);
    const persons = Math.round(num(b.persons));
    const purpose = text(b.purpose, 60);
    const purposeNote = text(b.purposeNote, 300);
    const work = b.work !== false;
    if (!propertyId && town.length < 2) throw new BadRequest('Choose a house, or the town for any free house.');
    if (propertyId) this.houseOf(await this.store.get('amProperties', propertyId));
    if (!(persons >= 1 && persons <= 30)) throw new BadRequest('Give the number of occupants.');
    if (purpose.length < 2) throw new BadRequest('Give the purpose.');
    const occ = Array.isArray(b.occupants) ? (b.occupants as Body[]) : [];
    if (occ.length !== persons) throw new BadRequest(`Name all ${persons} occupant(s).`);
    const occupants: StayRequest['occupants'] = [];
    for (const o of occ) {
      const uid = text(o.userId, 80) || null;
      if (uid) {
        const u = await this.store.get('users', uid);
        if (!u) throw new BadRequest('Pick occupants from the staff list.');
        occupants.push({ userId: uid, name: u.name, phone: '' });
      } else {
        const name = text(o.name, 120);
        const phone = text(o.phone, 30);
        if (name.length < 2 || !/^[0-9+\-\s]{8,20}$/.test(phone)) throw new BadRequest('An outsider needs a name and a phone number.');
        occupants.push({ userId: null, name, phone });
      }
    }
    const keyReceiver = text(b.keyReceiver, 120) || user.name;
    const proof = work ? null : b.proof ? photoList([b.proof], 1, 'the transfer proof')[0] : null;
    if (!work && !proof) throw new BadRequest('A private stay is paid upfront: upload the transfer proof (answer 34).');
    const rate = staffRateOn(st, checkIn);
    const price = r2(rate.amount * rateUnits({ checkIn, checkOut, qty: 1, rateBasis: rate.basis, persons }));
    if (b.priceSeen !== price) throw new BadRequest(`The price is RM${price} (RM${rate.amount} ${rate.basis.toLowerCase().replace(/_/g, ' ')}). Confirm it to send.`);
    const rid = this.newId('ss-rq');
    const row: StayRequest = {
      id: rid,
      ref: `RP-${this.today().slice(0, 4)}-${rid.slice(-5).toUpperCase()}`,
      requesterId: user.id,
      requester: user.name,
      department: user.department ?? (isOgm(user) ? 'Government Operations' : isOpsDirector(user) ? 'Private Operations' : ''),
      propertyId,
      town,
      checkIn,
      checkOut,
      persons,
      purpose,
      purposeNote,
      occupants,
      occupantUserIds: occupants.map((o) => o.userId).filter((x): x is Id => !!x),
      keyReceiver,
      work,
      proof,
      price,
      status: 'submitted',
      bookingId: null,
      note: '',
      damages: [],
      complaints: [],
      history: [{ at: this.now(), by: user.name, what: `Asked for ${persons} occupant(s), ${checkIn} to ${checkOut}, RM${price}${work ? ', billed to the department' : ', paid by transfer'}` }],
      at: this.now(),
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('stayRequests', row as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.request', entity: 'stay_requests', entityId: row.id, summary: `Staff stay request ${row.ref}: ${persons} occupant(s) ${checkIn} to ${checkOut}` });
      return row;
    });
  }

  /** P21: the Asset team checks the request; nobody confirms their own. Confirm creates the booking on the house calendar. */
  async requestCheck(user: User, id: Id, b: Body) {
    this.mustTeam(user, 'checks staff stay requests');
    const outcome = pick(['return', 'not_available', 'confirm'] as const, b.outcome);
    if (!outcome) throw new BadRequest('Choose return, not available or confirm.');
    const r = await this.store.get('stayRequests', id);
    if (!r) throw new NotFound('Request');
    if (r.status !== 'submitted') throw new BadRequest('Only a request waiting for the check.');
    if (r.requesterId === user.id) throw new BadRequest('You asked for this stay, so someone else confirms it.');
    if (outcome !== 'confirm') {
      const note = why(b.note, outcome === 'return' ? 'Say what to correct' : 'Say why (the applicant may pick other dates or a house)');
      return this.store.transaction(async (tx) => {
        await tx.update('stayRequests', id, { status: outcome === 'return' ? 'returned' : 'not_available', note, history: [...r.history, { at: this.now(), by: user.name, what: `${outcome === 'return' ? 'Returned for correction' : 'Not available'}: ${note}` }] } as never);
        await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: `asset.ss.request.${outcome}`, entity: 'stay_requests', entityId: id, summary: `${r.ref}: ${note}` });
        return { id };
      });
    }
    const propertyId = text(b.propertyId, 80) || r.propertyId;
    const p = await this.store.get('amProperties', propertyId ?? '');
    const h = this.houseOf(p);
    if (r.persons > h.beds) throw new BadRequest(`The house has ${h.beds} beds for ${r.persons} occupants.`);
    const st = await this.settings();
    const rate = staffRateOn(st, r.checkIn);
    const row = this.baseBooking(user, p!, h, {
      guest: `${r.department || 'Department'}: ${r.occupants.map((o) => o.name).join(', ')}`.slice(0, 200),
      phone: '',
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      persons: r.persons,
      rate: rate.amount,
      listRate: rate.amount,
      discountReason: '',
      internal: r.work,
      billTo: r.work ? r.department || r.requester : '',
      rateBasis: rate.basis,
      // Work stays are billed to the department and confirmed at once; a private stay waits for Finance (answer 34).
      status: r.work ? 'confirmed' : 'held',
      holdUntil: addWorkingDaysExcept(this.today(), st.holdWorkingDays, new Set()),
      ss: this.blankInfo('STAFF', { purpose: r.purpose, work: r.work, requestId: r.id, checked: { ...this.sign(user), ok: true, note: 'Form, dates, occupants and purpose checked' }, customer: { ...this.sign(user), confirmed: true, note: r.work ? 'Billed to the department' : 'Paid upfront' } }),
      what: r.work ? `Staff stay ${r.ref} confirmed, billed to ${r.department || r.requester}` : `Staff stay ${r.ref} held for Finance to confirm the payment`,
    });
    const saved = await this.insertBooking(user, p!, h, row, `${p!.name}: staff stay ${r.ref}, ${r.persons} occupant(s) ${r.checkIn} to ${r.checkOut}`);
    if (!r.work && r.proof)
      await this.store.update('amBookings', saved.id, { payments: [{ id: `sp-${saved.id}-1`, on: this.today(), amount: r.price, method: 'TRANSFER', receiptNo: '', ref: `proof ${r.proof.sha256.slice(0, 12)}`, by: user.name, at: this.now(), banked: null }] } as never);
    await this.store.transaction(async (tx) => {
      await tx.update('stayRequests', id, { status: r.work ? 'confirmed' : 'held', bookingId: saved.id, propertyId: p!.id, history: [...r.history, { at: this.now(), by: user.name, what: r.work ? `Confirmed at ${p!.name}` : `Held at ${p!.name}; confirmed once Finance sees the money` }] } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.request.confirm', entity: 'stay_requests', entityId: id, summary: `${r.ref} → ${saved.ref}` });
    });
    return { id, bookingId: saved.id };
  }

  /** A private staff stay is confirmed once Finance has confirmed the money (H1 4.3). */
  async requestPaid(user: User, id: Id) {
    this.mustTeam(user, 'confirms a paid staff stay');
    const r = await this.store.get('stayRequests', id);
    if (!r?.bookingId || r.status !== 'held') throw new BadRequest('Only a held private stay.');
    if (r.requesterId === user.id) throw new BadRequest('You asked for this stay, so someone else confirms it.');
    const k = await this.store.get('amBookings', r.bookingId);
    if (!k || !k.payments.some((p) => p.banked)) throw new BadRequest('Finance has not confirmed the money yet.');
    await this.onBooking(user, k.id, undefined, 'staff_paid', (kk) => ({ patch: { status: 'confirmed' }, what: 'Payment confirmed by Finance; staff stay confirmed' }));
    await this.store.update('stayRequests', id, { status: 'confirmed', history: [...r.history, { at: this.now(), by: user.name, what: 'Confirmed: Finance saw the money' }] } as never);
    return { id };
  }

  async requestResubmit(user: User, id: Id, b: Body) {
    const r = await this.store.get('stayRequests', id);
    if (!r || r.requesterId !== user.id) throw new NotFound('Request');
    if (!['returned', 'not_available'].includes(r.status)) throw new BadRequest('Only a returned request is sent again.');
    const { checkIn, checkOut } = this.dates({ checkIn: b.checkIn ?? r.checkIn, checkOut: b.checkOut ?? r.checkOut });
    const st = await this.settings();
    const rate = staffRateOn(st, checkIn);
    const price = r2(rate.amount * rateUnits({ checkIn, checkOut, qty: 1, rateBasis: rate.basis, persons: r.persons }));
    await this.store.update('stayRequests', id, { checkIn, checkOut, price, propertyId: text(b.propertyId, 80) || r.propertyId, status: 'submitted', note: '', history: [...r.history, { at: this.now(), by: user.name, what: `Sent again: ${checkIn} to ${checkOut}, RM${price}` }] } as never);
    return { id };
  }

  async requestCancel(user: User, id: Id, b: Body) {
    const r = await this.store.get('stayRequests', id);
    if (!r || r.requesterId !== user.id) throw new NotFound('Request');
    if (!['submitted', 'returned', 'not_available', 'held', 'confirmed'].includes(r.status)) throw new BadRequest('This request can no longer be cancelled.');
    const reason = why(b.reason);
    if (r.bookingId) {
      const k = await this.store.get('amBookings', r.bookingId);
      if (k && ['held', 'confirmed'].includes(k.status)) await this.store.update('amBookings', k.id, { status: 'cancelled', history: [...k.history, { at: this.now(), by: user.name, what: `Cancelled by the applicant: ${reason}` }], version: k.version + 1 } as never);
    }
    await this.store.transaction(async (tx) => {
      await tx.update('stayRequests', id, { status: 'cancelled', history: [...r.history, { at: this.now(), by: user.name, what: `Cancelled: ${reason}` }] } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.request.cancel', entity: 'stay_requests', entityId: id, summary: `${r.ref}: ${reason}` });
    });
    return { id };
  }

  /** Answer 32: the staff member acknowledges the damage line (photo and amount shown, consent wording); recovery starts. */
  async acknowledge(user: User, id: Id, b: Body) {
    const r = await this.store.get('stayRequests', id);
    if (!r) throw new NotFound('Request');
    const damageId = text(b.damageId, 80);
    const d = r.damages.find((x) => x.id === damageId);
    if (!d || d.staffUserId !== user.id) throw new AccessDenied('view', '(only the staff member named on the damage line acknowledges it)');
    if (d.ack) throw new BadRequest('Already acknowledged.');
    if (b.consent !== true) throw new BadRequest('Read the consent wording and tick it to acknowledge.');
    const ack = { ...this.sign(user), consent: SS_DEDUCTION_CONSENT };
    const rec: SsRecovery = { id: `ss-rcv-${damageId}`, kind: 'recovery', userId: user.id, personId: user.personId ?? null, name: user.name, bookingId: r.bookingId!, damageId, amount: d.amount, consent: SS_DEDUCTION_CONSENT, ackAt: this.now(), status: 'due', recovered: null };
    return this.store.transaction(async (tx) => {
      await tx.update('stayRequests', id, { damages: r.damages.map((x) => (x.id === damageId ? { ...x, ack } : x)), history: [...r.history, { at: this.now(), by: user.name, what: `Damage RM${d.amount} acknowledged with written consent` }] } as never);
      await tx.insert('ssRecs', rec as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.damage_ack', entity: 'stay_requests', entityId: id, summary: `${r.ref}: damage RM${d.amount} acknowledged; recovery due from the next staff pay` });
      return { id };
    });
  }

  /** Consented recoveries due for a person (staff payroll reads these as deductions). */
  async recoveriesDue(personId: Id): Promise<SsRecovery[]> {
    if (!(await this.installed())) return [];
    return ((await this.store.list('ssRecs', {}).catch(() => [])) as SsRec[]).filter((x): x is SsRecovery => x.kind === 'recovery' && x.status === 'due' && x.personId === personId);
  }
  async markRecovered(ids: Id[], period: string, by: string) {
    for (const id of ids) {
      const r = (await this.store.get('ssRecs', id)) as SsRecovery | undefined;
      if (r && r.status === 'due') await this.store.update('ssRecs', id, { status: 'recovered', recovered: { period, by, at: this.now() } } as never);
    }
  }

  // ---------- Enquiries, complaints, cleaning, counts (P27, P38, SOP A-C) ----------

  async enquiry(user: User, b: Body) {
    this.mustTeam(user, 'logs enquiries');
    await this.need();
    const from = text(b.from, 10);
    const to = text(b.to, 10);
    const guests = Math.round(num(b.guests));
    const channel = text(b.channel, 40);
    const answer = pick(['available', 'not_available', 'other_dates'] as const, b.answer);
    if (!isDate(from) || !isDate(to) || to <= from) throw new BadRequest('Give the dates asked.');
    if (!(guests >= 1) || channel.length < 2 || !answer) throw new BadRequest('Give the guests, the channel and the answer given.');
    const row: SsEnquiry = { id: this.newId('ss-enq'), kind: 'enquiry', propertyId: text(b.propertyId, 80) || null, channel, from: from as IsoDate, to: to as IsoDate, guests, answer, wentOn: b.wentOn === true, by: user.name, at: this.now() };
    await this.store.insert('ssRecs', row as never);
    return row;
  }

  async complaint(user: User, b: Body) {
    await this.need();
    const level = pick(['URGENT', 'NORMAL', 'REVIEW'] as const, b.level);
    const bookingId = text(b.bookingId, 80) || null;
    const what = why(b.what, 'Say what the complaint is');
    const stars = b.stars == null || b.stars === '' ? null : Math.round(num(b.stars));
    if (!level) throw new BadRequest('Choose the level: urgent, normal or review.');
    if (level === 'REVIEW' && !(stars != null && stars >= 1 && stars <= 3)) throw new BadRequest('A review complaint is a review of 3 stars or less.');
    let propertyId: Id | null = text(b.propertyId, 80) || null;
    if (!this.team(user)) {
      // The requesting department raises a complaint on its own staff stay (SOP B6); the Asset team logs it.
      const r = (await this.store.list('stayRequests', {})).find((x) => (x.id === text(b.requestId, 80) || (bookingId && x.bookingId === bookingId)) && x.requesterId === user.id);
      if (!r) throw new AccessDenied('view', '(the Asset Management team logs complaints; a department only on its own stay)');
      await this.store.update('stayRequests', r.id, { complaints: [...(r.complaints ?? []), { at: this.now(), by: user.name, level, what, loggedRef: null }], history: [...r.history, { at: this.now(), by: user.name, what: `Complaint raised (${level})` }] } as never);
      return { id: r.id, ref: '', message: 'Aduan dihantar kepada Pengurusan Aset. / Complaint sent to Asset Management.' };
    }
    const fromRequestId = text(b.fromRequestId, 80) || null;
    if (bookingId) {
      const k = await this.store.get('amBookings', bookingId);
      if (!k) throw new NotFound('Booking');
      propertyId = k.propertyId;
    }
    const year = this.today().slice(0, 4);
    return this.store.transaction(async (tx) => {
      // Numbers run in order: one counter row per year under a lock.
      const cid = `ss-cnum-${year}`;
      await tx.lock?.('ssRecs', cid);
      const all = ((await tx.list('ssRecs', {})) as SsRec[]).filter((x): x is SsComplaint => x.kind === 'complaint' && x.ref.startsWith(`SC-${year}-`));
      const n = all.reduce((m, x) => Math.max(m, Number(x.ref.slice(-4))), 0) + 1;
      const row: SsComplaint = { id: this.newId('ss-cp'), kind: 'complaint', ref: complaintRef(year, n), level, bookingId, propertyId, channel: text(b.channel, 40) || 'In person', from: text(b.from, 120) || user.name, what, stars, aboutUserId: text(b.aboutUserId, 80) || null, raisedById: user.id, raisedBy: user.name, at: this.now(), answered: null, investigatedBy: '', action: '', status: 'open', closed: null };
      await tx.insert('ssRecs', row as never);
      if (fromRequestId) {
        const r = await tx.get('stayRequests', fromRequestId);
        if (r) {
          let done = false;
          const complaints = (r.complaints ?? []).map((c) => (!done && !c.loggedRef ? ((done = true), { ...c, loggedRef: row.ref }) : c));
          await tx.update('stayRequests', r.id, { complaints } as never);
        }
      }
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.complaint', entity: 'ss_recs', entityId: row.id, summary: `Complaint ${row.ref} (${level})` });
      return { ...row, message: `Aduan anda direkod: ${row.ref}. / Your complaint is recorded: ${row.ref}.` };
    });
  }

  async complaintStep(user: User, id: Id, b: Body) {
    const step = pick(['answer', 'investigate', 'close'] as const, b.step);
    if (!step) throw new BadRequest('Unknown step.');
    const st = await this.settings();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('ssRecs', id);
      const c = (await tx.get('ssRecs', id)) as SsComplaint | undefined;
      if (!c || c.kind !== 'complaint') throw new NotFound('Complaint');
      if (c.status === 'closed') throw new BadRequest('Already closed.');
      let patch: Partial<SsComplaint>;
      if (step === 'answer') {
        this.mustTeam(user, 'answers complaints');
        patch = { answered: { ...this.sign(user), note: why(b.note, 'Say what the complainant was told') } };
      } else if (step === 'investigate') {
        this.mustTeam(user, 'looks into complaints');
        if (c.aboutUserId === user.id) throw new BadRequest('The complaint is about you, so someone else looks into it.');
        patch = { investigatedBy: user.name, action: why(b.action, 'Say what was done') };
      } else {
        const deputy = this.team(user) && st.deputyIds.includes(user.id);
        if (!this.director(user) && !deputy) throw new AccessDenied('view', '(the Asset Director or a deputy closes complaints)');
        if (c.level === 'URGENT' && !this.director(user)) throw new BadRequest('An urgent complaint is closed by the Asset Director.');
        if (c.aboutUserId === user.id) throw new BadRequest('The complaint names you, so someone else closes it.');
        if (!c.action) throw new BadRequest('Record what was done first.');
        patch = { status: 'closed', closed: { ...this.sign(user), note: why(b.note, 'Say how it was closed and that the complainant was told') } };
      }
      await tx.update('ssRecs', id, patch as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: `asset.ss.complaint.${step}`, entity: 'ss_recs', entityId: id, summary: `${c.ref}: ${step}` });
      return { id };
    });
  }

  async clean(user: User, b: Body) {
    this.mustTeam(user, 'records cleaning');
    await this.need();
    const propertyId = text(b.propertyId, 80);
    const type = pick(['TURNOVER', 'FINAL', 'DEEP', 'NEEDED'] as const, b.type);
    const cleaner = text(b.cleaner, 120);
    const vendor = text(b.vendor, 120);
    const start = text(b.start, 30);
    const finish = text(b.finish, 30);
    const ticks = Array.isArray(b.ticks) ? (b.ticks as unknown[]).map((x) => text(x, 120)) : [];
    const photos = photoList(b.photos, 2, 'the cleaned house');
    if (!type || cleaner.length < 2) throw new BadRequest('Give the clean type and who cleaned.');
    if (!start || !finish || finish < start) throw new BadRequest('Give the start and finish times.');
    const areas = SS_CHECKLIST.slice(1, 6);
    const miss = areas.filter((a) => !ticks.includes(a));
    if (miss.length) throw new BadRequest(`Tick every area: ${miss.join(', ')}.`);
    const bookingId = text(b.bookingId, 80) || null;
    const row: SsClean = { id: this.newId('ss-cl'), kind: 'clean', propertyId, bookingId, type, cleaner, vendor, start: start as IsoDateTime, finish: finish as IsoDateTime, ticks, photos, by: user.name, byId: user.id, checked: null, at: this.now() };
    return this.store.transaction(async (tx) => {
      await tx.lock?.('amProperties', propertyId);
      const p = await tx.get('amProperties', propertyId);
      const h = this.houseOf(p);
      if (type === 'TURNOVER' && bookingId) {
        const k = await tx.get('amBookings', bookingId);
        if (!k?.ss?.after) throw new BadRequest('Do the after-stay inspection before cleaning, so evidence is not lost (SOP A3 step 2).');
      }
      await tx.insert('ssRecs', row as never);
      const house: SsHouse = { ...h, hk: 'clean', hkBy: user.name, hkById: user.id, hkAt: this.now(), ...(type === 'DEEP' ? { lastDeepCleanOn: this.today(), staysSinceDeepClean: 0 } : {}) };
      await tx.update('amProperties', propertyId, { stay: { ...p!.stay!, house } } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.clean', entity: 'ss_recs', entityId: row.id, summary: `${p!.name}: ${type.toLowerCase()} clean by ${vendor || cleaner}` });
      return row;
    });
  }

  /** SOP A4a: own cleaning team vs vendors, side by side; the Asset Director picks with a reason. */
  async cleanerChoice(user: User, b: Body) {
    const id = text(b.id, 80);
    if (id) {
      this.mustDirector(user, 'picks who cleans an area');
      const name = text(b.name, 120);
      const reason = why(b.reason);
      return this.store.transaction(async (tx) => {
        await tx.lock?.('ssRecs', id);
        const c = (await tx.get('ssRecs', id)) as SsCleanerChoice | undefined;
        if (!c || c.kind !== 'cleaner') throw new NotFound('Cleaner comparison');
        if (!c.options.some((o) => o.name === name)) throw new BadRequest('Pick one of the options.');
        await tx.update('ssRecs', id, { picked: { ...this.sign(user), name, reason } } as never);
        await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.cleaner_pick', entity: 'ss_recs', entityId: id, summary: `${c.area}: ${name} chosen: ${reason}` });
        return { id };
      });
    }
    this.mustTeam(user, 'compares cleaning costs');
    await this.need();
    const area = text(b.area, 80);
    const raw = Array.isArray(b.options) ? (b.options as Body[]) : [];
    const options = raw.slice(0, 8).map((o) => ({ name: text(o.name, 120), own: o.own === true, turnover: money(o.turnover), deep: money(o.deep), linen: money(o.linen ?? 0), travel: money(o.travel ?? 0), responseHours: num(o.responseHours ?? 4) }));
    if (area.length < 2) throw new BadRequest('Give the area.');
    if (options.filter((o) => !o.own).length < 3 || !options.some((o) => o.own)) throw new BadRequest('Give 3 vendor quotes and the own cleaning team’s costing (SOP A4a).');
    if (options.some((o) => o.name.length < 2 || !(o.turnover > 0) || !(o.deep > 0))) throw new BadRequest('Each option needs a name and prices per turnover and deep clean.');
    const row: SsCleanerChoice = { id: this.newId('ss-cc'), kind: 'cleaner', area, options, picked: null, by: user.name, at: this.now() };
    await this.store.insert('ssRecs', row as never);
    return row;
  }

  /** SOP C5: the 3-monthly full count by two people; differences above the setting go to Finance and ACT. */
  async count(user: User, b: Body) {
    this.mustTeam(user, 'counts house inventory');
    await this.need();
    const st = await this.settings();
    const id = text(b.id, 80);
    if (id) {
      return this.store.transaction(async (tx) => {
        await tx.lock?.('ssRecs', id);
        const c = (await tx.get('ssRecs', id)) as SsCount | undefined;
        if (!c || c.kind !== 'count') throw new NotFound('Count');
        if (c.verified) throw new BadRequest('Already verified.');
        if (c.counted.byId === user.id) throw new BadRequest('A second person verifies the count.');
        await tx.update('ssRecs', id, { verified: this.sign(user) } as never);
        const p = await tx.get('amProperties', c.propertyId);
        const h = this.houseOf(p);
        await tx.update('amProperties', c.propertyId, { stay: { ...p!.stay!, house: { ...h, lastFullCountOn: this.today() } } } as never);
        await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.ss.count_verify', entity: 'ss_recs', entityId: id, summary: `${p!.name}: full count verified; difference RM${c.diffValue}${c.diffValue > st.countDiffRm ? ' (to Finance and ACT)' : ''}` });
        return { id };
      });
    }
    const propertyId = text(b.propertyId, 80);
    const p = await this.store.get('amProperties', propertyId);
    const h = this.houseOf(p);
    if (!h.inventory.length) throw new BadRequest('Set the house inventory list first.');
    const counted = (b.counted ?? {}) as Record<string, unknown>;
    const lines = h.inventory.map((l) => {
      const c = Math.round(num(counted[l.item]));
      if (!(c >= 0)) throw new BadRequest(`Give the count for ${l.item}.`);
      return { item: l.item, listed: l.qty, counted: c, value: l.value };
    });
    const diffValue = r2(lines.reduce((n, l) => n + Math.max(0, l.listed - l.counted) * l.value, 0));
    const note = diffValue > 0 ? why(b.note, 'Explain every difference') : text(b.note, 500);
    const row: SsCount = { id: this.newId('ss-ct'), kind: 'count', propertyId, lines, diffValue, photos: photoList(b.photos, 1, 'the count'), counted: this.sign(user), verified: null, note, at: this.now() };
    await this.store.insert('ssRecs', row as never);
    return row;
  }

  // ---------- Act, board, home ----------

  async act(user: User, action: string, b: Body) {
    const id = text(b.id, 120);
    switch (action) {
      case 'settings':
        return this.setSettings(user, b);
      case 'house.setup':
        return this.houseSetup(user, id, b);
      case 'house.use':
        return this.houseUse(user, id, b);
      case 'house.inventory':
        return this.houseInventory(user, id, b);
      case 'house.status':
        return this.houseStatus(user, id, b);
      case 'house.defect':
        return this.houseDefect(user, id, b);
      case 'book':
        return this.bookDirect(user, b);
      case 'airbnb':
        return this.bookAirbnb(user, b);
      case 'step':
        return this.step(user, id, b);
      case 'finance':
        return this.finance_(user, text(b.what, 30), id, b);
      case 'request':
        return this.request(user, b);
      case 'request.check':
        return this.requestCheck(user, id, b);
      case 'request.paid':
        return this.requestPaid(user, id);
      case 'request.resubmit':
        return this.requestResubmit(user, id, b);
      case 'request.cancel':
        return this.requestCancel(user, id, b);
      case 'ack':
        return this.acknowledge(user, id, b);
      case 'enquiry':
        return this.enquiry(user, b);
      case 'complaint':
        return this.complaint(user, b);
      case 'complaint.step':
        return this.complaintStep(user, id, b);
      case 'clean':
        return this.clean(user, b);
      case 'cleaner':
        return this.cleanerChoice(user, b);
      case 'count':
        return this.count(user, b);
      default:
        throw new BadRequest('Unknown short-stay action.');
    }
  }

  /**
   * The short-stay board (P25, P33, P39). The Asset team and Finance see customer details; group leaders read tiles
   * and masked lists. The access code shows to the team only. Requesters see only their own requests.
   */
  async board(user: User) {
    const team = this.team(user);
    const fin = this.finance(user);
    const oversee = !user.integration && assetRole(user) === 'oversee';
    const installed = await this.installed();
    const mine = installed && this.requester(user) ? (await this.store.list('stayRequests', {})).filter((r) => r.requesterId === user.id || r.occupantUserIds.includes(user.id)) : [];
    const myRequests = mine.map((r) => ({ ...r, proof: r.proof ? { sha256: r.proof.sha256 } : null, damages: r.damages.map((d) => ({ ...d, mine: d.staffUserId === user.id })) }));
    if (!team && !fin && !oversee) return { role: 'requester' as const, installed, settings: null, houses: [], bookings: [], requests: [], myRequests, payouts: [], complaints: [], cleans: [], cleaners: [], counts: [], recoveries: [], enquiries: [], tiles: null, consent: SS_DEDUCTION_CONSENT };
    const today = this.today();
    const nowMs = toMs(this.now());
    const st = await this.settings();
    const props = (await this.store.list('amProperties', {})).filter((p) => p.kind === 'HOMESTAY');
    const all = (await this.store.list('amBookings', {}).catch(() => [])).filter((k) => !!k.ss);
    const recs = installed ? ((await this.store.list('ssRecs', {})) as SsRec[]) : [];
    const requests = installed ? await this.store.list('stayRequests', {}) : [];
    const seeCustomer = team || fin;
    const acked = new Set(requests.flatMap((r) => r.damages.filter((d) => d.ack).map((d) => d.id)));
    const houses = props.map((p) => {
      const h = (p.stay as (AmStaySetup & { house?: SsHouse }) | null | undefined)?.house ?? null;
      const mineB = all.filter((k) => k.propertyId === p.id);
      const unblocked = h ? mineB.filter((k) => bookingHolds(k, today) && k.checkOut > today && h.platforms.some((x) => !k.ss!.blocked[x])) : [];
      const deepDue = h ? (h.lastDeepCleanOn ? addDays(h.lastDeepCleanOn, st.deepCleanMonths * 30) <= today : true) || h.staysSinceDeepClean >= st.deepCleanStays : false;
      const countDue = h ? !h.lastFullCountOn || addDays(h.lastFullCountOn, st.fullCountMonths * 30) <= today : false;
      const licenceWarn = h?.licence?.expiresOn ? daysBetween(today, h.licence.expiresOn) <= 60 : false;
      const month = today.slice(0, 7);
      const nightsThisMonth = mineB.filter((k) => ['confirmed', 'checked_in', 'checked_out'].includes(k.status)).reduce((n, k) => {
        let c = 0;
        for (let d = k.checkIn; d < k.checkOut; d = addDays(d, 1)) if (d.slice(0, 7) === month) c++;
        return n + c;
      }, 0);
      const income = r2(
        mineB.reduce((n, k) => n + k.payments.filter((x) => x.banked && x.banked.on.slice(0, 7) === month).reduce((m, x) => m + x.amount, 0), 0) +
          (recs.filter((x): x is SsPayout => x.kind === 'payout' && x.status === 'confirmed' && x.on.slice(0, 7) === month).flatMap((x) => x.lines).filter((l) => mineB.some((k) => k.id === l.bookingId)).reduce((n, l) => n + l.net, 0)),
      );
      return { id: p.id, name: p.name, town: p.town, state: p.state, rate: p.stay?.rates?.HOUSE ?? null, house: h ? { ...h, inventory: h.inventory } : null, unblocked: unblocked.map((k) => k.ref), deepDue, countDue, licenceWarn, occupancyPct: Math.round((nightsThisMonth / 30) * 100), income };
    });
    const bookings = all
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
      .slice(-300)
      .map((k) => {
        const h = houses.find((x) => x.id === k.propertyId)?.house ?? null;
        const ss = k.ss!;
        const bill = bookingBill(k);
        const banked = r2(k.payments.filter((x) => x.banked).reduce((n, x) => n + x.amount, 0));
        const flags: string[] = [];
        if (ss.channel === 'AIRBNB' && !ss.airbnb?.answered && (nowMs - toMs(ss.airbnb!.requestAt)) / 3_600_000 >= st.airbnbAnswerHours) flags.push('Airbnb request not answered');
        if (ss.channel !== 'AIRBNB' && !k.internal && k.status === 'confirmed' && daysBetween(today, k.checkIn) <= st.fullPayDaysBefore && banked + 0.001 < bill.total) flags.push('Full payment due');
        if (k.status === 'held' && ss.channel !== 'AIRBNB' && k.holdUntil < today) flags.push('No deposit: release the dates');
        if (k.status === 'held' && ss.channel !== 'AIRBNB' && k.holdUntil >= today && daysBetween(k.at.slice(0, 10) as IsoDate, today) >= 3) flags.push('Not confirmed after 3 working days');
        if (k.status === 'confirmed' && !ss.followUp && daysBetween(today, k.checkIn) <= st.followUpDaysBefore) flags.push('Follow-up due');
        if (k.status === 'confirmed' && !ss.prepared && daysBetween(today, k.checkIn) <= st.prepareDaysBefore) flags.push('Prepare the house');
        if (k.status === 'checked_in' && (today > k.checkOut || (today === k.checkOut && k.terms && nowMs > toMs(`${today}T${k.terms.checkOutTime}:00+08:00`) + st.lateKeysHours * 3_600_000))) flags.push('Keys not back');
        if (k.status === 'checked_out' && !ss.after) flags.push('After-stay inspection due');
        if (ss.channel === 'AIRBNB' && k.status !== 'cancelled' && !ss.airbnb?.payoutId && today >= addWorkingDaysExcept(k.checkIn, st.payoutWorkingDays, new Set())) flags.push('Payout not seen');
        for (const d of ss.damages) if (d.claim && !d.claim.caseNo && daysBetween(today, d.claim.deadline) <= st.claimRemindDaysBefore) flags.push(`Airbnb claim deadline ${d.claim.deadline}`);
        if (h && bookingHolds(k, today) && h.platforms.some((x) => !ss.blocked[x])) flags.push('Not blocked on every platform');
        return {
          id: k.id,
          ref: k.ref,
          propertyId: k.propertyId,
          channel: ss.channel,
          status: k.status,
          closed: !!ss.closed,
          checkIn: k.checkIn,
          checkOut: k.checkOut,
          persons: k.persons ?? 1,
          guest: seeCustomer ? k.guest : `${k.guest.slice(0, 1)}•••`,
          phone: seeCustomer ? k.phone : maskPhone(k.phone),
          register: seeCustomer ? k.register ?? null : null,
          internal: k.internal,
          billTo: k.billTo,
          rate: k.rate,
          rateBasis: k.rateBasis ?? 'PER_UNIT_NIGHT',
          bill,
          banked,
          payments: k.payments.map((x) => ({ id: x.id, on: x.on, amount: x.amount, method: x.method, receiptNo: x.receiptNo, banked: x.banked })),
          settlement: k.settlement ?? null,
          ss: { ...ss, accessCode: team ? ss.accessCode : ss.accessCode ? '••••' : null, keysOut: ss.keysOut ? { ...ss.keysOut, to: seeCustomer ? ss.keysOut.to : '•••' } : null, customer: ss.customer ? { ...ss.customer, note: seeCustomer ? ss.customer.note : '' } : null, prepared: ss.prepared ? { ...ss.prepared, photos: ss.prepared.photos.map((x) => ({ sha256: x.sha256 })) } : null, after: ss.after ? { ...ss.after, photos: ss.after.photos.map((x) => ({ sha256: x.sha256 })) } : null, damages: ss.damages.map((d) => ({ ...d, photo: { sha256: d.photo.sha256 } })), airbnb: ss.airbnb ? { ...ss.airbnb, guestName: seeCustomer ? ss.airbnb.guestName : `${ss.airbnb.guestName.slice(0, 1)}•••`, copy: ss.airbnb.copy ? { sha256: ss.airbnb.copy.sha256 } : null } : null },
          flags,
          closeBlocks: h ? this.closeBlocks(k, h, acked) : [],
          version: k.version,
        };
      });
    const complaints = recs.filter((x): x is SsComplaint => x.kind === 'complaint').map((c) => {
      const ageH = (nowMs - toMs(c.at)) / 3_600_000;
      return { ...c, late: (!c.answered && ageH > st.complaintAnswerHours[c.level]) || (c.status === 'open' && ageH > st.complaintCloseDays * 24) };
    });
    const payouts = recs.filter((x): x is SsPayout => x.kind === 'payout');
    const cleans = recs.filter((x): x is SsClean => x.kind === 'clean').slice(-100).map((c) => ({ ...c, photos: c.photos.map((x) => ({ sha256: x.sha256 })) }));
    const counts = recs.filter((x): x is SsCount => x.kind === 'count').map((c) => ({ ...c, photos: c.photos.map((x) => ({ sha256: x.sha256 })), toFinanceAct: c.diffValue > st.countDiffRm }));
    const enquiries = recs.filter((x): x is SsEnquiry => x.kind === 'enquiry').slice(-200);
    const month = today.slice(0, 7);
    const enquiryByChannel: Record<string, number> = {};
    for (const e of enquiries.filter((x) => x.at.slice(0, 7) === month)) enquiryByChannel[e.channel] = (enquiryByChannel[e.channel] ?? 0) + 1;
    const open = bookings.filter((k) => !['cancelled', 'no_show'].includes(k.status) && !k.closed);
    const tiles = {
      staffRequestsWaiting: requests.filter((r) => r.status === 'submitted').length,
      heldForDeposit: open.filter((k) => k.status === 'held' && k.channel !== 'AIRBNB').length,
      airbnbToAnswer: open.filter((k) => k.channel === 'AIRBNB' && !k.ss.airbnb?.answered).length,
      followUpsDue: open.filter((k) => k.flags.includes('Follow-up due')).length,
      housesToPrepare: open.filter((k) => k.flags.includes('Prepare the house')).length,
      fullPaymentsDue: open.filter((k) => k.flags.includes('Full payment due')).length,
      checkInsToday: open.filter((k) => k.checkIn === today && k.status === 'confirmed').length,
      checkOutsToday: open.filter((k) => k.checkOut === today && k.status === 'checked_in').length,
      keysNotBack: open.filter((k) => k.flags.includes('Keys not back')).length,
      inspectionsDue: open.filter((k) => k.flags.includes('After-stay inspection due')).length,
      openDamage: open.filter((k) => k.ss.damages.some((d) => (d.staffUserId && !d.ack && !acked.has(d.id)) || (d.claim && d.claim.outcome === 'open'))).length,
      payoutsNotMatched: open.filter((k) => k.channel === 'AIRBNB' && !k.ss.airbnb?.payoutId && k.status !== 'held').length,
      airbnbFeesThisMonth: r2(payouts.filter((p) => p.on.slice(0, 7) === month).flatMap((p) => p.lines).reduce((n, l) => n + l.hostFee, 0)),
      complaintsOpen: complaints.filter((c) => c.status === 'open').length,
      complaintsLate: complaints.filter((c) => c.status === 'open' && c.late).length,
      reviewScore: (() => {
        const s = complaints.filter((c) => c.stars != null).map((c) => c.stars!);
        return s.length ? r2(s.reduce((n, x) => n + x, 0) / s.length) : null;
      })(),
      housesDirty: houses.filter((x) => x.house?.hk === 'dirty').length,
      deepCleansDue: houses.filter((x) => x.deepDue).length,
      countsDue: houses.filter((x) => x.countDue).length,
      enquiryByChannel,
    };
    return {
      role: team ? (this.director(user) ? ('director' as const) : ('team' as const)) : fin ? ('finance' as const) : ('oversee' as const),
      installed,
      settings: st,
      houses,
      bookings,
      requests: team || fin ? requests.map((r) => ({ ...r, proof: r.proof ? { sha256: r.proof.sha256 } : null })) : requests.map((r) => ({ id: r.id, ref: r.ref, status: r.status, department: r.department, checkIn: r.checkIn, checkOut: r.checkOut, persons: r.persons, price: r.price })),
      myRequests,
      payouts: fin || team ? payouts : [],
      complaints,
      cleans,
      cleaners: recs.filter((x): x is SsCleanerChoice => x.kind === 'cleaner'),
      counts,
      recoveries: fin ? recs.filter((x): x is SsRecovery => x.kind === 'recovery') : [],
      enquiries: team ? enquiries : [],
      tiles,
      consent: SS_DEDUCTION_CONSENT,
    };
  }

  async homeItems(user: User): Promise<{ tone: 'warn' | 'crit'; tag: string; title: string; detail: string; go: { view: 'assets' | 'requests' } }[]> {
    if (!(await this.installed())) return [];
    type Item = { tone: 'warn' | 'crit'; tag: string; title: string; detail: string; go: { view: 'assets' | 'requests' } };
    const out: Item[] = [];
    const add = (tone: Item['tone'], title: string, detail: string, view: 'assets' | 'requests' = 'assets') => out.push({ tone, tag: view === 'requests' ? 'Staff stay' : 'Short stays', title, detail, go: { view } });
    if (this.requester(user)) {
      const reqs = await this.store.list('stayRequests', {});
      for (const r of reqs.filter((x) => x.damages.some((d) => d.staffUserId === user.id && !d.ack))) add('warn', 'Acknowledge a damage line on your stay', r.ref, 'requests');
      for (const r of reqs.filter((x) => x.requesterId === user.id && x.status === 'returned')) add('warn', `Correct and resend ${r.ref}`, r.note, 'requests');
    }
    if (!this.team(user) && !this.finance(user)) return out;
    const b = await this.board(user).catch(() => null);
    if (!b || !b.tiles) return out;
    if (this.team(user)) {
      const t = b.tiles;
      const toLog = (await this.store.list('stayRequests', {})).flatMap((r) => (r.complaints ?? []).filter((c) => !c.loggedRef).map(() => r.ref));
      if (toLog.length) add('warn', `${toLog.length} department complaint(s) to log`, toLog.slice(0, 3).join(', '));
      if (t.staffRequestsWaiting) add('warn', `${t.staffRequestsWaiting} staff stay request(s) to check`, 'Target 10 minutes');
      if (t.airbnbToAnswer) add('crit', `${t.airbnbToAnswer} Airbnb request(s) to answer`, 'Within 20 hours');
      for (const k of b.bookings.filter((x) => x.flags.length && !x.closed && !['cancelled', 'no_show'].includes(x.status)).slice(0, 8))
        add(k.flags.some((f) => /Keys not back|deadline|not answered/.test(f)) ? 'crit' : 'warn', `${k.ref}: ${k.flags.join(', ')}`, `${k.checkIn} to ${k.checkOut}`);
      if (t.complaintsLate) add('crit', `${t.complaintsLate} complaint(s) past the time target`, 'SOP B3');
      if (t.deepCleansDue) add('warn', `${t.deepCleansDue} deep clean(s) due`, 'Every 3 months or 20 stays');
      if (t.countsDue) add('warn', `${t.countsDue} full inventory count(s) due`, 'Two people, every 3 months');
    }
    if (this.finance(user)) {
      const toConfirm = b.bookings.filter((k) => k.payments.some((p) => !p.banked && p.amount > 0)).length;
      if (toConfirm) add('warn', `${toConfirm} short-stay payment(s) to confirm and receipt`, 'Money counts once Finance confirms');
      const pos = b.payouts.filter((p) => p.status === 'recorded').length;
      if (pos) add('warn', `${pos} Airbnb payout(s) to confirm`, 'Match to the earnings report');
    }
    return out;
  }
}

/** Pre-check used by the resort front desk: a short-stay booking runs through this service, never the resort steps. */
export const isShortStay = (k: Pick<AmBooking, 'ss'> | undefined | null) => !!k?.ss;
