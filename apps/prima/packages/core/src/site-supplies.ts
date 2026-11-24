// Part T (Fitri package, papers T-D1..T-D9 sent by Fauzan 13 Nov 2026; answers T-X1..T-X9 and round 2): ONE site
// supplies request (Permohonan Pesanan Barang) for cleaning (KBK), Nepali guard (PKK Nepal) and local guard (PKK) sites.
// The differences are settings per contract type, never separate screens. Steps: request (the OM enters it for the
// supervisor, patrolling officer or themselves; per-guard lines build the summary) -> first check (Nepal, Gov Ops HQ
// admin executive) -> order confirm (OGM or a deputy the OGM names; never the requester) -> storekeeper stock check ->
// Procurement executive decides issue or buy (buy lines become one linked purchase per category, normal purchase rules)
// -> issue (cleaning delivery that takes stock off the store; guard pieces through the Goodwill handover; bulk to the
// site, counted first, then handed out). Plus store and site Min/Max (never invented), the uniform record per guard,
// returns at guard change, exit and contract end, and disposal with marks removed. Never a pay deduction.
// Stored in prima.stock_requests (Part I module) with kind 'site_supplies' and its helper kinds; no new table.
import { can, GOV_OPS_COMPANY_ID, isCentralEmployer, isGroupLeader, AccessDenied } from './access';
import { actsAsOpsDirector, isGovOm, isOgm, isOpsDirector, isPrivateOm } from './ops-access';
import { RULES } from './rules';
import { BadRequest, NotFound, UNIFORM_REQUEST_RULE, type HomeItem, type PrimaService, type ProofInput } from './service';
import type { Store } from './store';
import { addDays, dateOf, daysBetween } from './time';
import { stockStatus, type CleaningStockEntry } from './cleaning';
import { addMonthsIso } from './work';
import { workingDaysUntil } from './fw-moves';
import { holidayDates } from './hr-leave';
import { simplePdf } from './simple-pdf';
import { expandKit, isKit, wearKey, wornItemIds } from './item-kits';
import type { AuthorityGrant, Id, IsoDate, IsoDateTime, PurCategory, Site, StockIssue, StockItem, StockRequest, User } from './types';

export type SupplyContract = 'KBK' | 'PKK_NEPAL' | 'PKK';
export const SUPPLY_CONTRACTS: SupplyContract[] = ['KBK', 'PKK_NEPAL', 'PKK'];
/** The papers' own words, so staff recognise them. */
export type SupplyRequestStatus = 'baharu' | 'semakan_awal' | 'kelulusan' | 'diluluskan' | 'ditolak' | 'tindakan' | 'siap';
export const SUPPLY_STATUS_LABEL: Record<SupplyRequestStatus, string> = {
  baharu: 'Baharu',
  semakan_awal: 'Dalam Semakan Awal',
  kelulusan: 'Dalam Kelulusan',
  diluluskan: 'Diluluskan',
  ditolak: 'Ditolak',
  tindakan: 'Dalam Tindakan',
  siap: 'Siap',
};
type Step = { step: string; by: string; byId: Id; at: IsoDateTime; note: string };
export interface SupplyLine {
  n: number;
  stockItemId: Id;
  itemName: string;
  itemKind: StockItem['kind'];
  size: string | null;
  qty: number;
  purpose: string;
  area: string | null;
  /** A guard's own piece: one line per guard (Nepal and any guard uniform). */
  personId: Id | null;
  personName: string | null;
  staffNo: string | null;
  /** KBK: the site supply or equipment the line refills (the delivery counts against it). */
  supplyId: Id | null;
  equipmentId: Id | null;
  /** Above the site Max: the reason the requester gave (T1). */
  maxReason: string | null;
  allowance: { pieces: number; early: boolean; paid: { receiptNo: string; amount: number } | null } | null;
  confirmedQty: number | null;
  changes: { from: number; to: number; reason: string; by: string; at: IsoDateTime }[];
  storeCan: number | null;
  decision: 'issue' | 'buy' | null;
  purRequestId: Id | null;
  issued: { at: IsoDateTime; by: string; qty: number; via: 'delivery' | 'issue' | 'bulk'; refId: Id; condition: 'new' | 'good_used' } | null;
  /** Part U15: the OGM released this line's reservation with a reason (the stock is free for others again). */
  released?: { by: string; byId: Id; at: IsoDateTime; reason: string } | null;
  /** The set this line came from, when a whole set was asked for (23 Nov 2026); each part is its own line. */
  kitOf?: { id: Id; name: string; sets?: number } | null;
}
/** Part U6: the store's finer steps while a request is "Dalam Tindakan". */
export const STORE_STAGES = ['prepared', 'pic', 'ready'] as const;
export const STORE_STAGE_LABEL: Record<(typeof STORE_STAGES)[number], string> = { prepared: 'Stok disediakan', pic: 'Disemak oleh PIC', ready: 'Sedia untuk dihantar' };
export const DELIVERY_METHODS = ['own_vehicle', 'courier', 'supplier', 'collected'] as const;
export interface SupplyRequestData {
  ref: string;
  contract: SupplyContract;
  siteId: Id;
  siteName: string;
  siteCompanyId: Id;
  zone: string;
  /** 'office': the Inventory Manager, Procurement executive, OGM or Operations Director started it (23 Nov 2026). */
  startedBy: { role: 'supervisor' | 'patrol_officer' | 'om' | 'office'; name: string };
  /** The OM or Regional OM who receives the goods at the site; the requester when an OM asked. */
  receiverId?: Id;
  receiverName?: string;
  /** Items for a new site being started (23 Nov 2026): cleaning lines need no existing site supply to refill. */
  forNewSite?: boolean;
  omPhone: string;
  notes: string;
  alsoSentBy: { channel: 'paper' | 'email' | 'sharepoint' | null; ref: string; docIds: Id[] };
  lines: SupplyLine[];
  status: SupplyRequestStatus;
  steps: Step[];
  doneOn: IsoDate | null;
  /** Part U6: Stock Prepared -> Checked by PIC (a second store person) -> Ready for Delivery, each with who and when. */
  storeStages?: { stage: (typeof STORE_STAGES)[number]; by: string; byId: Id; at: IsoDateTime; note: string }[];
  /** Part U16: how it went (own vehicle, courier, supplier delivers, collected); recorded, no rule. */
  deliveryMethod?: (typeof DELIVERY_METHODS)[number] | null;
}
type ContractSetting = { prefix: string; label: string; startedBy: string; firstCheck: boolean; bulkCount: boolean; responsible: boolean };
export interface SupplySettings {
  contracts: Record<SupplyContract, ContractSetting>;
  handOutDays: number;
  rosterDays: number;
  primaOnlyFrom: IsoDate | null;
  /** A deputy the OGM (or the Operations Director for a private store) names to confirm orders. */
  deputyUserId: Id | null;
  history: { at: IsoDateTime; by: string; note: string }[];
}
type BulkLine = { n: number; stockItemId: Id; itemName: string; qty: number; personId: Id | null; personName: string | null; arrived: number | null; damaged: number | null; handedOut: Id | null };
export interface SupplyBulk {
  requestId: Id;
  ref: string;
  siteId: Id;
  siteName: string;
  omUserId: Id;
  omName: string;
  lines: BulkLine[];
  sentAt: IsoDateTime;
  sentBy: string;
  counted: { at: IsoDateTime; by: string; note: string; proofIds: Id[]; /** Part U16: the site copy of the DO signed (photo in proofIds). */ doSigned?: boolean } | null;
}

/** A row update never carries its id or company (the store refuses to change them). */
function patchOf<T extends { id: unknown; companyId: unknown }>(r: T): Omit<T, 'id' | 'companyId'> {
  const { id: _id, companyId: _co, ...rest } = r;
  void _id;
  void _co;
  return rest;
}
const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const int = (v: unknown, what: string, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(`${what}: a whole number from ${min} to ${max}.`);
  return n;
};
const CATEGORY: Record<StockItem['kind'], PurCategory> = { UNIFORM: 'UNIFORM', EQUIPMENT: 'GUARD_EQUIPMENT', DEVICE: 'DEVICE', PATROL_DEVICE: 'PATROL_DEVICE', CLEANING: 'CLEANING' };
const REQUEST_STEPS: SupplyRequestStatus[] = ['baharu', 'semakan_awal', 'kelulusan', 'diluluskan', 'tindakan'];

export class SiteSuppliesService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private svc: PrimaService,
  ) {}
  private now() {
    return this.clock();
  }
  private today(): IsoDate {
    return dateOf(this.clock());
  }
  private async need() {
    if (this.store.hasTable && !(await this.store.hasTable('stockRequests')))
      throw new BadRequest('Site supplies requests are not installed in this database yet (module uniform-requests-v1, run by the CEO).');
  }
  private async rows(storeIds?: Id[]): Promise<StockRequest[]> {
    if (this.store.hasTable && !(await this.store.hasTable('stockRequests'))) return [];
    return (await this.store.list('stockRequests', storeIds ? { companyId: storeIds } : {}).catch(() => [])) as StockRequest[];
  }
  private dataOf(r: StockRequest): SupplyRequestData {
    return r.ss as unknown as SupplyRequestData;
  }

  // ---------- who is who ----------
  /** The store that serves a site: Goodwill for government contracts, otherwise the site's own company (T-X7). */
  storeOf(site: Site): Id {
    return site.sector === 'government' ? GOV_OPS_COMPANY_ID : site.companyId;
  }
  private storeRole(user: User, storeId: Id) {
    return this.svc.ssPurRole(user, storeId);
  }
  /** Order confirmer (T-X1): the OGM (government store) or Operations Director (private store), or the named deputy. */
  private isConfirmer(user: User, storeId: Id, set: SupplySettings): boolean {
    if (user.integration) return false;
    if (set.deputyUserId && user.id === set.deputyUserId) return true;
    return storeId === GOV_OPS_COMPANY_ID ? isOgm(user) : actsAsOpsDirector(user);
  }
  /** Nepal first checker (T-X3): the HQ admin executive of the store's company (Gov Ops HQ for government sites). */
  private isFirstChecker(user: User, storeId: Id): boolean {
    return !user.integration && user.role === 'admin_exec' && user.companyIds.includes(storeId);
  }
  /** Read-only overview (T3): the OGM, Operations Director, COO, CEO and group leaders. */
  private isWatcher(user: User): boolean {
    return !user.integration && (isOgm(user) || isOpsDirector(user) || user.opsTier === 'coo' || user.opsTier === 'ceo' || isGroupLeader(user));
  }
  private async site(siteId: unknown): Promise<Site> {
    const site = await this.store.get('sites', s(siteId, 160));
    if (!site) throw new NotFound('Site');
    return site;
  }
  /** The OM or Regional OM covering the site (cleaning access 'manage'), who enters the request. */
  private async isRequester(user: User, site: Site): Promise<boolean> {
    if (user.integration || user.role !== 'pwvsb_officer' || user.department !== 'operations') return false;
    if (user.opsTier !== 'om' && user.opsTier !== 'regional') return false;
    return (await this.svc.cleaning.access(user, site)) === 'manage';
  }
  /**
   * Fauzan, 23 Nov 2026: "inventory manager or ogm should be able to start item needs, like we start a new site". Besides
   * the OM, the office side may start a request: the Inventory Manager or the Procurement executive (any store they
   * run), the OGM (a government site) and the Operations Director (a private site of a company they cover). The goods
   * still go to the OM covering the site, who counts them there.
   */
  private async isOfficeRequester(user: User, site: Site, grants?: AuthorityGrant[]): Promise<boolean> {
    if (user.integration) return false;
    const storeId = this.storeOf(site);
    if (user.department === 'procurement' && (user.procRole === 'manager' || user.procRole === 'executive') && this.storeRole(user, storeId) === 'proc') return true;
    if (storeId === GOV_OPS_COMPANY_ID) return isOgm(user);
    return isOpsDirector(user) && can(user, grants ?? (await this.store.list('grants')), this.today(), 'view', site.companyId);
  }
  /** The OMs and Regional OMs covering the site: the people who can receive and count the goods there. */
  private async receiversOf(site: Site): Promise<User[]> {
    const users = ((await this.store.list('users')) as User[]).filter((u) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'operations' && (u.opsTier === 'om' || u.opsTier === 'regional') && !u.accessClosed);
    const out: User[] = [];
    for (const u of users) if (await this.isRequester(u, site)) out.push(u);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Who receives at the site: the receiver named on the request, else (older requests) the OM who asked. */
  private receiverOf(r: StockRequest): Id {
    return this.dataOf(r).receiverId ?? r.requestedById;
  }
  /** The confirmer for this request: the OGM, Operations Director or named deputy, never the person who asked. */
  private confirmsThis(user: User, r: { companyId?: Id; storeId?: Id; requestedById: Id }, set: SupplySettings): boolean {
    return !user.integration && r.requestedById !== user.id && this.isConfirmer(user, (r.storeId ?? r.companyId)!, set);
  }
  /**
   * Fauzan, 23 Nov 2026 ("No need, they have the power to start it"): when the confirmer (the OGM, the Operations
   * Director or the named deputy) starts the request themselves, it is confirmed as it reaches the confirmation step.
   */
  private selfConfirm(d: SupplyRequestData, requester: User | undefined, storeId: Id, set: SupplySettings, at: IsoDateTime): Step[] {
    if (d.status !== 'kelulusan' || !requester || !this.isConfirmer(requester, storeId, set)) return [];
    for (const l of d.lines) if (l.confirmedQty === null) l.confirmedQty = l.qty;
    d.status = 'diluluskan';
    return [{ step: 'confirm', by: requester.name, byId: requester.id, at, note: 'started by the confirmer, approved as asked (Fauzan, 23 Nov 2026)' }];
  }


  // ---------- settings ----------
  async settings(storeId: Id): Promise<SupplySettings> {
    const R = RULES.siteSupplies.value;
    const row = (await this.store.get('stockRequests', `ss-settings-${storeId}`).catch(() => undefined)) as StockRequest | undefined;
    const d = (row?.ss ?? {}) as Partial<SupplySettings>;
    const contracts = { ...R.contracts } as Record<SupplyContract, ContractSetting>;
    for (const c of SUPPLY_CONTRACTS) contracts[c] = { ...R.contracts[c], ...(d.contracts?.[c] ?? {}) };
    return {
      contracts,
      handOutDays: d.handOutDays ?? R.handOutDays,
      rosterDays: d.rosterDays ?? R.rosterDays,
      primaOnlyFrom: d.primaOnlyFrom ?? R.primaOnlyFrom,
      deputyUserId: d.deputyUserId ?? null,
      history: d.history ?? [],
    };
  }
  /** The OGM (Goodwill store) or the Operations Director (a private store) changes the settings, with a reason. */
  private async setSettings(user: User, i: Record<string, unknown>) {
    await this.need();
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    if (!(storeId === GOV_OPS_COMPANY_ID ? isOgm(user) : isOpsDirector(user) && can(user, await this.store.list('grants'), this.today(), 'view', storeId)))
      throw new AccessDenied('view', '(the OGM or the Operations Director changes the supplies settings)');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say why the setting changes.');
    const cur = await this.settings(storeId);
    const next: SupplySettings = { ...cur, contracts: { ...cur.contracts } };
    const c = SUPPLY_CONTRACTS.find((x) => x === i.contract);
    if (c) {
      const p = (i.patch ?? {}) as Record<string, unknown>;
      next.contracts[c] = { ...cur.contracts[c] };
      for (const k of ['firstCheck', 'bulkCount', 'responsible'] as const) if (typeof p[k] === 'boolean') next.contracts[c][k] = p[k] as boolean;
    }
    if (i.handOutDays != null) next.handOutDays = int(i.handOutDays, 'Hand-out days', 1, 365);
    if (i.primaOnlyFrom !== undefined) {
      const d = i.primaOnlyFrom === null || i.primaOnlyFrom === '' ? null : s(i.primaOnlyFrom, 10);
      if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequest('Give the date as YYYY-MM-DD, or leave it empty.');
      next.primaOnlyFrom = d;
    }
    if (i.deputyUserId !== undefined) {
      const id = s(i.deputyUserId, 160) || null;
      if (id) {
        const u = await this.store.get('users', id);
        if (!u || u.integration) throw new BadRequest('Choose a staff member as the deputy.');
      }
      next.deputyUserId = id;
    }
    const at = this.now();
    next.history = [...cur.history, { at, by: user.name, note: reason }].slice(-100);
    const id = `ss-settings-${storeId}`;
    return this.store.transaction(async (tx) => {
      await tx.lock?.('stockRequests', id);
      const row = await tx.get('stockRequests', id);
      if (row) await tx.update('stockRequests', id, { ss: next as unknown as Record<string, unknown> });
      else await tx.insert('stockRequests', this.shell(id, storeId, 'ss_settings', next as unknown as Record<string, unknown>, user, at, 'Supplies settings'));
      await tx.audit({ at, actor: user.name, companyId: storeId, action: 'supplies.settings', entity: 'stock_request', entityId: id, summary: `Supplies settings changed by ${user.name}: ${reason}` });
      return next;
    });
  }
  /** The common shape for a non-uniform row in prima.stock_requests (the Part I fields are filled, unused). */
  private shell(id: Id, storeId: Id, kind: NonNullable<StockRequest['kind']>, ss: Record<string, unknown>, user: User, at: IsoDateTime, title: string, extra: Partial<StockRequest> = {}): StockRequest {
    return {
      id,
      companyId: storeId,
      personId: '',
      personName: '',
      staffNo: '',
      billTo: storeId,
      stockItemId: '',
      itemName: title.slice(0, 160),
      qty: 0,
      reason: '',
      history: { pieces: 0, last: null },
      early: false,
      guardPays: null,
      requestedAt: at,
      requestedBy: user.name,
      requestedById: user.id,
      status: 'open',
      decided: null,
      kind,
      ss,
      ...extra,
    };
  }

  /** The site's contract type (T2): set by the OM or OGM; until set, KBK for a cleaning site, otherwise PKK Local. */
  async contractOf(site: Site): Promise<{ contract: SupplyContract; set: boolean }> {
    const row = (await this.store.get('stockRequests', `ss-site-${site.id}`).catch(() => undefined)) as StockRequest | undefined;
    const c = SUPPLY_CONTRACTS.find((x) => x === row?.ss?.contract);
    if (c) return { contract: c, set: true };
    const cleaning = await this.store.get('cleaningSites', `clean-${site.id}`).catch(() => undefined);
    return { contract: cleaning ? 'KBK' : 'PKK', set: false };
  }
  private async setSiteType(user: User, i: Record<string, unknown>) {
    await this.need();
    const site = await this.site(i.siteId);
    const storeId = this.storeOf(site);
    const ok = (await this.isRequester(user, site)) || (storeId === GOV_OPS_COMPANY_ID ? isOgm(user) : isOpsDirector(user));
    if (!ok) throw new AccessDenied('view', '(the OM or the OGM sets the site contract type)');
    const contract = SUPPLY_CONTRACTS.find((x) => x === i.contract);
    if (!contract) throw new BadRequest('Choose KBK, PKK Nepal or PKK Local.');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say why (for example: the guards at this site are Nepali).');
    const at = this.now();
    const id = `ss-site-${site.id}`;
    return this.store.transaction(async (tx) => {
      await tx.lock?.('stockRequests', id);
      const row = await tx.get('stockRequests', id);
      const ss = { siteId: site.id, contract, by: user.name, at, reason };
      if (row) await tx.update('stockRequests', id, { ss });
      else await tx.insert('stockRequests', this.shell(id, storeId, 'ss_site', ss, user, at, `Contract type ${site.name}`));
      await tx.audit({ at, actor: user.name, companyId: storeId, action: 'supplies.site_type', entity: 'stock_request', entityId: id, summary: `${site.name}: contract type ${contract} (${reason})` });
      return ss;
    });
  }

  /** The sites this person may ask supplies for, so nobody types a site ID (23 Nov 2026). */
  private async startSites(user: User) {
    const out: { id: Id; name: string; companyId: Id; sector: string | null }[] = [];
    const grants = isOpsDirector(user) ? await this.store.list('grants') : [];
    for (const site of (await this.store.list('sites')) as Site[]) {
      if ((await this.isRequester(user, site)) || (await this.isOfficeRequester(user, site, grants))) out.push({ id: site.id, name: site.name, companyId: site.companyId, sector: site.sector ?? null });
      if (out.length >= 2000) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- the request (T1) ----------
  /** What the OM sees when asking: store list, site supplies and equipment, stock on hand, days left and on the way. */
  private async options(user: User, i: Record<string, unknown>) {
    const site = await this.site(i.siteId);
    const om = await this.isRequester(user, site);
    const office = !om && (await this.isOfficeRequester(user, site));
    if (!om && !office && !this.isWatcher(user)) throw new AccessDenied('view', '(the OM covering the site, the Inventory Manager, the OGM or the Operations Director)');
    const storeId = this.storeOf(site);
    const [items, { contract, set }, settings, setup, entries, open] = await Promise.all([
      this.store.list('stockItems', { companyId: [storeId] }),
      this.contractOf(site),
      this.settings(storeId),
      this.store.get('cleaningSites', `clean-${site.id}`).catch(() => undefined),
      this.store.list('cleaningStock', { companyId: site.companyId, siteId: site.id }).catch(() => [] as CleaningStockEntry[]),
      this.rows([storeId]),
    ]);
    const st = setup ? stockStatus(setup, entries) : null;
    const onTheWay = new Map<Id, number>();
    for (const r of open.filter((x) => x.kind === 'site_supplies')) {
      const d = this.dataOf(r);
      if (d.siteId !== site.id || !REQUEST_STEPS.includes(d.status)) continue;
      for (const l of d.lines) if (!l.issued) onTheWay.set(l.stockItemId, (onTheWay.get(l.stockItemId) ?? 0) + (l.confirmedQty ?? l.qty));
    }
    return {
      site: { id: site.id, name: site.name, companyId: site.companyId },
      storeId,
      asOffice: office,
      receivers: office ? (await this.receiversOf(site)).map((u) => ({ id: u.id, name: u.name })) : [],
      contract,
      contractSet: set,
      setting: settings.contracts[contract],
      primaOnlyFrom: settings.primaOnlyFrom,
      items: items
        .map((it) => ({
          id: it.id,
          name: it.name,
          kind: it.kind,
          size: it.size,
          onHand: it.onHand,
          onTheWay: onTheWay.get(it.id) ?? 0,
          min: it.reorderAt,
          max: it.maxAt ?? null,
          // A set lists its parts; a part names the set(s) it belongs to, so a single part can be asked for alone.
          kit: isKit(it) ? (it.kitParts ?? []).map((p) => { const x = items.find((y) => y.id === p.stockItemId); return { name: x ? `${x.name}${x.size ? ` (${x.size})` : ''}` : '(missing)', qty: p.qty }; }) : null,
          partOf: items.filter((k) => k.kitParts?.some((p) => p.stockItemId === it.id)).map((k) => k.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      supplies: (st?.supplies ?? []).map((x) => ({ id: x.supply.id, name: x.supply.name, unit: x.supply.unit, onHand: x.onHand, daysLeft: x.daysLeft, min: x.supply.minOnHand ?? null, max: x.supply.maxOnHand ?? null, flags: x.flags })),
      equipment: (st?.equipment ?? []).map((x) => ({ id: x.equipment.id, name: x.equipment.name, required: x.equipment.required, working: x.working })),
    };
  }

  private async person(user: User, staffNo: unknown) {
    const no = s(staffNo, 40).toUpperCase();
    if (!no) return null;
    const p = (await this.store.list('people', { staffNo: no })).find((x) => x.status === 'active');
    if (!p || isCentralEmployer(p.companyId) || !['guard', 'patrol_officer', 'supervisor'].includes(p.role) || !can(user, await this.store.list('grants'), this.today(), 'view', p.companyId))
      throw new BadRequest(`No active guard, officer or supervisor with staff number ${no} that you cover.`);
    return p;
  }

  private async request(user: User, i: Record<string, unknown>) {
    await this.need();
    const site = await this.site(i.siteId);
    const asOm = await this.isRequester(user, site);
    const asOffice = !asOm && (await this.isOfficeRequester(user, site));
    if (!asOm && !asOffice) throw new AccessDenied('view', '(the OM or Regional OM covering the site, the Inventory Manager, the OGM or the Operations Director asks for supplies)');
    const storeId = this.storeOf(site);
    const R = RULES.siteSupplies.value;
    const settings = await this.settings(storeId);
    const { contract } = await this.contractOf(site);
    const cs = settings.contracts[contract];
    // The office side asks in its own name; the goods go to the OM covering the site, who counts them there.
    let receiver: User = user;
    if (asOffice) {
      const rid = s(i.receiverUserId, 160);
      const found = rid ? (await this.receiversOf(site)).find((u) => u.id === rid) : undefined;
      if (!found) throw new BadRequest('Choose the OM or Regional OM covering the site, who receives and counts the goods there. A new site needs its OM set first.');
      receiver = found;
    }
    const startedRole = asOffice ? ('office' as const) : ((['supervisor', 'patrol_officer', 'om'] as const).find((x) => x === i.startedByRole) ?? (cs.startedBy as 'supervisor' | 'patrol_officer' | 'om'));
    const startedName = startedRole === 'om' || startedRole === 'office' ? user.name : s(i.startedByName, 120);
    if (!startedName) throw new BadRequest(startedRole === 'supervisor' ? 'Name the cleaning supervisor who asked.' : 'Name the patrolling officer who asked.');
    const forNewSite = i.forNewSite === true;
    const given = Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : [];
    if (!given.length) throw new BadRequest('Add at least one line (item and quantity).');
    const [items, setup, entries, all] = await Promise.all([
      this.store.list('stockItems', { companyId: [storeId] }),
      this.store.get('cleaningSites', `clean-${site.id}`).catch(() => undefined),
      this.store.list('cleaningStock', { companyId: site.companyId, siteId: site.id }).catch(() => [] as CleaningStockEntry[]),
      this.rows([storeId]),
    ]);
    // A whole set becomes one line per part (23 Nov 2026); a single part is asked for on its own line.
    const raw: Record<string, unknown>[] = [];
    for (const [k, l] of given.entries()) {
      const kit = items.find((x) => x.id === l.stockItemId);
      if (!kit || !isKit(kit)) {
        raw.push(l);
        continue;
      }
      const sets = int(l.qty, `Line ${k + 1} sets`, 1, 1_000);
      for (const p of expandKit(kit, sets, items)) raw.push({ ...l, stockItemId: p.item.id, qty: p.qty, size: '', kitOf: { id: kit.id, name: kit.name, sets } });
    }
    if (raw.length > R.maxLines) throw new BadRequest(`At most ${R.maxLines} lines in one request (a set counts one line per part).`);
    const st = setup ? stockStatus(setup, entries) : null;
    // Everything a guard wears counts toward the allowance, item by item (Fauzan, 23 Nov 2026).
    const worn = wornItemIds(items);
    const keyOf = new Map(items.map((x) => [x.id, wearKey(x)]));
    const open = all.filter((r) => r.kind === 'site_supplies' && REQUEST_STEPS.includes(this.dataOf(r).status) && this.dataOf(r).siteId === site.id);
    const today = this.today();
    const lines: SupplyLine[] = [];
    const waitingPieces = new Map<Id, number>();
    for (const [k, l] of raw.entries()) {
      const at = `Line ${k + 1}`;
      const item = items.find((x) => x.id === l.stockItemId);
      if (!item) throw new BadRequest(`${at}: choose an item from the store list.`);
      const qty = int(l.qty, `${at} quantity`, 1, 10_000);
      const purpose = s(l.purpose, 200);
      const area = s(l.area, 80) || null;
      const p = await this.person(user, l.staffNo);
      let supplyId: Id | null = null;
      let equipmentId: Id | null = null;
      if (contract === 'KBK' && !p) {
        supplyId = setup?.supplies.find((x) => x.id === l.supplyId)?.id ?? null;
        equipmentId = setup?.equipment.find((x) => x.id === l.equipmentId)?.id ?? null;
        // A new site has nothing to refill yet: its first supplies go as a bulk delivery, counted at the site.
        if (!supplyId && !equipmentId && !forNewSite) throw new BadRequest(`${at}: pick the site supply or equipment it refills, give a staff number for a personal item, or mark the request as items for a new site.`);
      }
      if (contract === 'PKK_NEPAL' && worn.has(item.id) && !p) throw new BadRequest(`${at}: a uniform for a Nepal site is asked one line per guard (give the staff number).`);
      // Only one open request per site per item (and per guard for a personal piece): the duplicate is shown, not added.
      const dup = open.find((r) => this.dataOf(r).lines.some((x) => x.stockItemId === item.id && (x.personId ?? '') === (p?.id ?? '') && !x.issued));
      if (dup) throw new BadRequest(`${at}: ${item.name}${p ? ` for ${p.name}` : ''} is already on open request ${this.dataOf(dup).ref}.`);
      if (lines.some((x) => x.stockItemId === item.id && (x.personId ?? '') === (p?.id ?? ''))) throw new BadRequest(`${at}: ${item.name} is already on this request${l.kitOf ? ' (asked separately and inside a set)' : ''}.`);
      let maxReason: string | null = null;
      const sup = supplyId ? st?.supplies.find((x) => x.supply.id === supplyId) : undefined;
      if (sup && sup.supply.maxOnHand != null && (sup.onHand ?? 0) + qty > sup.supply.maxOnHand) {
        maxReason = s(l.maxReason);
        if (!maxReason) throw new BadRequest(`${at}: this would take ${sup.supply.name} above the site Max of ${sup.supply.maxOnHand}. Give a reason.`);
      }
      // The uniform allowance (Part I, Fauzan 6 Nov 2026; round 2 13 Nov 2026) on every guard line: 3 free in 12
      // months, every piece after the 3rd paid by the person with a receipt, no upper limit while the setting is empty.
      let allowance: SupplyLine['allowance'] = null;
      if (p && worn.has(item.id)) {
        const key = keyOf.get(item.id)!;
        const h = await this.svc.ssUniformHistory(p.id, storeId, key);
        const U = { ...UNIFORM_REQUEST_RULE, freePerYear: h.free, paidMaxPerYear: UNIFORM_REQUEST_RULE.paidMaxPerYear === null ? null : UNIFORM_REQUEST_RULE.paidMaxPerYear * h.perSuit };
        const wk = `${p.id}|${key}`;
        const waiting =
          (waitingPieces.get(wk) ?? 0) +
          all
            .filter((r) => r.status === 'open' && ((r.kind ?? 'uniform') === 'uniform' ? r.personId === p.id && keyOf.get(r.stockItemId ?? '') === key : false))
            .reduce((n, r) => n + r.qty, 0) +
          open.reduce((n, r) => n + this.dataOf(r).lines.filter((x) => x.personId === p.id && !x.issued && keyOf.get(x.stockItemId) === key).reduce((m, x) => m + (x.confirmedQty ?? x.qty), 0), 0);
        const after = h.pieces + waiting + qty;
        if (U.paidMaxPerYear !== null && after > U.paidMaxPerYear) throw new BadRequest(`${at}: ${p.name} would have ${after} x ${item.name} in 12 months. No more than ${U.paidMaxPerYear}.`);
        let paid: { receiptNo: string; amount: number } | null = null;
        if (after > U.freePerYear) {
          const g = (l.paid ?? {}) as Record<string, unknown>;
          const receiptNo = s(g.receiptNo, 60);
          const amount = Math.round(Number(g.amount) * 100) / 100;
          if (!receiptNo || !(amount > 0))
            throw new BadRequest(`${at}: ${p.name} would have ${after} x ${item.name} in 12 months; ${U.freePerYear} are free. Every piece after that is paid by the person: give the receipt number and amount. It is never taken from pay.`);
          paid = { receiptNo, amount };
        }
        const early = !!h.last && addMonthsIso(h.last, U.everyMonths) > today;
        if (early && !purpose) throw new BadRequest(`${at}: ${p.name} had ${item.name} within 6 months. Say why in the purpose.`);
        allowance = { pieces: h.pieces, early, paid };
        waitingPieces.set(wk, (waitingPieces.get(wk) ?? 0) + qty);
      }
      lines.push({
        n: k + 1,
        stockItemId: item.id,
        itemName: item.name,
        itemKind: item.kind,
        size: s(l.size, 20) || item.size,
        qty,
        purpose,
        area,
        personId: p?.id ?? null,
        personName: p?.name ?? null,
        staffNo: p?.staffNo ?? null,
        supplyId,
        equipmentId,
        maxReason,
        allowance,
        confirmedQty: null,
        changes: [],
        storeCan: null,
        decision: null,
        purRequestId: null,
        issued: null,
        kitOf: (l.kitOf as SupplyLine['kitOf']) ?? null,
      });
    }
    // "Also sent by" (T-X2): during the changeover the paper form, email or SharePoint upload runs as well.
    const ch = (['paper', 'email', 'sharepoint'] as const).find((x) => x === i.alsoSentBy) ?? null;
    if (settings.primaOnlyFrom && today >= settings.primaOnlyFrom && ch) throw new BadRequest(`From ${settings.primaOnlyFrom} supplies are asked in Prima only; no paper, email or SharePoint copy.`);
    const chRef = s(i.alsoSentRef, 80);
    const proof = Array.isArray(i.paperPhoto) ? (i.paperPhoto as ProofInput[]) : [];
    const rec = proof.length ? this.svc.ssProof(user, storeId, null, proof, true) : { photos: [], docs: [] };
    const prefix = cs.prefix;
    const ymd = today.replace(/-/g, '');
    const same = all.filter((r) => r.kind === 'site_supplies' && this.dataOf(r).ref.startsWith(`${prefix}-${ymd}-`)).length;
    const ref = `${prefix}-${ymd}-${String(same + 1).padStart(3, '0')}`;
    const at = this.now();
    const status: SupplyRequestStatus = i.draft === true ? 'baharu' : cs.firstCheck ? 'semakan_awal' : 'kelulusan';
    const d: SupplyRequestData = {
      ref,
      contract,
      siteId: site.id,
      siteName: site.name,
      siteCompanyId: site.companyId,
      zone: s(i.zone, 60) || site.state || '',
      startedBy: { role: startedRole, name: startedName },
      receiverId: receiver.id,
      receiverName: receiver.name,
      ...(forNewSite ? { forNewSite: true } : {}),
      omPhone: s(i.omPhone, 30),
      notes: s(i.notes, 500),
      alsoSentBy: { channel: ch, ref: chRef, docIds: rec.docs.map((x) => x.id) },
      lines,
      status,
      steps: [{ step: status === 'baharu' ? 'draft' : 'submit', by: user.name, byId: user.id, at, note: '' }],
      doneOn: null,
    };
    d.steps.push(...this.selfConfirm(d, user, storeId, settings, at));
    const id = `ss-${storeId}-${ref}`.toLowerCase();
    const total = lines.reduce((n, l) => n + l.qty, 0);
    const row = this.shell(id, storeId, 'site_supplies', d as unknown as Record<string, unknown>, user, at, `${ref} ${site.name}`, {
      billTo: site.companyId,
      qty: total,
      reason: lines.map((l) => l.purpose).filter(Boolean).join('; ').slice(0, 300),
    });
    return this.store.transaction(async (tx) => {
      if (rec.docs.length) await this.svc.ssSaveProof(tx, rec);
      await tx.insert('stockRequests', row);
      await tx.audit({ at, actor: user.name, companyId: storeId, action: 'supplies.request', entity: 'stock_request', entityId: id, summary: `${ref} for ${site.name} (${contract}): ${lines.length} lines, ${total} pieces, started by ${startedName}${asOffice ? `, to ${receiver.name}` : ''}${forNewSite ? ', new site' : ''}${ch ? `; also sent by ${ch}${chRef ? ` ${chRef}` : ''}` : ''}` });
      return this.view0(row);
    });
  }

  /** The summary per item and size, built by the app so nobody types it (T1). */
  summary(d: SupplyRequestData) {
    const m = new Map<string, { item: string; size: string | null; qty: number; guards: number }>();
    for (const l of d.lines) {
      const k = `${l.stockItemId}|${l.size ?? ''}`;
      const cur = m.get(k) ?? { item: l.itemName, size: l.size, qty: 0, guards: 0 };
      cur.qty += l.confirmedQty ?? l.qty;
      if (l.personId) cur.guards += 1;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => a.item.localeCompare(b.item));
  }
  private view0(r: StockRequest, holidays: Set<IsoDate> = new Set()) {
    const d = this.dataOf(r);
    return { id: r.id, storeId: r.companyId, requestedBy: r.requestedBy, requestedById: r.requestedById, requestedAt: r.requestedAt, ...d, statusLabel: SUPPLY_STATUS_LABEL[d.status], summary: this.summary(d), times: this.stageTimes(d, holidays) };
  }
  /**
   * Part U7: hours per stage from the steps already kept: Order (request to approval), Receiving (approval to stock
   * checked), Preparation (stock checked to ready for delivery), Delivery (ready to Siap). U-X11: in-stock lines are
   * due "Sedia untuk dihantar" within 7 working days of approval; a line sent to purchase stops that clock and the
   * requester sees "dalam pembelian, akan lewat".
   */
  stageTimes(d: SupplyRequestData, holidays: Set<IsoDate>) {
    const at = (step: string) => d.steps.find((x) => x.step === step)?.at ?? null;
    const sub = d.steps.find((x) => x.step === 'submit')?.at ?? d.steps[0]?.at ?? null;
    const appr = at('confirm');
    const checked = at('stock_check');
    const ready = (d.storeStages ?? []).find((x) => x.stage === 'ready')?.at ?? null;
    const done = at('close');
    const h = (a: string | null, b: string | null) => (a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / 3_600_000) * 10) / 10 : null);
    const set = RULES.inventoryControl.value;
    const inStock = d.lines.some((l) => l.decision === 'issue');
    const buying = d.lines.some((l) => l.decision === 'buy' && !l.issued);
    const used = appr ? workingDaysUntil(dateOf(appr), ready ? dateOf(ready) : this.today(), holidays) : null;
    return {
      order: h(sub, appr),
      receiving: h(appr, checked),
      preparation: h(checked, ready),
      delivery: h(ready, done),
      readyTargetDays: inStock ? set.inStockReadyDays : null,
      readyWorkingDays: used,
      readyLate: inStock && used !== null && used > set.inStockReadyDays && (!buying || d.lines.some((l) => l.decision === 'issue' && !l.issued)),
      buyingNotice: buying ? 'dalam pembelian, akan lewat' : null,
    };
  }
  /** Part U15: quantity of an item reserved by approved "issue from stock" lines not yet issued, released or closed. */
  async reservedQty(storeId: Id, itemId: Id, exceptRequestId: Id | null, via: Store = this.store) {
    const rows = ((await via.list('stockRequests', { companyId: [storeId] }).catch(() => [])) as StockRequest[]).filter((r) => r.kind === 'site_supplies' && r.id !== exceptRequestId);
    let n = 0;
    for (const r of rows) {
      const d = this.dataOf(r);
      if (d.status !== 'tindakan') continue;
      for (const l of d.lines) if (l.stockItemId === itemId && l.decision === 'issue' && !l.issued && !l.released) n += l.confirmedQty ?? 0;
    }
    return n;
  }
  private async holidays(): Promise<Set<IsoDate>> {
    return holidayDates(((await this.store.list('publicHolidays', {}).catch(() => [])) ?? []) as never, null);
  }

  private async load(id: unknown) {
    const rid = s(id, 200);
    await this.store.lock?.('stockRequests', rid);
    const r = (await this.store.get('stockRequests', rid)) as StockRequest | undefined;
    if (!r || r.kind !== 'site_supplies') throw new NotFound('Supplies request');
    return { r, d: structuredClone(this.dataOf(r)) };
  }
  private async save(user: User, r: StockRequest, d: SupplyRequestData, step: string, note: string, extra: (tx: Store) => Promise<void> = async () => {}, after: Step[] = []) {
    const at = this.now();
    d.steps = [...d.steps, { step, by: user.name, byId: user.id, at, note }, ...after];
    const closed = d.status === 'siap' || d.status === 'ditolak';
    const status: StockRequest['status'] = d.status === 'ditolak' ? 'refused' : d.status === 'siap' ? 'issued' : 'open';
    return this.store.transaction(async (tx) => {
      await extra(tx);
      await tx.update('stockRequests', r.id, { ss: d as unknown as Record<string, unknown>, status, ...(closed ? { decided: { at, by: user.name, byId: user.id, note } } : {}) });
      await tx.audit({ at, actor: user.name, companyId: r.companyId, action: `supplies.${step}`, entity: 'stock_request', entityId: r.id, summary: `${d.ref} ${d.siteName}: ${step} by ${user.name}, now ${SUPPLY_STATUS_LABEL[d.status]}${note ? ` (${note.slice(0, 200)})` : ''}` });
      return this.view0({ ...r, ss: d as unknown as Record<string, unknown>, status });
    });
  }

  /** The OM submits a draft (a patrolling officer's draft later, T2) or a request returned by the first check. */
  private async submit(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    if (r.requestedById !== user.id) throw new AccessDenied('view', '(the OM who entered the request submits it)');
    if (d.status !== 'baharu') throw new BadRequest(`${d.ref} is ${SUPPLY_STATUS_LABEL[d.status]}.`);
    const set = await this.settings(r.companyId);
    d.status = set.contracts[d.contract].firstCheck ? 'semakan_awal' : 'kelulusan';
    const after = this.selfConfirm(d, user, r.companyId, set, this.now());
    return this.save(user, r, d, 'submit', s(i.note), undefined, after);
  }
  private async cancel(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    if (r.requestedById !== user.id) throw new AccessDenied('view', '(only the person who asked cancels a request)');
    if (!['baharu', 'semakan_awal', 'kelulusan'].includes(d.status)) throw new BadRequest('Only a request not yet confirmed can be cancelled.');
    const note = s(i.note);
    if (!note) throw new BadRequest('Say why it is cancelled.');
    d.status = 'ditolak';
    return this.save(user, r, d, 'cancel', note);
  }

  // ---------- T3a first check (Nepal) ----------
  private async rosterGaps(d: SupplyRequestData, days: number) {
    const ids = d.lines.map((l) => l.personId).filter((x): x is Id => !!x);
    if (!ids.length) return [];
    const from = addDays(this.today(), -days);
    const shifts = await this.store.list('shifts', { companyId: [d.siteCompanyId] }).catch(() => []);
    const on = new Set(shifts.filter((x) => x.siteId === d.siteId && x.date >= from && x.personId).map((x) => x.personId as Id));
    return d.lines.filter((l) => l.personId && !on.has(l.personId)).map((l) => ({ n: l.n, personName: l.personName, staffNo: l.staffNo }));
  }
  private async firstCheck(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    if (!this.isFirstChecker(user, r.companyId)) throw new AccessDenied('view', '(the HQ admin executive does the first check)');
    if (r.requestedById === user.id) throw new BadRequest('Nobody checks their own request.');
    if (d.status !== 'semakan_awal') throw new BadRequest(`${d.ref} is ${SUPPLY_STATUS_LABEL[d.status]}, not waiting for the first check.`);
    const note = s(i.note);
    if (i.ok === true) {
      const set = await this.settings(r.companyId);
      const gaps = await this.rosterGaps(d, set.rosterDays);
      if (gaps.length && !note) throw new BadRequest(`${gaps.length} guard(s) on the lines were not on this site's roster in the last ${set.rosterDays} days. Say why it is still complete, or return it.`);
      d.status = 'kelulusan';
      const after = this.selfConfirm(d, await this.store.get('users', r.requestedById), r.companyId, set, this.now());
      return this.save(user, r, d, 'first_check', note || 'complete and matches the site roster', undefined, after);
    }
    if (!note) throw new BadRequest('Say why it is returned.');
    d.status = 'baharu';
    return this.save(user, r, d, 'first_check_return', note);
  }

  // ---------- T3b order confirm ----------
  private async confirm(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    const set = await this.settings(r.companyId);
    if (r.requestedById === user.id) throw new BadRequest('Nobody confirms their own request.');
    if (!this.confirmsThis(user, r, set)) throw new AccessDenied('view', '(the OGM or the deputy the OGM names confirms orders)');
    if (d.status !== 'kelulusan') throw new BadRequest(`${d.ref} is ${SUPPLY_STATUS_LABEL[d.status]}, not waiting for confirmation.`);
    const note = s(i.note);
    if (i.approve === false) {
      if (!note) throw new BadRequest('Say why the order is rejected.');
      d.status = 'ditolak';
      return this.save(user, r, d, 'reject', note);
    }
    const at = this.now();
    for (const c of Array.isArray(i.changes) ? (i.changes as Record<string, unknown>[]) : []) {
      const l = d.lines.find((x) => x.n === Number(c.n));
      if (!l) throw new BadRequest('A change names a line that is not on the request.');
      const to = int(c.qty, `Line ${l.n} quantity`, 0, 10_000);
      const reason = s(c.reason);
      if (!reason) throw new BadRequest(`Line ${l.n}: say why the quantity changes.`);
      const from = l.confirmedQty ?? l.qty;
      if (to > l.qty) throw new BadRequest(`Line ${l.n}: confirm at most the ${l.qty} asked; ask the OM for a new request for more.`);
      if (to !== from) l.changes.push({ from, to, reason, by: user.name, at });
      l.confirmedQty = to;
    }
    for (const l of d.lines) if (l.confirmedQty === null) l.confirmedQty = l.qty;
    if (!d.lines.some((l) => (l.confirmedQty ?? 0) > 0)) throw new BadRequest('Every line is 0. Reject the order instead, with a reason.');
    d.status = 'diluluskan';
    return this.save(user, r, d, 'confirm', note || 'confirmed');
  }

  // ---------- T3c storekeeper stock check ----------
  private async stockCheck(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    if (this.storeRole(user, r.companyId) !== 'store') throw new AccessDenied('view', '(a storekeeper checks the stock)');
    if (d.status !== 'diluluskan') throw new BadRequest(`${d.ref} is ${SUPPLY_STATUS_LABEL[d.status]}, not waiting for the stock check.`);
    const items = new Map((await this.store.list('stockItems', { companyId: [r.companyId] })).map((x) => [x.id, x]));
    const given = new Map((Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : []).map((x) => [Number(x.n), x]));
    for (const l of d.lines) {
      const want = l.confirmedQty ?? 0;
      const g = given.get(l.n);
      const onHand = items.get(l.stockItemId)?.onHand ?? 0;
      l.storeCan = g ? int(g.can, `Line ${l.n} the store can give`, 0, Math.max(0, Math.min(want, onHand))) : Math.min(want, onHand);
    }
    return this.save(user, r, d, 'stock_check', s(i.note));
  }

  // ---------- T3d inventory check: issue or buy ----------
  private async decide(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    if (this.storeRole(user, r.companyId) !== 'proc') throw new AccessDenied('view', '(the Procurement executive decides issue or buy)');
    if (d.status !== 'diluluskan') throw new BadRequest(`${d.ref} is ${SUPPLY_STATUS_LABEL[d.status]}.`);
    if (d.lines.some((l) => (l.confirmedQty ?? 0) > 0 && l.storeCan === null)) throw new BadRequest('A storekeeper checks the stock first.');
    if (r.requestedById === user.id) throw new BadRequest('Nobody decides their own request.');
    const given = new Map((Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : []).map((x) => [Number(x.n), x]));
    const buy: { l: SupplyLine; unitPrice: number }[] = [];
    for (const l of d.lines) {
      if ((l.confirmedQty ?? 0) === 0) continue;
      const g = given.get(l.n);
      const decision = g?.decision === 'buy' ? 'buy' : g?.decision === 'issue' ? 'issue' : (l.storeCan ?? 0) >= (l.confirmedQty ?? 0) ? 'issue' : null;
      if (!decision) throw new BadRequest(`Line ${l.n} (${l.itemName}): the store has ${l.storeCan} of ${l.confirmedQty}. Choose issue (send what there is) or buy.`);
      if (decision === 'issue' && (l.storeCan ?? 0) < 1) throw new BadRequest(`Line ${l.n}: nothing in the store to issue; choose buy.`);
      if (decision === 'issue' && (l.storeCan ?? 0) < (l.confirmedQty ?? 0)) l.confirmedQty = l.storeCan;
      l.decision = decision;
      if (decision === 'buy') {
        const unitPrice = Math.round(Number(g?.unitPrice) * 100) / 100;
        if (!(unitPrice > 0)) throw new BadRequest(`Line ${l.n}: give an estimated unit price for the purchase.`);
        buy.push({ l, unitPrice });
      }
    }
    // "Buy" lines go to Procurement as ONE purchase per category, linked back (PurRequest.siteRequestIds). From there
    // Prima's normal purchase rules apply (3 quotes + online, delegation tiers, PO, goods received, e-Invoice).
    const byCat = new Map<PurCategory, { l: SupplyLine; unitPrice: number }[]>();
    for (const b of buy) byCat.set(CATEGORY[b.l.itemKind], [...(byCat.get(CATEGORY[b.l.itemKind]) ?? []), b]);
    for (const [category, ls] of byCat) {
      const pr = (await this.svc.raisePurRequest(user, r.companyId, {
        title: `${d.ref} ${d.siteName}`.slice(0, 120),
        category,
        lines: ls.map(({ l, unitPrice }) => ({ item: `${l.itemName}${l.size ? ` (${l.size})` : ''}`.slice(0, 80), stockItemId: l.stockItemId, qty: l.confirmedQty ?? l.qty, unitPrice })),
      })) as { id: Id };
      await this.store.update('purRequests', pr.id, { siteRequestIds: [r.id] });
      for (const { l } of ls) l.purRequestId = pr.id;
    }
    d.status = 'tindakan';
    // Part U15: "issue" lines reserve available stock; the item row is locked so two approvals cannot take the same last unit.
    const issueLines = d.lines.filter((l) => l.decision === 'issue' && (l.confirmedQty ?? 0) > 0);
    return this.save(user, r, d, 'decide', s(i.note) || `${buy.length} line(s) to buy, the rest from stock`, async (tx) => {
      const need = new Map<Id, number>();
      for (const l of issueLines) need.set(l.stockItemId, (need.get(l.stockItemId) ?? 0) + (l.confirmedQty ?? 0));
      for (const [itemId, q] of [...need].sort((a, b) => a[0].localeCompare(b[0]))) {
        await tx.lock?.('stockItems', itemId);
        const it = await tx.get('stockItems', itemId);
        const avail = (it?.onHand ?? 0) - (await this.reservedQty(r.companyId, itemId, r.id, tx));
        if (q > avail) throw new BadRequest(`${it?.name ?? itemId}: only ${Math.max(0, avail)} available (${it?.onHand ?? 0} on hand, the rest reserved for approved requests). Choose buy, or the OGM releases a reservation.`);
      }
    });
  }

  // ---------- T3e issue ----------
  private async issue(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    const role = this.storeRole(user, r.companyId);
    if (role !== 'store' && role !== 'proc') throw new AccessDenied('view', '(the store issues)');
    if (d.status !== 'tindakan') throw new BadRequest(`${d.ref} is ${SUPPLY_STATUS_LABEL[d.status]}, not ready to issue.`);
    if (r.requestedById === user.id) throw new BadRequest('The person who asked does not issue to themselves.');
    const set = await this.settings(r.companyId);
    const bulkOn = set.contracts[d.contract].bulkCount;
    const condition = i.condition === 'good_used' ? 'good_used' : 'new';
    const wanted = new Set((Array.isArray(i.lines) ? (i.lines as unknown[]) : d.lines.map((l) => l.n)).map(Number));
    const ready: SupplyLine[] = [];
    for (const l of d.lines) {
      if (!wanted.has(l.n) || l.issued || (l.confirmedQty ?? 0) === 0) continue;
      if (l.decision === 'buy') {
        const pr = l.purRequestId ? await this.store.get('purRequests', l.purRequestId) : undefined;
        if (!pr || (pr.status !== 'received' && pr.status !== 'posted')) continue;
      }
      ready.push(l);
    }
    if (!ready.length) throw new BadRequest('Nothing to issue yet: every chosen line is issued, or its purchase is not received.');
    // Part U6: with the PIC check on for this store, a line leaves only after "Sedia untuk dihantar".
    const picOn = RULES.inventoryControl.value.picStores.includes(r.companyId);
    if (picOn && !(d.storeStages ?? []).some((x) => x.stage === 'ready')) throw new BadRequest('Mark the goods prepared, checked by the PIC (a second store person) and ready for delivery first.');
    // Part U2: nothing leaves during a major count (unless the OGM lets one urgent move through).
    for (const l of ready) await this.svc.inventory.assertMovable(r.companyId, l.stockItemId, l.confirmedQty ?? l.qty, 'issue');
    const method = DELIVERY_METHODS.find((x) => x === i.method) ?? null;
    if (method) d.deliveryMethod = method;
    const site = await this.site(d.siteId);
    const at = this.now();
    const omId = this.receiverOf(r);
    const om = await this.store.get('users', omId);
    // Guard pieces with the bulk switch off: the existing Goodwill issue and handover per guard (store -> OM -> patrol -> guard).
    const direct = ready.filter((l) => l.personId && !bulkOn && d.contract !== 'KBK');
    for (const l of direct) {
      const iss = (await this.svc.stockIssue(user, r.companyId, {
        itemId: l.stockItemId,
        personId: l.personId!,
        qty: l.confirmedQty ?? l.qty,
        forRequestId: r.id,
        omUserId: omId,
        ...(typeof i.patrolPersonId === 'string' ? { patrolPersonId: i.patrolPersonId } : {}),
        ...(Array.isArray(i.slip) ? { slip: i.slip as ProofInput[] } : {}),
      })) as StockIssue;
      await this.store.update('stockIssues', iss.id, { condition, requestId: r.id });
      l.issued = { at, by: user.name, qty: l.confirmedQty ?? l.qty, via: 'issue', refId: iss.id, condition };
    }
    const kbk = ready.filter((l) => !l.personId && d.contract === 'KBK' && (l.supplyId || l.equipmentId));
    const bulk = ready.filter((l) => !direct.includes(l) && !kbk.includes(l));
    const takeOff = [...kbk, ...bulk];
    const delivery: CleaningStockEntry | null = kbk.length
      ? {
          id: `cstk-${d.siteId}-${toStamp(at)}-${r.id.slice(-6)}`.slice(0, 160),
          companyId: site.companyId,
          siteId: d.siteId,
          kind: 'delivery',
          date: this.today(),
          supplies: kbk.filter((l) => l.supplyId).map((l) => ({ supplyId: l.supplyId!, sent: l.confirmedQty ?? l.qty, counted: null, stockItemId: l.stockItemId, area: l.area, condition })),
          equipment: kbk.filter((l) => l.equipmentId && !l.supplyId).map((l) => ({ equipmentId: l.equipmentId!, sent: l.confirmedQty ?? l.qty, working: null, broken: null })),
          note: `${d.ref}`,
          by: user.name,
          byId: user.id,
          at,
          received: null,
          proofIds: [],
          requestId: r.id,
        }
      : null;
    const bulkId = bulk.length ? `ssb-${r.id}-${d.steps.length}`.slice(0, 160) : null;
    const bulkRow: SupplyBulk | null = bulk.length
      ? {
          requestId: r.id,
          ref: d.ref,
          siteId: d.siteId,
          siteName: d.siteName,
          omUserId: omId,
          omName: om?.name ?? d.receiverName ?? r.requestedBy,
          lines: bulk.map((l) => ({ n: l.n, stockItemId: l.stockItemId, itemName: l.itemName, qty: l.confirmedQty ?? l.qty, personId: l.personId, personName: l.personName, arrived: null, damaged: null, handedOut: null })),
          sentAt: at,
          sentBy: user.name,
          counted: null,
        }
      : null;
    for (const l of kbk) l.issued = { at, by: user.name, qty: l.confirmedQty ?? l.qty, via: 'delivery', refId: delivery!.id, condition };
    for (const l of bulk) l.issued = { at, by: user.name, qty: l.confirmedQty ?? l.qty, via: 'bulk', refId: bulkId!, condition };
    return this.save(user, r, d, 'issue', `${ready.length} line(s)`, async (tx) => {
      // T5: the store's onHand goes down in the same transaction; the item row is locked and never goes below zero.
      for (const l of takeOff) {
        await tx.lock?.('stockItems', l.stockItemId);
        const it = await tx.get('stockItems', l.stockItemId);
        const q = l.confirmedQty ?? l.qty;
        if (!it || it.onHand < q) throw new BadRequest(`${l.itemName}: only ${it?.onHand ?? 0} in the store, ${q} needed.`);
        const held = await this.reservedQty(r.companyId, it.id, r.id, tx);
        if (q > it.onHand - held) throw new BadRequest(`${l.itemName}: only ${Math.max(0, it.onHand - held)} available, ${q} needed (the rest is reserved for other approved requests).`);
        if (it.opening && !it.opening.confirmed) throw new BadRequest(`${it.name}: the opening stock is not confirmed yet.`);
        await tx.update('stockItems', it.id, { onHand: it.onHand - q });
      }
      if (delivery) await tx.insert('cleaningStock', delivery);
      if (bulkRow && bulkId) await tx.insert('stockRequests', this.shell(bulkId, r.companyId, 'ss_bulk', bulkRow as unknown as Record<string, unknown>, user, at, `${d.ref} bulk to ${d.siteName}`, { requestedById: omId, requestedBy: om?.name ?? r.requestedBy }));
    });
  }

  // ---------- T6 bulk: count at the site first, then hand out ----------
  private async loadBulk(id: unknown) {
    const bid = s(id, 200);
    await this.store.lock?.('stockRequests', bid);
    const row = (await this.store.get('stockRequests', bid)) as StockRequest | undefined;
    if (!row || row.kind !== 'ss_bulk') throw new NotFound('Bulk delivery');
    return { row, b: structuredClone(row.ss as unknown as SupplyBulk) };
  }
  private async bulkCount(user: User, i: Record<string, unknown>) {
    const { row, b } = await this.loadBulk(i.id);
    if (user.id !== b.omUserId) throw new AccessDenied('view', '(the OM who receives the bulk delivery counts it)');
    if (b.counted) throw new BadRequest('This delivery is already counted.');
    const site = await this.site(b.siteId);
    const rec = this.svc.ssProof(user, row.companyId, site, Array.isArray(i.proof) ? (i.proof as ProofInput[]) : []);
    if (!rec.photos.length && !rec.docs.length) throw new BadRequest('Attach a photo of what arrived.');
    const given = new Map((Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : []).map((x) => [Number(x.n), x]));
    for (const l of b.lines) {
      const g = given.get(l.n);
      if (!g) throw new BadRequest(`Count every line (0 if nothing arrived): ${l.itemName} is missing.`);
      l.arrived = int(g.arrived, `${l.itemName} arrived`, 0, l.qty);
      l.damaged = int(g.damaged ?? 0, `${l.itemName} damaged`, 0, l.arrived);
    }
    const note = s(i.note);
    // Part U16: the receiver signs the site copy of the DO; the photo of it goes with the count.
    if (i.doSigned !== true) throw new BadRequest('Sign the site copy of the delivery order (DO) and attach its photo.');
    const short = b.lines.filter((l) => (l.arrived ?? 0) < l.qty || (l.damaged ?? 0) > 0);
    if (short.length && !note) throw new BadRequest('Some lines are short or damaged. Say what happened.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const ids = await this.svc.ssSaveProof(tx, rec);
      b.counted = { at, by: user.name, note, proofIds: ids, doSigned: true };
      await tx.update('stockRequests', row.id, { ss: b as unknown as Record<string, unknown> });
      await tx.audit({ at, actor: user.name, companyId: row.companyId, action: 'supplies.bulk_count', entity: 'stock_request', entityId: row.id, summary: `${b.ref} at ${b.siteName}: counted${short.length ? `, ${short.length} line(s) short or damaged` : ', all as sent'}` });
      return b;
    });
  }
  /** After the count the OM hands each piece to the guard: the usual patrolling officer and guard handover steps. */
  private async handOut(user: User, i: Record<string, unknown>) {
    const { row, b } = await this.loadBulk(i.id);
    if (user.id !== b.omUserId) throw new AccessDenied('view', '(the OM hands out the pieces)');
    if (!b.counted) throw new BadRequest('Count what arrived at the site first, then hand out.');
    const l = b.lines.find((x) => x.n === Number(i.n));
    if (!l || !l.personId) throw new BadRequest('Choose a line for a guard.');
    if (l.handedOut) throw new BadRequest(`${l.itemName} for ${l.personName} is already handed out.`);
    const good = (l.arrived ?? 0) - (l.damaged ?? 0);
    if (good < 1) throw new BadRequest('Nothing good arrived on this line to hand out.');
    const person = await this.store.get('people', l.personId);
    if (!person || person.status !== 'active') throw new BadRequest('The guard is no longer active. Return the piece to the store.');
    let patrol: NonNullable<StockIssue['handover']>['patrol'] = null;
    if (person.role !== 'patrol_officer') {
      const po = typeof i.patrolPersonId === 'string' ? await this.store.get('people', i.patrolPersonId) : undefined;
      if (po) {
        if (po.status !== 'active' || po.role !== 'patrol_officer' || po.companyId !== person.companyId) throw new BadRequest(`Choose the patrolling officer of ${person.name}'s company.`);
        patrol = { personId: po.id, name: po.name, step: null };
      }
    }
    const at = this.now();
    const iss: StockIssue = {
      id: `iss-${row.companyId}-ssb-${toStamp(at)}-${l.n}`.slice(0, 160),
      companyId: row.companyId,
      itemId: l.stockItemId,
      personId: person.id,
      personName: person.name,
      qty: good,
      issuedAt: at,
      issuedBy: `${b.sentBy} (bulk ${b.ref})`,
      acknowledged: false,
      confirmedAt: null,
      ...(row.companyId === GOV_OPS_COMPANY_ID ? { billTo: person.companyId } : {}),
      handover: { omUserId: b.omUserId, omName: b.omName, om: { at: b.counted.at, by: b.counted.by }, patrol },
      serial: null,
      disputed: null,
      returned: null,
      condition: 'new',
      requestId: b.requestId,
    } as StockIssue;
    l.handedOut = iss.id;
    return this.store.transaction(async (tx) => {
      await tx.insert('stockIssues', iss);
      await tx.update('stockRequests', row.id, { ss: b as unknown as Record<string, unknown> });
      await tx.audit({ at, actor: user.name, companyId: row.companyId, action: 'supplies.hand_out', entity: 'stock_issue', entityId: iss.id, summary: `${b.ref}: ${good} x ${l.itemName} handed to ${person.name}${patrol ? ` through ${patrol.name}` : ''}; the guard signs on the OM's phone` });
      return iss;
    });
  }

  /** Siap when every line is delivered and confirmed, or closed by the OM or store with a reason (T3e). */
  private async lineDone(l: SupplyLine, bulks: Map<Id, SupplyBulk>): Promise<boolean> {
    if ((l.confirmedQty ?? 0) === 0) return true;
    if (!l.issued) return false;
    if (l.issued.via === 'delivery') return !!(await this.store.get('cleaningStock', l.issued.refId).catch(() => undefined))?.received;
    if (l.issued.via === 'issue') return !!(await this.store.get('stockIssues', l.issued.refId))?.acknowledged;
    const b = bulks.get(l.issued.refId);
    if (!b?.counted) return false;
    const bl = b.lines.find((x) => x.n === l.n);
    if (!bl?.personId) return true;
    if (!bl.handedOut) return false;
    return !!(await this.store.get('stockIssues', bl.handedOut))?.acknowledged;
  }
  // ---------- U6 store stages ----------
  private async stage(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    const role = this.storeRole(user, r.companyId);
    if (role !== 'store' && role !== 'proc') throw new AccessDenied('view', '(the store)');
    if (d.status !== 'tindakan') throw new BadRequest(`${d.ref} is ${SUPPLY_STATUS_LABEL[d.status]}.`);
    const stage = STORE_STAGES.find((x) => x === i.stage);
    if (!stage) throw new BadRequest('Choose prepared, checked by PIC or ready for delivery.');
    const st = d.storeStages ?? [];
    if (st.some((x) => x.stage === stage)) throw new BadRequest(`${STORE_STAGE_LABEL[stage]} is already recorded.`);
    const picOn = RULES.inventoryControl.value.picStores.includes(r.companyId);
    const prepared = st.find((x) => x.stage === 'prepared');
    if (stage !== 'prepared' && !prepared) throw new BadRequest('Mark the stock prepared first.');
    if (stage === 'pic') {
      if (prepared!.byId === user.id) throw new BadRequest('The PIC check is by a second store person, not the one who prepared the goods.');
      if (r.requestedById === user.id) throw new BadRequest('The person who asked does not check their own goods.');
    }
    if (stage === 'ready' && picOn && !st.some((x) => x.stage === 'pic')) throw new BadRequest('A second store person checks the packed goods against the request first (PIC).');
    d.storeStages = [...st, { stage, by: user.name, byId: user.id, at: this.now(), note: s(i.note) }];
    return this.save(user, r, d, `stage_${stage}`, STORE_STAGE_LABEL[stage]);
  }
  // ---------- U15 release a reservation ----------
  private async release(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    const mgmt = r.companyId === GOV_OPS_COMPANY_ID ? isOgm(user) : this.storeRole(user, r.companyId) === 'manager';
    if (!mgmt) throw new AccessDenied('view', '(the OGM releases a reservation)');
    const l = d.lines.find((x) => x.n === Number(i.n));
    if (!l || l.decision !== 'issue' || l.issued || l.released) throw new BadRequest('That line holds no reservation.');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say why the reserved stock is released.');
    l.released = { by: user.name, byId: user.id, at: this.now(), reason };
    return this.save(user, r, d, 'release', `line ${l.n} ${l.itemName}: ${reason}`);
  }
  // ---------- U16 delivery order ----------
  private async doPdf(user: User, i: Record<string, unknown>) {
    const r = (await this.store.get('stockRequests', s(i.id, 200))) as StockRequest | undefined;
    if (!r || r.kind !== 'site_supplies') throw new NotFound('Supplies request');
    const role = this.storeRole(user, r.companyId);
    if (role !== 'store' && role !== 'proc' && r.requestedById !== user.id && this.receiverOf(r) !== user.id && !this.isWatcher(user)) throw new AccessDenied('view', '(the store and the OM who asked)');
    const d = this.dataOf(r);
    const sent = d.lines.filter((l) => l.issued && l.issued.via !== 'issue');
    if (!sent.length) throw new BadRequest('Nothing has left the store for this request yet.');
    const page = (copy: string) => [
      `PESANAN PENGHANTARAN (DO) - ${copy}`,
      `Rujukan ${d.ref} | ${d.siteName} | ${d.contract} | Kaedah ${d.deliveryMethod ?? 'tidak direkod'}`,
      `Dikeluarkan ${sent[0].issued!.at.slice(0, 16).replace('T', ' ')} oleh ${sent[0].issued!.by}`,
      '',
      'No | Barang | Kuantiti | Penerima | Diterima | Rosak/Kurang',
      ...sent.map((l) => `${l.n} | ${l.itemName}${l.size ? ` (${l.size})` : ''} | ${l.issued!.qty} | ${l.personName ?? l.area ?? '-'} | ____ | ____`),
      '',
      'Penerima: semak, tandatangan dan laporkan kekurangan atau kerosakan sebelum rekod lengkap.',
      'Nama penerima: ____________________   Tandatangan: ____________   Tarikh: ________',
      '',
    ];
    return { name: `DO_${d.ref}.pdf`, base64: btoa(String.fromCharCode(...simplePdf([...page('SALINAN STOR'), ...page('SALINAN TAPAK')]))) };
  }

  private async close(user: User, i: Record<string, unknown>) {
    const { r, d } = await this.load(i.id);
    const role = this.storeRole(user, r.companyId);
    if (r.requestedById !== user.id && this.receiverOf(r) !== user.id && role !== 'store' && role !== 'proc') throw new AccessDenied('view', '(the OM who asked or the store closes a request)');
    if (d.status !== 'tindakan') throw new BadRequest(`${d.ref} is ${SUPPLY_STATUS_LABEL[d.status]}.`);
    const bulks = await this.bulksFor([r.companyId]);
    const done = (await Promise.all(d.lines.map((l) => this.lineDone(l, bulks)))).every(Boolean);
    const note = s(i.note);
    if (!done && !note) throw new BadRequest('Some lines are not delivered and confirmed yet. Give the reason to close it anyway.');
    d.status = 'siap';
    d.doneOn = this.today();
    return this.save(user, r, d, 'close', note || 'every line delivered and confirmed');
  }
  private async bulksFor(storeIds: Id[]) {
    return new Map((await this.rows(storeIds)).filter((x) => x.kind === 'ss_bulk').map((x) => [x.id, x.ss as unknown as SupplyBulk]));
  }

  // ---------- T4 Min / Max ----------
  /** The Procurement executive sets the store Min (reorderAt) and Max for an item, with a reason; history kept. */
  private async storeMinMax(user: User, i: Record<string, unknown>) {
    const id = s(i.stockItemId, 160);
    await this.store.lock?.('stockItems', id);
    const it = await this.store.get('stockItems', id);
    if (!it) throw new NotFound('Store item');
    if (this.storeRole(user, it.companyId) !== 'proc') throw new AccessDenied('view', '(the Procurement executive sets the store Min and Max)');
    const min = int(i.min, 'Min', 0, 1_000_000);
    const max = i.max === null || i.max === '' || i.max === undefined ? null : int(i.max, 'Max', 0, 1_000_000);
    if (max !== null && max < min) throw new BadRequest('Max cannot be below Min.');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say how the figure was set (for example: 3 months of real usage).');
    const at = this.now();
    const history = [...(it.minMaxHistory ?? []), { at, by: user.name, byId: user.id, min, max, reason }].slice(-50);
    return this.store.transaction(async (tx) => {
      await tx.update('stockItems', it.id, { reorderAt: min, maxAt: max, minMaxHistory: history });
      await tx.audit({ at, actor: user.name, companyId: it.companyId, action: 'store.min_max', entity: 'stock_item', entityId: it.id, summary: `${it.name}: Min ${min}, Max ${max ?? 'not set'} (${reason})` });
      return (await tx.get('stockItems', it.id))!;
    });
  }
  /** The OM proposes a site Min/Max for a cleaning supply; the OGM approves it (T-X1). */
  private async siteMinMax(user: User, i: Record<string, unknown>) {
    await this.need();
    const site = await this.site(i.siteId);
    if (!(await this.isRequester(user, site))) throw new AccessDenied('view', '(the OM covering the site proposes the site Min and Max)');
    const setup = await this.store.get('cleaningSites', `clean-${site.id}`);
    const sup = setup?.supplies.find((x) => x.id === i.supplyId);
    if (!sup) throw new BadRequest('Choose a supply on this site.');
    const min = i.min === null || i.min === '' ? null : int(i.min, 'Min', 0, 1_000_000);
    const max = i.max === null || i.max === '' ? null : int(i.max, 'Max', 0, 1_000_000);
    if (min !== null && max !== null && max < min) throw new BadRequest('Max cannot be below Min.');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say how the figure was set (real usage).');
    const storeId = this.storeOf(site);
    const at = this.now();
    const all = await this.rows([storeId]);
    if (all.some((x) => x.kind === 'ss_minmax' && x.status === 'open' && x.ss?.siteId === site.id && x.ss?.supplyId === sup.id)) throw new BadRequest(`A Min/Max for ${sup.name} is already waiting for the OGM.`);
    const id = `ssmm-${site.id}-${sup.id}-${toStamp(at)}`.slice(0, 160);
    const ss = { siteId: site.id, siteName: site.name, siteCompanyId: site.companyId, supplyId: sup.id, supplyName: sup.name, min, max, was: { min: sup.minOnHand ?? null, max: sup.maxOnHand ?? null }, reason };
    return this.store.transaction(async (tx) => {
      await tx.insert('stockRequests', this.shell(id, storeId, 'ss_minmax', ss, user, at, `Min/Max ${sup.name} ${site.name}`, { reason }));
      await tx.audit({ at, actor: user.name, companyId: storeId, action: 'supplies.site_min_max', entity: 'stock_request', entityId: id, summary: `${site.name} ${sup.name}: Min ${min ?? 'not set'}, Max ${max ?? 'not set'} proposed (${reason})` });
      return ss;
    });
  }
  private async decideMinMax(user: User, i: Record<string, unknown>) {
    const id = s(i.id, 200);
    await this.store.lock?.('stockRequests', id);
    const row = (await this.store.get('stockRequests', id)) as StockRequest | undefined;
    if (!row || row.kind !== 'ss_minmax') throw new NotFound('Min/Max proposal');
    if (!(row.companyId === GOV_OPS_COMPANY_ID ? isOgm(user) : actsAsOpsDirector(user))) throw new AccessDenied('view', '(the OGM approves a site Min and Max; the Operations Director for a private store)');
    if (row.requestedById === user.id) throw new BadRequest('Nobody approves their own proposal.');
    if (row.status !== 'open') throw new BadRequest('Already decided.');
    const note = s(i.note);
    const ok = i.ok === true;
    if (!ok && !note) throw new BadRequest('Say why it is not approved.');
    const ss = row.ss as { siteId: Id; supplyId: Id; min: number | null; max: number | null; siteName: string; supplyName: string };
    const at = this.now();
    return this.store.transaction(async (tx) => {
      if (ok) {
        await tx.lock?.('cleaningSites', `clean-${ss.siteId}`);
        const setup = await tx.get('cleaningSites', `clean-${ss.siteId}`);
        if (!setup) throw new NotFound('Cleaning set-up');
        const supplies = setup.supplies.map((x) => (x.id === ss.supplyId ? { ...x, minOnHand: ss.min, maxOnHand: ss.max } : x));
        await tx.update('cleaningSites', setup.id, { supplies });
      }
      await tx.update('stockRequests', id, { status: ok ? 'issued' : 'refused', decided: { at, by: user.name, byId: user.id, note } });
      await tx.audit({ at, actor: user.name, companyId: row.companyId, action: ok ? 'supplies.min_max.approve' : 'supplies.min_max.refuse', entity: 'stock_request', entityId: id, summary: `${ss.siteName} ${ss.supplyName}: Min ${ss.min ?? 'not set'}, Max ${ss.max ?? 'not set'} ${ok ? 'approved' : 'not approved'}${note ? ` (${note})` : ''}` });
      return { ok };
    });
  }

  // ---------- T9 Employee uniform record ----------
  /** One page per guard built from the store's issues: item, size, quantity, date, condition, handover, returned or lost. */
  private async uniformRecord(user: User, i: Record<string, unknown>) {
    const pid = s(i.personId, 160);
    const person = pid ? await this.store.get('people', pid) : (await this.store.list('people', { staffNo: s(i.staffNo, 40).toUpperCase() }))[0];
    if (!person) throw new NotFound('Person');
    const own = user.personId === person.id;
    const today = this.today();
    const g = await this.store.list('grants');
    const sees =
      own ||
      ((isGovOm(user, today) || isPrivateOm(user, today) || isOgm(user) || isOpsDirector(user) || user.department === 'procurement' || user.department === 'hr' || isGroupLeader(user)) &&
        can(user, g, today, 'view', person.companyId));
    if (!sees) throw new AccessDenied('view', '(the guard, the OM, the OGM, the store and HR see the uniform record)');
    const stores = [...new Set([GOV_OPS_COMPANY_ID, person.companyId])];
    const [issues, items] = await Promise.all([this.store.list('stockIssues', { companyId: stores }), this.store.list('stockItems', { companyId: stores })]);
    const byId = new Map(items.map((x) => [x.id, x]));
    const rows = issues
      .filter((x) => x.personId === person.id && ['UNIFORM', 'EQUIPMENT'].includes(byId.get(x.itemId)?.kind ?? ''))
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .map((x) => {
        const it = byId.get(x.itemId);
        return {
          issueId: x.id,
          item: it?.name ?? x.itemId,
          kind: it?.kind ?? null,
          size: it?.size ?? null,
          qty: x.qty,
          date: dateOf(x.issuedAt),
          condition: x.condition ?? null,
          handedBy: x.handover?.omName ?? x.issuedBy,
          signed: x.acknowledged,
          returned: x.returned ? { on: dateOf(x.returned.at), condition: x.returned.condition } : null,
          disposed: x.disposed ? dateOf(x.disposed.at) : null,
        };
      });
    return { person: { id: person.id, name: person.name, staffNo: person.staffNo, companyId: person.companyId }, rows, stillHeld: rows.filter((r) => !r.returned).length, note: 'Never a pay deduction for uniforms or lost items.' };
  }

  // ---------- T11 returns at guard change, exit and contract end ----------
  /** What a guard (or every guard of a site) still holds against the original issue. The OM records each return. */
  private async returnsList(user: User, i: Record<string, unknown>) {
    const today = this.today();
    if (!(isGovOm(user, today) || isPrivateOm(user, today) || isOgm(user) || isOpsDirector(user) || user.department === 'procurement' || isGroupLeader(user)))
      throw new AccessDenied('view', '(the OM, the OGM and the store)');
    const g = await this.store.list('grants');
    let people: Id[] = [];
    let siteName: string | null = null;
    if (i.siteId) {
      const site = await this.site(i.siteId);
      siteName = site.name;
      const from = addDays(today, -60);
      people = [...new Set((await this.store.list('shifts', { companyId: [site.companyId] })).filter((x) => x.siteId === site.id && x.date >= from && x.personId).map((x) => x.personId as Id))];
    } else if (i.personId) people = [s(i.personId, 160)];
    else throw new BadRequest('Choose a guard or a site.');
    const out = [];
    for (const pid of people.slice(0, 500)) {
      const p = await this.store.get('people', pid);
      if (!p || !can(user, g, today, 'view', p.companyId)) continue;
      const stores = [...new Set([GOV_OPS_COMPANY_ID, p.companyId])];
      const issues = (await this.store.list('stockIssues', { companyId: stores })).filter((x) => x.personId === pid);
      const held = issues.filter((x) => !x.returned);
      out.push({ personId: p.id, name: p.name, staffNo: p.staffNo, status: p.status, held: held.map((x) => ({ issueId: x.id, itemId: x.itemId, qty: x.qty, issuedOn: dateOf(x.issuedAt) })), returned: issues.filter((x) => x.returned).length });
    }
    return { siteName, rows: out.filter((r) => r.held.length || i.personId), note: 'Lost or damaged stays a case for the company manager. Never a pay deduction.' };
  }

  // ---------- T12 disposal with marks removed ----------
  private async dispose(user: User, i: Record<string, unknown>) {
    const id = s(i.issueId, 160);
    await this.store.lock?.('stockIssues', id);
    const x = await this.store.get('stockIssues', id);
    if (!x) throw new NotFound('Issue');
    const role = this.storeRole(user, x.companyId);
    if (role !== 'store' && role !== 'proc') throw new AccessDenied('view', '(the store decides a disposal)');
    if (!x.returned || !['damaged', 'worn'].includes(x.returned.condition)) throw new BadRequest('Only a returned damaged or worn piece is disposed of.');
    if (x.returned.condition === 'damaged' && x.returned.confirmed === null) throw new BadRequest('The company manager confirms the damage first.');
    if (x.returned.by === user.name) throw new BadRequest('The disposal is decided by someone other than the person who recorded the return.');
    if (x.disposed) throw new BadRequest('Already disposed of.');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Give the disposal reason.');
    const marked = i.marked !== false;
    const rec = this.svc.ssProof(user, x.companyId, null, Array.isArray(i.photo) ? (i.photo as ProofInput[]) : [], true);
    if (marked && i.marksRemoved !== true) throw new BadRequest('Tick "marks removed" (logo, name tag, beret badge) before disposal.');
    if (marked && !rec.docs.length) throw new BadRequest('Attach a photo showing the marks removed.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const ids = rec.docs.length ? await this.svc.ssSaveProof(tx, rec) : [];
      const disposed = { at, by: user.name, byId: user.id, reason, marked, marksRemoved: marked ? true : false, photoIds: ids };
      await tx.update('stockIssues', id, { disposed });
      await tx.audit({ at, actor: user.name, companyId: x.companyId, action: 'store.dispose', entity: 'stock_issue', entityId: id, summary: `${x.qty} x ${x.itemId} from ${x.personName} disposed of: ${reason}${marked ? '; marks removed, photo kept' : ''}` });
      return disposed;
    });
  }

  // ---------- board (T3 overview) ----------
  async board(user: User) {
    const today = this.today();
    const g = await this.store.list('grants');
    const visible = (await this.store.list('companies')).map((c) => c.id).filter((id) => can(user, g, today, 'view', id));
    const stores = [...new Set([GOV_OPS_COMPANY_ID, ...visible])];
    const all = await this.rows(stores);
    const watcher = this.isWatcher(user);
    const set = await this.settings(GOV_OPS_COMPANY_ID);
    const role = (co: Id) => this.storeRole(user, co);
    const reqs = all.filter((r) => r.kind === 'site_supplies');
    const mine = (r: StockRequest) => {
      const st = this.dataOf(r).status;
      if (r.requestedById === user.id || this.receiverOf(r) === user.id) return true;
      if (watcher) return true;
      const pr = role(r.companyId);
      if (pr === 'store' || pr === 'proc') return true;
      if (st === 'semakan_awal' && this.isFirstChecker(user, r.companyId)) return true;
      if (st === 'kelulusan' && this.confirmsThis(user, r, set)) return true;
      return false;
    };
    const hol = await this.holidays();
    const rows = reqs.filter(mine).map((r) => this.view0(r, hol));
    // Part U7: average and slowest hours per stage this month, so the bottleneck shows.
    const month = today.slice(0, 7);
    const stageStats = (['order', 'receiving', 'preparation', 'delivery'] as const).map((k) => {
      const v = rows.filter((r) => r.requestedAt.slice(0, 7) === month).map((r) => r.times[k]).filter((x): x is number => x !== null);
      return { stage: k, n: v.length, avgHours: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null, slowestHours: v.length ? Math.max(...v) : null, target: RULES.inventoryControl.value.stageTargets[k] };
    });
    const waitDays = (r: (typeof rows)[number]) => daysBetween(dateOf(r.steps.at(-1)!.at), today);
    const myTurn = (r: (typeof rows)[number]) =>
      (r.status === 'semakan_awal' && this.isFirstChecker(user, r.storeId) && r.requestedById !== user.id) ||
      (r.status === 'kelulusan' && this.confirmsThis(user, r, set)) ||
      (r.status === 'diluluskan' && r.lines.some((l) => (l.confirmedQty ?? 0) > 0 && l.storeCan === null) && role(r.storeId) === 'store') ||
      (r.status === 'diluluskan' && !r.lines.some((l) => (l.confirmedQty ?? 0) > 0 && l.storeCan === null) && role(r.storeId) === 'proc') ||
      (r.status === 'tindakan' && (role(r.storeId) === 'store' || role(r.storeId) === 'proc') && r.lines.some((l) => !l.issued && (l.confirmedQty ?? 0) > 0)) ||
      (r.status === 'baharu' && r.requestedById === user.id);
    const bulks = all
      .filter((x) => x.kind === 'ss_bulk')
      .map((x) => ({ id: x.id, ...(x.ss as unknown as SupplyBulk) }))
      .filter((b) => b.omUserId === user.id || watcher || role(GOV_OPS_COMPANY_ID) === 'store');
    const overdue = bulks.filter((b) => b.lines.some((l) => l.personId && !l.handedOut) && daysBetween(dateOf(b.sentAt), today) > set.handOutDays);
    const minmax = all.filter((x) => x.kind === 'ss_minmax' && x.status === 'open').map((x) => ({ id: x.id, by: x.requestedBy, byId: x.requestedById, at: x.requestedAt, ...(x.ss as Record<string, unknown>) }));
    const storeItems = (await this.store.list('stockItems', { companyId: stores.filter((co) => role(co) === 'store' || role(co) === 'proc' || watcher) }))
      .filter((it) => it.onHand < it.reorderAt || (it.maxAt != null && it.onHand > it.maxAt))
      .map((it) => ({ id: it.id, name: it.name, companyId: it.companyId, onHand: it.onHand, min: it.reorderAt, max: it.maxAt ?? null, flag: it.onHand < it.reorderAt ? 'below_min' : 'above_max' }));
    const byStep: Record<string, number> = {};
    for (const r of rows) if (REQUEST_STEPS.includes(r.status)) byStep[r.status] = (byStep[r.status] ?? 0) + 1;
    return {
      settings: set,
      labels: SUPPLY_STATUS_LABEL,
      canSet: isOgm(user),
      // The office side may start a request too (23 Nov 2026); the site is checked when they choose it.
      canStart: !user.integration && ((user.department === 'procurement' && (user.procRole === 'manager' || user.procRole === 'executive')) || isOgm(user) || isOpsDirector(user)),
      canConfirm: this.isConfirmer(user, GOV_OPS_COMPANY_ID, set),
      watcher,
      rows: rows
        .map((r) => ({ ...r, myTurn: myTurn(r), waitDays: waitDays(r) }))
        .sort((a, b) => Number(b.myTurn) - Number(a.myTurn) || b.requestedAt.localeCompare(a.requestedAt))
        .slice(0, 300),
      byStep,
      stageStats,
      stageLabels: STORE_STAGE_LABEL,
      bulks: bulks.slice(0, 100),
      overdue: overdue.map((b) => b.id),
      minmax: minmax.filter((m) => m.byId === user.id || isOgm(user) || isOpsDirector(user) || watcher),
      storeFlags: storeItems,
      channels: set.primaOnlyFrom && today >= set.primaOnlyFrom ? ['prima'] : ['prima', 'paper', 'email', 'sharepoint'],
    };
  }
  private async view(user: User, i: Record<string, unknown>) {
    const r = (await this.store.get('stockRequests', s(i.id, 200))) as StockRequest | undefined;
    if (!r || r.kind !== 'site_supplies') throw new NotFound('Supplies request');
    const b = await this.board(user);
    if (!b.rows.some((x) => x.id === r.id)) throw new NotFound('Supplies request');
    const d = this.dataOf(r);
    const set = await this.settings(r.companyId);
    return { ...this.view0(r), rosterGaps: d.status === 'semakan_awal' ? await this.rosterGaps(d, set.rosterDays) : [] };
  }

  async homeItems(user: User): Promise<HomeItem[]> {
    if (user.integration) return [];
    const b = await this.board(user).catch(() => null);
    if (!b) return [];
    const storeSide = user.department === 'procurement' || isOgm(user) || this.isWatcher(user);
    const go = storeSide ? { view: 'purchasing' as const, companyId: GOV_OPS_COMPANY_ID } : { view: 'mine' as const };
    const items: HomeItem[] = [];
    const turn = b.rows.filter((r) => r.myTurn);
    if (turn.length) items.push({ tone: 'warn', tag: 'Bekalan', title: `${turn.length} permohonan bekalan menunggu anda`, detail: turn.slice(0, 4).map((r) => `${r.ref} ${r.statusLabel}`).join(', '), go });
    const mineMoved = b.rows.filter((r) => r.requestedById === user.id && REQUEST_STEPS.includes(r.status) && !r.myTurn);
    if (mineMoved.length) items.push({ tone: 'info', tag: 'Bekalan', title: `${mineMoved.length} permohonan anda dalam proses`, detail: mineMoved.slice(0, 4).map((r) => `${r.ref}: ${r.statusLabel}`).join(', '), go });
    const count = b.bulks.filter((x) => x.omUserId === user.id && !x.counted);
    if (count.length) items.push({ tone: 'warn', tag: 'Bekalan', title: `${count.length} penghantaran pukal belum dikira di tapak`, detail: count.slice(0, 4).map((x) => `${x.ref} ${x.siteName}`).join(', '), go });
    const buying = b.rows.filter((r) => r.requestedById === user.id && r.status === 'tindakan' && r.times.buyingNotice);
    if (buying.length) items.push({ tone: 'info', tag: 'Bekalan', title: `${buying.length} permohonan dalam pembelian, akan lewat`, detail: buying.slice(0, 4).map((r) => r.ref).join(', '), go });
    const late = b.rows.filter((r) => r.times.readyLate && (r.myTurn || r.requestedById === user.id));
    if (late.length) items.push({ tone: 'warn', tag: 'Bekalan', title: `${late.length} permohonan melebihi ${RULES.inventoryControl.value.inStockReadyDays} hari bekerja untuk siap dihantar`, detail: late.slice(0, 4).map((r) => r.ref).join(', '), go });
    if (b.overdue.length) items.push({ tone: 'warn', tag: 'Bekalan', title: `${b.overdue.length} penghantaran pukal belum diserahkan dalam ${b.settings.handOutDays} hari`, detail: '', go });
    return items;
  }

  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user);
      case 'view':
        return this.view(user, i);
      case 'options':
        return this.options(user, i);
      case 'sites':
        return this.startSites(user);
      case 'uniformRecord':
        return this.uniformRecord(user, i);
      case 'returns':
        return this.returnsList(user, i);
      case 'settings':
        return this.setSettings(user, i);
      case 'siteType':
        return this.setSiteType(user, i);
      case 'request':
        return this.request(user, i);
      case 'submit':
        return this.submit(user, i);
      case 'cancel':
        return this.cancel(user, i);
      case 'firstCheck':
        return this.firstCheck(user, i);
      case 'confirm':
        return this.confirm(user, i);
      case 'stockCheck':
        return this.stockCheck(user, i);
      case 'decide':
        return this.decide(user, i);
      case 'issue':
        return this.issue(user, i);
      case 'bulkCount':
        return this.bulkCount(user, i);
      case 'handOut':
        return this.handOut(user, i);
      case 'stage':
        return this.stage(user, i);
      case 'release':
        return this.release(user, i);
      case 'doPdf':
        return this.doPdf(user, i);
      case 'close':
        return this.close(user, i);
      case 'storeMinMax':
        return this.storeMinMax(user, i);
      case 'siteMinMax':
        return this.siteMinMax(user, i);
      case 'decideMinMax':
        return this.decideMinMax(user, i);
      case 'dispose':
        return this.dispose(user, i);
      default:
        throw new BadRequest('Unknown supplies action.');
    }
  }
}

function toStamp(t: IsoDateTime): string {
  return t.replace(/\D/g, '').slice(0, 14);
}
