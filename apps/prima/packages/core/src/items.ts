// One item register for the whole group (Fauzan, 6 Nov 2026: "Create one system for all type off things in the whole
// organisation"), built from Fitri's implementation paper on uniforms and equipment (v1.0, 6 Nov 2026).
//
// Every physical thing that must be followed gets ONE identity for life: a server-made label token printed as a QR
// (or Code 128). The token never changes when the item is sold, moved, issued, repaired or returned. Four facts stay
// separate: the identity, the SKU (type, size, unit), the legal owner and the holder/location, and the condition.
//
// Scope: uniforms, shoes, vests, torchlights, radios, phones, patrol devices, IT devices (linked to the IT asset
// register, never entered twice), office items, furniture, cleaning stock and tools, for every company. Firearms,
// ammunition and other controlled items are NOT in this register: they stay in the licensed Arms Control vault
// records. No automatic pay deductions, purchases or tax filing. SQL Account is never called: the sync queue only
// shows what would be sent and why it is not ready.

import { sha256Hex } from './audit';
import type { Id, IsoDate, IsoDateTime } from './types';

// ---------- Catalogue (SKU) ----------

export type ItemCategory =
  | 'uniform'
  | 'footwear'
  | 'vest'
  | 'torchlight'
  | 'radio'
  | 'phone'
  | 'patrol_device'
  | 'bodycam'
  | 'it_device'
  | 'office'
  | 'furniture'
  | 'cleaning'
  | 'safety'
  | 'tools'
  | 'other';

export const ITEM_CATEGORIES: ItemCategory[] = [
  'uniform',
  'footwear',
  'vest',
  'torchlight',
  'radio',
  'phone',
  'patrol_device',
  'bodycam',
  'it_device',
  'office',
  'furniture',
  'cleaning',
  'safety',
  'tools',
  'other',
];

/**
 * SERIALIZED: each unit has its own ID (quantity one). BULK: counted by SKU and quantity (consumables, small parts).
 * KIT: a set (uniform set, radio set) that lists its component units; only the components are counted as stock.
 */
export type TrackingMode = 'SERIALIZED' | 'BULK' | 'KIT';
export type BaseUom = 'PCS' | 'PAIR' | 'SET' | 'BOX' | 'BOTTLE' | 'LITRE' | 'ROLL';
export const BASE_UOMS: BaseUom[] = ['PCS', 'PAIR', 'SET', 'BOX', 'BOTTLE', 'LITRE', 'ROLL'];

export interface ItemSqlCode {
  /** The legal entity whose SQL Account book this code belongs to. */
  partyId: Id;
  /** SQL Account ItemCode: text, at most 30 characters, leading zeros kept. */
  itemCode: string;
  uom: BaseUom;
  /** Who in Finance recorded the code. Recording a code is not a working connection. */
  by: string;
  at: IsoDateTime;
}

/**
 * Uniform allowance per guard (Fauzan, 6 Nov 2026): at least 2 pieces a year, at most 3, usually 1 piece every 6 months.
 * Counted over the last 12 months per person. A uniform set handed over together counts as one piece. A piece handed
 * over before 6 months have passed since the last one needs a reason; a fourth piece within 12 months is refused.
 */
export const UNIFORM_RULE = { minPerYear: 2, maxPerYear: 3, paidMaxPerYear: 5, everyMonths: 6, source: 'Fauzan, 6 Nov 2026' } as const;

/**
 * A uniform record that is not a labelled handover (Fauzan, 6 Nov 2026):
 * - past: pieces a guard got before this register, entered by a manager one guard at a time or in bulk for a site,
 *   zone (state) or region, with where the figure comes from.
 * - paid: a 4th or 5th piece in 12 months that the guard paid for, with the receipt. Never taken from pay.
 */
export interface UniformRecord {
  id: Id;
  kind: 'past' | 'paid';
  personId: Id;
  companyId: Id;
  on: IsoDate;
  pieces: number;
  itemId: Id | null;
  receiptRef: string | null;
  amount: number | null;
  batchId: Id | null;
  scope: string | null;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  partyIds: Id[];
}

export type UniformScopeKind = 'site' | 'zone' | 'region' | 'person';

export interface ItemSku {
  id: Id;
  /** Readable code, e.g. SHIRT-NAVY-L. Many units share one SKU. */
  code: string;
  name: string;
  category: ItemCategory;
  /** Set when the SKU is approved; changing it after movements needs a controlled migration, not a screen choice. */
  tracking: TrackingMode;
  uom: BaseUom;
  size: string | null;
  colour: string | null;
  /** Used up (cleaning products): issued, never expected back. BULK only. */
  consumable: boolean;
  /** For a KIT: the component SKUs and how many of each. */
  components: { skuId: Id; qty: number }[];
  /** Supplier product barcodes: they name the type, never a unit. Kept as SKU aliases only. */
  supplierBarcodes: string[];
  sqlCodes: ItemSqlCode[];
  /**
   * After-sale care (Fauzan, 6 Nov 2026): how often a unit of this type should be checked or serviced and how long it
   * is expected to last. Entered by a manager with a reason; never assumed. Empty means "not set", shown as such.
   */
  care?: { everyDays: number | null; lifeMonths: number | null; reason: string; by: string; at: IsoDateTime } | null;
  createdBy: string;
  createdAt: IsoDateTime;
  version: number;
  /** The catalogue is shared by the group; '*' means every signed-in register user may read it. */
  partyIds: Id[];
}

// ---------- Legal entities ----------

/**
 * A legal entity that can own or hold items. Security companies come from the company master; PWVSB, Merdeka Network
 * (IT, owns every IT device) and Goodwill Empire (Government Ops, owns and bills guard equipment) are central. Nothing
 * here is verified until Management and Finance confirm the legal name, registration and SQL book (paper D01).
 */
export interface ItemParty {
  id: Id;
  name: string;
  kind: 'security_company' | 'central';
  /** Not yet in the Prima company master (Goodwill Empire). */
  outsideCompanyMaster: boolean;
  verified: false;
  note: string;
}

export const GOODWILL_PARTY_ID = 'goodwill';
export const CENTRAL_PARTIES: ItemParty[] = [
  {
    id: 'pwvsb',
    name: 'PWVSB (central)',
    kind: 'central',
    outsideCompanyMaster: false,
    verified: false,
    note: 'Central office items, furniture and the head-office store.',
  },
  {
    id: 'merdeka',
    name: 'Merdeka Network Sdn Bhd (IT)',
    kind: 'central',
    outsideCompanyMaster: false,
    verified: false,
    note: 'Owns every IT device and rents them to the group companies (Fauzan, 28 Oct 2026). The IT asset register stays the IT record.',
  },
  {
    id: GOODWILL_PARTY_ID,
    name: 'Goodwill Empire Sdn Bhd',
    kind: 'central',
    outsideCompanyMaster: true,
    verified: false,
    note: 'Owns and sells or rents guard equipment (Fauzan, 2 Nov 2026). Not yet in the company master: legal name, registration number and SQL book to be confirmed (paper D01).',
  },
];

// ---------- Physical items ----------

export type ItemState =
  /** Received but not yet checked: never available for issue. */
  | 'quarantine'
  | 'available'
  /** Picked for a movement that has not left. */
  | 'reserved'
  | 'in_transit'
  | 'with_person'
  | 'at_site'
  | 'repair'
  /** Reported missing; a manager decides (never automatic). */
  | 'missing'
  | 'lost'
  | 'disposed';

export type ItemCondition = 'new' | 'good' | 'worn' | 'damaged' | 'unknown';

export interface Custody {
  kind: 'store' | 'person' | 'site' | 'transit' | 'repairer';
  /** The legal entity whose people, store or site physically hold it. Never the owner by default. */
  partyId: Id;
  /** Store id, person id, site id, movement id or repairer name. */
  ref: Id;
  label: string;
  since: IsoDateTime;
}

export interface PhysicalItem {
  id: Id;
  /** The printed label token: server-made, unique, never reused after disposal. Holds no name, IC, price or owner. */
  token: string;
  skuId: Id;
  /** The maker's serial, when there is one (radios, phones, IT devices). Optional and not the identity. */
  serial: string | null;
  /** The legal owner. Changes only through an ownership event from Finance, never through a scan. */
  ownerPartyId: Id;
  /** The one active custody and authoritative location. */
  custody: Custody;
  state: ItemState;
  condition: ItemCondition;
  version: number;
  labelPrints: number;
  registeredBy: string;
  registeredAt: IsoDateTime;
  /** Opening balance counted without a witnessed receipt (migration): never treated as received by a person. */
  legacyUnverified: boolean;
  replacesId: Id | null;
  replacedById: Id | null;
  /** The IT asset register record, for IT devices. The IT register remains the IT record. */
  itAssetId: Id | null;
  /** For a component: the kit it is part of. For a kit: its components. */
  kitId: Id | null;
  componentIds: Id[];
  /** Issued to a person who has not yet confirmed receipt in their own sign-in. */
  pendingAck: { personId: Id; since: IsoDateTime } | null;
  reservedFor: Id | null;
  /** Rental or loan: when it must go back to the owner. */
  dueBack: { on: IsoDate; movementId: Id } | null;
  /** Lost or disposed with a write-off still for Finance to decide. Never a pay deduction. */
  writeOff: 'finance_to_decide' | null;
  retiredAt: IsoDateTime | null;
  /**
   * Optional RFID tag (EPC), stored upper case without separators. The printed label stays the identity; the tag is
   * a second way to find the same item and is bound, replaced or removed only with a recorded reason.
   */
  rfidTag: string | null;
  /**
   * Parties that follow this item's whole history for life, whoever owns or holds it now. After a sale both the
   * seller and the buyer are here (Fauzan, 6 Nov 2026: ownership passes to the buyer, and both monitor each item's
   * lifecycle). Following is read-only: it never lets a party act on the item.
   */
  historyPartyIds: Id[];
  /** Parties that may see this record (owner, holder, history followers and the other side of an open movement). */
  partyIds: Id[];
}

export interface ItemLot {
  id: Id;
  skuId: Id;
  ownerPartyId: Id;
  custody: Custody;
  qty: number;
  version: number;
  partyIds: Id[];
}

export type ItemEventKind =
  | 'register'
  | 'inspect'
  | 'label_reprint'
  | 'reserve'
  | 'unreserve'
  | 'dispatch'
  | 'receive'
  | 'receive_damaged'
  | 'receive_missing'
  | 'ownership'
  | 'issue'
  | 'confirm'
  | 'dispute'
  | 'return'
  | 'report_missing'
  | 'lost'
  | 'found'
  | 'repair_out'
  | 'repair_back'
  | 'disposed'
  | 'observe'
  | 'count_found'
  | 'kit_assemble'
  | 'replace'
  | 'lot_add'
  | 'lot_issue'
  | 'lot_receive'
  | 'rfid_bind'
  | 'rfid_remove'
  | 'service';

/** Append-only history. A correction is a new event with a reason, never an edit or a delete. */
export interface ItemEvent {
  actorPartyIds?: Id[];
  id: Id;
  at: IsoDateTime;
  by: string;
  byId: Id;
  kind: ItemEventKind;
  itemId: Id | null;
  lotId: Id | null;
  qty: number | null;
  from: Custody | null;
  to: Custody | null;
  ownerFrom: Id | null;
  ownerTo: Id | null;
  movementId: Id | null;
  caseId: Id | null;
  note: string;
  partyIds: Id[];
}

export type SalePaperKind = 'invoice' | 'payment_slip' | 'acknowledgement';
export const SALE_PAPER_LABEL: Record<SalePaperKind, string> = {
  invoice: 'Invoice (seller)',
  payment_slip: 'Payment slip (buyer)',
  acknowledgement: 'Letter of acknowledgement of items received (buyer)',
};

export interface SalePaper {
  kind: SalePaperKind;
  /** Invoice number, bank or payment reference, or the letter's reference. As written on the paper; never invented. */
  ref: string;
  /** The date on the paper. */
  date: IsoDate;
  /** The scanned or photographed paper (item_docs); for the acknowledgement, the signed copy when one is attached. */
  docId: Id | null;
  /** Acknowledgement only: what the letter states, made from the receipt at the time of signing. */
  letter?: { received: number; damaged: number; missing: number; wrongItem: number; lots: { skuId: Id; qty: number }[]; text: string } | null;
  partyId: Id;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

/** A scanned paper of the item register (invoice, payment slip, signed letter). Stored once by its fingerprint. */
export interface ItemDoc {
  id: Id;
  movementId: Id;
  kind: SalePaperKind;
  name: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  bytes: number;
  sha256: string;
  data: string;
  uploadedBy: string;
  at: IsoDateTime;
  partyIds: Id[];
}

export type MovementType = 'sale' | 'rental' | 'loan' | 'transfer' | 'supplier_return';

export type LineResult = 'pending' | 'received' | 'damaged' | 'missing' | 'wrong_item';

export interface ItemMovement {
  id: Id;
  ref: string;
  type: MovementType;
  fromPartyId: Id;
  toPartyId: Id;
  /** Where it goes: the receiving party's store, or one of its sites. */
  to: { kind: 'store' | 'site'; ref: Id; label: string };
  /** One reference shared by the seller's and the buyer's documents (sale, rental, loan, supplier return). */
  commercialRef: string | null;
  /** A supplier return points at the sale it reverses. */
  originalMovementId: Id | null;
  purpose: string;
  dueBackOn: IsoDate | null;
  status: 'draft' | 'dispatched' | 'partly_received' | 'received' | 'cancelled';
  lines: { itemId: Id; result: LineResult; by: string | null; at: IsoDateTime | null; note: string }[];
  lotLines: { lotId: Id; skuId: Id; qtySent: number; qtyReceived: number | null; receivedLotId?: Id }[];
  createdBy: string;
  createdById: Id;
  createdAt: IsoDateTime;
  dispatched: { by: string; byId: Id; at: IsoDateTime; carrier: string } | null;
  receipts: { by: string; byId: Id; at: IsoDateTime; lines: number }[];
  /** Sale only: the date legal ownership passes, recorded by Finance under the sale terms; separate from receipt. */
  ownership: { by: string; byId: Id; at: IsoDateTime; effectiveOn: IsoDate; basis: string; itemIds: Id[] } | null;
  /**
   * Sale papers (Fauzan, 6 Nov 2026): ownership passes only with the receipt, the seller's invoice, the buyer's payment
   * slip and the buyer's signed letter of acknowledgement of the items received. A later paper of the same kind
   * replaces the earlier one only with a reason; every paper stays in the list.
   */
  papers?: SalePaper[];
  version: number;
  partyIds: Id[];
}

export type ItemCaseKind =
  | 'short'
  | 'damaged'
  | 'wrong_item'
  | 'wrong_place'
  | 'dispute'
  | 'missing'
  | 'count_not_found'
  | 'count_extra'
  | 'label_mismatch'
  | 'dispose'
  | 'service';

export interface ItemCase {
  actorPartyIds?: Id[];
  id: Id;
  ref: string;
  kind: ItemCaseKind;
  itemId: Id | null;
  lotId: Id | null;
  movementId: Id | null;
  /** The party whose manager must act. */
  partyId: Id;
  note: string;
  openedBy: string;
  openedById: Id;
  at: IsoDateTime;
  status: 'open' | 'resolved';
  resolution: { actorPartyIds?: Id[]; by: string; byId: Id; at: IsoDateTime; outcome: string; note: string } | null;
  partyIds: Id[];
}

export interface ItemCount {
  id: Id;
  partyId: Id;
  where: { kind: 'store' | 'site'; ref: Id; label: string };
  cutoffAt: IsoDateTime;
  /** Snapshot at the cut-off. */
  expected: Id[];
  found: Id[];
  /** Scanned but not expected here. */
  extra: Id[];
  startedBy: string;
  startedById: Id;
  closed: { by: string; byId: Id; at: IsoDateTime; notFound: Id[]; movedAfterCutoff: Id[] } | null;
  partyIds: Id[];
}

export type SyncStatus =
  | 'not_ready'
  | 'ready'
  | 'queued'
  | 'sent'
  | 'acknowledged'
  | 'reconciled'
  | 'rejected'
  | 'retryable_error'
  | 'outcome_unknown'
  | 'manual_review';

/**
 * What would go to one SQL Account book. Built in the same transaction as the physical change (outbox). Nothing is
 * ever sent from this module: there is no SQL Account connection, so every job stays not_ready with its reason.
 */
export interface ItemSyncJob {
  id: Id;
  partyId: Id;
  docType: 'sales_delivery' | 'purchase_receipt' | 'supplier_return_out' | 'supplier_return_in' | 'rental_out' | 'rental_in';
  sourceId: Id;
  revision: number;
  /** party + book + document type + source + revision. */
  key: string;
  payloadHash: string;
  payload: { commercialRef: string | null; lines: { skuId: Id; itemCode: string | null; uom: BaseUom; qty: number }[] };
  status: SyncStatus;
  reasons: string[];
  at: IsoDateTime;
  partyIds: Id[];
}

// ---------- How each company tags its items ----------

/**
 * Each company chooses how its items are tagged (Fauzan, 6 Nov 2026): a printed barcode (Code 128), a printed QR
 * code, or an RFID tag. Every scan box accepts all three whatever the choice, so items from another company, a
 * sale or an older label still scan. The printed ID is always kept: with RFID it is the backup when a reader fails.
 */
export type TagMethod = 'barcode' | 'qr' | 'rfid';
export const TAG_METHODS: TagMethod[] = ['barcode', 'qr', 'rfid'];
export const TAG_METHOD_LABEL: Record<TagMethod, string> = {
  barcode: 'Printed barcode',
  qr: 'Printed QR code',
  rfid: 'RFID tag (printed ID kept as backup)',
};

export interface ItemSettings {
  /** The party id. One row per company. */
  id: Id;
  partyId: Id;
  tagMethod: TagMethod;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  version: number;
  partyIds: Id[];
}

/** One processed write per user and request id, so a double tap or a retry never repeats the change. */
export interface ItemRequest {
  id: Id;
  userId: Id;
  hash: string;
  at: IsoDateTime;
  result: unknown;
  partyIds: Id[];
}

// ---------- Labels ----------

/** Crockford base 32: no I, L, O or U, so a typed ID is hard to get wrong. */
export const LABEL_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LABEL_PREFIX = 'P1-';

function checkChar(body: string): string {
  let sum = 0;
  for (let k = 0; k < body.length; k++) sum += LABEL_ALPHABET.indexOf(body[k]) * (k + 1);
  return LABEL_ALPHABET[sum % 32];
}

/** Make a new label token from 15 random values (0-31). Format version 1: P1- + 15 characters + 1 check character. */
export function labelFromRandom(values: ArrayLike<number>): string {
  if (values.length < 15) throw new Error('Need 15 random values for a label.');
  let body = '';
  for (let k = 0; k < 15; k++) body += LABEL_ALPHABET[values[k] & 31];
  return `${LABEL_PREFIX}${body}${checkChar(body)}`;
}

/** A fresh token from the platform's secure random source (server and browser test version). */
export function newLabelToken(): string {
  const v = new Uint8Array(15);
  globalThis.crypto.getRandomValues(v);
  return labelFromRandom(v);
}

/** Deterministic token for synthetic sample data only. */
export function sampleLabelToken(seed: string): string {
  const hex = sha256Hex(`prima-sample-label:${seed}`);
  const values: number[] = [];
  for (let k = 0; k < 15; k++) values.push(parseInt(hex.slice(k * 2, k * 2 + 2), 16));
  return labelFromRandom(values);
}

export type LabelParse =
  | { ok: true; token: string }
  | { ok: false; reason: 'empty' | 'too_long' | 'link' | 'unknown_format' | 'bad_check' };

/**
 * Read a scanned or typed label. A scan only finds a record; it never grants access. Links, other payloads and
 * anything longer than a label are refused without being opened.
 */
export function parseLabel(raw: unknown): LabelParse {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length > 40) return { ok: false, reason: 'too_long' };
  if (/:\/\/|^www\.|^[a-z]+:/i.test(s) && !/^P1[-:]?/i.test(s)) return { ok: false, reason: 'link' };
  const compact = s.toUpperCase().replace(/[\s-]/g, '');
  const m = /^P1([0-9A-HJKMNP-TV-Z]{16})$/.exec(compact);
  if (!m) return { ok: false, reason: 'unknown_format' };
  const body = m[1].slice(0, 15);
  if (checkChar(body) !== m[1][15]) return { ok: false, reason: 'bad_check' };
  return { ok: true, token: `${LABEL_PREFIX}${m[1]}` };
}

export const LABEL_REFUSAL: Record<Exclude<LabelParse, { ok: true }>['reason'], string> = {
  empty: 'Scan or type the label ID.',
  too_long: 'That is not a Prima item label.',
  link: 'That code is a link, not a Prima item label. It was not opened.',
  unknown_format: 'That is not a Prima item label or RFID tag. Type the ID printed under the code (it starts with P1-).',
  bad_check: 'The ID does not check out: one character is wrong. Scan again or type it carefully.',
};

// ---------- RFID (optional) ----------

/**
 * Read an RFID tag code (EPC) from a handheld or gate reader, typed or pasted. Upper case hexadecimal, 16 to 64
 * characters in steps of 4 (a 64- to 256-bit EPC), separators removed. Shorter codes such as product barcodes are
 * refused so a supplier barcode is never mistaken for a tag. A read only finds a record; it never grants access.
 */
export function parseRfid(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 80) return null;
  const c = s.toUpperCase().replace(/[\s:-]+/g, '');
  if (!/^[0-9A-F]+$/.test(c) || c.length < 16 || c.length > 64 || c.length % 4 !== 0) return null;
  return c;
}

export type ScanParse = { ok: true; by: 'label'; token: string } | { ok: true; by: 'rfid'; tag: string } | { ok: false; reason: Exclude<LabelParse, { ok: true }>['reason'] };

/** One scan box for both: a printed label (P1-...) or an RFID tag read. */
export function parseScan(raw: unknown): ScanParse {
  const p = parseLabel(raw);
  if (p.ok) return { ok: true, by: 'label', token: p.token };
  if (p.reason === 'unknown_format' || p.reason === 'too_long') {
    const tag = parseRfid(raw);
    if (tag) return { ok: true, by: 'rfid', tag };
  }
  return p;
}

/** Readable form printed under the code: P1-XXXX-XXXX-XXXX-XXXX. */
export function labelDisplay(token: string): string {
  const b = token.slice(LABEL_PREFIX.length);
  return `${LABEL_PREFIX}${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}`;
}

// ---------- Rules ----------

/** Words that mean an arms-controlled item: these stay in the Arms Control vault records, never here. */
const CONTROLLED = /\b(fire ?arms?|senjata( api)?|pistol|revolver|shotgun|senapang|rifle|raifal|peluru|ammunition|ammo|bullets?|cartridges?|magazines?|holster)\b/i;
export function isControlledItem(text: string): boolean {
  return CONTROLLED.test(text);
}

/** SQL Account ItemCode: text, 1 to 30 characters, no spaces at the ends (leading zeros kept as text). */
export function validItemCode(code: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,29}$/.test(code);
}

/** States from which nothing may be issued, sent or handed over. */
export const NOT_MOVABLE: ItemState[] = ['quarantine', 'reserved', 'in_transit', 'repair', 'missing', 'lost', 'disposed'];

export const STATE_LABEL: Record<ItemState, string> = {
  quarantine: 'To check (quarantine)',
  available: 'In store, available',
  reserved: 'Picked for sending',
  in_transit: 'In transit',
  with_person: 'With a person',
  at_site: 'At a site',
  repair: 'At repair',
  missing: 'Reported missing',
  lost: 'Lost (confirmed)',
  disposed: 'Disposed',
};

/** Idempotency key for one SQL Account document: party + book + type + source + revision (paper section 7). */
export function syncKey(partyId: Id, docType: ItemSyncJob['docType'], sourceId: Id, revision: number): string {
  return `${partyId}|sql-book-unconfirmed|${docType}|${sourceId}|r${revision}`;
}

export function payloadHash(payload: ItemSyncJob['payload']): string {
  return sha256Hex(JSON.stringify(payload));
}

/** Stable short reference from a running number, e.g. MV-0007. */
export function runningRef(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}
