import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, addDays, generateDataset, myt } from '../src';

// Stress check of the IT pilot (Fauzan, 28 Oct 2026): a busy year of IT work, bad input and double clicks.
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
let n = 0;
const proof = () => [{ kind: 'document' as const, name: `DO ${++n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 do ${n}`).toString('base64')}` }];

describe('IT pilot under load and bad input', () => {
  it('keeps the board, the audit view and HR view quick with a year of work', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const ex = ['u-it-ex1', 'u-it-ex2', 'u-it-ex3', 'u-it-ex4', 'u-it-lead'];
    for (let i = 0; i < 1500; i++) {
      await svc.giveItJob(mgr, { kind: 'task', title: `Load job ${i}`, detail: '', priority: 'P3', technical: i % 5 === 0, assigneeId: ex[i % 5], dueOn: addDays(TODAY, i % 30) });
    }
    const ex2 = await svc.user('u-it-ex2');
    for (let i = 0; i < 1500; i++) {
      await svc.logItTicket(ex2, { raisedFor: `Staff ${i} (mock)`, channel: 'teams', category: 'M365', priority: 'P3', title: `Load request ${i}`, detail: '' });
    }
    for (const id of ['u-it-mgr', 'u-it-ex1', 'u-coo', 'u-fauzan', 'u-audit', 'u-pwvsb-hr']) {
      const t0 = Date.now();
      const b = await svc.itBoard(await svc.user(id));
      const ms = Date.now() - t0;
      expect(b).toBeTruthy();
      expect(ms, `${id} board took ${ms} ms`).toBeLessThan(4000);
    }
  }, 60000);

  it('refuses bad numbers, empty text and oversized text', async () => {
    const { svc } = fresh();
    const ex = await svc.user('u-it-ex2');
    const bad = [NaN, -1, 0, Infinity];
    for (const n of bad) {
      await expect(svc.raiseItPurchase(ex, { ownerId: 'pwvsb', reason: 'Need it', items: [{ kind: 'LAPTOP', description: 'Laptop', qty: n, unitPrice: 100 }] })).rejects.toThrow();
      await expect(svc.raiseItPurchase(ex, { ownerId: 'pwvsb', reason: 'Need it', items: [{ kind: 'LAPTOP', description: 'Laptop', qty: 1, unitPrice: n }] })).rejects.toThrow();
    }
    await expect(svc.raiseItPurchase(ex, { ownerId: 'pwvsb', reason: '   ', items: [{ kind: 'LAPTOP', description: 'Laptop', qty: 1, unitPrice: 100 }] })).rejects.toThrow();
    const long = 'x'.repeat(20000);
    const t = await svc.logItTicket(ex, { raisedFor: long, channel: 'teams', category: 'M365', priority: 'P3', title: long, detail: long });
    expect(t.title.length).toBeLessThanOrEqual(200);
    expect(t.raisedFor!.length).toBeLessThanOrEqual(200);
    expect(t.detail.length).toBeLessThanOrEqual(4000);
  });

  it('a second acceptance is refused and retired payment-first routes cannot create stock', async () => {
    // The screen ignores a click while the first is running; the database holds the record for the second request.
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const j = ds.itJobs.find((x) => x.status === 'submitted' && !x.technical)!;
    await svc.itJobStep(mgr, j.id, 'accept', 'Proof checked');
    await expect(svc.itJobStep(mgr, j.id, 'accept', 'Proof checked')).rejects.toThrow(/not waiting/);
    const ex = await svc.user('u-it-ex2');
    const p = ds.itPurchases.find((x) => x.status === 'finance')!;
    if (!p.finance) await svc.itBuyStep(ex, p.id, 'finance', { ref: 'Teams Approvals: test' });
    const before = ds.itAssets.length;
    await expect(svc.itBuyStep(ex,p.id,'finance',{paidRef:'PV-1',paidOn:TODAY})).rejects.toThrow(/assigned Finance PO/);
    await expect(svc.itBuyStep(ex,p.id,'receive',{ref:'DO-1',proof:proof()})).rejects.toThrow(/purchase packet/);
    expect(ds.itAssets.length).toBe(before);

  });
});
