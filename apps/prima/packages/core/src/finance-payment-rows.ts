/**
 * Finance payments in their own table (Finance study gap B3, Fauzan 23 Nov 2026: "We doing all now").
 *
 * Until module fin-payments-v1 is installed every company's payments sit inside its one Finance status row
 * (prima.fin_status, data->'payments'), so the row grows with every payment and every payment step rewrites it. With
 * the module installed, each payment is one row of prima.fin_payments (same company wall), and this wrapper keeps the
 * Finance code unchanged: reading a Finance status row fills `payments` from the table, and saving `payments` writes
 * only the payments that changed. A payment is never deleted: one left out of a save is marked removed and hidden.
 *
 * The wrapper is applied only when the table exists (Store.hasTable), so before the module runs nothing changes.
 */
import type { Store } from './store';
import type { FinPayment, FinStatus, Id } from './types';

export interface FinPaymentRow {
  /** `${companyId}:${payment.id}` */
  id: Id;
  companyId: Id;
  /** Order in the company's list (the order the payments were made). */
  seq: number;
  payment: FinPayment;
  /** Left out of a later save (never deleted). */
  removed?: boolean;
}

const FINPAY = Symbol.for('prima.finPayments');
const rowId = (companyId: Id, paymentId: Id) => `${companyId}:${paymentId}`;
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

async function rowsOf(store: Store, companyIds: Id[]): Promise<Map<Id, FinPaymentRow[]>> {
  const out = new Map<Id, FinPaymentRow[]>();
  if (!companyIds.length) return out;
  for (const r of await store.list('finPayments', { companyId: companyIds })) {
    if (!companyIds.includes(r.companyId)) continue;
    const list = out.get(r.companyId) ?? [];
    list.push(r);
    out.set(r.companyId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.seq - b.seq);
  return out;
}

function withPayments(f: FinStatus, rows: FinPaymentRow[] | undefined): FinStatus {
  const own = (rows ?? []).filter((r) => !r.removed).map((r) => r.payment);
  // A payment still inside the row (written before the module copied it out) is kept after the table's own.
  const left = (f.payments ?? []).filter((p) => !own.some((q) => q.id === p.id));
  return { ...f, payments: [...own, ...left] };
}

async function savePayments(store: Store, companyId: Id, next: FinPayment[]) {
  const have = (await rowsOf(store, [companyId])).get(companyId) ?? [];
  const byId = new Map(have.map((r) => [r.payment.id, r]));
  const keep = new Set<Id>();
  for (let i = 0; i < next.length; i++) {
    const p = next[i];
    keep.add(p.id);
    const r = byId.get(p.id);
    if (!r) await store.insert('finPayments', { id: rowId(companyId, p.id), companyId, seq: i, payment: p });
    else if (r.removed || r.seq !== i || !same(r.payment, p)) await store.update('finPayments', r.id, { seq: i, payment: p, removed: false });
  }
  for (const r of have) if (!keep.has(r.payment.id) && !r.removed) await store.update('finPayments', r.id, { removed: true });
}

/** Wraps a store so Finance payments live in their own table. Apply only when `finPayments` exists. */
export function withFinPayments<S extends Store>(store: S): S {
  if ((store as unknown as Record<symbol, unknown>)[FINPAY]) return store;
  const proxy: S = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === FINPAY) return true;
      if (prop === 'get')
        return async (table: string, id: Id) => {
          const row = await (target.get as (t: string, i: Id) => Promise<unknown>).call(proxy, table, id);
          if (table !== 'finStatus' || !row) return row;
          const f = row as FinStatus;
          return withPayments(f, (await rowsOf(proxy, [f.companyId])).get(f.companyId));
        };
      if (prop === 'list')
        return async (table: string, filter?: unknown, range?: unknown) => {
          const rows = await (target.list as (t: string, f?: unknown, r?: unknown) => Promise<unknown[]>).call(proxy, table, filter, range);
          if (table !== 'finStatus' || !rows.length) return rows;
          const fs = rows as FinStatus[];
          const by = await rowsOf(proxy, [...new Set(fs.map((f) => f.companyId))]);
          return fs.map((f) => withPayments(f, by.get(f.companyId)));
        };
      if (prop === 'insert')
        return async (table: string, row: unknown) => {
          if (table !== 'finStatus') return (target.insert as (t: string, r: unknown) => Promise<void>).call(proxy, table, row);
          const f = row as FinStatus;
          const { payments, ...rest } = f;
          await (target.insert as (t: string, r: unknown) => Promise<void>).call(proxy, table, { ...rest, payments: [] });
          if (payments?.length) await savePayments(proxy, f.companyId, payments);
        };
      if (prop === 'update')
        return async (table: string, id: Id, patch: Record<string, unknown>) => {
          const upd = target.update as (t: string, i: Id, p: unknown) => Promise<unknown>;
          if (table !== 'finStatus' || !('payments' in patch)) {
            const out = await upd.call(proxy, table, id, patch);
            return table === 'finStatus' ? withPayments(out as FinStatus, (await rowsOf(proxy, [(out as FinStatus).companyId])).get((out as FinStatus).companyId)) : out;
          }
          const { payments, ...rest } = patch;
          const out = (await upd.call(proxy, table, id, { ...rest, payments: [] })) as FinStatus;
          await savePayments(proxy, out.companyId, (payments as FinPayment[] | undefined) ?? []);
          return withPayments(out, (await rowsOf(proxy, [out.companyId])).get(out.companyId));
        };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(proxy) : v;
    },
  });
  return proxy;
}
