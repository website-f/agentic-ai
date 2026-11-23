// Sets and parts in the store (Fauzan, 23 Nov 2026: "inventory manager cannot key in what item for inventory. Like
// uniform, it break down to appalet, badges, pants, shoes, belt. So if the guard only need just pant, no place to key
// in"). A set (for example "Uniform set, guard") lists its parts and how many of each. Every part is an ordinary store
// item with its own size, stock, Min/Max, count and life, so a part is asked for, bought, counted and issued on its
// own. A set holds no stock: asking for one set asks for each part (site supplies request, Part T). Stock never
// changes here; a new part starts at zero and is filled through goods received or a witnessed opening count.
import { AccessDenied } from './access';
import { BadRequest, NotFound, type PrimaService } from './service';
import type { Store } from './store';
import type { Id, IsoDateTime, StockItem, User } from './types';

export const KIT_RULE = { maxParts: 30, maxQtyPerPart: 50, source: 'Fauzan, 23 Nov 2026' } as const;
const KINDS: StockItem['kind'][] = ['UNIFORM', 'EQUIPMENT', 'DEVICE', 'PATROL_DEVICE', 'CLEANING'];
const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);

export const isKit = (it: Pick<StockItem, 'kitParts'> | undefined | null): boolean => !!it?.kitParts?.length;

/**
 * The uniform allowance counts what a guard wears, item by item (Fauzan, 23 Nov 2026: "Shirt also and badges
 * everything guard wear on body counts"; a full suit runs "from shoes to cap", 2 compulsory a year). Worn items are every
 * item of kind Uniform and every part of a uniform set (shoes, belt, badges, epaulettes, cap). Each worn item is counted
 * on its own, by its name across sizes: a guard's shirts, trousers, badges and so on each have the yearly allowance.
 */
export const wearKey = (it: Pick<StockItem, 'name'>): string => it.name.trim().toLowerCase();
export function wornItemIds(items: StockItem[]): Set<Id> {
  const out = new Set<Id>(items.filter((i) => i.kind === 'UNIFORM' && !isKit(i)).map((i) => i.id));
  for (const k of items) if (k.kind === 'UNIFORM' && isKit(k)) for (const p of k.kitParts ?? []) out.add(p.stockItemId);
  return out;
}
/** How many of a worn item one full suit holds (2 badges in a suit means twice the yearly pieces); 1 if not in a suit. */
export function perSuit(items: StockItem[], key: string): number {
  let n = 1;
  for (const k of items)
    if (k.kind === 'UNIFORM' && isKit(k))
      for (const p of k.kitParts ?? []) {
        const it = items.find((x) => x.id === p.stockItemId);
        if (it && wearKey(it) === key) n = Math.max(n, p.qty);
      }
  return n;
}

/** A set's parts as request lines: one line per part, quantity times the number of sets. */
export function expandKit(kit: StockItem, sets: number, items: StockItem[]): { item: StockItem; qty: number }[] {
  return (kit.kitParts ?? []).map((p) => {
    const item = items.find((x) => x.id === p.stockItemId);
    if (!item) throw new BadRequest(`${kit.name}: a part is no longer in the store list. Ask the Inventory Manager to fix the set.`);
    return { item, qty: p.qty * sets };
  });
}

export class ItemKitService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private svc: PrimaService,
  ) {}

  /** The Inventory Manager or the Procurement executive keeps the store list (storekeepers issue and count). */
  private keeps(user: User, storeId: Id): boolean {
    return !user.integration && this.svc.ssPurRole(user, storeId) === 'proc' && (user.procRole === 'manager' || user.procRole === 'executive');
  }
  private async item(id: unknown): Promise<StockItem> {
    const it = await this.store.get('stockItems', s(id, 160));
    if (!it) throw new NotFound('Store item');
    return it;
  }

  /** Every set in the stores the person may see, with its parts and what each part has in the store. */
  async list(user: User, i: Record<string, unknown>) {
    const storeId = s(i.storeId, 40);
    const role = this.svc.ssPurRole(user, storeId || 'goodwill');
    if (!role) throw new AccessDenied('view', '(Procurement and Inventory, and those who monitor it)');
    const items = (await this.store.list('stockItems', storeId ? { companyId: [storeId] } : {})) as StockItem[];
    const name = (it: StockItem) => `${it.name}${it.size ? ` (${it.size})` : ''}`;
    return {
      canEdit: storeId ? this.keeps(user, storeId) : this.keeps(user, 'goodwill'),
      kits: items
        .filter(isKit)
        .map((k) => ({
          id: k.id,
          companyId: k.companyId,
          sku: k.sku,
          name: name(k),
          parts: (k.kitParts ?? []).map((p) => {
            const it = items.find((x) => x.id === p.stockItemId);
            return { stockItemId: p.stockItemId, name: it ? name(it) : '(missing)', kind: it?.kind ?? null, qty: p.qty, onHand: it?.onHand ?? 0 };
          }),
          // How many whole sets the store could make up now from the parts it has.
          setsInStore: Math.min(...(k.kitParts ?? []).map((p) => Math.floor((items.find((x) => x.id === p.stockItemId)?.onHand ?? 0) / p.qty))),
          history: (k.kitHistory ?? []).slice(-10),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      items: items
        .filter((it) => !isKit(it))
        .map((it) => ({ id: it.id, companyId: it.companyId, name: name(it), kind: it.kind, onHand: it.onHand }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Make an item a set, or change its parts (an empty list makes it an ordinary item again). Always with a reason. */
  async setParts(user: User, i: Record<string, unknown>) {
    const kit = await this.item(i.itemId);
    if (!this.keeps(user, kit.companyId)) throw new AccessDenied('view', '(the Inventory Manager or the Procurement executive keeps the sets)');
    const reason = s(i.reason);
    if (!reason) throw new BadRequest('Say why the set changes.');
    const raw = Array.isArray(i.parts) ? (i.parts as Record<string, unknown>[]) : [];
    if (raw.length > KIT_RULE.maxParts) throw new BadRequest(`At most ${KIT_RULE.maxParts} parts in one set.`);
    const items = (await this.store.list('stockItems', { companyId: [kit.companyId] })) as StockItem[];
    const parts: { stockItemId: Id; qty: number }[] = [];
    for (const [k, p] of raw.entries()) {
      const at = `Part ${k + 1}`;
      const it = items.find((x) => x.id === s(p.stockItemId, 160));
      if (!it) throw new BadRequest(`${at}: choose an item from the same store.`);
      if (it.id === kit.id) throw new BadRequest(`${at}: a set cannot be a part of itself.`);
      if (isKit(it)) throw new BadRequest(`${at}: ${it.name} is a set itself. Add its parts instead.`);
      if (parts.some((x) => x.stockItemId === it.id)) throw new BadRequest(`${at}: ${it.name} is already in the set. Change its quantity instead.`);
      const qty = Number(p.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > KIT_RULE.maxQtyPerPart) throw new BadRequest(`${at}: quantity a whole number from 1 to ${KIT_RULE.maxQtyPerPart}.`);
      parts.push({ stockItemId: it.id, qty });
    }
    if (parts.length && (kit.onHand > 0 || (kit.opening && !kit.opening.confirmed)))
      throw new BadRequest(`${kit.name} has stock of its own (${kit.onHand} in the store). A set holds no stock: add a new item for the set, or keep this one as a part.`);
    if (parts.length && items.some((x) => x.kitParts?.some((p) => p.stockItemId === kit.id)))
      throw new BadRequest(`${kit.name} is a part of another set. A part cannot also be a set.`);
    return this.save(user, kit, parts, reason);
  }

  /** Add a new part to a set in one step: a new store item (stock zero) linked to the set. */
  async addPart(user: User, i: Record<string, unknown>) {
    const kit = await this.item(i.kitId);
    if (!this.keeps(user, kit.companyId)) throw new AccessDenied('view', '(the Inventory Manager or the Procurement executive keeps the sets)');
    const name = s(i.name, 120);
    const sku = s(i.sku, 40).toUpperCase();
    if (!name) throw new BadRequest('Name the part (for example Epaulette, Badge, Trousers, Shoes, Belt).');
    if (!sku) throw new BadRequest('Give the part an item code.');
    const kind = KINDS.find((x) => x === i.kind) ?? kit.kind;
    const qty = Number(i.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > KIT_RULE.maxQtyPerPart) throw new BadRequest(`Quantity in one set: a whole number from 1 to ${KIT_RULE.maxQtyPerPart}.`);
    const reorderAt = Number(i.reorderAt ?? 0);
    if (!Number.isInteger(reorderAt) || reorderAt < 0 || reorderAt > 100_000) throw new BadRequest('Reorder level: a whole number, 0 or more.');
    if (kit.onHand > 0) throw new BadRequest(`${kit.name} has stock of its own (${kit.onHand}). A set holds no stock: add a new item for the set first.`);
    const items = (await this.store.list('stockItems', { companyId: [kit.companyId] })) as StockItem[];
    if (items.some((x) => x.sku.toUpperCase() === sku)) throw new BadRequest(`Item code ${sku} is already used in this store.`);
    if ((kit.kitParts ?? []).length >= KIT_RULE.maxParts) throw new BadRequest(`At most ${KIT_RULE.maxParts} parts in one set.`);
    const size = s(i.size, 20) || null;
    const id = `stk-${kit.companyId}-${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 160);
    if (await this.store.get('stockItems', id)) throw new BadRequest(`Item code ${sku} is already used in this store.`);
    const part: StockItem = {
      id,
      companyId: kit.companyId,
      sku,
      name,
      kind,
      size,
      onHand: 0,
      reorderAt,
      ...(kit.charge ? { charge: kit.charge, rentalMonthly: null, salePrice: null } : {}),
    };
    const at = this.clock();
    return this.store.transaction(async (tx) => {
      await tx.insert('stockItems', part);
      await tx.audit({ at, actor: user.name, companyId: kit.companyId, action: 'store.item_add', entity: 'stock_item', entityId: id, summary: `${user.name} added ${name}${size ? ` (${size})` : ''} as a part of ${kit.name}` });
      return this.save(user, kit, [...(kit.kitParts ?? []), { stockItemId: id, qty }], `added part ${name}${size ? ` (${size})` : ''}`, tx);
    });
  }

  private async save(user: User, kit: StockItem, parts: { stockItemId: Id; qty: number }[], note: string, via?: Store) {
    const at = this.clock();
    const run = async (tx: Store) => {
      await tx.lock?.('stockItems', kit.id);
      const cur = (await tx.get('stockItems', kit.id)) as StockItem | undefined;
      if (!cur) throw new NotFound('Store item');
      const kitHistory = [...(cur.kitHistory ?? []), { at, by: user.name, byId: user.id, note }].slice(-50);
      await tx.update('stockItems', kit.id, { kitParts: parts.length ? parts : null, kitHistory });
      await tx.audit({ at, actor: user.name, companyId: kit.companyId, action: 'store.kit_parts', entity: 'stock_item', entityId: kit.id, summary: `${kit.name}: ${parts.length} part(s) by ${user.name} (${note.slice(0, 200)})` });
      return { id: kit.id, name: kit.name, parts };
    };
    return via ? run(via) : this.store.transaction(run);
  }

  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'kits':
        return this.list(user, i);
      case 'kitParts':
        return this.setParts(user, i);
      case 'kitAddPart':
        return this.addPart(user, i);
      default:
        throw new BadRequest(`Unknown set action ${op}`);
    }
  }
}
