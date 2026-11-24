import type { Id, IsoDateTime, ItPurchase, PurRequest } from './types';

/**
 * The Procurement request that buys an IT purchase (Fauzan, 27 Oct 2026: IT purchases go through Procurement). It is
 * raised in the requester's name, so the person who asked can never approve it, and it then follows the usual flow:
 * three quoted suppliers with their documents, the online price, COO and CEO approval, the storekeeper receives and
 * Finance matches the invoice.
 */
export function itPurchaseRequest(p: ItPurchase, seq: number, at: IsoDateTime): PurRequest {
  const lines = p.items.map((i) => ({ item: i.description, stockItemId: null as Id | null, qty: i.qty, unitPrice: i.unitPrice }));
  return {
    id: `pr-${p.ownerId}-it-${p.id}`,
    companyId: p.ownerId,
    ref: `PR-${p.ownerId.replace('co-', '').toUpperCase()}-${String(seq).padStart(4, '0')}`,
    title: `${p.ref}: ${p.reason}`.slice(0, 120),
    category: 'IT',
    lines,
    total: Math.round(lines.reduce((n, l) => n + l.qty * l.unitPrice, 0) * 100) / 100,
    raisedBy: p.requestedBy,
    raisedById: p.requestedById,
    at,
    quotes: [],
    online: [],
    onlineReason: null,
    itPurchaseId: p.id,
    chosenSupplierId: null,
    notLowestReason: null,
    tiers: [],
    approvals: [],
    status: 'quoting',
    rejected: null,
    po: null,
    grn: null,
    invoice: null,
    match: null,
    posted: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Procurement and store check (Fauzan, 23 Nov 2026 "Do the gap"): small read-only helpers for the Purchasing board.

/**
 * The next purchase number for a company: one more than the highest number already used, so a number is never reused
 * even if an older request is gone from the list (the old count-based number could repeat when two were raised at once;
 * the service also holds a per-company lock while it numbers).
 */
export function nextPurRef(companyId: Id, existing: { ref: string }[]): string {
  const code = companyId.replace('co-', '').toUpperCase();
  const prefix = `PR-${code}-`;
  let max = 0;
  for (const r of existing) {
    if (!r.ref.startsWith(prefix)) continue;
    const n = Number(r.ref.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** What one unit cost on a received purchase: the line's estimate scaled to the ordered amount (as goods received does). */
export function purUnitCost(r: Pick<PurRequest, 'lines' | 'po'>, lineIndex: number): number | null {
  const l = r.lines[lineIndex];
  if (!l || !(l.unitPrice > 0)) return null;
  const est = r.lines.reduce((n, x) => n + x.qty * x.unitPrice, 0);
  const scale = r.po && est > 0 ? r.po.amount / est : 1;
  return Math.round(l.unitPrice * scale * 100) / 100;
}

/**
 * The last price paid for a store item: the most recent received purchase that had it, with its unit cost. Shown beside
 * a new quote so a dearer price is seen; it decides nothing.
 */
export function lastPaidFor(
  stockItemId: Id | null,
  requests: PurRequest[],
  notId: Id,
): { unitPrice: number; ref: string; on: string; supplierId: Id | null } | null {
  if (!stockItemId) return null;
  let best: { unitPrice: number; ref: string; on: string; supplierId: Id | null } | null = null;
  for (const r of requests) {
    if (r.id === notId || !r.grn) continue;
    const i = r.lines.findIndex((l) => l.stockItemId === stockItemId);
    if (i < 0) continue;
    const unitPrice = purUnitCost(r, i);
    if (unitPrice == null) continue;
    const on = r.grn.at.slice(0, 10);
    if (!best || on > best.on) best = { unitPrice, ref: r.ref, on, supplierId: r.chosenSupplierId };
  }
  return best;
}

/** Whether an order is late: the supplier's promised date has passed and the goods are not in. */
export function purOrderLate(r: Pick<PurRequest, 'status' | 'po'>, today: string): boolean {
  return r.status === 'ordered' && !!r.po?.expectedOn && r.po.expectedOn < today;
}

export interface SupplierRecord {
  /** Orders placed with the supplier. */
  orders: number;
  /** Received orders with a promised date: on time or late. Received orders without a date are Unknown. */
  onTime: number;
  late: number;
  noDate: number;
  /** Orders still open past the promised date. */
  lateOpen: number;
  /** Pieces received, and of them damaged or the wrong item (to return to the supplier). */
  pieces: number;
  damaged: number;
  wrong: number;
  /** Invoices that did not match the order and the goods. */
  mismatches: number;
}

/** A supplier's record from its own orders: delivery on time, damaged and wrong pieces, invoice mismatches. */
export function supplierRecord(supplierId: Id, requests: PurRequest[], today: string): SupplierRecord {
  const rec: SupplierRecord = { orders: 0, onTime: 0, late: 0, noDate: 0, lateOpen: 0, pieces: 0, damaged: 0, wrong: 0, mismatches: 0 };
  for (const r of requests) {
    if (r.chosenSupplierId !== supplierId || !r.po) continue;
    rec.orders++;
    if (r.grn) {
      const due = r.po.expectedOn ?? null;
      if (!due) rec.noDate++;
      else if (r.grn.at.slice(0, 10) > due) rec.late++;
      else rec.onTime++;
      rec.pieces += r.grn.qty.reduce((n, q) => n + q, 0);
      for (const c of r.grn.condition ?? []) {
        rec.damaged += c.damaged;
        rec.wrong += c.wrong;
      }
    } else if (purOrderLate(r, today)) rec.lateOpen++;
    if (r.match && !r.match.ok) rec.mismatches++;
  }
  return rec;
}

/** The Purchase Order as lines of a plain PDF: supplier, delivery, lines, amount and who approved it. */
export function purOrderPdfLines(
  r: PurRequest,
  buyer: string,
  supplier: { name: string; ssmNo: string } | null,
): string[] {
  const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const est = r.lines.reduce((n, l) => n + l.qty * l.unitPrice, 0);
  const po = r.po!;
  const quote = r.quotes.find((q) => q.supplierId === r.chosenSupplierId) ?? null;
  return [
    `PURCHASE ORDER ${po.ref}`,
    '',
    `Buyer: ${buyer}`,
    `Supplier: ${supplier ? `${supplier.name} (SSM ${supplier.ssmNo})` : '-'}`,
    `Supplier quotation: ${quote?.ref ?? '-'}`,
    `Order date: ${po.at.slice(0, 10)}`,
    `Deliver by: ${po.expectedOn ?? 'as agreed with the supplier'}`,
    `Our reference: ${r.ref} (${r.title})`,
    '',
    'No | Item | Qty | Unit price | Amount',
    ...r.lines.map((l, i) => {
      const unit = purUnitCost(r, i) ?? l.unitPrice;
      return `${i + 1} | ${l.item} | ${l.qty} | ${rm(unit)} | ${rm(Math.round(unit * l.qty * 100) / 100)}`;
    }),
    '',
    `Total: ${rm(po.amount)}${Math.abs(est - po.amount) > 0.005 ? ' (as quoted by the supplier)' : ''}`,
    '',
    `Approved by: ${r.approvals.map((a) => `${a.by} (${a.tier.toUpperCase()}, ${a.at.slice(0, 10)})`).join('; ') || '-'}`,
    `Ordered by: ${po.by}`,
    '',
    'Please quote the PO number on your delivery order and invoice, and send a validated e-Invoice (MyInvois).',
    'Goods are checked on arrival; damaged or wrong items are returned at the supplier\'s cost.',
  ];
}
