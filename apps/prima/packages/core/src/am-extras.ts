import { addDays } from "./time";
import { daysBetween } from "./time";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";


// ---------- Contractors ----------

export const AM_TRADES = ['CIVIL', 'ROOFING', 'PLUMBING', 'ELECTRICAL', 'AIRCOND', 'PAINTING', 'LANDSCAPE', 'PEST', 'CLEANING', 'LIFT', 'FIRE', 'GENERAL'] as const;
export type AmTrade = (typeof AM_TRADES)[number];
export const AM_TRADE_LABEL: Record<AmTrade, string> = {
  CIVIL: 'Building and civil works',
  ROOFING: 'Roofing',
  PLUMBING: 'Plumbing',
  ELECTRICAL: 'Electrical',
  AIRCOND: 'Air conditioning',
  PAINTING: 'Painting',
  LANDSCAPE: 'Grass cutting and landscape',
  PEST: 'Pest control',
  CLEANING: 'Cleaning',
  LIFT: 'Lift',
  FIRE: 'Fire equipment',
  GENERAL: 'General repairs',
};
export const CIDB_GRADES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const;
export type AmContractorStatus = 'pending' | 'active' | 'suspended' | 'blacklisted';

export interface AmContractor {
  id: Id;
  name: string;
  /** SSM registration number; one record per number. */
  ssmNo: string;
  trades: AmTrade[];
  cidbGrade: (typeof CIDB_GRADES)[number] | null;
  cidbExpiry: IsoDate | null;
  /** States the contractor works in. */
  states: string[];
  contactName: string;
  phone: string;
  email: string;
  status: AmContractorStatus;
  addedBy: string;
  addedById: Id;
  addedAt: IsoDateTime;
  /** Every status change: approval to use, suspension, blacklisting, reinstatement. Never deleted. */
  decisions: { status: AmContractorStatus; by: string; byId: Id; at: IsoDateTime; reason: string }[];
  /** One rating per finished work order the contractor did. */
  ratings: { workOrderId: Id; quality: 1 | 2 | 3 | 4 | 5; onTime: boolean; note: string; by: string; byId: Id; at: IsoDateTime }[];
  version: number;
}

// ---------- Finding tenants ----------

export const AM_AD_CHANNELS = ['PORTAL', 'SIGNBOARD', 'AGENT', 'SOCIAL', 'NEWSPAPER', 'WORD_OF_MOUTH', 'OTHER'] as const;
export type AmAdChannel = (typeof AM_AD_CHANNELS)[number];
export const AM_AD_LABEL: Record<AmAdChannel, string> = {
  PORTAL: 'Property website',
  SIGNBOARD: 'Signboard at the unit',
  AGENT: 'Estate agent',
  SOCIAL: 'Social media',
  NEWSPAPER: 'Newspaper',
  WORD_OF_MOUTH: 'Word of mouth',
  OTHER: 'Other',
};
export const AM_LOST_REASONS = ['PRICE', 'LOCATION', 'CONDITION', 'SIZE', 'NO_RESPONSE', 'CHOSE_OTHER', 'UNIT_LET', 'NOT_SUITABLE', 'OTHER'] as const;
export type AmLostReason = (typeof AM_LOST_REASONS)[number];
export const AM_LOST_LABEL: Record<AmLostReason, string> = {
  PRICE: 'Rent too high',
  LOCATION: 'Location',
  CONDITION: 'Unit condition',
  SIZE: 'Size',
  NO_RESPONSE: 'Stopped answering',
  CHOSE_OTHER: 'Took another place',
  UNIT_LET: 'Unit let to someone else',
  NOT_SUITABLE: 'Not a suitable tenant',
  OTHER: 'Other',
};
export type AmEnquiryStatus = 'new' | 'viewing' | 'offer' | 'approved' | 'signed' | 'lost';

export interface AmEnquiry {
  id: Id;
  /** The person or business asking. Personal data: only the Asset Management team sees the phone number. */
  name: string;
  phone: string;
  source: AmAdChannel;
  on: IsoDate;
  /** What they want the unit for. */
  use: string;
  status: AmEnquiryStatus;
  viewingOn: IsoDate | null;
  offer: { rent: number; startOn: IsoDate; months: number; depositMonths: number; reason: string; by: string; byId: Id; at: IsoDateTime } | null;
  /** The Asset Director approves every offer, by someone other than whoever made it. */
  decision: { approve: boolean; note: string; by: string; byId: Id; at: IsoDateTime } | null;
  signed: { agreementRef: string; on: IsoDate; by: string; at: IsoDateTime } | null;
  lost: { reason: AmLostReason; note: string; by: string; at: IsoDateTime } | null;
  lastActionOn: IsoDate;
  notes: { on: IsoDate; text: string; by: string }[];
}

/** One letting file per unit being let: where it is advertised and everyone who asked about it. */
export interface AmLetting {
  id: Id;
  unitId: Id;
  adverts: { id: Id; channel: AmAdChannel; on: IsoDate; ref: string; by: string; at: IsoDateTime }[];
  enquiries: AmEnquiry[];
  version: number;
}

// ---------- Utility meters ----------

export interface AmMeterReading {
  id: Id;
  on: IsoDate;
  reading: number;
  /** Units used since the reading before; null for the first reading or after a new meter. */
  usage: number | null;
  /** Reference of the meter photo (the camera upload follows file storage). */
  photoRef: string;
  /** A new meter starts again from its own number. */
  newMeter: boolean;
  note: string;
  by: string;
  at: IsoDateTime;
}

export interface AmMeter {
  id: Id;
  unitId: Id | null;
  propertyId: Id | null;
  kind: 'ELECTRICITY' | 'WATER';
  account: string;
  payer: 'tenant' | 'owner';
  readings: AmMeterReading[];
  /** Bills the group pays itself (owner-paid meters). Recording a bill is not paying it. */
  bills: { id: Id; period: string; amount: number; billRef: string; by: string; at: IsoDateTime }[];
  version: number;
}

// ---------- Resort bookings ----------

export const AM_STAY_TYPES = ['ROOM', 'CHALET', 'HALL', 'CAMPSITE'] as const;
export type AmStayType = (typeof AM_STAY_TYPES)[number];
export const AM_STAY_LABEL: Record<AmStayType, string> = { ROOM: 'Room', CHALET: 'Chalet', HALL: 'Function hall', CAMPSITE: 'Camping pitch' };

/** A resort's rooms and the price list, set by the Asset Director. Stored on the property record. */
export interface AmStaySetup {
  capacity: Partial<Record<AmStayType, number>>;
  /** Price per unit per night, in RM, as approved. */
  rates: Partial<Record<AmStayType, number>>;
  setBy: string;
  setAt: IsoDateTime;
  /**
   * Each numbered room and chalet with its cleaning status (as hotels run housekeeping: dirty, clean, inspected) and
   * whether it is out of order for a stretch of nights. Out-of-order rooms are not sold.
   */
  rooms?: AmRoom[];
  /** Taxes and fees the resort collects on each stay, set by the Asset Director and confirmed by Finance. */
  taxes?: AmStayTaxes;
  /** House rules set in the app by the Asset Director (Fauzan, 5 Nov 2026): SST registration, MOTAC, times, cancellation. */
  policy?: AmStayPolicy;
}

/** The terms a guest books under. Copied onto each booking, so a later change does not alter what was agreed. */
export interface AmStayTerms {
  /** Check-in from, and check-out by, as HH:MM Malaysia time. */
  checkInTime: string;
  checkOutTime: string;
  /** Cancelled at least this many days before arrival: everything paid is refunded. */
  freeCancelDays: number;
  /** Cancelled later than that: this % of what was paid is kept. */
  lateCancelKeepPct: number;
  /** A guest who never arrives: this % of what was paid is kept. */
  noShowKeepPct: number;
}

export interface AmStayPolicy extends AmStayTerms {
  /** Whether the resort's company is registered for service tax. If not, no service tax is charged. */
  sstRegistered: boolean;
  /** MOTAC registration of tourist accommodation premises (Tourism Industry Act 1992). */
  motacNo: string;
  motacExpiresOn: IsoDate | null;
  setBy: string;
  setAt: IsoDateTime;
}

/** What is kept and what is owed back when a booking is cancelled or the guest does not arrive. */
export function cancelSettlement(paid: number, terms: AmStayTerms | null | undefined, kind: 'cancel' | 'noshow', daysBefore: number) {
  if (!terms) return null;
  const pct = kind === 'noshow' ? terms.noShowKeepPct : daysBefore >= terms.freeCancelDays ? 0 : terms.lateCancelKeepPct;
  const keep = r2((Math.max(0, paid) * pct) / 100);
  return { keepPct: pct, keep, refundDue: r2(Math.max(0, paid) - keep) };
}
export const isHhmm = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export type AmHousekeeping = 'dirty' | 'clean' | 'inspected';
export interface AmRoom {
  no: string;
  type: 'ROOM' | 'CHALET';
  hk: AmHousekeeping;
  hkBy: string;
  hkAt: IsoDateTime;
  out: { from: IsoDate; until: IsoDate; reason: string; by: string; at: IsoDateTime } | null;
}

/**
 * Researched 5 Nov 2026 from published secondary sources, for Finance to confirm with Customs and the state before use:
 * service tax 8% once a business passes RM500,000 a year; tourism tax RM10 per room per night for foreign guests only
 * (Tourism Tax Act 2017); Pahang's state fee RM3 per room per night. Not charged on the hall or camping pitches here.
 */
export interface AmStayTaxes {
  sstPct: number;
  tourismTaxPerNight: number;
  stateFeePerNight: number;
  stateFeeName: string;
  note: string;
}

/** Room types that are rooms to sleep in: numbered, cleaned, and taxed per room per night. */
export const AM_SLEEP_TYPES = ['ROOM', 'CHALET'] as const;
export const isSleepType = (t: AmStayType): t is 'ROOM' | 'CHALET' => t === 'ROOM' || t === 'CHALET';

export type AmBookingStatus = 'held' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';

export interface AmStayPayment {
  id: Id;
  on: IsoDate;
  amount: number;
  method: 'CASH' | 'TRANSFER' | 'CARD' | 'ONLINE';
  receiptNo: string;
  ref: string;
  by: string;
  at: IsoDateTime;
  /** Finance confirms it in the bank; until then it is recorded, not proven. */
  banked: { on: IsoDate; slipRef: string; by: string } | null;
}

export interface AmBooking {
  id: Id;
  ref: string;
  propertyId: Id;
  guest: string;
  phone: string;
  /** A group company, branch or department booking: billed to it, no deposit needed. */
  internal: boolean;
  billTo: string;
  type: AmStayType;
  qty: number;
  checkIn: IsoDate;
  checkOut: IsoDate;
  /** Price per unit per night agreed, and the price-list price on the day it was booked. */
  rate: number;
  listRate: number;
  discountReason: string;
  status: AmBookingStatus;
  holdUntil: IsoDate;
  payments: AmStayPayment[];
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: { at: IsoDateTime; by: string; what: string }[];
  version: number;
  /** Tax and fee rates on the day it was booked, so a later change to the list does not change this bill. */
  taxRates?: AmStayTaxes | null;
  /** Whether the guest is foreign (pays tourism tax). Known for sure at check-in from the ID shown. */
  foreign?: boolean;
  /** The guest register taken at check-in (Innkeepers Act 1952: an inn keeps a register of guests). Team only. */
  register?: { idType: 'MYKAD' | 'PASSPORT' | 'OTHER'; idNo: string; nationality: string; by: string; at: IsoDateTime } | null;
  /** Room or chalet numbers given at check-in. */
  roomNos?: string[];
  /** Terms agreed when it was booked: times and the cancellation and no-show rules. */
  terms?: AmStayTerms | null;
  /** Set when cancelled or a no-show: what is kept under the terms and what is owed back to the guest. */
  settlement?: { keepPct: number; keep: number; refundDue: number; refunded: number } | null;
  /** Extras on the bill: meals, extra bed, activities, damage. A correction is a minus line with a reason. */
  charges?: { id: Id; on: IsoDate; what: string; amount: number; reason: string; by: string; at: IsoDateTime }[];
}

// ---------- Orchard harvest ----------

export interface AmHarvestSale {
  id: Id;
  buyer: string;
  kg: number;
  pricePerKg: number;
  amount: number;
  /** The weighing slip number from the scale. */
  slipRef: string;
  method: 'CASH' | 'TRANSFER' | 'CREDIT';
  receiptNo: string;
  ref: string;
  by: string;
  at: IsoDateTime;
  banked: { on: IsoDate; slipRef: string; by: string } | null;
}

export interface AmHarvest {
  id: Id;
  propertyId: Id;
  on: IsoDate;
  crop: string;
  pickedKg: number;
  photoRef: string;
  sales: AmHarvestSale[];
  spoiledKg: number;
  /** Kept for the group, given away or used: always with a note. */
  keptKg: number;
  keptNote: string;
  by: string;
  at: IsoDateTime;
  history: { at: IsoDateTime; by: string; what: string }[];
  version: number;
}

// ---------- Planned maintenance ----------

export interface AmPmPlan {
  id: Id;
  unitId: Id | null;
  propertyId: Id | null;
  task: string;
  trade: AmTrade;
  everyMonths: number;
  nextDueOn: IsoDate;
  lastDoneOn: IsoDate | null;
  /** Required by law or a licence (fire equipment, lift, septic tank); only the Asset Director pauses it. */
  statutory: boolean;
  openWorkOrderId: Id | null;
  paused: { by: string; at: IsoDateTime; reason: string } | null;
  by: string;
  at: IsoDateTime;
  history: { at: IsoDateTime; by: string; what: string }[];
  version: number;
}

// ---------- Pure helpers ----------

export const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Same day of month n months later, kept inside short months (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export const nights = (b: Pick<AmBooking, 'checkIn' | 'checkOut'>) => Math.max(0, daysBetween(b.checkIn, b.checkOut));
const r2 = (n: number) => Math.round(n * 100) / 100;
/** The guest's bill: room charge, extras, service tax, tourism tax (foreign guests) and the state fee. */
export function bookingBill(b: Pick<AmBooking, 'checkIn' | 'checkOut' | 'qty' | 'rate' | 'type' | 'taxRates' | 'foreign' | 'charges'>) {
  const n = nights(b);
  const room = r2(b.rate * b.qty * n);
  const extras = r2((b.charges ?? []).reduce((x, c) => x + c.amount, 0));
  const t = b.taxRates;
  const sst = t ? r2(((room + extras) * t.sstPct) / 100) : 0;
  const perRoomNights = isSleepType(b.type) ? b.qty * n : 0;
  const tourism = t && b.foreign ? r2(t.tourismTaxPerNight * perRoomNights) : 0;
  const stateFee = t ? r2(t.stateFeePerNight * perRoomNights) : 0;
  return { room, extras, sst, tourism, stateFee, total: r2(room + extras + sst + tourism + stateFee) };
}
export const bookingTotal = (b: Parameters<typeof bookingBill>[0]) => bookingBill(b).total;
/** Rooms of a type out of order on a night. */
export const roomsOut = (stay: AmStaySetup | null | undefined, type: AmStayType, night: IsoDate) =>
  (stay?.rooms ?? []).filter((r) => r.type === type && r.out && r.out.from <= night && night <= r.out.until).length;
/** Rooms of a type that can be sold on a night. */
export const sellable = (stay: AmStaySetup | null | undefined, type: AmStayType, night: IsoDate) => Math.max(0, (stay?.capacity[type] ?? 0) - roomsOut(stay, type, night));
export const bookingPaid = (b: Pick<AmBooking, 'payments'>) => Math.round(b.payments.reduce((n, p) => n + p.amount, 0) * 100) / 100;
/** Whether a booking still takes its rooms on its nights. An expired hold no longer does. */
export const bookingHolds = (b: AmBooking, today: IsoDate) =>
  b.status === 'confirmed' || b.status === 'checked_in' || (b.status === 'held' && b.holdUntil >= today);

/** Units of one type already taken on each night of [from, to) at one resort, by other bookings. */
export function nightsTaken(bookings: AmBooking[], propertyId: Id, type: AmStayType, from: IsoDate, to: IsoDate, today: IsoDate, except?: Id) {
  const out: { night: IsoDate; taken: number }[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const taken = bookings
      .filter((b) => b.id !== except && b.propertyId === propertyId && b.type === type && bookingHolds(b, today) && b.checkIn <= d && d < b.checkOut)
      .reduce((n, b) => n + b.qty, 0);
    out.push({ night: d, taken });
  }
  return out;
}

/** What is left of a harvest to account for: picked less sold, spoiled and kept. */
export const harvestLeft = (h: Pick<AmHarvest, 'pickedKg' | 'sales' | 'spoiledKg' | 'keptKg'>) =>
  Math.round((h.pickedKg - h.sales.reduce((n, s) => n + s.kg, 0) - h.spoiledKg - h.keptKg) * 100) / 100;

/** Average of the last few usages, for spotting a jump (a leak, a fault, someone tapping the supply). */
export function usageBaseline(readings: AmMeterReading[], n = 3): number | null {
  const xs = readings.filter((r) => r.usage != null).slice(-n).map((r) => r.usage!);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** The planned maintenance plan as it stands today: a finished linked work order moves the due date on. */
export function pmEffective(p: AmPmPlan, orders: { id: Id; status: string; doneOn: IsoDate | null }[]) {
  const wo = p.openWorkOrderId ? orders.find((o) => o.id === p.openWorkOrderId) : undefined;
  if (wo && wo.status === 'done' && wo.doneOn) {
    // Keep the rhythm from the due date; if the job was done late, count from the day it was done.
    const fromDue = addMonths(p.nextDueOn, p.everyMonths);
    const nextDueOn = fromDue > wo.doneOn ? fromDue : addMonths(wo.doneOn, p.everyMonths);
    return { ...p, lastDoneOn: wo.doneOn, nextDueOn, openWorkOrderId: null, rolled: true };
  }
  return { ...p, rolled: false };
}

/** Show only the start and the end of a phone number to people outside the team (personal data). */
export const maskPhone = (s: string) => (s.length > 5 ? `${s.slice(0, 3)}${'•'.repeat(Math.max(0, s.length - 5))}${s.slice(-2)}` : '•••');