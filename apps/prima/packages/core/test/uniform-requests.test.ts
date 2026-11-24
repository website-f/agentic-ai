import { describe, expect, it } from 'vitest';
import { GOV_OPS_COMPANY_ID, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Uniform requests from Operations Managers (Fauzan, 11 Nov 2026). Synthetic data only.
const TODAY = '2026-11-11';
const NOW = myt(TODAY, '10:00');
const G = GOV_OPS_COMPANY_ID;

const sig = (n: number) => `data:image/png;base64,${Buffer.from(`synthetic signature ${n} `.repeat(40)).toString('base64')}`;

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const mgr = { ...(await svc.user('u-proc-exec')), procRole: 'manager' as const };
  await svc.saveRecord(mgr, 'stockItem', null, G, { sku: 'UNI-M', name: 'Synthetic shirt', kind: 'UNIFORM', size: 'M', reorderAt: 1, onHand: 0, charge: 'sale', salePrice: 40 });
  await svc.saveRecord(mgr, 'stockItem', null, G, { sku: 'RAD-1', name: 'Synthetic radio', kind: 'DEVICE', reorderAt: 1, onHand: 0 });
  const items = await store.list('stockItems', { companyId: [G] });
  const shirt = items.find((i) => i.name === 'Synthetic shirt')!;
  const radio = items.find((i) => i.name === 'Synthetic radio')!;
  shirt.onHand = 20;
  radio.onHand = 5;
  const guard = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active' && p.role === 'guard')!;
  const po = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active' && p.role === 'patrol_officer')!;
  return {
    ds,
    store,
    svc,
    shirt,
    radio,
    guard,
    po,
    om: await svc.user('u-om-klang'),
    sk: await svc.user('u-proc-store1'),
    ogm: await svc.user('u-ogm'),
  };
}

describe('Uniform requests: the OM asks, the store issues, the OM collects the signatures', () => {
  it('runs from the OM button to the guard signing on the OM phone', async () => {
    const { svc, store, shirt, guard, po, om, sk } = await setup();
    expect((await svc.myItems(om)).canRequestUniform).toBe(true);
    expect((await svc.myItems(sk)).canRequestUniform).toBe(false);
    const r = await svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 2, reason: 'Worn out' });
    expect(r).toMatchObject({ status: 'open', billTo: 'co-arsh', requestedById: om.id, history: { pieces: 0, last: null }, early: false, guardPays: null });
    // The store sees it on its queue and home page.
    const q = await svc.uniformRequests(sk);
    expect(q.canDecide).toBe(true);
    expect(q.requests.map((x) => x.id)).toEqual([r.id]);
    // Issuing to a guard needs the patrolling officer who hands it over.
    await expect(svc.decideUniformRequest(sk, r.id, { action: 'issue' })).rejects.toThrow(/patrolling officer/);
    const done = await svc.decideUniformRequest(sk, r.id, { action: 'issue', patrolPersonId: po.id });
    expect(done.status).toBe('issued');
    const issue = (await store.get('stockIssues', done.decided!.issueId!))!;
    expect(issue.handover).toMatchObject({ omUserId: om.id, om: null, patrol: { personId: po.id } });
    expect((await store.get('stockItems', shirt.id))!.onHand).toBe(18);
    // The OM receives it, then the patrolling officer and the guard sign on the OM's phone.
    expect((await svc.myItems(om)).toPassOn.map((x) => x.issue.id)).toEqual([issue.id]);
    await svc.handoverStep(om, issue.id, 'om', { received: true });
    await svc.handoverStep(om, issue.id, 'patrol', { received: true, signature: sig(1) });
    await svc.handoverStep(om, issue.id, 'guard', { received: true, signature: sig(2) });
    expect((await store.get('stockIssues', issue.id))!.acknowledged).toBe(true);
    await expect(svc.decideUniformRequest(sk, r.id, { action: 'issue', patrolPersonId: po.id })).rejects.toThrow(/already issued/);
  });

  it('keeps who may ask, decide and cancel to their own roles', async () => {
    const { svc, shirt, radio, guard, om, sk, ogm } = await setup();
    await expect(svc.requestUniform(sk, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'x' })).rejects.toThrow(/Operations Manager asks/);
    await expect(svc.requestUniform(ogm, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'x' })).rejects.toThrow(/Operations Manager asks/);
    await expect(svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: radio.id, qty: 1, reason: 'x' })).rejects.toThrow(/uniform from the Goodwill store/);
    await expect(svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: '' })).rejects.toThrow(/Say why/);
    await expect(svc.requestUniform(om, { staffNo: 'NO-SUCH', stockItemId: shirt.id, qty: 1, reason: 'x' })).rejects.toThrow(/No active guard/);
    await expect(svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 4, reason: 'x' })).rejects.toThrow(/Pieces: 1 to 3/);
    const r = await svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'New guard' });
    await expect(svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'again' })).rejects.toThrow(/already has an open request/);
    // The OGM watches every request; only the store decides; only the OM who asked cancels.
    const seen = await svc.uniformRequests(ogm);
    expect(seen.canDecide).toBe(false);
    expect(seen.requests.map((x) => x.id)).toEqual([r.id]);
    await expect(svc.decideUniformRequest(ogm, r.id, { action: 'issue' })).rejects.toThrow(/Goodwill store decides/);
    await expect(svc.decideUniformRequest(om, r.id, { action: 'refuse', note: 'no' })).rejects.toThrow(/Goodwill store decides/);
    await expect(svc.decideUniformRequest(sk, r.id, { action: 'cancel' })).rejects.toThrow(/only the person who asked/);
    await expect(svc.decideUniformRequest(sk, r.id, { action: 'refuse' })).rejects.toThrow(/Say why/);
    const refused = await svc.decideUniformRequest(sk, r.id, { action: 'refuse', note: 'Size M out until next week' });
    expect(refused.status).toBe('refused');
    const again = await svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'Ask again' });
    expect((await svc.decideUniformRequest(om, again.id, { action: 'cancel' })).status).toBe('cancelled');
  });

  it('follows the uniform allowance: 3 free in 12 months, every piece after that only when the guard pays, no upper limit', async () => {
    const { svc, shirt, guard, po, om, sk } = await setup();
    const issue = async (qty: number, guardPays?: { receiptNo: string; amount: number }) => {
      const r = await svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty, reason: 'Replacement', guardPays });
      await svc.decideUniformRequest(sk, r.id, { action: 'issue', patrolPersonId: po.id });
      return r;
    };
    await issue(3);
    await expect(svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'Torn' })).rejects.toThrow(/paid by the guard/);
    const paid = await issue(2, { receiptNo: 'R-001', amount: 80 });
    expect(paid).toMatchObject({ history: { pieces: 3, last: TODAY }, early: true, guardPays: { receiptNo: 'R-001', amount: 80 } });
    // Fauzan, 13 Nov 2026: the 6th piece is allowed when the guard pays.
    const sixth = await issue(1, { receiptNo: 'R-2', amount: 40 });
    expect(sixth.guardPays).toMatchObject({ receiptNo: 'R-2' });
    await expect(svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'Torn' })).rejects.toThrow(/paid by the guard/);
  });
});

describe('Uniform allowance counts both stores (Goodwill study gap 7, 23 Nov 2026)', () => {
  it('a suit in the item register is one of each worn item in the Goodwill count', async () => {
    const { svc, store, shirt, guard, om } = await setup();
    const before = await svc.ssUniformHistory(guard.id, GOV_OPS_COMPANY_ID, 'synthetic shirt');
    await store.insert('uniformRecords', {
      id: 'ur-synthetic-1', kind: 'past', personId: guard.id, companyId: guard.companyId, on: '2026-11-01', pieces: 2, itemId: null,
      receiptRef: null, amount: null, batchId: null, scope: 'person', reason: 'Synthetic past suits', by: 'Test', byId: 'u-test', at: NOW, partyIds: [guard.companyId],
    } as never);
    const after = await svc.ssUniformHistory(guard.id, GOV_OPS_COMPANY_ID, 'synthetic shirt');
    expect(after.fromRegister).toBe(before.fromRegister + 2);
    expect(after.pieces).toBe(before.pieces + 2);
    expect(after.last).toBe('2026-11-01');
    // The OM's request now sees the two suits: a third shirt is the last free one, a fourth needs the guard to pay.
    const r = await svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'Worn out, within 6 months', early: 'Torn on duty' } as never);
    expect(r.history.pieces).toBe(after.pieces);
  });
});

describe('Goodwill prices: the Inventory Manager sets them, the Finance Director may too (Fauzan, 23 Nov 2026)', () => {
  it('lets the FD set a price with a reason and refuses store staff', async () => {
    const { svc, store, ds, shirt, sk } = await setup();
    const fdUser = ds.users.find((u) => u.leadership === 'finance_director')!;
    const fd = await svc.user(fdUser.id);
    expect((await svc.purBoard(fd)).canSetGoodwillPrices).toBe(true);
    await expect(svc.setGoodwillPrice(fd, shirt.id, { rentalMonthly: 5, reason: '' })).rejects.toThrow(/reason/);
    const done = await svc.setGoodwillPrice(fd, shirt.id, { charge: 'rental', rentalMonthly: 5, salePrice: '', reason: 'Synthetic rate from the FD' });
    expect(done).toMatchObject({ charge: 'rental', rentalMonthly: 5, salePrice: null, priceSet: { by: fd.name, reason: 'Synthetic rate from the FD' } });
    expect((await store.get('stockItems', shirt.id))!.rentalMonthly).toBe(5);
    await expect(svc.setGoodwillPrice(sk, shirt.id, { rentalMonthly: 1, reason: 'Not mine to set' })).rejects.toThrow();
  });

  it('keeps cost and stock value, and holds a sale at or below cost for the Finance Director', async () => {
    const { svc, store, ds, shirt } = await setup();
    const im = { ...(await svc.user('u-proc-exec')), procRole: 'manager' as const };
    const fd = await svc.user(ds.users.find((u) => u.leadership === 'finance_director')!.id);
    // Opening stock cost entered with a reason; the shirt sells at RM40 (set in setup), so profit.
    await svc.setGoodwillPrice(im, shirt.id, { charge: 'sale', salePrice: 40, unitCost: 30, reason: 'Synthetic opening cost' });
    let board = await svc.purBoard(fd);
    expect(board.goodwillStockValue.value).toBeGreaterThanOrEqual(20 * 30);
    // The Inventory Manager lowers the sale to RM28, under the RM30 cost: it waits, RM40 stays.
    const held = await svc.setGoodwillPrice(im, shirt.id, { charge: 'sale', salePrice: 28, reason: 'Clearance' });
    expect(held).toMatchObject({ salePrice: 40, pendingSale: { salePrice: 28, unitCost: 30 } });
    board = await svc.purBoard(fd);
    expect(board.canApproveBelowCost).toBe(true);
    expect(board.goodwillStockValue.waiting).toBe(1);
    // Only the FD (or the CEO) decides, with a reason.
    await expect(svc.decideGoodwillSale(im, shirt.id, { approve: true, reason: 'Mine' })).rejects.toThrow();
    await expect(svc.decideGoodwillSale(fd, shirt.id, { approve: true, reason: '' })).rejects.toThrow(/reason/);
    const ok = await svc.decideGoodwillSale(fd, shirt.id, { approve: true, reason: 'Old stock, clear it' });
    expect(ok).toMatchObject({ salePrice: 28, pendingSale: null, belowCostOk: { salePrice: 28, unitCost: 30, by: fd.name } });
    expect((await store.get('stockItems', shirt.id))!.salePrice).toBe(28);
    // The FD may set a below-cost sale directly; it is recorded as approved.
    const direct = await svc.setGoodwillPrice(fd, shirt.id, { charge: 'sale', salePrice: 25, reason: 'Synthetic FD below cost' });
    expect(direct).toMatchObject({ salePrice: 25, pendingSale: null, belowCostOk: { salePrice: 25, by: fd.name } });
    // A profitable price clears the approval mark.
    const back = await svc.setGoodwillPrice(im, shirt.id, { charge: 'sale', salePrice: 45, reason: 'Back to normal' });
    expect(back).toMatchObject({ salePrice: 45, pendingSale: null, belowCostOk: null });
  });
});
