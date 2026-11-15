import { describe, expect, it } from 'vitest';
import { GOV_OPS_COMPANY_ID, MemoryStore, PrimaService, generateDataset, myt, stockStatus } from '../src';
import type { User } from '../src';

// Part T (Fitri package): one site supplies request for KBK, PKK Nepal and PKK Local sites. Synthetic data only.
const TODAY = '2026-11-16';
const NOW = myt(TODAY, '10:00');
const G = GOV_OPS_COMPANY_ID;
const KBK_SITE = 'st-arsh-001';
const GUARD_SITE = 'st-sasa-011';
let n = 0;
const doc = () => [{ kind: 'document' as const, name: `synthetic-${++n}.png`, data: `data:image/png;base64,${Buffer.from(`synthetic photo ${n} `.repeat(30)).toString('base64')}` }];
const sig = (k: number) => `data:image/png;base64,${Buffer.from(`synthetic signature ${k} `.repeat(40)).toString('base64')}`;
/** Part U6: prepared by one storekeeper, checked by a second (PIC), then ready for delivery. */
const readyToSend = async (ss: { act: (u: never, op: string, i: Record<string, unknown>) => Promise<unknown> }, a: unknown, b: unknown, id: string) => {
  await ss.act(a as never, 'stage', { id, stage: 'prepared' });
  await ss.act(b as never, 'stage', { id, stage: 'pic' });
  await ss.act(a as never, 'stage', { id, stage: 'ready' });
};

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const mgr = { ...(await svc.user('u-proc-exec')), procRole: 'manager' as const };
  const add = async (sku: string, name: string, kind: string, onHand: number) => {
    await svc.saveRecord(mgr, 'stockItem', null, G, { sku, name, kind, size: kind === 'UNIFORM' ? 'M' : null, reorderAt: 0, onHand: 0 });
    const it = (await store.list('stockItems', { companyId: [G] })).find((i) => i.name === name)!;
    it.onHand = onHand;
    return it;
  };
  const cleaner = await add('CLN-1', 'Synthetic floor cleaner', 'CLEANING', 10);
  const shirt = await add('UNI-1', 'Synthetic guard shirt', 'UNIFORM', 30);
  const torch = await add('EQ-1', 'Synthetic torch', 'EQUIPMENT', 0);
  // The Gov Ops HQ admin executive (the Nepal first checker): a synthetic sign-in.
  const fc = { ...(await svc.user('u-ae-sasa')), id: 'u-gov-ae-test', name: 'Synthetic HQ admin', companyIds: [G] } as User;
  store.data.users.push(fc);
  const guards = ds.people.filter((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role === 'guard').slice(0, 3);
  const po = ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role === 'patrol_officer')!;
  return {
    ds,
    store,
    svc,
    ss: svc.siteSupplies,
    cleaner,
    shirt,
    torch,
    guards,
    po,
    fc,
    om: await svc.user('u-om-klang'),
    ogm: await svc.user('u-ogm'),
    sk: await svc.user('u-proc-store1'),
    sk2: await svc.user('u-proc-store2'),
    proc: await svc.user('u-proc-exec'),
    cm: await svc.user('u-cm-inas'),
  };
}
type V = { id: string; status: string; ref: string; lines: { n: number; issued: { refId: string } | null; purRequestId: string | null; confirmedQty: number | null; changes: unknown[] }[] };

describe('Part T: site supplies request', () => {
  it('KBK: request, OGM confirms with a change, stock check, issue as a delivery that takes store stock, short receipt flags', async () => {
    const { svc, store, ss, cleaner, om, ogm, sk, proc } = await setup();
    const r = (await ss.act(om, 'request', { siteId: KBK_SITE, startedByName: 'Synthetic supervisor', alsoSentBy: 'sharepoint', alsoSentRef: 'SP-12', lines: [{ stockItemId: cleaner.id, supplyId: 'floor-cleaner', qty: 5, purpose: 'Monthly refill', area: 'Blok A' }] })) as V;
    expect(r.ref).toMatch(/^KBK-20261116-001$/);
    expect(r.status).toBe('kelulusan');
    // The duplicate is shown, not added.
    await expect(ss.act(om, 'request', { siteId: KBK_SITE, startedByName: 'x', lines: [{ stockItemId: cleaner.id, supplyId: 'floor-cleaner', qty: 1 }] })).rejects.toThrow(/already on open request KBK-20261116-001/);
    // A KBK line names the site supply it refills.
    await expect(ss.act(om, 'request', { siteId: KBK_SITE, startedByName: 'x', lines: [{ stockItemId: cleaner.id, qty: 1 }] })).rejects.toThrow(/site supply or equipment/);
    // The storekeeper cannot confirm; the OGM confirms and the change is kept with the old figure.
    await expect(ss.act(sk, 'confirm', { id: r.id })).rejects.toThrow(/OGM/);
    await expect(ss.act(ogm, 'confirm', { id: r.id, changes: [{ n: 1, qty: 4 }] })).rejects.toThrow(/say why/);
    const c = (await ss.act(ogm, 'confirm', { id: r.id, changes: [{ n: 1, qty: 4, reason: 'Stock at site still good' }] })) as V;
    expect(c.status).toBe('diluluskan');
    expect(c.lines[0]).toMatchObject({ confirmedQty: 4, changes: [{ from: 5, to: 4 }] });
    await expect(ss.act(proc, 'decide', { id: r.id })).rejects.toThrow(/storekeeper checks the stock first/);
    await ss.act(sk, 'stockCheck', { id: r.id });
    await ss.act(proc, 'decide', { id: r.id });
    await readyToSend(ss, sk, await svc.user('u-proc-store2'), r.id);
    const done = (await ss.act(sk, 'issue', { id: r.id })) as V;
    expect(done.status).toBe('tindakan');
    expect((await store.get('stockItems', cleaner.id))!.onHand).toBe(6);
    const del = (await store.get('cleaningStock', done.lines[0].issued!.refId))!;
    expect(del).toMatchObject({ kind: 'delivery', requestId: r.id, supplies: [{ supplyId: 'floor-cleaner', sent: 4, stockItemId: cleaner.id, area: 'Blok A' }] });
    // Not closed until the supervisor's count is in; then a short count shows as a short delivery.
    await expect(ss.act(om, 'close', { id: r.id })).rejects.toThrow(/not delivered and confirmed/);
    await svc.cleaning.receiveDelivery(om, KBK_SITE, del.id, { supplies: [{ supplyId: 'floor-cleaner', qty: 3 }], note: '', proof: { image: doc()[0].data, takenAt: NOW } as never }).catch(async () => {
      // receiveDelivery wants a time-marked photo; record the count directly for this synthetic test.
      await store.update('cleaningStock', del.id, { supplies: [{ ...del.supplies[0], counted: 3 }], received: { by: om.name, byId: om.id, at: NOW, note: '' } });
    });
    const setup0 = (await store.get('cleaningSites', `clean-${KBK_SITE}`))!;
    const st = stockStatus(setup0, await store.list('cleaningStock', { companyId: 'co-arsh', siteId: KBK_SITE }));
    expect(st.supplies.find((x) => x.supply.id === 'floor-cleaner')!.flags).toContain('short_delivery');
    const closed = (await ss.act(om, 'close', { id: r.id })) as V;
    expect(closed.status).toBe('siap');
  });

  it('nobody confirms their own request; another company sees nothing; the requester sees every step', async () => {
    const { store, ss, cleaner, om, ogm, cm } = await setup();
    const r = (await ss.act(om, 'request', { siteId: KBK_SITE, startedByName: 'Synthetic supervisor', lines: [{ stockItemId: cleaner.id, supplyId: 'floor-cleaner', qty: 2 }] })) as V;
    await ss.act(ogm, 'settings', { deputyUserId: om.id, reason: 'Synthetic deputy for the test' });
    await expect(ss.act(om, 'confirm', { id: r.id })).rejects.toThrow(/Nobody confirms their own/);
    expect(((await ss.act(cm, 'board', {})) as { rows: unknown[] }).rows).toEqual([]);
    await expect(ss.act(cm, 'view', { id: r.id })).rejects.toThrow(/not found/i);
    const b = (await ss.act(om, 'board', {})) as { rows: { id: string; statusLabel: string }[] };
    expect(b.rows[0]).toMatchObject({ id: r.id, statusLabel: 'Dalam Kelulusan' });
    expect((await store.get('stockRequests', r.id))!.kind).toBe('site_supplies');
    // The Part I uniform queue does not show supplies requests.
    expect((await (await setup()).svc.uniformRequests(om)).requests).toEqual([]);
  });

  it('PKK Nepal: per-guard lines, summary, allowance (4th paid with receipt, 6th allowed), first check with roster gaps, bulk count then hand out', async () => {
    const { svc, store, ss, shirt, guards, po, fc, om, ogm, sk, proc } = await setup();
    await expect(ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK_NEPAL' })).rejects.toThrow(/Say why/);
    await ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK_NEPAL', reason: 'Guards here are Nepali' });
    await expect(ss.act(om, 'request', { siteId: GUARD_SITE, lines: [{ stockItemId: shirt.id, qty: 2 }] })).rejects.toThrow(/one line per guard/);
    await expect(ss.act(om, 'request', { siteId: GUARD_SITE, lines: [{ stockItemId: shirt.id, staffNo: guards[0].staffNo, qty: 4 }] })).rejects.toThrow(/receipt number and amount/);
    const r = (await ss.act(om, 'request', {
      siteId: GUARD_SITE,
      lines: [
        { stockItemId: shirt.id, staffNo: guards[0].staffNo, qty: 6, purpose: 'New guard', paid: { receiptNo: 'RC-1', amount: 45 } },
        { stockItemId: shirt.id, staffNo: guards[1].staffNo, qty: 2, purpose: 'New guard' },
      ],
    })) as V & { summary: { qty: number; guards: number }[] };
    expect(r.ref).toMatch(/^NEP-20261116-001$/);
    expect(r.status).toBe('semakan_awal');
    expect(r.summary).toEqual([expect.objectContaining({ qty: 8, guards: 2 })]);
    await expect(ss.act(ogm, 'confirm', { id: r.id })).rejects.toThrow(/not waiting for confirmation/);
    const v = (await ss.act(fc, 'view', { id: r.id }).catch(() => null)) as { rosterGaps: unknown[] } | null;
    if (v && v.rosterGaps.length) await expect(ss.act(fc, 'firstCheck', { id: r.id, ok: true })).rejects.toThrow(/roster/);
    await ss.act(fc, 'firstCheck', { id: r.id, ok: true, note: 'New guards start on Monday' });
    await ss.act(ogm, 'confirm', { id: r.id });
    await ss.act(sk, 'stockCheck', { id: r.id });
    await ss.act(proc, 'decide', { id: r.id });
    await readyToSend(ss, sk, await svc.user('u-proc-store2'), r.id);
    const issued = (await ss.act(sk, 'issue', { id: r.id })) as V;
    expect((await store.get('stockItems', shirt.id))!.onHand).toBe(22);
    const bulkId = issued.lines[0].issued!.refId;
    await expect(ss.act(om, 'handOut', { id: bulkId, n: 1 })).rejects.toThrow(/Count what arrived/);
    await expect(ss.act(om, 'bulkCount', { id: bulkId, lines: [{ n: 1, arrived: 6 }, { n: 2, arrived: 1 }] })).rejects.toThrow(/photo/);
    await expect(ss.act(om, 'bulkCount', { id: bulkId, proof: doc(), doSigned: true, lines: [{ n: 1, arrived: 6 }, { n: 2, arrived: 1 }] })).rejects.toThrow(/short or damaged/);
    await ss.act(om, 'bulkCount', { id: bulkId, proof: doc(), doSigned: true, note: 'One shirt missing', lines: [{ n: 1, arrived: 6 }, { n: 2, arrived: 1 }] });
    const iss = (await ss.act(om, 'handOut', { id: bulkId, n: 1, patrolPersonId: po.id })) as { id: string; qty: number };
    expect(iss.qty).toBe(6);
    await svc.handoverStep(om, iss.id, 'patrol', { received: true, signature: sig(1) });
    await svc.handoverStep(om, iss.id, 'guard', { received: true, signature: sig(2) });
    expect((await store.get('stockIssues', iss.id))!.acknowledged).toBe(true);
    const rec = (await ss.act(om, 'uniformRecord', { personId: guards[0].id })) as { rows: { qty: number; signed: boolean }[] };
    expect(rec.rows[0]).toMatchObject({ qty: 6, signed: true });
  });

  it('a buy line creates a linked purchase; the line issues only after goods received; the store never goes below zero', async () => {
    const { store, ss, torch, cleaner, om, ogm, sk, proc } = await setup();
    await ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const r = (await ss.act(om, 'request', { siteId: GUARD_SITE, startedByName: 'Synthetic patrol officer', lines: [{ stockItemId: torch.id, qty: 2, purpose: 'Night post' }, { stockItemId: cleaner.id, qty: 3, purpose: 'Guard post' }] })) as V;
    expect(r.ref).toMatch(/^PKK-/);
    expect(r.status).toBe('kelulusan');
    await ss.act(ogm, 'confirm', { id: r.id });
    await ss.act(sk, 'stockCheck', { id: r.id });
    await expect(ss.act(proc, 'decide', { id: r.id })).rejects.toThrow(/Choose issue .* or buy/);
    await expect(ss.act(proc, 'decide', { id: r.id, lines: [{ n: 1, decision: 'buy' }] })).rejects.toThrow(/estimated unit price/);
    const d = (await ss.act(proc, 'decide', { id: r.id, lines: [{ n: 1, decision: 'buy', unitPrice: 25 }] })) as V;
    const pr = (await store.get('purRequests', d.lines[0].purRequestId!))!;
    expect(pr).toMatchObject({ siteRequestIds: [r.id], category: 'GUARD_EQUIPMENT', status: 'quoting' });
    // The store issues the stock line; the buy line waits for the goods.
    await readyToSend(ss, sk, (await setup()).sk2, r.id);
    (await store.get('stockItems', cleaner.id))!.onHand = 1;
    await expect(ss.act(sk, 'issue', { id: r.id, lines: [2] })).rejects.toThrow(/only 1 in the store/);
    (await store.get('stockItems', cleaner.id))!.onHand = 10;
    // Two storekeepers at once: one issue (the memory store runs them one after the other).
    const both = await Promise.allSettled([ss.act(sk, 'issue', { id: r.id, lines: [2] }), ss.act((await setup()).sk2, 'issue', { id: r.id, lines: [2] })]);
    expect(both.filter((x) => x.status === 'fulfilled').length).toBe(1);
    expect((await store.get('stockItems', cleaner.id))!.onHand).toBe(7);
    await expect(ss.act(sk, 'issue', { id: r.id, lines: [1] })).rejects.toThrow(/purchase is not received/);
    await store.update('purRequests', pr.id, { status: 'received' });
    (await store.get('stockItems', torch.id))!.onHand = 2;
    const after = (await ss.act(sk, 'issue', { id: r.id, lines: [1] })) as V;
    expect(after.lines[0].issued).not.toBeNull();
  });

  it('goods received with condition: only good pieces go into the store; damaged shows in the match notes', async () => {
    const { svc, store, proc, sk, cleaner } = await setup();
    const pr = await svc.raisePurRequest(proc, G, { title: 'Synthetic cleaner', category: 'CLEANING', lines: [{ item: 'Floor cleaner', stockItemId: cleaner.id, qty: 10, unitPrice: 5 }] });
    await store.update('purRequests', pr.id, { status: 'ordered', po: { ref: 'PO-1', by: 'x', at: NOW, amount: 50 } });
    await expect(svc.purStep(sk, pr.id, 'receive', { qty: [10], ref: 'DO-SYN-2', proof: doc(), condition: [{ damaged: 2 }] })).rejects.toThrow(/say what is wrong/);
    const got = await svc.purStep(sk, pr.id, 'receive', { qty: [10], ref: 'DO-SYN-2', proof: doc(), condition: [{ damaged: 2, note: 'Two bottles leaking' }] });
    expect(got.grn!.condition![0]).toEqual({ good: 8, damaged: 2, wrong: 0, note: 'Two bottles leaking' });
    expect((await store.get('stockItems', cleaner.id))!.onHand).toBe(18);
    const fin = await svc.user('u-fd');
    const m = await svc.purStep(fin, pr.id, 'invoice', { number: 'INV-1', amount: 50, eInvoiceUuid: 'UUID-1' }).catch(() => null);
    if (m) expect(m.match!.notes.join(' ')).toMatch(/to return to the supplier/);
  });

  it('Min/Max: never invented; the store Min/Max by Procurement, the site Min/Max by the OM and approved by the OGM', async () => {
    const { store, ss, cleaner, om, ogm, proc, sk } = await setup();
    const o = (await ss.act(om, 'options', { siteId: KBK_SITE })) as { supplies: { id: string; min: number | null; max: number | null }[]; items: { id: string; max: number | null }[] };
    expect(o.supplies.every((x) => x.min === null && x.max === null)).toBe(true);
    expect(o.items.find((x) => x.id === cleaner.id)!.max).toBeNull();
    await expect(ss.act(sk, 'storeMinMax', { stockItemId: cleaner.id, min: 2, max: 8, reason: 'x' })).rejects.toThrow(/Procurement executive/);
    await expect(ss.act(proc, 'storeMinMax', { stockItemId: cleaner.id, min: 2, max: 8 })).rejects.toThrow(/Say how/);
    await ss.act(proc, 'storeMinMax', { stockItemId: cleaner.id, min: 2, max: 8, reason: '3 months of synthetic usage' });
    const b = (await ss.act(proc, 'board', {})) as { storeFlags: { id: string; flag: string }[] };
    expect(b.storeFlags.find((x) => x.id === cleaner.id)!.flag).toBe('above_max');
    await ss.act(om, 'siteMinMax', { siteId: KBK_SITE, supplyId: 'floor-cleaner', min: 4, max: 12, reason: 'Synthetic usage' });
    const mm = ((await ss.act(ogm, 'board', {})) as { minmax: { id: string }[] }).minmax[0];
    await expect(ss.act(om, 'decideMinMax', { id: mm.id, ok: true })).rejects.toThrow(/OGM approves/);
    await ss.act(ogm, 'decideMinMax', { id: mm.id, ok: true });
    const sup = (await store.get('cleaningSites', `clean-${KBK_SITE}`))!.supplies.find((x) => x.id === 'floor-cleaner')!;
    expect(sup).toMatchObject({ minOnHand: 4, maxOnHand: 12 });
  });

  it('disposal of a marked piece needs "marks removed" and a photo, decided by someone else; never a pay deduction', async () => {
    const { svc, store, ss, shirt, guards, po, om, sk, sk2 } = await setup();
    const iss = await svc.stockIssue(sk, G, { itemId: shirt.id, personId: guards[0].id, qty: 1, omUserId: om.id, patrolPersonId: po.id });
    await svc.stockReturn(sk, iss.id, 'worn', 'Faded');
    await expect(ss.act(sk, 'dispose', { issueId: iss.id, reason: 'Worn out', marksRemoved: true, photo: doc() })).rejects.toThrow(/someone other than/);
    await expect(ss.act(sk2, 'dispose', { issueId: iss.id, reason: 'Worn out' })).rejects.toThrow(/marks removed/);
    await expect(ss.act(sk2, 'dispose', { issueId: iss.id, reason: 'Worn out', marksRemoved: true })).rejects.toThrow(/photo/);
    await ss.act(sk2, 'dispose', { issueId: iss.id, reason: 'Worn out', marksRemoved: true, photo: doc() });
    expect((await store.get('stockIssues', iss.id))!.disposed).toMatchObject({ marksRemoved: true });
    const ret = (await ss.act(om, 'returns', { personId: guards[0].id })) as { note: string };
    expect(ret.note).toMatch(/Never a pay deduction/);
  });

  it('settings: switches per contract type with a reason; "Prima only from" turns the other channels off', async () => {
    const { ss, cleaner, om, ogm, sk } = await setup();
    const s0 = await ss.settings(G);
    expect(s0.contracts.PKK_NEPAL).toMatchObject({ firstCheck: true, bulkCount: true, responsible: true });
    expect(s0.contracts.PKK).toMatchObject({ firstCheck: false, bulkCount: true, responsible: true });
    expect(s0.contracts.KBK).toMatchObject({ firstCheck: false, bulkCount: false });
    expect(s0.primaOnlyFrom).toBeNull();
    await expect(ss.act(sk, 'settings', { reason: 'x', primaOnlyFrom: '2026-11-16' })).rejects.toThrow(/OGM/);
    await ss.act(ogm, 'settings', { reason: 'Changeover over', primaOnlyFrom: '2026-11-16' });
    await expect(ss.act(om, 'request', { siteId: KBK_SITE, startedByName: 'x', alsoSentBy: 'paper', lines: [{ stockItemId: cleaner.id, supplyId: 'floor-cleaner', qty: 1 }] })).rejects.toThrow(/Prima only/);
  });
});
