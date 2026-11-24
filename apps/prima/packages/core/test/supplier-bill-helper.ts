import type { Dataset } from '../src';
import type { PurRequest } from '../src/types';

/** A supplier bill Procurement received in Prima and nobody has posted in SQL Account yet (synthetic). */
export function receivedSupplierBill(ds: Dataset, companyId: string, n: number, at: string): PurRequest {
  const step = { by: 'Test Storekeeper', byId: 'u-test-store', at, note: 'received' };
  const r: PurRequest = {
    id: `pur-test-${companyId}-${n}`, companyId, ref: `PR-TEST-${n}`, title: `Test purchase ${n}`, category: 'OTHER',
    lines: [{ item: 'Test item', stockItemId: null, qty: 1, unitPrice: 100 }], total: 100, raisedBy: 'Test Raiser', raisedById: 'u-test-raise', at,
    quotes: [], chosenSupplierId: null, notLowestReason: null, tiers: [], approvals: [], status: 'received', rejected: null,
    po: { ref: `PO-TEST-${n}`, by: 'Test Buyer', at, amount: 100 }, grn: { ...step, qty: [1] },
    invoice: { eInvoiceUuid: `uuid-test-${n}`, number: `INV-TEST-${n}`, amount: 100, by: 'Test Clerk', at },
    match: null, posted: null,
  };
  ds.purRequests.push(r);
  return r;
}
