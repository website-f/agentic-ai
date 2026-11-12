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

  it('follows the uniform allowance: 3 free in 12 months, 4th and 5th only when the guard pays, 6th refused', async () => {
    const { svc, shirt, guard, po, om, sk } = await setup();
    const issue = async (qty: number, guardPays?: { receiptNo: string; amount: number }) => {
      const r = await svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty, reason: 'Replacement', guardPays });
      await svc.decideUniformRequest(sk, r.id, { action: 'issue', patrolPersonId: po.id });
      return r;
    };
    await issue(3);
    await expect(svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'Torn' })).rejects.toThrow(/only when the guard pays/);
    const paid = await issue(2, { receiptNo: 'R-001', amount: 80 });
    expect(paid).toMatchObject({ history: { pieces: 3, last: TODAY }, early: true, guardPays: { receiptNo: 'R-001', amount: 80 } });
    await expect(
      svc.requestUniform(om, { staffNo: guard.staffNo, stockItemId: shirt.id, qty: 1, reason: 'Torn', guardPays: { receiptNo: 'R-2', amount: 40 } }),
    ).rejects.toThrow(/the 6th is refused/);
  });
});
