// One item register for the whole group: server rules (Fauzan, 6 Nov 2026; Fitri's paper v1.0 sections 2-10).
// Every write is checked here, whatever the screen shows: who the user is, which legal entity they act for, the item's
// state and version, and the request id (a double tap or retry never repeats a change). A scan only finds a record.

import { AccessDenied, activeGrants, isActHead, isGroupLeader } from './access';
import { sha256Hex } from './audit';
import { BadRequest, NotFound, ReviewConflict } from './service';
import type { Store } from './store';
import { evaluateFace } from './checks';
import { REGIONS, regionOfState } from './regions';
import { dateOf } from './time';
import { addMonthsIso } from './work';
import type { AuthorityGrant, Company, FaceCapture, Id, IsoDate, IsoDateTime, Person, Site, User } from './types';
import {
  BASE_UOMS,
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
export type ItemRole = 'store' | 'manager' | 'ops' | 'finance' | 'it' | 'view';

/** Refusal with a plain message (HTTP 403). */
export class ItemDenied extends AccessDenied {
  constructor(message: string) {
    super('view', '(items)');
    this.message = message;
  }
}

export type ItemAction =
  | { kind: 'sku.add'; code: string; name: string; category: ItemCategory; tracking: TrackingMode; uom: BaseUom; size?: string; colour?: string; consumable?: boolean; components?: { skuId: Id; qty: number }[]; supplierBarcodes?: string[] }
  | { kind: 'sku.map'; skuId: Id; partyId: Id; itemCode: string; uom: BaseUom }
  | { kind: 'item.register'; skuId: Id; partyId: Id; count: number; serials?: string[]; itAssetId?: Id; legacyUnverified?: boolean; note?: string }
  | { kind: 'item.inspect'; label: string; condition: Exclude<ItemCondition, 'unknown'>; note: string; expectedVersion?: number }
  | { kind: 'item.reprint'; label: string; reason: string }
  | { kind: 'item.replace'; label: string; note: string }
  | { kind: 'kit.assemble'; skuId: Id; partyId: Id; labels: string[] }
  | { kind: 'lot.add'; skuId: Id; partyId: Id; qty: number; note: string }
  | { kind: 'lot.issue'; lotId: Id; qty: number; personId?: Id; siteId?: Id; note?: string }
  | { kind: 'move.create'; type: MovementType; fromPartyId: Id; toPartyId: Id; toSiteId?: Id; purpose: string; dueBackOn?: IsoDate; originalMovementId?: Id }
  | { kind: 'move.add'; movementId: Id; label: string }
  | { kind: 'move.addLot'; movementId: Id; lotId: Id; qty: number }
  | { kind: 'move.remove'; movementId: Id; itemId: Id }
  | { kind: 'move.dispatch'; movementId: Id; carrier: string; expectedVersion?: number }
  | { kind: 'move.receive'; movementId: Id; lines: { itemId: Id; result: Exclude<LineResult, 'pending'>; note?: string }[]; lotLines?: { lotId: Id; qty: number }[] }
  | { kind: 'move.ownership'; movementId: Id; effectiveOn: IsoDate; basis: string }
  | { kind: 'issue'; label: string; personId?: Id; siteId?: Id; expectedVersion?: number; reason?: string; paidByGuard?: { receiptRef: string; amount: number } }
  | { kind: 'uniform.past'; companyId: Id; scope: { kind: UniformScopeKind; id: string }; on: IsoDate; pieces: number; reason: string }
  | { kind: 'confirm'; label: string }
  | { kind: 'dispute'; label: string; note: string }
  | { kind: 'return'; label: string; condition: 'good' | 'worn' | 'damaged'; note: string }
  | { kind: 'report.missing'; label: string; note: string }
  | { kind: 'repair.out'; label: string; repairer: string; note: string }
  | { kind: 'repair.back'; label: string; note: string }
  | { kind: 'dispose.ask'; label: string; reason: string }
  | { kind: 'observe'; label: string; siteId: Id; serialSeen?: string; note?: string }
  | { kind: 'case.resolve'; caseId: Id; outcome: string; note: string }
  | { kind: 'count.start'; partyId: Id; siteId?: Id }
  | { kind: 'count.scan'; countId: Id; label: string }
  | { kind: 'count.close'; countId: Id }
  | { kind: 'count.scanMany'; countId: Id; reads: string[] }
  | { kind: 'move.receiveScan'; reads: string[]; movementId?: Id }
  | { kind: 'device.confirm'; staffNo: string; face: FaceCapture | null; label: string }
  | { kind: 'sku.care'; skuId: Id; everyDays: number | null; lifeMonths: number | null; reason: string }
  | { kind: 'item.service'; label: string; condition: 'good' | 'worn' | 'damaged'; note: string }
  | { kind: 'service.request'; label: string; note: string }
  | { kind: 'move.paper'; movementId: Id; paper: 'invoice' | 'payment_slip'; ref: string; date: IsoDate; doc: { name: string; data: string }; reason?: string }
  | { kind: 'move.acknowledge'; movementId: Id; ref: string; date: IsoDate; signedBy: string; doc?: { name: string; data: string } | null; reason?: string }
  | { kind: 'item.rfid'; label: string; tag: string; reason?: string }
  | { kind: 'settings.tagMethod'; partyId: Id; tagMethod: TagMethod; reason: string };

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
};

/** Events that count as a check of the unit's health for after-sale care. */
const CARE_CHECKS: ItemEventKind[] = ['inspect', 'service', 'return', 'repair_back', 'observe', 'count_found', 'receive'];
const DUE_SOON_DAYS = 14;

/** Largest scanned paper accepted (invoice, payment slip, signed letter). */
const PAPER_MAX_BYTES = 2_000_000;
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
    return { user, requestId, roles: await this.rolesFor(user), parties: await this.parties(), at: this.clock(), opsSites: new Set((await this.areaSites(user)).map((s) => s.id)) };
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

  private visibleTo(ctx: Ctx, partyIds: Id[]) {
    return partyIds.includes('*') || partyIds.some((p) => ctx.roles.has(p));
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
    return { ...i, custody: this.mask(ctx, i.custody), pendingAck: i.pendingAck && !ctx.roles.has(i.custody.partyId) ? { ...i.pendingAck, personId: '(hidden)' } : i.pendingAck };
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
      throw new ItemDenied('The item register is for stores, managers, operations, Finance, IT and group leaders. Firearms are in the Arms Control vault records.');
    const vItems = items.filter((i) => this.visibleTo(ctx, i.partyIds)).map((i) => this.maskItem(ctx, i));
    const vLots = lots.filter((l) => this.visibleTo(ctx, l.partyIds));
    const vMoves = moves.filter((m) => this.visibleTo(ctx, m.partyIds));
    const vCases = cases.filter((c) => this.visibleTo(ctx, c.partyIds)).map((c) => this.maskCase(ctx, c));
    const vCounts = counts.filter((c) => this.visibleTo(ctx, c.partyIds));
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
      checks: this.reconcile(vItems, vLots, vMoves, vCases, vJobs, today),
      /** After-sale care (Fauzan, 6 Nov 2026): the seller and the owning company both watch health, service and life. */
      care: this.care(ctx, careItems, skus, events.filter((e) => !!e.itemId && careIds.has(e.itemId)), cases, today),
      /** Uniform allowance per guard (Fauzan, 6 Nov 2026): at least 2 and at most 3 pieces a year, usually 1 every 6 months. */
      uniforms: this.uniforms(ctx, people, items, skus, events, uniformRecords, this.guardPlaces(people.filter((p) => p.role === 'guard'), shifts, sites, branches), today),
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
    const item = await this.byLabel(ctx, raw);
    const skus = await this.store.list('itemSkus');
    // A company that follows the item sees its whole life, including steps from before it owned it, with the other
    // company's staff names hidden.
    const follows = this.follows(ctx, item);
    const events = (await this.store.list('itemEvents', { itemId: item.id }))
      .filter((e) => this.visibleTo(ctx, e.partyIds) || follows)
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
      .filter((c) => this.visibleTo(ctx, c.partyIds) || follows)
      .map((c) => this.maskCase(ctx, c));
    return {
      item: this.maskItem(ctx, item),
      label: labelDisplay(item.token),
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
    const item = await this.scanned(this.store, raw);
    const own = item && ctx.user.personId && item.custody.kind === 'person' && item.custody.ref === ctx.user.personId;
    if (!item || (!this.visibleTo(ctx, item.partyIds) && !own)) throw new NotFound('Item');
    return item;
  }

  // ---------- Writing ----------

  /** Run one action once. The request id makes a retry or a double tap return the first result. */
  async act(user: User, requestId: string, action: ItemAction): Promise<unknown> {
    const rid = clip(requestId, 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(rid)) throw new BadRequest('Missing request id.');
    if (!action || typeof action !== 'object' || typeof (action as { kind?: unknown }).kind !== 'string') throw new BadRequest('Unknown action.');
    const raw = JSON.stringify(action);
    const paperKinds = ['move.paper', 'move.acknowledge'];
    if (raw.length > (paperKinds.includes((action as { kind: string }).kind) ? PAPER_MAX_BYTES * 1.4 + 4000 : 20000))
      throw new BadRequest(paperKinds.includes((action as { kind: string }).kind) ? 'The paper is too large. Scan it smaller (under 2 MB).' : 'Too much in one request: send fewer items at a time.');
    // A plain copy with list fields forced to lists, so a malformed request is refused, never half-applied.
    action = JSON.parse(raw) as ItemAction;
    const rec = action as unknown as Record<string, unknown>;
    for (const k of ['lines', 'lotLines', 'labels', 'serials', 'components', 'supplierBarcodes', 'reads'])
      if (k in rec && !Array.isArray(rec[k])) throw new BadRequest(`${k} must be a list.`);
    for (const k of ['lines', 'lotLines', 'components'])
      if (Array.isArray(rec[k]) && (rec[k] as unknown[]).some((x) => !x || typeof x !== 'object')) throw new BadRequest(`${k} must be a list of entries.`);
    const hash = sha256Hex(raw);
    const run = async () => {
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
    if (this.store.lock) return run();
    const prev = ItemService.queues.get(this.store) ?? Promise.resolve();
    const next = prev.then(run, run);
    ItemService.queues.set(
      this.store,
      next.catch(() => undefined),
    );
    return next;
  }

  private async nextId(tx: Store, table: 'itemMovements' | 'itemCases' | 'itemEvents' | 'itemCounts' | 'itemSyncJobs' | 'physicalItems' | 'itemLots' | 'itemSkus', prefix: string) {
    const n = (await tx.list(table)).length + 1;
    return { n, id: `${prefix}-${n}-${Math.random().toString(36).slice(2, 8)}` };
  }

  private async event(tx: Store, ctx: Ctx, e: Omit<ItemEvent, 'id' | 'at' | 'by' | 'byId'>) {
    const { id } = await this.nextId(tx, 'itemEvents', 'iev');
    const follow = e.itemId ? ((await tx.get('physicalItems', e.itemId))?.historyPartyIds ?? []) : [];
    await tx.insert('itemEvents', { id, at: ctx.at, by: ctx.user.name, byId: ctx.user.id, ...e, actorPartyIds: ctx.user.companyIds, partyIds: uniq([...e.partyIds, ...follow]) });
  }

  private async openCase(tx: Store, ctx: Ctx, c: { kind: ItemCaseKind; itemId?: Id | null; lotId?: Id | null; movementId?: Id | null; partyId: Id; note: string; partyIds: Id[] }) {
    const { n, id } = await this.nextId(tx, 'itemCases', 'icase');
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

  private async setItem(tx: Store, item: PhysicalItem, patch: Partial<PhysicalItem>) {
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
    const { id } = await this.nextId(tx, 'itemSkus', 'sku');
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
    const sqlCodes = [...sku.sqlCodes.filter((c) => c.partyId !== a.partyId), { partyId: a.partyId, itemCode, uom: a.uom, by: ctx.user.name, at: ctx.at }];
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
    const out: PhysicalItem[] = [];
    for (let k = 0; k < count; k++) {
      let token = this.newToken(`${ctx.requestId}:${k}:0`);
      for (let tries = 1; (await tx.list('physicalItems', { token })).length; tries++) {
        if (tries > 5) throw new Error('Could not make a unique label.');
        token = this.newToken(`${ctx.requestId}:${k}:${tries}`);
      }
      const { id } = await this.nextId(tx, 'physicalItems', 'itm');
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
        labelPrints: 1,
        registeredBy: ctx.user.name,
        registeredAt: ctx.at,
        legacyUnverified: !!a.legacyUnverified,
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
      await this.event(tx, ctx, { kind: 'register', itemId: id, lotId: null, qty: 1, from: null, to: custody, ownerFrom: null, ownerTo: a.partyId, movementId: null, caseId: null, note: clip(a.note, 200) || (a.legacyUnverified ? 'Opening balance, not yet verified' : 'Registered and label printed'), partyIds: [a.partyId] });
      out.push(row);
    }
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: a.partyId, action: 'item.register', entity: 'item', entityId: out[0].id, summary: `${count} x ${sku.code} registered at ${this.partyName(ctx, a.partyId)}, labels printed, waiting to be checked.` });
    return out;
  }

  private async inspect(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.inspect' }>) {
    let item = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store holding the item checks it.');
    item = await this.lockItem(tx, item, a.expectedVersion);
    if (item.state !== 'quarantine') throw new BadRequest('Only items waiting to be checked (quarantine) are checked here.');
    if (item.custody.kind !== 'store') throw new BadRequest('Check the item in the store.');
    if (!['new', 'good', 'worn', 'damaged'].includes(a.condition)) throw new BadRequest('Choose the condition.');
    const note = clip(a.note, 300);
    if (a.condition === 'damaged' && note.length < 3) throw new BadRequest('Say what is damaged.');
    const state = a.condition === 'damaged' ? 'quarantine' : 'available';
    const out = await this.setItem(tx, item, { state, condition: a.condition });
    await this.event(tx, ctx, { kind: 'inspect', itemId: item.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `${a.condition}${note ? `: ${note}` : ''}`, partyIds: item.partyIds });
    if (a.condition === 'damaged') await this.openCase(tx, ctx, { kind: 'damaged', itemId: item.id, partyId: item.custody.partyId, note, partyIds: item.partyIds });
    return out;
  }

  private async reprint(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'item.reprint' }>) {
    let item = await this.byLabel(ctx, a.label);
    const sku = await tx.get('itemSkus', item.skuId);
    if (!this.canHandle(ctx, item.custody.partyId, sku)) throw new ItemDenied('Only the store holding the item reprints its label.');
    const reason = clip(a.reason, 200);
    if (reason.length < 5) throw new BadRequest('Say why the label is reprinted and that you checked it is the same item.');
    if (item.state === 'disposed') throw new BadRequest('A disposed item keeps its ID retired; no new label.');
    item = await this.lockItem(tx, item);
    const out = await this.setItem(tx, item, { labelPrints: item.labelPrints + 1 });
    await this.event(tx, ctx, { kind: 'label_reprint', itemId: item.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Same ID reprinted (print ${item.labelPrints + 1}): ${reason}`, partyIds: item.partyIds });
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: item.custody.partyId, action: 'item.label.reprint', entity: 'item', entityId: item.id, summary: `${labelDisplay(item.token)} reprinted: ${reason}` });
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
      const { id } = await this.nextId(tx, 'itemLots', 'lot');
      out = { id, skuId: sku.id, ownerPartyId: a.partyId, custody: this.storeOf(ctx, a.partyId, ctx.at), qty, version: 1, partyIds: [a.partyId] };
      await tx.insert('itemLots', out);
    }
    await this.event(tx, ctx, { kind: 'lot_add', itemId: null, lotId: out.id, qty, from: null, to: out.custody, ownerFrom: null, ownerTo: a.partyId, movementId: null, caseId: null, note, partyIds: [a.partyId] });
    return out;
  }

  private async lotIssue(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'lot.issue' }>) {
    const lot = await tx.get('itemLots', a.lotId);
    if (!lot || !this.visibleTo(ctx, lot.partyIds)) throw new NotFound('Stock');
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
    const { n, id } = await this.nextId(tx, 'itemMovements', 'imv');
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
    if (!m || !this.visibleTo(ctx, m.partyIds)) throw new NotFound('Movement');
    if (!this.has(ctx, m.fromPartyId, 'store', 'manager', 'it') && !(m.type === 'transfer' && this.opsMay(ctx, m.fromPartyId))) throw new ItemDenied('Only the sending store changes this movement.');
    if (m.status !== 'draft') throw new BadRequest('It has already left; open a new movement or a case.');
    return m;
  }

  private async moveAdd(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.add' }>) {
    const m = await this.draftMove(tx, ctx, a.movementId);
    const first = await this.byLabel(ctx, a.label);
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
    return tx.update('itemMovements', m.id, { lines: [...m.lines, ...lineIds.map((itemId) => ({ itemId, result: 'pending' as const, by: null, at: null, note: '' }))], version: m.version + 1 });
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
    for (const l of m.lines) {
      if (only && !only.includes(l.itemId)) continue;
      const it = items.find((i) => i.id === l.itemId);
      if (it) qty.set(it.skuId, (qty.get(it.skuId) ?? 0) + 1);
    }
    for (const l of m.lotLines) qty.set(l.skuId, (qty.get(l.skuId) ?? 0) + (only ? (l.qtyReceived ?? 0) : l.qtySent));
    return [...qty.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([skuId, q]) => {
        const sku = skus.find((s) => s.id === skuId)!;
        const code = sku.sqlCodes.find((c) => c.partyId === partyId) ?? null;
        return { skuId, itemCode: code?.itemCode ?? null, uom: code?.uom ?? sku.uom, qty: q };
      });
  }

  /** The outbox row, written in the same transaction as the physical change. Never sent: no SQL connection exists. */
  private async queueSync(tx: Store, ctx: Ctx, m: ItemMovement, partyId: Id, docType: ItemSyncJob['docType'], payload: ItemSyncJob['payload']) {
    const revision = 1;
    const key = syncKey(partyId, docType, m.id, revision);
    const hash = payloadHash(payload);
    const [existing] = await tx.list('itemSyncJobs', { key });
    if (existing) {
      if (existing.payloadHash !== hash) throw new BadRequest('A different document for this movement is already queued. Finance must choose an update or a reversal.');
      return existing;
    }
    const reasons = ['SQL Account is not connected for this company (paper section 5).', `Legal entity and SQL book for ${this.partyName(ctx, partyId)} not confirmed (D01).`];
    if (payload.lines.some((l) => !l.itemCode)) reasons.push('Some item types have no SQL item code for this book yet (Finance to map).');
    const { id } = await this.nextId(tx, 'itemSyncJobs', 'isync');
    const row: ItemSyncJob = { id, partyId, docType, sourceId: m.id, revision, key, payloadHash: hash, payload, status: 'not_ready', reasons, at: ctx.at, partyIds: [partyId] };
    await tx.insert('itemSyncJobs', row);
    return row;
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
      const [skus, items] = await Promise.all([tx.list('itemSkus'), tx.list('physicalItems')]);
      const doc = m.type === 'sale' ? 'sales_delivery' : m.type === 'supplier_return' ? 'supplier_return_out' : 'rental_out';
      await this.queueSync(tx, ctx, out, m.fromPartyId, doc, { commercialRef: m.commercialRef, lines: this.sqlLines(m, skus, items, m.fromPartyId) });
    }
    await tx.audit({ at: ctx.at, actor: ctx.user.name, companyId: m.fromPartyId, action: 'item.move.dispatch', entity: 'item_movement', entityId: m.id, summary: `${m.ref} sent: ${m.lines.length} units${m.lotLines.length ? ` and ${m.lotLines.length} stock lines` : ''}, carried by ${carrier}.` });
    return out;
  }

  private async moveReceive(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.receive' }>) {
    await tx.lock?.('itemMovements', a.movementId);
    const m = await tx.get('itemMovements', a.movementId);
    if (!m || !this.visibleTo(ctx, m.partyIds)) throw new NotFound('Movement');
    if (m.status !== 'dispatched' && m.status !== 'partly_received') throw new BadRequest(m.status === 'draft' ? 'It has not been sent yet.' : 'This movement is closed.');
    const toSite = m.to.kind === 'site' ? m.to.ref : null;
    const may = this.has(ctx, m.toPartyId, 'store', 'manager', 'it') || (!!toSite && this.opsMay(ctx, m.toPartyId, toSite));
    if (!may) throw new ItemDenied('Only the receiving company’s store, or the supervisor of the receiving site, confirms what arrived.');
    if (m.dispatched?.byId === ctx.user.id) throw new ItemDenied('The person who sent it cannot confirm it arrived.');
    const lines = a.lines ?? [];
    const lotLines = a.lotLines ?? [];
    if (!lines.length && !lotLines.length) throw new BadRequest('Scan or tick each item that arrived, and mark what is missing or damaged.');
    if (uniq(lines.map((l) => l.itemId)).length !== lines.length) throw new BadRequest('The same item is listed twice.');
    const at = ctx.at;
    const dest: Custody =
      m.to.kind === 'site' ? { kind: 'site', partyId: m.toPartyId, ref: m.to.ref, label: m.to.label, since: at } : { kind: 'store', partyId: m.toPartyId, ref: m.to.ref, label: m.to.label, since: at };
    const nextLines = m.lines.map((l) => ({ ...l }));
    const received: Id[] = [];
    for (const r of lines) {
      const line = nextLines.find((l) => l.itemId === r.itemId);
      if (!line) {
        throw new BadRequest('An item that is not on this movement cannot be received here. Open a case for an unexpected item.');
      }
      if (line.result !== 'pending' && line.result !== 'missing') throw new BadRequest('That item is already recorded.');
      if (!['received', 'damaged', 'missing', 'wrong_item'].includes(r.result)) throw new BadRequest('Choose received, damaged, missing or wrong item.');
      if (line.result === 'missing' && r.result === 'missing') throw new BadRequest('That item is already marked missing; its case stays open.');
      const note = clip(r.note, 300);
      const item = await this.lockItem(tx, (await tx.get('physicalItems', r.itemId))!);
      if (item.state !== 'in_transit' || item.custody.ref !== m.id) throw new BadRequest(`${labelDisplay(item.token)} is not in transit on this movement. Reload.`);
      line.by = ctx.user.name;
      line.at = at;
      line.note = note;
      line.result = r.result;
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
        await this.event(tx, ctx, { kind: 'receive', itemId: item.id, lotId: null, qty: 1, from: item.custody, to: dest, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: note || `Received on ${m.ref}`, partyIds: m.partyIds });
        received.push(item.id);
      } else if (r.result === 'damaged' || r.result === 'wrong_item') {
        if (note.length < 3) throw new BadRequest('Say what is wrong with it.');
        const q: Custody = { ...dest, kind: 'store', ref: `store:${m.toPartyId}`, label: `${this.partyName(ctx, m.toPartyId)} store (quarantine)` };
        await this.setItem(tx, item, { state: 'quarantine', custody: q, condition: r.result === 'damaged' ? 'damaged' : item.condition, partyIds: keep });
        await this.event(tx, ctx, { kind: 'receive_damaged', itemId: item.id, lotId: null, qty: 1, from: item.custody, to: q, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note, partyIds: m.partyIds });
        await this.openCase(tx, ctx, { kind: r.result === 'damaged' ? 'damaged' : 'wrong_item', itemId: item.id, movementId: m.id, partyId: m.toPartyId, note: `${m.ref}: ${note}`, partyIds: m.partyIds });
      } else {
        // Missing: stays in transit under investigation, never available.
        await this.event(tx, ctx, { kind: 'receive_missing', itemId: item.id, lotId: null, qty: 1, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: note || 'Did not arrive', partyIds: m.partyIds });
        await this.openCase(tx, ctx, { kind: 'short', itemId: item.id, movementId: m.id, partyId: m.fromPartyId, note: `${m.ref}: ${labelDisplay(item.token)} did not arrive. ${note}`, partyIds: m.partyIds });
      }
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
      const { id: lotId } = await this.nextId(tx, 'itemLots', 'lot');
      await tx.insert('itemLots', { id: lotId, skuId: line.skuId, ownerPartyId: src.ownerPartyId, custody: dest, qty, version: 1, partyIds: uniq([src.ownerPartyId, m.toPartyId]) });
      line.receivedLotId = lotId;
      await this.event(tx, ctx, { kind: 'lot_receive', itemId: null, lotId, qty, from: null, to: dest, ownerFrom: null, ownerTo: null, movementId: m.id, caseId: null, note: `${qty} of ${line.qtySent} received`, partyIds: m.partyIds });
      if (qty < line.qtySent) await this.openCase(tx, ctx, { kind: 'short', lotId: line.lotId, movementId: m.id, partyId: m.fromPartyId, note: `${m.ref}: ${line.qtySent - qty} short of ${line.qtySent}.`, partyIds: m.partyIds });
    }
    const open = nextLines.some((l) => l.result === 'pending' || l.result === 'missing') || nextLots.some((l) => l.qtyReceived == null);
    const out = await tx.update('itemMovements', m.id, {
      lines: nextLines,
      lotLines: nextLots,
      status: open ? 'partly_received' : 'received',
      receipts: [...m.receipts, { by: ctx.user.name, byId: ctx.user.id, at, lines: lines.length + lotLines.length }],
      version: m.version + 1,
    });
    if (m.type !== 'transfer' && (received.length || lotLines.length)) {
      const [skus, items] = await Promise.all([tx.list('itemSkus'), tx.list('physicalItems')]);
      const doc = m.type === 'sale' ? 'purchase_receipt' : m.type === 'supplier_return' ? 'supplier_return_in' : 'rental_in';
      const receivedNow = { ...m, lotLines: nextLots.filter((l) => lotLines.some((r) => r.lotId === l.lotId)) };
      // Each receipt is its own revision of the buyer's document, so a second receipt never doubles the first.
      const job = { commercialRef: m.commercialRef, lines: this.sqlLines(receivedNow, skus, items, m.toPartyId, received) };
      const rev = m.receipts.length + 1;
      const key = syncKey(m.toPartyId, doc, m.id, rev);
      if (!(await tx.list('itemSyncJobs', { key })).length) {
        const { id } = await this.nextId(tx, 'itemSyncJobs', 'isync');
        const reasons = ['SQL Account is not connected for this company (paper section 5).', `Legal entity and SQL book for ${this.partyName(ctx, m.toPartyId)} not confirmed (D01).`];
        if (job.lines.some((l) => !l.itemCode)) reasons.push('Some item types have no SQL item code for this book yet (Finance to map).');
        await tx.insert('itemSyncJobs', { id, partyId: m.toPartyId, docType: doc, sourceId: m.id, revision: rev, key, payloadHash: payloadHash(job), payload: job, status: 'not_ready', reasons, at, partyIds: [m.toPartyId] });
      }
    }
    await tx.audit({ at, actor: ctx.user.name, companyId: m.toPartyId, action: 'item.move.receive', entity: 'item_movement', entityId: m.id, summary: `${m.ref}: ${lines.filter((l) => l.result === 'received').length} received, ${lines.filter((l) => l.result === 'damaged' || l.result === 'wrong_item').length} to quarantine, ${lines.filter((l) => l.result === 'missing').length} missing.` });
    return out;
  }

  /**
   * Declare arrival by scanning (Fauzan, 6 Nov 2026): the receiving store, the site's supervisor or the area OM scans
   * each label, QR or RFID tag, and every scanned unit still in transit is recorded as received on its movement.
   * Units not scanned stay waiting, so a short delivery is never received in full; damage and missing are still
   * marked one by one. The same checks as a ticked receipt apply (receiving side only, never the sender).
   */
  private async moveReceiveScan(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'move.receiveScan' }>) {
    const reads = uniq((a.reads ?? []).map((r) => String(r ?? '').trim()).filter(Boolean));
    if (!reads.length) throw new BadRequest('Scan at least one label or tag.');
    if (reads.length > 500) throw new BadRequest('Scan at most 500 items at a time.');
    const byMove = new Map<Id, Id[]>();
    const notInTransit: string[] = [];
    const unknown: string[] = [];
    for (const r of reads) {
      let item: PhysicalItem | undefined;
      try {
        item = await this.scanned(tx, r);
      } catch {
        item = undefined;
      }
      if (!item || (!this.visibleTo(ctx, item.partyIds) && !this.follows(ctx, item))) {
        unknown.push(r);
        continue;
      }
      const target = item.kitId && item.state !== 'in_transit' ? null : item;
      const movementId = target?.state === 'in_transit' ? target.custody.ref : null;
      if (!movementId || (a.movementId && movementId !== a.movementId)) {
        notInTransit.push(labelDisplay(item.token));
        continue;
      }
      byMove.set(movementId, uniq([...(byMove.get(movementId) ?? []), item.id]));
    }
    const received: { movementId: Id; ref: string; count: number }[] = [];
    for (const [movementId, itemIds] of byMove) {
      const m = await tx.get('itemMovements', movementId);
      if (!m) continue;
      const pending = new Set(m.lines.filter((l) => l.result === 'pending' || l.result === 'missing').map((l) => l.itemId));
      const lines = itemIds.filter((id) => pending.has(id)).map((itemId) => ({ itemId, result: 'received' as const, note: 'Scanned on arrival' }));
      if (!lines.length) continue;
      await this.moveReceive(tx, ctx, { kind: 'move.receive', movementId, lines });
      received.push({ movementId, ref: m.ref, count: lines.length });
    }
    return { received, notInTransit, unknown };
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
    const batchId = `unib-${records.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
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
        const row: UniformRecord = { id: `uni-${n}-${Math.random().toString(36).slice(2, 8)}`, kind: 'past', personId: g.id, companyId: a.companyId, on: a.on, pieces, itemId: null, receiptRef: null, amount: null, batchId, scope, reason, by: ctx.user.name, byId: ctx.user.id, at: ctx.at, partyIds: [a.companyId] };
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
      if (dup) throw new BadRequest(`This file was already given as ${SALE_PAPER_LABEL[dup.kind].toLowerCase()} on another record.`);
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
    if (!m || !this.visibleTo(ctx, m.partyIds)) throw new NotFound('Movement');
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
    if (!m || !this.visibleTo(ctx, m.partyIds)) throw new NotFound('Movement');
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
    let item = await this.byLabel(ctx, a.label);
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
        const amount = Number(pay?.amount);
        if (!pay || ref.length < 2 || !Number.isFinite(amount) || amount <= 0 || amount > 10_000)
          throw new BadRequest(`${to.label} already had ${t.free} free uniform pieces in the last 12 months. The most is ${R.maxPerYear} a year. A ${t.free + t.paid === 3 ? '4th' : '5th'} piece is paid by the guard: enter the receipt number and the amount on it.`);
        const n = (await tx.list('uniformRecords')).length + 1;
        paidRecord = { id: `uni-${n}-${Math.random().toString(36).slice(2, 8)}`, kind: 'paid', personId: to.ref, companyId: holder, on: today, pieces: 1, itemId: item.id, receiptRef: ref, amount: Math.round(amount * 100) / 100, batchId: null, scope: null, reason: 'Paid by the guard', by: ctx.user.name, byId: ctx.user.id, at: ctx.at, partyIds: [holder] };
        uniformNote = ` Piece ${t.free + t.paid + 1} in 12 months, paid by the guard: receipt ${ref}, RM${paidRecord.amount!.toFixed(2)}. Not taken from pay.`;
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
    let item = await this.byLabel(ctx, a.label);
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
    let item = await this.byLabel(ctx, a.label);
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
    const item = await this.byLabel(ctx, a.label);
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
      opened = await this.openCase(tx, ctx, { kind: 'wrong_place', itemId: item.id, partyId: item.custody.partyId, note: `${labelDisplay(item.token)} seen at ${site.name}, recorded as ${STATE(item)}.`, partyIds: uniq([...item.partyIds, site.companyId]) });
    return { expectedHere: expectedHere || withSitePerson, case: opened };
  }

  // ----- Cases -----

  private async caseResolve(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'case.resolve' }>) {
    await tx.lock?.('itemCases', a.caseId);
    const c = await tx.get('itemCases', a.caseId);
    if (!c || !this.visibleTo(ctx, c.partyIds)) throw new NotFound('Case');
    if (c.status !== 'open') throw new BadRequest('This case is already closed.');
    const rule = CASE_OUTCOMES[c.kind];
    if (!rule.outcomes.includes(a.outcome)) throw new BadRequest(`Choose: ${rule.outcomes.join(', ').replace(/_/g, ' ')}.`);
    const note = clip(a.note, 300);
    if (note.length < 3) throw new BadRequest('Give the reason and the proof you checked.');
    const needsManager = rule.manager.includes(a.outcome);
    if (needsManager) {
      if (!this.has(ctx, c.partyId, 'manager')) throw new ItemDenied('A manager of that company decides this.');
      if (c.openedById === ctx.user.id) throw new ItemDenied('The person who opened the case does not decide it.');
    } else if (!this.has(ctx, c.partyId, 'store', 'manager', 'ops', 'it') && !(c.kind === 'short' && c.movementId)) throw new ItemDenied('Only that company’s store, operations or manager closes this case.');
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
    const items = (await tx.list('physicalItems')).filter((i) => i.custody.ref === where.ref && !i.componentIds.length && i.state !== 'disposed');
    const { id } = await this.nextId(tx, 'itemCounts', 'icount');
    const row: ItemCount = { id, partyId: a.partyId, where, cutoffAt: ctx.at, expected: items.map((i) => i.id), found: [], extra: [], startedBy: ctx.user.name, startedById: ctx.user.id, closed: null, partyIds: [a.partyId] };
    await tx.insert('itemCounts', row);
    return row;
  }

  private async countFor(tx: Store, ctx: Ctx, countId: Id) {
    await tx.lock?.('itemCounts', countId);
    const c = await tx.get('itemCounts', countId);
    if (!c || !this.visibleTo(ctx, c.partyIds)) throw new NotFound('Count');
    if (c.closed) throw new BadRequest('This count is closed.');
    if (c.startedById !== ctx.user.id && !this.has(ctx, c.partyId, 'store', 'manager', 'ops')) throw new ItemDenied('Only the counting team scans.');
    return c;
  }

  private async countOne(tx: Store, ctx: Ctx, c: ItemCount, item: PhysicalItem): Promise<{ count: ItemCount; status: 'already' | 'expected' | 'extra' }> {
    if (c.found.includes(item.id) || c.extra.includes(item.id)) return { count: c, status: 'already' };
    const expected = c.expected.includes(item.id);
    await this.event(tx, ctx, { kind: 'count_found', itemId: item.id, lotId: null, qty: null, from: null, to: null, ownerFrom: null, ownerTo: null, movementId: null, caseId: null, note: `Counted at ${c.where.label}${expected ? '' : ' (not expected here)'}`, partyIds: uniq([...item.partyIds, c.partyId]) });
    const out = await tx.update('itemCounts', c.id, expected ? { found: [...c.found, item.id] } : { extra: [...c.extra, item.id] });
    return { count: out, status: expected ? 'expected' : 'extra' };
  }

  private async countScan(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.scan' }>) {
    const c = await this.countFor(tx, ctx, a.countId);
    const item = await this.scanned(tx, a.label);
    if (!item) throw new BadRequest('That label or tag is not registered. Keep the item aside and open a case.');
    const r = await this.countOne(tx, ctx, c, item);
    return { already: r.status === 'already', expected: r.status === 'expected', count: r.count };
  }

  /**
   * Many RFID reads at once from a handheld or gate reader (a pasted or uploaded list). Repeated reads of one tag
   * count once. Unknown tags are listed back, never registered: a person checks the item.
   */
  private async countScanMany(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.scanMany' }>) {
    let c = await this.countFor(tx, ctx, a.countId);
    const reads = uniq((a.reads ?? []).map((r) => parseRfid(r) ?? parseLabel(r)).map((p) => (typeof p === 'string' ? p : p.ok ? p.token : null)).filter((x): x is string => !!x));
    if ((a.reads ?? []).length > 2000) throw new BadRequest('Send at most 2,000 reads at a time.');
    if (!reads.length) throw new BadRequest('No RFID tag or label in the reads.');
    const out = { found: 0, extra: 0, already: 0, unknown: [] as string[], unreadable: (a.reads ?? []).filter((r) => !parseRfid(r) && !parseLabel(r).ok).length };
    for (const r of reads) {
      const item = await this.scanned(tx, r);
      if (!item) {
        out.unknown.push(r);
        continue;
      }
      const res = await this.countOne(tx, ctx, c, item);
      c = res.count;
      if (res.status === 'expected') out.found++;
      else if (res.status === 'extra') out.extra++;
      else out.already++;
    }
    return { ...out, count: c };
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

  /** Not scanned means not found yet, never lost. Movements after the cut-off are listed, not counted against the store. */
  private async countClose(tx: Store, ctx: Ctx, a: Extract<ItemAction, { kind: 'count.close' }>) {
    await tx.lock?.('itemCounts', a.countId);
    const c = await tx.get('itemCounts', a.countId);
    if (!c || !this.visibleTo(ctx, c.partyIds)) throw new NotFound('Count');
    if (c.closed) throw new BadRequest('Already closed.');
    if (!this.has(ctx, c.partyId, 'store', 'manager', 'ops', 'it')) throw new ItemDenied('Only the counting company closes the count.');
    const events = await tx.list('itemEvents');
    const movedAfter = c.expected.filter((id) => !c.found.includes(id) && events.some((e) => e.itemId === id && e.at > c.cutoffAt && ['dispatch', 'issue', 'return', 'receive', 'repair_out'].includes(e.kind)));
    const notFound = c.expected.filter((id) => !c.found.includes(id) && !movedAfter.includes(id));
    for (const id of notFound) {
      const item = (await tx.get('physicalItems', id))!;
      await this.openCase(tx, ctx, { kind: 'count_not_found', itemId: id, partyId: c.partyId, note: `${labelDisplay(item.token)} not found in the count at ${c.where.label}. Recount before anything is adjusted.`, partyIds: uniq([...item.partyIds, c.partyId]) });
    }
    for (const id of c.extra) {
      const item = (await tx.get('physicalItems', id))!;
      await this.openCase(tx, ctx, { kind: 'count_extra', itemId: id, partyId: c.partyId, note: `${labelDisplay(item.token)} found at ${c.where.label} but recorded as ${STATE(item)}.`, partyIds: uniq([...item.partyIds, c.partyId]) });
    }
    return tx.update('itemCounts', c.id, { closed: { by: ctx.user.name, byId: ctx.user.id, at: ctx.at, notFound, movedAfterCutoff: movedAfter } });
  }
}

function STATE(i: PhysicalItem) {
  return `${i.state.replace('_', ' ')} (${i.custody.label})`;
}
