// P91 (Fitri, 9 Nov 2026: "where do I add the items? Add manually, or by Excel/PDF?"): the item register loads the old
// system's lists through the same server actions as the Items screen's own Add. Item types go through sku.add, units
// through item.register (each unit a new Prima ID, on the "labels to print and scan back" list exactly like a manual
// registration), bulk stock through lot.add. Each row carries the action's own permission check, so nobody imports what
// they could not add by hand.
//
// What the old list says about where a unit is, its condition and who holds it is kept with the unit as a reference
// (legacyFrom). It is never turned into a handover: a handover needs the printed label scanned and the item checked first,
// and the person who gets it confirms it themselves. Firearms stay in Arms Control (sku.add refuses them).

import { matchOption, normHeader } from './import-align';
import { decodeCard, decodeUnits, primaCodeOf } from './item-report';
import { BASE_UOMS, ITEM_CATEGORIES, type BaseUom, type ItemCategory, type ItemSku, type PhysicalItem, type TrackingMode, type ItemLot } from './items';
import type { ItemService } from './item-service';
import { BadRequest } from './service';
import type { Store } from './store';
import type { Id, User } from './types';

/** The kinds the Items screen imports. */
export type ItemImportKind = 'itemType' | 'itemUnit' | 'itemStock' | 'itemList';
export const ITEM_IMPORT_KINDS: readonly ItemImportKind[] = ['itemType', 'itemUnit', 'itemStock', 'itemList'];

/** Categories as the Items screen names them. */
export const ITEM_CATEGORY_WORDS: [ItemCategory, string][] = [
  ['uniform', 'Uniform'],
  ['footwear', 'Shoes and boots'],
  ['vest', 'Vests'],
  ['torchlight', 'Torchlights'],
  ['radio', 'Radios'],
  ['phone', 'Phones'],
  ['patrol_device', 'Patrol devices'],
  ['bodycam', 'Body cameras'],
  ['it_device', 'IT devices'],
  ['office', 'Office items'],
  ['furniture', 'Furniture'],
  ['cleaning', 'Cleaning'],
  ['safety', 'Safety gear'],
  ['tools', 'Tools'],
  ['other', 'Other'],
];
export const ITEM_TRACKING_WORDS: [TrackingMode, string][] = [
  ['SERIALIZED', 'Each unit has its own label'],
  ['BULK', 'Counted by quantity'],
];
export const ITEM_UOM_WORDS: [BaseUom, string][] = [
  ['PCS', 'Pieces'],
  ['PAIR', 'Pair'],
  ['SET', 'Set'],
  ['BOX', 'Box'],
  ['BOTTLE', 'Bottle'],
  ['LITRE', 'Litre'],
  ['ROLL', 'Roll'],
];

/** Words old lists use (English and Malay), by value. Checked word by word after the exact choices. */
const CATEGORY_SYNONYMS: Record<ItemCategory, string[]> = {
  uniform: ['uniform', 'uniforms', 'seragam', 'pakaian', 'baju', 'shirt', 'kemeja', 'seluar', 'trousers', 'pants', 'cap', 'topi', 'beret', 'belt', 'tali pinggang', 'jacket', 'jaket', 'tie'],
  footwear: ['footwear', 'kasut', 'shoe', 'shoes', 'boot', 'boots', 'but', 'sandal'],
  vest: ['vest', 'vests', 'rompi', 'reflective vest', 'safety vest'],
  torchlight: ['torch', 'torchlight', 'torchlights', 'lampu suluh', 'flashlight', 'lampu'],
  radio: ['radio', 'radios', 'walkie talkie', 'walkie', 'walkie-talkie', 'handheld radio', 'ht'],
  phone: ['phone', 'phones', 'telefon', 'handphone', 'mobile', 'smartphone', 'telefon bimbit'],
  patrol_device: ['patrol', 'patrol device', 'guard tour', 'rondaan', 'alat rondaan', 'clocking', 'wand'],
  bodycam: ['bodycam', 'body cam', 'body camera', 'body worn camera', 'kamera badan'],
  it_device: ['it', 'it device', 'it devices', 'laptop', 'computer', 'komputer', 'desktop', 'tablet', 'printer', 'pencetak', 'monitor'],
  office: ['office', 'pejabat', 'alat tulis', 'stationery', 'office item', 'peralatan pejabat'],
  furniture: ['furniture', 'perabot', 'kerusi', 'meja', 'chair', 'table', 'desk', 'almari', 'cabinet', 'locker', 'loker'],
  cleaning: ['cleaning', 'pembersihan', 'cleaner', 'detergent', 'sabun', 'cleaning stock', 'bahan pembersih'],
  safety: ['safety', 'keselamatan', 'ppe', 'helmet', 'topi keledar', 'gloves', 'sarung tangan', 'mask', 'raincoat', 'baju hujan'],
  tools: ['tools', 'tool', 'alat', 'alatan', 'perkakas', 'equipment'],
  other: ['other', 'others', 'lain', 'lain lain', 'misc', 'pelbagai'],
};
const TRACKING_SYNONYMS: Record<'SERIALIZED' | 'BULK', string[]> = {
  SERIALIZED: ['serialized', 'serialised', 'serial', 'each', 'each unit', 'unit', 'per unit', 'individual', 'siri', 'satu satu', 'setiap unit', 'label', 'own label', 'asset', 'aset'],
  BULK: ['bulk', 'quantity', 'qty', 'by quantity', 'kuantiti', 'pukal', 'consumable', 'stock', 'stok', 'count', 'counted'],
};
const UOM_SYNONYMS: Record<BaseUom, string[]> = {
  PCS: ['pcs', 'pc', 'piece', 'pieces', 'piecse', 'unit', 'units', 'nos', 'no', 'ea', 'each', 'biji', 'helai', 'keping', 'buah', 'batang', 'unit unit'],
  PAIR: ['pair', 'pairs', 'pr', 'prs', 'pasang', 'psg'],
  SET: ['set', 'sets', 'kit', 'kits'],
  BOX: ['box', 'boxes', 'bx', 'kotak', 'carton', 'ctn', 'pack', 'pek', 'paket', 'pkt'],
  BOTTLE: ['bottle', 'bottles', 'btl', 'botol'],
  LITRE: ['litre', 'litres', 'liter', 'l', 'ltr', 'lit'],
  ROLL: ['roll', 'rolls', 'gulung', 'rol'],
};

function bySynonym<K extends string>(raw: string, words: Record<K, string[]>): K | null {
  const n = normHeader(raw);
  if (!n) return null;
  const keys = Object.keys(words) as K[];
  const whole = keys.filter((k) => words[k].some((w) => normHeader(w) === n));
  if (whole.length === 1) return whole[0];
  const parts = n.split(' ');
  const some = keys.filter((k) => words[k].some((w) => parts.includes(normHeader(w))));
  return some.length === 1 ? some[0] : null;
}

/** A category from the list, a key, or a word an old list uses ("Kasut" is shoes). Null when it cannot tell. */
export function itemCategoryOf(raw: string): ItemCategory | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if ((ITEM_CATEGORIES as string[]).includes(v)) return v as ItemCategory;
  return (matchOption(v, ITEM_CATEGORY_WORDS) as ItemCategory | null) ?? bySynonym(v, CATEGORY_SYNONYMS);
}
export function itemTrackingOf(raw: string): 'SERIALIZED' | 'BULK' | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (v === 'SERIALIZED' || v === 'BULK') return v;
  return (matchOption(v, ITEM_TRACKING_WORDS) as 'SERIALIZED' | 'BULK' | null) ?? bySynonym(v, TRACKING_SYNONYMS);
}
export function itemUomOf(raw: string): BaseUom | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if ((BASE_UOMS as string[]).includes(v.toUpperCase())) return v.toUpperCase() as BaseUom;
  return bySynonym(v, UOM_SYNONYMS) ?? (matchOption(v, ITEM_UOM_WORDS) as BaseUom | null);
}

/**
 * The catalogue code for a row: the code as written, made upper case with dashes ("shirt navy l" is SHIRT-NAVY-L), or,
 * when the old list has no code, made the same way from the name and size.
 */
export function itemCodeOf(code: string, name: string, size: string): string {
  const shape = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  const given = shape(String(code ?? ''));
  if (given) return given.slice(0, 40).replace(/-+$/, '');
  const made = shape([name, size].filter((x) => String(x ?? '').trim()).join(' '));
  return made.slice(0, 40).replace(/-+$/, '');
}

/** An item type named by its code, its name, or its name with its size ("Shirt navy L"). */
export function findItemType(skus: ItemSku[], raw: string): { sku: ItemSku | null; problem: string | null } {
  const v = String(raw ?? '').trim();
  if (!v) return { sku: null, problem: 'Item type is empty on this row.' };
  const n = normHeader(v);
  const tries: ((s: ItemSku) => boolean)[] = [
    (s) => s.id === v || normHeader(s.code) === n,
    (s) => normHeader(s.name) === n,
    (s) => normHeader(`${s.name} ${s.size ?? ''}`) === n || normHeader(`${s.code} ${s.name}`) === n,
  ];
  for (const t of tries) {
    const hit = skus.filter(t);
    if (hit.length === 1) return { sku: hit[0], problem: null };
    if (hit.length > 1) return { sku: null, problem: `Item type "${v.slice(0, 60)}" matches more than one item type; use its code.` };
  }
  return { sku: null, problem: `Item type "${v.slice(0, 60)}" is not in the catalogue. Add the item type first (Item types, or import the item types).` };
}

export interface ItemTypeRow {
  code: string;
  name: string;
  category: string;
  tracking: string;
  uom: string;
  size: string;
  colour: string;
  consumable: boolean;
  supplierBarcodes: string;
}
export interface ItemUnitRow {
  partyId: Id;
  sku: string;
  serial: string;
  tag: string;
  count: number | null;
  location: string;
  condition: string;
  keeper: string;
}
export interface ItemStockRow {
  partyId: Id;
  sku: string;
  qty: number | null;
  location: string;
  note: string;
}

const fail = (m: string): never => {
  throw new BadRequest(m);
};
const rid = () => `imp-${globalThis.crypto.randomUUID()}`;

/** One item type through sku.add (store staff and managers; IT for IT devices). */
export async function importItemType(items: ItemService, user: User, r: ItemTypeRow): Promise<{ id: Id }> {
  const name = String(r.name ?? '').trim();
  const category = itemCategoryOf(r.category) ?? fail(`Category "${String(r.category ?? '').slice(0, 40)}" is not one of: ${ITEM_CATEGORY_WORDS.map(([, l]) => l).join(', ')}.`);
  const tracking = itemTrackingOf(r.tracking) ?? fail('Tracked: write "each unit" (own label) or "by quantity".');
  const uom = String(r.uom ?? '').trim() ? (itemUomOf(r.uom) ?? fail(`Unit "${String(r.uom).slice(0, 20)}" is not one of: PCS, PAIR, SET, BOX, BOTTLE, LITRE, ROLL.`)) : 'PCS';
  const code = itemCodeOf(r.code, name, r.size);
  const barcodes = String(r.supplierBarcodes ?? '')
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = (await items.act(user, rid(), {
    kind: 'sku.add',
    code,
    name,
    category,
    tracking,
    uom,
    size: String(r.size ?? '').trim() || undefined,
    colour: String(r.colour ?? '').trim() || undefined,
    consumable: tracking === 'BULK' && r.consumable === true,
    supplierBarcodes: barcodes,
  })) as { result: ItemSku };
  return { id: out.result.id };
}

/**
 * Units from the old list through item.register: a new Prima ID each, no label yet (to print and scan back), an opening
 * balance not yet verified, the old tag kept as a reference. An IT device whose serial or old tag is in the IT register is
 * linked to it (one device, one record).
 */
export async function importItemUnit(items: ItemService, store: Store, user: User, r: ItemUnitRow): Promise<{ ids: Id[] }> {
  const found = findItemType(await store.list('itemSkus'), r.sku);
  const sku = found.sku ?? fail(found.problem!);
  if (sku.tracking === 'BULK') fail(`${sku.code} is counted by quantity: import it as item stock, not as units.`);
  if (sku.tracking === 'KIT') fail(`${sku.code} is a set: register its parts, then make the set on the Items screen.`);
  const serial = String(r.serial ?? '').trim();
  const tag = String(r.tag ?? '').trim();
  const count = r.count == null ? 1 : Number(r.count);
  if (!Number.isInteger(count) || count < 1 || count > 50) fail('How many units: a whole number from 1 to 50.');
  if (count > 1 && (serial || tag)) fail('A row with a serial number or an old tag is one unit: give each unit its own row.');
  let itAssetId: Id | undefined;
  if (sku.category === 'it_device' && (serial || tag)) {
    const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
    const hit = (await store.list('itAssets')).filter((a) => (serial && a.serial && norm(a.serial) === norm(serial)) || (tag && norm(a.tag) === norm(tag)));
    if (hit.length === 1) itAssetId = hit[0].id;
  }
  const from = { where: String(r.location ?? '').trim(), condition: String(r.condition ?? '').trim(), holder: String(r.keeper ?? '').trim() };
  const out = (await items.act(user, rid(), {
    kind: 'item.register',
    skuId: sku.id,
    partyId: r.partyId,
    count,
    ...(serial ? { serials: [serial] } : {}),
    ...(itAssetId ? { itAssetId } : {}),
    legacyUnverified: true,
    ...(tag ? { legacyRef: tag } : {}),
    legacyFrom: from,
    note: `From the old system${tag ? `, old tag ${tag.slice(0, 60)}` : ''}. Label to print and scan back, then the check.`,
  })) as { result: PhysicalItem[] };
  return { ids: out.result.map((i) => i.id) };
}

/** Bulk stock from the old list through lot.add, into the owner company's store, as Add stock records it. */
export async function importItemStock(items: ItemService, store: Store, user: User, r: ItemStockRow): Promise<{ id: Id }> {
  const found = findItemType(await store.list('itemSkus'), r.sku);
  const sku = found.sku ?? fail(found.problem!);
  if (sku.tracking !== 'BULK') fail(`${sku.code} has a label on each unit: import it as units, not as stock.`);
  const qty = Number(r.qty);
  if (r.qty == null || !Number.isInteger(qty) || qty < 1 || qty > 100000) fail('Quantity: a whole number from 1 to 100000.');
  const where = String(r.location ?? '').trim();
  const said = String(r.note ?? '').trim();
  const note = `Opening balance from the old system${where ? ` (was at ${where.slice(0, 60)})` : ''}${said ? `: ${said}` : ''}`.slice(0, 200);
  const out = (await items.act(user, rid(), { kind: 'lot.add', skuId: sku.id, partyId: r.partyId, qty, note })) as { result: ItemLot };
  return { id: out.result.id };
}

// ---------- P98: any item list or stock report (kind itemList) ----------

/**
 * One item of an old system's item list or stock report, as the Items screen's import sends it after reading the files
 * (item-report.ts). The server reads every cell again here.
 */
export interface ItemListRow {
  partyId: Id | null;
  code: string;
  name: string;
  group: string;
  category: string;
  tracking: string;
  unit: string;
  units: string;
  lastCost: string;
  lastCostUom: string;
  supplier: string;
  qty: number | null;
  qtyAsOf: string;
  location: string;
  batch: string;
  size: string;
  colour: string;
  barcode: string;
  history: string;
  note: string;
}

/** What one item of the list did: a new item type, a change, or nothing new; and its opening stock. */
export interface ItemListOutcome {
  id: Id;
  code: string;
  action: 'create' | 'update' | 'same';
  stock: 'added' | 'kept' | 'none';
  notes: string[];
}

/**
 * One item of an old list into the catalogue, matched by its old code: a new item type through sku.add (its Prima code
 * made from the old code, its label QR and barcode from that), or the same type brought up to date through sku.update.
 * The quantity becomes the opening stock of the chosen company through lot.add only when that company has no stock of
 * it yet; a figure below zero or not whole is kept as a reference and the item is left to count.
 */
export async function importItemList(items: ItemService, store: Store, user: User, r: ItemListRow): Promise<ItemListOutcome> {
  const tidy = (v: unknown, n: number) =>
    String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, n);
  const source = tidy(r.code, 60).toUpperCase();
  const name = tidy(r.name, 120) || source;
  if (!name) fail('Each item needs its code or its description.');
  const category = itemCategoryOf(r.category) ?? fail(`Category "${tidy(r.category, 40)}" is not one of: ${ITEM_CATEGORY_WORDS.map(([, l]) => l).join(', ')}.`);
  const tracking = String(r.tracking ?? '').trim() ? (itemTrackingOf(r.tracking) ?? fail('Tracked: write "each unit" (own label) or "by quantity".')) : 'BULK';
  const label = tidy(r.unit, 20).toUpperCase();
  const uom: BaseUom = (label && itemUomOf(label)) || 'PCS';
  const units = decodeUnits(r.units) ?? fail('The units (UOM, rate, cost, price) could not be read.');
  const card = decodeCard(r.history);
  if (card === 'bad') fail('The stock card summary could not be read.');
  const cost = String(r.lastCost ?? '').trim();
  const lastCost = cost ? { cost, uom: tidy(r.lastCostUom, 20) || null, supplier: tidy(r.supplier, 80) || null } : undefined;
  const qty = r.qty == null || String(r.qty) === '' ? null : Number(r.qty);
  if (qty !== null && !Number.isFinite(qty)) fail('The quantity is not a number.');
  const asOf = tidy(r.qtyAsOf, 10);
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail('The date of the quantity is not a date.');
  const prima = primaCodeOf(source, name);
  // Looked up by the old code, then by the Prima code (a type added by hand before the import), never by listing all.
  const bySource = source ? await store.list('itemSkus', { sourceCode: source } as never) : [];
  let sku = bySource[0] ?? (await store.list('itemSkus', { code: prima })).find((s) => !s.sourceCode) ?? null;
  const notes: string[] = [];
  // The opening stock: a whole number above zero, into a company with no stock of this type yet.
  const partyId = r.partyId;
  let stockQty: number | null = null;
  const stockTracking = sku?.tracking ?? tracking;
  if (qty !== null && partyId) {
    if (stockTracking !== 'BULK') notes.push(`Each unit has its own label: register the ${qty} units on Stock and labels; no stock is added.`);
    else if (qty < 0) notes.push(`The old system shows ${qty} (below zero): no stock added. Count it.`);
    else if (!Number.isInteger(qty)) notes.push(`The old system shows ${qty} (not a whole number): no stock added. Count it.`);
    else if (qty > 100000) notes.push(`The old system shows ${qty}: more than 100000 at once is not added. Add it by hand.`);
    else if (qty > 0) {
      const lots = sku ? await store.list('itemLots', { skuId: sku.id, ownerPartyId: partyId }) : [];
      if (lots.length) notes.push(`Prima already has stock of this item for the company (${lots.reduce((a, l) => a + l.qty, 0)}): not changed. Count it to correct.`);
      else stockQty = qty;
    }
  }
  const legacy = {
    qty,
    qtyAsOf: asOf || null,
    stocked: stockQty !== null && partyId ? { partyId, qty: stockQty } : null,
    card: card === 'bad' ? null : card,
    location: tidy(r.location, 60) || null,
    batch: tidy(r.batch, 40) || null,
    note: tidy(r.note, 200) || null,
  };
  const extras = {
    ...(String(r.group ?? '').trim() ? { group: tidy(r.group, 60) } : {}),
    ...(units.length ? { units } : {}),
    ...(label && label !== uom ? { uomLabel: label } : {}),
    ...(lastCost ? { lastCost } : {}),
    legacy,
  };
  let action: ItemListOutcome['action'];
  if (!sku) {
    // A new type: its code from the old code; another old code that makes the same Prima code gets -2, -3.
    let code = prima;
    if (!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(code)) fail(`The code "${source || name}" gives no usable Prima code: give the item a code of letters and digits.`);
    for (let k = 2; (await store.list('itemSkus', { code })).length; k++) {
      if (k > 50) fail(`Too many items make the code ${prima}: give this item a code of its own.`);
      code = `${prima.slice(0, 40 - String(k).length - 1).replace(/-+$/, '')}-${k}`;
    }
    if (code !== prima) notes.push(`Prima code ${code}: ${prima} is another item.`);
    const barcode = tidy(r.barcode, 40);
    const out = (await items.act(user, rid(), {
      kind: 'sku.add',
      code,
      name: name.length < 3 ? `${name} (${code})`.slice(0, 120) : name,
      category,
      tracking,
      uom,
      size: tidy(r.size, 20) || undefined,
      colour: tidy(r.colour, 30) || undefined,
      consumable: false,
      supplierBarcodes: barcode ? [barcode] : [],
      ...(source ? { sourceCode: source } : {}),
      ...extras,
    })) as { result: ItemSku };
    sku = out.result;
    action = 'create';
  } else {
    const found: ItemSku = sku;
    const better = name.length >= found.name.length && name !== found.name && name.length >= 3;
    const out = (await items.act(user, rid(), {
      kind: 'sku.update',
      skuId: found.id,
      ...(better ? { name } : {}),
      ...(source && !found.sourceCode ? { sourceCode: source } : {}),
      ...extras,
    })) as { result: ItemSku };
    action = out.result.version === found.version ? 'same' : 'update';
    if (found.category !== category) notes.push(`Kept as ${ITEM_CATEGORY_WORDS.find(([k]) => k === found.category)?.[1] ?? found.category}: the category of an item type is changed by hand.`);
    if (found.tracking !== tracking) notes.push('Kept as it is tracked now: how an item type is tracked is set once.');
    sku = out.result;
  }
  let stock: ItemListOutcome['stock'] = 'none';
  if (stockQty !== null && partyId) {
    await items.act(user, rid(), { kind: 'lot.add', skuId: sku.id, partyId, qty: stockQty, note: `Opening balance from the old system${asOf ? ` as at ${asOf}` : ''}${legacy.location ? ` (${legacy.location})` : ''}` });
    stock = 'added';
  } else if (notes.some((n) => n.startsWith('Prima already has stock'))) stock = 'kept';
  return { id: sku.id, code: sku.code, action, stock, notes };
}
