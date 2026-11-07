import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  generateDataset,
  labelDisplay,
  labelFromRandom,
  myt,
  parseLabel,
  parseRfid,
  parseScan,
  sampleLabelToken,
  type Dataset,
  type ItemAction,
  type ItemMovement,
  type PhysicalItem,
} from '../src';

// One item register (Fauzan, 6 Nov 2026; Fitri's paper v1.0). Synthetic data only. Test ids follow the paper (U01-U24).

const TODAY = '2026-11-06';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds: Dataset = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  let tick = 0;
  // Each call is a minute later, so event order is clear.
  const svc = new PrimaService(store, () => myt(TODAY, `11:${String(Math.min(59, Math.floor(tick++ / 4))).padStart(2, '0')}`));
  let rid = 0;
  const act = async (userId: string, a: ItemAction, requestId = `req-test-${++rid}`) => {
    const u = await svc.user(userId);
    const out = (await svc.items.act(u, requestId, a)) as { replay: boolean; result: unknown };
    return out.result as never;
  };
  const board = async (userId: string) => svc.items.board(await svc.user(userId));
  return { ds, svc, store, act, board };
}

const STORE = 'u-proc-store1';
const PROC = 'u-proc-exec';
const SASA_CM = 'u-cm-sasa';
const SASA_GM = 'u-gm-sasa';
const SASA_SV = 'u-sv-sasa';
const GUARD = 'u-guard-sasa-1';
const FD = 'u-fd';

async function registerShirts(t: ReturnType<typeof fresh>, count: number) {
  const items = (await t.act(STORE, { kind: 'item.register', skuId: 'sku-shirt-l', partyId: 'goodwill', count })) as PhysicalItem[];
  for (const i of items) await t.act(STORE, { kind: 'item.inspect', label: i.token, condition: 'new', note: '' });
  return items;
}

async function saleOf(t: ReturnType<typeof fresh>, items: PhysicalItem[]) {
  const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Test sale' })) as ItemMovement;
  for (const i of items) await t.act(STORE, { kind: 'move.add', movementId: m.id, label: i.token });
  await t.act(STORE, { kind: 'move.dispatch', movementId: m.id, carrier: 'Test van' });
  return m;
}

const PDF = (n: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 synthetic ${n}`).toString('base64')}`;

/** Invoice (seller Finance), payment slip (buyer Finance) and the buyer manager's signed acknowledgement letter. */
async function salePapers(t: ReturnType<typeof fresh>, movementId: string, tag = 'a') {
  await t.act(FD, { kind: 'move.paper', movementId, paper: 'invoice', ref: `INV-MOCK-${tag}`, date: TODAY, doc: { name: 'invoice.pdf', data: PDF(`inv ${tag} ${movementId}`) } });
  await t.act(FD, { kind: 'move.paper', movementId, paper: 'payment_slip', ref: `PAY-MOCK-${tag}`, date: TODAY, doc: { name: 'slip.pdf', data: PDF(`pay ${tag} ${movementId}`) } });
  await t.act(SASA_GM, { kind: 'move.acknowledge', movementId, ref: `ACK-MOCK-${tag}`, date: TODAY, signedBy: 'General Manager (mock)' });
}

describe('labels', () => {
  it('makes and reads one opaque label format, with a check character (U12, U21)', () => {
    const t = labelFromRandom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(t).toMatch(/^P1-[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(parseLabel(t)).toEqual({ ok: true, token: t });
    expect(parseLabel(labelDisplay(t).toLowerCase())).toEqual({ ok: true, token: t });
    const wrong = t.slice(0, -1) + (t.endsWith('0') ? '1' : '0');
    expect(parseLabel(wrong)).toEqual({ ok: false, reason: 'bad_check' });
    expect(parseLabel('https://evil.example/x')).toEqual({ ok: false, reason: 'link' });
    expect(parseLabel('javascript:alert(1)')).toEqual({ ok: false, reason: 'link' });
    expect(parseLabel('x'.repeat(41))).toEqual({ ok: false, reason: 'too_long' });
    expect(parseLabel('9555123456789')).toEqual({ ok: false, reason: 'unknown_format' });
    expect(sampleLabelToken('a')).toBe(sampleLabelToken('a'));
  });
});

describe('one item register', () => {
  it('U01/U02: sale 10 units, 8 good, 1 damaged, 1 missing; same IDs, separate line results, no false full receipt', async () => {
    const t = fresh();
    const items = await registerShirts(t, 10);
    const m = await saleOf(t, items);
    const lines = items.map((i, k) => ({ itemId: i.id, result: (k < 8 ? 'received' : k === 8 ? 'damaged' : 'missing') as 'received' | 'damaged' | 'missing', note: k === 8 ? 'Torn' : '' }));
    const out = (await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines })) as ItemMovement;
    expect(out.status).toBe('partly_received');
    const after = await Promise.all(items.map((i) => t.store.get('physicalItems', i.id)));
    expect(after.map((i) => i!.token)).toEqual(items.map((i) => i.token));
    expect(after.slice(0, 8).every((i) => i!.state === 'available' && i!.custody.partyId === 'co-sasa')).toBe(true);
    expect(after[8]!.state).toBe('quarantine');
    expect(after[9]!.state).toBe('in_transit');
    // Ownership does not pass on a scan or a receipt.
    expect(after.every((i) => i!.ownerPartyId === 'goodwill')).toBe(true);
    const cases = (await t.store.list('itemCases', { movementId: m.id })).map((c) => c.kind).sort();
    expect(cases).toEqual(['damaged', 'short']);
    // Both books have a queued document, linked by the same commercial reference, and nothing is sent.
    const jobs = await t.store.list('itemSyncJobs', { sourceId: m.id });
    expect(jobs.map((j) => j.docType).sort()).toEqual(['purchase_receipt', 'sales_delivery']);
    expect(new Set(jobs.map((j) => j.payload.commercialRef)).size).toBe(1);
    expect(jobs.every((j) => j.status === 'not_ready')).toBe(true);
    expect(jobs.find((j) => j.docType === 'purchase_receipt')!.payload.lines[0].qty).toBe(8);
  });

  it('ownership is recorded by Finance only, never by the receiver, and never on a rental', async () => {
    const t = fresh();
    const items = await registerShirts(t, 2);
    const m = await saleOf(t, items);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: items.map((i) => ({ itemId: i.id, result: 'received' as const })) });
    await expect(t.act(SASA_CM, { kind: 'move.ownership', movementId: m.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' })).rejects.toThrow(/Finance/);
    await salePapers(t, m.id);
    await t.act(FD, { kind: 'move.ownership', movementId: m.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' });
    expect((await t.store.get('physicalItems', items[0].id))!.ownerPartyId).toBe('co-sasa');
    // Ownership passes to the buyer, and the seller keeps following each item's life (Fauzan, 6 Nov 2026).
    const owned = (await t.store.get('physicalItems', items[0].id))!;
    expect(owned.historyPartyIds.sort()).toEqual(['co-sasa', 'goodwill']);
    expect(owned.partyIds).toContain('goodwill');
    const rental = (await t.act(STORE, { kind: 'move.create', type: 'rental', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Radios', dueBackOn: '2027-01-31' })) as ItemMovement;
    await expect(t.act(FD, { kind: 'move.ownership', movementId: rental.id, effectiveOn: TODAY, basis: 'not allowed here' })).rejects.toThrow(/never changes/);
  });

  it('U03: two people cannot send the same unit at once; stock never goes negative', async () => {
    const t = fresh();
    const [item] = await registerShirts(t, 1);
    const a = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Sale A test' })) as ItemMovement;
    const b = (await t.act('u-proc-store2', { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-arsh', purpose: 'Sale B test' })) as ItemMovement;
    const res = await Promise.allSettled([t.act(STORE, { kind: 'move.add', movementId: a.id, label: item.token }), t.act('u-proc-store2', { kind: 'move.add', movementId: b.id, label: item.token })]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(res.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('U04: the same request twice makes one movement; a changed payload with the same id is refused', async () => {
    const t = fresh();
    const [item] = await registerShirts(t, 1);
    const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Sale A test' })) as ItemMovement;
    await t.act(STORE, { kind: 'move.add', movementId: m.id, label: item.token });
    const u = await t.svc.user(STORE);
    const one = (await t.svc.items.act(u, 'req-dispatch-1', { kind: 'move.dispatch', movementId: m.id, carrier: 'Van' })) as { replay: boolean };
    const two = (await t.svc.items.act(u, 'req-dispatch-1', { kind: 'move.dispatch', movementId: m.id, carrier: 'Van' })) as { replay: boolean };
    expect(one.replay).toBe(false);
    expect(two.replay).toBe(true);
    expect((await t.store.list('itemEvents', { itemId: item.id, kind: 'dispatch' })).length).toBe(1);
    expect((await t.store.list('itemSyncJobs', { sourceId: m.id })).length).toBe(1);
    await expect(t.svc.items.act(u, 'req-dispatch-1', { kind: 'move.dispatch', movementId: m.id, carrier: 'Other van' })).rejects.toThrow(/different change/);
  });

  it('the sender cannot confirm the receipt, and a third company cannot receive', async () => {
    const t = fresh();
    const [item] = await registerShirts(t, 1);
    const m = await saleOf(t, [item]);
    await expect(t.act(STORE, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: item.id, result: 'received' }] })).rejects.toThrow(/receiving company|sent it/);
    await expect(t.act('u-cm-arsh', { kind: 'move.receive', movementId: m.id, lines: [{ itemId: item.id, result: 'received' }] })).rejects.toThrow();
  });

  it('U05: a guard returns a Sasa-bought item to Sasa; it never goes back to Goodwill ownership', async () => {
    const t = fresh();
    const [item] = await registerShirts(t, 1);
    const m = await saleOf(t, [item]);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: item.id, result: 'received' }] });
    await salePapers(t, m.id);
    await t.act(FD, { kind: 'move.ownership', movementId: m.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' });
    const guard = await t.svc.user(GUARD);
    // The seed already handed this guard a uniform set today, so a second piece now needs a reason.
    await t.act(SASA_CM, { kind: 'issue', label: item.token, personId: guard.personId, reason: 'Replacement size (test)' });
    // Only the guard confirms, in their own sign-in.
    await expect(t.act(SASA_SV, { kind: 'confirm', label: item.token })).rejects.toThrow(/Only the person/);
    await t.act(GUARD, { kind: 'confirm', label: item.token });
    const mine = await t.board(GUARD);
    expect(mine.mine.map((x) => x.item.id)).toContain(item.id);
    await t.act(SASA_CM, { kind: 'return', label: item.token, condition: 'worn', note: '' });
    const back = (await t.store.get('physicalItems', item.id))!;
    expect(back.ownerPartyId).toBe('co-sasa');
    expect(back.custody.ref).toBe('store:co-sasa');
    expect(back.state).toBe('quarantine');
  });

  it('U06: a supplier return points at the original sale; receipt does not change the owner', async () => {
    const t = fresh();
    const [item] = await registerShirts(t, 1);
    const sale = await saleOf(t, [item]);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: sale.id, lines: [{ itemId: item.id, result: 'received' }] });
    await salePapers(t, sale.id);
    await t.act(FD, { kind: 'move.ownership', movementId: sale.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' });
    await expect(t.act(SASA_CM, { kind: 'move.create', type: 'supplier_return', fromPartyId: 'co-sasa', toPartyId: 'goodwill', purpose: 'Wrong size' })).rejects.toThrow(/original sale/);
    const ret = (await t.act(SASA_CM, { kind: 'move.create', type: 'supplier_return', fromPartyId: 'co-sasa', toPartyId: 'goodwill', purpose: 'Wrong size', originalMovementId: sale.id })) as ItemMovement;
    await t.act(SASA_CM, { kind: 'move.add', movementId: ret.id, label: item.token });
    await t.act(SASA_CM, { kind: 'move.dispatch', movementId: ret.id, carrier: 'Sasa driver' });
    await t.act(STORE, { kind: 'move.receive', movementId: ret.id, lines: [{ itemId: item.id, result: 'received' }] });
    expect((await t.store.get('physicalItems', item.id))!.ownerPartyId).toBe('co-sasa');
    expect((await t.store.get('physicalItems', item.id))!.custody.partyId).toBe('goodwill');
  });

  it('U07: a rental keeps the owner and records the date it must come back', async () => {
    const t = fresh();
    const [item] = await registerShirts(t, 1);
    const m = (await t.act(STORE, { kind: 'move.create', type: 'rental', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Rental', dueBackOn: '2027-01-31' })) as ItemMovement;
    await t.act(STORE, { kind: 'move.add', movementId: m.id, label: item.token });
    await t.act(STORE, { kind: 'move.dispatch', movementId: m.id, carrier: 'Van' });
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: item.id, result: 'received' }] });
    const i = (await t.store.get('physicalItems', item.id))!;
    expect(i.ownerPartyId).toBe('goodwill');
    expect(i.dueBack).toEqual({ on: '2027-01-31', movementId: m.id });
  });

  it('U08: a damaged item is not sent again; its replacement gets a new ID linked to the old one', async () => {
    const t = fresh();
    const [item] = (await t.act(STORE, { kind: 'item.register', skuId: 'sku-shirt-l', partyId: 'goodwill', count: 1 })) as PhysicalItem[];
    await t.act(STORE, { kind: 'item.inspect', label: item.token, condition: 'damaged', note: 'Torn collar' });
    expect((await t.store.get('physicalItems', item.id))!.state).toBe('quarantine');
    const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Test sale' })) as ItemMovement;
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, label: item.token })).rejects.toThrow(/cannot be sent/);
    const rep = (await t.act(STORE, { kind: 'item.replace', label: item.token, note: 'Torn' })) as PhysicalItem;
    expect(rep.token).not.toBe(item.token);
    expect(rep.replacesId).toBe(item.id);
    expect((await t.store.get('physicalItems', item.id))!.replacedById).toBe(rep.id);
    await expect(t.act(STORE, { kind: 'item.replace', label: item.token, note: 'Again' })).rejects.toThrow(/already has a replacement/);
  });

  it('U09: site A to site B keeps the ID, goes through transit and needs the receiving site to confirm', async () => {
    const t = fresh();
    const sv = await t.svc.user(SASA_SV);
    const [siteA, siteB] = sv.siteIds;
    const items = await registerShirts(t, 1);
    const sale = await saleOf(t, items);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: sale.id, lines: [{ itemId: items[0].id, result: 'received' }] });
    await t.act(SASA_CM, { kind: 'issue', label: items[0].token, siteId: siteA });
    const m = (await t.act(SASA_SV, { kind: 'move.create', type: 'transfer', fromPartyId: 'co-sasa', toPartyId: 'co-sasa', toSiteId: siteB, purpose: 'Cover at site B' })) as ItemMovement;
    expect(m.commercialRef).toBeNull();
    await t.act(SASA_SV, { kind: 'move.add', movementId: m.id, label: items[0].token });
    await t.act(SASA_SV, { kind: 'move.dispatch', movementId: m.id, carrier: 'Patrol officer' });
    expect((await t.store.get('physicalItems', items[0].id))!.state).toBe('in_transit');
    await expect(t.act(SASA_SV, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: items[0].id, result: 'received' }] })).rejects.toThrow(/sent it/);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: items[0].id, result: 'received' }] });
    const i = (await t.store.get('physicalItems', items[0].id))!;
    expect(i.custody.ref).toBe(siteB);
    expect(i.token).toBe(items[0].token);
    // A transfer inside one company makes no SQL document.
    expect((await t.store.list('itemSyncJobs', { sourceId: m.id })).length).toBe(0);
    // A site check records what was seen but moves nothing.
    const before = (await t.store.get('physicalItems', items[0].id))!;
    const obs = (await t.act(SASA_SV, { kind: 'observe', label: items[0].token, siteId: siteA })) as { expectedHere: boolean };
    expect(obs.expectedHere).toBe(false);
    const after = (await t.store.get('physicalItems', items[0].id))!;
    expect(after.custody).toEqual(before.custody);
    expect((await t.store.list('itemCases', { itemId: items[0].id, kind: 'wrong_place' })).length).toBe(1);
  });

  it('U10: a set is checked part by part and counted once; consumables are never expected back', async () => {
    const t = fresh();
    const [shirt] = await registerShirts(t, 1);
    const [trouser] = (await t.act(STORE, { kind: 'item.register', skuId: 'sku-trouser-32', partyId: 'goodwill', count: 1 })) as PhysicalItem[];
    await t.act(STORE, { kind: 'item.inspect', label: trouser.token, condition: 'new', note: '' });
    const kit = (await t.act(STORE, { kind: 'kit.assemble', skuId: 'sku-uniset-l', partyId: 'goodwill', labels: [shirt.token, trouser.token] })) as PhysicalItem;
    expect(kit.componentIds.sort()).toEqual([shirt.id, trouser.id].sort());
    const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Set' })) as ItemMovement;
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, label: shirt.token })).rejects.toThrow(/part of a set/);
    const withKit = (await t.act(STORE, { kind: 'move.add', movementId: m.id, label: kit.token })) as ItemMovement;
    expect(withKit.lines.map((l) => l.itemId).sort()).toEqual([shirt.id, trouser.id].sort());
    const b = await t.board(STORE);
    const units = b.balance.filter((r) => r.skuId === 'sku-uniset-l');
    expect(units).toHaveLength(0);
    // Consumable stock: issued and gone.
    const lot = (await t.act(SASA_CM, { kind: 'lot.add', skuId: 'sku-floor-5l', partyId: 'co-sasa', qty: 10, note: 'DN-TEST-1' })) as { id: string; qty: number };
    await expect(t.act(SASA_CM, { kind: 'lot.issue', lotId: lot.id, qty: 99, siteId: (await t.svc.user(SASA_SV)).siteIds[0] })).rejects.toThrow(/Only/);
    const after = (await t.act(SASA_CM, { kind: 'lot.issue', lotId: lot.id, qty: 4, siteId: (await t.svc.user(SASA_SV)).siteIds[0] })) as { qty: number };
    expect(after.qty).toBe(lot.qty - 4);
    await expect(t.act(SASA_CM, { kind: 'item.register', skuId: 'sku-floor-5l', partyId: 'co-sasa', count: 1 })).rejects.toThrow(/quantity/);
  });

  it('loss and disposal: never automatic, decided by a manager who did not report it; the ID is retired', async () => {
    const t = fresh();
    const [item] = await registerShirts(t, 1);
    const c = (await t.act(STORE, { kind: 'report.missing', label: item.token, note: 'Not on the shelf since Monday' })) as { id: string };
    expect((await t.store.get('physicalItems', item.id))!.state).toBe('missing');
    await expect(t.act(STORE, { kind: 'case.resolve', caseId: c.id, outcome: 'confirmed_lost', note: 'Searched' })).rejects.toThrow(/manager/);
    await t.act(PROC, { kind: 'case.resolve', caseId: c.id, outcome: 'confirmed_lost', note: 'Searched store and van' });
    const lost = (await t.store.get('physicalItems', item.id))!;
    expect(lost.state).toBe('lost');
    expect(lost.writeOff).toBe('finance_to_decide');
    // Disposal: asked by the store, decided by a manager; the same person cannot do both.
    const [b] = await registerShirts(t, 1);
    await t.store.update('physicalItems', b.id, { state: 'quarantine', condition: 'damaged' });
    const d = (await t.act(PROC, { kind: 'dispose.ask', label: b.token, reason: 'Burnt, cannot be repaired' })) as { id: string };
    await expect(t.act(PROC, { kind: 'case.resolve', caseId: d.id, outcome: 'approved', note: 'Looks burnt' })).rejects.toThrow(/opened the case/);
    await t.act('u-ogm', { kind: 'case.resolve', caseId: d.id, outcome: 'approved', note: 'Seen the photo' });
    expect((await t.store.get('physicalItems', b.id))!.state).toBe('disposed');
    await expect(t.act(STORE, { kind: 'item.reprint', label: b.token, reason: 'label faded, same item' })).rejects.toThrow(/retired/);
  });

  it('U12: a reprint keeps the ID and records the reason; a label on the wrong object is caught', async () => {
    const t = fresh();
    const [radio] = (await t.act(STORE, { kind: 'item.register', skuId: 'sku-radio', partyId: 'goodwill', count: 1, serials: ['UHF-TEST-1'] })) as PhysicalItem[];
    await t.act(STORE, { kind: 'item.inspect', label: radio.token, condition: 'new', note: '' });
    await expect(t.act(STORE, { kind: 'item.reprint', label: radio.token, reason: '' })).rejects.toThrow(/why/);
    const r = (await t.act(STORE, { kind: 'item.reprint', label: radio.token, reason: 'Label scratched; serial matched' })) as PhysicalItem;
    expect(r.token).toBe(radio.token);
    expect(r.labelPrints).toBe(2);
    await expect(t.act(STORE, { kind: 'item.register', skuId: 'sku-radio', partyId: 'goodwill', count: 1, serials: ['UHF-TEST-1'] })).rejects.toThrow(/already registered/);
  });

  it('count: not scanned means not found yet, never lost; nothing is adjusted', async () => {
    const t = fresh();
    const items = await registerShirts(t, 3);
    const c = (await t.act(STORE, { kind: 'count.start', partyId: 'goodwill' })) as { id: string; expected: string[] };
    expect(c.expected).toEqual(expect.arrayContaining(items.map((i) => i.id)));
    for (const id of c.expected.filter((x) => x !== items[2].id)) {
      const it = (await t.store.get('physicalItems', id))!;
      await t.act(STORE, { kind: 'count.scan', countId: c.id, label: it.token });
    }
    const closed = (await t.act(STORE, { kind: 'count.close', countId: c.id })) as { closed: { notFound: string[] } };
    expect(closed.closed.notFound).toEqual([items[2].id]);
    expect((await t.store.get('physicalItems', items[2].id))!.state).toBe('available');
    expect((await t.store.list('itemCases', { itemId: items[2].id, kind: 'count_not_found' })).length).toBe(1);
  });

  it('U13: Finance maps SQL item codes per book; a code may not point at two item types', async () => {
    const t = fresh();
    await expect(t.act(STORE, { kind: 'sku.map', skuId: 'sku-boots-8', partyId: 'goodwill', itemCode: '0008BOOT', uom: 'PAIR' })).rejects.toThrow(/Finance/);
    const s = (await t.act(FD, { kind: 'sku.map', skuId: 'sku-boots-8', partyId: 'goodwill', itemCode: '0008BOOT', uom: 'PAIR' })) as { sqlCodes: { itemCode: string }[] };
    expect(s.sqlCodes[0].itemCode).toBe('0008BOOT');
    await expect(t.act(FD, { kind: 'sku.map', skuId: 'sku-vest-l', partyId: 'goodwill', itemCode: '0008boot', uom: 'PCS' })).rejects.toThrow(/already used/);
    await expect(t.act(FD, { kind: 'sku.map', skuId: 'sku-vest-l', partyId: 'goodwill', itemCode: 'X'.repeat(31), uom: 'PCS' })).rejects.toThrow(/30/);
  });

  it('U20: walls between companies: names hidden, other companies refused, firearms refused, Arms Control not in the register', async () => {
    const t = fresh();
    const gw = await t.board(STORE);
    const handed = gw.items.find((i) => i.custody.kind === 'person');
    // Goodwill sees the sale lines it still owns, but never the Sasa guard's name.
    if (handed) expect(handed.custody.label).not.toMatch(/^[A-Z][a-z]+ [A-Z]/);
    const arsh = await t.board('u-cm-arsh');
    expect(arsh.items.every((i) => i.partyIds.includes('co-arsh'))).toBe(true);
    expect(arsh.movements.some((m) => m.partyIds.includes('co-sasa') && !m.partyIds.includes('co-arsh'))).toBe(false);
    const sasaItem = (await t.board(SASA_CM)).items.find((i) => i.custody.partyId === 'co-sasa')!;
    await expect(t.svc.items.resolve(await t.svc.user('u-cm-arsh'), sasaItem.token)).rejects.toThrow(/not found/);
    await expect(t.act('u-cm-arsh', { kind: 'issue', label: sasaItem.token, personId: 'pr-arsh-0001' })).rejects.toThrow(/not found/);
    await expect(t.act(STORE, { kind: 'sku.add', code: 'PISTOL-GLOCK', name: 'Pistol', category: 'other', tracking: 'SERIALIZED', uom: 'PCS' })).rejects.toThrow(/Arms Control/);
    await expect(t.act(STORE, { kind: 'sku.add', code: 'AMMO-9MM', name: 'Peluru 9mm', category: 'other', tracking: 'BULK', uom: 'BOX' })).rejects.toThrow(/Arms Control/);
    await expect(t.board('u-pwvsb-arms')).rejects.toThrow(/Arms Control vault/);
    // The ACT head and the CEO see the whole group; nothing is sent to SQL Account.
    const ceo = await t.board('u-fauzan');
    expect(ceo.items.length).toBeGreaterThan(arsh.items.length);
    expect(ceo.sqlConnection.connected).toBe(false);
  });

  it('IT devices: owned by Merdeka Network, linked once to the IT register, never sold', async () => {
    const t = fresh();
    const asset = t.ds.itAssets.find((a) => a.kind === 'LAPTOP' && !t.ds.physicalItems.some((i) => i.itAssetId === a.id))!;
    await expect(t.act(STORE, { kind: 'item.register', skuId: 'sku-laptop', partyId: 'goodwill', count: 1 })).rejects.toThrow();
    const [lap] = (await t.act('u-it-ex1', { kind: 'item.register', skuId: 'sku-laptop', partyId: 'merdeka', count: 1, itAssetId: asset.id })) as PhysicalItem[];
    expect(lap.serial).toBe(asset.serial);
    await expect(t.act('u-it-ex1', { kind: 'item.register', skuId: 'sku-laptop', partyId: 'merdeka', count: 1, itAssetId: asset.id })).rejects.toThrow(/One device, one record/);
  });

  it('sample data shows the paper scenarios and checks', async () => {
    const t = fresh();
    const b = await t.board('u-fauzan');
    expect(b.checks.inTransit.length).toBeGreaterThan(0);
    expect(b.checks.ownershipPending.length).toBe(1);
    expect(b.checks.unconfirmedHandovers.length).toBe(1);
    expect(b.checks.legacyUnverified).toBe(4);
    expect(b.syncJobs.every((j) => j.status === 'not_ready')).toBe(true);
    const tokens = t.ds.physicalItems.map((i) => i.token);
    expect(new Set(tokens).size).toBe(tokens.length);
    const guard = await t.board(GUARD);
    expect(guard.mine.length).toBe(1);
    expect(guard.items.length).toBe(0);
  });

  it('after a sale both companies follow the whole life of each item; the seller only watches', async () => {
    const t = fresh();
    // The storekeeper's monitor grants over companies are removed, so only following the item shows it.
    t.ds.grants = t.ds.grants.filter((g) => g.userId !== STORE);
    const items = await registerShirts(t, 2);
    const m = await saleOf(t, items);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: items.map((i) => ({ itemId: i.id, result: 'received' as const })) });
    await salePapers(t, m.id);
    await t.act(FD, { kind: 'move.ownership', movementId: m.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' });
    const guard = t.ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active')!;
    await t.act(SASA_CM, { kind: 'issue', label: items[0].token, personId: guard.id });
    // Goodwill (seller) sees the issue to a Sasa guard, with the guard's name hidden.
    const gw = await t.svc.items.resolve(await t.svc.user(STORE), items[0].token);
    expect(gw.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['register', 'inspect', 'dispatch', 'receive', 'ownership', 'issue']));
    const issued = gw.events.find((e) => e.kind === 'issue')!;
    expect(issued.to!.label).toBe('A Sasa Security Services Sdn Bhd staff member'.replace('Sasa Security Services Sdn Bhd', t.ds.companies.find((c) => c.id === 'co-sasa')!.name));
    expect(JSON.stringify(gw)).not.toContain(guard.name);
    expect(gw.followedBy.length).toBe(2);
    // Sasa (buyer) sees the steps from before it owned the item, with Goodwill's staff shown by company only.
    const sa = await t.svc.items.resolve(await t.svc.user(SASA_CM), items[0].token);
    const reg = sa.events.find((e) => e.kind === 'register')!;
    expect(reg.by).toBe('Other company staff');
    expect(reg.byId).toBe('(hidden)');
    // Watching never lets the seller act on the buyer's item.
    await expect(t.act(STORE, { kind: 'item.inspect', label: items[1].token, condition: 'worn', note: 'Seller tries to inspect' })).rejects.toThrow();
    await expect(t.act(STORE, { kind: 'report.missing', label: items[1].token, note: 'Seller tries to report it missing' })).rejects.toThrow();
    // A different company still cannot see it.
    await expect(t.svc.items.resolve(await t.svc.user('u-cm-arsh'), items[0].token)).rejects.toThrow();
  });

  it('RFID is optional: bind once, find by tag, refuse duplicates and barcodes, many reads count once', async () => {
    const t = fresh();
    expect(parseRfid('e2:80:11:60:60:00:02:0a:1b:2c:3d:00')).toBe('E28011606000020A1B2C3D00');
    expect(parseRfid('9555123456789')).toBeNull();
    expect(parseScan('9555123456789')).toEqual({ ok: false, reason: 'unknown_format' });
    // Every sample tag is a valid EPC that a reader would return.
    const seeded = t.ds.physicalItems.filter((i) => i.rfidTag);
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((i) => parseRfid(i.rfidTag) === i.rfidTag)).toBe(true);
    const items = await registerShirts(t, 2);
    const tag = 'E28011606000020A1B2C3D99';
    await t.act(STORE, { kind: 'item.rfid', label: items[0].token, tag });
    const found = await t.svc.items.resolve(await t.svc.user(STORE), tag.toLowerCase());
    expect(found.item.id).toBe(items[0].id);
    await expect(t.act(STORE, { kind: 'item.rfid', label: items[1].token, tag })).rejects.toThrow(/another item/);
    await expect(t.act(STORE, { kind: 'item.rfid', label: items[0].token, tag: 'E28011606000020A1B2C3D98' })).rejects.toThrow(/why/);
    await t.act(STORE, { kind: 'item.rfid', label: items[0].token, tag: 'E28011606000020A1B2C3D98', reason: 'Old tag damaged' });
    await expect(t.act(SASA_CM, { kind: 'item.rfid', label: items[1].token, tag: 'E28011606000020A1B2C3D97' })).rejects.toThrow();
    const c = (await t.act(STORE, { kind: 'count.start', partyId: 'goodwill' })) as { id: string };
    const out = (await t.act(STORE, { kind: 'count.scanMany', countId: c.id, reads: ['E28011606000020A1B2C3D98', 'e28011606000020a1b2c3d98', 'E2801160600002FFFFFFFF00', items[1].token, '9555123456789'] })) as {
      found: number;
      extra: number;
      already: number;
      unknown: string[];
      unreadable: number;
    };
    expect(out.found).toBe(2);
    expect(out.unknown).toEqual(['E2801160600002FFFFFFFF00']);
    expect(out.unreadable).toBe(1);
  });

  it('each company chooses barcode, QR or RFID; only its manager changes it, with a reason', async () => {
    const t = fresh();
    expect((await t.board(SASA_CM)).tagMethods.find((x) => x.partyId === 'co-sasa')!.tagMethod).toBe('barcode');
    await expect(t.act(SASA_CM, { kind: 'settings.tagMethod', partyId: 'co-sasa', tagMethod: 'qr', reason: '' })).rejects.toThrow(/reason/);
    await t.act(SASA_CM, { kind: 'settings.tagMethod', partyId: 'co-sasa', tagMethod: 'qr', reason: 'Phones read QR codes faster' });
    expect((await t.board(SASA_CM)).tagMethods.find((x) => x.partyId === 'co-sasa')!.tagMethod).toBe('qr');
    await expect(t.act(STORE, { kind: 'settings.tagMethod', partyId: 'goodwill', tagMethod: 'rfid', reason: 'Storekeeper tries' })).rejects.toThrow(/manager/);
    await expect(t.act(SASA_CM, { kind: 'settings.tagMethod', partyId: 'goodwill', tagMethod: 'rfid', reason: 'Another company tries' })).rejects.toThrow(/manager/);
    await t.act(PROC, { kind: 'settings.tagMethod', partyId: 'goodwill', tagMethod: 'rfid', reason: 'Gate reader at the main store (mock)' });
    // Whatever the choice, a printed label still scans.
    const items = await registerShirts(t, 1);
    expect((await t.svc.items.resolve(await t.svc.user(STORE), labelDisplay(items[0].token))).item.id).toBe(items[0].id);
  });

  it('the area OM scans labels to declare a delivery received; unscanned units stay waiting', async () => {
    const t = fresh();
    const states = new Map(t.ds.branches.map((b) => [b.id, b.state]));
    const om = t.ds.users.find((u) => u.opsTier === 'om' && t.ds.sites.some((s) => s.companyId === 'co-sasa' && (u.areaStates ?? []).includes(states.get(s.branchId) ?? '')))!;
    const site = t.ds.sites.find((s) => s.companyId === 'co-sasa' && (om.areaStates ?? []).includes(states.get(s.branchId) ?? ''))!;
    const otherOm = t.ds.users.find((u) => u.opsTier === 'om' && u.id !== om.id && !(u.areaStates ?? []).includes(states.get(site.branchId) ?? ''))!;
    const items = await registerShirts(t, 3);
    const m = (await t.act(STORE, { kind: 'move.create', type: 'rental', fromPartyId: 'goodwill', toPartyId: 'co-sasa', toSiteId: site.id, purpose: 'Site kit', dueBackOn: '2027-03-31' })) as ItemMovement;
    for (const i of items) await t.act(STORE, { kind: 'move.add', movementId: m.id, label: i.token });
    await t.act(STORE, { kind: 'move.dispatch', movementId: m.id, carrier: 'Test van' });
    await expect(t.act(STORE, { kind: 'move.receiveScan', reads: [items[0].token] })).rejects.toThrow();
    await expect(t.act(otherOm.id, { kind: 'move.receiveScan', reads: [items[0].token] })).rejects.toThrow();
    const out = (await t.act(om.id, { kind: 'move.receiveScan', reads: [labelDisplay(items[0].token), items[1].token, items[1].token] })) as { received: { count: number }[] };
    expect(out.received[0].count).toBe(2);
    const mv = (await t.store.get('itemMovements', m.id))!;
    expect(mv.status).toBe('partly_received');
    expect(mv.lines.map((l) => l.result)).toEqual(['received', 'received', 'pending']);
  });

  it('IT devices: the receiving company checks in the laptop Merdeka sent, never the sender', async () => {
    const t = fresh();
    const m = t.ds.itemMovements.find((x) => x.fromPartyId === 'merdeka' && x.status === 'dispatched')!;
    const lp = (await t.store.get('physicalItems', m.lines[0].itemId))!;
    expect(lp.itAssetId).toBeTruthy();
    await expect(t.act('u-it-lead', { kind: 'move.receiveScan', reads: [lp.token] })).rejects.toThrow();
    await t.act(SASA_CM, { kind: 'move.receiveScan', reads: [lp.token] });
    const after = (await t.store.get('physicalItems', lp.id))!;
    expect(after.custody.partyId).toBe('co-sasa');
    expect(after.ownerPartyId).toBe('merdeka');
  });

  it('shared post device: only the guard it was handed to confirms, with a face check', async () => {
    const t = fresh();
    const dev = t.ds.users.find((u) => u.role === 'site_device' && u.companyIds.includes('co-sasa'))!;
    const guards = t.ds.people.filter((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && p.faceEnrolledOn);
    const [mine, other] = guards;
    const items = await registerShirts(t, 1);
    const m = await saleOf(t, items);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: items[0].id, result: 'received' }] });
    await t.act(SASA_CM, { kind: 'issue', label: items[0].token, personId: mine.id });
    const good = { score: 0.94, live: true };
    // Another guard, even with a good face, cannot claim it.
    await expect(t.act(dev.id, { kind: 'device.confirm', staffNo: other.staffNo, face: good, label: items[0].token })).rejects.toThrow(/not waiting for you/);
    // The right staff number with someone else's face, or a photo held up, is refused and the item stays waiting.
    await expect(t.act(dev.id, { kind: 'device.confirm', staffNo: mine.staffNo, face: { score: 0.42, live: true }, label: items[0].token })).rejects.toThrow(/Face not confirmed/);
    await expect(t.act(dev.id, { kind: 'device.confirm', staffNo: mine.staffNo, face: { score: 0.91, live: false }, label: items[0].token })).rejects.toThrow(/Face not confirmed/);
    await expect(t.act(dev.id, { kind: 'device.confirm', staffNo: mine.staffNo, face: null, label: items[0].token })).rejects.toThrow(/Face not confirmed/);
    await expect(t.act(dev.id, { kind: 'device.confirm', staffNo: mine.staffNo, face: { score: 'high', live: true } as never, label: items[0].token })).rejects.toThrow(/Face not confirmed/);
    expect((await t.store.get('physicalItems', items[0].id))!.pendingAck).not.toBeNull();
    // Nothing is listed before the face check passes.
    await expect(t.svc.items.devicePending(await t.svc.user(dev.id), mine.staffNo, { score: 0.3, live: true })).rejects.toThrow();
    const list = await t.svc.items.devicePending(await t.svc.user(dev.id), mine.staffNo, good);
    expect(list.waiting.map((w) => w.label)).toContain(labelDisplay(items[0].token));
    await t.act(dev.id, { kind: 'device.confirm', staffNo: mine.staffNo.toLowerCase(), face: good, label: items[0].token });
    const after = (await t.store.get('physicalItems', items[0].id))!;
    expect(after.pendingAck).toBeNull();
    const ev = (await t.store.list('itemEvents', { itemId: items[0].id })).find((e) => e.kind === 'confirm')!;
    expect(ev.note).toMatch(/face check on the shared device/);
    // Only a site device can do this.
    await expect(t.act(SASA_CM, { kind: 'device.confirm', staffNo: mine.staffNo, face: good, label: items[0].token })).rejects.toThrow(/shared device/);
  });

  it('ownership passes only with receipt, invoice, payment slip and the signed letter of acknowledgement', async () => {
    const t = fresh();
    const items = await registerShirts(t, 3);
    const m = await saleOf(t, items);
    const own = () => t.act(FD, { kind: 'move.ownership', movementId: m.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' });
    // Nothing yet: receipt and all three papers are missing.
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: items[0].id, result: 'received' }, { itemId: items[1].id, result: 'received' }] });
    await expect(own()).rejects.toThrow(/invoice.*payment slip.*acknowledgement/i);
    // Only the seller's Finance attaches the invoice; only with a real scanned file.
    await expect(t.act(SASA_CM, { kind: 'move.paper', movementId: m.id, paper: 'invoice', ref: 'INV-1', date: TODAY, doc: { name: 'x.pdf', data: PDF('x') } })).rejects.toThrow(/Finance/);
    await expect(t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'invoice', ref: 'INV-1', date: TODAY, doc: { name: 'x.exe', data: 'data:application/x-msdownload;base64,AAAA' } })).rejects.toThrow(/PDF, JPEG or PNG/);
    await expect(t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'payment_slip', ref: 'PAY-1', date: TODAY, doc: { name: 's.pdf', data: PDF('s') } })).rejects.toThrow(/after the invoice/);
    await t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'invoice', ref: 'INV-1', date: TODAY, doc: { name: 'inv.pdf', data: PDF('inv') } });
    await expect(t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'invoice', ref: 'INV-2', date: TODAY, doc: { name: 'inv2.pdf', data: PDF('inv2') } })).rejects.toThrow(/why it is replaced/);
    await expect(t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'payment_slip', ref: 'PAY-1', date: '2099-01-01', doc: { name: 's.pdf', data: PDF('s') } })).rejects.toThrow(/future/);
    // The same file cannot be both the invoice and the payment slip.
    await expect(t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'payment_slip', ref: 'PAY-1', date: TODAY, doc: { name: 's.pdf', data: PDF('inv') } })).rejects.toThrow(/already given/);
    await t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'payment_slip', ref: 'PAY-1', date: TODAY, doc: { name: 's.pdf', data: PDF('slip') } });
    // The letter needs a finished receipt, the buyer's manager, and not the person who checked the goods in.
    await expect(t.act(SASA_GM, { kind: 'move.acknowledge', movementId: m.id, ref: 'ACK-1', date: TODAY, signedBy: 'GM (mock)' })).rejects.toThrow(/Check every item first/);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: items[2].id, result: 'damaged', note: 'Torn' }] });
    await expect(t.act(SASA_CM, { kind: 'move.acknowledge', movementId: m.id, ref: 'ACK-1', date: TODAY, signedBy: 'CM (mock)' })).rejects.toThrow(/checked the goods in/);
    await expect(t.act(STORE, { kind: 'move.acknowledge', movementId: m.id, ref: 'ACK-1', date: TODAY, signedBy: 'Seller (mock)' })).rejects.toThrow(/manager/);
    const out = (await t.act(SASA_GM, { kind: 'move.acknowledge', movementId: m.id, ref: 'ACK-1', date: TODAY, signedBy: 'GM (mock)' })) as ItemMovement;
    const letter = out.papers!.find((p) => p.kind === 'acknowledgement')!.letter!;
    expect([letter.received, letter.damaged]).toEqual([2, 1]);
    expect(letter.text).toMatch(/not acknowledged/);
    // Seller and buyer can open the scanned papers; another company cannot.
    const docId = out.papers!.find((p) => p.kind === 'invoice')!.docId!;
    expect((await t.svc.items.paperDocument(await t.svc.user(SASA_CM), docId)).mime).toBe('application/pdf');
    await expect(t.svc.items.paperDocument(await t.svc.user('u-cm-arsh'), docId)).rejects.toThrow();
    await own();
    const after = (await t.store.get('physicalItems', items[0].id))!;
    expect(after.ownerPartyId).toBe('co-sasa');
    // Only the received units change owner; the damaged one stays with its case and with the seller.
    expect((await t.store.get('physicalItems', items[2].id))!.ownerPartyId).toBe('goodwill');
    await expect(t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'invoice', ref: 'INV-3', date: TODAY, doc: { name: 'i3.pdf', data: PDF('i3') }, reason: 'Late copy' })).rejects.toThrow(/already passed/);
  });

  it('after-sale care: seller and buyer both watch health, service dates and life; the seller services sold units', async () => {
    const t = fresh();
    t.ds.grants = t.ds.grants.filter((g) => g.userId !== STORE);
    const items = await registerShirts(t, 2);
    const m = await saleOf(t, items);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: items.map((i) => ({ itemId: i.id, result: 'received' as const })) });
    await salePapers(t, m.id);
    await t.act(FD, { kind: 'move.ownership', movementId: m.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' });
    // No interval or life is assumed: "not set" until a manager enters one with its source.
    let care = (await t.board(SASA_CM)).care.find((c) => c.itemId === items[0].id)!;
    expect(care.status).toBe('not_set');
    expect(care.seller).toBe('goodwill');
    await expect(t.act(SASA_CM, { kind: 'sku.care', skuId: 'sku-shirt-l', everyDays: 90, lifeMonths: 24, reason: 'Company tries' })).rejects.toThrow(/manager of the Goodwill/);
    await expect(t.act(PROC, { kind: 'sku.care', skuId: 'sku-shirt-l', everyDays: 0, lifeMonths: 24, reason: 'Maker manual (mock)' })).rejects.toThrow(/whole number/);
    await expect(t.act(PROC, { kind: 'sku.care', skuId: 'sku-shirt-l', everyDays: 90, lifeMonths: 24, reason: '' })).rejects.toThrow(/where the figure comes from/);
    await t.act(PROC, { kind: 'sku.care', skuId: 'sku-shirt-l', everyDays: 1, lifeMonths: 24, reason: 'Test interval (mock)' });
    // Both companies see the same unit on their care list.
    care = (await t.board(SASA_CM)).care.find((c) => c.itemId === items[0].id)!;
    expect(care.nextDue).toBeTruthy();
    expect(care.lifeEnds).toBeTruthy();
    expect((await t.board(STORE)).care.some((c) => c.itemId === items[0].id)).toBe(true);
    expect((await t.board('u-cm-arsh')).care.some((c) => c.itemId === items[0].id)).toBe(false);
    // The buyer asks for service; the seller's store answers with a service check.
    const req = (await t.act(SASA_CM, { kind: 'service.request', label: items[0].token, note: 'Zip stuck, please check' })) as { ref: string; partyId: string };
    expect(req.partyId).toBe('goodwill');
    await expect(t.act(SASA_CM, { kind: 'service.request', label: items[0].token, note: 'Asked again' })).rejects.toThrow(/already open/);
    expect((await t.board(SASA_CM)).care.find((c) => c.itemId === items[0].id)!.openServiceRequest).toBe(req.ref);
    await t.act(STORE, { kind: 'item.service', label: items[0].token, condition: 'worn', note: 'Zip replaced, seams fine' });
    const after = (await t.board(SASA_CM)).care.find((c) => c.itemId === items[0].id)!;
    expect(after.condition).toBe('worn');
    expect(after.services).toBe(1);
    expect(after.openServiceRequest).toBeNull();
    const ev = (await t.svc.items.resolve(await t.svc.user(SASA_CM), items[0].token)).events.find((e) => e.kind === 'service')!;
    expect(ev.note).toBe('(private note)');
    // Servicing never moves the unit or changes the owner; the seller still cannot hand it over.
    const unit = (await t.store.get('physicalItems', items[0].id))!;
    expect([unit.ownerPartyId, unit.custody.partyId]).toEqual(['co-sasa', 'co-sasa']);
    await expect(t.act(STORE, { kind: 'issue', label: items[0].token, personId: t.ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active')!.id })).rejects.toThrow();
    // A damaged result opens a case for the company holding it.
    await t.act(STORE, { kind: 'item.service', label: items[1].token, condition: 'damaged', note: 'Sleeve torn at service visit' });
    const cases = await t.store.list('itemCases', { itemId: items[1].id });
    expect(cases.find((c) => c.kind === 'damaged')!.partyId).toBe('co-sasa');
    // Another company cannot service or ask for service.
    await expect(t.act('u-cm-arsh', { kind: 'item.service', label: items[0].token, condition: 'good', note: 'Not ours to check' })).rejects.toThrow();
  });
  it('uniform allowance: at most 3 pieces a year per guard, usually one every 6 months, early pieces need a reason', async () => {
    const t = fresh();
    const items = await registerShirts(t, 4);
    const m = await saleOf(t, items);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: items.map((i) => ({ itemId: i.id, result: 'received' as const })) });
    await salePapers(t, m.id);
    await t.act(FD, { kind: 'move.ownership', movementId: m.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' });
    const busy = new Set((await t.store.list('itemEvents')).filter((e) => e.to?.kind === 'person').map((e) => e.to!.ref));
    const g = t.ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && !busy.has(p.id))!;
    const row = async () => (await t.board(SASA_CM)).uniforms.rows.find((r) => r.personId === g.id)!;
    let r = await row();
    expect([r.pieces, r.status, r.belowMin]).toEqual([0, 'due', true]);
    expect((await t.board(SASA_CM)).uniforms.rule).toMatchObject({ minPerYear: 2, maxPerYear: 3, everyMonths: 6 });
    await t.act(SASA_CM, { kind: 'issue', label: items[0].token, personId: g.id });
    r = await row();
    expect([r.pieces, r.status, r.last, r.nextDue]).toEqual([1, 'ok', TODAY, '2027-05-06']);
    // A second piece before 6 months is allowed only with a reason; the reason is kept in the audit trail.
    await expect(t.act(SASA_CM, { kind: 'issue', label: items[1].token, personId: g.id })).rejects.toThrow(/reason to hand one over early/);
    await t.act(SASA_CM, { kind: 'issue', label: items[1].token, personId: g.id, reason: 'Shirt torn on duty (test)' });
    expect(t.ds.audit.some((x) => x.action === 'item.issue' && /piece 2 of 3 free.*Shirt torn on duty/.test(x.summary))).toBe(true);
    await t.act(SASA_CM, { kind: 'issue', label: items[2].token, personId: g.id, reason: 'Second post needs a spare (test)' });
    // A fourth piece in 12 months is refused, reason or not.
    await expect(t.act(SASA_CM, { kind: 'issue', label: items[3].token, personId: g.id, reason: 'Asked for one more (test)' })).rejects.toThrow(/most is 3.*paid by the guard/);
    r = await row();
    expect([r.pieces, r.status, r.belowMin]).toEqual([3, 'at_max', false]);
    // Pieces older than 12 months no longer count.
    for (const e of t.ds.itemEvents) if (e.kind === 'issue' && e.to?.ref === g.id && e.itemId !== items[2].id) e.at = myt('2025-10-01', '10:00');
    r = await row();
    expect([r.pieces, r.status]).toEqual([1, 'ok']);
    await t.act(SASA_CM, { kind: 'issue', label: items[3].token, personId: g.id, reason: 'Size changed (test)' });
    // A guard sees their own count; another company sees none of Sasa's guards.
    expect((await t.board(GUARD)).myUniform).toMatchObject({ pieces: 1, rule: { maxPerYear: 3 } });
    expect((await t.board('u-cm-arsh')).uniforms.rows.some((x) => x.companyId === 'co-sasa')).toBe(false);
  });
  it('uniform: a 4th and 5th piece only when the guard pays, with the receipt; never more than 5', async () => {
    const t = fresh();
    const items = await registerShirts(t, 6);
    const m = await saleOf(t, items);
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: items.map((i) => ({ itemId: i.id, result: 'received' as const })) });
    await salePapers(t, m.id);
    await t.act(FD, { kind: 'move.ownership', movementId: m.id, effectiveOn: TODAY, basis: 'Sale terms clause 4' });
    const busy = new Set((await t.store.list('itemEvents')).filter((e) => e.to?.kind === 'person').map((e) => e.to!.ref));
    const g = t.ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && !busy.has(p.id))!;
    const paid = { receiptRef: 'RC-MOCK-01', amount: 45 };
    await expect(t.act(SASA_CM, { kind: 'issue', label: items[0].token, personId: g.id, paidByGuard: paid })).rejects.toThrow(/company pays for this one/);
    await t.act(SASA_CM, { kind: 'issue', label: items[0].token, personId: g.id });
    await t.act(SASA_CM, { kind: 'issue', label: items[1].token, personId: g.id, reason: 'Torn (test)' });
    await t.act(SASA_CM, { kind: 'issue', label: items[2].token, personId: g.id, reason: 'Spare (test)' });
    await expect(t.act(SASA_CM, { kind: 'issue', label: items[3].token, personId: g.id, paidByGuard: { receiptRef: 'R', amount: 45 } })).rejects.toThrow(/receipt number/);
    await expect(t.act(SASA_CM, { kind: 'issue', label: items[3].token, personId: g.id, paidByGuard: { receiptRef: 'RC-MOCK-01', amount: 0 } })).rejects.toThrow(/receipt number/);
    await t.act(SASA_CM, { kind: 'issue', label: items[3].token, personId: g.id, paidByGuard: paid });
    await t.act(SASA_CM, { kind: 'issue', label: items[4].token, personId: g.id, paidByGuard: { receiptRef: 'RC-MOCK-02', amount: 45 } });
    await expect(t.act(SASA_CM, { kind: 'issue', label: items[5].token, personId: g.id, paidByGuard: { receiptRef: 'RC-MOCK-03', amount: 45 } })).rejects.toThrow(/most is 5/);
    const recs = t.ds.uniformRecords.filter((r) => r.personId === g.id);
    expect(recs.map((r) => [r.kind, r.receiptRef, r.amount])).toEqual([['paid', 'RC-MOCK-01', 45], ['paid', 'RC-MOCK-02', 45]]);
    expect(t.ds.audit.some((x) => x.action === 'item.issue' && /paid by the guard: receipt RC-MOCK-01, RM45.00. Not taken from pay/.test(x.summary))).toBe(true);
    expect(t.ds.audit.filter((x) => x.action === 'item.issue' && /paid by the guard/.test(x.summary)).every((x) => !/Never charged/.test(x.summary))).toBe(true);
    const r = (await t.board(SASA_CM)).uniforms.rows.find((x) => x.personId === g.id)!;
    expect([r.free, r.paid, r.pieces, r.status]).toEqual([3, 2, 5, 'at_max']);
  });

  it('uniform: a manager records past pieces in bulk for a site, zone or region; each guard is checked on its own', async () => {
    const t = fresh();
    let rows = (await t.board(SASA_CM)).uniforms.rows;
    const zoned = rows.find((r) => r.zone)!;
    const inZone = rows.filter((r) => r.zone === zoned.zone);
    const base = { kind: 'uniform.past' as const, companyId: 'co-sasa', on: '2026-08-01', pieces: 1, reason: 'Store issue book, Aug 2026 (mock)' };
    // Only the company's manager; not another company, not a future date, not without a source.
    await expect(t.act('u-cm-arsh', { ...base, scope: { kind: 'zone', id: zoned.zone! } })).rejects.toThrow(/manager/);
    await expect(t.act(SASA_CM, { ...base, on: '2026-12-01', scope: { kind: 'zone', id: zoned.zone! } })).rejects.toThrow(/future/);
    await expect(t.act(SASA_CM, { ...base, reason: '', scope: { kind: 'zone', id: zoned.zone! } })).rejects.toThrow(/where this comes from/);
    await expect(t.act(SASA_CM, { ...base, pieces: 4, scope: { kind: 'zone', id: zoned.zone! } })).rejects.toThrow(/1 to 3/);
    const out = (await t.act(SASA_CM, { ...base, scope: { kind: 'zone', id: zoned.zone! } })) as { recorded: number; skipped: unknown[] };
    expect(out.recorded + out.skipped.length).toBe(inZone.length);
    expect(out.recorded).toBeGreaterThan(0);
    rows = (await t.board(SASA_CM)).uniforms.rows;
    const after = rows.find((r) => r.personId === zoned.personId)!;
    expect(after.last === '2026-08-01' || after.last! > '2026-08-01').toBe(true);
    // The same entry again is skipped for everyone, never doubled.
    const again = (await t.act(SASA_CM, { ...base, scope: { kind: 'zone', id: zoned.zone! } })) as { recorded: number; skipped: { why: string }[] };
    expect(again.recorded).toBe(0);
    expect(again.skipped.every((x) => /already has past pieces|more than 3/.test(x.why))).toBe(true);
    // A guard who would go over 3 free pieces is skipped, not capped silently.
    const one = rows.find((r) => r.free === 1)!;
    const over = (await t.act(SASA_CM, { ...base, on: '2026-09-01', pieces: 3, scope: { kind: 'person', id: one.staffNo } })) as { recorded: number; skipped: { why: string }[] };
    expect([over.recorded, over.skipped[0].why]).toEqual([0, 'would have 4 free pieces, more than 3']);
    // Region and site work the same way.
    const regional = rows.find((r) => r.regionId)!;
    const reg = (await t.act(SASA_CM, { ...base, on: '2026-07-01', scope: { kind: 'region', id: regional.regionId! } })) as { recorded: number; scope: string };
    expect(reg.scope).toMatch(/^Region /);
    const sited = rows.find((r) => r.siteId);
    if (sited) {
      const st = (await t.act(SASA_CM, { ...base, on: '2026-06-01', scope: { kind: 'site', id: sited.siteId! } })) as { recorded: number; skipped: unknown[]; scope: string };
      expect(st.scope).toMatch(/^Site /);
      expect(st.recorded + st.skipped.length).toBe(rows.filter((r) => r.siteId === sited.siteId).length);
    }
    expect(t.ds.audit.some((x) => x.action === 'item.uniform.past')).toBe(true);
  });
});

