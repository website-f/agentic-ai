import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, myt, type PhysicalItem } from '../src';

// J2 Equipment warranty claims (Fauzan, 11 Nov 2026). Synthetic data only: the generated mock dataset and one item
// registered here.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');
const STORE = 'u-proc-store1';
const PROC = 'u-proc-exec';

async function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const out = (await svc.items.act(await svc.user(STORE), 'req-wc-1', { kind: 'item.register', skuId: 'sku-shirt-l', partyId: 'goodwill', count: 1 })) as { result: PhysicalItem[] };
  return { ds, store, svc, item: out.result[0] };
}

let n = 0;
const paper = () => ({ kind: 'document' as const, name: `Card ${++n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 warranty ${n}`).toString('base64')}` });

describe('J2 warranty claims', () => {
  it('goes raise, approve with a reason, sent, replaced with the report, and closed by another person', async () => {
    const { svc, item } = await fresh();
    const store1 = await svc.user(STORE);
    const proc = await svc.user(PROC);
    const raise = { itemId: item.id, supplier: 'Uniform Supplier Test Sdn Bhd', fault: 'Zip broke after two washes (test)', faultOn: TODAY, warrantyTo: addDays(TODAY, 100) };
    await expect(svc.warranty.act(store1, 'raise', raise)).rejects.toThrow(/warranty card/);
    await expect(svc.warranty.act(store1, 'raise', { ...raise, warrantyTo: addDays(TODAY, -1), proof: [paper()] })).rejects.toThrow(/warranty ended/);
    const c = await svc.warranty.act(store1, 'raise', { ...raise, proof: [paper()] });
    expect(c.status).toBe('raised');
    await expect(svc.warranty.act(store1, 'raise', { ...raise, proof: [paper()] })).rejects.toThrow(/already open/);
    // The storekeeper who raised it cannot approve; another company's manager cannot either.
    await expect(svc.warranty.act(store1, 'decide', { id: c.id, approve: true, note: 'Mine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.warranty.act(await svc.user('u-cm-sasa'), 'decide', { id: c.id, approve: true, note: 'Fine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.warranty.act(proc, 'decide', { id: c.id, approve: true, note: '' })).rejects.toThrow(/comment/);
    expect((await svc.warranty.homeItems(proc)).some((h) => /approve or close/.test(h.title))).toBe(true);
    await svc.warranty.act(proc, 'decide', { id: c.id, approve: true, note: 'Within warranty, send it' });
    await expect(svc.warranty.act(store1, 'sent', { id: c.id, on: TODAY, supplierRef: 'RMA-1' })).rejects.toThrow(/hand-over/);
    await svc.warranty.act(store1, 'sent', { id: c.id, on: TODAY, supplierRef: 'RMA-TEST-1', proof: [paper()] });
    await expect(svc.warranty.act(store1, 'outcome', { id: c.id, result: 'replaced', on: TODAY, proof: [paper()] })).rejects.toThrow(/serial/);
    const out = await svc.warranty.act(store1, 'outcome', { id: c.id, result: 'replaced', on: TODAY, newSerial: 'NEW-TEST-1', proof: [paper()] });
    expect(out.outcome!.newSerial).toBe('NEW-TEST-1');
    await expect(svc.warranty.act(store1, 'close', { id: c.id, note: 'Done' })).rejects.toBeInstanceOf(AccessDenied);
    const closed = await svc.warranty.act(proc, 'close', { id: c.id, note: 'Replacement received and labelled' });
    expect(closed.status).toBe('closed');
    expect(closed.history.length).toBe(5);
  });

  it('refuses a refused-by-supplier outcome without the reason, and people with no part in the item', async () => {
    const { svc, item } = await fresh();
    const store1 = await svc.user(STORE);
    const proc = await svc.user(PROC);
    await expect(svc.warranty.act(await svc.user('u-pwvsb-hr'), 'raise', { itemId: item.id, supplier: 'X Supplier', fault: 'Broken zip (test)', warrantyTo: addDays(TODAY, 10), proof: [paper()] })).rejects.toBeInstanceOf(AccessDenied);
    const c = await svc.warranty.act(store1, 'raise', { itemId: item.id, supplier: 'X Supplier', fault: 'Broken zip (test)', warrantyTo: addDays(TODAY, 10), proof: [paper()] });
    await svc.warranty.act(proc, 'decide', { id: c.id, approve: true, note: 'Send it' });
    await svc.warranty.act(store1, 'sent', { id: c.id, on: TODAY, supplierRef: 'RMA-2', proof: [paper()] });
    await expect(svc.warranty.act(store1, 'outcome', { id: c.id, result: 'refused_by_supplier', on: TODAY, proof: [paper()] })).rejects.toThrow(/reason/);
    const r = await svc.warranty.act(store1, 'outcome', { id: c.id, result: 'refused_by_supplier', on: TODAY, reason: 'Damage by misuse (test)', proof: [paper()] });
    expect(r.status).toBe('outcome');
    const b = await svc.warranty.board(proc);
    expect(b.ready && b.rows[0].canClose).toBe(true);
  });
});
