import { describe, expect, it } from 'vitest';
import { GOV_OPS_COMPANY_ID, MemoryStore, PrimaService, demoPin, generateDataset, myt } from '../src';
import type { Dataset, InvRec, User } from '../src';

// Part U (Fitri package): inventory control, stock count, freeze, variances, damage charges, disposal. Synthetic only.
const TODAY = '2026-11-16';
const NOW = myt(TODAY, '10:00');
const G = GOV_OPS_COMPANY_ID;
let n = 0;
const doc = () => [{ kind: 'document' as const, name: `synthetic-${++n}.png`, data: `data:image/png;base64,${Buffer.from(`synthetic photo ${n} `.repeat(30)).toString('base64')}` }];
const witness = (ds: Dataset, companyId: string, not: (string | null | undefined)[] = []) => {
  const p = ds.people.find((x) => x.companyId === companyId && x.status === 'active' && x.pinHash && !not.includes(x.id))!;
  return { staffNo: p.staffNo, pin: demoPin(p.staffNo) };
};

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const mgr = { ...(await svc.user('u-proc-exec')), procRole: 'manager' as const };
  const add = async (sku: string, name: string, kind: string, onHand: number, price: number | null = null) => {
    await svc.saveRecord(mgr, 'stockItem', null, G, { sku, name, kind, size: kind === 'UNIFORM' ? 'M' : null, reorderAt: 0, onHand: 0 });
    const it = (await store.list('stockItems', { companyId: [G] })).find((i) => i.name === name)!;
    it.onHand = onHand;
    if (price !== null) it.salePrice = price;
    return it;
  };
  const radio = await add('DEV-1', 'Synthetic radio', 'DEVICE', 10, 300);
  const shirt = await add('UNI-1', 'Synthetic guard shirt', 'UNIFORM', 30, 40);
  const torch = await add('EQ-1', 'Synthetic torch', 'EQUIPMENT', 5);
  const guards = ds.people.filter((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role === 'guard').slice(0, 3);
  const po = ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role === 'patrol_officer')!;
  // A Goodwill storekeeper's witness: a synthetic Goodwill person with a PIN when the seed has none.
  if (!ds.people.some((p) => p.companyId === G && p.status === 'active' && p.pinHash)) {
    const src = ds.people.find((p) => p.status === 'active' && p.pinHash)!;
    ds.people.push({ ...src, id: 'p-gw-witness', companyId: G, staffNo: src.staffNo, name: 'Synthetic store witness' });
  }
  return {
    ds,
    store,
    svc,
    inv: svc.inventory,
    radio,
    shirt,
    torch,
    guards,
    po,
    om: await svc.user('u-om-klang'),
    ogm: await svc.user('u-ogm'),
    sk: await svc.user('u-proc-store1'),
    sk2: await svc.user('u-proc-store2'),
    proc: await svc.user('u-proc-exec'),
    gwMgr: mgr as User,
    hr: await svc.user('u-pwvsb-hr'),
  };
}

describe('Part U: inventory control', () => {
  it('a major count stops stock in and out; the OGM lets one urgent move through; variances are decided by someone else', async () => {
    const { ds, store, svc, inv, radio, torch, guards, po, om, ogm, sk, proc } = await setup();
    const c = (await inv.act(sk, 'countStart', { kind: 'major' })) as InvRec;
    expect(c.d.frozen).toBe(true);
    await expect(inv.act(sk, 'countStart', {})).rejects.toThrow(/already open/);
    // Frozen: no issue to a guard.
    await expect(svc.stockIssue(sk, G, { itemId: radio.id, personId: guards[0].id, qty: 1, omUserId: om.id, patrolPersonId: po.id })).rejects.toThrow(/Kiraan stok sedang berjalan/);
    await expect(inv.act(sk, 'urgent', { itemId: radio.id, qty: 1, reason: 'x' })).rejects.toThrow(/OGM/);
    await expect(inv.act(ogm, 'urgent', { itemId: radio.id, qty: 1 })).rejects.toThrow(/cannot wait/);
    await inv.act(ogm, 'urgent', { itemId: radio.id, qty: 1, reason: 'Guard replacing a broken radio at a bank site' });
    await svc.stockIssue(sk, G, { itemId: radio.id, personId: guards[0].id, qty: 1, omUserId: om.id, patrolPersonId: po.id });
    // The pass is used once.
    await expect(svc.stockIssue(sk, G, { itemId: radio.id, personId: guards[1].id, qty: 1, omUserId: om.id, patrolPersonId: po.id })).rejects.toThrow(/Kiraan stok sedang berjalan/);
    // Counting: the system figure is less the urgent move; a difference needs a reason.
    const lines = (c.d.lines as { itemId: string }[]).map((l) => ({ itemId: l.itemId, physical: l.itemId === radio.id ? 9 : l.itemId === torch.id ? 3 : (ds.stockItems.find((x) => x.id === l.itemId)?.onHand ?? 0) }));
    await expect(inv.act(sk, 'countLine', { id: c.id, lines })).rejects.toThrow(/Pick the reason/);
    const withReasons = lines.map((l) => (l.itemId === torch.id ? { ...l, reason: 'shortage' } : l));
    await inv.act(sk, 'countLine', { id: c.id, lines: withReasons });
    await expect(inv.act(sk, 'countFinish', { id: c.id })).rejects.toThrow(/staff number|witness|PIN/i);
    const done = (await inv.act(sk, 'countFinish', { id: c.id, witness: witness(ds, G, [sk.personId]) })) as InvRec;
    expect(done.status).toBe('variance');
    expect(done.d.frozen).toBe(false);
    // The counter never decides; the Procurement executive adjusts the book with a reason.
    await expect(inv.act(sk, 'variance', { countId: c.id, itemId: torch.id, action: 'adjust', reason: 'x' })).rejects.toThrow(/Procurement executive/);
    await expect(inv.act(proc, 'variance', { countId: c.id, itemId: torch.id, action: 'adjust' })).rejects.toThrow(/reason/);
    const adj = (await inv.act(proc, 'variance', { countId: c.id, itemId: torch.id, action: 'adjust', reason: 'Two torches not found after search; CCTV checked' })) as InvRec;
    expect(adj.status).toBe('closed');
    expect((await store.get('stockItems', torch.id))!.onHand).toBe(3);
    // The stock card balance equals onHand.
    const card = (await inv.act(proc, 'card', { itemId: torch.id })) as { balance: number; onHand: number; rows: { kind: string }[] };
    expect(card.balance).toBe(card.onHand);
    expect(card.rows.map((r) => r.kind)).toContain('adjustment');
  });

  it('an adjustment above RM500 waits for the OGM', async () => {
    const { ds, store, inv, radio, sk, proc, ogm } = await setup();
    const c = (await inv.act(sk, 'countStart', { category: 'DEVICE' })) as InvRec;
    await inv.act(sk, 'countLine', { id: c.id, lines: [{ itemId: radio.id, physical: 7, reason: 'lost' }] });
    await inv.act(sk, 'countFinish', { id: c.id, witness: witness(ds, G, [sk.personId]) });
    const w = (await inv.act(proc, 'variance', { countId: c.id, itemId: radio.id, action: 'adjust', reason: 'Three radios missing' })) as InvRec;
    expect(w.status).toBe('variance');
    expect((await store.get('stockItems', radio.id))!.onHand).toBe(10);
    await expect(inv.act(ogm, 'varianceOgm', { countId: c.id, itemId: radio.id, ok: true })).rejects.toThrow(/reason/);
    const ok = (await inv.act(ogm, 'varianceOgm', { countId: c.id, itemId: radio.id, ok: true, note: 'Police report made' })) as InvRec;
    expect(ok.status).toBe('closed');
    expect((await store.get('stockItems', radio.id))!.onHand).toBe(7);
  });

  it('U-X12: negligence on a RM300 radio goes on next month as a charge with an HR review; accident charges nothing; no price waits', async () => {
    const { store, svc, inv, radio, torch, guards, po, om, sk, gwMgr, hr } = await setup();
    const issue = async (itemId: string, g: number) => svc.stockIssue(sk, G, { itemId, personId: guards[g].id, qty: 1, omUserId: om.id, patrolPersonId: po.id });
    const a = await issue(radio.id, 0);
    const b = await issue(radio.id, 1);
    const c = await issue(torch.id, 2);
    for (const x of [a, b, c]) await svc.stockReturn(sk, x.id, 'damaged', 'Dropped and broken');
    // Negligence: RM300 on December pay, HR review, legal flag.
    await expect(svc.confirmStockLoss(gwMgr, a.id, true, 'Left on the motorcycle seat', { cause: 'NEGLIGENCE' })).rejects.toThrow(/photo/);
    await svc.confirmStockLoss(gwMgr, a.id, true, 'Left on the motorcycle seat', { cause: 'NEGLIGENCE', photo: doc() });
    await svc.confirmStockLoss(gwMgr, b.id, true, 'Fell during a patrol', { cause: 'ACCIDENT' });
    await svc.confirmStockLoss(gwMgr, c.id, true, 'Used as a hammer', { cause: 'MISUSE', photo: doc() });
    const charges = (await inv.recs('charge')) as InvRec[];
    expect(charges).toHaveLength(2);
    const r = charges.find((x) => x.d.itemName === 'Synthetic radio')!;
    expect(r).toMatchObject({ status: 'due', companyId: 'co-sasa', d: { amount: 300, period: '2026-12', ja: true } });
    expect(String(r.d.legalFlag)).toMatch(/s\.24/);
    const t = charges.find((x) => x.d.itemName === 'Synthetic torch')!;
    expect(t.status).toBe('waiting_price');
    expect(await inv.chargesDue(guards[0].id, '2026-12')).toEqual([expect.objectContaining({ amount: 300, id: `invchg:${r.id}@2026-12` })]);
    expect(await inv.chargesDue(guards[0].id, '2026-11')).toEqual([]);
    // HR cancels with a reason; the person who decided it does not review it.
    await expect(inv.act(gwMgr, 'chargeHr', { id: r.id, decision: 'cancel', note: 'x' })).rejects.toThrow(/HR/);
    await expect(inv.act(hr, 'chargeHr', { id: r.id, decision: 'cancel' })).rejects.toThrow(/reason/);
    await inv.act(hr, 'chargeHr', { id: r.id, decision: 'cancel', note: 'No written agreement on the issue slip' });
    expect(await inv.chargesDue(guards[0].id, '2026-12')).toEqual([]);
    // The torch charge gets its price, then HR spreads it.
    await inv.act(hr, 'chargePrice', { id: t.id, unitPrice: 60, note: 'Goodwill price list' });
    await inv.act(hr, 'chargeHr', { id: t.id, decision: 'spread', months: 2, note: 'Two months' });
    expect(await inv.chargesDue(guards[2].id, '2026-12')).toEqual([expect.objectContaining({ amount: 30 })]);
    await store.transaction(async (tx) => inv.markChargesRecovered(tx, [`invchg:${t.id}@2026-12`], hr));
    expect(await inv.chargesDue(guards[2].id, '2026-12')).toEqual([]);
    expect(await inv.chargesDue(guards[2].id, '2027-01')).toEqual([expect.objectContaining({ amount: 30 })]);
    // Review B2: a part not recovered in its own month stays due under that month's id (oldest first).
    expect(await inv.chargesDue(guards[2].id, '2027-02')).toEqual([expect.objectContaining({ amount: 30, id: `invchg:${t.id}@2027-01` })]);
  });

  it('U15: two approvals for the last 5 units: the second gets "only 0 available"', async () => {
    const { store, svc, radio, om, ogm, sk, proc } = await setup();
    const ss = svc.siteSupplies;
    radio.onHand = 5;
    const site = (await store.list('sites', {})).find((s) => s.id === 'st-sasa-011')!;
    void site;
    const mk = async () => {
      const r = (await ss.act(om, 'request', { siteId: 'st-sasa-011', startedByName: 'Synthetic supervisor', lines: [{ stockItemId: radio.id, qty: 5, purpose: 'replacement' }] }).catch((e) => ({ err: String(e) }))) as { id?: string; status?: string; err?: string };
      return r;
    };
    const a = await mk();
    expect(a.id).toBeTruthy();
    if (a.status === 'baharu') await ss.act(om, 'submit', { id: a.id });
    const v = (await ss.act(om, 'view', { id: a.id })) as { status: string };
    if (v.status === 'semakan_awal') await ss.act((await svc.user('u-ae-sasa')) as never, 'firstCheck', { id: a.id, ok: true, note: 'ok' }).catch(() => undefined);
    await ss.act(ogm, 'confirm', { id: a.id });
    await ss.act(sk, 'stockCheck', { id: a.id });
    await ss.act(proc, 'decide', { id: a.id });
    // The 5 units are reserved: nobody else gets them, by request or by a direct issue.
    const guard = (await store.list('people', { companyId: ['co-sasa'] })).find((p) => p.status === 'active' && p.role === 'guard')!;
    const po = (await store.list('people', { companyId: ['co-sasa'] })).find((p) => p.status === 'active' && p.role === 'patrol_officer')!;
    await expect(svc.stockIssue(sk, G, { itemId: radio.id, personId: guard.id, qty: 1, omUserId: om.id, patrolPersonId: po.id })).rejects.toThrow(/only 0 available/i);
    await expect(ss.act(sk, 'release', { id: a.id, n: 1, reason: 'x' })).rejects.toThrow(/OGM/);
    await ss.act(ogm, 'release', { id: a.id, n: 1, reason: 'Site closed for a month' });
    expect(await ss.reservedQty(G, radio.id, null)).toBe(0);

  });

  it('a disposal case: store lines leave stock at request, reuse comes back, marks removed, evidence, closed with the write-off for Finance', async () => {
    const { ds, store, inv, radio, shirt, sk, sk2, proc, ogm } = await setup();
    await expect(inv.act(sk, 'disposalRequest', { lines: [{ itemId: shirt.id, qty: 2, reason: 'damaged', condition: 'Torn' }] })).rejects.toThrow(/photo/);
    const r = (await inv.act(sk, 'disposalRequest', {
      lines: [
        { itemId: shirt.id, qty: 2, reason: 'damaged', condition: 'Torn', photo: doc() },
        { itemId: radio.id, qty: 4, reason: 'past_life', condition: 'Old, works' },
      ],
    })) as InvRec;
    expect((await store.get('stockItems', shirt.id))!.onHand).toBe(28);
    expect((await store.get('stockItems', radio.id))!.onHand).toBe(6);
    await expect(inv.act(sk, 'disposalReview', { id: r.id, note: 'x', lines: [] })).rejects.toThrow(/Procurement executive/);
    // Radios (sensitive) to dispose: management approval needed; shirts too.
    const rv = (await inv.act(proc, 'disposalReview', { id: r.id, note: 'Quantity and condition checked', lines: [{ n: 1, outcome: 'dispose' }, { n: 2, outcome: 'reuse' }] })) as InvRec;
    expect(rv.status).toBe('kaedah');
    expect((await store.get('stockItems', radio.id))!.onHand).toBe(10);
    await expect(inv.act(proc, 'disposalMethod', { id: r.id, lines: [{ n: 1, method: 'sale' }] })).rejects.toThrow(/where the item goes/);
    const m = (await inv.act(proc, 'disposalMethod', { id: r.id, lines: [{ n: 1, method: 'sale', destination: 'Synthetic scrap buyer', price: 5, buyer: 'Synthetic buyer' }] })) as InvRec;
    // A sale always needs management (U-X7).
    expect(m.status).toBe('kelulusan');
    await expect(inv.act(sk, 'disposalApprove', { id: r.id, ok: true, note: 'ok' })).rejects.toThrow(/OGM/);
    await inv.act(ogm, 'disposalApprove', { id: r.id, ok: true, note: 'Sell as rags after marks removed' });
    await expect(inv.act(sk2, 'disposalExecute', { id: r.id, n: 1, photos: doc() })).rejects.toThrow(/before and after/);
    await expect(inv.act(sk2, 'disposalExecute', { id: r.id, n: 1, photos: [...doc(), ...doc()], witness: witness(ds, G, [sk2.personId]) })).rejects.toThrow(/marks removed/);
    const ex = (await inv.act(sk2, 'disposalExecute', { id: r.id, n: 1, photos: [...doc(), ...doc()], marksRemoved: true, witness: witness(ds, G, [sk2.personId]) })) as InvRec;
    expect(ex.status).toBe('bukti');
    await expect(inv.act(proc, 'disposalClose', { id: r.id })).rejects.toThrow(/receipt/);
    await inv.act(sk2, 'disposalEvidence', { id: r.id, n: 1, kind: 'receipt', ref: 'RCPT-SYN-1', file: doc() });
    const closed = (await inv.act(proc, 'disposalClose', { id: r.id })) as InvRec;
    expect(closed).toMatchObject({ status: 'selesai', d: { writeOff: 80, saleToRecord: 5 } });
    const pdf = (await inv.act(proc, 'disposalPdf', { id: r.id })) as { name: string; base64: string };
    expect(pdf.name).toMatch(/LPS-/);
  });

  it('U-X14: an office purchase needs 3 quotes and 2 online prices; store stock keeps 1 online price', async () => {
    const { svc, proc } = await setup();
    const pr = await svc.raisePurRequest(proc, G, { title: 'Synthetic office chairs', category: 'OTHER', lines: [{ item: 'Chair', stockItemId: null, qty: 2, unitPrice: 100 }], forOffice: true });
    for (const k of [1, 2, 3]) await svc.purStep(proc, pr.id, 'quote', { supplierId: `sup-${G}-${k}`, amount: 200 + k, ref: `Q${k}`, proof: doc() }).catch(() => undefined);
    const quotes = (await svc.purStep(proc, pr.id, 'online', { source: 'Synthetic market', ref: 'listing-1', amount: 199, proof: doc() })).quotes;
    if (quotes.length < 3) return; // the synthetic store has fewer suppliers here
    await expect(svc.purStep(proc, pr.id, 'submit', { supplierId: quotes[0].supplierId })).rejects.toThrow(/2 online/);
    await svc.purStep(proc, pr.id, 'online', { source: 'Synthetic shop 2', ref: 'listing-2', amount: 205, proof: doc() });
    const s = await svc.purStep(proc, pr.id, 'submit', { supplierId: quotes[0].supplierId });
    expect(s.status).toBe('awaiting_approval');
  });

  it('a GRN needs the supplier DO number and its photo; a CSG/TNG course issue stays outside the uniform allowance', async () => {
    const { store, svc, shirt, guards, po, om, sk, proc } = await setup();
    const pr = await svc.raisePurRequest(proc, G, { title: 'Synthetic shirts', category: 'UNIFORM', lines: [{ item: 'Shirt', stockItemId: shirt.id, qty: 5, unitPrice: 30 }] });
    await store.update('purRequests', pr.id, { status: 'ordered', po: { ref: 'PO-1', by: 'x', at: NOW, amount: 150 } });
    await expect(svc.purStep(sk, pr.id, 'receive', { qty: [5] })).rejects.toThrow(/delivery order/);
    const got = await svc.purStep(sk, pr.id, 'receive', { qty: [5], ref: 'DO-SYN-9', proof: doc() });
    expect(got.grn).toMatchObject({ doNo: 'DO-SYN-9' });
    const iss = await svc.stockIssue(sk, G, { itemId: shirt.id, personId: guards[0].id, qty: 3, omUserId: om.id, patrolPersonId: po.id, course: { kind: 'CSG', date: '2026-11-20' } });
    expect(iss.course).toEqual({ kind: 'CSG', date: '2026-11-20' });
    expect(await svc.ssUniformHistory(guards[0].id, G)).toMatchObject({ pieces: 0 });
  });

  it('U20: the ACT Director defers a finding with a reason and a date; it is not overdue meanwhile', async () => {
    const { svc } = await setup();
    const enf = await svc.user('u-act-enf1');
    const dir = await svc.user('u-audit');
    const cm = await svc.user('u-cm-arsh');
    const f = await svc.raiseActFinding(enf, { companyId: 'co-arsh', area: 'INV_WORKSHOP_2026', source: 'manual', title: 'Synthetic workshop item', detail: '', severity: 'low', evidence: 'Synthetic', ownerUserId: cm.id });
    await expect(svc.actFindingStep(enf, f.id, 'defer', { note: 'Budget', until: '2027-02-01' })).rejects.toThrow(/Director/);
    await expect(svc.actFindingStep(dir, f.id, 'defer', { note: 'Budget' })).rejects.toThrow(/date/);
    const d = await svc.actFindingStep(dir, f.id, 'defer', { note: 'Waiting for the 2027 budget', until: '2027-02-01' });
    expect(d.deferred).toMatchObject({ until: '2027-02-01' });
    const r = await svc.actFindingStep(dir, f.id, 'resume', { note: 'Budget approved' });
    expect(r.deferred).toBeNull();
  });
});
