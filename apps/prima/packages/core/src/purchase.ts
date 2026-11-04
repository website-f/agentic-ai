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
