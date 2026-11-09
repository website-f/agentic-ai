// One item register for the whole group: server rules (Fauzan, 6 Nov 2026; Fitri's paper v1.0 sections 2-10).
// Every write is checked here, whatever the screen shows: who the user is, which legal entity they act for, the item's
// state and version, and the request id (a double tap or retry never repeats a change). A scan only finds a record.

import { AccessDenied, activeGrants, isActHead, isGroupLeader } from './access';
import { sha256Hex } from './audit';
import { BadRequest, NotFound, RefusedAfterSave, ReviewConflict } from './service';
import { MISS_WINDOW_MS, MOVING_PURPOSES, SCAN_PURPOSES, genVerdict, manualProblem, readEntry, scanHash, tooManyManual, type ScanPurpose, type ScanVerdict } from './item-scan';
import { SYNC_STATUS_LABEL, buildExport, canMove, counterpartyOf, parseSnapshot, reconcileBook, syncBlockers } from './item-finance';
import { ITEM_REPORT_KINDS, buildReport, reportCsv, type ItemReportKind } from './item-reports';
import type { Store } from './store';
import { evaluateFace } from './checks';
import { REGIONS, regionOfState } from './regions';
import { dateOf } from './time';
import { addMonthsIso } from './work';
import type { AuthorityGrant, Company, FaceCapture, Id, IsoDate, IsoDateTime, Person, Site, User } from './types';
import {
  BASE_UOMS,
  BOOK_UNSET,
  DEFAULT_ITEM_CONFIG,
  LABEL_TEMPLATES,
  SYNC_BLOCKER_LABEL,
  labelGenOf,
  labelPayload,
  senFromText,
  senLabel,
  type ItemConfig,
  type ItemLabelPrint,
  type ItemSqlBook,
  type ItemSqlSnapshot,
  type ItemSyncBatch,
  type LabelSymbol,
  type LabelTemplateId,
  type ScanEntry,
  type ScanSource,
  type SyncStatus,
  type SyncBlocker,
  STATE_LABEL,
  CENTRAL_PARTIES,
  GOODWILL_PARTY_ID,
  ITEM_CATEGORIES,
  LABEL_REFUSAL,
  NOT_MOVABLE,
  isControlledItem,
  labelDisplay,
  newLabelToken,
  parseLabel,
  parseRfid,
  parseScan,
  TAG_METHODS,
  UNIFORM_RULE,
  type UniformRecord,
  type UniformScopeKind,
  TAG_METHOD_LABEL,
  type ItemSettings,
  type ItemDoc,
  type SalePaper,
  type SalePaperKind,
  SALE_PAPER_LABEL,
  type TagMethod,
  payloadHash,
  runningRef,
  syncKey,
  validItemCode,
  type BaseUom,
  type Custody,
  type ItemCase,
  type ItemCaseKind,
  type ItemCategory,
  type ItemCondition,
  type ItemCount,
  type ItemEvent,
  type ItemEventKind,
  type ItemLot,
  type ItemMovement,
  type ItemParty,
  type ItemSku,
  type ItemSyncJob,
  type LineResult,
  type MovementType,
  type PhysicalItem,
  type TrackingMode,
} from './items';

/** What a user may do for one legal entity. */
export type ItemRole = 'store' | 'manager' | 'ops' | 'finance' | 'it' | 'view' | 'hr';

/** A scan, or the older bare label (treated as chosen from a list on screen). */
type Scanned = { label?: string; scan?: ScanEntry };

/** Refusal with a plain message (HTTP 403). */
export class ItemDenied extends AccessDenied {
  constructor(message: string) {
    super('view', '(items)');
    this.message = message;
  }
}

export type ItemAction =
  | { kind: 'sku.add'; code: string; name: string; category: ItemCategory; tracking: TrackingMode; uom: BaseUom; size?: string; colour?: string; consumable?: boolean; components?: { skuId: Id; qty: number }[]; supplierBarcodes?: string[] }
  | { kind: 'sku.map'; skuId: Id; partyId: Id; itemCode: string; uom: BaseUom; factor?: number }
  | { kind: 'sku.mapApprove'; skuId: Id; partyId: Id }
  | { kind: 'item.register'; skuId: Id; partyId: Id; count: number; serials?: string[]; itAssetId?: Id; legacyUnverified?: boolean; note?: string; legacyRef?: string; legacyFrom?: { where?: string; condition?: string; holder?: string } }
  | { kind: 'item.inspect'; label: string; condition: Exclude<ItemCondition, 'unknown'>; note: string; expectedVersion?: number }
  | { kind: 'item.reprint'; label: string; reason: string; identity?: { serialSeen?: string; skuSizeConfirmed?: boolean }; template?: LabelTemplateId }
  | { kind: 'label.print'; itemIds: Id[]; template?: LabelTemplateId; symbols?: LabelSymbol[]; reason?: string; identity?: { serialSeen?: string; skuSizeConfirmed?: boolean } }
  | { kind: 'label.verify'; printId: Id; scan: ScanEntry }
  | { kind: 'item.replace'; label: string; note: string }
  | { kind: 'kit.assemble'; skuId: Id; partyId: Id; labels: string[] }
  | { kind: 'lot.add'; skuId: Id; partyId: Id; qty: number; note: string }
  | { kind: 'lot.issue'; lotId: Id; qty: number; personId?: Id; siteId?: Id; note?: string }
  | { kind: 'move.create'; type: MovementType; fromPartyId: Id; toPartyId: Id; toSiteId?: Id; purpose: string; dueBackOn?: IsoDate; originalMovementId?: Id; expected?: { skuId: Id; qty: number }[] }
  | ({ kind: 'move.add'; movementId: Id; overrideReason?: string } & Scanned)
  | { kind: 'move.cancel'; movementId: Id; reason: string }
  | { kind: 'move.addLot'; movementId: Id; lotId: Id; qty: number }
  | { kind: 'move.remove'; movementId: Id; itemId: Id }
  | { kind: 'move.dispatch'; movementId: Id; carrier: string; expectedVersion?: number }
  | {
      kind: 'move.receive';
      movementId: Id;
      lines: { itemId: Id; result: Exclude<LineResult, 'pending'>; note?: string; scan?: ScanEntry; baseVersion?: number }[];
      lotLines?: { lotId: Id; qty: number }[];
      /** Scanned units that are not on this delivery: each opens a case and stays where it is recorded. */
      unexpected?: ScanEntry[];
    }
  | { kind: 'move.ownership'; movementId: Id; effectiveOn: IsoDate; basis: string }
  | ({ kind: 'issue'; personId?: Id; siteId?: Id; expectedVersion?: number; reason?: string; paidByGuard?: { receiptRef: string; amount?: number | string; amountSen?: string } } & Scanned)
  | { kind: 'uniform.past'; companyId: Id; scope: { kind: UniformScopeKind; id: string }; on: IsoDate; pieces: number; reason: string }
  | ({ kind: 'confirm' } & Scanned)
  | { kind: 'dispute'; label: string; note: string }
  | ({ kind: 'return'; condition: 'good' | 'worn' | 'damaged'; note: string } & Scanned)
  | { kind: 'report.missing'; label: string; note: string }
  | { kind: 'repair.out'; label: string; repairer: string; note: string }
  | { kind: 'repair.back'; label: string; note: string }
  | { kind: 'dispose.ask'; label: string; reason: string }
  | ({ kind: 'observe'; siteId: Id; serialSeen?: string; note?: string } & Scanned)
  | { kind: 'case.resolve'; caseId: Id; outcome: string; note: string; scan?: ScanEntry }
  | { kind: 'count.start'; partyId: Id; siteId?: Id; skuIds?: Id[]; cutoffAt?: IsoDateTime; freeze?: boolean; blind?: boolean }
  | ({ kind: 'count.scan'; countId: Id } & Scanned)
  | { kind: 'count.scanBatch'; countId: Id; scans: ScanEntry[] }
  | { kind: 'count.close'; countId: Id }
  | { kind: 'count.recount'; countId: Id }
  | { kind: 'count.review'; countId: Id; note: string }
  | { kind: 'count.scanMany'; countId: Id; reads: string[] }
  | { kind: 'move.receiveScan'; reads?: string[]; scans?: ScanEntry[]; movementId?: Id }
  | { kind: 'device.confirm'; staffNo: string; face: FaceCapture | null; label: string }
  | { kind: 'sku.care'; skuId: Id; everyDays: number | null; lifeMonths: number | null; reason: string }
  | { kind: 'item.service'; label: string; condition: 'good' | 'worn' | 'damaged'; note: string }
  | { kind: 'service.request'; label: string; note: string }
  | { kind: 'move.paper'; movementId: Id; paper: 'invoice' | 'payment_slip'; ref: string; date: IsoDate; doc: { name: string; data: string }; reason?: string }
  | { kind: 'move.acknowledge'; movementId: Id; ref: string; date: IsoDate; signedBy: string; doc?: { name: string; data: string } | null; reason?: string }
  | { kind: 'item.rfid'; label: string; tag: string; reason?: string }
  | { kind: 'settings.tagMethod'; partyId: Id; tagMethod: TagMethod; reason: string }
  | { kind: 'settings.config'; partyId: Id; config: Partial<ItemConfig>; reason: string }
  | { kind: 'laundry.out'; label: string; launderer: string; note?: string }
  | { kind: 'laundry.back'; label: string; note?: string }
  | { kind: 'item.swap'; returnLabel: string; issueLabel: string; personId: Id; condition: 'good' | 'worn' | 'damaged'; note: string }
  | { kind: 'book.set'; partyId: Id; legalName: string; regNo: string; sqlBookId: string; counterparties?: { partyId: Id; role: 'customer' | 'supplier'; sqlCode: string }[]; periodLockedThrough?: IsoDate | null }
  | { kind: 'book.verify'; partyId: Id; evidence: { name: string; data: string } }
  | { kind: 'sync.refresh'; partyId: Id }
  | { kind: 'sync.batch'; partyId: Id; jobIds: Id[] }
  | { kind: 'sync.sent'; batchId: Id }
  | { kind: 'sync.ack'; jobId: Id; docNo: string; totals?: { net: string; tax: string; gross: string } | null; evidence: { name: string; data: string } }
  | { kind: 'sync.reject'; jobId: Id; reason: string }
  | { kind: 'sync.unknown'; jobId: Id; note: string }
  | { kind: 'sync.lookup'; jobId: Id; docNo: string | null; note: string; evidence: { name: string; data: string } }
  | { kind: 'sync.review'; jobId: Id; decision: 'hold' | 'requeue' | 'new_revision' | 'reverse'; reason: string }
  | { kind: 'sync.snapshot'; partyId: Id; snapshot: 'stock_balance' | 'doc_listing'; asOf: IsoDate; csv: string }
  | { kind: 'sync.reconcile'; partyId: Id };

/** Outcomes a case may close with, and whether a manager (never the person who opened it) must decide. */
const CASE_OUTCOMES: Record<ItemCaseKind, { outcomes: string[]; manager: string[] }> = {
  short: { outcomes: ['arrived', 'lost'], manager: ['lost'] },
  damaged: { outcomes: ['usable', 'repair', 'dispose'], manager: ['dispose'] },
  wrong_item: { outcomes: ['sent_back', 'kept_with_approval'], manager: ['kept_with_approval'] },
  wrong_place: { outcomes: ['checked'], manager: [] },
  dispute: { outcomes: ['person_has_it', 'back_in_store', 'missing'], manager: [] },
  missing: { outcomes: ['found', 'confirmed_lost'], manager: ['confirmed_lost'] },
  count_not_found: { outcomes: ['found', 'report_missing'], manager: [] },
  count_extra: { outcomes: ['checked'], manager: [] },
  label_mismatch: { outcomes: ['identity_confirmed', 'label_withdrawn'], manager: [] },
  dispose: { outcomes: ['approved', 'rejected'], manager: ['approved', 'rejected'] },
  service: { outcomes: ['serviced', 'repair', 'replace_advised', 'no_fault_found'], manager: [] },
  unexpected_item: { outcomes: ['returned_to_sender', 'kept_with_approval', 'checked'], manager: ['kept_with_approval'] },
  label_superseded: { outcomes: ['identity_confirmed', 'label_withdrawn'], manager: [] },
  label_unreadable: { outcomes: ['reprinted', 'checked'], manager: [] },
  count_unknown_label: { outcomes: ['checked', 'returned_to_owner'], manager: [] },
  seen_elsewhere: { outcomes: ['checked'], manager: [] },
  recon_diff: { outcomes: ['explained', 'corrected_in_sql', 'escalated'], manager: [] },
  sync_review: { outcomes: ['resolved'], manager: [] },
};

/** Cases that only Finance of the company closes. */
const FINANCE_CASES: ItemCaseKind[] = ['recon_diff', 'sync_review'];
/** Closing these as found or arrived needs the label scanned, never typed (paper section 10). */
const SHORTAGE_CLOSE: Partial<Record<ItemCaseKind, string>> = { short: 'arrived', missing: 'found', count_not_found: 'found' };

/** Events that count as a check of the unit's health for after-sale care. */
const CARE_CHECKS: ItemEventKind[] = ['inspect', 'service', 'return', 'repair_back', 'observe', 'count_found', 'receive'];
const DUE_SOON_DAYS = 14;

/** Largest scanned paper accepted (invoice, payment slip, signed letter). */
const PAPER_MAX_BYTES = 2_000_000;
/** A scan request names at most this many units at once. */
const SCAN_BATCH_MAX = 500;

/** First bytes of each accepted file type (paper section 9: allowed types checked, not only the declared one). */
const MAGIC: Record<string, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
};
function magicOk(mime: string, dataUrl: string): boolean {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 16);
  let head: number[];
  try {
    head = Array.from(atob(b64.slice(0, Math.floor(b64.length / 4) * 4)), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  return (MAGIC[mime] ?? []).some((m) => m.every((x, k) => head[k] === x));
}

/** Where the read-only scope of an Operations user reaches: their sites, the people working there and their movements. */
type Scope = { sites: Set<Id>; people: Set<Id>; moves: Set<Id> };
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const uniq = <T>(xs: T[]) => [...new Set(xs)];

type Ctx = {
  user: User;
  requestId: string;
  roles: Map<Id, ItemRole[]>;
  parties: ItemParty[];
  at: IsoDateTime;
  /** Sites an Operations Manager or Regional OM covers (their states or regions, every company); empty for others. */
  opsSites: Set<Id>;
  /**
   * Companies where the user only has the Operations role: they read only what is at, going to, or held by people
   * working at their sites (paper section 9: OM and patrol stay in their area, a scan gives no company-wide access).
   */
  readScope: Map<Id, Set<Id>>;
  settings: Map<Id, ItemSettings>;
  scope?: Promise<Scope>;
};

export class ItemService {
  /** In-process queue for stores without a database lock (memory store): writes run one after another. */
  private static queues = new WeakMap<Store, Promise<unknown>>();

  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private grants: () => Promise<AuthorityGrant[]>,
    /** Server: secure random. The browser test version passes a seeded maker so its replay gives the same labels. */
    private newToken: (seed: string) => string = () => newLabelToken(),
  ) {}

  // ---------- Who may do what ----------

  /** The legal entities this user acts for, with their roles. Group data only for group leaders and the ACT head. */
  async rolesFor(user: User): Promise<Map<Id, ItemRole[]>> {
    const out = new Map<Id, ItemRole[]>();
    const add = (id: Id, r: ItemRole) => out.set(id, uniq([...(out.get(id) ?? []), r]));
    if (user.integration || user.role === 'site_device' || user.role === 'guard') return out;
    const companies = await this.store.list('companies');
    const all = [...companies.map((c) => c.id), ...CENTRAL_PARTIES.map((p) => p.id)];
    if (isGroupLeader(user) || isActHead(user)) for (const id of all) add(id, 'view');
    // Audit reads the trail (paper section 9); it never acts on an item.
    if (user.role === 'pwvsb_officer' && user.department === 'audit') for (const id of all) add(id, 'view');
    // HR follows the uniform allowance of guards in the security companies; read only.
    if (user.role === 'pwvsb_officer' && user.department === 'hr') for (const c of companies) add(c.id, 'hr');
    const today = dateOf(this.clock());
    const grants = user.role === 'pwvsb_officer' ? activeGrants(user, await this.grants(), today) : [];
    const granted = grants.map((g) => g.companyId);
    // A monitor grant lets central staff see a company's items; only an act grant lets them handle them.
    const actGranted = grants.filter((g) => g.scope === 'act').map((g) => g.companyId);
    if (user.role === 'company_manager') for (const id of user.companyIds) add(id, 'manager');
    if (user.role === 'admin_exec') for (const id of user.companyIds) add(id, 'store');
    if (user.role === 'supervisor') for (const id of user.companyIds) add(id, 'ops');
    // Operations Managers and Regional OMs receive and hand over items at the sites in their area, in every company
    // with sites there (Fauzan, 6 Nov 2026: the OM scans the label to declare it received).
    for (const s of await this.areaSites(user)) add(s.companyId, 'ops');
    if (user.role === 'pwvsb_officer') {
      // Arms Control and CMS do not work this register: firearms stay in the vault records.
      if (user.department === 'procurement') {
        // Procurement and Inventory under the OGM runs the Goodwill and head-office stores (assumption, to confirm).
        const r: ItemRole = user.procRole === 'storekeeper' ? 'store' : 'manager';
        add(GOODWILL_PARTY_ID, r);
        add('pwvsb', r);
        for (const id of granted) add(id, 'view');
        for (const id of actGranted) add(id, 'store');
      }
      if (user.opsTier === 'ogm' || user.opsTier === 'ops_director') {
        add(GOODWILL_PARTY_ID, 'manager');
        for (const id of granted) add(id, 'view');
      }
      if (user.department === 'finance' || user.leadership === 'finance_director') {
        for (const id of [GOODWILL_PARTY_ID, 'pwvsb', 'merdeka', ...granted]) add(id, 'finance');
        if (user.leadership === 'finance_director') for (const id of all) add(id, 'finance');
      }
      if (user.department === 'it') add('merdeka', user.itRole === 'manager' ? 'manager' : 'it');
    }
    return out;
  }

  /**
   * P91: whether the user may add this kind of record by hand: item types (as sku.add), units (as item.register) or bulk
   * stock (as lot.add) for one company. The screen shows Add and Import only then; each saved row is checked again.
   */
  async mayAdd(user: User, what: 'type' | 'unit' | 'stock', partyId: Id | null): Promise<boolean> {
    const roles = await this.rolesFor(user);
    const has = (p: Id, ...rs: ItemRole[]) => (roles.get(p) ?? []).some((r) => rs.includes(r));
    if (what === 'type') return [...roles.keys()].some((p) => has(p, 'store', 'manager')) || has('merdeka', 'it', 'manager');
    return !!partyId && has(partyId, 'store', 'manager', 'it');
  }

  private has(ctx: Ctx, partyId: Id, ...roles: ItemRole[]) {
    return (ctx.roles.get(partyId) ?? []).some((r) => roles.includes(r));
  }

  private async parties(): Promise<ItemParty[]> {
    const companies: Company[] = await this.store.list('companies');
    return [
      ...CENTRAL_PARTIES,
      ...companies.map<ItemParty>((c) => ({
        id: c.id,
        name: c.name,
        kind: 'security_company',
        outsideCompanyMaster: false,
        verified: false,
        note:
          c.id === 'co-sasa'
            ? 'Fitri’s paper names the buyer "Sasa Security"; the Government/Private Ops note names the private company "Sasa Team Sdn Bhd". Confirm the legal entity and SQL book before real use (paper D01).'
            : 'Legal entity and SQL book to be confirmed by Finance before posting.',
      })),
    ];
  }

  private async ctx(user: User, requestId = ''): Promise<Ctx> {
    const roles = await this.rolesFor(user);
    const opsSites = new Set((await this.areaSites(user)).map((s) => s.id));
    const readScope = new Map<Id, Set<Id>>();
    for (const [p, rs] of roles) if (rs.length && rs.every((r) => r === 'ops')) readScope.set(p, opsSites.size ? opsSites : new Set(user.siteIds));
    const settings = new Map((await this.store.list('itemSettings')).map((x) => [x.partyId, x] as const));
    return { user, requestId, roles, parties: await this.parties(), at: this.clock(), opsSites, readScope, settings };
  }

  /** A company's settings with the safe defaults for anything not set (open decisions D04, D07, D09, D10). */
  private cfg(ctx: Ctx, partyId: Id): ItemConfig {
    return { ...DEFAULT_ITEM_CONFIG, ...(ctx.settings.get(partyId)?.config ?? {}) };
  }

  /** The read scope of an Operations-only user, worked out once per request. */
  private scopeOf(ctx: Ctx): Promise<Scope> {
    return (ctx.scope ??= (async () => {
      const sites = new Set<Id>();
      for (const set of ctx.readScope.values()) for (const x of set) sites.add(x);
      if (!sites.size) return { sites, people: new Set<Id>(), moves: new Set<Id>() };
      const [shifts, moves] = await Promise.all([this.store.list('shifts'), this.store.list('itemMovements')]);
      const latest = new Map<Id, { siteId: Id; date: IsoDate }>();
      for (const x of shifts) if (x.personId && (latest.get(x.personId)?.date ?? '') < x.date) latest.set(x.personId, { siteId: x.siteId, date: x.date });
      const people = new Set([...latest].filter(([, v]) => sites.has(v.siteId)).map(([k]) => k));
      const mv = new Set(moves.filter((m) => (m.to.kind === 'site' && sites.has(m.to.ref)) || m.createdById === ctx.user.id).map((m) => m.id));
      return { sites, people, moves: mv };
    })());
  }

  private scoped(ctx: Ctx, partyIds: Id[]) {
    return partyIds.some((p) => ctx.readScope.has(p));
  }

  /** Whether the user may see one unit: its company's wall, or (Operations) their own sites and people. */
  private seesItemIn(ctx: Ctx, sc: Scope, i: PhysicalItem): boolean {
    if (this.visibleTo(ctx, i.partyIds)) return true;
    if (ctx.user.personId && i.custody.kind === 'person' && i.custody.ref === ctx.user.personId) return true;
    if (!this.scoped(ctx, i.partyIds)) return false;
    const c = i.custody;
    return (c.kind === 'site' && sc.sites.has(c.ref)) || (c.kind === 'transit' && sc.moves.has(c.ref)) || (c.kind === 'person' && sc.people.has(c.ref)) || (!!i.reservedFor && sc.moves.has(i.reservedFor));
  }

  private async seesItem(ctx: Ctx, i: PhysicalItem): Promise<boolean> {
    if (this.visibleTo(ctx, i.partyIds)) return true;
    if (ctx.user.personId && i.custody.kind === 'person' && i.custody.ref === ctx.user.personId) return true;
    if (!this.scoped(ctx, i.partyIds)) return false;
    return this.seesItemIn(ctx, await this.scopeOf(ctx), i);
  }

  private seesMoveIn(ctx: Ctx, sc: Scope, m: ItemMovement) {
    return this.visibleTo(ctx, m.partyIds) || (this.scoped(ctx, m.partyIds) && sc.moves.has(m.id));
  }

  private async seesMove(ctx: Ctx, m: ItemMovement | undefined): Promise<boolean> {
    if (!m) return false;
    if (this.visibleTo(ctx, m.partyIds)) return true;
    return this.scoped(ctx, m.partyIds) && (await this.scopeOf(ctx)).moves.has(m.id);
  }

  private seesCountIn(ctx: Ctx, sc: Scope, c: ItemCount) {
    return this.visibleTo(ctx, c.partyIds) || (this.scoped(ctx, c.partyIds) && c.where.kind === 'site' && sc.sites.has(c.where.ref));
  }

  private seesCaseIn(ctx: Ctx, sc: Scope, c: ItemCase, itemOf: Map<Id, PhysicalItem>) {
    if (this.visibleTo(ctx, c.partyIds)) return true;
    if (!this.scoped(ctx, c.partyIds)) return false;
    const it = c.itemId ? itemOf.get(c.itemId) : undefined;
    return (!!it && this.seesItemIn(ctx, sc, it)) || (!!c.movementId && sc.moves.has(c.movementId));
  }

  private seesLotIn(ctx: Ctx, sc: Scope, l: ItemLot) {
    return this.visibleTo(ctx, l.partyIds) || (this.scoped(ctx, l.partyIds) && l.custody.kind === 'site' && sc.sites.has(l.custody.ref));
  }

  /** A unit's state for another company's case: never a person's name (paper section 8). */
  private stateText(ctx: Ctx, i: PhysicalItem) {
    const c = this.mask(ctx, i.custody);
    return `${i.state.replace('_', ' ')} (${c.kind === 'person' && c.ref === '(hidden)' ? 'with a person' : c.label})`;
  }

  /** The sites in an OM's states or a Regional OM's regions, across companies. Nobody else has an area. */
  private async areaSites(user: User): Promise<Site[]> {
    if (user.role !== 'pwvsb_officer' || user.department !== 'operations') return [];
    if (user.opsTier !== 'om' && user.opsTier !== 'regional') return [];
    const states = new Set(user.opsTier === 'om' ? (user.areaStates ?? []) : REGIONS.filter((r) => (user.regionIds ?? []).includes(r.id)).flatMap((r) => r.states));
    if (!states.size) return [];
    const branchState = new Map((await this.store.list('branches')).map((b) => [b.id, b.state]));
    return (await this.store.list('sites')).filter((s) => states.has(branchState.get(s.branchId) ?? ''));
  }

  private partyName(ctx: Ctx, id: Id) {
    return ctx.parties.find((p) => p.id === id)?.name ?? id;
  }

  /** Inside a company's wall, without the Operations area scope (see seesItem for that). */
  private visibleTo(ctx: Ctx, partyIds: Id[]) {
    return partyIds.includes('*') || partyIds.some((p) => ctx.roles.has(p) && !ctx.readScope.has(p));
  }

  /** The user's company follows this item's whole history (seller and buyer after a sale). Read only. */
  private follows(ctx: Ctx, item: PhysicalItem) {
    return (item.historyPartyIds ?? []).some((p) => ctx.roles.has(p)) || ctx.roles.has(item.ownerPartyId);
  }

  // ---------- Reading ----------

  /** Hide the other company's people: a holder's name is shown only to that holder's own company. */
  private mask(ctx: Ctx, c: Custody): Custody {
    if (c.kind === 'person' && !ctx.roles.has(c.partyId) && ctx.user.personId !== c.ref)
      return { ...c, ref: '(hidden)', label: `A ${this.partyName(ctx, c.partyId)} staff member` };
    return c;
  }

  private actorVisible(ctx: Ctx, id: Id, parties?: Id[]) {
    return id === ctx.user.id || !!parties?.some((p) => p !== '*' && ctx.roles.has(p));
  }

  private maskCase(ctx: Ctx, c: ItemCase): ItemCase {
    const own = this.actorVisible(ctx, c.openedById, c.actorPartyIds);
    const r = c.resolution;
    return { ...c, openedBy: own ? c.openedBy : 'Other company staff', openedById: own ? c.openedById : '(hidden)',
      note: own ? c.note : '(private note)',
      resolution: r && (this.actorVisible(ctx, r.byId, r.actorPartyIds) ? r : { ...r, by: 'Other company staff', byId: '(hidden)', note: '(private note)' }) };
  }

  private maskItem(ctx: Ctx, i: PhysicalItem): PhysicalItem {
    const out = { ...i, custody: this.mask(ctx, i.custody), pendingAck: i.pendingAck && !ctx.roles.has(i.custody.partyId) ? { ...i.pendingAck, personId: '(hidden)' } : i.pendingAck };
    // P91: the old record's holder is a name from the owner's own list: shown only to the owner company's people.
    if (out.legacyFrom?.holder && !ctx.roles.has(i.ownerPartyId)) out.legacyFrom = { ...out.legacyFrom, holder: '(hidden)' };
    return out;
  }

  async board(user: User) {
    const ctx = await this.ctx(user);
    const [skus, items, lots, moves, cases, counts, jobs, events, people, uniformRecords, shifts, sites, branches] = await Promise.all([
      this.store.list('itemSkus'),
      this.store.list('physicalItems'),
      this.store.list('itemLots'),
      this.store.list('itemMovements'),
      this.store.list('itemCases'),
      this.store.list('itemCounts'),
      this.store.list('itemSyncJobs'),
      this.store.list('itemEvents'),
      this.store.list('people'),
      this.store.list('uniformRecords'),
      this.store.list('shifts'),
      this.store.list('sites'),
      this.store.list('branches'),
    ]);
    const mine = user.personId ? items.filter((i) => i.custody.kind === 'person' && i.custody.ref === user.personId) : [];
    if (!ctx.roles.size && !mine.length && user.role !== 'guard')
      throw new ItemDenied('The item register is for stores, managers, operations, Finance, IT, audit and group leaders. Firearms are in the Arms Control vault records.');
    const sc = await this.scopeOf(ctx);
    const itemOf = new Map(items.map((i) => [i.id, i] as const));
    // A guard's own items are under "mine"; the register lists are for the companies' roles.
    const vItems = items.filter((i) => ctx.roles.size > 0 && this.seesItemIn(ctx, sc, i)).map((i) => this.maskItem(ctx, i));
    const vLots = lots.filter((l) => this.seesLotIn(ctx, sc, l));
    const vMoves = moves.filter((m) => this.seesMoveIn(ctx, sc, m));
    const vCases = cases.filter((c) => this.seesCaseIn(ctx, sc, c, itemOf)).map((c) => this.maskCase(ctx, c));
    // A blind count shows the counter nothing of what is expected until it is closed.
    const vCounts = counts.filter((c) => this.seesCountIn(ctx, sc, c)).map((c) => ({ ...c, expectedCount: c.expected.length, expected: c.blind && !c.closed ? [] : c.expected }));
    const seesSync = [...ctx.roles.values()].some((rs) => rs.includes('finance') || rs.includes('manager') || rs.includes('view'));
    const vJobs = seesSync ? jobs.filter((j) => this.visibleTo(ctx, j.partyIds)) : [];
    const skuOf = new Map(skus.map((s) => [s.id, s]));
    // Balance: by owner, holder, SKU and condition. A kit itself is not stock; its components are.
    const balance = new Map<string, { ownerPartyId: Id; holderPartyId: Id; where: string; skuId: Id; condition: string; state: string; qty: number }>();
    for (const i of vItems) {
      if (i.componentIds.length) continue;
      if (i.state === 'disposed') continue;
      const where = i.custody.kind === 'store' || i.custody.kind === 'site' ? i.custody.label : i.custody.kind;
      const k = [i.ownerPartyId, i.custody.partyId, where, i.skuId, i.condition, i.state].join('|');
      const row = balance.get(k) ?? { ownerPartyId: i.ownerPartyId, holderPartyId: i.custody.partyId, where, skuId: i.skuId, condition: i.condition, state: i.state, qty: 0 };
      row.qty += 1;
      balance.set(k, row);
    }
    for (const l of vLots) {
      const k = ['lot', l.id].join('|');
      balance.set(k, { ownerPartyId: l.ownerPartyId, holderPartyId: l.custody.partyId, where: l.custody.label, skuId: l.skuId, condition: 'n/a', state: 'bulk', qty: l.qty });
    }
    const today = dateOf(ctx.at);
    // Care reads every check of a unit the user's company owns, holds or looks after; names are not part of it.
    const careItems = items.filter((i) => this.visibleTo(ctx, i.partyIds) && (ctx.roles.has(i.ownerPartyId) || ctx.roles.has(i.custody.partyId) || this.follows(ctx, i)));
    const careIds = new Set(careItems.map((i) => i.id));
    const settings = new Map((await this.store.list('itemSettings')).map((x) => [x.partyId, x]));
    return {
      today,
      roles: [...ctx.roles.entries()].map(([partyId, roles]) => ({ partyId, roles })),
      /** How each of the user's companies tags its items. Scanning accepts all three whatever the choice. */
      tagMethods: [...ctx.roles.keys()].map((partyId) => {
        const x = settings.get(partyId);
        return { partyId, tagMethod: (x?.tagMethod ?? 'barcode') as TagMethod, label: TAG_METHOD_LABEL[x?.tagMethod ?? 'barcode'], by: x?.by ?? null, at: x?.at ?? null, reason: x?.reason ?? null };
      }),
      parties: ctx.parties.filter((p) => ctx.roles.has(p.id) || vMoves.some((m) => m.fromPartyId === p.id || m.toPartyId === p.id)),
      skus,
      items: vItems,
      lots: vLots,
      movements: vMoves.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      cases: vCases.sort((a, b) => b.at.localeCompare(a.at)),
      counts: vCounts,
      syncJobs: vJobs,
      balance: [...balance.values()].map((b) => ({ ...b, sku: skuOf.get(b.skuId)?.code ?? b.skuId })).sort((a, b) => a.sku.localeCompare(b.sku)),
      mine: mine.map((i) => ({ item: i, sku: skuOf.get(i.skuId) ?? null })),
      /** What is waiting for the signed-in person: handovers to confirm, and loans or rentals overdue. */
      mineWaiting: mine.filter((i) => i.pendingAck?.personId === user.personId).map((i) => i.id),
      mineOverdue: mine.filter((i) => i.dueBack && i.dueBack.on < today).map((i) => i.id),
      /** Each company's settings (safe defaults until the open decisions are made). Nothing here turns on SQL posting. */
      config: [...ctx.roles.keys()].map((partyId) => ({ partyId, config: this.cfg(ctx, partyId) })),
      checks: this.reconcile(vItems, vLots, vMoves, vCases, vJobs, today),
      /** After-sale care (Fauzan, 6 Nov 2026): the seller and the owning company both watch health, service and life. */
      care: this.care(ctx, careItems, skus, events.filter((e) => !!e.itemId && careIds.has(e.itemId)), cases, today),
      /** Uniform allowance per guard (Fauzan, 6 Nov 2026): at least 2 and at most 3 pieces a year, usually 1 every 6 months. */
      uniforms: this.uniforms(ctx, people, items, skus, events, uniformRecords, this.guardPlaces(people.filter((p) => p.role === 'guard'), shifts, sites, branches), today),
      /** Sites the user may open a site board for. */
      siteChoices: sites.filter((s) => this.has(ctx, s.companyId, 'store', 'manager', 'view') || this.opsMay(ctx, s.companyId, s.id)).map((s) => ({ id: s.id, name: s.name, companyId: s.companyId })),
      myUniform: user.personId
        ? (() => {
            const t = this.tallyFrom(user.personId!, events, uniformRecords, new Map(items.map((i) => [i.id, i])), skuOf, today);
            return { free: t.free, paid: t.paid, pieces: t.pieces, last: t.last, nextDue: t.last ? addMonthsIso(t.last, UNIFORM_RULE.everyMonths) : null, rule: UNIFORM_RULE };
          })()
        : null,
      sqlConnection: { connected: false as const, note: 'SQL Account is not connected. Nothing is sent; Finance posts by hand until the connection is proved in both books (paper section 5).' },
      armsNote: 'Firearms, ammunition and other controlled items are not in this register. They stay in the Arms Control vault records.',
    };
  }

  /** Daily and month-end checks (paper section 7). Differences stay visible until resolved with proof. */
  private reconcile(items: PhysicalItem[], lots: ItemLot[], moves: ItemMovement[], cases: ItemCase[], jobs: ItemSyncJob[], today: IsoDate) {
    const transit = moves.filter((m) => m.status === 'dispatched' || m.status === 'partly_received');
    const ownershipPending = moves.filter((m) => m.type === 'sale' && m.lines.some((l) => l.result === 'received') && !m.ownership);
    const oneSided = moves
      .filter((m) => m.commercialRef && m.status !== 'draft' && m.status !== 'cancelled')
      .filter((m) => {
        const js = jobs.filter((j) => j.sourceId === m.id);
        return js.length > 0 && new Set(js.map((j) => j.partyId)).size < 2;
      });
    const overdueBack = items.filter((i) => i.dueBack && i.dueBack.on < today && i.state !== 'disposed');
    const unconfirmed = items.filter((i) => i.pendingAck);
    const negativeLots = lots.filter((l) => l.qty < 0);
    return {
      inTransit: transit.map((m) => ({ id: m.id, ref: m.ref, open: m.lines.filter((l) => l.result === 'pending' || l.result === 'missing').length })),
      ownershipPending: ownershipPending.map((m) => ({ id: m.id, ref: m.ref, missing: m.type === 'sale' ? this.papersMissing(m) : [] })),
      oneSidedDocuments: oneSided.map((m) => ({ id: m.id, ref: m.ref })),
      overdueReturns: overdueBack.map((i) => i.id),
      unconfirmedHandovers: unconfirmed.map((i) => i.id),
      negativeLots: negativeLots.map((l) => l.id),
      openCases: cases.filter((c) => c.status === 'open').length,
      legacyUnverified: items.filter((i) => i.legacyUnverified).length,
    };
  }

  /** Resolve a scan to one item the user may see. Unknown, refused and unseen labels all look the same from outside. */
  async resolve(user: User, raw: string) {
    const ctx = await this.ctx(user);
    let item: PhysicalItem;
    try {
      item = await this.byLabel(ctx, raw);
    } catch (e) {
      throw await this.afterRefusal(user, e);
    }
    return this.passportOf(ctx, item);
  }

  /** The passport of one item by its record id (from a list on screen), with the same walls as a scan. */
  async passport(user: User, itemId: Id) {
    const ctx = await this.ctx(user);
    const item = await this.store.get('physicalItems', String(itemId ?? '').slice(0, 80));
    if (!item || !(await this.seesItem(ctx, item))) throw new NotFound('Item');
    return this.passportOf(ctx, item);
  }

  private async passportOf(ctx: Ctx, item: PhysicalItem) {
    const skus = await this.store.list('itemSkus');
    // A company that follows the item sees its whole life, including steps from before it owned it, with the other
    // company's staff names hidden.
    const follows = this.follows(ctx, item);
    // The item itself is visible here, so an Operations user reading it in their area sees its history too.
    const seen = (ps: Id[]) => this.visibleTo(ctx, ps) || follows || this.scoped(ctx, ps);
    const events = (await this.store.list('itemEvents', { itemId: item.id }))
      .filter((e) => seen(e.partyIds))
      .map((e) => ({
        ...e,
        by: this.actorVisible(ctx, e.byId, e.actorPartyIds) ? e.by : 'Other company staff',
        byId: this.actorVisible(ctx, e.byId, e.actorPartyIds) ? e.byId : '(hidden)',
        note: this.actorVisible(ctx, e.byId, e.actorPartyIds) ? e.note : '(private note)',
        from: e.from && this.mask(ctx, e.from),
        to: e.to && this.mask(ctx, e.to),
      }))
      .sort((a, b) => a.at.localeCompare(b.at));
    const cases = (await this.store.list('itemCases', { itemId: item.id }))
      .filter((c) => seen(c.partyIds))
      .map((c) => this.maskCase(ctx, c));
    const prints = (await this.store.list('itemLabelPrints', { itemId: item.id }))
      .filter((x) => seen(x.partyIds))
      .map((x) => ({ ...x, by: this.actorVisible(ctx, x.byId, x.partyIds) ? x.by : 'Other company staff', byId: this.actorVisible(ctx, x.byId, x.partyIds) ? x.byId : '(hidden)' }))
      .sort((a, b) => a.at.localeCompare(b.at));
    const moveIds = uniq(events.map((e) => e.movementId).filter((x): x is Id => !!x));
    const moves = (await Promise.all(moveIds.map((id) => this.store.get('itemMovements', id)))).filter((m): m is ItemMovement => !!m && seen(m.partyIds));
    return {
      item: this.maskItem(ctx, item),
      label: labelDisplay(item.token),
      gen: labelGenOf(item),
      prints,
      movements: moves.map((m) => ({ id: m.id, ref: m.ref, type: m.type, status: m.status, commercialRef: m.commercialRef })),
      sku: skus.find((s) => s.id === item.skuId) ?? null,
      events,
      cases,
      owner: this.partyName(ctx, item.ownerPartyId),
      holder: this.partyName(ctx, item.custody.partyId),
      followedBy: (item.historyPartyIds ?? []).map((x) => this.partyName(ctx, x)),
    };
  }

  /** Find the item a scan names: a printed barcode or QR (same P1- ID) or an RFID tag read. Visibility not checked. */
  private async scanned(store: Store, raw: string): Promise<PhysicalItem | undefined> {
    const p = parseScan(raw);
    if (!p.ok) throw new BadRequest(LABEL_REFUSAL[p.reason]);
    const [item] = p.by === 'label' ? await store.list('physicalItems', { token: p.token }) : await store.list('physicalItems', { rfidTag: p.tag });
    return item;
  }

  private async byLabel(ctx: Ctx, raw: string): Promise<PhysicalItem> {
    return (await this.scanItem(this.store, ctx, { code: String(raw ?? ''), source: 'list' }, 'view')).item;
  }

  /** The scan of a write: the scan entry when given, else the older bare label (chosen from a list on screen). */
  private entryOf(a: Scanned): ScanEntry {
    const r = readEntry(a.scan, a.label);
    if (!r.ok) throw new BadRequest(r.message);
    return r.entry;
  }

  /**
   * Find and judge one scan for a write, by the same rules as items/scan-check. An unknown or unseen label is a miss
   * (recorded after the change is refused); an older copy of a label never moves the item; a typed ID needs its proof.
   */
  private async scanItem(tx: Store, ctx: Ctx, entry: ScanEntry, purpose: ScanPurpose): Promise<{ item: PhysicalItem; manual: boolean; source: ScanSource }> {
    const p = parseScan(entry.code);
    if (!p.ok) throw new BadRequest(LABEL_REFUSAL[p.reason]);
    await this.missGuard(ctx);
    const [item] = p.by === 'label' ? await tx.list('physicalItems', { token: p.token }) : await tx.list('physicalItems', { rfidTag: p.tag });
    if (!item || !(await this.seesItem(ctx, item))) throw this.miss(entry.code, 'not_found');
    // A bare label from an older screen may still be a raw scanned code: its generation is checked all the same.
    const genSource: ScanSource = entry.source === 'list' && p.by === 'label' && p.gen != null ? 'wedge' : entry.source;
    const g = genVerdict(p.by === 'label' ? p.gen : null, genSource, item);
    if (g === 'forged') throw this.miss(entry.code, 'forged');
    if (g === 'superseded' && MOVING_PURPOSES.includes(purpose)) throw this.supersededError(item);
    const problem = manualProblem(entry, item);
    if (problem) throw new BadRequest(problem);
    return { item, manual: entry.source === 'typed', source: entry.source };
  }

  private async byScan(tx: Store, ctx: Ctx, a: Scanned, purpose: ScanPurpose) {
    const entry = this.entryOf(a);
    const r = await this.scanItem(tx, ctx, entry, purpose);
    if (r.manual) await this.noteUnreadable(tx, ctx, r.item, entry.manual?.reason ?? '');
    return r;
  }

  private miss(code: string, why: 'not_found' | 'forged') {
    const e = new NotFound('Item') as NotFound & { scanMiss?: { code: string; why: 'not_found' | 'forged' } };
    e.scanMiss = { code, why };
    return e;
  }

  private supersededError(item: PhysicalItem) {
    const e = new BadRequest('That is an older copy of this label: a newer label was printed. Use the current label. The old copy has been reported for a check.') as BadRequest & { superseded?: Id };
    e.superseded = item.id;
    return e;
  }

  /** Too many unknown labels in a short time pauses scanning for this person (paper section 9: guessing). */
  private async missGuard(ctx: Ctx) {
    const row = await this.store.get('itemScanDenials', ctx.user.id);
    if (!row) return;
    const since = Date.parse(ctx.at) - MISS_WINDOW_MS;
    const recent = row.misses.filter((m) => Date.parse(m.at) > since).length;
    if (recent > this.missLimit(ctx)) throw new ItemDenied('Too many unknown labels in a short time. Scanning is paused for 10 minutes; ask your supervisor.');
  }

  private missLimit(ctx: Ctx) {
    const limits = [...ctx.roles.keys()].map((p) => this.cfg(ctx, p).missLimit);
    return limits.length ? Math.min(...limits) : DEFAULT_ITEM_CONFIG.missLimit;
  }

  /** Record a miss: a fingerprint only, never the raw label. Best effort: a missing table never hides the refusal. */
  private async noteMiss(user: User, code: string, why: 'not_found' | 'forged') {
    const at = this.clock();
    const hash = scanHash(code);
    try {
      const ctx = await this.ctx(user);
      const limit = this.missLimit(ctx);
      await this.store.transaction(async (tx) => {
        await tx.lock?.('itemScanDenials', user.id);
        const row = await tx.get('itemScanDenials', user.id);
        const since = Date.parse(at) - MISS_WINDOW_MS;
        const misses = [...(row?.misses ?? []).filter((m) => Date.parse(m.at) > since), { at, hash }].slice(-200);
        const blocked = misses.length > limit;
        if (row) await tx.update('itemScanDenials', user.id, { misses, blockedAt: blocked ? (row.blockedAt ?? at) : null });
        else await tx.insert('itemScanDenials', { id: user.id, userId: user.id, misses, blockedAt: blocked ? at : null, partyIds: [] });
        await tx.audit({ at, actor: user.name, companyId: null, action: why === 'forged' ? 'item.resolve.forged' : blocked ? 'item.resolve.blocked' : 'item.resolve.miss', entity: 'item_scan', entityId: hash.slice(0, 16), summary: why === 'forged' ? `A label with an impossible print generation was scanned (fingerprint ${hash.slice(0, 12)}): suspected copy.` : `Unknown or not-visible label scanned (fingerprint ${hash.slice(0, 12)}).` });
      });
    } catch {
      // The limiter table may not be installed yet; the refusal itself still stands.
    }
  }

  /** An older copy of a label was used to move an item: open (once) a case for the holder to check. */
  private async openSuperseded(user: User, itemId: Id) {
    const ctx = await this.ctx(user);
    await this.store.transaction(async (tx) => {
      const item = await tx.get('physicalItems', itemId);
      if (!item) return;
      if ((await tx.list('itemCases', { itemId })).some((c) => c.kind === 'label_superseded' && c.status === 'open')) return;
      await this.openCase(tx, ctx, { kind: 'label_superseded', itemId, partyId: item.custody.partyId, note: `${labelDisplay(item.token)}: an older copy of the label (before print ${labelGenOf(item)}) was scanned. Check the object; withdraw the old copy or confirm the identity.`, partyIds: item.partyIds });
    });
  }

  /**
   * After a refused change: keep the record of a miss or an old label, then refuse. The change itself was rolled back;
   * only this record is kept (the request commits it, as a refusal that keeps what it saved).
   */
  private async afterRefusal(user: User, e: unknown): Promise<unknown> {
    const x = e as { scanMiss?: { code: string; why: 'not_found' | 'forged' }; superseded?: Id };
    if (x?.scanMiss) {
      await this.noteMiss(user, x.scanMiss.code, x.scanMiss.why);
      return new RefusedAfterSave('Item not found. The label is unknown, or not one you may see.');
    }
    if (x?.superseded) {
      try {
        await this.openSuperseded(user, x.superseded);
      } catch {
        // Keep the refusal even if the case cannot be written.
      }
      return new RefusedAfterSave((e as Error).message);
    }
    return e;
  }

  /** A typed ID means the label could not be read: one open case per item drives a reprint. */
  private async noteUnreadable(tx: Store, ctx: Ctx, item: PhysicalItem, why: string) {
    if ((await tx.list('itemCases', { itemId: item.id })).some((c) => c.kind === 'label_unreadable' && c.status === 'open')) return;
    await this.openCase(tx, ctx, { kind: 'label_unreadable', itemId: item.id, partyId: item.custody.partyId, note: `${labelDisplay(item.token)} was typed in, not scanned (${clip(why, 120) || 'no reason'}). Reprint the label.`, partyIds: item.partyIds });
  }

  /**
   * Judge one scan without changing anything (items/scan-check): the screen shows the verdict before anything is
   * saved. Items the user may not see are "not found", the same as unknown labels, and count towards the limiter.
   */
  async scanCheck(user: User, purpose: ScanPurpose, contextId: Id | null, raw: unknown): Promise<ScanVerdict> {
    if (!SCAN_PURPOSES.includes(purpose)) throw new BadRequest('Unknown scan purpose.');
    const r = readEntry(raw);
    if (!r.ok) throw new BadRequest(r.message);
    const entry = r.entry;
    const ctx = await this.ctx(user);
    const p = parseScan(entry.code);
    if (!p.ok) throw new BadRequest(LABEL_REFUSAL[p.reason]);
    await this.missGuard(ctx);
    const base = { source: entry.source, manual: entry.source === 'typed' };
    const [item] = p.by === 'label' ? await this.store.list('physicalItems', { token: p.token }) : await this.store.list('physicalItems', { rfidTag: p.tag });
    const g = item ? genVerdict(p.by === 'label' ? p.gen : null, entry.source, item) : 'ok';
    if (!item || !(await this.seesItem(ctx, item)) || g === 'forged') {
      await this.noteMiss(user, entry.code, g === 'forged' ? 'forged' : 'not_found');
      return { ...base, outcome: 'not_found', message: 'Not found. This label is unknown, or not one you may see.' };
    }
    const sku = await this.store.get('itemSkus', item.skuId);
    const info = { itemId: item.id, label: labelDisplay(item.token), sku: sku?.code ?? null, size: sku?.size ?? null, state: item.state, version: item.version, hasSerial: !!item.serial };
    if (g === 'superseded') {
      if (MOVING_PURPOSES.includes(purpose)) await this.openSuperseded(user, item.id);
      return { ...base, ...info, outcome: 'superseded_label', message: 'Old copy of this label: a newer label was printed. It cannot be used to move the item; a case is open.' };
    }
    const problem = manualProblem(entry, item);
    if (problem) return { ...base, ...info, outcome: 'needs_manual_proof', message: problem };
    const ok = (message = 'OK') => ({ ...base, ...info, outcome: 'ok' as const, message });
    const no = (outcome: ScanVerdict['outcome'], message: string) => ({ ...base, ...info, outcome, message });
    if (purpose === 'pick') {
      const m = contextId ? await this.store.get('itemMovements', contextId) : undefined;
      if (!m || !(await this.seesMove(ctx, m))) throw new NotFound('Movement');
      if (m.lines.some((l) => l.itemId === item.id || (item.componentIds ?? []).includes(l.itemId))) return no('duplicate', 'Already on this list.');
      if (item.kitId) return no('not_available', 'This unit is part of a set: scan the set.');
      if (item.custody.partyId !== m.fromPartyId) return no('held_elsewhere', 'Held by another company: it cannot be sent from here.');
      if (NOT_MOVABLE.includes(item.state) || (item.state !== 'available' && !(m.type === 'transfer' && item.state === 'at_site'))) return no('not_available', `Not available to send: ${STATE_LABEL[item.state].toLowerCase()}.`);
      const exp = m.expected ?? [];
      if (exp.length) {
        const want = exp.find((x) => x.skuId === item.skuId);
        if (!want) return no('wrong_sku', 'This item type is not on the pick list.');
        const have = await this.pickedOf(m, item.skuId);
        if (have >= want.qty) return no('not_on_list', `All ${want.qty} of this item type are already picked.`);
      }
      return ok();
    }
    if (purpose === 'receive') {
      const m = contextId ? await this.store.get('itemMovements', contextId) : undefined;
      if (!m || !(await this.seesMove(ctx, m))) throw new NotFound('Movement');
      const line = m.lines.find((l) => l.itemId === item.id);
      if (!line) {
        const other = item.state === 'in_transit' && item.custody.ref !== m.id ? await this.store.get('itemMovements', item.custody.ref) : undefined;
        return no('not_on_list', other && (await this.seesMove(ctx, other)) ? `Not on this delivery. It is in transit on ${other.ref}.` : 'Not on this delivery.');
      }
      if (line.result !== 'pending' && line.result !== 'missing') return no('duplicate', 'Already recorded on this delivery.');
      return ok();
    }
    if (purpose === 'count') {
      const c = contextId ? await this.store.get('itemCounts', contextId) : undefined;
      if (!c || !this.seesCountIn(ctx, await this.scopeOf(ctx), c)) throw new NotFound('Count');
      if (c.found.includes(item.id) || c.extra.includes(item.id)) return no('duplicate', 'Already counted.');
      if (c.snapshotAt !== null && !c.expected.includes(item.id)) return no('not_on_list', 'Not expected here: it will be listed as extra.');
      return ok();
    }
    if (purpose === 'verify_print') {
      const pr = contextId ? await this.store.get('itemLabelPrints', contextId) : undefined;
      if (!pr || !this.visibleTo(ctx, pr.partyIds)) throw new NotFound('Print');
      if (pr.itemId !== item.id) return no('not_on_list', 'Label applied to the wrong item: this is not the label printed for this slot.');
      if (entry.source === 'typed' || entry.source === 'list') return no('needs_manual_proof', 'Scan the printed label with the camera or scanner; typing it is not a check of the print.');
      return ok();
    }
    if (purpose === 'issue' && (NOT_MOVABLE.includes(item.state) || item.condition === 'damaged')) return no('not_available', `It cannot be handed over: ${STATE_LABEL[item.state].toLowerCase()}${item.condition === 'damaged' ? ', damaged' : ''}.`);
    if (purpose === 'return' && item.custody.kind !== 'person' && item.custody.kind !== 'site') return no('not_available', 'It is not with a person or at a site.');
    if (purpose === 'confirm' && item.pendingAck?.personId !== ctx.user.personId) return no('not_on_list', 'This item is not waiting for you.');
    return ok();
  }

  /** Units of one item type already on a movement (a set counts as its own type, once). */
  private async pickedOf(m: ItemMovement, skuId: Id) {
    let n = 0;
    const seenKits = new Set<Id>();
    for (const l of m.lines) {
      const it = await this.store.get('physicalItems', l.itemId);
      if (!it) continue;
      if (it.kitId) {
        if (seenKits.has(it.kitId)) continue;
        seenKits.add(it.kitId);
        const kit = await this.store.get('physicalItems', it.kitId);
        if (kit?.skuId === skuId) n++;
        continue;
      }
      if (it.skuId === skuId) n++;
    }
    return n;
  }

  // ---------- Writing ----------

  /** Run one action once. The request id makes a retry or a double tap return the first result. */
  async act(user: User, requestId: string, action: ItemAction): Promise<unknown> {
    const rid = clip(requestId, 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(rid)) throw new BadRequest('Missing request id.');
    if (!action || typeof action !== 'object' || typeof (action as { kind?: unknown }).kind !== 'string') throw new BadRequest('Unknown action.');
    const raw = JSON.stringify(action);
    const paperKinds = ['move.paper', 'move.acknowledge'];
    const big = [...paperKinds, 'book.verify', 'sync.ack', 'sync.lookup', 'sync.snapshot'].includes((action as { kind: string }).kind);
    const many = ['count.scanBatch', 'move.receive', 'move.receiveScan', 'count.scanMany', 'label.print'].includes((action as { kind: string }).kind);
    if (raw.length > (big ? PAPER_MAX_BYTES * 1.4 + 4000 : many ? 200_000 : 20000))
      throw new BadRequest(paperKinds.includes((action as { kind: string }).kind) ? 'The paper is too large. Scan it smaller (under 2 MB).' : 'Too much in one request: send fewer items at a time.');
    // A plain copy with list fields forced to lists, so a malformed request is refused, never half-applied.
    action = JSON.parse(raw) as ItemAction;
    const rec = action as unknown as Record<string, unknown>;
    for (const k of ['lines', 'lotLines', 'labels', 'serials', 'components', 'supplierBarcodes', 'reads', 'scans', 'unexpected', 'itemIds', 'expected', 'jobIds', 'counterparties', 'skuIds', 'symbols'])
      if (k in rec && rec[k] != null && !Array.isArray(rec[k])) throw new BadRequest(`${k} must be a list.`);
    for (const k of ['scans', 'unexpected', 'reads', 'itemIds']) if (Array.isArray(rec[k]) && (rec[k] as unknown[]).length > SCAN_BATCH_MAX) throw new BadRequest(`Send at most ${SCAN_BATCH_MAX} at a time.`);
    for (const k of ['lines', 'lotLines', 'components', 'scans', 'unexpected', 'expected', 'counterparties'])
      if (Array.isArray(rec[k]) && (rec[k] as unknown[]).some((x) => !x || typeof x !== 'object')) throw new BadRequest(`${k} must be a list of entries.`);
    const hash = sha256Hex(raw);
    const once = async () => {
      const key = `${user.id}:${rid}`;
      const prior = await this.store.get('itemRequests', key);
      if (prior) {
        if (prior.hash !== hash) throw new ReviewConflict('This request id was already used for a different change. Reload and try again.');
        return { replay: true, result: prior.result };
      }
      const ctx = await this.ctx(user, key);
      const result = await this.store.transaction(async (tx) => {
        const out = await this.apply(tx, ctx, action);
        await tx.insert('itemRequests', { id: key, userId: user.id, hash, at: ctx.at, result: out, partyIds: [] });
        return out;
      });
      return { replay: false, result };
    };
    // A miss or an old label is recorded after the change itself is refused and rolled back.
    const run = async () => {
      try {
        return await once();
      } catch (e) {
        throw await this.afterRefusal(user, e);
      }
    };
    if (this.store.lock) return run();
    const prev = ItemService.queues.get(this.store) ?? Promise.resolve();
    const next = prev.then(run, run);
    ItemService.queues.set(
      this.store,
      next.catch(() => undefined),
    );
    return next;
  }

  /** A new record id: random, never a count of the table (P85: no listing a whole table to insert one row). */
  private newId(prefix: string) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  /**
   * The next running number for a reference (MV, CT, IC, EXP), one counter row per key under a lock. The first use
   * starts after the highest number already in the table, so older references are never reused.
   */
  private async nextRef(tx: Store, key: string, seed: () => Promise<number>) {
    await tx.lock?.('itemCounters', key);
    const row = await tx.get('itemCounters', key);
    const n = (row ? row.n : await seed()) + 1;
    if (row) await tx.update('itemCounters', key, { n });
    else await tx.insert('itemCounters', { id: key, n, partyIds: ['*'] });
    return n;
  }

  private static maxRef(refs: (string | null | undefined)[], prefix: string) {
    let max = 0;
    for (const r of refs) {
      const m = r ? new RegExp(`^${prefix}-(\\d+)$`).exec(r) : null;
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }

  private async event(tx: Store, ctx: Ctx, e: Omit<ItemEvent, 'id' | 'at' | 'by' | 'byId'>) {
    const id = this.newId('iev');
    const follow = e.itemId ? ((await tx.get('physicalItems', e.itemId))?.historyPartyIds ?? []) : [];
    await tx.insert('itemEvents', { id, at: ctx.at, by: ctx.user.name, byId: ctx.user.id, ...e, actorPartyIds: ctx.user.companyIds, partyIds: uniq([...e.partyIds, ...follow]) });
  }

  private async openCase(tx: Store, ctx: Ctx, c: { kind: ItemCaseKind; itemId?: Id | null; lotId?: Id | null; movementId?: Id | null; partyId: Id; note: string; partyIds: Id[] }) {
    const id = this.newId('icase');
    const n = await this.nextRef(tx, 'IC', async () => ItemService.maxRef((await tx.list('itemCases')).map((x) => x.ref), 'IC'));
    const follow = c.itemId ? ((await tx.get('physicalItems', c.itemId))?.historyPartyIds ?? []) : [];
    const row: ItemCase = {
      id,
      ref: runningRef('IC', n),
      kind: c.kind,
      itemId: c.itemId ?? null,
      lotId: c.lotId ?? null,
      movementId: c.movementId ?? null,
      partyId: c.partyId,
      note: clip(c.note, 500),
      openedBy: ctx.user.name,
      openedById: ctx.user.id,
      actorPartyIds: ctx.user.companyIds,
      at: ctx.at,
      status: 'open',
      resolution: null,
      partyIds: uniq([...c.partyIds, ...follow]),
    };
    await tx.insert('itemCases', row);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: c.partyId, action: `item.case.${c.kind}`, entity: 'item_case', entityId: id, summary: `${row.ref} opened: ${c.kind.replace('_', ' ')}. ${row.note}` });
    return row;
  }

  private async lockItem(tx: Store, item: PhysicalItem, expectedVersion?: number) {
    await tx.lock?.('physicalItems', item.id);
    const fresh = (await tx.get('physicalItems', item.id))!;
    if (expectedVersion != null && fresh.version !== expectedVersion) throw new ReviewConflict('Someone changed this item a moment ago. Reload it and check again.');
    return fresh;
  }

  /** An open count that froze moves of its units (P85: small scopes only) refuses any move of them until it closes. */
  private async assertNotFrozen(tx: Store, item: PhysicalItem) {
    const open = await tx.list('itemCounts', { closed: null } as never);
    if (open.some((c) => c.freeze && c.snapshotAt !== null && c.expected.includes(item.id))) throw new BadRequest(`${labelDisplay(item.token)} is in a count that froze moves until it closes.`);
  }

  private async setItem(tx: Store, item: PhysicalItem, patch: Partial<PhysicalItem>) {
    if ('custody' in patch || patch.state === 'reserved') await this.assertNotFrozen(tx, item);
    const next = { ...item, ...patch };
    const partyIds = uniq([next.ownerPartyId, next.custody.partyId, ...(next.historyPartyIds ?? []), ...(patch.partyIds ?? item.partyIds)]);
    return tx.update('physicalItems', item.id, { ...patch, partyIds, version: item.version + 1 });
  }

  private skuCheck(sku: ItemSku | undefined): ItemSku {
    if (!sku) throw new BadRequest('Choose an item type from the catalogue.');
    return sku;
  }

  private async person(tx: Store, id: Id): Promise<Person> {
    const p = await tx.get('people', id);
    if (!p || p.status !== 'active') throw new BadRequest('Choose an active staff member.');
    return p;
  }

  private async site(tx: Store, id: Id): Promise<Site> {
    const s = await tx.get('sites', id);
    if (!s) throw new BadRequest('Choose a site.');
    return s;
  }

  private storeOf(ctx: Ctx, partyId: Id, since: IsoDateTime): Custody {
    return { kind: 'store', partyId, ref: `store:${partyId}`, label: `${this.partyName(ctx, partyId)} store`, since };
  }

  /** Who may physically handle an item held by a party (store staff, managers, and IT for IT devices). */
  private canHandle(ctx: Ctx, partyId: Id, sku?: ItemSku) {
    if (this.has(ctx, partyId, 'store', 'manager')) return sku?.category !== 'it_device' || partyId !== 'merdeka' || this.has(ctx, partyId, 'manager');
    if (this.has(ctx, partyId, 'it')) return sku?.category === 'it_device';
    return false;
  }

  /** Operations (supervisors) may hand over and take back within their own sites and company. */
  private opsMay(ctx: Ctx, partyId: Id, siteId?: Id | null) {
    if (!this.has(ctx, partyId, 'ops')) return false;
    if (ctx.opsSites.size) return siteId != null && ctx.opsSites.has(siteId);
    return siteId == null || ctx.user.siteIds.includes(siteId);
  }

  private async apply(tx: Store, ctx: Ctx, a: ItemAction): Promise<unknown> {
    switch (a.kind) {
      case 'sku.add':
        return this.skuAdd(tx, ctx, a);
      case 'sku.map':
        return this.skuMap(tx, ctx, a);
      case 'item.register':
        return this.register(tx, ctx, a);
      case 'item.inspect':
        return this.inspect(tx, ctx, a);
      case 'item.reprint':
        return this.reprint(tx, ctx, a);
      case 'item.replace':
        return this.replace(tx, ctx, a);
      case 'kit.assemble':
        return this.kitAssemble(tx, ctx, a);
      case 'lot.add':
        return this.lotAdd(tx, ctx, a);
      case 'lot.issue':
        return this.lotIssue(tx, ctx, a);
      case 'move.create':
        return this.moveCreate(tx, ctx, a);
      case 'move.add':
        return this.moveAdd(tx, ctx, a);
      case 'move.addLot':
        return this.moveAddLot(tx, ctx, a);
      case 'move.remove':
        return this.moveRemove(tx, ctx, a);
      case 'move.dispatch':
        return this.moveDispatch(tx, ctx, a);
      case 'move.receive':
        return this.moveReceive(tx, ctx, a);
      case 'move.ownership':
        return this.moveOwnership(tx, ctx, a);
      case 'issue':
        return this.issue(tx, ctx, a);
      case 'confirm':
        return this.confirm(tx, ctx, a);
      case 'dispute':
        return this.dispute(tx, ctx, a);
      case 'return':
        return this.giveBack(tx, ctx, a);
      case 'report.missing':
        return this.reportMissing(tx, ctx, a);
      case 'repair.out':
        return this.repairOut(tx, ctx, a);
      case 'repair.back':
        return this.repairBack(tx, ctx, a);
      case 'dispose.ask':
        return this.disposeAsk(tx, ctx, a);
      case 'observe':
        return this.observe(tx, ctx, a);
      case 'case.resolve':
        return this.caseResolve(tx, ctx, a);
      case 'count.start':
        return this.countStart(tx, ctx, a);
      case 'count.scan':
        return this.countScan(tx, ctx, a);
      case 'count.close':
        return this.countClose(tx, ctx, a);
      case 'sku.care':
        return this.skuCare(tx, ctx, a);
      case 'item.service':
        return this.itemService(tx, ctx, a);
      case 'service.request':
        return this.serviceRequest(tx, ctx, a);
      case 'move.paper':
        return this.movePaper(tx, ctx, a);
      case 'move.acknowledge':
        return this.moveAcknowledge(tx, ctx, a);
      case 'device.confirm':
        return this.deviceConfirm(tx, ctx, a);
      case 'move.receiveScan':
        return this.moveReceiveScan(tx, ctx, a);
      case 'count.scanMany':
        return this.countScanMany(tx, ctx, a);
      case 'item.rfid':
        return this.itemRfid(tx, ctx, a);
      case 'settings.tagMethod':
        return this.setTagMethod(tx, ctx, a);
      case 'uniform.past':
        return this.uniformPast(tx, ctx, a);
      case 'sku.mapApprove':
        return this.skuMapApprove(tx, ctx, a);
      case 'label.print':
        return this.labelPrint(tx, ctx, a);
      case 'label.verify':
        return this.labelVerify(tx, ctx, a);
      case 'move.cancel':
        return this.moveCancel(tx, ctx, a);
      case 'count.scanBatch':
        return this.countScanBatch(tx, ctx, a);
      case 'count.recount':
        return this.countRecount(tx, ctx, a);
      case 'count.review':
        return this.countReview(tx, ctx, a);
      case 'settings.config':
        return this.settingsConfig(tx, ctx, a);
      case 'laundry.out':
        return this.laundryOut(tx, ctx, a);
      case 'laundry.back':
        return this.laundryBack(tx, ctx, a);
      case 'item.swap':
        return this.itemSwap(tx, ctx, a);
      case 'book.set':
        return this.bookSet(tx, ctx, a);
      case 'book.verify':
        return this.bookVerify(tx, ctx, a);
      case 'sync.refresh':
        return this.syncRefresh(tx, ctx, a);
      case 'sync.batch':
        return this.syncBatch(tx, ctx, a);
      case 'sync.sent':
        return this.syncSent(tx, ctx, a);
      case 'sync.ack':
        return this.syncAck(tx, ctx, a);
      case 'sync.reject':
        return this.syncReject(tx, ctx, a);
      case 'sync.unknown':
        return this.syncUnknown(tx, ctx, a);
      case 'sync.lookup':
        return this.syncLookup(tx, ctx, a);
      case 'sync.review':
        return this.syncReview(tx, ctx, a);
      case 'sync.snapshot':
        return this.syncSnapshot(tx, ctx, a);
      case 'sync.reconcile':
        return this.syncReconcile(tx, ctx, a);
      default:
        throw new BadRequest('Unknown action.');
    }
  }

  // ----- Catalogue -----

  private async skuAdd(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sku.add' }>) {
    const anyHandler = [...ctx.roles.entries()].some(([p]) => this.has(ctx, p, 'store', 'manager')) || (a.category === 'it_device' && this.has(ctx, 'merdeka', 'it', 'manager'));
    if (!anyHandler) throw new ItemDenied('Only store staff, managers (and IT for IT devices) add item types.');
    const code = clip(a.code, 40).toUpperCase();
    const name = clip(a.name, 120);
    if (!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(code)) throw new BadRequest('Give a short code, letters, numbers and dashes (e.g. SHIRT-NAVY-L).');
    if (name.length < 3) throw new BadRequest('Give the item name.');
    if (isControlledItem(`${code} ${name}`)) throw new BadRequest('Firearms, ammunition and controlled items are not registered here. They stay in the Arms Control vault records.');
    if (!ITEM_CATEGORIES.includes(a.category)) throw new BadRequest('Choose a category.');
    if (!['SERIALIZED', 'BULK', 'KIT'].includes(a.tracking)) throw new BadRequest('Choose how it is tracked: each unit, by quantity, or as a set.');
    if (!BASE_UOMS.includes(a.uom)) throw new BadRequest('Choose the unit.');
    if ((await tx.list('itemSkus', { code })).length) throw new BadRequest('That code is already in the catalogue.');
    const consumable = a.tracking === 'BULK' && !!a.consumable;
    let components: ItemSku['components'] = [];
    if (a.tracking === 'KIT') {
      components = (a.components ?? []).map((c) => ({ skuId: String(c.skuId), qty: Math.round(Number(c.qty)) }));
      if (!components.length || components.some((c) => !(c.qty >= 1 && c.qty <= 20))) throw new BadRequest('List the parts of the set and how many of each.');
      for (const c of components) {
        const s = await tx.get('itemSkus', c.skuId);
        if (!s || s.tracking !== 'SERIALIZED') throw new BadRequest('A set is made of item types tracked one by one.');
      }
    }
    const supplierBarcodes = uniq((a.supplierBarcodes ?? []).map((b) => clip(b, 40)).filter(Boolean)).slice(0, 10);
    const id = this.newId('sku');
    const row: ItemSku = {
      id,
      code,
      name,
      category: a.category,
      tracking: a.tracking,
      uom: a.uom,
      size: clip(a.size, 20) || null,
      colour: clip(a.colour, 30) || null,
      consumable,
      components,
      supplierBarcodes,
      sqlCodes: [],
      createdBy: ctx.user.name,
      createdAt: ctx.at,
      version: 1,
      partyIds: ['*'],
    };
    await tx.insert('itemSkus', row);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: null, action: 'item.sku.add', entity: 'item_sku', entityId: id, summary: `Item type ${code} (${name}) added, tracked ${a.tracking}.` });
    return row;
  }

  private async skuMap(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sku.map' }>) {
    if (!this.has(ctx, a.partyId, 'finance')) throw new ItemDenied("Only that company's Finance records its SQL Account item codes.");
    const sku = this.skuCheck(await tx.get('itemSkus', a.skuId));
    const itemCode = String(a.itemCode ?? '').trim();
    if (!validItemCode(itemCode)) throw new BadRequest('SQL Account item codes are 1 to 30 letters, numbers, dots, dashes or slashes, kept as text.');
    if (!BASE_UOMS.includes(a.uom)) throw new BadRequest('Choose the unit.');
    // A code may not point at two item types in one book: fuzzy or doubled mappings stop posting.
    for (const other of await tx.list('itemSkus'))
      if (other.id !== sku.id && other.sqlCodes.some((c) => c.partyId === a.partyId && c.itemCode.toUpperCase() === itemCode.toUpperCase()))
        throw new BadRequest(`That code is already used for ${other.code} in this company's book.`);
    const factor = a.factor == null ? 1 : Number(a.factor);
    if (!Number.isInteger(factor) || factor < 1 || factor > 10000) throw new BadRequest('The factor is the whole number of base units in one SQL unit (1 for PCS, PAIR or SET).');
    // A new or changed code waits for a second Finance person to approve it before anything is exported.
    const sqlCodes = [...sku.sqlCodes.filter((c) => c.partyId !== a.partyId), { partyId: a.partyId, itemCode, uom: a.uom, by: ctx.user.name, byId: ctx.user.id, at: ctx.at, factor, approvedById: null, approvedBy: null, approvedAt: null }];
    const out = await tx.update('itemSkus', sku.id, { sqlCodes, version: sku.version + 1 });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.sku.map', entity: 'item_sku', entityId: sku.id, summary: `${sku.code} mapped to SQL item code ${itemCode} (${a.uom}) for ${this.partyName(ctx, a.partyId)}. Not connected.` });
    return out;
  }

  // ----- Units -----

  private async register(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.register' }>) {
    const sku = this.skuCheck(await tx.get('itemSkus', a.skuId));
    if (sku.tracking === 'BULK') throw new BadRequest('That item type is counted by quantity: add stock instead.');
    if (sku.tracking === 'KIT') throw new BadRequest('A set is made from units already registered: assemble the set.');
    if (!this.canHandle(ctx, a.partyId, sku)) throw new ItemDenied('Only store staff of that company (or IT for IT devices) register items.');
    const count = Math.round(Number(a.count));
    if (!(count >= 1 && count <= 50)) throw new BadRequest('Register 1 to 50 units at a time.');
    const serials = (a.serials ?? []).map((s) => clip(s, 60));
    if (serials.length && serials.length !== count) throw new BadRequest('Give one maker serial per unit, or none.');
    if (uniq(serials.filter(Boolean)).length !== serials.filter(Boolean).length) throw new BadRequest('The same maker serial is listed twice.');
    for (const s of serials.filter(Boolean)) if ((await tx.list('physicalItems', { serial: s, skuId: sku.id })).length) throw new BadRequest(`Serial ${s} is already registered for this item type.`);
    let itAssetId: Id | null = null;
    if (sku.category === 'it_device') {
      if (a.partyId !== 'merdeka') throw new BadRequest('IT devices are owned by Merdeka Network (IT). Register them under Merdeka Network.');
      if (a.itAssetId) {
        if (count !== 1) throw new BadRequest('Link one IT asset at a time.');
        const asset = await tx.get('itAssets', a.itAssetId);
        if (!asset) throw new BadRequest('That IT asset is not in the IT register.');
        if ((await tx.list('physicalItems', { itAssetId: asset.id })).length) throw new BadRequest('That IT asset already has an item label. One device, one record.');
        itAssetId = asset.id;
        if (!serials.length && asset.serial) serials.push(asset.serial);
      }
    } else if (a.itAssetId) throw new BadRequest('Only IT devices link to the IT register.');
    // P91: the old system's tag or ID, kept as a reference for one unit; the same old tag is not registered twice in a company.
    const legacyRef = clip(a.legacyRef, 60) || null;
    if (legacyRef) {
      if (count !== 1) throw new BadRequest('An old tag or ID names one unit: register that unit on its own.');
      if (!/^[!-~][ -~]*$/.test(legacyRef)) throw new BadRequest('Write the old tag or ID as it is printed (letters, numbers and signs).');
      const same = (await tx.list('physicalItems', { legacyRef } as never)).find((x) => x.ownerPartyId === a.partyId && x.state !== 'disposed');
      if (same) throw new BadRequest(`Old tag ${legacyRef} is already registered as ${labelDisplay(same.token)}.`);
    }
    const lf = a.legacyFrom && typeof a.legacyFrom === 'object' && !Array.isArray(a.legacyFrom) ? a.legacyFrom : null;
    const legacyFrom = lf ? { where: clip(lf.where, 120) || null, condition: clip(lf.condition, 60) || null, holder: clip(lf.holder, 120) || null } : null;
    const out: PhysicalItem[] = [];
    for (let k = 0; k < count; k++) {
      let token = this.newToken(`${ctx.requestId}:${k}:0`);
      for (let tries = 1; (await tx.list('physicalItems', { token })).length; tries++) {
        if (tries > 5) throw new Error('Could not make a unique label.');
        token = this.newToken(`${ctx.requestId}:${k}:${tries}`);
      }
      const id = this.newId('itm');
      const custody = this.storeOf(ctx, a.partyId, ctx.at);
      const row: PhysicalItem = {
        id,
        token,
        skuId: sku.id,
        serial: serials[k] || null,
        ownerPartyId: a.partyId,
        custody,
        state: 'quarantine',
        condition: 'unknown',
        version: 1,
        // P85: no label yet. The label is printed (label.print) and scanned back (label.verify) before the check.
        labelPrints: 0,
        labelGen: 0,
        labelVerifiedAt: null,
        registeredBy: ctx.user.name,
        registeredAt: ctx.at,
        legacyUnverified: !!a.legacyUnverified,
        ...(legacyRef ? { legacyRef } : {}),
        ...(legacyFrom && (legacyFrom.where || legacyFrom.condition || legacyFrom.holder) ? { legacyFrom } : {}),
        replacesId: null,
        replacedById: null,
        itAssetId,
        kitId: null,
        componentIds: [],
        pendingAck: null,
        reservedFor: null,
        dueBack: null,
        writeOff: null,
        retiredAt: null,
        rfidTag: null,
        historyPartyIds: [],
        partyIds: [a.partyId],
      };
      await tx.insert('physicalItems', row);
      await this.event(tx, ctx, { kind: 'register', itemId: id, lotId: null, qty: 1, from: null, to: custody, ownerFrom: null, ownerTo: a.partyId, movementId: null, caseId: null, note: clip(a.note, 200) || (a.legacyUnverified ? 'Opening balance, not yet verified' : 'Registered; label to print and scan back'), partyIds: [a.partyId] });
      out.push(row);
    }
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.register', entity: 'item', entityId: out[0].id, summary: `${count} x ${sku.code} registered at ${this.partyName(ctx, a.partyId)}: labels to print and scan back, then the check.` });
    return out;
  }

  private async inspect(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.inspect' }>) {
    let item = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store holding the item checks it.');
    item = await this.lockItem(tx, item, a.expectedVersion);
    if (item.state !== 'quarantine') throw new BadRequest('Only items waiting to be checked (quarantine) are checked here.');
    if (item.custody.kind !== 'store') throw new BadRequest('Check the item in the store.');
    if (item.labelVerifiedAt === null && this.cfg(ctx, item.custody.partyId).verifyLabelsBeforeCheck)
      throw new BadRequest('Print the label and scan it back before the item is checked into stock (paper 3.1: print and scan again).');
    if (!['new', 'good', 'worn', 'damaged'].includes(a.condition)) throw new BadRequest('Choose the condition.');
    const note = clip(a.note, 300);
    if (a.condition === 'damaged' && note.length < 3) throw new BadRequest('Say what is damaged.');
    const state = a.condition === 'damaged' ? 'quarantine' : 'available';
    const out = await this.setItem(tx, item, { state, condition: a.condition });
    await this.event(tx, ctx, { kind: 'inspect', itemId: item.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `${a.condition}${note ? `: ${note}` : ''}`, partyIds: item.partyIds });
    if (a.condition === 'damaged') await this.openCase(tx, ctx, { kind: 'damaged', itemId: item.id, partyId: item.custody.partyId, note, partyIds: item.partyIds });
    return out;
  }

  /** The older reprint action: the same as printing one label again, with the reason and the identity check. */
  private async reprint(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.reprint' }>) {
    const item = await this.byLabel(ctx, a.label);
    await this.labelPrint(tx, ctx, { kind: 'label.print', itemIds: [item.id], reason: a.reason, identity: a.identity, template: a.template });
    return (await tx.get('physicalItems', item.id))!;
  }

  /**
   * Print labels (paper section 2; P85). The first print gives generation 1. A reprint keeps the ID, needs a reason and
   * the item's identity checked (its maker serial, or a tick that type and size match), and adds one to the generation,
   * so a scan of an older copy is caught. Every print is in the print log; the label is then scanned back.
   */
  private async labelPrint(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'label.print' }>) {
    const ids = uniq((a.itemIds ?? []).map((x) => String(x)));
    if (!ids.length || ids.length > 200) throw new BadRequest('Print 1 to 200 labels at a time.');
    const reason = clip(a.reason, 200);
    const batchId = this.newId('ilb');
    const labels: { printId: Id; itemId: Id; gen: number; payload: string; display: string; sku: string; size: string | null; kind: 'first' | 'reprint' }[] = [];
    let template: LabelTemplateId | null = null;
    let symbols: LabelSymbol[] = [];
    for (const id of ids) {
      const found = await tx.get('physicalItems', id);
      if (!found || !(await this.seesItem(ctx, found))) throw new NotFound('Item');
      const sku = await tx.get('itemSkus', found.skuId);
      if (!this.canHandle(ctx, found.custody.partyId, sku)) throw new ItemDenied('Only the store holding the item prints its label.');
      if (found.state === 'disposed') throw new BadRequest('A disposed item keeps its ID retired; no new label.');
      const item = await this.lockItem(tx, found);
      const cfg = this.cfg(ctx, item.custody.partyId);
      template ??= a.template ?? cfg.labelTemplate;
      if (!LABEL_TEMPLATES.includes(template)) throw new BadRequest('Choose a label sheet.');
      if (!symbols.length) symbols = uniq((a.symbols?.length ? a.symbols : cfg.labelSymbols).filter((x): x is LabelSymbol => x === 'qr' || x === 'code128'));
      if (!symbols.length) throw new BadRequest('Choose the QR code, the Code 128 barcode or both.');
      const gen = labelGenOf(item);
      const first = gen === 0;
      if (!first) {
        if (reason.length < 5) throw new BadRequest('Say why the label is reprinted and how you checked it is the same item.');
        if (item.serial) {
          if (clip(a.identity?.serialSeen, 60).toUpperCase() !== item.serial.toUpperCase()) throw new BadRequest('Type the maker serial you can see on the item: a reprint needs the identity checked.');
        } else if (a.identity?.skuSizeConfirmed !== true) throw new BadRequest('Confirm the item type and size on the item match: a reprint needs the identity checked.');
        if (gen >= 31) throw new BadRequest('This label has been printed too many times. Register a replacement with a new ID.');
        if (item.labelPrints >= cfg.reprintManagerAfter && !this.has(ctx, item.custody.partyId, 'manager'))
          throw new ItemDenied(`This label has already been printed ${item.labelPrints} times. A manager reprints it.`);
      }
      const next = first ? 1 : gen + 1;
      const print: ItemLabelPrint = {
        id: this.newId('ilp'),
        itemId: item.id,
        gen: next,
        kind: first ? 'first' : 'reprint',
        template,
        symbols,
        batchId,
        reason: first ? null : reason,
        identity: first ? null : { ...(a.identity?.serialSeen ? { serialSeen: clip(a.identity.serialSeen, 60) } : {}), skuSizeConfirmed: a.identity?.skuSizeConfirmed === true },
        by: ctx.user.name,
        byId: ctx.user.id,
        at: ctx.at,
        verified: null,
        partyIds: item.partyIds,
      };
      await tx.insert('itemLabelPrints', print);
      await this.setItem(tx, item, { labelGen: next, labelPrints: item.labelPrints + 1, labelVerifiedAt: null });
      await this.event(tx, ctx, {
        kind: first ? 'label_print' : 'label_reprint',
        itemId: item.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null,
        note: first ? 'Label printed (first print). To be scanned back.' : `Same ID reprinted (print ${next}): ${reason}. Older copies no longer move the item.`,
        partyIds: item.partyIds,
      });
      if (!first) await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: item.custody.partyId, action: 'item.label.reprint', entity: 'item', entityId: item.id, summary: `${labelDisplay(item.token)} reprinted (print ${next}): ${reason}` });
      labels.push({ printId: print.id, itemId: item.id, gen: next, payload: labelPayload(item.token, next), display: labelDisplay(item.token), sku: sku?.code ?? '', size: sku?.size ?? null, kind: print.kind });
    }
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: null, action: 'item.label.print', entity: 'item_label_batch', entityId: batchId, summary: `${labels.length} label(s) printed on ${template}.` });
    return { batchId, template, symbols, labels };
  }

  /**
   * Scan a printed label back (paper 3.1: print and scan again). Only a camera, scanner or RFID read counts; it must be
   * this print of this item. A label on the wrong item stops the run.
   */
  private async labelVerify(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'label.verify' }>) {
    const pr = await tx.get('itemLabelPrints', String(a.printId ?? '').slice(0, 80));
    if (!pr || !this.visibleTo(ctx, pr.partyIds)) throw new NotFound('Print');
    const r = readEntry(a.scan);
    if (!r.ok) throw new BadRequest(r.message);
    if (r.entry.source === 'typed' || r.entry.source === 'list') throw new BadRequest('Scan the printed label with the camera or scanner; typing it is not a check of the print.');
    const p = parseScan(r.entry.code);
    if (!p.ok) throw new BadRequest(LABEL_REFUSAL[p.reason]);
    if (p.by !== 'label') throw new BadRequest('Scan the printed label, not an RFID tag.');
    let item = (await tx.get('physicalItems', pr.itemId))!;
    if (p.token !== item.token) throw new BadRequest('Label applied to the wrong item: this is not the label printed for this slot. Stop and check the labels.');
    if ((p.gen ?? 1) !== pr.gen) throw new BadRequest('This is not the copy just printed: it is from another print of the same ID.');
    if (labelGenOf(item) !== pr.gen) throw new BadRequest('A newer label was printed since: scan that one.');
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store holding the item checks its label.');
    if (pr.verified) return pr;
    item = await this.lockItem(tx, item);
    const verified = { at: ctx.at, byId: ctx.user.id, source: r.entry.source };
    const out = await tx.update('itemLabelPrints', pr.id, { verified });
    await this.setItem(tx, item, { labelVerifiedAt: ctx.at });
    await this.event(tx, ctx, { kind: 'label_verify', itemId: item.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Printed label (print ${pr.gen}) scanned back and matched.`, partyIds: item.partyIds });
    return out;
  }

  /** A replacement is a new item with a new ID linked to the old one; the old ID never moves to the new thing. */
  private async replace(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.replace' }>) {
    const old = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', old.skuId);
    if (!this.canHandle(ctx, old.custody.partyId, sku)) throw new ItemDenied('Only the store registers a replacement.');
    if (!['quarantine', 'lost', 'disposed', 'repair'].includes(old.state)) throw new BadRequest('Take the old item back (quarantine) or close it as lost before registering its replacement.');
    if (old.replacedById) throw new BadRequest('That item already has a replacement.');
    const [fresh] = (await this.register(tx, ctx, { kind: 'item.register', skuId: old.skuId, partyId: old.custody.partyId, count: 1, note: `Replacement for ${labelDisplay(old.token)}: ${clip(a.note, 150)}` })) as PhysicalItem[];
    await tx.update('physicalItems', fresh.id, { replacesId: old.id });
    const locked = await this.lockItem(tx, old);
    await this.setItem(tx, locked, { replacedById: fresh.id });
    await this.event(tx, ctx, { kind: 'replace', itemId: old.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Replaced by ${labelDisplay(fresh.token)}`, partyIds: old.partyIds });
    return { ...fresh, replacesId: old.id };
  }

  private async kitAssemble(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'kit.assemble' }>) {
    const sku = this.skuCheck(await tx.get('itemSkus', a.skuId));
    if (sku.tracking !== 'KIT') throw new BadRequest('Choose a set item type.');
    if (!this.canHandle(ctx, a.partyId, sku)) throw new ItemDenied('Only store staff assemble sets.');
    const parts: PhysicalItem[] = [];
    for (const l of a.labels ?? []) parts.push(await this.byLabel(ctx, l));
    if (uniq(parts.map((p) => p.id)).length !== parts.length) throw new BadRequest('The same unit is scanned twice.');
    for (const c of sku.components) {
      const have = parts.filter((p) => p.skuId === c.skuId).length;
      if (have !== c.qty) throw new BadRequest('The scanned units do not match the parts of the set.');
    }
    if (parts.length !== sku.components.reduce((s, c) => s + c.qty, 0)) throw new BadRequest('The scanned units do not match the parts of the set.');
    for (const p of parts)
      if (p.state !== 'available' || p.custody.kind !== 'store' || p.custody.partyId !== a.partyId || p.ownerPartyId !== a.partyId || p.kitId) throw new BadRequest(`${labelDisplay(p.token)} is not an available unit in this store.`);
    const [kit] = (await this.register(tx, ctx, { kind: 'item.register', skuId: sku.components[0].skuId, partyId: a.partyId, count: 1, note: `Set ${sku.code}` })) as PhysicalItem[];
    await tx.update('physicalItems', kit.id, { skuId: sku.id, componentIds: parts.map((p) => p.id), state: 'available', condition: 'good' });
    for (const p of parts) {
      const locked = await this.lockItem(tx, p);
      await this.setItem(tx, locked, { kitId: kit.id });
    }
    await this.event(tx, ctx, { kind: 'kit_assemble', itemId: kit.id, lotId: null, qty: parts.length, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Set made of ${parts.map((p) => labelDisplay(p.token)).join(', ')}`, partyIds: [a.partyId] });
    return (await tx.get('physicalItems', kit.id))!;
  }

  // ----- Bulk stock -----

  private async lotAdd(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'lot.add' }>) {
    const sku = this.skuCheck(await tx.get('itemSkus', a.skuId));
    if (sku.tracking !== 'BULK') throw new BadRequest('Only item types counted by quantity are added as stock. Register units one by one.');
    if (!this.canHandle(ctx, a.partyId, sku)) throw new ItemDenied('Only store staff add stock.');
    const qty = Number(a.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new BadRequest('Give a whole quantity.');
    const note = clip(a.note, 200);
    if (note.length < 3) throw new BadRequest('Say where the stock came from (order or delivery note).');
    const ref = `store:${a.partyId}`;
    await tx.lock?.('itemLots', `allocation:${sku.id}:${a.partyId}:${ref}`);
    const [lot] = (await tx.list('itemLots', { skuId: sku.id, ownerPartyId: a.partyId })).filter((l) => l.custody.ref === ref);
    let out: ItemLot;
    if (lot) {
      await tx.lock?.('itemLots', lot.id);
      const fresh = (await tx.get('itemLots', lot.id))!;
      out = await tx.update('itemLots', lot.id, { qty: fresh.qty + qty, version: fresh.version + 1 });
    } else {
      const id = this.newId('lot');
      out = { id, skuId: sku.id, ownerPartyId: a.partyId, custody: this.storeOf(ctx, a.partyId, ctx.at), qty, version: 1, partyIds: [a.partyId] };
      await tx.insert('itemLots', out);
    }
    await this.event(tx, ctx, { kind: 'lot_add', itemId: null, lotId: out.id, qty, from: null, to: out.custody, ownerFrom: null, ownerTo: a.partyId, movementId: null, caseId: null, note, partyIds: [a.partyId] });
    return out;
  }

  private async lotIssue(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'lot.issue' }>) {
    const lot = await tx.get('itemLots', a.lotId);
    if (!lot || !this.seesLotIn(ctx, await this.scopeOf(ctx), lot)) throw new NotFound('Stock');
    const sku = this.skuCheck(await tx.get('itemSkus', lot.skuId));
    if (!this.canHandle(ctx, lot.custody.partyId, sku)) throw new ItemDenied('Only store staff issue stock.');
    await tx.lock?.('itemLots', lot.id);
    const fresh = (await tx.get('itemLots', lot.id))!;
    const qty = Number(a.qty);
    if (!Number.isInteger(qty) || qty < 1) throw new BadRequest('Give a whole quantity.');
    if (qty > fresh.qty) throw new BadRequest(`Only ${fresh.qty} in the store.`);
    let to: Custody;
    if (a.personId) {
      const p = await this.person(tx, a.personId);
      if (p.companyId !== lot.custody.partyId) throw new BadRequest('Issue only to staff of the company that holds the stock.');
      to = { kind: 'person', partyId: p.companyId, ref: p.id, label: p.name, since: ctx.at };
    } else if (a.siteId) {
      const s = await this.site(tx, a.siteId);
      if (s.companyId !== lot.custody.partyId) throw new BadRequest('Issue only to a site of the company that holds the stock.');
      to = { kind: 'site', partyId: s.companyId, ref: s.id, label: s.name, since: ctx.at };
    } else throw new BadRequest('Say who or which site gets it.');
    const out = await tx.update('itemLots', lot.id, { qty: fresh.qty - qty, version: fresh.version + 1 });
    await this.event(tx, ctx, { kind: 'lot_issue', itemId: null, lotId: lot.id, qty, from: lot.custody, to, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: sku.consumable ? `Used up, not expected back. ${clip(a.note, 150)}` : clip(a.note, 200), partyIds: lot.partyIds });
    return out;
  }

  // ----- Movements between entities, stores and sites -----

  private async moveCreate(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.create' }>) {
    if (!['sale', 'rental', 'loan', 'transfer', 'supplier_return'].includes(a.type)) throw new BadRequest('Choose sale, rental, loan, transfer or supplier return.');
    const from = ctx.parties.find((p) => p.id === a.fromPartyId);
    const to = ctx.parties.find((p) => p.id === a.toPartyId);
    if (!from || !to) throw new BadRequest('Choose both companies.');
    if (!this.has(ctx, a.fromPartyId, 'store', 'manager', 'it') && !(a.type === 'transfer' && this.opsMay(ctx, a.fromPartyId)))
      throw new ItemDenied('Only the sending company’s store prepares a movement.');
    if (a.type === 'transfer' ? a.fromPartyId !== a.toPartyId : a.fromPartyId === a.toPartyId)
      throw new BadRequest(a.type === 'transfer' ? 'A transfer stays inside one company (store or site to site). Between companies use sale, rental, loan or supplier return.' : 'A sale, rental, loan or return is between two different companies.');
    const purpose = clip(a.purpose, 200);
    if (purpose.length < 3) throw new BadRequest('Say what it is for (request, site or reason).');
    let dest: ItemMovement['to'] = { kind: 'store', ref: `store:${to.id}`, label: `${to.name} store` };
    if (a.toSiteId) {
      const s = await this.site(tx, a.toSiteId);
      if (s.companyId !== to.id) throw new BadRequest('That site is not the receiving company’s.');
      dest = { kind: 'site', ref: s.id, label: s.name };
    }
    let dueBackOn: IsoDate | null = null;
    if (a.type === 'rental' || a.type === 'loan') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.dueBackOn ?? '') || a.dueBackOn! <= dateOf(ctx.at)) throw new BadRequest('Give the date it must come back.');
      dueBackOn = a.dueBackOn!;
    }
    let originalMovementId: Id | null = null;
    if (a.type === 'supplier_return') {
      const orig = a.originalMovementId ? await tx.get('itemMovements', a.originalMovementId) : undefined;
      if (!orig || orig.type !== 'sale' || orig.fromPartyId !== a.toPartyId || orig.toPartyId !== a.fromPartyId) throw new BadRequest('A supplier return must point at the original sale from that supplier.');
      originalMovementId = orig.id;
    }
    const expected: { skuId: Id; qty: number }[] = [];
    for (const e of a.expected ?? []) {
      const skuId = String(e?.skuId ?? '');
      const qty = Number(e?.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 500) throw new BadRequest('Each line of the pick list needs a whole quantity from 1 to 500.');
      if (!(await tx.get('itemSkus', skuId))) throw new BadRequest('Choose item types from the catalogue for the pick list.');
      if (expected.some((x) => x.skuId === skuId)) throw new BadRequest('An item type is listed twice on the pick list.');
      expected.push({ skuId, qty });
    }
    if (expected.length > 50) throw new BadRequest('A pick list has at most 50 lines.');
    const id = this.newId('imv');
    const n = await this.nextRef(tx, 'MV', async () => ItemService.maxRef((await tx.list('itemMovements')).map((x) => x.ref), 'MV'));
    const ref = runningRef('MV', n);
    const row: ItemMovement = {
      id,
      ref,
      type: a.type,
      fromPartyId: from.id,
      toPartyId: to.id,
      to: dest,
      commercialRef: a.type === 'transfer' ? null : runningRef('CT', n),
      originalMovementId,
      purpose,
      dueBackOn,
      expected,
      cancelled: null,
      status: 'draft',
      lines: [],
      lotLines: [],
      createdBy: ctx.user.name,
      createdById: ctx.user.id,
      createdAt: ctx.at,
      dispatched: null,
      receipts: [],
      ownership: null,
      version: 1,
      partyIds: uniq([from.id, to.id]),
    };
    await tx.insert('itemMovements', row);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: from.id, action: 'item.move.create', entity: 'item_movement', entityId: id, summary: `${ref} ${a.type} from ${from.name} to ${dest.label} prepared: ${purpose}` });
    return row;
  }

  private async draftMove(tx: Store, ctx: Ctx, id: Id) {
    await tx.lock?.('itemMovements', id);
    const m = await tx.get('itemMovements', id);
    if (!m || !(await this.seesMove(ctx, m))) throw new NotFound('Movement');
    if (!this.has(ctx, m.fromPartyId, 'store', 'manager', 'it') && !(m.type === 'transfer' && this.opsMay(ctx, m.fromPartyId))) throw new ItemDenied('Only the sending store changes this movement.');
    if (m.status !== 'draft') throw new BadRequest('It has already left; open a new movement or a case.');
    return m;
  }

  private async moveAdd(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.add' }>) {
    const m = await this.draftMove(tx, ctx, a.movementId);
    const scan = await this.byScan(tx, ctx, a, 'pick');
    const first = scan.item;
    // The pick list: a type not asked for, or more than asked, needs a manager's reason.
    let override: string | undefined;
    if ((m.expected ?? []).length) {
      const want = m.expected!.find((x) => x.skuId === first.skuId);
      const over = !want || (await this.pickedOf(m, first.skuId)) >= want.qty;
      if (over) {
        const why = clip(a.overrideReason, 200);
        if (why.length < 5) throw new BadRequest(want ? `All ${want.qty} of this item type are already picked. A manager may add more with a reason.` : 'This item type is not on the pick list. A manager may add it with a reason.');
        if (!this.has(ctx, m.fromPartyId, 'manager')) throw new ItemDenied('Only a manager of the sending company adds what is not on the pick list.');
        override = why;
      }
    }
    const units = first.componentIds.length ? [first, ...(await Promise.all(first.componentIds.map((c) => tx.get('physicalItems', c)))).filter((x): x is PhysicalItem => !!x)] : [first];
    if (first.kitId) throw new BadRequest('This unit is part of a set: scan the set, or take it out of the set first.');
    const sku = await tx.get('itemSkus', first.skuId);
    if (sku?.category === 'it_device' && m.type !== 'rental' && m.type !== 'transfer') throw new BadRequest('IT devices are rented by Merdeka Network, never sold here.');
    const added: Id[] = [];
    for (let unit of units) {
      unit = await this.lockItem(tx, unit);
      if (m.lines.some((l) => l.itemId === unit.id)) throw new BadRequest(`${labelDisplay(unit.token)} is already on this movement.`);
      if (NOT_MOVABLE.includes(unit.state)) throw new BadRequest(`${labelDisplay(unit.token)} cannot be sent: ${unit.state.replace('_', ' ')}.`);
      if (unit.state !== 'available' && !(m.type === 'transfer' && unit.state === 'at_site')) throw new BadRequest(`${labelDisplay(unit.token)} is not in the store.`);
      if (unit.custody.partyId !== m.fromPartyId) throw new BadRequest(`${labelDisplay(unit.token)} is held by another company.`);
      if (m.type === 'sale' && unit.ownerPartyId !== m.fromPartyId) throw new BadRequest(`${labelDisplay(unit.token)} is not owned by the seller; it cannot be sold.`);
      if ((m.type === 'rental' || m.type === 'loan') && unit.ownerPartyId !== m.fromPartyId) throw new BadRequest(`${labelDisplay(unit.token)} is not owned by the company lending it.`);
      if (m.type === 'transfer' && unit.custody.kind === 'site' && !this.opsMay(ctx, m.fromPartyId, unit.custody.ref) && !this.has(ctx, m.fromPartyId, 'store', 'manager')) throw new ItemDenied('That site is not yours.');
      if (m.type === 'supplier_return') {
        const orig = (await tx.get('itemMovements', m.originalMovementId!))!;
        if (!orig.lines.some((l) => l.itemId === unit.id && l.result === 'received')) throw new BadRequest(`${labelDisplay(unit.token)} was not received on the original sale ${orig.ref}.`);
      }
      await this.setItem(tx, unit, { state: 'reserved', reservedFor: m.id, partyIds: uniq([...unit.partyIds, m.toPartyId]) });
      await this.event(tx, ctx, { kind: 'reserve', itemId: unit.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: `Picked for ${m.ref}`, partyIds: m.partyIds });
      added.push(unit.id);
    }
    // The set itself travels as a grouping; only its parts are lines to check one by one.
    const lineIds = first.componentIds.length ? added.filter((x) => x !== first.id) : added;
    return tx.update('itemMovements', m.id, { lines: [...m.lines, ...lineIds.map((itemId) => ({ itemId, result: 'pending' as const, by: null, at: null, note: '', pick: { source: scan.source, manual: scan.manual, ...(override ? { override } : {}) } }))], version: m.version + 1 });
  }

  private async moveAddLot(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.addLot' }>) {
    const m = await this.draftMove(tx, ctx, a.movementId);
    const lot = await tx.get('itemLots', a.lotId);
    if (!lot || lot.custody.partyId !== m.fromPartyId) throw new BadRequest('Choose stock held by the sender.');
    const qty = Number(a.qty);
    if (!Number.isInteger(qty) || qty < 1) throw new BadRequest('Give a whole quantity.');
    const already = m.lotLines.filter((l) => l.lotId === lot.id).reduce((s, l) => s + l.qtySent, 0);
    if (already + qty > lot.qty) throw new BadRequest(`Only ${lot.qty - already} left to send.`);
    if (m.type === 'sale' && lot.ownerPartyId !== m.fromPartyId) throw new BadRequest('That stock is not owned by the seller.');
    return tx.update('itemMovements', m.id, { lotLines: [...m.lotLines, { lotId: lot.id, skuId: lot.skuId, qtySent: qty, qtyReceived: null }], version: m.version + 1 });
  }

  private async moveRemove(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.remove' }>) {
    const m = await this.draftMove(tx, ctx, a.movementId);
    if (!m.lines.some((l) => l.itemId === a.itemId)) throw new BadRequest('That item is not on this movement.');
    const item = await this.lockItem(tx, (await tx.get('physicalItems', a.itemId))!);
    await this.setItem(tx, item, { state: item.custody.kind === 'site' ? 'at_site' : 'available', reservedFor: null });
    await this.event(tx, ctx, { kind: 'unreserve', itemId: item.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: `Taken off ${m.ref}`, partyIds: m.partyIds });
    return tx.update('itemMovements', m.id, { lines: m.lines.filter((l) => l.itemId !== a.itemId), version: m.version + 1 });
  }

  private sqlLines(m: ItemMovement, skus: ItemSku[], items: PhysicalItem[], partyId: Id, only?: Id[]) {
    const qty = new Map<Id, number>();
    const ids = new Map<Id, Id[]>();
    for (const l of m.lines) {
      if (only && !only.includes(l.itemId)) continue;
      const it = items.find((i) => i.id === l.itemId);
      if (it) {
        qty.set(it.skuId, (qty.get(it.skuId) ?? 0) + 1);
        ids.set(it.skuId, [...(ids.get(it.skuId) ?? []), it.id]);
      }
    }
    for (const l of m.lotLines) qty.set(l.skuId, (qty.get(l.skuId) ?? 0) + (only ? (l.qtyReceived ?? 0) : l.qtySent));
    return [...qty.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([skuId, q]) => {
        const sku = skus.find((s) => s.id === skuId)!;
        const code = sku.sqlCodes.find((c) => c.partyId === partyId) ?? null;
        return { skuId, itemCode: code?.itemCode ?? null, uom: code?.uom ?? sku.uom, qty: q, itemIds: (ids.get(skuId) ?? []).sort() };
      });
  }

  /**
   * The outbox row, written in the same transaction as the physical change. Never sent: SQL Account is not connected
   * and the outbox is export only. The key names the company's SQL book; the same key with a different payload is
   * refused, so a retry never makes a second document (paper section 7).
   */
  private async queueSync(tx: Store, ctx: Ctx, m: ItemMovement, partyId: Id, docType: ItemSyncJob['docType'], payload: ItemSyncJob['payload'], revision = 1) {
    const book = (await tx.get('itemSqlBooks', partyId)) ?? null;
    const bookId = book?.sqlBookId ?? BOOK_UNSET;
    const key = syncKey(partyId, docType, m.id, revision, bookId);
    const hash = payloadHash(payload);
    const [existing] = await tx.list('itemSyncJobs', { key });
    if (existing) {
      if (existing.payloadHash !== hash) throw new BadRequest('A different document for this movement is already queued. Finance must choose an update or a reversal.');
      return existing;
    }
    const docDate = dateOf(ctx.at);
    const skus = await tx.list('itemSkus');
    const blockers = syncBlockers({ partyId, payload, docDate, docType }, { book, skus, counterpartyId: counterpartyOf({ partyId }, m) });
    const row: ItemSyncJob = {
      id: this.newId('isync'),
      partyId,
      docType,
      sourceId: m.id,
      revision,
      key,
      payloadHash: hash,
      payload,
      status: blockers.includes('period_locked') ? 'manual_review' : blockers.length ? 'not_ready' : 'ready',
      reasons: this.syncReasons(blockers),
      at: ctx.at,
      book: bookId,
      docDate,
      revisionAction: 'insert',
      supersedesJobId: null,
      blockers,
      batchId: null,
      attempts: [],
      dest: null,
      reconciledAt: null,
      version: 1,
      partyIds: [partyId],
    };
    await tx.insert('itemSyncJobs', row);
    return row;
  }

  private syncReasons(blockers: SyncBlocker[]) {
    return ['SQL Account is not connected: documents go out as an export file only (paper section 5).', ...blockers.map((b) => SYNC_BLOCKER_LABEL[b])];
  }

  private async moveDispatch(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.dispatch' }>) {
    const m = await this.draftMove(tx, ctx, a.movementId);
    if (a.expectedVersion != null && m.version !== a.expectedVersion) throw new ReviewConflict('The movement changed. Reload and check the list again.');
    if (!m.lines.length && !m.lotLines.length) throw new BadRequest('Scan the items onto the movement first.');
    const carrier = clip(a.carrier, 120);
    if (carrier.length < 2) throw new BadRequest('Say who carries it (driver, officer or courier).');
    const transit: Custody = { kind: 'transit', partyId: m.fromPartyId, ref: m.id, label: `In transit ${m.ref} with ${carrier}`, since: ctx.at };
    for (const l of m.lines) {
      const item = await this.lockItem(tx, (await tx.get('physicalItems', l.itemId))!);
      if (item.state !== 'reserved' || item.reservedFor !== m.id) throw new BadRequest(`${labelDisplay(item.token)} is no longer picked for this movement. Reload.`);
      await this.setItem(tx, item, { state: 'in_transit', custody: transit, reservedFor: null });
      await this.event(tx, ctx, { kind: 'dispatch', itemId: item.id, lotId: null, qty: 1, from: item.custody, to: transit, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: `Sent on ${m.ref} (${m.type})`, partyIds: m.partyIds });
      // A set's grouping travels with its parts.
      if (item.kitId) {
        const kit = (await tx.get('physicalItems', item.kitId))!;
        if (kit.state !== 'in_transit') await this.setItem(tx, kit, { state: 'in_transit', custody: transit, reservedFor: null, partyIds: uniq([...kit.partyIds, m.toPartyId]) });
      }
    }
    for (const l of m.lotLines) {
      await tx.lock?.('itemLots', l.lotId);
      const lot = (await tx.get('itemLots', l.lotId))!;
      if (lot.qty < l.qtySent) throw new BadRequest('Not enough stock left to send. Reload.');
      await tx.update('itemLots', lot.id, { qty: lot.qty - l.qtySent, version: lot.version + 1 });
      await this.event(tx, ctx, { kind: 'dispatch', itemId: null, lotId: lot.id, qty: l.qtySent, from: lot.custody, to: transit, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: `Sent on ${m.ref}`, partyIds: m.partyIds });
    }
    const out = await tx.update('itemMovements', m.id, { status: 'dispatched', dispatched: { by: ctx.user.name, byId: ctx.user.id, at: ctx.at, carrier }, version: m.version + 1 });
    if (m.type !== 'transfer') {
      const [skus, items] = await Promise.all([tx.list('itemSkus'), m.lines.length ? tx.list('physicalItems', { id: m.lines.map((l) => l.itemId) }) : Promise.resolve([] as PhysicalItem[])]);
      const doc = m.type === 'sale' ? 'sales_delivery' : m.type === 'supplier_return' ? 'supplier_return_out' : 'rental_out';
      await this.queueSync(tx, ctx, out, m.fromPartyId, doc, { commercialRef: m.commercialRef, lines: this.sqlLines(m, skus, items, m.fromPartyId) });
    }
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: m.fromPartyId, action: 'item.move.dispatch', entity: 'item_movement', entityId: m.id, summary: `${m.ref} sent: ${m.lines.length} units${m.lotLines.length ? ` and ${m.lotLines.length} stock lines` : ''}, carried by ${carrier}.` });
    return out;
  }

  /**
   * Receive a delivery (paper 3.5). Every line is checked first; if anything changed since it was scanned, nothing is
   * saved and the conflicting lines are listed (never last-write-wins). Each line gets its own result; a unit scanned
   * that is not on the delivery opens a case and stays where it is recorded. The receipt's document goes to the
   * buyer's outbox, one revision per receipt, with the same key and payload refused twice.
   */
  private async moveReceive(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.receive' }>) {
    await tx.lock?.('itemMovements', a.movementId);
    const m = await tx.get('itemMovements', a.movementId);
    if (!m || !(await this.seesMove(ctx, m))) throw new NotFound('Movement');
    if (m.status !== 'dispatched' && m.status !== 'partly_received') throw new BadRequest(m.status === 'draft' ? 'It has not been sent yet.' : 'This movement is closed.');
    const toSite = m.to.kind === 'site' ? m.to.ref : null;
    const may = this.has(ctx, m.toPartyId, 'store', 'manager', 'it') || (!!toSite && this.opsMay(ctx, m.toPartyId, toSite));
    if (!may) throw new ItemDenied('Only the receiving company’s store, or the supervisor of the receiving site, confirms what arrived.');
    if (m.dispatched?.byId === ctx.user.id) throw new ItemDenied('The person who sent it cannot confirm it arrived.');
    const lines = a.lines ?? [];
    const lotLines = a.lotLines ?? [];
    const unexpected = a.unexpected ?? [];
    if (!lines.length && !lotLines.length && !unexpected.length) throw new BadRequest('Scan or tick each item that arrived, and mark what is missing or damaged.');
    if (uniq(lines.map((l) => l.itemId)).length !== lines.length) throw new BadRequest('The same item is listed twice.');
    const at = ctx.at;
    const dest: Custody =
      m.to.kind === 'site' ? { kind: 'site', partyId: m.toPartyId, ref: m.to.ref, label: m.to.label, since: at } : { kind: 'store', partyId: m.toPartyId, ref: m.to.ref, label: m.to.label, since: at };
    const nextLines = m.lines.map((l) => ({ ...l }));
    // 1. Check every line before anything changes.
    const conflicts: { itemId: Id; label: string; expectedVersion: number; currentVersion: number; state: string }[] = [];
    const checked: { r: (typeof lines)[number]; line: (typeof nextLines)[number]; item: PhysicalItem; scan: { source: ScanSource; manual: boolean } }[] = [];
    for (const r of lines) {
      const line = nextLines.find((l) => l.itemId === r.itemId);
      if (!line) throw new BadRequest('An item that is not on this movement cannot be received here. Scan it as not on this delivery.');
      if (line.result !== 'pending' && line.result !== 'missing') throw new BadRequest('That item is already recorded.');
      if (!['received', 'damaged', 'missing', 'wrong_item'].includes(r.result)) throw new BadRequest('Choose received, damaged, missing or wrong item.');
      if (line.result === 'missing' && r.result === 'missing') throw new BadRequest('That item is already marked missing; its case stays open.');
      const item = (await tx.get('physicalItems', r.itemId))!;
      let scan: { source: ScanSource; manual: boolean } = { source: 'list', manual: false };
      if (r.scan) {
        const e = readEntry(r.scan);
        if (!e.ok) throw new BadRequest(e.message);
        const got = await this.scanItem(tx, ctx, e.entry, 'receive');
        if (got.item.id !== item.id) throw new BadRequest(`The scanned label is not ${labelDisplay(item.token)}. Scan the item on this line.`);
        scan = { source: got.source, manual: got.manual };
      }
      if (r.baseVersion != null && Number(r.baseVersion) !== item.version)
        conflicts.push({ itemId: item.id, label: labelDisplay(item.token), expectedVersion: Number(r.baseVersion), currentVersion: item.version, state: item.state });
      checked.push({ r, line, item, scan });
    }
    if (conflicts.length) {
      const e = new ReviewConflict(`Someone changed ${conflicts.length === 1 ? 'this item' : `${conflicts.length} of these items`} since it was scanned: ${conflicts.map((c) => c.label).join(', ')}. Scan again or leave them out. Nothing was saved.`) as ReviewConflict & { details?: unknown };
      e.details = { lines: conflicts };
      throw e;
    }
    // Too many typed IDs in one receipt: a manager of the receiving company confirms it.
    const manualN = checked.filter((c) => c.scan.manual).length;
    const flagged = tooManyManual(manualN, checked.length, this.cfg(ctx, m.toPartyId));
    if (flagged && !this.has(ctx, m.toPartyId, 'manager')) throw new ItemDenied(`${manualN} of ${checked.length} lines were typed, not scanned. A manager of the receiving company confirms this receipt.`);
    // 2. Apply.
    const outcomes: { itemId: Id; label: string; result: LineResult; caseRef: string | null; manual: boolean }[] = [];
    const received: Id[] = [];
    for (const { r, line, item: before, scan } of checked) {
      const note = clip(r.note, 300);
      const item = await this.lockItem(tx, before);
      if (item.state !== 'in_transit' || item.custody.ref !== m.id) throw new BadRequest(`${labelDisplay(item.token)} is not in transit on this movement. Reload.`);
      line.by = ctx.user.name;
      line.at = at;
      line.note = note;
      line.result = r.result;
      line.scan = scan;
      let caseRef: string | null = null;
      // Once it has arrived, the sender keeps seeing it only if it still owns it (rental, loan, sale before ownership passes).
      const keep = [item.ownerPartyId, m.toPartyId];
      if (r.result === 'received') {
        const due = m.type === 'rental' || m.type === 'loan' ? { on: m.dueBackOn!, movementId: m.id } : m.type === 'supplier_return' ? null : item.dueBack;
        await this.setItem(tx, item, { state: dest.kind === 'site' ? 'at_site' : 'available', custody: dest, dueBack: due, partyIds: keep });
        if (item.kitId) {
          const kit = await this.lockItem(tx, (await tx.get('physicalItems', item.kitId))!);
          const parts = await Promise.all(kit.componentIds.map((id) => tx.get('physicalItems', id)));
          const ready = parts.length > 0 && parts.every((p) => p && ['available', 'at_site'].includes(p.state) && p.condition !== 'damaged' && p.custody.kind === dest.kind && p.custody.ref === dest.ref && p.custody.partyId === dest.partyId);
          if (ready && kit.state === 'in_transit') await this.setItem(tx, kit, { state: dest.kind === 'site' ? 'at_site' : 'available', custody: dest, partyIds: keep });
        }
        await this.event(tx, ctx, { kind: 'receive', itemId: item.id, lotId: null, qty: 1, from: item.custody, to: dest, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: `${note || `Received on ${m.ref}`}${scan.manual ? ' (typed, label unreadable)' : ''}`, partyIds: m.partyIds });
        received.push(item.id);
      } else if (r.result === 'damaged' || r.result === 'wrong_item') {
        if (note.length < 3) throw new BadRequest('Say what is wrong with it.');
        const q: Custody = { ...dest, kind: 'store', ref: `store:${m.toPartyId}`, label: `${this.partyName(ctx, m.toPartyId)} store (quarantine)` };
        await this.setItem(tx, item, { state: 'quarantine', custody: q, condition: r.result === 'damaged' ? 'damaged' : item.condition, partyIds: keep });
        await this.event(tx, ctx, { kind: 'receive_damaged', itemId: item.id, lotId: null, qty: 1, from: item.custody, to: q, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note, partyIds: m.partyIds });
        caseRef = (await this.openCase(tx, ctx, { kind: r.result === 'damaged' ? 'damaged' : 'wrong_item', itemId: item.id, movementId: m.id, partyId: m.toPartyId, note: `${m.ref}: ${note}`, partyIds: m.partyIds })).ref;
      } else {
        // Missing: stays in transit under investigation, never available.
        await this.event(tx, ctx, { kind: 'receive_missing', itemId: item.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: note || 'Did not arrive', partyIds: m.partyIds });
        caseRef = (await this.openCase(tx, ctx, { kind: 'short', itemId: item.id, movementId: m.id, partyId: m.fromPartyId, note: `${m.ref}: ${labelDisplay(item.token)} did not arrive. ${note}`, partyIds: m.partyIds })).ref;
      }
      if (scan.manual) await this.noteUnreadable(tx, ctx, item, r.scan?.manual?.reason ?? '');
      outcomes.push({ itemId: item.id, label: labelDisplay(item.token), result: r.result, caseRef, manual: scan.manual });
    }
    const nextLots = m.lotLines.map((l) => ({ ...l }));
    for (const r of lotLines) {
      const line = nextLots.find((l) => l.lotId === r.lotId && l.qtyReceived == null);
      if (!line) throw new BadRequest('That stock line is not open on this movement.');
      const qty = Number(r.qty);
      if (!Number.isInteger(qty) || qty < 0 || qty > line.qtySent) throw new BadRequest(`Received quantity must be 0 to ${line.qtySent}.`);
      line.qtyReceived = qty;
      const src = (await tx.get('itemLots', line.lotId))!;
      // Keep each receipt allocation separate, including rentals and other sellers of this SKU.
      // Its identity survives physical receipt until Finance records this movement's ownership.
      const lotId = this.newId('lot');
      await tx.insert('itemLots', { id: lotId, skuId: line.skuId, ownerPartyId: src.ownerPartyId, custody: dest, qty, version: 1, partyIds: uniq([src.ownerPartyId, m.toPartyId]) });
      line.receivedLotId = lotId;
      await this.event(tx, ctx, { kind: 'lot_receive', itemId: null, lotId, qty, from: null, to: dest, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: `${qty} of ${line.qtySent} received`, partyIds: m.partyIds });
      if (qty < line.qtySent) await this.openCase(tx, ctx, { kind: 'short', lotId: line.lotId, movementId: m.id, partyId: m.fromPartyId, note: `${m.ref}: ${line.qtySent - qty} short of ${line.qtySent}.`, partyIds: m.partyIds });
    }
    // Units that arrived but are not on this delivery: a case each; nothing is received and nothing moves.
    const unexpectedOut: { label: string | null; caseRef: string; note: string }[] = [];
    const seenCodes = new Set<string>();
    for (const raw of unexpected) {
      const e = readEntry(raw);
      if (!e.ok) throw new BadRequest(e.message);
      const p = parseScan(e.entry.code);
      if (!p.ok) throw new BadRequest(LABEL_REFUSAL[p.reason]);
      const key = p.by === 'label' ? p.token : `rfid:${p.tag}`;
      if (seenCodes.has(key)) continue;
      seenCodes.add(key);
      const [u] = p.by === 'label' ? await tx.list('physicalItems', { token: p.token }) : await tx.list('physicalItems', { rfidTag: p.tag });
      const seen = !!u && (await this.seesItem(ctx, u));
      if (seen && m.lines.some((l) => l.itemId === u.id)) continue;
      let note: string;
      if (seen) {
        const other = u.state === 'in_transit' && u.custody.ref !== m.id ? await tx.get('itemMovements', u.custody.ref) : undefined;
        note = `${m.ref}: ${labelDisplay(u.token)} arrived but is not on this delivery. Recorded as ${this.stateText(ctx, u)}${other && (await this.seesMove(ctx, other)) ? `, in transit on ${other.ref}` : ''}. It was not received and stays where it is recorded.`;
      } else note = `${m.ref}: a label that is not in this company's register arrived (fingerprint ${scanHash(e.entry.code).slice(0, 16)}). Keep the item aside.`;
      const c = await this.openCase(tx, ctx, { kind: 'unexpected_item', itemId: seen ? u.id : null, movementId: m.id, partyId: m.toPartyId, note, partyIds: [m.toPartyId] });
      unexpectedOut.push({ label: seen ? labelDisplay(u.token) : null, caseRef: c.ref, note: seen ? 'Not on this delivery' : 'Unknown label' });
    }
    const touched = lines.length + lotLines.length;
    const open = nextLines.some((l) => l.result === 'pending' || l.result === 'missing') || nextLots.some((l) => l.qtyReceived == null);
    const out = touched
      ? await tx.update('itemMovements', m.id, {
          lines: nextLines,
          lotLines: nextLots,
          status: open ? 'partly_received' : 'received',
          receipts: [...m.receipts, { by: ctx.user.name, byId: ctx.user.id, at, lines: touched }],
          version: m.version + 1,
        })
      : m;
    if (m.type !== 'transfer' && (received.length || lotLines.length)) {
      const [skus, items] = await Promise.all([tx.list('itemSkus'), received.length ? tx.list('physicalItems', { id: received }) : Promise.resolve([] as PhysicalItem[])]);
      const doc = m.type === 'sale' ? 'purchase_receipt' : m.type === 'supplier_return' ? 'supplier_return_in' : 'rental_in';
      const receivedNow = { ...m, lotLines: nextLots.filter((l) => lotLines.some((r) => r.lotId === l.lotId)) };
      // Each receipt is its own revision of the buyer's document, so a second receipt never doubles the first. The same
      // key with a different payload is refused (P85: the hash is compared here too).
      const job = { commercialRef: m.commercialRef, lines: this.sqlLines(receivedNow, skus, items, m.toPartyId, received) };
      await this.queueSync(tx, ctx, m, m.toPartyId, doc, job, m.receipts.length + 1);
    }
    await tx.audit({ at, actor: ctx.user.name, companyId: m.toPartyId, action: 'item.move.receive', entity: 'item_movement', entityId: m.id, summary: `${m.ref}: ${lines.filter((l) => l.result === 'received').length} received, ${lines.filter((l) => l.result === 'damaged' || l.result === 'wrong_item').length} to quarantine, ${lines.filter((l) => l.result === 'missing').length} missing${unexpectedOut.length ? `, ${unexpectedOut.length} not on the delivery` : ''}${manualN ? `, ${manualN} typed` : ''}.` });
    return { ...out, outcomes, unexpected: unexpectedOut, flagged };
  }

  /**
   * Declare arrival by scanning (Fauzan, 6 Nov 2026): the receiving store, the site's supervisor or the area OM scans
   * each label, QR or RFID tag, and every scanned unit still in transit is recorded as received on its movement.
   * Units not scanned stay waiting, so a short delivery is never received in full; damage and missing are still
   * marked one by one. The same checks as a ticked receipt apply (receiving side only, never the sender).
   */
  private async moveReceiveScan(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.receiveScan' }>) {
    const entries: ScanEntry[] = [];
    for (const raw of a.scans ?? []) {
      const e = readEntry(raw);
      if (!e.ok) throw new BadRequest(e.message);
      entries.push(e.entry);
    }
    for (const r of a.reads ?? []) {
      const v = String(r ?? '').trim();
      if (v) entries.push({ code: v.slice(0, 80), source: parseRfid(v) ? 'rfid' : 'wedge' });
    }
    if (!entries.length) throw new BadRequest('Scan at least one label or tag.');
    if (entries.length > SCAN_BATCH_MAX) throw new BadRequest(`Scan at most ${SCAN_BATCH_MAX} items at a time.`);
    const byMove = new Map<Id, { itemId: Id; entry: ScanEntry }[]>();
    const notInTransit: string[] = [];
    const unknown: string[] = [];
    const superseded: string[] = [];
    const needsProof: { label: string; message: string }[] = [];
    const seenKeys = new Set<string>();
    for (const entry of entries) {
      const p = parseScan(entry.code);
      if (!p.ok) {
        unknown.push(entry.code);
        continue;
      }
      const key = p.by === 'label' ? p.token : `rfid:${p.tag}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const [item] = p.by === 'label' ? await tx.list('physicalItems', { token: p.token }) : await tx.list('physicalItems', { rfidTag: p.tag });
      const g = item ? genVerdict(p.by === 'label' ? p.gen : null, entry.source, item) : 'ok';
      if (!item || g === 'forged' || (!(await this.seesItem(ctx, item)) && !this.follows(ctx, item))) {
        unknown.push(p.by === 'label' ? labelDisplay(p.token) : p.tag);
        continue;
      }
      if (g === 'superseded') {
        superseded.push(labelDisplay(item.token));
        if (!(await tx.list('itemCases', { itemId: item.id })).some((c) => c.kind === 'label_superseded' && c.status === 'open'))
          await this.openCase(tx, ctx, { kind: 'label_superseded', itemId: item.id, partyId: item.custody.partyId, note: `${labelDisplay(item.token)}: an older copy of the label was scanned on arrival. Check the object.`, partyIds: item.partyIds });
        continue;
      }
      const problem = manualProblem(entry, item);
      if (problem) {
        needsProof.push({ label: labelDisplay(item.token), message: problem });
        continue;
      }
      const target = item.kitId && item.state !== 'in_transit' ? null : item;
      const movementId = target?.state === 'in_transit' ? target.custody.ref : null;
      if (!movementId || (a.movementId && movementId !== a.movementId)) {
        notInTransit.push(labelDisplay(item.token));
        continue;
      }
      byMove.set(movementId, [...(byMove.get(movementId) ?? []), { itemId: item.id, entry }]);
    }
    const received: { movementId: Id; ref: string; count: number }[] = [];
    for (const [movementId, scans] of byMove) {
      const m = await tx.get('itemMovements', movementId);
      if (!m) continue;
      const pending = new Set(m.lines.filter((l) => l.result === 'pending' || l.result === 'missing').map((l) => l.itemId));
      const lines = scans.filter((x) => pending.has(x.itemId)).map((x) => ({ itemId: x.itemId, result: 'received' as const, note: 'Scanned on arrival', scan: x.entry }));
      if (!lines.length) continue;
      await this.moveReceive(tx, ctx, { kind: 'move.receive', movementId, lines });
      received.push({ movementId, ref: m.ref, count: lines.length });
    }
    if (!received.length && !notInTransit.length && !superseded.length && !needsProof.length) throw new BadRequest('None of these labels is on a delivery waiting for you.');
    return { received, notInTransit, unknown, superseded, needsProof };
  }

  // ----- After-sale care: health, maintenance and lifecycle (Fauzan, 6 Nov 2026) -----

  /** Who sold this unit to its owner and still looks after it (the latest earlier owner that follows it). */
  private sellerOf(item: PhysicalItem): Id | null {
    const others = (item.historyPartyIds ?? []).filter((p) => p !== item.ownerPartyId);
    return others.length ? others[others.length - 1] : null;
  }

  /** A central store's manager sets how often a type is serviced and how long it lasts, with a reason. */
  private async skuCare(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sku.care' }>) {
    if (![GOODWILL_PARTY_ID, 'pwvsb', 'merdeka'].some((p) => this.has(ctx, p, 'manager')) && !this.has(ctx, 'merdeka', 'it'))
      throw new ItemDenied('Only a manager of the Goodwill, head-office or IT store sets service intervals and expected life.');
    const sku = this.skuCheck(await tx.get('itemSkus', a.skuId));
    const num = (v: unknown, max: number, what: string) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > max) throw new BadRequest(`${what} must be a whole number from 1 to ${max}, or empty for "not set".`);
      return n;
    };
    const everyDays = num(a.everyDays, 3650, 'Days between checks');
    const lifeMonths = num(a.lifeMonths, 600, 'Expected life in months');
    const reason = clip(a.reason, 200);
    if (reason.length < 5) throw new BadRequest('Say where the figure comes from (maker manual, contract, policy).');
    const out = await tx.update('itemSkus', sku.id, { care: { everyDays, lifeMonths, reason, by: ctx.user.name, at: ctx.at }, version: sku.version + 1 });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: GOODWILL_PARTY_ID, action: 'item.sku.care', entity: 'item_sku', entityId: sku.id, summary: `${sku.code}: check every ${everyDays ?? 'not set'} days, expected life ${lifeMonths ?? 'not set'} months (${reason}).` });
    return out;
  }

  /**
   * A service check of the unit's health: by the seller that still looks after it (after-sale care), or by the owner or
   * holder. Records the condition and what was done; it never moves the item or changes the owner. A damaged result
   * opens a case for the company that holds it.
   */
  private async itemService(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.service' }>) {
    let item = await this.byLabel(ctx, a.label);
    const seller = this.sellerOf(item);
    const bySeller = !!seller && this.has(ctx, seller, 'store', 'manager', 'it');
    const byOwner = [item.ownerPartyId, item.custody.partyId].some((p) => this.has(ctx, p, 'store', 'manager', 'it', 'ops'));
    if (!bySeller && !byOwner) throw new ItemDenied('Only the company that sold it (after-sale care), the owner or the holder records a service check.');
    if (!['good', 'worn', 'damaged'].includes(a.condition)) throw new BadRequest('Choose good, worn or damaged.');
    if (['disposed', 'lost', 'in_transit'].includes(item.state)) throw new BadRequest('A service check needs the item in hand: not in transit, lost or disposed.');
    const note = clip(a.note, 300);
    if (note.length < 5) throw new BadRequest('Say what was checked or serviced.');
    item = await this.lockItem(tx, item);
    const out = await this.setItem(tx, item, { condition: a.condition });
    const who = bySeller && !byOwner ? `After-sale care by ${this.partyName(ctx, seller!)}` : 'Service check';
    await this.event(tx, ctx, { kind: 'service', itemId: item.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `${who}: ${a.condition}. ${note}`, partyIds: item.partyIds });
    if (a.condition === 'damaged') await this.openCase(tx, ctx, { kind: 'damaged', itemId: item.id, partyId: item.custody.partyId, note: `${labelDisplay(item.token)} found damaged at a service check: ${note}`, partyIds: item.partyIds });
    // A service request for this unit is answered by the check.
    for (const c of await tx.list('itemCases', { itemId: item.id }))
      if (c.kind === 'service' && c.status === 'open' && bySeller)
        await tx.update('itemCases', c.id, { status: 'resolved', resolution: { actorPartyIds: ctx.user.companyIds, outcome: a.condition === 'damaged' ? 'repair' : 'serviced', note, by: ctx.user.name, byId: ctx.user.id, at: ctx.at } });
    return out;
  }

  /** The owning company asks the seller for service on a unit it bought. Opens a case the seller answers. */
  private async serviceRequest(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'service.request' }>) {
    const item = await this.byLabel(ctx, a.label);
    if (![item.ownerPartyId, item.custody.partyId].some((p) => this.has(ctx, p, 'store', 'manager', 'it', 'ops'))) throw new ItemDenied('The owning or holding company asks for service.');
    const seller = this.sellerOf(item);
    if (!seller) throw new BadRequest('This item was not bought from another group company, so there is no after-sale care to ask. Record a service check instead.');
    const note = clip(a.note, 300);
    if (note.length < 5) throw new BadRequest('Say what is wrong or what service is needed.');
    const open = (await tx.list('itemCases', { itemId: item.id })).find((c) => c.kind === 'service' && c.status === 'open');
    if (open) throw new BadRequest(`A service request is already open (${open.ref}).`);
    return this.openCase(tx, ctx, { kind: 'service', itemId: item.id, partyId: seller, note: `${labelDisplay(item.token)}: ${note}`, partyIds: uniq([...item.partyIds, seller]) });
  }

  /**
   * Uniform pieces a person received in the 12 months up to `today`: free ones (handed over in this register, or past
   * pieces a manager entered) and ones the guard paid for. Each unit counts once even if handed over again; a uniform
   * set counts as one piece (its shirt and trousers are not counted on their own).
   */
  private tallyFrom(personId: Id, events: ItemEvent[], records: UniformRecord[], itemOf: Map<Id, PhysicalItem>, skuOf: Map<Id, ItemSku>, today: IsoDate) {
    const from = addMonthsIso(today, -12);
    const mine = records.filter((r) => r.personId === personId && r.on > from && r.on <= today);
    const paidItems = new Set(mine.filter((r) => r.kind === 'paid' && r.itemId).map((r) => r.itemId!));
    const got = new Map<Id, IsoDate>();
    for (const e of events) {
      if (e.kind !== 'issue' || !e.itemId || e.to?.kind !== 'person' || e.to.ref !== personId) continue;
      const d = dateOf(e.at);
      if (d <= from || paidItems.has(e.itemId)) continue;
      const it = itemOf.get(e.itemId);
      if (!it || it.kitId || skuOf.get(it.skuId)?.category !== 'uniform') continue;
      if ((got.get(e.itemId) ?? '') < d) got.set(e.itemId, d);
    }
    const past = mine.filter((r) => r.kind === 'past');
    const free = got.size + past.reduce((n, r) => n + r.pieces, 0);
    const paid = mine.filter((r) => r.kind === 'paid').length;
    const last = [...got.values(), ...past.map((r) => r.on)].sort().at(-1) ?? null;
    return { free, paid, countedItemIds: new Set([...got.keys(), ...paidItems]), pieces: free + paid, last, pastDates: past.map((r) => r.on) };
  }

  /** Uniform handovers to people, grouped by person, so a list of thousands of guards reads each event once. */
  private issuesByPerson(events: ItemEvent[], records: UniformRecord[]) {
    const ev = new Map<Id, ItemEvent[]>();
    for (const e of events) if (e.kind === 'issue' && e.to?.kind === 'person') ev.set(e.to.ref, [...(ev.get(e.to.ref) ?? []), e]);
    const rec = new Map<Id, UniformRecord[]>();
    for (const r of records) rec.set(r.personId, [...(rec.get(r.personId) ?? []), r]);
    return { ev: (id: Id) => ev.get(id) ?? [], rec: (id: Id) => rec.get(id) ?? [] };
  }

  private async uniformTally(tx: Store, personId: Id, today: IsoDate) {
    const [events, items, skus, records] = await Promise.all([tx.list('itemEvents'), tx.list('physicalItems'), tx.list('itemSkus'), tx.list('uniformRecords')]);
    return this.tallyFrom(personId, events, records, new Map(items.map((i) => [i.id, i])), new Map(skus.map((s) => [s.id, s])), today);
  }

  /** Where each guard works for bulk choices: the site of their latest shift, their branch's state (zone) and its region. */
  private guardPlaces(people: Person[], shifts: { personId: Id | null; siteId: Id; date: IsoDate }[], sites: Site[], branches: { id: Id; state: string }[]) {
    const latest = new Map<Id, { siteId: Id; date: IsoDate }>();
    for (const s of shifts) if (s.personId && (latest.get(s.personId)?.date ?? '') < s.date) latest.set(s.personId, { siteId: s.siteId, date: s.date });
    const siteOf = new Map(sites.map((s) => [s.id, s]));
    const stateOf = new Map(branches.map((b) => [b.id, b.state]));
    return new Map(
      people.map((p) => {
        const site = siteOf.get(latest.get(p.id)?.siteId ?? '');
        const state = stateOf.get(p.branchId) ?? null;
        return [p.id, { siteId: site?.companyId === p.companyId ? site.id : null, siteName: site?.companyId === p.companyId ? site.name : null, zone: state, regionId: state ? (regionOfState(state)?.id ?? null) : null }];
      }),
    );
  }

  /** Per guard: pieces in the last 12 months, last piece, when the next is usually due. For the store and managers of the guard's company. */
  private uniforms(ctx: Ctx, people: Person[], items: PhysicalItem[], skus: ItemSku[], events: ItemEvent[], records: UniformRecord[], places: ReturnType<ItemService['guardPlaces']>, today: IsoDate) {
    const itemOf = new Map(items.map((i) => [i.id, i]));
    const skuOf = new Map(skus.map((s) => [s.id, s]));
    const sees = (p: Id) => (ctx.roles.get(p) ?? []).some((r) => r === 'store' || r === 'manager' || r === 'view');
    const by = this.issuesByPerson(events, records);
    const rows = people
      .filter((p) => p.role === 'guard' && p.status === 'active' && sees(p.companyId))
      .map((p) => {
        const t = this.tallyFrom(p.id, by.ev(p.id), by.rec(p.id), itemOf, skuOf, today);
        const nextDue = t.last ? addMonthsIso(t.last, UNIFORM_RULE.everyMonths) : today;
        const status: 'at_max' | 'due' | 'ok' = t.free >= UNIFORM_RULE.maxPerYear ? 'at_max' : nextDue <= today ? 'due' : 'ok';
        const pl = places.get(p.id);
        return { personId: p.id, name: p.name, staffNo: p.staffNo, companyId: p.companyId, free: t.free, paid: t.paid, pieces: t.pieces, last: t.last, nextDue, belowMin: t.free < UNIFORM_RULE.minPerYear, status, siteId: pl?.siteId ?? null, siteName: pl?.siteName ?? null, zone: pl?.zone ?? null, regionId: pl?.regionId ?? null };
      })
      .sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.staffNo.localeCompare(b.staffNo));
    const managed = [...ctx.roles.entries()].filter(([, rs]) => rs.includes('manager')).map(([p]) => p);
    return { rule: UNIFORM_RULE, rows, regions: REGIONS.map((r) => ({ id: r.id, name: r.name })), recordsFor: managed };
  }

  /**
   * Past pieces (Fauzan, 6 Nov 2026): a manager records what guards got before this register, for one guard or in bulk
   * for every active guard of the company at a site, in a zone (state) or in a region. Each guard is checked on its
   * own; one that would go over the free allowance, or already has a past entry that day, is skipped and listed.
   */
  private async uniformPast(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'uniform.past' }>) {
    if (!this.has(ctx, a.companyId, 'manager')) throw new ItemDenied("Only the company's manager records past uniform pieces.");
    const today = dateOf(ctx.at);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.on ?? '') || a.on > today) throw new BadRequest('Give the date the pieces were handed over (not in the future).');
    if (a.on <= addMonthsIso(today, -12)) throw new BadRequest('Pieces older than 12 months no longer count. Nothing to record.');
    const pieces = Number(a.pieces);
    if (!Number.isInteger(pieces) || pieces < 1 || pieces > UNIFORM_RULE.maxPerYear) throw new BadRequest(`Pieces per guard: 1 to ${UNIFORM_RULE.maxPerYear}.`);
    const reason = clip(a.reason, 200);
    if (reason.length < 5) throw new BadRequest('Say where this comes from (for example: store issue book, June 2026).');
    const kinds: UniformScopeKind[] = ['site', 'zone', 'region', 'person'];
    if (!a.scope || !kinds.includes(a.scope.kind) || !a.scope.id) throw new BadRequest('Choose a site, zone, region or one guard.');
    const [people, shifts, sites, branches, records] = await Promise.all([tx.list('people'), tx.list('shifts'), tx.list('sites'), tx.list('branches'), tx.list('uniformRecords')]);
    const guards = people.filter((p) => p.companyId === a.companyId && p.role === 'guard' && p.status === 'active');
    const places = this.guardPlaces(guards, shifts, sites, branches);
    let scope: string;
    let chosen: Person[];
    if (a.scope.kind === 'site') {
      const site = sites.find((s) => s.id === a.scope.id && s.companyId === a.companyId);
      if (!site) throw new BadRequest('That site is not one of this company.');
      scope = `Site ${site.name}`;
      chosen = guards.filter((g) => places.get(g.id)?.siteId === site.id);
    } else if (a.scope.kind === 'zone') {
      scope = `Zone ${a.scope.id}`;
      chosen = guards.filter((g) => places.get(g.id)?.zone === a.scope.id);
    } else if (a.scope.kind === 'region') {
      const r = REGIONS.find((x) => x.id === a.scope.id);
      if (!r) throw new BadRequest('Unknown region.');
      scope = `Region ${r.name}`;
      chosen = guards.filter((g) => places.get(g.id)?.regionId === r.id);
    } else {
      const g = guards.find((x) => x.id === a.scope.id || x.staffNo === a.scope.id.trim().toUpperCase());
      if (!g) throw new BadRequest('No active guard of this company with that staff number.');
      scope = `Guard ${g.staffNo}`;
      chosen = [g];
    }
    if (!chosen.length) throw new BadRequest(`No active guard of this company in ${scope}.`);
    const [events, items, skus] = await Promise.all([tx.list('itemEvents'), tx.list('physicalItems'), tx.list('itemSkus')]);
    const itemOf = new Map(items.map((i) => [i.id, i]));
    const skuOf = new Map(skus.map((x) => [x.id, x]));
    const batchId = this.newId('unib');
    const recorded: Id[] = [];
    const skipped: { personId: Id; staffNo: string; why: string }[] = [];
    let n = records.length;
    // One guard at a time, in a fixed order, so a handover to the same guard at the same moment waits its turn.
    chosen.sort((x, y) => x.id.localeCompare(y.id));
    for (const g of chosen) await tx.lock?.('uniformRecords', g.id);
    const by = this.issuesByPerson(events, await tx.list('uniformRecords'));
    for (const g of chosen) {
      const t = this.tallyFrom(g.id, by.ev(g.id), by.rec(g.id), itemOf, skuOf, today);
      if (t.pastDates.includes(a.on)) skipped.push({ personId: g.id, staffNo: g.staffNo, why: `already has past pieces on ${a.on}` });
      else if (t.free + pieces > UNIFORM_RULE.maxPerYear) skipped.push({ personId: g.id, staffNo: g.staffNo, why: `would have ${t.free + pieces} free pieces, more than ${UNIFORM_RULE.maxPerYear}` });
      else {
        n += 1;
        const row: UniformRecord = { id: this.newId('uni'), kind: 'past', personId: g.id, companyId: a.companyId, on: a.on, pieces, itemId: null, receiptRef: null, amount: null, batchId, scope, reason, by: ctx.user.name, byId: ctx.user.id, at: ctx.at, partyIds: [a.companyId] };
        await tx.insert('uniformRecords', row);
        recorded.push(g.id);
      }
    }
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.companyId, action: 'item.uniform.past', entity: 'uniform_batch', entityId: batchId, summary: `${scope}: ${pieces} past uniform piece(s) on ${a.on} recorded for ${recorded.length} guard(s), ${skipped.length} skipped. Source: ${reason}` });
    return { batchId, scope, recorded: recorded.length, skipped };
  }

  /** After-sale care view: every unit the user's companies own, hold or still look after, with its health and dates. */
  private care(ctx: Ctx, items: PhysicalItem[], skus: ItemSku[], events: ItemEvent[], cases: ItemCase[], today: IsoDate) {
    const skuOf = new Map(skus.map((s) => [s.id, s]));
    const lastCheck = new Map<Id, IsoDateTime>();
    const services = new Map<Id, number>();
    for (const e of events) {
      if (!e.itemId) continue;
      if (CARE_CHECKS.includes(e.kind) && (lastCheck.get(e.itemId) ?? '') < e.at) lastCheck.set(e.itemId, e.at);
      if (e.kind === 'service' || e.kind === 'repair_back') services.set(e.itemId, (services.get(e.itemId) ?? 0) + 1);
    }
    const addMonths = addMonthsIso;
    const plusDays = (d: IsoDate, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    return items
      .filter((i) => !i.componentIds.length && !['disposed'].includes(i.state))
      .filter((i) => ctx.roles.has(i.ownerPartyId) || ctx.roles.has(i.custody.partyId) || (i.historyPartyIds ?? []).some((p) => ctx.roles.has(p)))
      .map((i) => {
        const sku = skuOf.get(i.skuId);
        const last = lastCheck.get(i.id) ?? i.registeredAt;
        const every = sku?.care?.everyDays ?? null;
        const life = sku?.care?.lifeMonths ?? null;
        const nextDue = every ? plusDays(dateOf(last), every) : null;
        const lifeEnds = life ? addMonths(dateOf(i.registeredAt), life) : null;
        const openCases = cases.filter((c) => c.itemId === i.id && c.status === 'open');
        const status =
          lifeEnds && lifeEnds <= today
            ? 'end_of_life'
            : nextDue && nextDue < today
              ? 'overdue'
              : nextDue && nextDue <= plusDays(today, DUE_SOON_DAYS)
                ? 'due_soon'
                : !every && !life
                  ? 'not_set'
                  : 'ok';
        return {
          itemId: i.id,
          token: i.token,
          skuId: i.skuId,
          ownerPartyId: i.ownerPartyId,
          holderPartyId: i.custody.partyId,
          seller: this.sellerOf(i),
          condition: i.condition,
          state: i.state,
          lastCheck: last,
          nextDue,
          lifeEnds,
          ageMonths: Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dateOf(i.registeredAt)}T00:00:00Z`)) / (30.44 * 86_400_000))),
          services: services.get(i.id) ?? 0,
          openServiceRequest: openCases.find((c) => c.kind === 'service')?.ref ?? null,
          openCases: openCases.length,
          status: status as 'end_of_life' | 'overdue' | 'due_soon' | 'not_set' | 'ok',
        };
      });
  }

  // ----- Sale papers: invoice, payment slip, letter of acknowledgement -----

  /** The paper of each kind that counts now: the latest one recorded. */
  private currentPapers(m: ItemMovement): Map<SalePaperKind, SalePaper> {
    const out = new Map<SalePaperKind, SalePaper>();
    for (const p of m.papers ?? []) out.set(p.kind, p);
    return out;
  }

  /** What still stops ownership passing on a sale (Fauzan, 6 Nov 2026). */
  papersMissing(m: ItemMovement): string[] {
    const cur = this.currentPapers(m);
    const out: string[] = [];
    if (!m.lines.some((l) => l.result === 'received') && !m.lotLines.some((l) => (l.qtyReceived ?? 0) > 0)) out.push('receipt of the goods');
    for (const k of ['invoice', 'payment_slip', 'acknowledgement'] as SalePaperKind[]) if (!cur.get(k)) out.push(SALE_PAPER_LABEL[k].toLowerCase());
    const ack = cur.get('acknowledgement');
    if (ack?.letter && ack.letter.received !== m.lines.filter((l) => l.result === 'received').length)
      out.push('a new letter of acknowledgement (the receipt changed after it was signed)');
    return out;
  }

  private paperDoc(ctx: Ctx, m: ItemMovement, kind: SalePaperKind, doc: { name?: unknown; data?: unknown } | null | undefined): ItemDoc | null {
    if (!doc) return null;
    const data = String(doc.data ?? '');
    const mm = /^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.exec(data);
    if (!mm) throw new BadRequest('Attach the paper as a PDF, JPEG or PNG file.');
    const bytes = Math.floor(((data.length - data.indexOf(',') - 1) * 3) / 4);
    if (bytes > PAPER_MAX_BYTES) throw new BadRequest('The paper is too large. Scan it smaller (under 2 MB).');
    if (!magicOk(mm[1], data)) throw new BadRequest('The file is not what it says it is: attach a real PDF, JPEG or PNG.');
    const sha256 = sha256Hex(data);
    return {
      id: `idoc-${sha256.slice(0, 20)}`,
      movementId: m.id,
      kind,
      name: clip(doc.name, 120) || SALE_PAPER_LABEL[kind],
      mime: mm[1] as ItemDoc['mime'],
      bytes,
      sha256,
      data,
      uploadedBy: ctx.user.name,
      at: ctx.at,
      partyIds: uniq([m.fromPartyId, m.toPartyId]),
    };
  }

  private async addPaper(tx: Store, ctx: Ctx, m: ItemMovement, p: Omit<SalePaper, 'by' | 'byId' | 'at' | 'docId'>, doc: ItemDoc | null) {
    const ref = clip(p.ref, 80);
    if (ref.length < 2) throw new BadRequest('Type the reference printed on the paper (invoice number, payment reference or letter reference).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '') || p.date > dateOf(ctx.at)) throw new BadRequest('Give the date on the paper (not in the future).');
    const before = this.currentPapers(m).get(p.kind);
    const reason = clip(p.reason, 200);
    if (before && reason.length < 5) throw new BadRequest(`A ${SALE_PAPER_LABEL[p.kind].toLowerCase()} is already recorded. Say why it is replaced.`);
    if (doc) {
      const dup = await tx.get('itemDocs', doc.id);
      if (dup) throw new BadRequest(`This file was already given as ${dup.kind in SALE_PAPER_LABEL ? SALE_PAPER_LABEL[dup.kind as SalePaperKind].toLowerCase() : "evidence"} on another record.`);
      await tx.insert('itemDocs', doc);
    }
    const row: SalePaper = { ...p, ref, reason, docId: doc?.id ?? null, by: ctx.user.name, byId: ctx.user.id, at: ctx.at };
    const out = await tx.update('itemMovements', m.id, { papers: [...(m.papers ?? []), row], version: m.version + 1 });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: p.partyId, action: `item.paper.${p.kind}`, entity: 'item_movement', entityId: m.id, summary: `${m.ref}: ${SALE_PAPER_LABEL[p.kind]} ${ref} dated ${p.date}${before ? ` replaces ${before.ref} (${reason})` : ''}.` });
    return out;
  }

  private async saleFor(tx: Store, ctx: Ctx, movementId: Id) {
    await tx.lock?.('itemMovements', movementId);
    const m = await tx.get('itemMovements', movementId);
    if (!m || !(await this.seesMove(ctx, m))) throw new NotFound('Movement');
    if (m.type !== 'sale') throw new BadRequest('Sale papers belong to a sale. A rental, loan or transfer never changes the owner.');
    if (m.ownership) throw new BadRequest('Ownership has already passed on this sale; the papers are closed.');
    if (m.status === 'draft' || m.status === 'cancelled') throw new BadRequest('The goods have not been sent yet.');
    return m;
  }

  /** The seller's Finance attaches the invoice; the buyer's Finance attaches the payment slip. Both as scanned papers. */
  private async movePaper(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.paper' }>) {
    const m = await this.saleFor(tx, ctx, a.movementId);
    if (a.paper !== 'invoice' && a.paper !== 'payment_slip') throw new BadRequest('Choose the invoice or the payment slip.');
    const partyId = a.paper === 'invoice' ? m.fromPartyId : m.toPartyId;
    if (!this.has(ctx, partyId, 'finance'))
      throw new ItemDenied(a.paper === 'invoice' ? "Only the seller's Finance attaches the invoice." : "Only the buyer's Finance attaches the payment slip.");
    if (a.paper === 'payment_slip' && !this.currentPapers(m).get('invoice')) throw new BadRequest('Attach the payment slip after the invoice is recorded.');
    if (!a.doc) throw new BadRequest('Attach the scanned paper (PDF or photo).');
    const doc = this.paperDoc(ctx, m, a.paper, a.doc);
    return this.addPaper(tx, ctx, m, { kind: a.paper, ref: a.ref, date: a.date, partyId, reason: a.reason ?? '', letter: null }, doc);
  }

  /**
   * The buyer's manager signs the letter of acknowledgement of the items received. The letter is made from the receipt
   * as it stands (received, damaged, missing, wrong item), so it can only acknowledge what was actually checked in. A
   * signed paper copy can be attached. The person who checked the goods in does not also sign the letter.
   */
  private async moveAcknowledge(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.acknowledge' }>) {
    const m = await this.saleFor(tx, ctx, a.movementId);
    if (!this.has(ctx, m.toPartyId, 'manager')) throw new ItemDenied("Only the buying company's manager signs the letter of acknowledgement.");
    if (m.lines.some((l) => l.result === 'pending') || m.lotLines.some((l) => l.qtyReceived == null))
      throw new BadRequest('Check every item first (received, damaged, missing or wrong item). The letter acknowledges the finished receipt.');
    if (m.receipts.some((r) => r.byId === ctx.user.id)) throw new ItemDenied('The person who checked the goods in does not also sign the letter.');
    const signedBy = clip(a.signedBy, 120);
    if (signedBy.length < 3) throw new BadRequest('Type the name and position of the person signing.');
    const count = (r: string) => m.lines.filter((l) => l.result === r).length;
    const lots = m.lotLines.filter((l) => (l.qtyReceived ?? 0) > 0).map((l) => ({ skuId: l.skuId, qty: l.qtyReceived! }));
    const letter = {
      received: count('received'),
      damaged: count('damaged'),
      missing: count('missing'),
      wrongItem: count('wrong_item'),
      lots,
      text:
        `${this.partyName(ctx, m.toPartyId)} acknowledges receipt from ${this.partyName(ctx, m.fromPartyId)} under ${m.ref}` +
        `${m.commercialRef ? ` (${m.commercialRef})` : ''}: ${count('received')} unit(s) received in good order` +
        `${lots.length ? ` and ${lots.map((l) => l.qty).reduce((x, y) => x + y, 0)} bulk unit(s)` : ''}` +
        `${count('damaged') ? `; ${count('damaged')} damaged` : ''}${count('missing') ? `; ${count('missing')} missing` : ''}` +
        `${count('wrong_item') ? `; ${count('wrong_item')} wrong item` : ''}. Damaged, missing and wrong items are not acknowledged and stay with their cases. ` +
        `Signed by ${signedBy}.`,
    };
    const doc = this.paperDoc(ctx, m, 'acknowledgement', a.doc ?? null);
    return this.addPaper(tx, ctx, m, { kind: 'acknowledgement', ref: a.ref, date: a.date, partyId: m.toPartyId, reason: a.reason ?? '', letter }, doc);
  }

  /** A scanned sale paper, for either side of the sale. */
  async paperDocument(user: User, docId: Id) {
    const ctx = await this.ctx(user);
    const d = await this.store.get('itemDocs', docId);
    if (!d || !this.visibleTo(ctx, d.partyIds)) throw new NotFound('Paper');
    return { id: d.id, name: d.name, mime: d.mime, data: d.data, kind: d.kind, uploadedBy: d.uploadedBy, at: d.at };
  }

  /** Legal ownership passes only when Finance records it under the sale terms, separate from the physical receipt. */
  private async moveOwnership(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.ownership' }>) {
    await tx.lock?.('itemMovements', a.movementId);
    const m = await tx.get('itemMovements', a.movementId);
    if (!m || !(await this.seesMove(ctx, m))) throw new NotFound('Movement');
    if (m.type !== 'sale' && m.type !== 'supplier_return') throw new BadRequest('Ownership never changes on a rental, loan or transfer.');
    if (!this.has(ctx, m.fromPartyId, 'finance') && !this.has(ctx, m.toPartyId, 'finance')) throw new ItemDenied('Only Finance records when ownership passes.');
    if (m.ownership) throw new BadRequest('Ownership is already recorded for this movement.');
    if (m.receipts.some((r) => r.byId === ctx.user.id)) throw new ItemDenied('The person who received the goods does not also record the ownership.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.effectiveOn ?? '') || a.effectiveOn > dateOf(ctx.at)) throw new BadRequest('Give the date ownership passed (not in the future).');
    const basis = clip(a.basis, 200);
    if (basis.length < 5) throw new BadRequest('Name the sale terms or contract clause.');
    const ids = m.lines.filter((l) => l.result === 'received').map((l) => l.itemId);
    if (!ids.length && !m.lotLines.some((l) => (l.qtyReceived ?? 0) > 0)) throw new BadRequest('Nothing has been received yet on this movement.');
    if (m.type === 'sale') {
      const missing = this.papersMissing(m);
      if (missing.length) throw new BadRequest(`Ownership passes only with every sale paper. Still missing: ${missing.join('; ')}.`);
      const latest = [...this.currentPapers(m).values()].map((p) => p.date).sort().pop()!;
      if (a.effectiveOn < latest) throw new BadRequest(`Ownership cannot pass before the last paper is dated (${latest}).`);
    }
    const newOwner = m.toPartyId;
    for (const id of ids) {
      const item = await this.lockItem(tx, (await tx.get('physicalItems', id))!);
      if (item.ownerPartyId === newOwner) continue;
      const before = item.ownerPartyId;
      // The buyer owns it from now on; seller and buyer both follow its whole life (read only for the seller).
      const historyPartyIds = uniq([...(item.historyPartyIds ?? []), before, newOwner]);
      await this.setItem(tx, item, { ownerPartyId: newOwner, historyPartyIds, partyIds: uniq([newOwner, item.custody.partyId, ...historyPartyIds]) });
      await this.event(tx, ctx, { kind: 'ownership', itemId: id, lotId: null, qty: 1, from: null, to: null, ownerFrom: before, ownerTo: newOwner, movementId: m.id, caseId: null, note: `From ${a.effectiveOn}: ${basis}`, partyIds: m.partyIds });
    }
    for (const l of m.lotLines.filter((x) => (x.qtyReceived ?? 0) > 0)) {
      // Older merged receipts have no provable allocation: fail closed rather than guess.
      if (!l.receivedLotId) throw new BadRequest('This receipt needs a verified lot allocation before ownership can pass.');
      await tx.lock?.('itemLots', l.receivedLotId);
      const lot = await tx.get('itemLots', l.receivedLotId);
      if (!lot || lot.skuId !== l.skuId || lot.ownerPartyId !== m.fromPartyId || lot.custody.partyId !== m.toPartyId || lot.qty !== l.qtyReceived)
        throw new BadRequest('The received stock allocation has changed. Reconcile it before ownership passes.');
      await tx.update('itemLots', lot.id, { ownerPartyId: newOwner, partyIds: uniq([...lot.partyIds, newOwner]), version: lot.version + 1 });
    }
    const out = await tx.update('itemMovements', m.id, { ownership: { by: ctx.user.name, byId: ctx.user.id, at: ctx.at, effectiveOn: a.effectiveOn, basis, itemIds: ids }, version: m.version + 1 });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: newOwner, action: 'item.ownership', entity: 'item_movement', entityId: m.id, summary: `${m.ref}: ownership of ${ids.length} units passes to ${this.partyName(ctx, newOwner)} from ${a.effectiveOn} (${basis}).` });
    return out;
  }

  // ----- Handover to people and sites -----

  private async issue(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'issue' }>) {
    let item = (await this.byScan(tx, ctx, a, 'issue')).item;
    const sku = await tx.get('itemSkus', item.skuId);
    const holder = item.custody.partyId;
    let to: Custody;
    if (a.personId) {
      const p = await this.person(tx, a.personId);
      if (p.companyId !== holder) throw new BadRequest('Hand over only to staff of the company that holds the item. Between companies use a movement.');
      to = { kind: 'person', partyId: holder, ref: p.id, label: p.name, since: ctx.at };
    } else if (a.siteId) {
      const s = await this.site(tx, a.siteId);
      if (s.companyId !== holder) throw new BadRequest('That site belongs to another company. Between companies use a movement.');
      to = { kind: 'site', partyId: holder, ref: s.id, label: s.name, since: ctx.at };
    } else throw new BadRequest('Say who or which site gets it.');
    // A supervisor hands over what is at their own site or in their own hands, to their own site or a person of the company.
    const opsFrom = item.custody.kind === 'site' ? this.opsMay(ctx, holder, item.custody.ref) : item.custody.kind === 'person' && item.custody.ref === ctx.user.personId && this.has(ctx, holder, 'ops');
    const opsTo = to.kind === 'site' ? this.opsMay(ctx, holder, to.ref) : this.has(ctx, holder, 'ops');
    const may = this.canHandle(ctx, holder, sku) || (opsFrom && opsTo);
    if (!may) throw new ItemDenied('Only the store, or the supervisor of that site, hands this item over.');
    item = await this.lockItem(tx, item, a.expectedVersion);
    if (item.kitId) throw new BadRequest('This unit is part of a set: hand over the set.');
    if (NOT_MOVABLE.includes(item.state)) throw new BadRequest(`It cannot be handed over: ${item.state.replace('_', ' ')}.`);
    if (item.condition === 'damaged') throw new BadRequest('A damaged item is not issued again. Send it for repair or ask to dispose of it.');
    if (item.custody.kind === 'person' && item.pendingAck) throw new BadRequest('The current holder has not confirmed it yet.');
    if (item.custody.kind === to.kind && item.custody.ref === to.ref) throw new BadRequest('They already hold it.');
    // Uniform allowance (Fauzan, 6 Nov 2026): 3 free pieces in 12 months, usually one every 6 months; a 4th or 5th is paid by the guard.
    let uniformNote = '';
    let paidRecord: UniformRecord | null = null;
    if (to.kind === 'person' && sku?.category === 'uniform') {
      const today = dateOf(ctx.at);
      // Two handovers to the same guard at once go one after the other, so neither slips past the count.
      await tx.lock?.('uniformRecords', to.ref);
      const t = await this.uniformTally(tx, to.ref, today);
      const R = UNIFORM_RULE;
      if (t.countedItemIds.has(item.id)) {
        if (a.paidByGuard) throw new BadRequest('This garment was already counted for this person. Do not record another payment.');
        uniformNote = ' Previously counted garment returned to the same person.';
      } else if (t.free >= R.maxPerYear) {
        if (t.free + t.paid >= R.paidMaxPerYear)
          throw new BadRequest(`${to.label} already had ${t.free + t.paid} uniform pieces in the last 12 months (${t.paid} paid by the guard). The most is ${R.paidMaxPerYear}.`);
        const pay = a.paidByGuard;
        const ref = clip(pay?.receiptRef ?? '', 60);
        // Money as whole sen, never a floating-point number (paper section 6).
        const sen = pay?.amountSen != null ? (/^\d{1,9}$/.test(String(pay.amountSen)) ? BigInt(String(pay.amountSen)).toString() : null) : senFromText(pay?.amount);
        if (!pay || ref.length < 2 || sen == null || BigInt(sen) <= 0n || BigInt(sen) > 1_000_000n)
          throw new BadRequest(`${to.label} already had ${t.free} free uniform pieces in the last 12 months. The most is ${R.maxPerYear} a year. A ${t.free + t.paid === 3 ? '4th' : '5th'} piece is paid by the guard: enter the receipt number and the amount on it.`);
        paidRecord = { id: this.newId('uni'), kind: 'paid', personId: to.ref, companyId: holder, on: today, pieces: 1, itemId: item.id, receiptRef: ref, amount: null, amountSen: sen, batchId: null, scope: null, reason: 'Paid by the guard', by: ctx.user.name, byId: ctx.user.id, at: ctx.at, partyIds: [holder] };
        uniformNote = ` Piece ${t.free + t.paid + 1} in 12 months, paid by the guard: receipt ${ref}, ${senLabel(sen)}. Not taken from pay.`;
      } else {
        if (a.paidByGuard) throw new BadRequest(`${to.label} still has free uniform pieces this year (${t.free} of ${R.maxPerYear} used). The company pays for this one.`);
        const next = t.last ? addMonthsIso(t.last, R.everyMonths) : null;
        const why = clip(a.reason ?? '', 200);
        if (next && today < next && why.length < 5)
          throw new BadRequest(`${to.label} last received a uniform piece on ${t.last}. The next one is usually from ${next}. Give a reason to hand one over early.`);
        uniformNote = ` Uniform piece ${t.free + 1} of ${R.maxPerYear} free in 12 months${next && today < next ? `, early (usual from ${next}): ${why}` : ''}.`;
      }
    }
    const units: PhysicalItem[] = [item];
    for (const id of [...item.componentIds].sort()) {
      const part = await tx.get('physicalItems', id);
      if (!part) throw new BadRequest('A required set component is missing.');
      const fresh = await this.lockItem(tx, part);
      if (fresh.kitId !== item.id || NOT_MOVABLE.includes(fresh.state) || fresh.condition === 'damaged' || fresh.pendingAck ||
          fresh.custody.kind !== item.custody.kind || fresh.custody.ref !== item.custody.ref || fresh.custody.partyId !== holder)
        throw new BadRequest('Every set component must be received, checked and held together before handover.');
      units.push(fresh);
    }
    for (const fresh of units) {
      const u = fresh;
      await this.setItem(tx, fresh, { custody: to, state: to.kind === 'person' ? 'with_person' : 'at_site', pendingAck: to.kind === 'person' ? { personId: to.ref, since: ctx.at } : null });
      await this.event(tx, ctx, { kind: 'issue', itemId: u.id, lotId: null, qty: 1, from: u.custody, to, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: to.kind === 'person' ? 'Waiting for the person to confirm in their own sign-in' : `Placed at ${to.label}`, partyIds: u.partyIds });
    }
    if (paidRecord) await tx.insert('uniformRecords', paidRecord);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: holder, action: 'item.issue', entity: 'item', entityId: item.id, summary: `${labelDisplay(item.token)} (${sku?.code ?? ''}) handed to ${to.label}.${paidRecord ? '' : ' Never charged to them.'}${uniformNote}` });
    return (await tx.get('physicalItems', item.id))!;
  }

  /** Only the person holding it confirms, in their own sign-in. Nobody confirms for someone else. */
  private async confirm(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'confirm' }>) {
    let item = (await this.byScan(tx, ctx, a, 'confirm')).item;
    if (!ctx.user.personId || item.pendingAck?.personId !== ctx.user.personId) throw new ItemDenied('Only the person it was handed to confirms it, in their own sign-in.');
    item = await this.lockItem(tx, item);
    const units = [item, ...(await Promise.all(item.componentIds.map((c) => tx.get('physicalItems', c)))).filter((x): x is PhysicalItem => !!x)];
    for (const u of units) {
      await this.setItem(tx, u.id === item.id ? item : await this.lockItem(tx, u), { pendingAck: null });
      await this.event(tx, ctx, { kind: 'confirm', itemId: u.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: 'Receipt confirmed by the holder', partyIds: u.partyIds });
    }
    return (await tx.get('physicalItems', item.id))!;
  }

  // ----- Shared site device: the guard confirms with their face -----

  /**
   * On the post's shared device the guard types their staff number, looks at the camera and scans the item handed to
   * them (Fauzan, 6 Nov 2026). Only a face that matches the guard the item was handed to confirms it: another guard
   * cannot claim it, and a failed face check leaves the item waiting for the supervisor. Nothing is shown before the
   * face check passes.
   */
  private async deviceGuard(store: Store, user: User, staffNo: string, face: FaceCapture | null): Promise<{ person: Person; site: Site }> {
    if (user.role !== 'site_device' || user.siteIds.length !== 1) throw new ItemDenied('This works only on the shared device of one post.');
    const site = await store.get('sites', user.siteIds[0]);
    if (!site) throw new ItemDenied('This device is not linked to a post.');
    const no = clip(staffNo, 30).toUpperCase();
    if (!no) throw new BadRequest('Type your staff number and look at the camera.');
    const [person] = await store.list('people', { companyId: site.companyId, staffNo: no });
    // Only a well-formed face result counts; anything else is treated as no picture.
    const capture = face && typeof face === 'object' && typeof face.score === 'number' && Number.isFinite(face.score) && face.live === true ? { score: face.score, live: true } : face && typeof face === 'object' && (face as FaceCapture).live === false ? { score: 0, live: false } : null;
    const flags = evaluateFace(capture, !!person?.faceEnrolledOn);
    // One answer for an unknown number, a person who has left and a face that does not match.
    if (!person || person.status !== 'active' || flags.length)
      throw new ItemDenied(
        flags.includes('NO_FACE_ENROLMENT') && person
          ? 'Your face is not enrolled yet, so the device cannot confirm for you. Ask your supervisor; the item stays waiting.'
          : 'Face not confirmed for this staff number. Try again in good light, or ask your supervisor. The item stays waiting.',
      );
    return { person, site };
  }

  /** What is waiting for this guard to confirm, shown only after their face is checked. */
  async devicePending(user: User, staffNo: string, face: FaceCapture | null) {
    const { person, site } = await this.deviceGuard(this.store, user, staffNo, face);
    const skus = new Map((await this.store.list('itemSkus')).map((k) => [k.id, k]));
    const waiting = (await this.store.list('physicalItems')).filter((i) => i.pendingAck?.personId === person.id && !i.kitId);
    return {
      staffNo: person.staffNo,
      firstName: person.name.split(' ')[0],
      site: site.name,
      waiting: waiting.map((i) => ({ label: labelDisplay(i.token), sku: skus.get(i.skuId)?.name ?? 'Item', since: i.pendingAck!.since })),
    };
  }

  private async deviceConfirm(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'device.confirm' }>) {
    const { person, site } = await this.deviceGuard(tx, ctx.user, a.staffNo, a.face);
    const found = await this.scanned(tx, a.label);
    // Same answer whether the label is unknown, someone else's or already confirmed: nothing about another guard leaks.
    if (!found || found.pendingAck?.personId !== person.id) throw new ItemDenied('This item is not waiting for you. Only the guard it was handed to can confirm it.');
    let item = await this.lockItem(tx, found.kitId ? (await tx.get('physicalItems', found.kitId))! : found);
    if (item.pendingAck?.personId !== person.id) throw new ItemDenied('This item is not waiting for you. Only the guard it was handed to can confirm it.');
    const units = [item, ...(await Promise.all(item.componentIds.map((c) => tx.get('physicalItems', c)))).filter((x): x is PhysicalItem => !!x)];
    for (const u of units) {
      await this.setItem(tx, u.id === item.id ? item : await this.lockItem(tx, u), { pendingAck: null });
      await this.event(tx, ctx, { kind: 'confirm', itemId: u.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Receipt confirmed by ${person.staffNo} with face check on the shared device at ${site.name}`, partyIds: u.partyIds });
    }
    await tx.audit({ at: ctx.at, actor: `${person.name} (${person.staffNo}) on ${ctx.user.name}`, companyId: site.companyId, action: 'item.confirm.device', entity: 'item', entityId: item.id, summary: `${labelDisplay(item.token)} receipt confirmed with face check at ${site.name}.` });
    item = (await tx.get('physicalItems', item.id))!;
    return { label: labelDisplay(item.token), confirmed: true };
  }

  private async dispute(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'dispute' }>) {
    const item = await this.byLabel(ctx, a.label);
    if (!ctx.user.personId || item.pendingAck?.personId !== ctx.user.personId) throw new ItemDenied('Only the person it was handed to can say they did not get it.');
    const note = clip(a.note, 300);
    if (note.length < 3) throw new BadRequest('Say what is wrong (not received, wrong size, damaged).');
    await this.event(tx, ctx, { kind: 'dispute', itemId: item.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note, partyIds: item.partyIds });
    return this.openCase(tx, ctx, { kind: 'dispute', itemId: item.id, partyId: item.custody.partyId, note: `${labelDisplay(item.token)}: ${note}`, partyIds: item.partyIds });
  }

  /** Back into the holding company's store. The owner never changes on a return (a guard returning a Sasa-bought item stays Sasa's). */
  private async giveBack(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'return' }>) {
    let item = (await this.byScan(tx, ctx, a, 'return')).item;
    const sku = await tx.get('itemSkus', item.skuId);
    const holder = item.custody.partyId;
    const fromSite = item.custody.kind === 'site' ? item.custody.ref : null;
    if (!this.canHandle(ctx, holder, sku) && !(this.opsMay(ctx, holder, fromSite) && item.custody.kind === 'site')) throw new ItemDenied('Only the store (or the site supervisor for site items) takes items back.');
    if (item.kitId) throw new BadRequest('This unit is part of a set: take back the set.');
    if (item.custody.kind !== 'person' && item.custody.kind !== 'site') throw new BadRequest('It is not with a person or at a site.');
    if (!['good', 'worn', 'damaged'].includes(a.condition)) throw new BadRequest('Choose the condition.');
    const note = clip(a.note, 300);
    if (a.condition === 'damaged' && note.length < 3) throw new BadRequest('Say what is damaged.');
    item = await this.lockItem(tx, item);
    const to = this.storeOf(ctx, holder, ctx.at);
    const units = [item, ...(await Promise.all(item.componentIds.map((c) => tx.get('physicalItems', c)))).filter((x): x is PhysicalItem => !!x)];
    for (const u of units) {
      const fresh = u.id === item.id ? item : await this.lockItem(tx, u);
      await this.setItem(tx, fresh, { custody: to, state: 'quarantine', condition: a.condition, pendingAck: null });
      await this.event(tx, ctx, { kind: 'return', itemId: u.id, lotId: null, qty: 1, from: u.custody, to, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `${a.condition}${note ? `: ${note}` : ''}. Checked before it is issued again.`, partyIds: u.partyIds });
    }
    if (a.condition === 'damaged') await this.openCase(tx, ctx, { kind: 'damaged', itemId: item.id, partyId: holder, note, partyIds: item.partyIds });
    return (await tx.get('physicalItems', item.id))!;
  }

  private async reportMissing(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'report.missing' }>) {
    let item = await this.byLabel(ctx, a.label);
    const holder = item.custody.partyId;
    const sku = await tx.get('itemSkus', item.skuId);
    const own = ctx.user.personId && item.custody.kind === 'person' && item.custody.ref === ctx.user.personId;
    if (!own && !this.canHandle(ctx, holder, sku) && !this.has(ctx, holder, 'ops')) throw new ItemDenied('Only the holder, the store or operations reports an item missing.');
    const note = clip(a.note, 300);
    if (note.length < 5) throw new BadRequest('Say when and where it was last seen.');
    item = await this.lockItem(tx, item);
    if (['missing', 'lost', 'disposed'].includes(item.state)) throw new BadRequest('It is already reported.');
    await this.setItem(tx, item, { state: 'missing' });
    await this.event(tx, ctx, { kind: 'report_missing', itemId: item.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note, partyIds: item.partyIds });
    return this.openCase(tx, ctx, { kind: 'missing', itemId: item.id, partyId: holder, note: `${labelDisplay(item.token)}: ${note}. No pay deduction is made automatically.`, partyIds: item.partyIds });
  }

  private async repairOut(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'repair.out' }>) {
    let item = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store sends items for repair.');
    item = await this.lockItem(tx, item);
    if (item.state !== 'quarantine' && item.state !== 'available') throw new BadRequest('Take it back into the store first.');
    const repairer = clip(a.repairer, 120);
    if (repairer.length < 2) throw new BadRequest('Name the repairer.');
    const to: Custody = { kind: 'repairer', partyId: item.custody.partyId, ref: repairer, label: `Repair: ${repairer}`, since: ctx.at };
    await this.setItem(tx, item, { state: 'repair', custody: to });
    await this.event(tx, ctx, { kind: 'repair_out', itemId: item.id, lotId: null, qty: 1, from: item.custody, to, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: clip(a.note, 300), partyIds: item.partyIds });
    return (await tx.get('physicalItems', item.id))!;
  }

  private async repairBack(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'repair.back' }>) {
    let item = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store takes items back from repair.');
    item = await this.lockItem(tx, item);
    if (item.state !== 'repair') throw new BadRequest('It is not at repair.');
    const to = this.storeOf(ctx, item.custody.partyId, ctx.at);
    await this.setItem(tx, item, { state: 'quarantine', custody: to, condition: 'unknown' });
    await this.event(tx, ctx, { kind: 'repair_back', itemId: item.id, lotId: null, qty: 1, from: item.custody, to, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `${clip(a.note, 300)} To be checked before issue.`, partyIds: item.partyIds });
    return (await tx.get('physicalItems', item.id))!;
  }

  private async disposeAsk(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'dispose.ask' }>) {
    const item = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store asks to dispose of an item.');
    if (item.state !== 'quarantine') throw new BadRequest('Only items taken back and checked (quarantine) can be put up for disposal.');
    if (item.ownerPartyId !== item.custody.partyId) throw new BadRequest('It belongs to another company: return it to the owner instead.');
    const reason = clip(a.reason, 300);
    if (reason.length < 5) throw new BadRequest('Say why it cannot be used or repaired.');
    if ((await tx.list('itemCases', { itemId: item.id, kind: 'dispose', status: 'open' })).length) throw new BadRequest('A disposal request is already open.');
    return this.openCase(tx, ctx, { kind: 'dispose', itemId: item.id, partyId: item.ownerPartyId, note: `${labelDisplay(item.token)}: ${reason}`, partyIds: item.partyIds });
  }

  /** A site check records what was seen. It never moves stock, changes the owner or bills anyone. */
  private async observe(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'observe' }>) {
    const item = (await this.byScan(tx, ctx, a, 'observe')).item;
    const site = await this.site(tx, a.siteId);
    if (!this.opsMay(ctx, site.companyId, site.id) && !this.has(ctx, site.companyId, 'store', 'manager')) throw new ItemDenied('Check items only at your own sites.');
    const serialSeen = clip(a.serialSeen, 60);
    const where: Custody = { kind: 'site', partyId: site.companyId, ref: site.id, label: site.name, since: ctx.at };
    await this.event(tx, ctx, { kind: 'observe', itemId: item.id, lotId: null, qty: null, from: null, to: where, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Seen at ${site.name}${serialSeen ? `, serial ${serialSeen}` : ''}. ${clip(a.note, 200)}`.trim(), partyIds: item.partyIds });
    const expectedHere = item.custody.kind === 'site' && item.custody.ref === site.id;
    const withSitePerson = item.custody.kind === 'person' && item.custody.partyId === site.companyId;
    let opened: ItemCase | null = null;
    if (item.serial && serialSeen && serialSeen.toUpperCase() !== item.serial.toUpperCase())
      opened = await this.openCase(tx, ctx, { kind: 'label_mismatch', itemId: item.id, partyId: item.custody.partyId, note: `${labelDisplay(item.token)} scanned on an object with serial ${serialSeen}; recorded serial differs. Label may be on the wrong object.`, partyIds: item.partyIds });
    else if (!expectedHere && !withSitePerson)
      opened = await this.openCase(tx, ctx, { kind: 'wrong_place', itemId: item.id, partyId: item.custody.partyId, note: `${labelDisplay(item.token)} seen at ${site.name}, recorded as ${this.stateText(ctx, item)}.`, partyIds: uniq([...item.partyIds, site.companyId]) });
    return { expectedHere: expectedHere || withSitePerson, case: opened };
  }

  // ----- Cases -----

  private async caseResolve(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'case.resolve' }>) {
    await tx.lock?.('itemCases', a.caseId);
    const c = await tx.get('itemCases', a.caseId);
    const cItem = c?.itemId ? await tx.get('physicalItems', c.itemId) : undefined;
    if (!c || !this.seesCaseIn(ctx, await this.scopeOf(ctx), c, new Map(cItem ? [[cItem.id, cItem] as const] : []))) throw new NotFound('Case');
    if (c.status !== 'open') throw new BadRequest('This case is already closed.');
    const rule = CASE_OUTCOMES[c.kind];
    if (!rule.outcomes.includes(a.outcome)) throw new BadRequest(`Choose: ${rule.outcomes.join(', ').replace(/_/g, ' ')}.`);
    const note = clip(a.note, 300);
    if (note.length < 3) throw new BadRequest('Give the reason and the proof you checked.');
    const needsManager = rule.manager.includes(a.outcome);
    if (needsManager) {
      if (!this.has(ctx, c.partyId, 'manager')) throw new ItemDenied('A manager of that company decides this.');
      if (c.openedById === ctx.user.id) throw new ItemDenied('The person who opened the case does not decide it.');
    } else if (FINANCE_CASES.includes(c.kind) ? !this.has(ctx, c.partyId, 'finance') : !this.has(ctx, c.partyId, 'store', 'manager', 'ops', 'it') && !(c.kind === 'short' && c.movementId))
      throw new ItemDenied(FINANCE_CASES.includes(c.kind) ? 'Only that company’s Finance closes this case.' : 'Only that company’s store, operations or manager closes this case.');
    // Closing a shortage as arrived or found needs the item's label scanned, never a typed ID (paper section 10).
    if (SHORTAGE_CLOSE[c.kind] === a.outcome && c.itemId) {
      if (!a.scan) throw new BadRequest('Scan the item’s label to show it is here. A typed ID cannot close a shortage.');
      const e = readEntry(a.scan);
      if (!e.ok) throw new BadRequest(e.message);
      if (e.entry.source === 'typed' || e.entry.source === 'list') throw new BadRequest('Scan the item’s label with the camera or scanner. A typed ID cannot close a shortage.');
      const got = await this.scanItem(tx, ctx, e.entry, 'view');
      if (got.item.id !== c.itemId) throw new BadRequest('That label is not the item of this case.');
    }
    const item = c.itemId ? await this.lockItem(tx, (await tx.get('physicalItems', c.itemId))!) : null;
    const ev = (kind: ItemEventKind, n: string, to: Custody | null = null) =>
      this.event(tx, ctx, { kind, itemId: item?.id ?? null, lotId: c.lotId, qty: 1, from: null, to, ownerFrom: null, ownerTo: null, movementId: c.movementId, caseId: c.id, note: n, partyIds: c.partyIds });
    if (item) {
      if ((c.kind === 'short' && a.outcome === 'arrived') || (c.kind === 'missing' && a.outcome === 'found') || (c.kind === 'count_not_found' && a.outcome === 'found')) {
        if (c.kind === 'short' && c.movementId) {
          const m = (await tx.get('itemMovements', c.movementId))!;
          if (!this.has(ctx, m.toPartyId, 'store', 'manager')) throw new ItemDenied('The receiving store confirms a late arrival.');
          const q = this.storeOf(ctx, m.toPartyId, ctx.at);
          await this.setItem(tx, item, { state: 'quarantine', custody: { ...q, label: `${q.label} (quarantine)` } });
          const lines = m.lines.map((l) => (l.itemId === item.id ? { ...l, result: 'received' as const, by: ctx.user.name, at: ctx.at, note } : l));
          const open = lines.some((l) => l.result === 'pending' || l.result === 'missing') || m.lotLines.some((l) => l.qtyReceived == null);
          await tx.update('itemMovements', m.id, { lines, status: open ? 'partly_received' : 'received', version: m.version + 1 });
          await ev('receive', `Arrived late on ${m.ref}: ${note}`, q);
        } else {
          const q = this.storeOf(ctx, item.custody.partyId, ctx.at);
          await this.setItem(tx, item, { state: 'quarantine', custody: q });
          await ev('found', note, q);
        }
      } else if ((c.kind === 'short' && a.outcome === 'lost') || (c.kind === 'missing' && a.outcome === 'confirmed_lost')) {
        await this.setItem(tx, item, { state: 'lost', writeOff: 'finance_to_decide', pendingAck: null });
        await ev('lost', `${note}. Write-off for Finance to decide under the approved policy. No automatic pay deduction.`);
      } else if (c.kind === 'damaged' && a.outcome === 'usable') {
        await this.setItem(tx, item, { state: item.custody.kind === 'store' ? 'available' : item.state, condition: 'worn' });
        await ev('inspect', `Checked usable: ${note}`);
      } else if (c.kind === 'dispose' && a.outcome === 'approved') {
        await this.setItem(tx, item, { state: 'disposed', retiredAt: ctx.at, writeOff: 'finance_to_decide' });
        await ev('disposed', `${note}. The ID is retired and never reused.`);
      } else if (c.kind === 'dispute' && a.outcome === 'back_in_store') {
        const q = this.storeOf(ctx, item.custody.partyId, ctx.at);
        await this.setItem(tx, item, { state: 'quarantine', custody: q, pendingAck: null });
        await ev('return', `Dispute: back in store. ${note}`, q);
      } else if (c.kind === 'dispute' && a.outcome === 'missing') {
        await this.setItem(tx, item, { state: 'missing', pendingAck: null });
        await ev('report_missing', note);
        await this.openCase(tx, ctx, { kind: 'missing', itemId: item.id, partyId: c.partyId, note: `From dispute ${c.ref}: ${note}`, partyIds: c.partyIds });
      } else if (c.kind === 'count_not_found' && a.outcome === 'report_missing') {
        await this.setItem(tx, item, { state: 'missing' });
        await ev('report_missing', note);
        await this.openCase(tx, ctx, { kind: 'missing', itemId: item.id, partyId: c.partyId, note: `From count: ${note}`, partyIds: c.partyIds });
      } else if (c.kind === 'wrong_item' && a.outcome === 'kept_with_approval') {
        await this.setItem(tx, item, { state: 'available', condition: item.condition === 'unknown' ? 'good' : item.condition });
        await ev('inspect', `Kept with approval: ${note}`);
      } else if (c.kind === 'label_mismatch' && a.outcome === 'label_withdrawn') {
        await this.setItem(tx, item, { state: 'quarantine', custody: this.storeOf(ctx, item.custody.partyId, ctx.at) });
        await ev('found', `Label withdrawn for identity check: ${note}`);
      }
    }
    const out = await tx.update('itemCases', c.id, { status: 'resolved', resolution: { actorPartyIds: ctx.user.companyIds, by: ctx.user.name, byId: ctx.user.id, at: ctx.at, outcome: a.outcome, note } });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: c.partyId, action: 'item.case.resolve', entity: 'item_case', entityId: c.id, summary: `${c.ref} closed: ${a.outcome.replace(/_/g, ' ')}. ${note}` });
    return out;
  }

  // ----- Counts -----

  /**
   * Start a count (paper section 10). The expected list is a snapshot at the cut-off; a planned cut-off later today is
   * taken on the first scan after it. A small scope (at most 200 units) may freeze moves until the count closes; a
   * blind count hides what is expected from the counter. Not scanned means not found yet, never lost.
   */
  private async countStart(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.start' }>) {
    let where: ItemCount['where'];
    if (a.siteId) {
      const s = await this.site(tx, a.siteId);
      if (s.companyId !== a.partyId) throw new BadRequest('That site is not this company’s.');
      if (!this.opsMay(ctx, a.partyId, s.id) && !this.has(ctx, a.partyId, 'store', 'manager')) throw new ItemDenied('Count only at your own sites.');
      where = { kind: 'site', ref: s.id, label: s.name };
    } else {
      if (!this.has(ctx, a.partyId, 'store', 'manager', 'it')) throw new ItemDenied('Only the store counts the store.');
      where = { kind: 'store', ref: `store:${a.partyId}`, label: `${this.partyName(ctx, a.partyId)} store` };
    }
    const now = Date.parse(ctx.at);
    let cutoffAt = ctx.at;
    if (a.cutoffAt) {
      const t = Date.parse(String(a.cutoffAt));
      if (!Number.isFinite(t) || t < now - 60_000 || t > now + 7 * 86_400_000) throw new BadRequest('The cut-off is now or within the next 7 days.');
      cutoffAt = String(a.cutoffAt);
    }
    const skuIds = uniq((a.skuIds ?? []).map((x) => String(x)));
    for (const id of skuIds) if (!(await tx.get('itemSkus', id))) throw new BadRequest('Choose item types from the catalogue.');
    const planned = Date.parse(cutoffAt) > now;
    const scope = await this.countScope(tx, where.ref, skuIds);
    if (a.freeze && scope.length > 200) throw new BadRequest(`Freezing moves is for small counts (at most 200 units); this one has ${scope.length}. Count without freezing: moves after the cut-off are listed.`);
    const row: ItemCount = {
      id: this.newId('icount'),
      partyId: a.partyId,
      where,
      cutoffAt,
      expected: planned ? [] : scope,
      found: [],
      extra: [],
      startedBy: ctx.user.name,
      startedById: ctx.user.id,
      closed: null,
      skuIds,
      snapshotAt: planned ? null : ctx.at,
      freeze: !!a.freeze,
      blind: !!a.blind,
      scans: [],
      parentCountId: null,
      review: null,
      partyIds: [a.partyId],
    };
    await tx.insert('itemCounts', row);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.count.start', entity: 'item_count', entityId: row.id, summary: `Count at ${where.label} started${planned ? `, cut-off ${cutoffAt}` : ''}${row.freeze ? ', moves frozen' : ''}${row.blind ? ', blind' : ''}.` });
    return this.countView(row);
  }

  private async countScope(tx: Store, ref: Id, skuIds: Id[]) {
    return (await tx.list('physicalItems')).filter((i) => i.custody.ref === ref && !i.componentIds.length && i.state !== 'disposed' && (!skuIds.length || skuIds.includes(i.skuId))).map((i) => i.id);
  }

  /** What the counter sees: nothing of what is expected in a blind count until it closes. */
  private countView(c: ItemCount) {
    return { ...c, expectedCount: c.expected.length, expected: c.blind && !c.closed ? [] : c.expected };
  }

  private async countFor(tx: Store, ctx: Ctx, countId: Id) {
    await tx.lock?.('itemCounts', countId);
    let c = await tx.get('itemCounts', countId);
    if (!c || !this.seesCountIn(ctx, await this.scopeOf(ctx), c)) throw new NotFound('Count');
    if (c.closed) throw new BadRequest('This count is closed.');
    if (c.startedById !== ctx.user.id && !this.has(ctx, c.partyId, 'store', 'manager', 'ops')) throw new ItemDenied('Only the counting team scans.');
    if (c.snapshotAt === null) {
      if (Date.parse(ctx.at) < Date.parse(c.cutoffAt)) throw new BadRequest(`This count starts at its cut-off (${c.cutoffAt.slice(0, 16).replace('T', ' ')}).`);
      c = await tx.update('itemCounts', c.id, { expected: await this.countScope(tx, c.where.ref, c.skuIds ?? []), snapshotAt: ctx.at });
    }
    return c;
  }

  /**
   * One scan in a count. A label the counter may not see is "not found" (P85 count leak fix): the counter's company
   * gets a case with a fingerprint only, and the item's holder only learns it was seen during another company's count.
   * Nothing about the other company's item, holder or person ever reaches the counter.
   */
  private async countEntry(tx: Store, ctx: Ctx, c: ItemCount, entry: ScanEntry): Promise<{ count: ItemCount; status: 'expected' | 'extra' | 'already' | 'not_found' | 'needs_proof'; message?: string; itemId?: Id }> {
    const p = parseScan(entry.code);
    if (!p.ok) throw new BadRequest(LABEL_REFUSAL[p.reason]);
    const [item] = p.by === 'label' ? await tx.list('physicalItems', { token: p.token }) : await tx.list('physicalItems', { rfidTag: p.tag });
    const g = item ? genVerdict(p.by === 'label' ? p.gen : null, entry.source, item) : 'ok';
    if (!item || g === 'forged' || !(await this.seesItem(ctx, item))) {
      const hash = scanHash(entry.code).slice(0, 16);
      const tag = c.id.slice(-8);
      const open = await tx.list('itemCases', { kind: 'count_unknown_label', status: 'open' });
      if (!open.some((x) => x.partyId === c.partyId && x.note.includes(hash) && x.note.includes(tag)))
        await this.openCase(tx, ctx, { kind: 'count_unknown_label', partyId: c.partyId, note: `Count ${tag} at ${c.where.label}: a label not in this company's register was scanned (fingerprint ${hash}). Keep the item aside and check where it belongs.`, partyIds: [c.partyId] });
      if (item && g !== 'forged' && !(await tx.list('itemCases', { itemId: item.id })).some((x) => x.kind === 'seen_elsewhere' && x.status === 'open'))
        await this.openCase(tx, ctx, { kind: 'seen_elsewhere', itemId: item.id, partyId: item.custody.partyId, note: `Seen during another company's count on ${dateOf(ctx.at)}.`, partyIds: [item.custody.partyId] });
      return { count: c, status: 'not_found' };
    }
    const problem = manualProblem(entry, item);
    if (problem) return { count: c, status: 'needs_proof', message: problem, itemId: item.id };
    if (g === 'superseded' && !(await tx.list('itemCases', { itemId: item.id })).some((x) => x.kind === 'label_superseded' && x.status === 'open'))
      await this.openCase(tx, ctx, { kind: 'label_superseded', itemId: item.id, partyId: item.custody.partyId, note: `${labelDisplay(item.token)}: an older copy of the label was scanned in a count at ${c.where.label}. Check the object.`, partyIds: item.partyIds });
    if (c.found.includes(item.id) || c.extra.includes(item.id)) return { count: c, status: 'already', itemId: item.id };
    const manual = entry.source === 'typed';
    if (manual) await this.noteUnreadable(tx, ctx, item, entry.manual?.reason ?? '');
    const expected = c.expected.includes(item.id);
    await this.event(tx, ctx, { kind: 'count_found', itemId: item.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Counted at ${c.where.label}${expected ? '' : ' (not expected here)'}${manual ? ' (typed, label unreadable)' : ''}`, partyIds: uniq([...item.partyIds, c.partyId]) });
    const scans = [...(c.scans ?? []), { itemId: item.id, byId: ctx.user.id, at: ctx.at, deviceAt: entry.deviceAt ?? null, source: entry.source, manual }];
    const out = await tx.update('itemCounts', c.id, expected ? { found: [...c.found, item.id], scans } : { extra: [...c.extra, item.id], scans });
    return { count: out, status: expected ? 'expected' : 'extra', itemId: item.id };
  }

  private async countScan(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.scan' }>) {
    const c = await this.countFor(tx, ctx, a.countId);
    const r = await this.countEntry(tx, ctx, c, this.entryOf(a));
    return { status: r.status, message: r.message ?? null, already: r.status === 'already', expected: r.status === 'expected', notFound: r.status === 'not_found', count: this.countView(r.count) };
  }

  /**
   * Many RFID reads at once from a handheld or gate reader (a pasted or uploaded list). Repeated reads of one tag
   * count once. Unknown tags are listed back, never registered: a person checks the item.
   */
  private async countScanMany(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.scanMany' }>) {
    let c = await this.countFor(tx, ctx, a.countId);
    if ((a.reads ?? []).length > 2000) throw new BadRequest('Send at most 2,000 reads at a time.');
    const keys = new Map<string, ScanEntry>();
    let unreadable = 0;
    for (const raw of a.reads ?? []) {
      const v = String(raw ?? '').trim().slice(0, 80);
      const p = parseScan(v);
      if (!p.ok) {
        unreadable++;
        continue;
      }
      const key = p.by === 'label' ? p.token : p.tag;
      if (!keys.has(key)) keys.set(key, { code: v, source: p.by === 'rfid' ? 'rfid' : 'wedge' });
    }
    if (!keys.size) throw new BadRequest('No RFID tag or label in the reads.');
    const out = { found: 0, extra: 0, already: 0, unknown: [] as string[], unreadable };
    for (const [key, entry] of keys) {
      const r = await this.countEntry(tx, ctx, c, entry);
      c = r.count;
      if (r.status === 'expected') out.found++;
      else if (r.status === 'extra') out.extra++;
      else if (r.status === 'already') out.already++;
      else out.unknown.push(key);
    }
    return { ...out, count: this.countView(c) };
  }

  /** Scans kept on a phone while offline, or a run of camera scans, sent in one go. Each is judged on its own. */
  private async countScanBatch(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.scanBatch' }>) {
    let c = await this.countFor(tx, ctx, a.countId);
    const scans = a.scans ?? [];
    if (!scans.length) throw new BadRequest('Scan at least one label.');
    const results: { code: string; status: string; message: string | null; label: string | null }[] = [];
    for (const raw of scans) {
      const e = readEntry(raw);
      if (!e.ok) {
        results.push({ code: '', status: 'invalid', message: e.message, label: null });
        continue;
      }
      const p = parseScan(e.entry.code);
      if (!p.ok) {
        results.push({ code: e.entry.code, status: 'invalid', message: LABEL_REFUSAL[p.reason], label: null });
        continue;
      }
      const r = await this.countEntry(tx, ctx, c, e.entry);
      c = r.count;
      const it = r.itemId && r.status !== 'not_found' ? await tx.get('physicalItems', r.itemId) : undefined;
      results.push({ code: e.entry.code, status: r.status, message: r.message ?? null, label: it ? labelDisplay(it.token) : null });
    }
    return { results, count: this.countView(c) };
  }

  /** A recount covers only the not-found and extra units of a closed count, before anyone reviews it. */
  private async countRecount(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.recount' }>) {
    await tx.lock?.('itemCounts', a.countId);
    const c = await tx.get('itemCounts', a.countId);
    if (!c || !this.seesCountIn(ctx, await this.scopeOf(ctx), c)) throw new NotFound('Count');
    if (!c.closed) throw new BadRequest('Close the count first; then recount what was not found or was extra.');
    if (c.review) throw new BadRequest('This count has already been reviewed.');
    if (!this.has(ctx, c.partyId, 'store', 'manager', 'ops', 'it')) throw new ItemDenied('Only the counting company recounts.');
    const open = (await tx.list('itemCounts', { parentCountId: c.id })).find((x) => !x.closed);
    if (open) throw new BadRequest('A recount of this count is already open.');
    const expected = uniq([...c.closed.notFound, ...c.extra]);
    if (!expected.length) throw new BadRequest('Nothing to recount: every expected unit was found and nothing extra.');
    const row: ItemCount = { id: this.newId('icount'), partyId: c.partyId, where: c.where, cutoffAt: ctx.at, expected, found: [], extra: [], startedBy: ctx.user.name, startedById: ctx.user.id, closed: null, skuIds: [], snapshotAt: ctx.at, freeze: false, blind: c.blind ?? false, scans: [], parentCountId: c.id, review: null, partyIds: c.partyIds };
    await tx.insert('itemCounts', row);
    return this.countView(row);
  }

  /**
   * A manager who did not count reviews the result (paper section 10: recount and a separate review before any
   * adjustment). Only now are cases opened. Nothing is ever adjusted automatically; a loss is a case outcome.
   */
  private async countReview(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.review' }>) {
    await tx.lock?.('itemCounts', a.countId);
    const c = await tx.get('itemCounts', a.countId);
    if (!c || !this.seesCountIn(ctx, await this.scopeOf(ctx), c)) throw new NotFound('Count');
    if (!c.closed) throw new BadRequest('Close the count before it is reviewed.');
    if (c.review) throw new BadRequest('This count has already been reviewed.');
    if (c.parentCountId) throw new BadRequest('Review the original count; its recounts are taken into account.');
    if (!this.has(ctx, c.partyId, 'manager')) throw new ItemDenied('A manager of the company reviews the count.');
    if (c.startedById === ctx.user.id || (c.scans ?? []).some((x) => x.byId === ctx.user.id)) throw new ItemDenied('Someone who did not count reviews it.');
    const note = clip(a.note, 300);
    if (note.length < 3) throw new BadRequest('Say what you checked.');
    const children = (await tx.list('itemCounts', { parentCountId: c.id })).filter((x) => x.closed);
    if ((await tx.list('itemCounts', { parentCountId: c.id })).some((x) => !x.closed)) throw new BadRequest('A recount is still open: close it first.');
    const notFound = c.closed.notFound.filter((id) => !children.some((ch) => ch.found.includes(id)));
    const extras = c.extra.filter((id) => !children.some((ch) => ch.closed!.notFound.includes(id)));
    let n = 0;
    for (const id of notFound) {
      const item = (await tx.get('physicalItems', id))!;
      await this.openCase(tx, ctx, { kind: 'count_not_found', itemId: id, partyId: c.partyId, note: `${labelDisplay(item.token)} not found in the count at ${c.where.label}${children.length ? ' or its recount' : ''}. Nothing is adjusted until this case is decided.`, partyIds: uniq([...item.partyIds, c.partyId]) });
      n++;
    }
    for (const id of extras) {
      const item = (await tx.get('physicalItems', id))!;
      await this.openCase(tx, ctx, { kind: 'count_extra', itemId: id, partyId: c.partyId, note: `${labelDisplay(item.token)} found at ${c.where.label} but recorded as ${this.stateText(ctx, item)}.`, partyIds: uniq([...item.partyIds, c.partyId]) });
      n++;
    }
    const out = await tx.update('itemCounts', c.id, { review: { by: ctx.user.name, byId: ctx.user.id, at: ctx.at, note, cases: n } });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: c.partyId, action: 'item.count.review', entity: 'item_count', entityId: c.id, summary: `Count at ${c.where.label} reviewed: ${notFound.length} not found, ${extras.length} extra, ${n} case(s) opened${c.closed.flagged ? '; many typed entries' : ''}. ${note}` });
    return this.countView(out);
  }

  // ----- RFID tags and the company's tagging choice -----

  /**
   * Bind, replace or remove an item's RFID tag. One tag names one item. Replacing or removing needs a reason, and
   * every change is in the item's history. Only the holder's or owner's store, manager or IT team does this.
   */
  private async itemRfid(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.rfid' }>) {
    let item = await this.byLabel(ctx, a.label);
    item = await this.lockItem(tx, item);
    const mayTag = [item.custody.partyId, item.ownerPartyId].some((p) => this.has(ctx, p, 'store', 'manager', 'it'));
    if (!mayTag) throw new ItemDenied('Only the store, manager or IT team holding or owning the item records its RFID tag.');
    if (item.state === 'disposed' || item.state === 'in_transit') throw new BadRequest('Tag the item when it is in a store or at a site, not in transit or disposed.');
    const reason = clip(a.reason, 200);
    const remove = !String(a.tag ?? '').trim();
    const tag = remove ? null : parseRfid(a.tag);
    if (!remove && !tag) throw new BadRequest('That is not an RFID tag code. Read the tag with the reader, or type the code printed on it (16 to 64 letters and numbers, 0-9 and A-F).');
    if (tag && tag === item.rfidTag) return item;
    if (item.rfidTag && reason.length < 5) throw new BadRequest('Say why the tag is being replaced or removed (damaged, fell off, read error).');
    if (remove && !item.rfidTag) throw new BadRequest('This item has no RFID tag.');
    if (tag) {
      const [other] = await tx.list('physicalItems', { rfidTag: tag });
      if (other && other.id !== item.id) throw new BadRequest('That RFID tag is already on another item. Use a new tag.');
    }
    const out = await this.setItem(tx, item, { rfidTag: tag });
    await this.event(tx, ctx, {
      kind: remove ? 'rfid_remove' : 'rfid_bind',
      itemId: item.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null,
      note: remove ? `RFID tag removed: ${reason}` : item.rfidTag ? `RFID tag replaced: ${reason}` : 'RFID tag added',
      partyIds: item.partyIds,
    });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: item.custody.partyId, action: 'item.rfid', entity: 'item', entityId: item.id, summary: `${labelDisplay(item.token)}: RFID tag ${remove ? 'removed' : item.rfidTag ? 'replaced' : 'added'}${reason ? ` (${reason})` : ''}.` });
    return out;
  }

  /** The company's manager chooses barcode, QR or RFID. Scanning still accepts all three. */
  private async setTagMethod(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'settings.tagMethod' }>) {
    if (!TAG_METHODS.includes(a.tagMethod)) throw new BadRequest('Choose barcode, QR or RFID.');
    if (!this.has(ctx, a.partyId, 'manager') && !(a.partyId === 'merdeka' && this.has(ctx, a.partyId, 'it'))) throw new ItemDenied("Only the company's manager chooses how its items are tagged.");
    const reason = clip(a.reason, 200);
    if (reason.length < 5) throw new BadRequest('Give a short reason (for example: readers bought for the main store).');
    await tx.lock?.('itemSettings', a.partyId);
    const cur = await tx.get('itemSettings', a.partyId);
    if (cur?.tagMethod === a.tagMethod) return cur;
    const row: ItemSettings = { id: a.partyId, partyId: a.partyId, tagMethod: a.tagMethod, reason, by: ctx.user.name, byId: ctx.user.id, at: ctx.at, version: (cur?.version ?? 0) + 1, partyIds: [a.partyId] };
    const out = cur ? await tx.update('itemSettings', a.partyId, row) : await tx.insert('itemSettings', row);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.settings.tagMethod', entity: 'item_settings', entityId: a.partyId, summary: `${this.partyName(ctx, a.partyId)} now tags items with: ${TAG_METHOD_LABEL[a.tagMethod]} (was ${TAG_METHOD_LABEL[cur?.tagMethod ?? 'barcode']}). ${reason}` });
    return out;
  }

  /**
   * Not scanned means not found yet, never lost. Movements after the cut-off are listed, not counted against the store.
   * Closing opens no case: a recount and a manager's review come first (P85).
   */
  private async countClose(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.close' }>) {
    await tx.lock?.('itemCounts', a.countId);
    const c = await tx.get('itemCounts', a.countId);
    if (!c || !this.seesCountIn(ctx, await this.scopeOf(ctx), c)) throw new NotFound('Count');
    if (c.closed) throw new BadRequest('Already closed.');
    if (!this.has(ctx, c.partyId, 'store', 'manager', 'ops', 'it')) throw new ItemDenied('Only the counting company closes the count.');
    if (c.snapshotAt === null) throw new BadRequest('The cut-off has not been reached yet: nothing was counted.');
    const cut = Date.parse(c.snapshotAt ?? c.cutoffAt);
    const unfound = c.expected.filter((id) => !c.found.includes(id));
    const events = unfound.length ? await tx.list('itemEvents', { itemId: unfound }) : [];
    const movedAfter = unfound.filter((id) => events.some((e) => e.itemId === id && Date.parse(e.at) > cut && ['dispatch', 'issue', 'return', 'receive', 'repair_out', 'laundry_out', 'reserve'].includes(e.kind)));
    const notFound = unfound.filter((id) => !movedAfter.includes(id));
    const scans = c.scans ?? [];
    const flagged = tooManyManual(scans.filter((x) => x.manual).length, scans.length, this.cfg(ctx, c.partyId));
    const out = await tx.update('itemCounts', c.id, { closed: { by: ctx.user.name, byId: ctx.user.id, at: ctx.at, notFound, movedAfterCutoff: movedAfter, flagged } });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: c.partyId, action: 'item.count.close', entity: 'item_count', entityId: c.id, summary: `Count at ${c.where.label} closed: ${c.found.length} found, ${notFound.length} not found yet, ${c.extra.length} extra, ${movedAfter.length} moved after the cut-off${flagged ? ', many typed entries (flagged)' : ''}.` });
    return this.countView(out);
  }

  /** A draft that never left is cancelled: every picked unit goes back. Once sent, a return movement is used instead. */
  private async moveCancel(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.cancel' }>) {
    const m = await this.draftMove(tx, ctx, a.movementId);
    const reason = clip(a.reason, 200);
    if (reason.length < 5) throw new BadRequest('Say why the movement is cancelled.');
    for (const l of m.lines) {
      const it = await tx.get('physicalItems', l.itemId);
      if (!it || it.state !== 'reserved' || it.reservedFor !== m.id) continue;
      const fresh = await this.lockItem(tx, it);
      await this.setItem(tx, fresh, { state: fresh.custody.kind === 'site' ? 'at_site' : 'available', reservedFor: null });
      await this.event(tx, ctx, { kind: 'unreserve', itemId: fresh.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: `${m.ref} cancelled: ${reason}`, partyIds: m.partyIds });
    }
    const out = await tx.update('itemMovements', m.id, { status: 'cancelled', cancelled: { by: ctx.user.name, byId: ctx.user.id, at: ctx.at, reason }, version: m.version + 1 });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: m.fromPartyId, action: 'item.move.cancel', entity: 'item_movement', entityId: m.id, summary: `${m.ref} cancelled before it left: ${reason}` });
    return out;
  }

  /** Washing: out to the laundry and back to quarantine, checked before it is issued again (paper section 4). */
  private async laundryOut(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'laundry.out' }>) {
    let item = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store sends items to the laundry.');
    item = await this.lockItem(tx, item);
    if (item.state !== 'quarantine' && item.state !== 'available') throw new BadRequest('Take it back into the store first.');
    const who = clip(a.launderer, 120);
    if (who.length < 2) throw new BadRequest('Name the laundry.');
    const to: Custody = { kind: 'laundry', partyId: item.custody.partyId, ref: who, label: `Laundry: ${who}`, since: ctx.at };
    await this.setItem(tx, item, { state: 'laundry', custody: to });
    await this.event(tx, ctx, { kind: 'laundry_out', itemId: item.id, lotId: null, qty: 1, from: item.custody, to, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: clip(a.note, 300), partyIds: item.partyIds });
    return (await tx.get('physicalItems', item.id))!;
  }

  private async laundryBack(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'laundry.back' }>) {
    let item = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store takes items back from the laundry.');
    item = await this.lockItem(tx, item);
    if (item.state !== 'laundry') throw new BadRequest('It is not at the laundry.');
    const to = this.storeOf(ctx, item.custody.partyId, ctx.at);
    await this.setItem(tx, item, { state: 'quarantine', custody: to });
    await this.event(tx, ctx, { kind: 'laundry_back', itemId: item.id, lotId: null, qty: 1, from: item.custody, to, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `${clip(a.note, 300)} Back from the laundry; checked before it is issued again.`.trim(), partyIds: item.partyIds });
    return (await tx.get('physicalItems', item.id))!;
  }

  /**
   * A size swap (paper section 4: return one ID and issue another), in one step, with both items linked in their
   * history. The person still confirms the new one in their own sign-in. Never charged to them.
   */
  private async itemSwap(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.swap' }>) {
    const note = clip(a.note, 200);
    if (note.length < 3) throw new BadRequest('Say why the item is swapped (size, fit).');
    const back = await this.byLabel(ctx, a.returnLabel);
    const next = await this.byLabel(ctx, a.issueLabel);
    if (back.id === next.id) throw new BadRequest('Scan two different items.');
    if (back.custody.kind !== 'person' || back.custody.ref !== a.personId) throw new BadRequest('The item given back is not held by that person.');
    const returned = await this.giveBack(tx, ctx, { kind: 'return', label: back.token, condition: a.condition, note: `Swap: ${note}` });
    const issued = await this.issue(tx, ctx, { kind: 'issue', label: next.token, personId: a.personId, reason: `Swap for ${labelDisplay(back.token)}: ${note}` });
    for (const [x, y] of [[returned, issued], [issued, returned]] as const)
      await this.event(tx, ctx, { kind: 'swap', itemId: x.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Swapped with ${labelDisplay(y.token)}: ${note}`, partyIds: x.partyIds });
    return { returned, issued };
  }

  /** A company's manager changes its settings with a reason. Safe defaults stand until then; none turns on SQL posting. */
  private async settingsConfig(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'settings.config' }>) {
    if (!this.has(ctx, a.partyId, 'manager')) throw new ItemDenied("Only the company's manager changes these settings.");
    const reason = clip(a.reason, 200);
    if (reason.length < 5) throw new BadRequest('Give a short reason for the change.');
    const c = (a.config ?? {}) as Record<string, unknown>;
    const clean: Partial<ItemConfig> = {};
    const int = (k: string, lo: number, hi: number) => {
      const v = Number(c[k]);
      if (!Number.isInteger(v) || v < lo || v > hi) throw new BadRequest(`${k} must be a whole number from ${lo} to ${hi}.`);
      return v;
    };
    for (const k of Object.keys(c)) {
      if (k === 'verifyLabelsBeforeCheck') clean.verifyLabelsBeforeCheck = c[k] === true;
      else if (k === 'labelTemplate') {
        if (!LABEL_TEMPLATES.includes(c[k] as LabelTemplateId)) throw new BadRequest('Choose a label sheet.');
        clean.labelTemplate = c[k] as LabelTemplateId;
      } else if (k === 'labelSymbols') {
        const xs = Array.isArray(c[k]) ? uniq((c[k] as unknown[]).filter((x): x is LabelSymbol => x === 'qr' || x === 'code128')) : [];
        if (!xs.length) throw new BadRequest('Choose the QR code, the Code 128 barcode or both.');
        clean.labelSymbols = xs;
      } else if (k === 'reprintManagerAfter') clean.reprintManagerAfter = int(k, 1, 31);
      else if (k === 'manualShare') {
        const v = Number(c[k]);
        if (!Number.isFinite(v) || v < 0 || v > 0.5) throw new BadRequest('The typed-entry share is from 0 to 0.5.');
        clean.manualShare = v;
      } else if (k === 'manualMin') clean.manualMin = int(k, 0, 20);
      else if (k === 'missLimit') clean.missLimit = int(k, 5, 100);
      else if (k === 'oneSidedDays') clean.oneSidedDays = int(k, 1, 60);
      else if (k === 'draftHours') clean.draftHours = int(k, 1, 72);
      else throw new BadRequest(`Unknown setting ${k}.`);
    }
    await tx.lock?.('itemSettings', a.partyId);
    const cur = await tx.get('itemSettings', a.partyId);
    const config = { ...(cur?.config ?? {}), ...clean };
    const out: ItemSettings = cur
      ? { ...cur, config, version: cur.version + 1 }
      : { id: a.partyId, partyId: a.partyId, tagMethod: 'barcode', reason, by: ctx.user.name, byId: ctx.user.id, at: ctx.at, version: 1, config, partyIds: [a.partyId] };
    if (cur) await tx.update('itemSettings', a.partyId, { config, version: cur.version + 1 });
    else await tx.insert('itemSettings', out);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.settings.config', entity: 'item_settings', entityId: a.partyId, summary: `${this.partyName(ctx, a.partyId)} item settings changed (${Object.keys(clean).join(', ')}): ${reason}` });
    return out;
  }

  // ----- Finance: SQL books, mappings, the export-only outbox and the reconciliation (paper sections 5 to 7) -----

  /** A second Finance person approves an SQL item code before it is exported (maker-checker). */
  private async skuMapApprove(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sku.mapApprove' }>) {
    if (!this.has(ctx, a.partyId, 'finance')) throw new ItemDenied("Only that company's Finance approves its SQL item codes.");
    await tx.lock?.('itemSkus', a.skuId);
    const sku = this.skuCheck(await tx.get('itemSkus', a.skuId));
    const map = sku.sqlCodes.find((c) => c.partyId === a.partyId);
    if (!map) throw new BadRequest('This item type has no SQL item code for that company yet.');
    if (map.approvedById) return sku;
    if (map.byId ? map.byId === ctx.user.id : map.by === ctx.user.name) throw new ItemDenied('A second Finance person approves the code, not the one who entered it.');
    const sqlCodes = sku.sqlCodes.map((c) => (c.partyId === a.partyId ? { ...c, approvedById: ctx.user.id, approvedBy: ctx.user.name, approvedAt: ctx.at } : c));
    const out = await tx.update('itemSkus', sku.id, { sqlCodes, version: sku.version + 1 });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.sku.mapApprove', entity: 'item_sku', entityId: sku.id, summary: `${sku.code}: SQL item code ${map.itemCode} approved for ${this.partyName(ctx, a.partyId)}.` });
    return out;
  }

  /** Evidence attached by Finance (book proof, SQL screen or receipt): PDF, JPEG or PNG, checked by its first bytes. */
  private evidenceDoc(ctx: Ctx, ownerRef: Id, kind: 'sql_receipt' | 'book_evidence', doc: { name?: unknown; data?: unknown } | null | undefined, partyIds: Id[]): ItemDoc {
    const data = String(doc?.data ?? '');
    const mm = /^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.exec(data);
    if (!mm) throw new BadRequest('Attach the evidence as a PDF, JPEG or PNG file.');
    const bytes = Math.floor(((data.length - data.indexOf(',') - 1) * 3) / 4);
    if (bytes > PAPER_MAX_BYTES) throw new BadRequest('The file is too large (under 2 MB).');
    if (!magicOk(mm[1], data)) throw new BadRequest('The file is not what it says it is: attach a real PDF, JPEG or PNG.');
    const sha256 = sha256Hex(data);
    return { id: `idoc-${sha256.slice(0, 20)}`, movementId: ownerRef, kind, name: clip(doc?.name, 120) || 'Evidence', mime: mm[1] as ItemDoc['mime'], bytes, sha256, data, uploadedBy: ctx.user.name, at: ctx.at, partyIds };
  }

  private async keepDoc(tx: Store, d: ItemDoc) {
    if (!(await tx.get('itemDocs', d.id))) await tx.insert('itemDocs', d);
    return d.id;
  }

  /** Finance records the company's SQL book (paper D01). Changing the name, registration or book needs a new verification. */
  private async bookSet(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'book.set' }>) {
    if (!this.has(ctx, a.partyId, 'finance')) throw new ItemDenied("Only that company's Finance records its SQL book.");
    if (!ctx.parties.some((p) => p.id === a.partyId)) throw new BadRequest('Unknown company.');
    const legalName = clip(a.legalName, 160);
    const regNo = clip(a.regNo, 40);
    const sqlBookId = clip(a.sqlBookId, 60);
    if (legalName.length < 3) throw new BadRequest('Type the legal name as registered.');
    if (regNo.length < 3) throw new BadRequest('Type the registration number.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,59}$/.test(sqlBookId)) throw new BadRequest('The SQL book id is 2 to 60 letters, numbers, dots, dashes or underscores (as named in SQL Account).');
    const counterparties: ItemSqlBook['counterparties'] = [];
    for (const c of a.counterparties ?? []) {
      const partyId = String(c?.partyId ?? '');
      const role = c?.role === 'customer' || c?.role === 'supplier' ? c.role : null;
      const sqlCode = String(c?.sqlCode ?? '').trim();
      if (!ctx.parties.some((p) => p.id === partyId) || partyId === a.partyId || !role) throw new BadRequest('Each customer or supplier code names another group company and its role.');
      if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,29}$/.test(sqlCode)) throw new BadRequest('Customer and supplier codes are 1 to 30 letters, numbers, dots, dashes or slashes, kept as text.');
      if (counterparties.some((x) => x.partyId === partyId && x.role === role)) throw new BadRequest('A company is listed twice with the same role.');
      counterparties.push({ partyId, role, sqlCode });
    }
    const lock = a.periodLockedThrough == null || a.periodLockedThrough === '' ? null : String(a.periodLockedThrough);
    if (lock && !/^\d{4}-\d{2}-\d{2}$/.test(lock)) throw new BadRequest('The closed period ends on a date (YYYY-MM-DD).');
    await tx.lock?.('itemSqlBooks', a.partyId);
    const cur = await tx.get('itemSqlBooks', a.partyId);
    const changed = !cur || cur.legalName !== legalName || cur.regNo !== regNo || cur.sqlBookId !== sqlBookId;
    const row: ItemSqlBook = {
      id: a.partyId,
      partyId: a.partyId,
      legalName,
      regNo,
      sqlBookId,
      currency: 'MYR',
      timeZone: 'Asia/Kuala_Lumpur',
      channel: 'export_only',
      counterparties,
      periodLockedThrough: lock,
      setBy: ctx.user.name,
      setById: ctx.user.id,
      setAt: ctx.at,
      verified: changed ? null : cur!.verified,
      version: (cur?.version ?? 0) + 1,
      partyIds: [a.partyId],
    };
    if (cur) await tx.update('itemSqlBooks', a.partyId, row);
    else await tx.insert('itemSqlBooks', row);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.book.set', entity: 'item_sql_book', entityId: a.partyId, summary: `SQL book ${sqlBookId} recorded for ${legalName}${changed ? ': to be verified by a second Finance person' : ''}. Export only; nothing is posted.` });
    return row;
  }

  private async bookVerify(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'book.verify' }>) {
    if (!this.has(ctx, a.partyId, 'finance')) throw new ItemDenied("Only that company's Finance verifies its SQL book.");
    await tx.lock?.('itemSqlBooks', a.partyId);
    const book = await tx.get('itemSqlBooks', a.partyId);
    if (!book) throw new BadRequest('Record the SQL book first.');
    if (book.setById === ctx.user.id) throw new ItemDenied('A second Finance person verifies the book, not the one who recorded it.');
    const doc = this.evidenceDoc(ctx, `book:${a.partyId}`, 'book_evidence', a.evidence, [a.partyId]);
    const evidenceDocId = await this.keepDoc(tx, doc);
    const out = await tx.update('itemSqlBooks', a.partyId, { verified: { by: ctx.user.name, byId: ctx.user.id, at: ctx.at, evidenceDocId }, version: book.version + 1 });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.book.verify', entity: 'item_sql_book', entityId: a.partyId, summary: `SQL book ${book.sqlBookId} verified with evidence (${doc.name}).` });
    return out;
  }

  private async jobFor(tx: Store, ctx: Ctx, jobId: Id): Promise<ItemSyncJob> {
    await tx.lock?.('itemSyncJobs', String(jobId ?? ''));
    const j = await tx.get('itemSyncJobs', String(jobId ?? '').slice(0, 80));
    if (!j || !this.visibleTo(ctx, j.partyIds)) throw new NotFound('Document');
    if (!this.has(ctx, j.partyId, 'finance')) throw new ItemDenied("Only that company's Finance works its SQL documents.");
    return j;
  }

  private async moveJob(tx: Store, ctx: Ctx, j: ItemSyncJob, to: SyncStatus, patch: Partial<ItemSyncJob>, attempt: { result: NonNullable<ItemSyncJob['attempts']>[number]['result']; note: string }) {
    if (!canMove(j.status, to)) throw new BadRequest(`A document that is "${SYNC_STATUS_LABEL[j.status]}" cannot become "${SYNC_STATUS_LABEL[to]}".`);
    return tx.update('itemSyncJobs', j.id, { ...patch, status: to, attempts: [...(j.attempts ?? []), { at: ctx.at, byId: ctx.user.id, by: ctx.user.name, channel: 'export', ...attempt }], version: (j.version ?? 1) + 1 });
  }

  /** Blockers, book and codes worked out again for documents that have not left yet. */
  private async refreshJob(tx: Store, j: ItemSyncJob, book: ItemSqlBook | null, skus: ItemSku[]) {
    const m = await tx.get('itemMovements', j.sourceId);
    const payload = {
      ...j.payload,
      lines: j.payload.lines.map((l) => {
        const map = skus.find((s) => s.id === l.skuId)?.sqlCodes.find((c) => c.partyId === j.partyId) ?? null;
        return { ...l, itemCode: map?.itemCode ?? null, uom: map?.uom ?? l.uom };
      }),
    };
    const bookId = book?.sqlBookId ?? BOOK_UNSET;
    const blockers = syncBlockers({ partyId: j.partyId, payload, docDate: j.docDate ?? dateOf(j.at), docType: j.docType }, { book, skus, counterpartyId: counterpartyOf(j, m) });
    let key = syncKey(j.partyId, j.docType, j.sourceId, j.revision, bookId);
    if (key !== j.key && (await tx.list('itemSyncJobs', { key })).length) key = j.key;
    const status: SyncStatus = blockers.includes('period_locked') ? 'manual_review' : blockers.length ? 'not_ready' : 'ready';
    return { payload, payloadHash: payloadHash(payload), key, book: bookId, blockers, reasons: this.syncReasons(blockers), status };
  }

  /** Work out again what stops each document that has not left yet: ready ones can go into an export file. */
  private async syncRefresh(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.refresh' }>) {
    if (!this.has(ctx, a.partyId, 'finance')) throw new ItemDenied("Only that company's Finance refreshes its SQL documents.");
    const [jobs, skus, book] = await Promise.all([tx.list('itemSyncJobs', { partyId: a.partyId }), tx.list('itemSkus'), tx.get('itemSqlBooks', a.partyId)]);
    let ready = 0;
    let blocked = 0;
    for (const j of jobs.filter((x) => x.status === 'not_ready' || x.status === 'ready')) {
      await tx.lock?.('itemSyncJobs', j.id);
      const next = await this.refreshJob(tx, j, book ?? null, skus);
      await tx.update('itemSyncJobs', j.id, { ...next, version: (j.version ?? 1) + 1 });
      if (next.status === 'ready') ready++;
      else blocked++;
    }
    return { ready, blocked };
  }

  /**
   * Build an export file set from ready documents (paper section 7: a controlled, batch-numbered file with a pre-check).
   * The files are stored with their SHA-256 so a later download is the same file. Nothing is sent to SQL Account.
   */
  private async syncBatch(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.batch' }>) {
    if (!this.has(ctx, a.partyId, 'finance')) throw new ItemDenied("Only that company's Finance builds its export files.");
    const ids = uniq((a.jobIds ?? []).map((x) => String(x)));
    if (!ids.length || ids.length > 200) throw new BadRequest('Choose 1 to 200 ready documents.');
    const book = await tx.get('itemSqlBooks', a.partyId);
    if (!book?.verified) throw new BadRequest('Record the SQL book and have a second Finance person verify it first.');
    const jobs: ItemSyncJob[] = [];
    const problems: string[] = [];
    for (const id of ids) {
      const j = await this.jobFor(tx, ctx, id);
      if (j.partyId !== a.partyId) problems.push(`${j.id} belongs to another company.`);
      else if (j.status !== 'ready' || (j.blockers ?? []).length) problems.push(`${j.id} is not ready.`);
      else if (j.book !== book.sqlBookId) problems.push(`${j.id} was made for another book; refresh it.`);
      jobs.push(j);
    }
    if (problems.length) throw new BadRequest(`The export did not pass its pre-check: ${problems.join(' ')}`);
    const skus = await tx.list('itemSkus');
    const moves = await tx.list('itemMovements', { id: uniq(jobs.map((j) => j.sourceId)) });
    const unitIds = uniq(jobs.flatMap((j) => j.payload.lines.flatMap((l) => l.itemIds ?? [])));
    const units = unitIds.length ? await tx.list('physicalItems', { id: unitIds }) : [];
    const n = await this.nextRef(tx, `EXP:${a.partyId}`, async () => 0);
    const ref = `EXP-${book.sqlBookId}-${String(n).padStart(4, '0')}`;
    const built = buildExport(ref, book, jobs, skus, moves, (id) => {
      const u = units.find((x) => x.id === id);
      return u ? labelDisplay(u.token) : id;
    });
    if (built.problems.length) throw new BadRequest(`The export did not pass its pre-check: ${built.problems.join(' ')}`);
    const batch: ItemSyncBatch = { id: this.newId('iexp'), ref, partyId: a.partyId, book: book.sqlBookId, format: 'prima_csv_v1', jobIds: jobs.map((j) => j.id), files: built.files, preCheck: { ok: true, problems: [] }, status: 'generated', createdBy: ctx.user.name, createdById: ctx.user.id, at: ctx.at, sent: null, partyIds: [a.partyId] };
    await tx.insert('itemSyncBatches', batch);
    for (const j of jobs) await this.moveJob(tx, ctx, j, 'queued', { batchId: batch.id }, { result: 'generated', note: ref });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.export.batch', entity: 'item_sync_batch', entityId: batch.id, summary: `${ref}: ${jobs.length} document(s) in an export file for SQL book ${book.sqlBookId}. Not sent; Finance imports it by hand.` });
    return { ...batch, files: batch.files.map(({ content: _content, ...f }) => f) };
  }

  /** Finance confirms the file went into the SQL import. This is not an acknowledgement: the SQL numbers come next. */
  private async syncSent(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.sent' }>) {
    await tx.lock?.('itemSyncBatches', a.batchId);
    const b = await tx.get('itemSyncBatches', String(a.batchId ?? ''));
    if (!b || !this.visibleTo(ctx, b.partyIds)) throw new NotFound('Export file');
    if (!this.has(ctx, b.partyId, 'finance')) throw new ItemDenied("Only that company's Finance marks its export file as imported.");
    if (b.status !== 'generated') throw new BadRequest('This export file is already marked.');
    for (const id of b.jobIds) {
      const j = await this.jobFor(tx, ctx, id);
      if (j.status === 'queued') await this.moveJob(tx, ctx, j, 'sent', {}, { result: 'sent', note: `${b.ref} imported by hand` });
    }
    const out = await tx.update('itemSyncBatches', b.id, { status: 'sent', sent: { by: ctx.user.name, byId: ctx.user.id, at: ctx.at } });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: b.partyId, action: 'item.export.sent', entity: 'item_sync_batch', entityId: b.id, summary: `${b.ref} marked as imported into SQL Account by hand. Each document waits for its SQL number.` });
    return { ...out, files: out.files.map(({ content: _content, ...f }) => f) };
  }

  private async ackChecks(tx: Store, j: ItemSyncJob, docNoRaw: unknown, totals: { net?: unknown; tax?: unknown; gross?: unknown } | null | undefined) {
    const docNo = clip(docNoRaw, 40);
    if (!/^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,39}$/.test(docNo)) throw new BadRequest('Type the SQL document number exactly as SQL Account shows it.');
    const dup = (await tx.list('itemSyncJobs', { partyId: j.partyId })).find((x) => x.id !== j.id && x.book === j.book && x.docType === j.docType && x.dest && x.dest.docNo.toUpperCase() === docNo.toUpperCase());
    if (dup) throw new BadRequest(`SQL document ${docNo} is already recorded for another document in this book.`);
    let t: { net: string; tax: string; gross: string } | null = null;
    if (totals) {
      const ok = (v: unknown) => /^-?\d{1,12}$/.test(String(v ?? ''));
      if (!ok(totals.net) || !ok(totals.tax) || !ok(totals.gross)) throw new BadRequest('Totals are whole sen (for example 12345 for RM123.45).');
      if (BigInt(String(totals.net)) + BigInt(String(totals.tax)) !== BigInt(String(totals.gross))) throw new BadRequest('Net plus tax must equal the gross total.');
      t = { net: String(totals.net), tax: String(totals.tax), gross: String(totals.gross) };
    }
    return { docNo, totals: t };
  }

  /**
   * Finance records the document number SQL Account gave, with the evidence (a screenshot or the printed document).
   * Nothing is ever marked acknowledged without both (paper section 7: store the number SQL returns, not a guess).
   */
  private async syncAck(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.ack' }>) {
    const j = await this.jobFor(tx, ctx, a.jobId);
    if (j.status !== 'sent') throw new BadRequest(j.status === 'outcome_unknown' ? 'Look the document up first (outcome unknown).' : 'Only a document imported into SQL Account gets its SQL number.');
    const { docNo, totals } = await this.ackChecks(tx, j, a.docNo, a.totals);
    const evidenceDocId = await this.keepDoc(tx, this.evidenceDoc(ctx, j.sourceId, 'sql_receipt', a.evidence, [j.partyId]));
    const out = await this.moveJob(tx, ctx, j, 'acknowledged', { dest: { docNo, totals, evidenceDocId, by: ctx.user.name, byId: ctx.user.id, at: ctx.at } }, { result: 'acknowledged', note: `SQL ${docNo}` });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: j.partyId, action: 'item.sync.ack', entity: 'item_sync_job', entityId: j.id, summary: `SQL document ${docNo} recorded with evidence for ${j.docType.replace(/_/g, ' ')} (${j.payload.commercialRef ?? 'no shared ref'}).` });
    return out;
  }

  private async syncReject(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.reject' }>) {
    const j = await this.jobFor(tx, ctx, a.jobId);
    const reason = clip(a.reason, 300);
    if (reason.length < 5) throw new BadRequest('Say what SQL Account rejected.');
    return this.moveJob(tx, ctx, j, 'rejected', {}, { result: 'rejected', note: reason });
  }

  /** The import may or may not have gone in: never sent again blindly; look it up first (paper section 7, U16). */
  private async syncUnknown(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.unknown' }>) {
    const j = await this.jobFor(tx, ctx, a.jobId);
    const note = clip(a.note, 300);
    if (note.length < 5) throw new BadRequest('Say what happened (for example: the import stopped half way).');
    return this.moveJob(tx, ctx, j, 'outcome_unknown', {}, { result: 'unknown', note });
  }

  private async syncLookup(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.lookup' }>) {
    const j = await this.jobFor(tx, ctx, a.jobId);
    if (j.status !== 'outcome_unknown') throw new BadRequest('Only a document with an unknown outcome is looked up.');
    const note = clip(a.note, 300);
    if (note.length < 5) throw new BadRequest('Say where you looked (SQL screen, document listing).');
    const evidenceDocId = await this.keepDoc(tx, this.evidenceDoc(ctx, j.sourceId, 'sql_receipt', a.evidence, [j.partyId]));
    if (a.docNo) {
      const { docNo } = await this.ackChecks(tx, j, a.docNo, null);
      return this.moveJob(tx, ctx, j, 'acknowledged', { dest: { docNo, totals: null, evidenceDocId, by: ctx.user.name, byId: ctx.user.id, at: ctx.at } }, { result: 'acknowledged', note: `Found in SQL as ${docNo}: ${note}` });
    }
    // Confirmed absent, with evidence: it may go into a new export file, under the same key and payload.
    return this.moveJob(tx, ctx, j, 'ready', { batchId: null }, { result: 'absent', note: `Not in SQL Account: ${note}` });
  }

  /**
   * Finance review (paper section 7): hold a document, put it back as ready, make a new revision that says it updates
   * the earlier one, or reverse an acknowledged one with a linked reversal. An acknowledged document is never edited.
   */
  private async syncReview(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.review' }>) {
    const j = await this.jobFor(tx, ctx, a.jobId);
    const reason = clip(a.reason, 300);
    if (reason.length < 5) throw new BadRequest('Give the reason for the decision.');
    if (a.decision === 'hold') return this.moveJob(tx, ctx, j, 'manual_review', {}, { result: 'review', note: `Held: ${reason}` });
    if (a.decision === 'requeue') {
      if (j.status !== 'rejected' && j.status !== 'manual_review') throw new BadRequest('Only a rejected or held document is put back.');
      const book = (await tx.get('itemSqlBooks', j.partyId)) ?? null;
      const next = await this.refreshJob(tx, j, book, await tx.list('itemSkus'));
      if (next.payloadHash !== j.payloadHash && j.status === 'rejected') throw new BadRequest('The document changed since it was exported: make a new revision instead.');
      const to: SyncStatus = next.status === 'ready' ? 'ready' : 'not_ready';
      return this.moveJob(tx, ctx, j, to, { ...next, status: to, batchId: null }, { result: 'review', note: `Put back: ${reason}` });
    }
    if (a.decision !== 'new_revision' && a.decision !== 'reverse') throw new BadRequest('Choose hold, put back, new revision or reverse.');
    if (a.decision === 'new_revision' && j.status !== 'rejected' && j.status !== 'manual_review') throw new BadRequest('A new revision replaces a rejected or held document.');
    if (a.decision === 'reverse' && j.status !== 'acknowledged' && j.status !== 'reconciled') throw new BadRequest('Only a document SQL Account acknowledged is reversed.');
    const all = await tx.list('itemSyncJobs', { partyId: j.partyId, docType: j.docType, sourceId: j.sourceId });
    const revision = Math.max(...all.map((x) => x.revision)) + 1;
    const book = (await tx.get('itemSqlBooks', j.partyId)) ?? null;
    const base: ItemSyncJob = { ...j, id: this.newId('isync'), revision, revisionAction: a.decision === 'reverse' ? 'reverse' : 'update', supersedesJobId: j.id, batchId: null, attempts: [], dest: null, reconciledAt: null, version: 1, at: ctx.at, docDate: dateOf(ctx.at) };
    const next = await this.refreshJob(tx, base, book, await tx.list('itemSkus'));
    const row: ItemSyncJob = { ...base, ...next, key: syncKey(j.partyId, j.docType, j.sourceId, revision, next.book) };
    await tx.insert('itemSyncJobs', row);
    if (a.decision === 'new_revision') await this.moveJob(tx, ctx, j, 'manual_review' === j.status ? 'not_ready' : 'manual_review', {}, { result: 'review', note: `Replaced by revision ${revision}: ${reason}` });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: j.partyId, action: `item.sync.${a.decision}`, entity: 'item_sync_job', entityId: row.id, summary: `${a.decision === 'reverse' ? 'Reversal' : 'New revision'} ${revision} of ${j.docType.replace(/_/g, ' ')} made from ${j.id}: ${reason}` });
    return row;
  }

  /** Finance loads a stock balance or a document listing exported from SQL Account, for the reconciliation. */
  private async syncSnapshot(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.snapshot' }>) {
    if (!this.has(ctx, a.partyId, 'finance')) throw new ItemDenied("Only that company's Finance loads its SQL exports.");
    if (a.snapshot !== 'stock_balance' && a.snapshot !== 'doc_listing') throw new BadRequest('Choose a stock balance or a document listing.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.asOf ?? '') || a.asOf > dateOf(ctx.at)) throw new BadRequest('Give the date the SQL export is as of (not in the future).');
    const csv = String(a.csv ?? '');
    if (!csv.trim() || csv.length > PAPER_MAX_BYTES) throw new BadRequest('Paste or upload the CSV exported from SQL Account (under 2 MB).');
    const parsed = parseSnapshot(a.snapshot, csv);
    if (!parsed.rows.length) throw new BadRequest(parsed.problems.join(' ') || 'No rows were read from the file.');
    const book = await tx.get('itemSqlBooks', a.partyId);
    const row: ItemSqlSnapshot = { id: this.newId('isnap'), partyId: a.partyId, book: book?.sqlBookId ?? BOOK_UNSET, kind: a.snapshot, asOf: a.asOf, sha256: sha256Hex(csv), rows: parsed.rows, by: ctx.user.name, byId: ctx.user.id, at: ctx.at, partyIds: [a.partyId] };
    await tx.insert('itemSqlSnapshots', row);
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.sync.snapshot', entity: 'item_sql_snapshot', entityId: row.id, summary: `SQL ${a.snapshot.replace('_', ' ')} as of ${a.asOf} loaded: ${parsed.rows.length} rows${parsed.problems.length ? `, ${parsed.problems.length} skipped` : ''}.` });
    return { id: row.id, rows: parsed.rows.length, problems: parsed.problems };
  }

  /** The reconciliation of one book, as of today's month (shared by the board and the reconcile step). */
  private async reconFor(store: Store, ctx: Ctx, partyId: Id, period: string) {
    const [jobsAll, moves, items, skus, snaps, book, events] = await Promise.all([
      store.list('itemSyncJobs'),
      store.list('itemMovements'),
      store.list('physicalItems'),
      store.list('itemSkus'),
      store.list('itemSqlSnapshots', { partyId }),
      store.get('itemSqlBooks', partyId),
      store.list('itemEvents'),
    ]);
    const jobs = jobsAll.filter((j) => j.partyId === partyId);
    const mine = moves.filter((m) => m.fromPartyId === partyId || m.toPartyId === partyId);
    const refs = new Set(mine.map((m) => m.commercialRef).filter((x): x is string => !!x));
    const otherSide = jobsAll
      .filter((j) => j.partyId !== partyId && j.payload.commercialRef && refs.has(j.payload.commercialRef) && this.visibleTo(ctx, j.partyIds))
      .map((j) => ({ commercialRef: j.payload.commercialRef!, partyId: j.partyId, status: j.status, docType: j.docType }));
    const ours = items.filter((i) => i.ownerPartyId === partyId || (i.historyPartyIds ?? []).includes(partyId));
    const ourIds = new Set(ours.map((i) => i.id));
    const latest = (k: ItemSqlSnapshot['kind']) => snaps.filter((x) => x.kind === k).sort((a, b) => (a.asOf + a.at).localeCompare(b.asOf + b.at)).at(-1) ?? null;
    return reconcileBook({
      partyId,
      period,
      today: dateOf(ctx.at),
      oneSidedDays: this.cfg(ctx, partyId).oneSidedDays,
      book: book ?? null,
      jobs,
      otherSide,
      moves: mine,
      items: ours,
      events: events.filter((e) => e.itemId && ourIds.has(e.itemId)),
      skus,
      stock: latest('stock_balance'),
      listing: latest('doc_listing'),
    });
  }

  /**
   * Run the reconciliation and keep what it finds (paper section 7): acknowledged documents found in the SQL listing
   * become reconciled; every unexplained difference gets one open case for that book's Finance.
   */
  private async syncReconcile(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'sync.reconcile' }>) {
    if (!this.has(ctx, a.partyId, 'finance')) throw new ItemDenied("Only that company's Finance reconciles its book.");
    const r = await this.reconFor(tx, ctx, a.partyId, dateOf(ctx.at).slice(0, 7));
    let reconciled = 0;
    for (const id of r.docCompare.matched) {
      const j = await this.jobFor(tx, ctx, id);
      if (j.status === 'acknowledged') {
        await this.moveJob(tx, ctx, j, 'reconciled', { reconciledAt: ctx.at }, { result: 'acknowledged', note: `Matched to the SQL listing of ${r.docCompare.asOf}` });
        reconciled++;
      }
    }
    const diffs: string[] = [];
    if (r.docCompare.asOf) {
      for (const x of r.docCompare.missing) diffs.push(`SQL document ${x.docNo} (${x.jobId}) is not in the SQL listing of ${r.docCompare.asOf}.`);
      for (const x of r.docCompare.differs) diffs.push(`SQL document ${x.docNo} (${x.jobId}) has different totals in the SQL listing of ${r.docCompare.asOf}.`);
    }
    for (const x of r.rollForward.filter((y) => y.difference !== 0)) diffs.push(`Roll-forward of ${x.sku}: ${x.live} units on record but ${x.closing} from the history. Integrity check.`);
    for (const ref of r.oneSided) diffs.push(`${ref}: posted in one book only for more than ${this.cfg(ctx, a.partyId).oneSidedDays} days.`);
    const open = await tx.list('itemCases', { kind: 'recon_diff', status: 'open' });
    let opened = 0;
    for (const d of diffs) {
      if (open.some((c) => c.partyId === a.partyId && c.note === d)) continue;
      await this.openCase(tx, ctx, { kind: 'recon_diff', partyId: a.partyId, note: d, partyIds: [a.partyId] });
      opened++;
    }
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.sync.reconcile', entity: 'item_sql_book', entityId: a.partyId, summary: `Reconciliation run: ${reconciled} document(s) matched, ${diffs.length} difference(s), ${opened} new case(s).` });
    return { reconciled, differences: diffs.length, opened, recon: r };
  }

  // ----- Reading: labels, site board, counts, reports and the Finance board -----

  /** The labels of one print run, to print or print again on the chosen sheet. No names, prices or owner. */
  async labelBatch(user: User, batchId: Id) {
    const ctx = await this.ctx(user);
    const prints = (await this.store.list('itemLabelPrints', { batchId: String(batchId ?? '').slice(0, 80) })).filter((p) => this.visibleTo(ctx, p.partyIds));
    if (!prints.length) throw new NotFound('Print run');
    const skus = await this.store.list('itemSkus');
    const labels = [];
    for (const p of prints) {
      const i = await this.store.get('physicalItems', p.itemId);
      if (!i) continue;
      const s = skus.find((x) => x.id === i.skuId);
      labels.push({ printId: p.id, itemId: i.id, gen: p.gen, payload: labelPayload(i.token, p.gen), display: labelDisplay(i.token), sku: s?.code ?? '', size: s?.size ?? null, kind: p.kind, verified: !!p.verified, current: labelGenOf(i) === p.gen });
    }
    return { batchId, template: prints[0].template, symbols: prints[0].symbols, at: prints[0].at, labels };
  }

  /**
   * One site's board (paper section 4): what is expected there (at the site, or with people whose latest shift is
   * there), who holds it, its last condition, the last confirmed sighting and what is waiting. Reading moves nothing.
   */
  async siteBoard(user: User, siteId: Id) {
    const ctx = await this.ctx(user);
    const site = await this.store.get('sites', String(siteId ?? '').slice(0, 80));
    if (!site) throw new NotFound('Site');
    if (!this.opsMay(ctx, site.companyId, site.id) && !this.has(ctx, site.companyId, 'store', 'manager', 'view')) throw new ItemDenied('Open the board of your own sites only.');
    const [items, skus, shifts, lots, cases] = await Promise.all([this.store.list('physicalItems'), this.store.list('itemSkus'), this.store.list('shifts'), this.store.list('itemLots'), this.store.list('itemCases', { status: 'open' })]);
    const latest = new Map<Id, { siteId: Id; date: IsoDate }>();
    for (const x of shifts) if (x.personId && (latest.get(x.personId)?.date ?? '') < x.date) latest.set(x.personId, { siteId: x.siteId, date: x.date });
    const people = new Set([...latest].filter(([, v]) => v.siteId === site.id).map(([k]) => k));
    const here = items.filter((i) => !i.componentIds.length && i.state !== 'disposed' && i.custody.partyId === site.companyId && ((i.custody.kind === 'site' && i.custody.ref === site.id) || (i.custody.kind === 'person' && people.has(i.custody.ref))));
    const events = here.length ? await this.store.list('itemEvents', { itemId: here.map((i) => i.id) }) : [];
    const today = dateOf(ctx.at);
    const rows = here.map((i) => {
      const s = skus.find((x) => x.id === i.skuId);
      const seen = events.filter((e) => e.itemId === i.id && ['confirm', 'observe', 'count_found', 'issue', 'receive'].includes(e.kind)).map((e) => e.at).sort().at(-1) ?? null;
      const c = this.mask(ctx, i.custody);
      return { itemId: i.id, token: i.token, label: labelDisplay(i.token), sku: s?.code ?? i.skuId, size: s?.size ?? null, holder: c.kind === 'site' ? 'At the site' : c.label, state: i.state, condition: i.condition, lastConfirmed: seen, waiting: !!i.pendingAck, overdue: !!i.dueBack && i.dueBack.on < today, openCases: cases.filter((x) => x.itemId === i.id).length };
    });
    return {
      site: { id: site.id, name: site.name, companyId: site.companyId },
      today,
      rows: rows.sort((a, b) => a.sku.localeCompare(b.sku) || a.label.localeCompare(b.label)),
      lots: lots.filter((l) => l.custody.kind === 'site' && l.custody.ref === site.id).map((l) => ({ id: l.id, sku: skus.find((x) => x.id === l.skuId)?.code ?? l.skuId, qty: l.qty })),
      totals: { units: rows.length, waiting: rows.filter((r) => r.waiting).length, overdue: rows.filter((r) => r.overdue).length, damaged: rows.filter((r) => r.condition === 'damaged').length, cases: rows.reduce((n, r) => n + r.openCases, 0), notSeen30: rows.filter((r) => !r.lastConfirmed || Date.parse(r.lastConfirmed) < Date.parse(ctx.at) - 30 * 86_400_000).length },
      canCheck: this.opsMay(ctx, site.companyId, site.id) || this.has(ctx, site.companyId, 'store', 'manager'),
      note: 'An audit scan records what was seen; it never moves anything, changes the owner or bills anyone.',
    };
  }

  /** One count with its lines. A blind count shows nothing of what is expected until it is closed. */
  async countDetail(user: User, countId: Id) {
    const ctx = await this.ctx(user);
    const c = await this.store.get('itemCounts', String(countId ?? '').slice(0, 80));
    if (!c || !this.seesCountIn(ctx, await this.scopeOf(ctx), c)) throw new NotFound('Count');
    const hidden = !!c.blind && !c.closed;
    const ids = uniq([...(hidden ? [] : c.expected), ...c.found, ...c.extra]);
    const [items, skus, children] = await Promise.all([ids.length ? this.store.list('physicalItems', { id: ids }) : Promise.resolve([] as PhysicalItem[]), this.store.list('itemSkus'), this.store.list('itemCounts', { parentCountId: c.id })]);
    const row = (id: Id) => {
      const i = items.find((x) => x.id === id);
      const s = i ? skus.find((x) => x.id === i.skuId) : undefined;
      return { itemId: id, label: i ? labelDisplay(i.token) : id, sku: s?.code ?? '', size: s?.size ?? null, state: i?.state ?? null };
    };
    const scans = c.scans ?? [];
    const manual = scans.filter((x) => x.manual).length;
    return {
      count: this.countView(c),
      expected: hidden ? [] : c.expected.map(row),
      found: c.found.map(row),
      extra: c.extra.map(row),
      notFound: c.closed ? c.closed.notFound.map(row) : [],
      movedAfterCutoff: c.closed ? c.closed.movedAfterCutoff.map(row) : [],
      manual,
      flagged: tooManyManual(manual, scans.length, this.cfg(ctx, c.partyId)),
      recounts: children.map((x) => this.countView(x)),
      canReview: !!c.closed && !c.review && !c.parentCountId && this.has(ctx, c.partyId, 'manager') && c.startedById !== user.id && !scans.some((x) => x.byId === user.id),
    };
  }

  /**
   * A report (paper section 10), built only from what the user may see, with names of other companies' staff hidden.
   * Every report says when its data is from; a CSV export is written to the audit trail.
   */
  async report(user: User, kind: ItemReportKind, partyId: Id | null, format: 'json' | 'csv' = 'json') {
    if (!ITEM_REPORT_KINDS.includes(kind)) throw new BadRequest('Unknown report.');
    const ctx = await this.ctx(user);
    if (!ctx.roles.size) throw new ItemDenied('Reports are for stores, managers, operations, Finance, audit and group leaders.');
    if (partyId && !ctx.roles.has(partyId)) throw new ItemDenied('Choose one of your companies.');
    const sc = await this.scopeOf(ctx);
    const [items, lots, moves, cases, skus, prints] = await Promise.all([this.store.list('physicalItems'), this.store.list('itemLots'), this.store.list('itemMovements'), this.store.list('itemCases'), this.store.list('itemSkus'), this.store.list('itemLabelPrints')]);
    const itemOf = new Map(items.map((i) => [i.id, i] as const));
    const inParty = (ids: Id[]) => !partyId || ids.includes(partyId);
    const vItems = items.filter((i) => this.seesItemIn(ctx, sc, i) && inParty([i.ownerPartyId, i.custody.partyId]));
    const vIds = new Set(vItems.map((i) => i.id));
    const events = vIds.size && ['history', 'returns_repairs_losses'].includes(kind) ? (await this.store.list('itemEvents', { itemId: [...vIds] })).map((e) => (this.actorVisible(ctx, e.byId, e.actorPartyIds) ? e : { ...e, by: 'Other company staff', note: '(private note)' })) : [];
    const today = dateOf(ctx.at);
    const care = kind === 'usage_life' ? this.care(ctx, vItems, skus, vIds.size ? await this.store.list('itemEvents', { itemId: [...vIds] }) : [], cases, today) : [];
    const r = buildReport({
      kind,
      asOf: ctx.at,
      today,
      scope: partyId ? this.partyName(ctx, partyId) : 'All companies you may see',
      partyName: (id) => this.partyName(ctx, id),
      items: vItems.map((i) => this.maskItem(ctx, i)),
      lots: lots.filter((l) => this.seesLotIn(ctx, sc, l) && inParty([l.ownerPartyId, l.custody.partyId])),
      moves: moves.filter((m) => this.seesMoveIn(ctx, sc, m) && inParty([m.fromPartyId, m.toPartyId])),
      cases: cases.filter((c) => this.seesCaseIn(ctx, sc, c, itemOf)),
      events,
      prints: prints.filter((p) => vIds.has(p.itemId)).map((p) => (this.actorVisible(ctx, p.byId, p.partyIds) ? p : { ...p, by: 'Other company staff' })),
      skus,
      care,
    });
    if (format === 'csv') {
      await this.store.audit({ at: ctx.at, actor: user.name, companyId: partyId, action: 'item.report.export', entity: 'item_report', entityId: kind, summary: `${r.title} exported: ${r.rows.length} rows, scope ${r.scope}, data as of ${r.asOf}.` });
      return { ...r, csv: reportCsv(r) };
    }
    return r;
  }

  /**
   * The Finance board of one company (paper section 10): its SQL book, mappings, the export-only outbox by status
   * with what blocks each document, export files and the reconciliation. Read by Finance, managers and leaders.
   */
  async finance(user: User, partyId: Id | null) {
    const ctx = await this.ctx(user);
    const parties = [...ctx.roles.entries()].filter(([, rs]) => rs.some((r) => r === 'finance' || r === 'manager' || r === 'view')).map(([p]) => p);
    if (!parties.length) throw new ItemDenied('Finance, managers, audit and group leaders see the SQL outbox.');
    const pid = partyId && parties.includes(partyId) ? partyId : parties.includes(GOODWILL_PARTY_ID) ? GOODWILL_PARTY_ID : parties[0];
    const [jobs, batches, book, snaps, skus] = await Promise.all([this.store.list('itemSyncJobs', { partyId: pid }), this.store.list('itemSyncBatches', { partyId: pid }), this.store.get('itemSqlBooks', pid), this.store.list('itemSqlSnapshots', { partyId: pid }), this.store.list('itemSkus')]);
    return {
      partyId: pid,
      parties: parties.map((p) => ({ id: p, name: this.partyName(ctx, p), finance: this.has(ctx, p, 'finance') })),
      canAct: this.has(ctx, pid, 'finance'),
      channel: 'export_only' as const,
      note: 'SQL Account is not connected. Documents go out as export files that Finance imports by hand; a document is acknowledged only with the SQL number and evidence, and reconciled only when found in an SQL listing.',
      book: book ?? null,
      jobs: jobs
        .filter((j) => this.visibleTo(ctx, j.partyIds))
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((j) => ({ ...j, statusLabel: SYNC_STATUS_LABEL[j.status], blockerLabels: (j.blockers ?? []).map((b) => SYNC_BLOCKER_LABEL[b]) })),
      batches: batches.filter((b) => this.visibleTo(ctx, b.partyIds)).sort((a, b) => b.at.localeCompare(a.at)).map((b) => ({ ...b, files: b.files.map(({ content: _content, ...f }) => f) })),
      snapshots: snaps.filter((x) => this.visibleTo(ctx, x.partyIds)).map((x) => ({ id: x.id, kind: x.kind, asOf: x.asOf, rows: x.rows.length, sha256: x.sha256, by: x.by, at: x.at })),
      mappings: skus.map((s) => ({ skuId: s.id, code: s.code, name: s.name, uom: s.uom, map: s.sqlCodes.find((c) => c.partyId === pid) ?? null })),
      recon: await this.reconFor(this.store, ctx, pid, dateOf(ctx.at).slice(0, 7)),
    };
  }

  /** One stored export file, exactly as generated (its SHA-256 shows it is the same file). Finance only; audited. */
  async batchFile(user: User, batchId: Id, name: string) {
    const ctx = await this.ctx(user);
    const b = await this.store.get('itemSyncBatches', String(batchId ?? '').slice(0, 80));
    if (!b || !this.visibleTo(ctx, b.partyIds) || !this.has(ctx, b.partyId, 'finance')) throw new NotFound('Export file');
    const f = b.files.find((x) => x.name === name);
    if (!f) throw new NotFound('Export file');
    await this.store.audit({ at: ctx.at, actor: user.name, companyId: b.partyId, action: 'item.export.download', entity: 'item_sync_batch', entityId: b.id, summary: `${f.name} downloaded (${f.rows} rows, SHA-256 ${f.sha256.slice(0, 12)}).` });
    return { name: f.name, sha256: f.sha256, content: f.content };
  }
}

