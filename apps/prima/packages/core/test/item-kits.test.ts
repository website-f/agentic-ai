import { describe, expect, it } from 'vitest';
import { GOV_OPS_COMPANY_ID, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Sets and parts, and item-needs requests started by the office side (Fauzan, 23 Nov 2026). Synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const G = GOV_OPS_COMPANY_ID;
const GUARD_SITE = 'st-sasa-011';
const SET = `stk-${G}-set-1`;
const TROUSERS = `stk-${G}-uni-3`;

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  return {
    store,
    svc,
    ss: svc.siteSupplies,
    im: await svc.user('u-proc-manager'),
    proc: await svc.user('u-proc-exec'),
    sk: await svc.user('u-proc-store1'),
    sk2: await svc.user('u-proc-store2'),
    om: await svc.user('u-om-klang'),
    ogm: await svc.user('u-ogm'),
    coo: await svc.user('u-coo'),
  };
}
type Line = { n: number; stockItemId: string; itemName: string; qty: number; kitOf: { name: string } | null; issued: { refId: string } | null };
type V = { id: string; status: string; ref: string; startedBy: { role: string; name: string }; receiverId: string; lines: Line[] };

describe('Sets and parts (Inventory Manager)', () => {
  it('lists the uniform set with its parts and how many whole sets the store can make up', async () => {
    const { svc, im } = await setup();
    const k = (await svc.inventoryAct(im, 'kits', { storeId: G })) as { canEdit: boolean; kits: { id: string; parts: { qty: number }[]; setsInStore: number }[] };
    expect(k.canEdit).toBe(true);
    const set = k.kits.find((x) => x.id === SET)!;
    expect(set.parts).toHaveLength(7);
    // Trousers 32: 20 in the synthetic store, shoes size 8: 12, so 12 whole sets.
    expect(set.setsInStore).toBe(12);
  });

  it('the Inventory Manager adds a set and its parts; storekeepers cannot; a set holds no stock and cannot nest', async () => {
    const { svc, store, im, sk } = await setup();
    await svc.saveRecord(im, 'stockItem', null, G, { sku: 'GW-SET-NEW', name: 'Synthetic cleaner kit', kind: 'CLEANING', reorderAt: 0, onHand: 0 });
    const kit = (await store.list('stockItems', { companyId: [G] })).find((x) => x.sku === 'GW-SET-NEW')!;
    await expect(svc.inventoryAct(sk, 'kitAddPart', { kitId: kit.id, name: 'Mop head', sku: 'GW-MOP-1' })).rejects.toThrow(/Inventory Manager/);
    await svc.inventoryAct(im, 'kitAddPart', { kitId: kit.id, name: 'Mop head', sku: 'GW-MOP-1', qty: 2, reorderAt: 5 });
    await expect(svc.inventoryAct(im, 'kitAddPart', { kitId: kit.id, name: 'Mop head again', sku: 'GW-MOP-1' })).rejects.toThrow(/already used/);
    const part = (await store.list('stockItems', { companyId: [G] })).find((x) => x.sku === 'GW-MOP-1')!;
    expect(part).toMatchObject({ onHand: 0, reorderAt: 5, kind: 'CLEANING' });
    expect((await store.get('stockItems', kit.id))!.kitParts).toEqual([{ stockItemId: part.id, qty: 2 }]);
    // Change the parts: always with a reason, never itself, never a set inside a set.
    await expect(svc.inventoryAct(im, 'kitParts', { itemId: kit.id, parts: [{ stockItemId: part.id, qty: 3 }] })).rejects.toThrow(/Say why/);
    await expect(svc.inventoryAct(im, 'kitParts', { itemId: kit.id, reason: 'x', parts: [{ stockItemId: kit.id, qty: 1 }] })).rejects.toThrow(/part of itself/);
    await expect(svc.inventoryAct(im, 'kitParts', { itemId: kit.id, reason: 'x', parts: [{ stockItemId: SET, qty: 1 }] })).rejects.toThrow(/is a set itself/);
    await expect(svc.inventoryAct(im, 'kitParts', { itemId: TROUSERS, reason: 'x', parts: [{ stockItemId: part.id, qty: 1 }] })).rejects.toThrow(/stock of its own/);
    await svc.inventoryAct(im, 'kitParts', { itemId: kit.id, reason: 'Two mop heads were too few', parts: [{ stockItemId: part.id, qty: 3 }] });
    const after = (await store.get('stockItems', kit.id))!;
    expect(after.kitParts).toEqual([{ stockItemId: part.id, qty: 3 }]);
    expect(after.kitHistory!.at(-1)).toMatchObject({ by: im.name, note: 'Two mop heads were too few' });
  });

  it('a set is never issued, bought or asked for as a uniform piece directly; its parts are', async () => {
    const { svc, store, sk, om } = await setup();
    const guard = (await store.list('people', {})).find((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role === 'guard')!;
    await expect(svc.stockIssue(sk, G, { itemId: SET, personId: guard.id, qty: 1 })).rejects.toThrow(/is a set/);
    await expect(svc.requestUniform(om, { staffNo: guard.staffNo!, stockItemId: SET, qty: 1, reason: 'New guard' })).rejects.toThrow(/Ask for the part/);
    const u = (await svc.uniformRequests(om)) as { uniforms: { id: string }[] };
    expect(u.uniforms.some((x) => x.id === SET)).toBe(false);
    expect(u.uniforms.some((x) => x.id === TROUSERS)).toBe(true);
  });

  it('asking for a set gives one line per part; a guard who needs only trousers is asked for that part alone', async () => {
    const { ss, om } = await setup();
    await ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const opt = (await ss.act(om, 'options', { siteId: GUARD_SITE })) as { items: { id: string; kit: unknown[] | null; partOf: string[] }[] };
    expect(opt.items.find((x) => x.id === SET)!.kit).toHaveLength(7);
    expect(opt.items.find((x) => x.id === TROUSERS)!.partOf).toEqual(['Full uniform suit, guard (shoes to cap; M / 32 / 8)']);
    const r = (await ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'Synthetic patrol officer', lines: [{ stockItemId: SET, qty: 2, purpose: 'Two new posts' }] })) as V;
    expect(r.lines).toHaveLength(7);
    expect(r.lines.find((l) => l.itemName === 'Badge')).toMatchObject({ qty: 4, kitOf: { name: 'Full uniform suit, guard (shoes to cap; M / 32 / 8)' } });
    // The same part asked again while the set is open is the duplicate.
    await expect(ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'x', lines: [{ stockItemId: TROUSERS, qty: 1 }] })).rejects.toThrow(/already on open request/);
    await ss.act(om, 'cancel', { id: r.id, note: 'Asked by mistake' });
    const t = (await ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'x', lines: [{ stockItemId: TROUSERS, qty: 1, purpose: 'Torn trousers' }] })) as V;
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ stockItemId: TROUSERS, qty: 1, kitOf: null });
  });
});

describe('Item-needs request started by the Inventory Manager, the OGM or Operations', () => {
  it('the Inventory Manager asks for a new site; the goods go to the OM covering the site, who counts them', async () => {
    const { svc, store, ss, im, om, ogm, sk, sk2, proc } = await setup();
    await ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const opt = (await ss.act(im, 'options', { siteId: GUARD_SITE })) as { asOffice: boolean; receivers: { id: string }[] };
    expect(opt.asOffice).toBe(true);
    expect(opt.receivers.map((x) => x.id)).toContain(om.id);
    await expect(ss.act(im, 'request', { siteId: GUARD_SITE, lines: [{ stockItemId: SET, qty: 1 }] })).rejects.toThrow(/Choose the OM/);
    await expect(ss.act(im, 'request', { siteId: GUARD_SITE, receiverUserId: sk.id, lines: [{ stockItemId: SET, qty: 1 }] })).rejects.toThrow(/Choose the OM/);
    // A storekeeper does not start requests.
    await expect(ss.act(sk, 'request', { siteId: GUARD_SITE, receiverUserId: om.id, lines: [{ stockItemId: SET, qty: 1 }] })).rejects.toThrow(/asks for supplies/);
    const r = (await ss.act(im, 'request', { siteId: GUARD_SITE, receiverUserId: om.id, forNewSite: true, notes: 'New site starts 1 Dec', lines: [{ stockItemId: SET, qty: 3, purpose: 'New site' }] })) as V;
    expect(r).toMatchObject({ status: 'kelulusan', startedBy: { role: 'office', name: im.name }, receiverId: om.id });
    // The OM who will receive it sees it on their board.
    const b = (await ss.act(om, 'board', {})) as { rows: { id: string }[] };
    expect(b.rows.some((x) => x.id === r.id)).toBe(true);
    await ss.act(ogm, 'confirm', { id: r.id });
    await ss.act(sk, 'stockCheck', { id: r.id });
    // The Inventory Manager asked, so the Procurement executive decides.
    await expect(ss.act(im, 'decide', { id: r.id })).rejects.toThrow(/own request/);
    await ss.act(proc, 'decide', { id: r.id });
    await ss.act(sk, 'stage', { id: r.id, stage: 'prepared' });
    await ss.act(sk2, 'stage', { id: r.id, stage: 'pic' });
    await ss.act(sk, 'stage', { id: r.id, stage: 'ready' });
    const issued = (await ss.act(sk, 'issue', { id: r.id })) as V;
    const bulk = (await store.get('stockRequests', issued.lines[0].issued!.refId))!;
    expect((bulk.ss as { omUserId: string }).omUserId).toBe(om.id);
    expect((await store.get('stockItems', TROUSERS))!.onHand).toBe(17);
    void svc;
  });

  it('the OGM starts one and it is approved as asked; the COO does not confirm', async () => {
    const { ss, ogm, om, coo } = await setup();
    await ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const r = (await ss.act(ogm, 'request', { siteId: GUARD_SITE, receiverUserId: om.id, lines: [{ stockItemId: TROUSERS, qty: 5, purpose: 'Site start-up' }] })) as V & { steps: { step: string; by: string }[]; lines: (Line & { confirmedQty: number })[] };
    expect(r.startedBy.role).toBe('office');
    expect(r.status).toBe('diluluskan');
    expect(r.steps.map((x) => x.step)).toEqual(['submit', 'confirm']);
    expect(r.lines[0].confirmedQty).toBe(5);
    await expect(ss.act(coo, 'confirm', { id: r.id })).rejects.toThrow(/own request|confirms orders/);
  });

  it('the COO does not confirm an OM request (the OGM does)', async () => {
    const { ss, om, coo } = await setup();
    await ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const r = (await ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'x', lines: [{ stockItemId: TROUSERS, qty: 1, purpose: 'Torn' }] })) as V;
    await expect(ss.act(coo, 'confirm', { id: r.id })).rejects.toThrow(/confirms orders/);
  });
});

describe('Uniform count: everything a guard wears, item by item', () => {
  it('each worn item has its own allowance; a suit uses one of each; trousers alone count as trousers', async () => {
    const { svc, store, ss, om, ogm, sk, sk2, proc } = await setup();
    await ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const guard = (await store.list('people', {})).find((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role === 'guard')!;
    // Two suits and one more pair of trousers: 3 trousers in 12 months, still free; badges 4 of 6 free.
    const r = (await ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'x', lines: [{ stockItemId: SET, staffNo: guard.staffNo, qty: 2, purpose: 'New guard' }] })) as V & { lines: (Line & { allowance: { paid: unknown } | null })[] };
    expect(r.lines.every((l) => l.allowance && !l.allowance.paid)).toBe(true);
    await expect(ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'x', lines: [{ stockItemId: TROUSERS, staffNo: guard.staffNo, qty: 2, purpose: 'Torn' }] })).rejects.toThrow(/already on open request/);
    // Issue the two suits, then ask for trousers alone: the 3rd is free, the 4th needs a receipt.
    await ss.act(ogm, 'confirm', { id: r.id });
    await ss.act(sk, 'stockCheck', { id: r.id });
    await ss.act(proc, 'decide', { id: r.id });
    await ss.act(sk, 'stage', { id: r.id, stage: 'prepared' });
    await ss.act(sk2, 'stage', { id: r.id, stage: 'pic' });
    await ss.act(sk, 'stage', { id: r.id, stage: 'ready' });
    const issued = (await ss.act(sk, 'issue', { id: r.id })) as V;
    const bulkId = issued.lines[0].issued!.refId;
    const doc = [{ kind: 'document' as const, name: 'synthetic-do.png', data: `data:image/png;base64,${Buffer.from('synthetic delivery order '.repeat(30)).toString('base64')}` }];
    await ss.act(om, 'bulkCount', { id: bulkId, proof: doc, doSigned: true, lines: issued.lines.map((l) => ({ n: l.n, arrived: l.qty })) });
    for (const l of issued.lines) await ss.act(om, 'handOut', { id: bulkId, n: l.n });
    expect((await svc.ssUniformHistory(guard.id, G, 'uniform trousers')).pieces).toBe(2);
    expect((await svc.ssUniformHistory(guard.id, G, 'badge'))).toMatchObject({ pieces: 4, free: 6 });
    await expect(ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'x', lines: [{ stockItemId: TROUSERS, staffNo: guard.staffNo, qty: 2, purpose: 'Torn' }] })).rejects.toThrow(/4 x Uniform trousers .* receipt number and amount/);
    const t = (await ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'x', lines: [{ stockItemId: TROUSERS, staffNo: guard.staffNo, qty: 1, purpose: 'Torn' }] })) as V & { lines: { allowance: { pieces: number; paid: unknown } }[] };
    expect(t.lines[0].allowance).toMatchObject({ pieces: 2, paid: null });
    // The shirt is counted on its own: 2 so far, so one more shirt is free too.
    expect((await svc.ssUniformHistory(guard.id, G, 'uniform shirt')).pieces).toBe(2);
  });
});
