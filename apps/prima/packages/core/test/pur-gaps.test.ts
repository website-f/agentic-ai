import { describe, expect, it } from 'vitest';
import { MemoryStore, NotFound, PrimaService, buildWorkKpi, generateDataset, myt, nextPurRef, type StockItem, type WorkKpiScope } from '../src';

// Procurement and store check (Fauzan, 23 Nov 2026 "Do the gap"). Synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
let n = 0;
const doc = (what = 'Quote') => {
  n += 1;
  return { kind: 'document' as const, name: `${what} ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${what} ${n}`).toString('base64')}` };
};
const ITEM = 'stk-co-sasa-test-torch';

function setup(clock = { now: NOW }) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const torch: StockItem = { id: ITEM, companyId: 'co-sasa', sku: 'T-001', name: 'Torch', kind: 'GUARD_EQUIPMENT', size: null, onHand: 2, reorderAt: 5, maxAt: 20 } as StockItem;
  const radio: StockItem = { id: 'stk-goodwill-test-radio', companyId: 'goodwill', sku: 'R-001', name: 'Radio', kind: 'DEVICE', size: null, onHand: 2, reorderAt: 5, maxAt: 20 } as StockItem;
  ds.stockItems.push(torch, radio);
  const svc = new PrimaService(new MemoryStore(ds), () => clock.now);
  return { ds, svc, clock };
}

async function ordered(svc: PrimaService, expectedOn: string | undefined, unitPrice = 30) {
  const proc = await svc.user('u-proc-exec');
  const coo = await svc.user('u-coo');
  const ceo = await svc.user('u-fauzan');
  const pr = await svc.raisePurRequest(proc, 'co-sasa', { title: 'Synthetic torches', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: ITEM, qty: 10, unitPrice }] });
  for (const [k, amount] of [[1, 10 * unitPrice + 10], [2, 10 * unitPrice], [3, 10 * unitPrice + 20]] as const)
    await svc.purStep(proc, pr.id, 'quote', { supplierId: `sup-co-sasa-${k}`, amount, ref: `Q${k}`, proof: [doc()] });
  await svc.purStep(proc, pr.id, 'online', { source: 'Marketplace', ref: 'listing', amount: 10 * unitPrice, proof: [doc()] });
  await svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-2' });
  await svc.purStep(await svc.user('u-proc-manager'), pr.id, 'approve', { note: 'Stock need checked' });
  await svc.purStep(coo, pr.id, 'approve', { note: 'Checked' });
  const a = await svc.purStep(ceo, pr.id, 'approve', { note: 'Approved' });
  if (a.status !== 'approved') throw new Error('not approved');
  const o = await svc.purStep(proc, pr.id, 'order', { ref: `PO-${pr.ref}`, expectedOn });
  return { proc, coo, ceo, pr: o };
}

describe('Procurement and store gaps (23 Nov 2026)', () => {
  it('numbers purchases from the highest number used, so a number never repeats', () => {
    expect(nextPurRef('co-sasa', [])).toBe('PR-SASA-0001');
    expect(nextPurRef('co-sasa', [{ ref: 'PR-SASA-0001' }, { ref: 'PR-SASA-0007' }, { ref: 'PR-ARROW-0099' }])).toBe('PR-SASA-0008');
  });

  it('two purchases raised one after the other get different numbers', async () => {
    const { svc } = setup();
    const proc = await svc.user('u-proc-exec');
    const line = [{ item: 'Torch', stockItemId: null, qty: 1, unitPrice: 10 }];
    const a = await svc.raisePurRequest(proc, 'co-sasa', { title: 'A', category: 'OTHER', lines: line });
    const b = await svc.raisePurRequest(proc, 'co-sasa', { title: 'B', category: 'OTHER', lines: line });
    expect(a.ref).not.toBe(b.ref);
    expect(a.id).not.toBe(b.id);
  });

  it('keeps the promised delivery date, refuses a past one, and flags a late order to Procurement and the store', async () => {
    const { svc, clock } = setup();
    const proc = await svc.user('u-proc-exec');
    const { pr } = await ordered(svc, '2026-11-25');
    expect(pr.po?.expectedOn).toBe('2026-11-25');
    expect(pr.submitted?.byId).toBe(proc.id);
    // Before the date: not late; the storekeeper sees an order to receive.
    const store = await svc.user('u-proc-store1');
    let board = await svc.purBoard(proc);
    expect(board.requests.find((r) => r.req.id === pr.id)?.late).toBe(false);
    const storeHome = await svc.alertItems(store);
    expect(JSON.stringify(storeHome)).toMatch(/to receive when the goods come/);
    // After the date: late, red, on Home and in the count.
    clock.now = myt('2026-11-27', '10:00');
    board = await svc.purBoard(proc);
    const row = board.requests.find((r) => r.req.id === pr.id)!;
    expect(row.late).toBe(true);
    expect(row.tone).toBe('crit');
    expect(board.kpis.lateOrders).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(await svc.alertItems(proc))).toMatch(/past the supplier's delivery date/);
    expect(board.suppliers.find((s) => s.supplier.id === 'sup-co-sasa-2')?.record.lateOpen).toBe(1);
  });

  it('refuses a delivery date in the past', async () => {
    const { svc } = setup();
    const proc = await svc.user('u-proc-exec');
    await expect(ordered(svc, '2026-11-01')).rejects.toThrow(/delivery date/);
    void proc;
  });

  it('Procurement sees its own work on Home: purchases to quote', async () => {
    const { svc } = setup();
    const proc = await svc.user('u-proc-exec');
    await svc.raisePurRequest(proc, 'co-sasa', { title: 'Synthetic batteries', category: 'OTHER', lines: [{ item: 'AA battery', stockItemId: null, qty: 10, unitPrice: 2 }] });
    expect(JSON.stringify(await svc.alertItems(proc))).toMatch(/to quote and price online/);
  });

  it('the Inventory Manager sees low stock on Home, and a low item offers Buy more', async () => {
    const { svc } = setup();
    const im = await svc.user('u-proc-manager');
    expect(JSON.stringify(await svc.alertItems(im))).toMatch(/at or below the reorder level/);
    const board = await svc.purBoard(im);
    const row = board.stock.find((s) => s.item.id === 'stk-goodwill-test-radio')!;
    // No usage or lead time yet: up to Max (20 - 2).
    expect(row.buyMore).toEqual({ qty: 18, why: 'up to the Max level' });
  });

  it('prints the Purchase Order only after ordering, for those who see the purchase', async () => {
    const { svc } = setup();
    const proc = await svc.user('u-proc-exec');
    const draft = await svc.raisePurRequest(proc, 'co-sasa', { title: 'x', category: 'OTHER', lines: [{ item: 'x', stockItemId: null, qty: 1, unitPrice: 1 }] });
    await expect(svc.purOrderPdf(proc, draft.id)).rejects.toThrow(/not been ordered/);
    const { pr } = await ordered(svc, '2026-11-30');
    const pdf = await svc.purOrderPdf(proc, pr.id);
    expect(pdf.name).toMatch(/^PO_PO-PR-SASA-\d{4}\.pdf$/);
    const text = Buffer.from(pdf.base64, 'base64').toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text).toMatch(/PURCHASE ORDER/);
    expect(text).toMatch(/Deliver by: 2026-11-30/);
    const guard = (await svc.store.list('users')).find((u) => u.role === 'guard')!;
    await expect(svc.purOrderPdf(guard, pr.id)).rejects.toBeInstanceOf(NotFound);
  });

  it('receiving keeps damaged and wrong pieces out of stock, builds the supplier record and the last price paid', async () => {
    const { svc } = setup();
    const { proc, pr } = await ordered(svc, '2026-11-30');
    const store = await svc.user('u-proc-store1');
    await expect(svc.purStep(store, pr.id, 'receive', { qty: [10] })).rejects.toThrow(/delivery order/);
    const r = await svc.purStep(store, pr.id, 'receive', { qty: [10], ref: 'DO-1', proof: [doc('DO')], condition: [{ damaged: 1, wrong: 1, note: 'cracked lens; wrong colour' }] });
    expect(r.grn?.doNo).toBe('DO-1');
    expect((await svc.store.get('stockItems', ITEM))?.onHand).toBe(2 + 8);
    // A second purchase of the same item shows what was paid last time.
    const next = await svc.raisePurRequest(proc, 'co-sasa', { title: 'More torches', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: ITEM, qty: 5, unitPrice: 31 }] });
    const board = await svc.purBoard(proc);
    expect(board.requests.find((x) => x.req.id === next.id)?.lastPaid[0]).toMatchObject({ unitPrice: 30, ref: pr.ref, on: TODAY });
    // The seeded test data already has orders with this supplier; this order adds one on time, with 1 damaged and 1 wrong.
    expect(board.suppliers.find((s) => s.supplier.id === 'sup-co-sasa-2')?.record).toMatchObject({ onTime: 1, late: 0, damaged: 1, wrong: 1 });
  });

  it('times quoting and ordering on the Work KPIs, never the COO or CEO approval', async () => {
    const { svc, ds } = setup();
    await ordered(svc, '2026-11-30');
    const scope: WorkKpiScope = { depts: ['procurement'], companyIds: null, label: 'Procurement' };
    const dept = buildWorkKpi({ purRequests: ds.purRequests }, scope, '2026-11').departments[0];
    const stages = dept.work.filter((w) => w.workflow === 'purchase').map((w) => w.stage);
    expect(stages).toEqual(expect.arrayContaining(['quote', 'order']));
    expect(dept.notTimed.join(' ')).toMatch(/COO and CEO approvals of purchases/);
  });
});
