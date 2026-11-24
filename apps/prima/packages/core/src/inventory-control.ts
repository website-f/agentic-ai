// Part U (Fitri package; inventory, control and disposal papers U-D1..U-D17 sent by Fauzan 13-14 Nov 2026; answers
// U-X1..U-X15): on top of Part T. Stock count sessions for a whole store or a category (monthly; the 6-monthly major
// count freezes stock in and out 2-5 PM), variance lines and the only allowed book correction, the Monday opening
// balance and weekly movement review, the stock card per item, the CSG/TNG course uniform buffer with a reorder
// suggestion, the 7 KPIs, the monthly inventory report, the purchase-to-store match list, equipment life, the
// disposal case for store and site goods (review, assessment, approval, method, execution with marks removed, data
// wipe and witness, evidence, record update, close) and company item damage charges (U-X12: negligence or misuse only,
// decided by the manager, put on the next pay with an HR review; the legal flag shown, never a refusal).
// Roles by post: storekeepers count; the Procurement executive (Admin, U-X8) decides variances, writes the report and
// closes disposals; the OGM (Goodwill store) or the company manager (a private store) approves above the thresholds.
import { AccessDenied, can, GOV_OPS_COMPANY_ID, isGroupLeader } from './access';
import { isGovOm, isOgm, isPrivateOm } from './ops-access';
import { RULES } from './rules';
import { BadRequest, NotFound, type HomeItem, type PrimaService, type ProofInput } from './service';
import { simplePdf } from './simple-pdf';
import type { Store } from './store';
import { addDays, dateOf, daysBetween } from './time';
import { workingDaysUntil } from './fw-moves';
import type { Id, IsoDate, IsoDateTime, StockItem, StockRequest, User, WitnessInput } from './types';

export type InvKind = 'settings' | 'count' | 'urgent' | 'weekClose' | 'adjust' | 'disposal' | 'charge' | 'report';
export interface InvRec {
  id: Id;
  kind: InvKind;
  /** The store's company (Goodwill for government contracts); for a damage charge, the person's employer. */
  companyId: Id;
  status: string;
  d: Record<string, unknown>;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: { at: IsoDateTime; by: string; note: string }[];
}
export const VARIANCE_REASONS = ['shortage', 'lost', 'damaged', 'counting_error', 'issue_not_recorded', 'receipt_not_recorded', 'other'] as const;
export const DAMAGE_CAUSES = ['WEAR', 'ACCIDENT', 'NEGLIGENCE', 'MISUSE', 'UNKNOWN'] as const;
export const INV_DISPOSAL_REASONS = ['damaged', 'worn_obsolete', 'unsafe', 'not_worth_repairing', 'not_needed', 'unsuitable', 'past_life', 'surplus', 'contract_ended', 'not_for_new_contract'] as const;
export const INV_DISPOSAL_OUTCOMES = ['reuse', 'repair', 'transfer', 'recycle', 'dispose', 'return_client'] as const;
export const INV_DISPOSAL_METHODS = ['normal_waste', 'recycle', 'third_party', 'sale', 'destroy', 'return_supplier', 'e_waste', 'scheduled_waste'] as const;
type CountLine = { itemId: Id; name: string; size: string | null; system: number; moved: number; physical: number | null; variance: number | null; reason: string | null; note: string; by: string | null; decision: null | { kind: 'explained' | 'adjusted' | 'awaiting_ogm' | 'refused'; by: string; byId: Id; at: IsoDateTime; reason: string; value: number | null; cause: string | null; ogm?: { by: string; at: IsoDateTime; note: string } | null } };
type DispLine = {
  n: number;
  itemId: Id | null;
  name: string;
  qty: number;
  location: string;
  condition: string;
  reason: string;
  photoIds: Id[];
  marked: boolean;
  electronic: boolean;
  sensitive: boolean;
  fromStore: boolean;
  unitPrice: number | null;
  outcome: (typeof INV_DISPOSAL_OUTCOMES)[number] | null;
  cause: string | null;
  method: (typeof INV_DISPOSAL_METHODS)[number] | null;
  sale: { price: number; buyer: string } | null;
  contractor: { name: string; quote: number } | null;
  destination: string;
  done: null | { marksRemoved: boolean; wipeRef: string; witness: string | null; photoIds: Id[]; by: string; at: IsoDateTime };
  evidence: { kind: string; ref: string; docIds: Id[] }[];
};

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
const money = (v: unknown) => Math.round(Number(v) * 100) / 100;
const monthOf = (d: string) => d.slice(0, 7);
const mondayOf = (d: IsoDate): IsoDate => {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, -((wd + 6) % 7));
};
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const b64 = (pdf: Uint8Array) => {
  let bin = '';
  for (let k = 0; k < pdf.length; k += 0x8000) bin += String.fromCharCode(...pdf.subarray(k, k + 0x8000));
  return btoa(bin);
};
/** The item's price from the store record; null when no price is set (never guessed). */
const priceOf = (it: StockItem | undefined | null): number | null => (it?.salePrice != null && it.salePrice > 0 ? it.salePrice : null);

export class InventoryControlService {
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
  async installed() {
    return !this.store.hasTable || (await this.store.hasTable('inventoryRecs'));
  }
  private async need() {
    if (!(await this.installed())) throw new BadRequest('Inventory control records are not installed in this database yet (module inventory-control-v1, run by the CEO).');
  }
  async recs(kind?: InvKind, companyIds?: Id[]): Promise<InvRec[]> {
    if (!(await this.installed())) return [];
    const all = ((await this.store.list('inventoryRecs', companyIds ? { companyId: companyIds } : {}).catch(() => [])) as InvRec[]) ?? [];
    return kind ? all.filter((r) => r.kind === kind) : all;
  }
  private rec(kind: InvKind, id: Id, companyId: Id, status: string, d: Record<string, unknown>, user: User, note: string): InvRec {
    const at = this.now();
    return { id, kind, companyId, status, d, by: user.name, byId: user.id, at, history: [{ at, by: user.name, note }] };
  }
  /** One history line per update (the database refuses more). */
  private async put(tx: Store, r: InvRec, user: User, note: string, status?: string) {
    const next: InvRec = { ...r, status: status ?? r.status, history: [...r.history, { at: this.now(), by: user.name, note: note.slice(0, 300) }] };
    await tx.update('inventoryRecs', r.id, patchOf(next) as never);
    return next;
  }
  private async load(id: unknown, kind: InvKind): Promise<InvRec> {
    const rid = s(id, 200);
    await this.store.lock?.('inventoryRecs', rid);
    const r = (await this.store.get('inventoryRecs', rid)) as InvRec | undefined;
    if (!r || r.kind !== kind) throw new NotFound(kind === 'count' ? 'Stock count' : kind === 'disposal' ? 'Disposal case' : 'Record');
    return structuredClone(r);
  }

  // ---------- who is who ----------
  private role(user: User, storeId: Id) {
    return this.svc.ssPurRole(user, storeId);
  }
  /** Storekeeper of the store (or a private store's admin executive acting as store). */
  private isKeeper(user: User, storeId: Id) {
    const r = this.role(user, storeId);
    return r === 'store' || (storeId !== GOV_OPS_COMPANY_ID && r === 'staff');
  }
  /** The Procurement executive (Goodwill) or the company manager (a private store): the "Admin" and variance decider. */
  private isAdmin(user: User, storeId: Id) {
    const r = this.role(user, storeId);
    return storeId === GOV_OPS_COMPANY_ID ? r === 'proc' && user.procRole !== 'storekeeper' : r === 'manager' || r === 'proc';
  }
  /** Management: the OGM for the Goodwill store; the company manager for a private store. */
  private isMgmt(user: User, storeId: Id) {
    return !user.integration && (storeId === GOV_OPS_COMPANY_ID ? isOgm(user) : this.role(user, storeId) === 'manager');
  }
  private isWatcher(user: User) {
    return !user.integration && (isOgm(user) || user.opsTier === 'coo' || user.opsTier === 'ceo' || isGroupLeader(user) || user.department === 'audit' || user.department === 'finance' || user.leadership === 'finance_director');
  }
  private isHr(user: User) {
    return !user.integration && user.role === 'pwvsb_officer' && (user.department === 'hr' || user.leadership === 'cos' || user.leadership === 'deputy_cos');
  }

  // ---------- settings ----------
  async settings() {
    const base = structuredClone(RULES.inventoryControl.value);
    const saved = (await this.store.get('inventoryRecs', 'inv-settings').catch(() => undefined)) as InvRec | undefined;
    return { ...base, ...((saved?.d ?? {}) as Partial<typeof base>) };
  }
  /** The OGM changes a setting with a reason (stage targets after a month, expected life, register days). */
  private async setSettings(user: User, i: Record<string, unknown>) {
    await this.need();
    if (!isOgm(user)) throw new AccessDenied('view', '(the OGM changes the inventory settings)');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say why the setting changes.');
    const cur = await this.settings();
    const patch: Record<string, unknown> = {};
    if (i.stageTargets && typeof i.stageTargets === 'object') {
      const t = { ...cur.stageTargets };
      for (const k of ['order', 'receiving', 'preparation', 'delivery'] as const) {
        const v = (i.stageTargets as Record<string, unknown>)[k];
        if (v !== undefined) t[k] = v === null || v === '' ? null : int(v, `${k} target`, 1, 120);
      }
      patch.stageTargets = t;
    }
    if (i.registerDays !== undefined) patch.registerDays = i.registerDays === null || i.registerDays === '' ? null : int(i.registerDays, 'Register days', 1, 365);
    if (i.lifeKey) {
      const key = s(i.lifeKey, 60);
      const life = { ...cur.expectedLifeMonths };
      if (i.lifeMonths === null || i.lifeMonths === '') delete life[key];
      else life[key] = int(i.lifeMonths, 'Expected life (months)', 1, 240);
      patch.expectedLifeMonths = life;
    }
    if (Array.isArray(i.picStores)) patch.picStores = (i.picStores as unknown[]).map((x) => s(x, 40)).filter(Boolean);
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('inventoryRecs', 'inv-settings');
      const row = (await tx.get('inventoryRecs', 'inv-settings')) as InvRec | undefined;
      if (row) await this.put(tx, { ...row, d: { ...row.d, ...patch } }, user, reason);
      else await tx.insert('inventoryRecs', this.rec('settings', 'inv-settings', GOV_OPS_COMPANY_ID, 'active', patch, user, reason) as never);
      await tx.audit({ at, actor: user.name, companyId: GOV_OPS_COMPANY_ID, action: 'inventory.settings', entity: 'inventory_rec', entityId: 'inv-settings', summary: `Inventory settings: ${Object.keys(patch).join(', ')} (${reason})` });
      return this.settings();
    });
  }

  // ---------- U1 stock count session ----------
  private async countStart(user: User, i: Record<string, unknown>) {
    await this.need();
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    if (!this.isKeeper(user, storeId)) throw new AccessDenied('view', '(a storekeeper opens a stock count)');
    const kind = i.kind === 'major' ? 'major' : 'monthly';
    const cats = ['UNIFORM', 'EQUIPMENT', 'DEVICE', 'PATROL_DEVICE', 'CLEANING'];
    const category = cats.includes(String(i.category)) ? String(i.category) : null;
    if (kind === 'major' && category) throw new BadRequest('The major count covers the whole store.');
    const open = (await this.recs('count', [storeId])).find((c) => c.status === 'open');
    if (open) throw new BadRequest(`A count is already open since ${open.at.slice(0, 16).replace('T', ' ')}. Finish it first.`);
    const items = (await this.store.list('stockItems', { companyId: [storeId] })).filter((x) => !category || x.kind === category);
    if (!items.length) throw new BadRequest('No items in scope.');
    const set = await this.settings();
    const at = this.now();
    const lines: CountLine[] = items.map((x) => ({ itemId: x.id, name: x.name, size: x.size, system: x.onHand, moved: 0, physical: null, variance: null, reason: null, note: '', by: null, decision: null }));
    const id = `inv-cnt-${storeId}-${at.replace(/\D/g, '').slice(0, 14)}`;
    const r = this.rec('count', id, storeId, 'open', { kind, category, lines, frozen: kind === 'major', windowEnd: `${this.today()}T${set.majorWindow.to}`, witness: null, finishedAt: null, moved: [] }, user, `${kind} count opened`);
    return this.store.transaction(async (tx) => {
      await tx.insert('inventoryRecs', r as never);
      await tx.audit({ at, actor: user.name, companyId: storeId, action: 'inventory.count.start', entity: 'inventory_rec', entityId: id, summary: `${kind === 'major' ? 'Major' : 'Monthly'} stock count of ${lines.length} items${category ? ` (${category})` : ''} opened${kind === 'major' ? '; stock in and out stopped' : ''}` });
      return r;
    });
  }
  private async countLine(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'count');
    if (!this.isKeeper(user, r.companyId)) throw new AccessDenied('view', '(a storekeeper counts)');
    if (r.status !== 'open') throw new BadRequest('This count is finished.');
    const lines = r.d.lines as CountLine[];
    const entries = Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : [i];
    for (const e of entries) {
      const l = lines.find((x) => x.itemId === e.itemId);
      if (!l) throw new BadRequest('That item is not in this count.');
      const physical = int(e.physical, `${l.name} counted`, 0, 10_000_000);
      const variance = physical - (l.system - l.moved);
      const reason = VARIANCE_REASONS.find((x) => x === e.reason) ?? null;
      if (variance !== 0 && !reason) throw new BadRequest(`${l.name}: ${variance > 0 ? '+' : ''}${variance}. Pick the reason (shortage, lost, damaged, counting error, issue or receipt not recorded, other).`);
      if (reason === 'other' && !s(e.note)) throw new BadRequest(`${l.name}: say what "other" is.`);
      Object.assign(l, { physical, variance, reason: variance === 0 ? null : reason, note: s(e.note), by: user.name });
    }
    return this.store.transaction(async (tx) => this.put(tx, r, user, `${entries.length} line(s) counted`));
  }
  private async countFinish(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'count');
    if (!this.isKeeper(user, r.companyId)) throw new AccessDenied('view', '(a storekeeper finishes the count)');
    if (r.status !== 'open') throw new BadRequest('This count is already finished.');
    const lines = r.d.lines as CountLine[];
    const missing = lines.filter((l) => l.physical === null);
    if (missing.length) throw new BadRequest(`${missing.length} line(s) not counted yet: ${missing.slice(0, 3).map((l) => l.name).join(', ')}.`);
    const w = await this.svc.ssWitness(r.companyId, i.witness as WitnessInput, [user.personId]);
    r.d = { ...r.d, frozen: false, witness: { name: w.name, staffNo: w.staffNo, personId: w.id }, finishedAt: this.now(), finishedBy: user.name, finishedById: user.id };
    const vari = lines.filter((l) => (l.variance ?? 0) !== 0).length;
    return this.store.transaction(async (tx) => {
      const next = await this.put(tx, r, user, `finished with witness ${w.staffNo}; ${vari} variance line(s)`, vari ? 'variance' : 'closed');
      await tx.audit({ at: this.now(), actor: user.name, companyId: r.companyId, action: 'inventory.count.finish', entity: 'inventory_rec', entityId: r.id, summary: `Stock count finished, witness ${w.name}; ${vari} variance line(s)${r.d.kind === 'major' ? '; stock in and out reopened' : ''}` });
      return next;
    });
  }
  private async countPdf(user: User, i: Record<string, unknown>) {
    const r = (await this.store.get('inventoryRecs', s(i.id, 200))) as InvRec | undefined;
    if (!r || r.kind !== 'count') throw new NotFound('Stock count');
    if (!this.isKeeper(user, r.companyId) && !this.isAdmin(user, r.companyId) && !this.isWatcher(user)) throw new AccessDenied('view', '(the store)');
    const lines = r.d.lines as CountLine[];
    const w = r.d.witness as { name: string; staffNo: string } | null;
    const out = [`BORANG KIRAAN STOK (${String(r.d.kind).toUpperCase()}) - ${r.companyId}`, `Tarikh ${r.at.slice(0, 10)} | Dibuka oleh ${r.by}${w ? ` | Saksi ${w.name} (${w.staffNo})` : ''}`, '', 'Barang | Sistem | Fizikal | Varians | Sebab | PIC', ...lines.map((l) => `${l.name}${l.size ? ` (${l.size})` : ''} | ${l.system - l.moved} | ${l.physical ?? '-'} | ${l.variance ?? '-'} | ${l.reason ?? ''} ${l.note} | ${l.by ?? ''}`)];
    return { name: `Kiraan_stok_${r.at.slice(0, 10)}.pdf`, base64: b64(simplePdf(out)) };
  }

  // ---------- U2 freeze ----------
  /**
   * Every stock-moving action calls this. While a major count is open for the store, the move is refused unless the
   * OGM (or company manager) let one urgent move through with a reason; that pass is used once and listed on the count.
   */
  async assertMovable(storeId: Id, itemId: Id, qty: number, what: string) {
    if (!(await this.installed())) return;
    const counts = (await this.recs('count', [storeId])).filter((c) => c.status === 'open' && c.d.frozen === true);
    const c = counts.find((x) => (x.d.lines as CountLine[]).some((l) => l.itemId === itemId));
    if (!c) return;
    const pass = (await this.recs('urgent', [storeId])).find((u) => u.status === 'open' && u.d.countId === c.id && u.d.itemId === itemId && Number(u.d.qty) >= qty);
    if (!pass) throw new BadRequest(`Kiraan stok sedang berjalan sejak ${c.at.slice(11, 16)} (${c.at.slice(0, 10)}): stock in and out is stopped until the count is finished. The OGM may let one urgent ${what} through with a reason.`);
    const sys = { by: 'Prima', name: 'Prima', id: 'prima' } as unknown as User;
    await this.store.transaction(async (tx) => {
      await this.put(tx, pass, sys, `used for ${what} of ${qty}`, 'used');
      const lines = (c.d.lines as CountLine[]).map((l) => (l.itemId === itemId ? { ...l, moved: l.moved + qty * (what === 'receive' || what === 'return' ? -1 : 1) } : l));
      await this.put(tx, { ...c, d: { ...c.d, lines, moved: [...((c.d.moved as unknown[]) ?? []), { itemId, qty, what, at: this.now(), passId: pass.id, reason: pass.d.reason }] } }, sys, `moved during the count: ${what} ${qty}`);
    });
  }
  private async urgent(user: User, i: Record<string, unknown>) {
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    if (!this.isMgmt(user, storeId)) throw new AccessDenied('view', '(the OGM or the company manager lets an urgent move through)');
    const c = (await this.recs('count', [storeId])).find((x) => x.status === 'open' && x.d.frozen === true);
    if (!c) throw new BadRequest('No major count is open; nothing is stopped.');
    const itemId = s(i.itemId, 160);
    if (!(c.d.lines as CountLine[]).some((l) => l.itemId === itemId)) throw new BadRequest('That item is not in the count.');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say why it cannot wait for the count to finish.');
    const qty = int(i.qty, 'Quantity', 1, 10_000);
    const id = `inv-urg-${c.id.slice(8)}-${itemId}-${this.now().replace(/\D/g, '').slice(8, 14)}`.slice(0, 160);
    const r = this.rec('urgent', id, storeId, 'open', { countId: c.id, itemId, qty, reason }, user, reason);
    return this.store.transaction(async (tx) => {
      await tx.insert('inventoryRecs', r as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: storeId, action: 'inventory.count.urgent', entity: 'inventory_rec', entityId: id, summary: `Urgent move of ${qty} let through during the count: ${reason}` });
      return r;
    });
  }

  // ---------- U3 variance and book correction ----------
  private async variance(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.countId, 'count');
    if (!this.isAdmin(user, r.companyId)) throw new AccessDenied('view', '(the Procurement executive, or the company manager for a private store, decides a variance)');
    if (r.status === 'open') throw new BadRequest('Finish the count first.');
    const w = r.d.witness as { personId: Id } | null;
    if (r.byId === user.id || r.d.finishedById === user.id || (w && user.personId === w.personId)) throw new BadRequest('The counter or the witness never decides their own variance.');
    const lines = r.d.lines as CountLine[];
    const l = lines.find((x) => x.itemId === i.itemId);
    if (!l || !l.variance) throw new BadRequest('No variance on that line.');
    if (l.decision && l.decision.kind !== 'refused') throw new BadRequest('Already decided.');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Give the reason, the evidence and the corrective action.');
    const cause = DAMAGE_CAUSES.find((x) => x === i.cause) ?? null;
    const at = this.now();
    if (i.action === 'explain') {
      l.decision = { kind: 'explained', by: user.name, byId: user.id, at, reason, value: null, cause };
      return this.store.transaction(async (tx) => this.put(tx, { ...r, d: { ...r.d, lines } }, user, `${l.name}: explained, no adjustment (${reason})`, this.countStatus(lines)));
    }
    if (i.action !== 'adjust') throw new BadRequest('Explain (the missing issue or receipt was recorded) or adjust the book.');
    if (i.personId) await this.checkCharge(cause, i.photo as ProofInput[] | undefined);
    const item = await this.store.get('stockItems', l.itemId);
    const price = priceOf(item);
    const value = price === null ? null : money(Math.abs(l.variance) * price);
    const set = await this.settings();
    const needOgm = value !== null && value > set.adjustOgmAbove;
    l.decision = { kind: needOgm ? 'awaiting_ogm' : 'adjusted', by: user.name, byId: user.id, at, reason, value, cause, ogm: null };
    return this.store.transaction(async (tx) => {
      if (!needOgm) await this.applyAdjust(tx, user, r, l, reason, i);
      return this.put(tx, { ...r, d: { ...r.d, lines } }, user, `${l.name}: ${needOgm ? `adjust asked, RM${value} above RM${set.adjustOgmAbove}, waiting for the OGM` : 'book adjusted'} (${reason})`, this.countStatus(lines));
    });
  }
  private countStatus(lines: CountLine[]) {
    return lines.every((l) => !l.variance || (l.decision && (l.decision.kind === 'explained' || l.decision.kind === 'adjusted'))) ? 'closed' : 'variance';
  }
  /** ONE adjustment movement on the stock card; onHand moves by the variance; Finance is told the write-off value. */
  private async applyAdjust(tx: Store, user: User, r: InvRec, l: CountLine, reason: string, i: Record<string, unknown>) {
    await tx.lock?.('stockItems', l.itemId);
    const it = await tx.get('stockItems', l.itemId);
    if (!it) throw new NotFound('Store item');
    const onHand = Math.max(0, it.onHand + (l.variance ?? 0));
    await tx.update('stockItems', it.id, { onHand });
    const id = `inv-adj-${r.id.slice(8)}-${l.itemId}`.slice(0, 160);
    const price = priceOf(it);
    const a = this.rec('adjust', id, r.companyId, 'done', { itemId: l.itemId, name: l.name, qty: l.variance, countId: r.id, reason, writeOff: l.variance! < 0 && price !== null ? money(-l.variance! * price) : null, financeToDecide: l.variance! < 0 }, user, reason);
    await tx.insert('inventoryRecs', a as never);
    await tx.audit({ at: this.now(), actor: user.name, companyId: r.companyId, action: 'inventory.adjust', entity: 'stock_item', entityId: it.id, summary: `${l.name}: book corrected by ${l.variance} after the count (${reason}); Finance to record the write-off. Never a pay deduction unless the manager finds negligence or misuse.` });
    const cause = DAMAGE_CAUSES.find((x) => x === i.cause);
    if (cause && i.personId) await this.makeCharge(tx, user, { personId: s(i.personId, 160), cause, itemName: l.name, qty: -(l.variance ?? 0), unitPrice: price, sourceKind: 'variance', sourceId: r.id, photos: i.photo as ProofInput[] | undefined, reason });
  }
  private async varianceOgm(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.countId, 'count');
    if (!this.isMgmt(user, r.companyId)) throw new AccessDenied('view', '(the OGM approves an adjustment above the limit)');
    const lines = r.d.lines as CountLine[];
    const l = lines.find((x) => x.itemId === i.itemId);
    if (!l?.decision || l.decision.kind !== 'awaiting_ogm') throw new BadRequest('Nothing waiting for you on that line.');
    if (l.decision.byId === user.id || r.byId === user.id) throw new BadRequest('Someone else approves.');
    const note = s(i.note);
    if (!note) throw new BadRequest('Give a reason.');
    const ok = i.ok === true;
    l.decision = { ...l.decision, kind: ok ? 'adjusted' : 'refused', ogm: { by: user.name, at: this.now(), note } };
    return this.store.transaction(async (tx) => {
      if (ok) await this.applyAdjust(tx, user, r, l, `${l.decision!.reason}; OGM: ${note}`, {});
      return this.put(tx, { ...r, d: { ...r.d, lines } }, user, `${l.name}: OGM ${ok ? 'approved the adjustment' : 'did not approve'} (${note})`, this.countStatus(lines));
    });
  }

  // ---------- U-X12 company item damage charge ----------
  /**
   * Negligence or misuse decided by the manager who decides the case puts the actual cost on the person's next pay as
   * "Kerosakan / kehilangan barang syarikat", with an HR review task; no price = the charge waits for one.
   */
  /** Before a transaction: a charge cause needs a photo (so nothing is half saved). */
  async checkCharge(cause: string | null | undefined, photos: ProofInput[] | undefined) {
    if (!cause) return;
    const set = await this.settings();
    if (set.chargeCauses.includes(cause) && !(photos ?? []).length) throw new BadRequest('A charge for negligence or misuse needs a photo.');
  }
  async makeCharge(tx: Store, user: User, c: { personId: Id; cause: string; itemName: string; qty: number; unitPrice: number | null; sourceKind: string; sourceId: Id; photos?: ProofInput[]; reason: string }) {
    const set = await this.settings();
    if (!set.chargeCauses.includes(c.cause)) return null;
    const p = await tx.get('people', c.personId);
    if (!p) throw new BadRequest('Name the person responsible.');
    const rec = this.svc.ssProof(user, p.companyId, null, c.photos ?? [], true);
    if (!rec.docs.length) throw new BadRequest('A charge for negligence or misuse needs a photo.');
    const ids = await this.svc.ssSaveProof(tx, rec);
    const amount = c.unitPrice === null ? null : money(c.unitPrice * Math.max(1, c.qty));
    const period = nextMonth(monthOf(this.today()));
    const id = `inv-chg-${c.sourceId.slice(-20)}-${p.id}-${this.now().replace(/\D/g, '').slice(8, 16)}`.slice(0, 160);
    const guard = ['guard', 'patrol_officer', 'supervisor'].includes(p.role);
    const r = this.rec('charge', id, p.companyId, amount === null ? 'waiting_price' : 'due', { personId: p.id, personName: p.name, staffNo: p.staffNo, itemName: c.itemName, qty: c.qty, amount, cause: c.cause, sourceKind: c.sourceKind, sourceId: c.sourceId, photoIds: ids, period, hr: null, ja: guard, legalFlag: set.legalFlag, recovered: [] }, user, c.reason);
    await tx.insert('inventoryRecs', r as never);
    await tx.audit({ at: this.now(), actor: user.name, companyId: p.companyId, action: 'inventory.charge', entity: 'inventory_rec', entityId: id, summary: `${p.name}: ${c.cause.toLowerCase()} on ${c.itemName}, ${amount === null ? 'waits for a price' : `RM${amount.toFixed(2)} on ${period} pay`}; HR reviews. ${set.legalFlag}` });
    return r;
  }
  /** HR keeps, reduces, spreads or cancels a charge with a reason before that month's pay run is approved. */
  private async chargeHr(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'charge');
    if (!this.isHr(user)) throw new AccessDenied('view', '(HR reviews a damage charge)');
    if (r.byId === user.id) throw new BadRequest('The person who decided the charge does not review it.');
    if (!['due', 'waiting_price'].includes(r.status)) throw new BadRequest(`This charge is ${r.status}.`);
    const note = s(i.note);
    if (!note) throw new BadRequest('Give the reason.');
    const decision = ['keep', 'reduce', 'spread', 'cancel'].find((x) => x === i.decision);
    if (!decision) throw new BadRequest('Keep, reduce, spread over months or cancel.');
    const amount = decision === 'reduce' ? money(i.amount) : (r.d.amount as number | null);
    if (decision === 'reduce' && !(amount! > 0 && amount! < Number(r.d.amount))) throw new BadRequest('Give the reduced amount.');
    const months = decision === 'spread' ? int(i.months, 'Months', 2, 12) : 1;
    r.d = { ...r.d, amount, hr: { decision, amount, months, note, by: user.name, at: this.now() } };
    return this.store.transaction(async (tx) => this.put(tx, r, user, `HR ${decision}: ${note}`, decision === 'cancel' ? 'cancelled' : r.status));
  }
  /** The Procurement executive enters the price for a charge that waits for one (never guessed). */
  private async chargePrice(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'charge');
    if (!(user.department === 'procurement' && user.procRole !== 'storekeeper') && !this.isHr(user)) throw new AccessDenied('view', '(Procurement enters the price)');
    if (r.status !== 'waiting_price') throw new BadRequest('This charge has its price.');
    const unit = money(i.unitPrice);
    if (!(unit > 0)) throw new BadRequest('Give the unit price from the price list or a receipt.');
    const amount = money(unit * Math.max(1, Number(r.d.qty) || 1));
    r.d = { ...r.d, amount, period: nextMonth(monthOf(this.today())) };
    return this.store.transaction(async (tx) => this.put(tx, r, user, `price RM${unit} entered (${s(i.note) || 'price list'})`, 'due'));
  }
  /**
   * Staff payroll reads these as deductions (the Part P24 path). The id carries the pay month, so a charge spread over
   * months recovers one part per run and each part goes into one run only.
   */
  async chargesDue(personId: Id, period: string): Promise<{ id: Id; label: string; amount: number }[]> {
    const out: { id: Id; label: string; amount: number }[] = [];
    for (const r of await this.recs('charge')) {
      if (r.status !== 'due' || r.d.personId !== personId || String(r.d.period) > period) continue;
      const months = (r.d.hr as { months: number } | null)?.months ?? 1;
      const done = r.d.recovered as string[];
      if (done.length >= months) continue;
      // Review B2: a part not recovered in its own month (the half-of-gross limit, or a run not paid) stays due under
      // its own month's id, so what was already taken of it is known; the oldest parts come first.
      const open: string[] = [];
      for (let m = String(r.d.period); m <= period && open.length < months - done.length; m = nextMonth(m)) if (!done.includes(m)) open.push(m);
      for (const m of open) out.push({ id: `invchg:${r.id}@${m}`, label: `Kerosakan / kehilangan barang syarikat: ${r.d.itemName}`, amount: money(Number(r.d.amount) / months) });
    }
    return out;
  }
  /** The pay run is paid: each charge part in it is marked recovered (inside the pay transaction). */
  async markChargesRecovered(tx: Store, ids: Id[], by: User) {
    if (!(await this.installed())) return;
    for (const raw of ids.filter((x) => x.startsWith('invchg:'))) {
      const [rid, period] = raw.slice(7).split('@');
      await tx.lock?.('inventoryRecs', rid);
      const r = (await tx.get('inventoryRecs', rid)) as InvRec | undefined;
      if (!r || r.status !== 'due' || (r.d.recovered as string[]).includes(period)) continue;
      const rec = [...(r.d.recovered as string[]), period];
      const months = (r.d.hr as { months: number } | null)?.months ?? 1;
      await this.put(tx, { ...r, d: { ...r.d, recovered: rec } }, by, `recovered in ${period} pay`, rec.length >= months ? 'recovered' : 'due');
    }
  }

  // ---------- U4 weekly review and the Monday opening balance ----------
  private async weekReview(user: User, i: Record<string, unknown>) {
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    if (!this.isKeeper(user, storeId) && !this.isAdmin(user, storeId) && !this.isWatcher(user)) throw new AccessDenied('view', '(the store)');
    const from = addDays(mondayOf(this.today()), -7);
    const [issues, prs] = await Promise.all([this.store.list('stockIssues', { companyId: [storeId] }), this.store.list('purRequests', { companyId: [storeId] })]);
    const list: { kind: string; ref: string; what: string }[] = [];
    for (const x of issues) if (dateOf(x.issuedAt) >= from && !x.acknowledged && !(x.slipDocIds ?? []).length) list.push({ kind: 'issue_not_acknowledged', ref: x.id, what: `${x.qty} x ${x.itemId} to ${x.personName}` });
    for (const p of prs) if (p.grn && dateOf(p.grn.at) >= from && !(p.grn as { doNo?: string }).doNo) list.push({ kind: 'grn_without_do', ref: p.ref, what: p.title });
    const reqs = (await this.store.list('stockRequests', { companyId: [storeId] }).catch(() => [])) as StockRequest[];
    for (const b of reqs.filter((x) => x.kind === 'ss_bulk')) {
      const d = b.ss as { counted: unknown; ref: string; siteName: string; sentAt: string };
      if (!d.counted && dateOf(d.sentAt) >= from) list.push({ kind: 'bulk_not_counted', ref: d.ref, what: d.siteName });
    }
    for (const c of (await this.store.list('cleaningStock', {}).catch(() => [])).filter((x) => x.requestId && !x.received && x.date >= from)) list.push({ kind: 'site_delivery_not_confirmed', ref: c.id, what: c.siteId });
    return { from, to: this.today(), rows: list };
  }
  private async weekClose(user: User, i: Record<string, unknown>) {
    await this.need();
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    if (!this.isKeeper(user, storeId)) throw new AccessDenied('view', '(a storekeeper confirms the opening balance)');
    const monday = mondayOf(this.today());
    const id = `inv-wk-${storeId}-${monday}`;
    if (await this.store.get('inventoryRecs', id)) throw new BadRequest(`This week (from ${monday}) is already confirmed.`);
    const items = await this.store.list('stockItems', { companyId: [storeId] });
    const balances = await Promise.all(items.map(async (it) => ({ itemId: it.id, name: it.name, closing: (await this.cardOf(it, addDays(monday, -1))).balance })));
    const r = this.rec('weekClose', id, storeId, 'closed', { week: monday, balances }, user, `baki penutup minggu lepas = baki pembukaan minggu ${monday}`);
    return this.store.transaction(async (tx) => {
      await tx.insert('inventoryRecs', r as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: storeId, action: 'inventory.week_close', entity: 'inventory_rec', entityId: id, summary: `Opening balance for the week of ${monday} confirmed (${balances.length} items); last week is closed` });
      return r;
    });
  }
  /** A movement may not be dated in a week the store has closed (U4); a late entry goes in the current week with a note. */
  async assertWeekOpen(storeId: Id, on: IsoDate) {
    if (!(await this.installed())) return;
    const closed = (await this.recs('weekClose', [storeId])).map((w) => String(w.d.week)).sort().pop();
    if (closed && on < closed) throw new BadRequest(`The week before ${closed} is closed. Record it today with a note "lewat dari minggu ${mondayOf(on)}".`);
  }

  // ---------- U5 stock card ----------
  /** Every movement of an item in date order with the running balance; reads the existing records, copies nothing. */
  async cardOf(it: StockItem, until?: IsoDate) {
    const mv: { at: IsoDateTime; kind: string; qty: number; ref: string; note: string }[] = [];
    const [prs, issues, reqs, recs, deliveries] = await Promise.all([
      this.store.list('purRequests', { companyId: [it.companyId] }),
      this.store.list('stockIssues', { companyId: [it.companyId] }),
      this.store.list('stockRequests', { companyId: [it.companyId] }).catch(() => [] as StockRequest[]),
      this.recs(undefined, [it.companyId]),
      this.store.list('cleaningStock', {}).catch(() => []),
    ]);
    for (const p of prs) {
      if (!p.grn) continue;
      p.lines.forEach((l, k) => {
        if (l.stockItemId !== it.id) return;
        const good = p.grn!.condition?.[k]?.good ?? p.grn!.qty[k] ?? 0;
        if (good) mv.push({ at: p.grn!.at, kind: 'received', qty: good, ref: p.ref, note: 'GRN (good only)' });
      });
    }
    for (const x of issues) {
      if (x.itemId !== it.id) continue;
      // A piece handed out from a bulk send left the store with the bulk send.
      if (!x.id.includes('-ssb-')) mv.push({ at: x.issuedAt, kind: 'issued', qty: -x.qty, ref: x.id, note: x.personName });
      if (x.returned && (x.returned.condition === 'good' || x.returned.condition === 'worn')) mv.push({ at: x.returned.at, kind: 'returned', qty: x.qty, ref: x.id, note: x.returned.condition });
    }
    for (const d of deliveries) {
      if (!d.requestId) continue;
      for (const l of d.supplies) if (l.stockItemId === it.id && l.sent) mv.push({ at: d.at, kind: 'site_delivery', qty: -l.sent, ref: d.id, note: d.siteId });
    }
    for (const b of reqs.filter((x) => x.kind === 'ss_bulk')) {
      const d = b.ss as { sentAt: string; ref: string; siteName: string; lines: { stockItemId: Id; qty: number }[] };
      for (const l of d.lines) if (l.stockItemId === it.id) mv.push({ at: d.sentAt, kind: 'site_delivery', qty: -l.qty, ref: d.ref, note: `bulk to ${d.siteName}` });
    }
    for (const r of recs) {
      if (r.kind === 'adjust' && r.d.itemId === it.id) mv.push({ at: r.at, kind: 'adjustment', qty: Number(r.d.qty), ref: String(r.d.countId), note: String(r.d.reason) });
      if (r.kind === 'disposal')
        for (const l of r.d.lines as DispLine[]) {
          if (l.itemId !== it.id || !l.fromStore) continue;
          mv.push({ at: r.at, kind: 'awaiting_disposal', qty: -l.qty, ref: String(r.d.ref), note: 'menunggu pelupusan' });
          const back = r.history.find((h) => h.note.startsWith('reviewed'));
          if (l.outcome && ['reuse', 'repair', 'transfer', 'return_client'].includes(l.outcome) && back) mv.push({ at: back.at, kind: 'back_to_stock', qty: l.qty, ref: String(r.d.ref), note: l.outcome });
        }
      if (r.kind === 'count' && (r.d.lines as CountLine[]).some((l) => l.itemId === it.id)) mv.push({ at: r.at, kind: 'count', qty: 0, ref: r.id, note: `${r.d.kind} count` });
    }
    mv.sort((a, b) => a.at.localeCompare(b.at));
    const total = mv.reduce((n, m) => n + m.qty, 0);
    const opening = it.onHand - total;
    let bal = opening;
    const rows = mv.map((m) => ({ ...m, balance: (bal += m.qty) }));
    const shown = until ? rows.filter((r) => dateOf(r.at) <= until) : rows;
    return { opening, rows: shown, balance: shown.length ? shown.at(-1)!.balance : opening, onHand: it.onHand };
  }
  private async card(user: User, i: Record<string, unknown>) {
    const it = await this.store.get('stockItems', s(i.itemId, 160));
    if (!it) throw new NotFound('Store item');
    if (!this.isKeeper(user, it.companyId) && !this.isAdmin(user, it.companyId) && !this.isWatcher(user)) throw new AccessDenied('view', '(the store)');
    return { item: { id: it.id, name: it.name, size: it.size }, ...(await this.cardOf(it)), dataAsAt: this.now() };
  }

  // ---------- U8 course uniform buffer ----------
  private async buffer(user: User, i: Record<string, unknown>) {
    const id = s(i.itemId, 160);
    await this.store.lock?.('stockItems', id);
    const it = await this.store.get('stockItems', id);
    if (!it) throw new NotFound('Store item');
    if (!this.isMgmt(user, it.companyId)) throw new AccessDenied('view', '(the OGM sets the course uniform buffer)');
    if (it.kind !== 'UNIFORM') throw new BadRequest('The CSG/TNG course buffer is for uniform items.');
    const level = i.level === null || i.level === '' ? null : int(i.level, 'Buffer', 0, 100_000);
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say how the level was set (course intakes).');
    const hist = [...(it.courseBufferHistory ?? []), { at: this.now(), by: user.name, level, reason }].slice(-50);
    return this.store.transaction(async (tx) => {
      await tx.update('stockItems', it.id, { courseBufferAt: level, courseBufferHistory: hist });
      await tx.audit({ at: this.now(), actor: user.name, companyId: it.companyId, action: 'inventory.course_buffer', entity: 'stock_item', entityId: it.id, summary: `${it.name}${it.size ? ` (${it.size})` : ''}: CSG/TNG course buffer ${level ?? 'not set'} (${reason})` });
      return (await tx.get('stockItems', it.id))!;
    });
  }
  /** Weekly usage over 8 weeks x (supplier lead time + 1 week), capped at Max; a suggestion only, never automatic. */
  private suggest(it: StockItem, issues: { itemId: Id; qty: number; issuedAt: string }[], prs: { lines: { stockItemId: Id | null }[]; po: { at: string } | null; grn: { at: string } | null }[]) {
    return reorderSuggestion(it, issues, prs, this.today());
  }

  // ---------- U9 KPIs ----------
  async kpis(storeId: Id, month: string) {
    const set = await this.settings();
    const [recs, issues, items, prs, reqs] = await Promise.all([
      this.recs(undefined, [storeId]),
      this.store.list('stockIssues', { companyId: [storeId] }),
      this.store.list('stockItems', { companyId: [storeId] }),
      this.store.list('purRequests', { companyId: [storeId] }),
      this.store.list('stockRequests', { companyId: [storeId] }).catch(() => [] as StockRequest[]),
    ]);
    const counts = recs.filter((r) => r.kind === 'count' && r.status !== 'open' && monthOf(String(r.d.finishedAt ?? r.at)) === month);
    const lines = counts.flatMap((c) => c.d.lines as CountLine[]);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const uniform = new Set(items.filter((x) => x.kind === 'UNIFORM').map((x) => x.id));
    const mIssues = issues.filter((x) => monthOf(x.issuedAt) === month);
    const bulkLines = reqs.filter((x) => x.kind === 'ss_bulk' && monthOf(String((x.ss as { sentAt: string }).sentAt)) === month).flatMap((x) => (x.ss as { lines: { stockItemId: Id; qty: number; personId: Id | null; handedOut: Id | null }[] }).lines);
    const uniOut = mIssues.filter((x) => uniform.has(x.itemId) && !x.id.includes('-ssb-')).reduce((n, x) => n + x.qty, 0) + bulkLines.filter((l) => uniform.has(l.stockItemId)).reduce((n, l) => n + l.qty, 0);
    const uniNamed = mIssues.filter((x) => uniform.has(x.itemId) && !x.id.includes('-ssb-') && x.personId).reduce((n, x) => n + x.qty, 0) + bulkLines.filter((l) => uniform.has(l.stockItemId) && l.personId && l.handedOut).reduce((n, l) => n + l.qty, 0);
    const grns = prs.filter((p) => p.grn && monthOf(p.grn.at) === month);
    const movements = mIssues.length + grns.length;
    const complete = mIssues.filter((x) => x.acknowledged || (x.slipDocIds ?? []).length).length + grns.filter((p) => (p.grn as { doNo?: string }).doNo).length;
    const vLines = lines.filter((l) => l.variance);
    const losses = mIssues.filter((x) => x.returned && (x.returned.condition === 'lost' || x.returned.condition === 'damaged'));
    const investigated = vLines.filter((l) => l.decision && ['explained', 'adjusted', 'refused'].includes(l.decision.kind)).length + losses.filter((x) => x.returned?.confirmed).length;
    // U8: a buffered (critical) item at zero is a critical stock-out, with the day it started and how long it lasted.
    const stockOutEvents: { itemId: Id; name: string; from: IsoDate; to: IsoDate | null; days: number }[] = [];
    for (const it of items.filter((x) => x.courseBufferAt != null)) {
      const c = await this.cardOf(it);
      let from: IsoDate | null = c.opening === 0 ? `${month}-01` : null;
      for (const r of c.rows) {
        if (r.balance === 0 && from === null) from = dateOf(r.at);
        else if (r.balance > 0 && from !== null) {
          if (monthOf(dateOf(r.at)) >= month && monthOf(from) <= month) stockOutEvents.push({ itemId: it.id, name: it.name, from, to: dateOf(r.at), days: daysBetween(from, dateOf(r.at)) });
          from = null;
        }
      }
      if (from !== null && monthOf(from) <= month) stockOutEvents.push({ itemId: it.id, name: it.name, from, to: null, days: daysBetween(from, this.today()) });
    }
    const stockOuts = stockOutEvents.length;
    const grnLines = grns.flatMap((p) => p.lines);
    return {
      month,
      targets: set.kpiTargets,
      accuracyPct: pct(lines.filter((l) => !l.variance).length, lines.length),
      unauthorised: vLines.filter((l) => l.reason === 'issue_not_recorded' || (l.decision?.kind === 'adjusted' && l.reason === 'lost')).length + recs.filter((r) => r.kind === 'urgent' && !s(r.d.reason)).length,
      recordedPct: pct(complete, movements),
      uniformRecordPct: pct(uniNamed, uniOut),
      countCompletionPct: counts.length ? 100 : 0,
      investigatedPct: pct(investigated, vLines.length + losses.length),
      stockOuts,
      stockOutEvents,
      reachedStorePct: pct(grnLines.filter((l) => l.stockItemId).length, grnLines.length),
      dataAsAt: this.now(),
      sources: ['stock count sessions', 'store issues', 'site deliveries', 'purchases (GRN)', 'disposal cases'],
    };
  }

  // ---------- U10 monthly report ----------
  private async reportBuild(user: User, i: Record<string, unknown>) {
    await this.need();
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    if (!this.isAdmin(user, storeId)) throw new AccessDenied('view', '(the Procurement executive prepares the monthly report)');
    const month = /^\d{4}-\d{2}$/.test(String(i.month)) ? String(i.month) : monthOf(addDays(`${monthOf(this.today())}-01`, -1));
    const id = `inv-rpt-${storeId}-${month}`;
    const cur = (await this.store.get('inventoryRecs', id)) as InvRec | undefined;
    if (cur && cur.status !== 'returned' && cur.status !== 'draft') throw new BadRequest(`The ${month} report is ${cur.status}; a later correction goes as a note on next month's report.`);
    const items = await this.store.list('stockItems', { companyId: [storeId] });
    const start = `${month}-01`;
    const end = addDays(`${nextMonth(month)}-01`, -1);
    const rows = [];
    for (const it of items) {
      const c = await this.cardOf(it);
      const inMonth = c.rows.filter((r) => dateOf(r.at) >= start && dateOf(r.at) <= end);
      const before = c.rows.filter((r) => dateOf(r.at) < start);
      const sum = (k: string) => inMonth.filter((r) => r.kind === k).reduce((n, r) => n + r.qty, 0);
      const opening = before.length ? before.at(-1)!.balance : c.opening;
      const closing = inMonth.length ? inMonth.at(-1)!.balance : opening;
      const price = priceOf(it);
      rows.push({ itemId: it.id, name: it.name, size: it.size, opening, received: sum('received'), issued: -sum('issued'), delivered: -sum('site_delivery'), returned: sum('returned'), adjusted: sum('adjustment'), disposed: -sum('awaiting_disposal') - sum('back_to_stock'), closing, value: price === null ? null : money(closing * price) });
    }
    const kpi = await this.kpis(storeId, month);
    const trend = [];
    let m = month;
    for (let k = 0; k < 3; k++) {
      m = monthOf(addDays(`${m}-01`, -1));
      trend.push(await this.kpis(storeId, m));
    }
    const recs = await this.recs(undefined, [storeId]);
    const openItems = [
      ...(recs.some((r) => r.kind === 'count' && monthOf(r.at) === month && r.status !== 'open') ? [] : ['No finished stock count this month']),
      ...recs.filter((r) => r.kind === 'count' && r.status === 'variance').map((r) => `Count ${r.at.slice(0, 10)}: variance lines not decided`),
      ...recs.filter((r) => r.kind === 'disposal' && !['selesai', 'ditolak'].includes(r.status)).map((r) => `Disposal ${r.d.ref} open (${r.status})`),
    ];
    const d = { storeId, month, rows, kpi, trend, openItems, disposals: recs.filter((r) => r.kind === 'disposal' && monthOf(r.at) === month).map((r) => ({ ref: r.d.ref, status: r.status })), comments: '', actions: '', dataAsAt: this.now(), sources: kpi.sources };
    return this.store.transaction(async (tx) => {
      if (cur) return this.put(tx, { ...cur, d }, user, 'rebuilt', 'draft');
      const r = this.rec('report', id, storeId, 'draft', d, user, 'built');
      await tx.insert('inventoryRecs', r as never);
      return r;
    });
  }
  private async reportSubmit(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'report');
    if (!this.isAdmin(user, r.companyId)) throw new AccessDenied('view', '(the Procurement executive submits the report)');
    if (r.status !== 'draft' && r.status !== 'returned') throw new BadRequest(`The report is ${r.status}.`);
    const comments = s(i.comments, 2000);
    if (!comments) throw new BadRequest('Add your comments and actions.');
    r.d = { ...r.d, comments, actions: s(i.actions, 2000), submittedAt: this.now(), submittedById: user.id };
    // Open items are a warning, not a block (trust staff); ACT sees the list.
    return this.store.transaction(async (tx) => this.put(tx, r, user, `submitted${(r.d.openItems as string[]).length ? ` with ${(r.d.openItems as string[]).length} open item(s)` : ''}`, 'submitted'));
  }
  private async reportReview(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'report');
    if (!this.isMgmt(user, r.companyId)) throw new AccessDenied('view', '(the OGM reviews the report)');
    if (r.status !== 'submitted') throw new BadRequest('Not waiting for review.');
    if (r.d.submittedById === user.id) throw new BadRequest('Someone else reviews.');
    const note = s(i.note);
    if (i.ok !== true && !note) throw new BadRequest('Say why it is returned.');
    return this.store.transaction(async (tx) => this.put(tx, r, user, i.ok === true ? `reviewed${note ? `: ${note}` : ''}` : `returned: ${note}`, i.ok === true ? 'reviewed' : 'returned'));
  }
  private async reportPdf(user: User, i: Record<string, unknown>) {
    const r = (await this.store.get('inventoryRecs', s(i.id, 200))) as InvRec | undefined;
    if (!r || r.kind !== 'report') throw new NotFound('Report');
    if (!this.isAdmin(user, r.companyId) && !this.isWatcher(user)) throw new AccessDenied('view', '(the report)');
    const d = r.d as { month: string; rows: { name: string; opening: number; received: number; issued: number; delivered: number; returned: number; adjusted: number; disposed: number; closing: number }[]; kpi: Record<string, unknown>; openItems: string[]; comments: string; dataAsAt: string };
    const out = [
      `LAPORAN PENGURUSAN INVENTORI BULANAN - ${r.companyId} - ${d.month}`,
      `Data setakat ${d.dataAsAt.slice(0, 16).replace('T', ' ')} (stor, penghantaran tapak, pembelian, daftar barang) | Status ${r.status}`,
      '',
      'Barang | Awal | Terima | Keluar | Tapak | Pulang | Laras | Lupus | Akhir',
      ...d.rows.map((x) => `${x.name} | ${x.opening} | ${x.received} | ${x.issued} | ${x.delivered} | ${x.returned} | ${x.adjusted} | ${x.disposed} | ${x.closing}`),
      '',
      'KPI: ' + ['accuracyPct', 'unauthorised', 'recordedPct', 'uniformRecordPct', 'countCompletionPct', 'investigatedPct', 'stockOuts'].map((k) => `${k} ${d.kpi[k] ?? 'tiada data'}`).join(' | '),
      '',
      'Perkara terbuka:',
      ...d.openItems.map((x) => ` - ${x}`),
      '',
      'Ulasan:',
      d.comments,
    ];
    return { name: `Laporan_inventori_${d.month}.pdf`, base64: b64(simplePdf(out)) };
  }

  // ---------- U12 disposal case ----------
  private async dispRequest(user: User, i: Record<string, unknown>) {
    await this.need();
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    const today = this.today();
    const site = i.siteId ? await this.store.get('sites', s(i.siteId, 160)) : null;
    if (i.siteId && !site) throw new NotFound('Site');
    const om = site ? (isGovOm(user, today) || isPrivateOm(user, today)) && (await this.svc.cleaning.access(user, site)) === 'manage' : false;
    if (!(site ? om : this.isKeeper(user, storeId))) throw new AccessDenied('view', site ? '(the OM covering the site asks for disposal of site items)' : '(a storekeeper asks for disposal of store items)');
    const raw = Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : [];
    if (!raw.length) throw new BadRequest('Add at least one item.');
    const items = await this.store.list('stockItems', { companyId: [storeId] });
    const lines: DispLine[] = [];
    const proofs: Awaited<ReturnType<PrimaService['ssProof']>>[] = [];
    for (const [k, l] of raw.entries()) {
      const at = `Line ${k + 1}`;
      const it = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
      if (l.itemId && !it) throw new BadRequest(`${at}: choose an item from the store list.`);
      const name = it ? `${it.name}${it.size ? ` (${it.size})` : ''}` : s(l.name, 120);
      if (!name) throw new BadRequest(`${at}: name the item.`);
      const qty = int(l.qty, `${at} quantity`, 1, 100_000);
      const reason = INV_DISPOSAL_REASONS.find((x) => x === l.reason);
      if (!reason) throw new BadRequest(`${at}: pick the reason from the policy list.`);
      const condition = s(l.condition, 120);
      const location = s(l.location, 120) || (site?.name ?? 'stor');
      if (!condition) throw new BadRequest(`${at}: describe the condition now.`);
      const rec = this.svc.ssProof(user, storeId, null, (l.photo as ProofInput[]) ?? [], true);
      if ((reason === 'damaged' || reason === 'unsafe') && !rec.docs.length) throw new BadRequest(`${at}: a damaged or unsafe item needs a photo.`);
      proofs.push(rec);
      const fromStore = !site && !!it;
      lines.push({ n: k + 1, itemId: it?.id ?? null, name, qty, location, condition, reason, photoIds: rec.docs.map((d) => d.id), marked: l.marked === true || it?.kind === 'UNIFORM', electronic: l.electronic === true || it?.kind === 'DEVICE' || it?.kind === 'PATROL_DEVICE', sensitive: l.sensitive === true || it?.kind === 'DEVICE' || it?.kind === 'PATROL_DEVICE', fromStore, unitPrice: priceOf(it), outcome: null, cause: null, method: null, sale: null, contractor: null, destination: '', done: null, evidence: [] });
    }
    const all = await this.recs('disposal', [storeId]);
    const ref = `LPS-${today.replace(/-/g, '')}-${String(all.filter((r) => String(r.d.ref).startsWith(`LPS-${today.replace(/-/g, '')}`)).length + 1).padStart(3, '0')}`;
    const id = `inv-dsp-${storeId}-${ref}`.toLowerCase();
    const contract = site ? ((await this.svc.siteSupplies.contractOf(site)).contract.startsWith('PKK') ? 'PKK' : 'KBK') : null;
    for (const l of lines.filter((x) => x.fromStore)) await this.assertMovable(storeId, l.itemId!, l.qty, 'disposal');
    const r = this.rec('disposal', id, storeId, 'semakan', { ref, storeId, siteId: site?.id ?? null, siteName: site?.name ?? null, contract, lines, requestedById: user.id, approval: null, closedAt: null, writeOff: null }, user, 'permohonan');
    return this.store.transaction(async (tx) => {
      for (const p of proofs) if (p.docs.length) await this.svc.ssSaveProof(tx, p);
      // Store lines leave usable stock at once ("menunggu pelupusan"); lines kept at review come back.
      for (const l of lines.filter((x) => x.fromStore)) {
        await tx.lock?.('stockItems', l.itemId!);
        const it = await tx.get('stockItems', l.itemId!);
        if (!it || it.onHand < l.qty) throw new BadRequest(`${l.name}: only ${it?.onHand ?? 0} in the store.`);
        await tx.update('stockItems', it.id, { onHand: it.onHand - l.qty });
      }
      await tx.insert('inventoryRecs', r as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: storeId, action: 'inventory.disposal.request', entity: 'inventory_rec', entityId: id, summary: `${ref}: disposal asked for ${lines.length} line(s)${site ? ` at ${site.name}` : ' from the store'}` });
      return r;
    });
  }
  private async dispReview(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'disposal');
    if (!this.isAdmin(user, r.companyId)) throw new AccessDenied('view', '(the Procurement executive reviews)');
    if (r.d.requestedById === user.id) throw new BadRequest('The requester never reviews their own case.');
    if (r.status !== 'semakan') throw new BadRequest(`The case is ${r.status}.`);
    const lines = r.d.lines as DispLine[];
    const given = new Map((Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : []).map((x) => [Number(x.n), x]));
    for (const l of lines) {
      const g = given.get(l.n);
      const outcome = INV_DISPOSAL_OUTCOMES.find((x) => x === g?.outcome);
      if (!outcome) throw new BadRequest(`Line ${l.n}: choose reuse, repair, transfer, recycle, dispose, or return to the client (owned by the client or the contract).`);
      l.outcome = outcome;
      l.cause = DAMAGE_CAUSES.find((x) => x === g?.cause) ?? null;
    }
    const go = lines.filter((l) => l.outcome === 'dispose' || l.outcome === 'recycle');
    const value = go.reduce((n, l) => n + (l.unitPrice ?? 0) * l.qty, 0);
    const set = await this.settings();
    const needMgmt = value >= set.disposalApproveAbove || go.some((l) => l.sensitive);
    const note = s(i.note);
    if (!note) throw new BadRequest('Give the review note (quantity, condition, ownership and contract checked).');
    if (i.personId) for (const l of lines) await this.checkCharge(l.cause, i.photo as ProofInput[] | undefined);
    const status = !go.length ? 'selesai' : needMgmt ? 'kelulusan' : 'kaedah';
    r.d = { ...r.d, lines, value: money(value), approval: needMgmt ? null : { by: user.name, at: this.now(), note: 'reviewer decides (routine, under the limit)', level: 'reviewer' }, closedAt: status === 'selesai' ? this.now() : null };
    return this.store.transaction(async (tx) => {
      for (const l of lines.filter((x) => x.fromStore && x.outcome && ['reuse', 'repair', 'transfer', 'return_client'].includes(x.outcome))) {
        await tx.lock?.('stockItems', l.itemId!);
        const it = await tx.get('stockItems', l.itemId!);
        if (it) await tx.update('stockItems', it.id, { onHand: it.onHand + l.qty });
      }
      for (const l of lines.filter((x) => x.cause && i.personId)) await this.makeCharge(tx, user, { personId: s(i.personId, 160), cause: l.cause!, itemName: l.name, qty: l.qty, unitPrice: l.unitPrice, sourceKind: 'disposal', sourceId: r.id, photos: i.photo as ProofInput[] | undefined, reason: note });
      return this.put(tx, r, user, `reviewed: ${note}`, status);
    });
  }
  private async dispApprove(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'disposal');
    if (!this.isMgmt(user, r.companyId)) throw new AccessDenied('view', '(the OGM or the company manager approves)');
    if (r.d.requestedById === user.id) throw new BadRequest('The requester never approves their own case.');
    if (r.status !== 'kelulusan') throw new BadRequest(`The case is ${r.status}.`);
    const note = s(i.note);
    if (!note) throw new BadRequest('Give the reason (this is the written approval).');
    const ok = i.ok === true;
    r.d = { ...r.d, approval: ok ? { by: user.name, at: this.now(), note, level: 'management' } : null };
    return this.store.transaction(async (tx) => this.put(tx, r, user, `${ok ? 'approved' : 'not approved'}: ${note}`, ok ? (r.d.methodsSet ? 'pelaksanaan' : 'kaedah') : 'ditolak'));
  }
  private async dispMethod(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'disposal');
    if (!this.isAdmin(user, r.companyId)) throw new AccessDenied('view', '(the Procurement executive picks the method)');
    if (r.status !== 'kaedah') throw new BadRequest(`The case is ${r.status}.`);
    const lines = r.d.lines as DispLine[];
    const given = new Map((Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : []).map((x) => [Number(x.n), x]));
    for (const l of lines.filter((x) => x.outcome === 'dispose' || x.outcome === 'recycle')) {
      const g = given.get(l.n) ?? {};
      const method = INV_DISPOSAL_METHODS.find((x) => x === g.method);
      if (!method) throw new BadRequest(`Line ${l.n}: pick the method.`);
      l.method = method;
      l.destination = s(g.destination, 160);
      if (!l.destination) throw new BadRequest(`Line ${l.n}: say where the item goes.`);
      if (method === 'sale') {
        const price = money(g.price);
        const buyer = s(g.buyer, 120);
        if (!(price >= 0) || !buyer) throw new BadRequest(`Line ${l.n}: give the price or the buyer's offer and the buyer.`);
        l.sale = { price, buyer };
      }
      if (method === 'third_party') {
        const name = s(g.contractor, 120);
        if (!name) throw new BadRequest(`Line ${l.n}: name the contractor and its quote.`);
        l.contractor = { name, quote: money(g.quote ?? 0) };
      }
    }
    // Any sale or auction needs management, even under the limit (U-X7).
    const sale = lines.some((l) => l.method === 'sale');
    const mgmt = (r.d.approval as { level?: string } | null)?.level === 'management';
    r.d = { ...r.d, lines, methodsSet: true };
    return this.store.transaction(async (tx) => this.put(tx, r, user, 'method chosen', sale && !mgmt ? 'kelulusan' : 'pelaksanaan'));
  }
  private async dispExecute(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'disposal');
    const doer = this.isKeeper(user, r.companyId) || r.d.requestedById === user.id;
    if (!doer) throw new AccessDenied('view', '(the storekeeper or the OM carries it out)');
    if (r.status !== 'pelaksanaan') throw new BadRequest(`The case is ${r.status}.`);
    const lines = r.d.lines as DispLine[];
    const l = lines.find((x) => x.n === Number(i.n));
    if (!l || !l.method) throw new BadRequest('Choose a line to carry out.');
    if (l.done) throw new BadRequest('Already carried out.');
    const rec = this.svc.ssProof(user, r.companyId, null, (i.photos as ProofInput[]) ?? [], true);
    if (rec.docs.length < 2) throw new BadRequest('Attach the before and after photos.');
    if (l.marked && i.marksRemoved !== true) throw new BadRequest('Tick "marks removed" (company, client, contract or site marks) and show it in the photos.');
    const wipeRef = s(i.wipeRef, 120);
    if (l.electronic && !wipeRef) throw new BadRequest('Record the data wipe or reset (radio frequencies and programming, phone, camera, attendance machine).');
    let witness: string | null = null;
    if (['destroy', 'third_party', 'sale'].includes(l.method)) {
      const w = await this.svc.ssWitness(r.companyId, i.witness as WitnessInput, [user.personId]);
      witness = `${w.name} (${w.staffNo})`;
    }
    return this.store.transaction(async (tx) => {
      const ids = await this.svc.ssSaveProof(tx, rec);
      l.done = { marksRemoved: l.marked ? true : false, wipeRef, witness, photoIds: ids, by: user.name, at: this.now() };
      return this.put(tx, { ...r, d: { ...r.d, lines } }, user, `line ${l.n} carried out${witness ? `, witness ${witness}` : ''}`, lines.every((x) => !x.method || x.done) ? 'bukti' : 'pelaksanaan');
    });
  }
  /** The evidence the method needs (receipt, certificate, DOE note). */
  private needs(l: DispLine): string[] {
    switch (l.method) {
      case 'sale':
        return ['receipt'];
      case 'third_party':
      case 'destroy':
        return ['certificate'];
      case 'scheduled_waste':
        return ['doe_note'];
      case 'e_waste':
        return ['certificate'];
      default:
        return [];
    }
  }
  private async dispEvidence(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'disposal');
    if (!this.isKeeper(user, r.companyId) && !this.isAdmin(user, r.companyId) && r.d.requestedById !== user.id) throw new AccessDenied('view', '(the store or the OM adds evidence)');
    if (!['pelaksanaan', 'bukti'].includes(r.status)) throw new BadRequest(`The case is ${r.status}.`);
    const lines = r.d.lines as DispLine[];
    const l = lines.find((x) => x.n === Number(i.n));
    if (!l) throw new BadRequest('Choose the line.');
    const kind = ['receipt', 'certificate', 'doe_note', 'contractor_note', 'other'].find((x) => x === i.kind);
    if (!kind) throw new BadRequest('Pick the evidence kind.');
    const ref = s(i.ref, 120);
    if (!ref) throw new BadRequest('Give the number on the document (receipt, certificate or DOE consignment note).');
    const rec = this.svc.ssProof(user, r.companyId, null, (i.file as ProofInput[]) ?? [], true);
    if (!rec.docs.length) throw new BadRequest('Attach the document.');
    return this.store.transaction(async (tx) => {
      const ids = await this.svc.ssSaveProof(tx, rec);
      l.evidence.push({ kind, ref, docIds: ids });
      return this.put(tx, { ...r, d: { ...r.d, lines } }, user, `evidence ${kind} ${ref} for line ${l.n}`);
    });
  }
  private async dispClose(user: User, i: Record<string, unknown>) {
    const r = await this.load(i.id, 'disposal');
    if (!this.isAdmin(user, r.companyId)) throw new AccessDenied('view', '(the Procurement executive closes the case)');
    if (r.status !== 'bukti') throw new BadRequest(r.status === 'selesai' ? 'Already closed.' : `The case is ${r.status}; carry out every line first.`);
    const lines = r.d.lines as DispLine[];
    const missing: string[] = [];
    for (const l of lines.filter((x) => x.method)) {
      for (const need of this.needs(l)) if (!l.evidence.some((e) => e.kind === need)) missing.push(`line ${l.n} ${need}`);
      if (l.marked && !l.done?.marksRemoved) missing.push(`line ${l.n} marks removed`);
      if (l.electronic && !l.done?.wipeRef) missing.push(`line ${l.n} data wipe`);
    }
    if (missing.length) throw new BadRequest(`The case stays open: ${missing.join(', ')}.`);
    const writeOff = money(lines.filter((l) => l.method && l.fromStore).reduce((n, l) => n + (l.unitPrice ?? 0) * l.qty, 0));
    const sale = money(lines.reduce((n, l) => n + (l.sale?.price ?? 0), 0));
    r.d = { ...r.d, closedAt: this.now(), writeOff, saleToRecord: sale };
    return this.store.transaction(async (tx) => {
      const next = await this.put(tx, r, user, 'SELESAI: documents checked, records updated', 'selesai');
      await tx.audit({ at: this.now(), actor: user.name, companyId: r.companyId, action: 'inventory.disposal.close', entity: 'inventory_rec', entityId: r.id, summary: `${r.d.ref} closed; write-off RM${writeOff} for Finance to decide${sale ? `; sale RM${sale} for Finance to record` : ''}` });
      return next;
    });
  }
  private async dispPdf(user: User, i: Record<string, unknown>) {
    const r = (await this.store.get('inventoryRecs', s(i.id, 200))) as InvRec | undefined;
    if (!r || r.kind !== 'disposal') throw new NotFound('Disposal case');
    if (!this.isKeeper(user, r.companyId) && !this.isAdmin(user, r.companyId) && !this.isWatcher(user) && r.d.requestedById !== user.id) throw new AccessDenied('view', '(the case)');
    const lines = r.d.lines as DispLine[];
    const out = [`BORANG PELUPUSAN ${r.d.ref} - ${r.companyId}${r.d.siteName ? ` - ${r.d.siteName}` : ''}`, `Status ${r.status}`, '', ...lines.map((l) => `${l.n}. ${l.name} x${l.qty} | ${l.reason} | ${l.condition} | keputusan ${l.outcome ?? '-'} | kaedah ${l.method ?? '-'} | ke ${l.destination || '-'} | ${l.done ? `dilaksana ${l.done.by}${l.done.witness ? `, saksi ${l.done.witness}` : ''}` : 'belum'} | bukti ${l.evidence.map((e) => `${e.kind} ${e.ref}`).join(', ') || '-'}`), '', ...r.history.map((h) => `${h.at.slice(0, 16).replace('T', ' ')} ${h.by}: ${h.note}`)];
    return { name: `Borang_pelupusan_${r.d.ref}.pdf`, base64: b64(simplePdf(out)) };
  }

  // ---------- U18 purchase to store match ----------
  private async match(user: User, i: Record<string, unknown>) {
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    if (!this.isAdmin(user, storeId) && !this.isWatcher(user)) throw new AccessDenied('view', '(Procurement, Finance and ACT)');
    const prs = await this.store.list('purRequests', { companyId: [storeId] });
    const set = await this.settings();
    const rows: { ref: string; line: string; problem: string }[] = [];
    for (const p of prs) {
      if (p.invoice && !p.grn) rows.push({ ref: p.ref, line: p.title, problem: 'invoice without goods received' });
      if (!p.grn) continue;
      p.lines.forEach((l, k) => {
        if (!l.stockItemId) rows.push({ ref: p.ref, line: l.item, problem: 'received but not linked to a store item or register unit' });
        if ((p.grn!.qty[k] ?? 0) !== l.qty && !p.grn!.note) rows.push({ ref: p.ref, line: l.item, problem: `received ${p.grn!.qty[k] ?? 0} of ${l.qty} ordered, no reason` });
      });
      if (set.registerDays !== null && !p.lines.every((l) => l.stockItemId) && daysBetween(dateOf(p.grn.at), this.today()) > set.registerDays) rows.push({ ref: p.ref, line: p.title, problem: `not in the store or register after ${set.registerDays} days` });
    }
    return { rows, dataAsAt: this.now() };
  }

  // ---------- board ----------
  async board(user: User, i: Record<string, unknown> = {}) {
    const storeId = s(i.storeId, 40) || GOV_OPS_COMPANY_ID;
    const keeper = this.isKeeper(user, storeId);
    const admin = this.isAdmin(user, storeId);
    const mgmt = this.isMgmt(user, storeId);
    const hr = this.isHr(user);
    if (!keeper && !admin && !mgmt && !this.isWatcher(user) && !hr) throw new AccessDenied('view', '(the store, Procurement, the OGM, Finance, ACT and HR)');
    const today = this.today();
    const set = await this.settings();
    const recs = await this.recs(undefined, hr && !keeper && !admin ? undefined : [storeId]);
    const items = await this.store.list('stockItems', { companyId: [storeId] });
    const [issues, prs] = await Promise.all([this.store.list('stockIssues', { companyId: [storeId] }), this.store.list('purRequests', { companyId: [storeId] })]);
    const counts = recs.filter((r) => r.kind === 'count').sort((a, b) => b.at.localeCompare(a.at));
    const lastFinished = counts.find((c) => c.status !== 'open');
    const open = counts.find((c) => c.status === 'open');
    const month = monthOf(today);
    const majorDue = set.majorMonths.includes(Number(month.slice(5))) && !counts.some((c) => c.d.kind === 'major' && monthOf(c.at) === month && c.status !== 'open');
    // The same item short in N counts in a row.
    const repeat = items
      .filter((it) => {
        const last = counts.filter((c) => c.status !== 'open').slice(0, set.repeatShortCounts).map((c) => (c.d.lines as CountLine[]).find((l) => l.itemId === it.id));
        return last.length === set.repeatShortCounts && last.every((l) => l && (l.variance ?? 0) < 0);
      })
      .map((it) => it.name);
    const monday = mondayOf(today);
    const weekConfirmed = recs.some((r) => r.kind === 'weekClose' && r.d.week === monday);
    const life = set.expectedLifeMonths;
    const pastLife = issues
      .filter((x) => !x.returned)
      .map((x) => ({ x, it: items.find((y) => y.id === x.itemId) }))
      .filter(({ x, it }) => it && life[it.sku] && daysBetween(dateOf(x.issuedAt), today) > life[it.sku] * 30)
      .map(({ x, it }) => ({ issueId: x.id, item: it!.name, personName: x.personName, since: dateOf(x.issuedAt) }));
    const disposals = recs.filter((r) => r.kind === 'disposal');
    const holidays = new Set<IsoDate>();
    return {
      storeId,
      settings: set,
      can: { count: keeper, decide: admin, mgmt, hr },
      openCount: open ? { id: open.id, kind: open.d.kind, at: open.at, frozen: open.d.frozen, late: open.d.frozen === true && this.now() > String(open.d.windowEnd), lines: open.d.lines } : null,
      countDue: !lastFinished || daysBetween(dateOf(lastFinished.at), today) >= set.countEveryDays,
      majorDue,
      counts: counts.slice(0, 12).map((c) => ({ id: c.id, kind: c.d.kind, at: c.at, status: c.status, witness: c.d.witness, lines: (c.d.lines as CountLine[]).filter((l) => l.variance) })),
      urgent: recs.filter((r) => r.kind === 'urgent').slice(0, 20),
      repeatShort: repeat,
      week: { monday, confirmed: weekConfirmed, late: !weekConfirmed && today > monday },
      // U8: a buffer not reviewed within the setting's days is listed for the OGM.
      bufferStale: items
        .filter((x) => x.courseBufferAt != null && daysBetween(dateOf((x.courseBufferHistory ?? []).at(-1)?.at ?? '2000-01-01T00:00:00Z'), today) > set.bufferReviewDays)
        .map((x) => ({ id: x.id, name: x.name, size: x.size, lastReview: (x.courseBufferHistory ?? []).at(-1)?.at ?? null })),
      buffer: items.filter((x) => x.courseBufferAt != null).map((x) => ({ id: x.id, name: x.name, size: x.size, onHand: x.onHand, level: x.courseBufferAt, below: x.onHand < (x.courseBufferAt ?? 0), stockOut: x.onHand === 0, suggest: this.suggest(x, issues, prs) })),
      suggestions: items.map((x) => ({ id: x.id, name: x.name, s: this.suggest(x, issues, prs) })).filter((x) => x.s),
      kpi: await this.kpis(storeId, month),
      disposals: disposals.slice(0, 100).map((r) => ({ id: r.id, ref: r.d.ref, status: r.status, siteName: r.d.siteName, contract: r.d.contract, at: r.at, daysOpen: r.status === 'selesai' ? null : workingDaysUntil(dateOf(r.at), today, holidays), late: r.status !== 'selesai' && r.status !== 'ditolak' && workingDaysUntil(dateOf(r.at), today, holidays) > set.disposalDays, lines: r.d.lines, value: r.d.value ?? null, writeOff: r.d.writeOff ?? null })),
      charges: recs.filter((r) => r.kind === 'charge').map((r) => ({ id: r.id, status: r.status, ...r.d, by: r.by })),
      reports: recs.filter((r) => r.kind === 'report').map((r) => ({ id: r.id, month: r.d.month, status: r.status, openItems: r.d.openItems })),
      pastLife,
      recordsYears: set.recordsYears,
      dataAsAt: this.now(),
    };
  }
  private async myCharges(user: User) {
    if (!user.personId) return { rows: [] };
    return { rows: (await this.recs('charge')).filter((r) => r.d.personId === user.personId).map((r) => ({ id: r.id, status: r.status, item: r.d.itemName, amount: r.d.amount, cause: r.d.cause, period: r.d.period, photoIds: r.d.photoIds, hr: r.d.hr })) };
  }

  async homeItems(user: User): Promise<HomeItem[]> {
    if (user.integration) return [];
    const storeSide = user.department === 'procurement' || isOgm(user);
    if (!storeSide && !this.isHr(user)) return [];
    const b = await this.board(user, {}).catch(() => null);
    if (!b) return [];
    const go = { view: 'purchasing' as const, companyId: GOV_OPS_COMPANY_ID };
    const out: HomeItem[] = [];
    if (b.openCount?.late) out.push({ tone: 'crit', tag: 'Inventori', title: 'Kiraan stok besar melepasi tempoh: stok masih dibekukan', detail: b.openCount.at.slice(0, 16).replace('T', ' '), go });
    if (b.countDue && b.can.count) out.push({ tone: 'warn', tag: 'Inventori', title: 'Kiraan stok bulanan perlu dibuat', detail: '', go });
    if (b.majorDue && (b.can.count || b.can.mgmt)) out.push({ tone: 'warn', tag: 'Inventori', title: 'Kiraan stok besar 6 bulanan (2-5 PM) belum dibuat', detail: '', go });
    if (b.week.late && (b.can.count || b.can.mgmt)) out.push({ tone: 'warn', tag: 'Inventori', title: `Baki pembukaan minggu ${b.week.monday} belum disahkan`, detail: '', go });
    const below = b.buffer.filter((x) => x.below);
    if (below.length && (b.can.decide || b.can.mgmt)) out.push({ tone: 'crit', tag: 'Inventori', title: `${below.length} saiz uniform kursus CSG/TNG di bawah simpanan`, detail: below.slice(0, 4).map((x) => `${x.name} ${x.size ?? ''}`).join(', '), go });
    if (b.bufferStale.length && b.can.mgmt) out.push({ tone: 'info', tag: 'Inventori', title: `${b.bufferStale.length} paras simpanan belum disemak dalam ${b.settings.bufferReviewDays} hari`, detail: b.bufferStale.slice(0, 4).map((x) => x.name).join(', '), go });
    if (b.repeatShort.length && b.can.mgmt) out.push({ tone: 'warn', tag: 'Inventori', title: 'Isu berulang: barang kurang dalam 3 kiraan berturut-turut', detail: b.repeatShort.slice(0, 4).join(', '), go });
    const late = b.disposals.filter((d) => d.late);
    if (late.length && (b.can.decide || b.can.mgmt)) out.push({ tone: 'warn', tag: 'Inventori', title: `${late.length} kes pelupusan melebihi ${b.settings.disposalDays} hari bekerja`, detail: late.slice(0, 4).map((d) => String(d.ref)).join(', '), go });
    const hrDue = b.charges.filter((c) => c.status === 'due' && !(c as { hr?: unknown }).hr);
    if (hrDue.length && b.can.hr) out.push({ tone: 'warn', tag: 'Inventori', title: `${hrDue.length} caj kerosakan barang syarikat menunggu semakan HR`, detail: 'Employment Act 1955 s.24', go: { view: 'purchasing' as const, companyId: GOV_OPS_COMPANY_ID } });
    return out;
  }

  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user, i);
      case 'card':
        return this.card(user, i);
      case 'weekReview':
        return this.weekReview(user, i);
      case 'match':
        return this.match(user, i);
      case 'myCharges':
        return this.myCharges(user);
      case 'countPdf':
        return this.countPdf(user, i);
      case 'reportPdf':
        return this.reportPdf(user, i);
      case 'disposalPdf':
        return this.dispPdf(user, i);
      case 'settings':
        return this.setSettings(user, i);
      case 'countStart':
        return this.countStart(user, i);
      case 'countLine':
        return this.countLine(user, i);
      case 'countFinish':
        return this.countFinish(user, i);
      case 'urgent':
        return this.urgent(user, i);
      case 'variance':
        return this.variance(user, i);
      case 'varianceOgm':
        return this.varianceOgm(user, i);
      case 'weekClose':
        return this.weekClose(user, i);
      case 'buffer':
        return this.buffer(user, i);
      case 'reportBuild':
        return this.reportBuild(user, i);
      case 'reportSubmit':
        return this.reportSubmit(user, i);
      case 'reportReview':
        return this.reportReview(user, i);
      case 'disposalRequest':
        return this.dispRequest(user, i);
      case 'disposalReview':
        return this.dispReview(user, i);
      case 'disposalApprove':
        return this.dispApprove(user, i);
      case 'disposalMethod':
        return this.dispMethod(user, i);
      case 'disposalExecute':
        return this.dispExecute(user, i);
      case 'disposalEvidence':
        return this.dispEvidence(user, i);
      case 'disposalClose':
        return this.dispClose(user, i);
      case 'chargeHr':
        return this.chargeHr(user, i);
      case 'chargePrice':
        return this.chargePrice(user, i);
      default:
        throw new BadRequest('Unknown inventory action.');
    }
  }
}
void can;

/** U8 reorder suggestion: weekly usage over 8 weeks x (supplier lead time + 1 week), capped at Max; never automatic. */
export function reorderSuggestion(it: StockItem, issues: { itemId: Id; qty: number; issuedAt: string }[], prs: { lines: { stockItemId: Id | null }[]; po: { at: string } | null; grn: { at: string } | null }[], today: IsoDate) {
    const from = addDays(today, -56);
    const used = issues.filter((x) => x.itemId === it.id && dateOf(x.issuedAt) >= from).reduce((n, x) => n + x.qty, 0);
    const weekly = used / 8;
    const leads = prs.filter((p) => p.po && p.grn && p.lines.some((l) => l.stockItemId === it.id)).map((p) => daysBetween(dateOf(p.po!.at), dateOf(p.grn!.at)));
    const lead = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null;
    if (!weekly || lead === null) return null;
    let q = Math.ceil(weekly * (lead / 7 + 1)) + (it.courseBufferAt ?? 0) - it.onHand;
    if (it.maxAt != null) q = Math.min(q, it.maxAt - it.onHand);
    return q > 0 ? { qty: q, weekly: Math.round(weekly * 10) / 10, leadDays: Math.round(lead) } : null;
  }
