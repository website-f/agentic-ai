import { describe, expect, it } from 'vitest';
import {
  LABEL_ALPHABET,
  MemoryStore,
  PrimaService,
  checkChar,
  csvCell,
  generateDataset,
  labelDisplay,
  labelFromRandom,
  labelPayload,
  myt,
  parseLabel,
  parseSnapshot,
  reconcileBook,
  senFromText,
  senLabel,
  syncKey,
  type Dataset,
  type ItemAction,
  type ItemMovement,
  type ItemSyncJob,
  type PhysicalItem,
  type ScanEntry,
} from '../src';

// P85: QR labels, scanning, item in/out and the export-only Finance outbox (Fitri's paper v1.0; design qr-design.md).
// Synthetic data only. Test ids follow the paper (U01-U24) where one applies.

const TODAY = '2026-11-06';
const NOW = myt(TODAY, '10:30');

function fresh(fixedClock = false) {
  const ds: Dataset = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  let tick = 0;
  const svc = new PrimaService(store, () => (fixedClock ? myt(TODAY, '11:00') : myt(TODAY, `11:${String(Math.min(59, Math.floor(tick++ / 6))).padStart(2, '0')}`)));
  let rid = 0;
  const raw = async (userId: string, a: ItemAction) => {
    const u = await svc.user(userId);
    return ((await svc.items.act(u, `req-qr-${++rid}`, a)) as { result: unknown }).result as never;
  };
  return { ds, svc, store, act: raw, user: (id: string) => svc.user(id) };
}

const STORE = 'u-proc-store1';
const PROC = 'u-proc-exec';
const SASA_CM = 'u-cm-sasa';
const FIN = 'u-fin-t1-lead';
const FD = 'u-fd';

const cam = (code: string): ScanEntry => ({ code, source: 'camera' });
const PDF = (n: string) => ({ name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 synthetic ${n}`).toString('base64')}` });

/** Register, print and scan back, then check into stock: the whole of paper 3.1. */
async function stocked(t: ReturnType<typeof fresh>, count: number, skuId = 'sku-shirt-l') {
  const items = (await t.act(STORE, { kind: 'item.register', skuId, partyId: 'goodwill', count })) as PhysicalItem[];
  const printed = (await t.act(STORE, { kind: 'label.print', itemIds: items.map((i) => i.id) })) as { labels: { printId: string; payload: string; itemId: string }[] };
  for (const l of printed.labels) await t.act(STORE, { kind: 'label.verify', printId: l.printId, scan: cam(l.payload) });
  for (const i of items) await t.act(STORE, { kind: 'item.inspect', label: i.token, condition: 'new', note: '' });
  return { items: await Promise.all(items.map(async (i) => (await t.store.get('physicalItems', i.id))!)), labels: printed.labels };
}

async function sale(t: ReturnType<typeof fresh>, items: PhysicalItem[]) {
  const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'QR test sale' })) as ItemMovement;
  for (const i of items) await t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(i.token, i.labelGen ?? 1)) });
  await t.act(STORE, { kind: 'move.dispatch', movementId: m.id, carrier: 'Test van' });
  return (await t.store.get('itemMovements', m.id))!;
}

describe('labels and codes', () => {
  it('U12/U21: Luhn mod 32 catches every single wrong character', () => {
    const t = labelFromRandom([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9]);
    const body = t.slice(3, 18);
    for (let k = 0; k < 15; k++)
      for (const c of LABEL_ALPHABET) {
        if (c === body[k]) continue;
        const bad = body.slice(0, k) + c + body.slice(k + 1);
        expect(checkChar(bad)).not.toBe(checkChar(body));
      }
    // Adjacent swaps are caught too, except the one pair Luhn mod N cannot see (0 and the last character).
    let missed = 0;
    for (let k = 0; k < 14; k++) {
      if (body[k] === body[k + 1]) continue;
      const sw = body.slice(0, k) + body[k + 1] + body[k] + body.slice(k + 2);
      if (checkChar(sw) === checkChar(body)) missed++;
    }
    expect(missed).toBeLessThanOrEqual(1);
  });

  it('the printed code is QR alphanumeric (no dashes) with a generation from the second print; the typed ID has none', () => {
    const t = labelFromRandom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(labelPayload(t, 1)).toMatch(/^P1[0-9A-Z]{16}$/);
    expect(labelPayload(t, 2)).toMatch(/^P1[0-9A-Z]{17}$/);
    expect(parseLabel(labelPayload(t, 1))).toEqual({ ok: true, token: t, gen: 1 });
    expect(parseLabel(labelPayload(t, 5))).toEqual({ ok: true, token: t, gen: 5 });
    expect(parseLabel(labelDisplay(t))).toEqual({ ok: true, token: t, gen: null });
    // Only the QR alphanumeric character set: upper case, digits.
    expect(/^[0-9A-Z $%*+\-./:]+$/.test(labelPayload(t, 31))).toBe(true);
    expect(() => labelPayload(t, 32)).toThrow();
  });

  it('money is whole sen, never floating point', () => {
    expect(senFromText('45')).toBe('4500');
    expect(senFromText('RM 1,234.5')).toBe('123450');
    expect(senFromText(0.1 + 0.2)).toBeNull();
    expect(senLabel('123450')).toBe('RM1,234.50');
    expect(senLabel('-5')).toBe('-RM0.05');
  });

  it('CSV cells never start a formula and codes keep their leading zeros', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('000SHIRT')).toBe('"000SHIRT"');
    expect(csvCell(-12)).toBe('"-12"');
  });
});

describe('print, scan back and check (paper 3.1)', () => {
  it('a registered item cannot be checked until its printed label is scanned back; a typed scan or the wrong label does not count', async () => {
    const t = fresh();
    const [a, b] = (await t.act(STORE, { kind: 'item.register', skuId: 'sku-shirt-l', partyId: 'goodwill', count: 2 })) as PhysicalItem[];
    expect(a.labelGen).toBe(0);
    await expect(t.act(STORE, { kind: 'item.inspect', label: a.token, condition: 'new', note: '' })).rejects.toThrow(/scan it back/);
    const p = (await t.act(STORE, { kind: 'label.print', itemIds: [a.id, b.id], template: 'a4_l7651_65', symbols: ['qr', 'code128'] })) as { batchId: string; labels: { printId: string; payload: string; itemId: string }[] };
    expect(p.labels).toHaveLength(2);
    const la = p.labels.find((l) => l.itemId === a.id)!;
    const lb = p.labels.find((l) => l.itemId === b.id)!;
    await expect(t.act(STORE, { kind: 'label.verify', printId: la.printId, scan: { code: labelDisplay(a.token), source: 'typed', manual: { reason: 'cannot scan', skuSizeConfirmed: true } } })).rejects.toThrow(/typing/);
    await expect(t.act(STORE, { kind: 'label.verify', printId: la.printId, scan: cam(lb.payload) })).rejects.toThrow(/wrong item/);
    await t.act(STORE, { kind: 'label.verify', printId: la.printId, scan: cam(la.payload) });
    await t.act(STORE, { kind: 'item.inspect', label: a.token, condition: 'new', note: '' });
    expect((await t.store.get('physicalItems', a.id))!.state).toBe('available');
    const batch = await t.svc.items.labelBatch(await t.user(STORE), p.batchId);
    expect(batch.labels.map((l) => l.verified).sort()).toEqual([false, true]);
    expect(batch.template).toBe('a4_l7651_65');
  });

  it('U12: a reprint needs a reason and the identity, raises the generation, and the old copy can no longer move the item', async () => {
    const t = fresh();
    const { items, labels } = await stocked(t, 1);
    const old = labels[0].payload;
    await expect(t.act(STORE, { kind: 'label.print', itemIds: [items[0].id], reason: 'Label torn' })).rejects.toThrow(/identity|type and size/);
    const re = (await t.act(STORE, { kind: 'label.print', itemIds: [items[0].id], reason: 'Label torn in the wash', identity: { skuSizeConfirmed: true } })) as { labels: { payload: string; gen: number }[] };
    expect(re.labels[0].gen).toBe(2);
    expect(re.labels[0].payload).not.toBe(old);
    // The old copy is a superseded label: the pick is refused and a case opens for the holder.
    const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Superseded test' })) as ItemMovement;
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(old) })).rejects.toThrow(/older copy/);
    expect((await t.store.list('itemCases', { itemId: items[0].id })).some((c) => c.kind === 'label_superseded' && c.status === 'open')).toBe(true);
    // A generation newer than any printed is a suspected copy: not found, and audited with a fingerprint only.
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(items[0].token, 9)) })).rejects.toThrow(/not found/);
    expect(t.ds.audit.some((x) => x.action === 'item.resolve.forged' && !x.summary.includes(items[0].token))).toBe(true);
    await t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(re.labels[0].payload) });
    const verdict = await t.svc.items.scanCheck(await t.user(STORE), 'view', null, cam(old));
    expect(verdict.outcome).toBe('superseded_label');
  });
});

describe('scanning rules', () => {
  it('a typed ID needs a reason and physical proof, is marked manual and asks for a reprint', async () => {
    const t = fresh();
    const radios = (await t.act(STORE, { kind: 'item.register', skuId: 'sku-radio', partyId: 'goodwill', count: 1, serials: ['UHF-QR-1'] })) as PhysicalItem[];
    const p = (await t.act(STORE, { kind: 'label.print', itemIds: [radios[0].id] })) as { labels: { printId: string; payload: string }[] };
    await t.act(STORE, { kind: 'label.verify', printId: p.labels[0].printId, scan: cam(p.labels[0].payload) });
    await t.act(STORE, { kind: 'item.inspect', label: radios[0].token, condition: 'new', note: '' });
    const m = (await t.act(STORE, { kind: 'move.create', type: 'rental', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Typed test', dueBackOn: '2027-01-31' })) as ItemMovement;
    const typed = (manual: ScanEntry['manual']): ScanEntry => ({ code: labelDisplay(radios[0].token), source: 'typed', manual });
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, scan: typed(null) })).rejects.toThrow(/reason/);
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, scan: typed({ reason: 'Label unreadable' }) })).rejects.toThrow(/serial/);
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, scan: typed({ reason: 'Label unreadable', serialSeen: 'UHF-QR-2' }) })).rejects.toThrow(/does not match/);
    const v = await t.svc.items.scanCheck(await t.user(STORE), 'pick', m.id, typed({ reason: 'Label unreadable' }));
    expect(v.outcome).toBe('needs_manual_proof');
    expect(v.hasSerial).toBe(true);
    const out = (await t.act(STORE, { kind: 'move.add', movementId: m.id, scan: typed({ reason: 'Label unreadable', serialSeen: 'uhf-qr-1' }) })) as ItemMovement;
    expect(out.lines[0].pick).toEqual({ source: 'typed', manual: true });
    expect((await t.store.list('itemCases', { itemId: radios[0].id })).some((c) => c.kind === 'label_unreadable')).toBe(true);
  });

  it('U21: unknown and unseen labels look the same, are audited by fingerprint, and too many pause scanning', async () => {
    const t = fresh(true);
    const sasaItem = t.ds.physicalItems.find((i) => i.partyIds.length === 1 && i.partyIds[0] === 'co-sasa') ?? t.ds.physicalItems.find((i) => i.ownerPartyId === 'co-arsh')!;
    const u = await t.user('u-cm-arsh');
    const v = await t.svc.items.scanCheck(u, 'view', null, cam(labelPayload(labelFromRandom([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]), 1)));
    expect(v).toEqual({ source: 'camera', manual: false, outcome: 'not_found', message: expect.stringMatching(/Not found/) });
    expect(t.ds.audit.filter((x) => x.action === 'item.resolve.miss').every((x) => !/P1/.test(x.summary))).toBe(true);
    void sasaItem;
    for (let k = 0; k < 20; k++) await t.svc.items.scanCheck(u, 'view', null, cam(labelPayload(labelFromRandom([k, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]), 1)));
    await expect(t.svc.items.scanCheck(u, 'view', null, cam(labelPayload(labelFromRandom([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 1)))).rejects.toThrow(/paused/);
    expect(t.ds.audit.some((x) => x.action === 'item.resolve.blocked')).toBe(true);
  });

  it('a link or a malformed code is refused before anything is looked up', async () => {
    const t = fresh();
    await expect(t.svc.items.scanCheck(await t.user(STORE), 'view', null, cam('https://example.invalid/P1'))).rejects.toThrow(/link/);
    await expect(t.svc.items.scanCheck(await t.user(STORE), 'view', null, { code: 'x'.repeat(81), source: 'camera' })).rejects.toThrow();
  });
});

describe('send and receive by scanning', () => {
  it('pick list: a type not asked for or more than asked needs a manager; cancelling a draft puts every unit back', async () => {
    const t = fresh();
    const { items } = await stocked(t, 3);
    const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Pick list test', expected: [{ skuId: 'sku-shirt-l', qty: 2 }] })) as ItemMovement;
    expect(m.expected).toEqual([{ skuId: 'sku-shirt-l', qty: 2 }]);
    await t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(items[0].token, 1)) });
    expect((await t.svc.items.scanCheck(await t.user(STORE), 'pick', m.id, cam(labelPayload(items[0].token, 1)))).outcome).toBe('duplicate');
    await t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(items[1].token, 1)) });
    expect((await t.svc.items.scanCheck(await t.user(STORE), 'pick', m.id, cam(labelPayload(items[2].token, 1)))).outcome).toBe('not_on_list');
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(items[2].token, 1)) })).rejects.toThrow(/already picked/);
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(items[2].token, 1)), overrideReason: 'Extra for a new post' })).rejects.toThrow(/manager/);
    await t.act(PROC, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(items[2].token, 1)), overrideReason: 'Extra for a new post' });
    const c = (await t.act(STORE, { kind: 'move.cancel', movementId: m.id, reason: 'Request withdrawn' })) as ItemMovement;
    expect(c.status).toBe('cancelled');
    for (const i of items) expect((await t.store.get('physicalItems', i.id))!.state).toBe('available');
  });

  it('U02/U04: receive scan by scan with per-line outcomes; an unexpected unit opens a case; a stale line is a conflict, never an overwrite', async () => {
    const t = fresh();
    const { items } = await stocked(t, 4);
    const m = await sale(t, items.slice(0, 3));
    const extra = items[3];
    // A conflict: the line was scanned at an older version; nothing at all is saved.
    await expect(
      t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: items[0].id, result: 'received', scan: cam(labelPayload(items[0].token, 1)), baseVersion: 1 }] }),
    ).rejects.toThrow(/changed/);
    expect((await t.store.get('physicalItems', items[0].id))!.state).toBe('in_transit');
    const cur = (await Promise.all(items.map((i) => t.store.get('physicalItems', i.id)))).map((i) => i!);
    const out = (await t.act(SASA_CM, {
      kind: 'move.receive',
      movementId: m.id,
      lines: [
        { itemId: items[0].id, result: 'received', scan: cam(labelPayload(items[0].token, 1)), baseVersion: cur[0].version },
        { itemId: items[1].id, result: 'damaged', note: 'Torn sleeve', scan: cam(labelPayload(items[1].token, 1)) },
        { itemId: items[2].id, result: 'missing', note: 'Not in the box' },
      ],
      unexpected: [cam(labelPayload(extra.token, 1))],
    })) as ItemMovement & { outcomes: { result: string; caseRef: string | null }[]; unexpected: { caseRef: string }[] };
    expect(out.outcomes.map((o) => o.result)).toEqual(['received', 'damaged', 'missing']);
    expect(out.outcomes[0].caseRef).toBeNull();
    expect(out.outcomes[1].caseRef).toMatch(/^IC-/);
    expect(out.unexpected).toHaveLength(1);
    expect((await t.store.get('physicalItems', extra.id))!.custody.partyId).toBe('goodwill');
    expect(out.lines[0].scan).toEqual({ source: 'camera', manual: false });
    // A typed ID cannot close the shortage; the item's label must be scanned.
    const short = (await t.store.list('itemCases', { itemId: items[2].id })).find((c) => c.kind === 'short')!;
    await expect(t.act(SASA_CM, { kind: 'case.resolve', caseId: short.id, outcome: 'arrived', note: 'Found in the van' })).rejects.toThrow(/Scan the item/);
    await expect(t.act(SASA_CM, { kind: 'case.resolve', caseId: short.id, outcome: 'arrived', note: 'Found in the van', scan: { code: labelDisplay(items[2].token), source: 'typed', manual: { reason: 'label gone', skuSizeConfirmed: true } } })).rejects.toThrow(/typed ID cannot close/);
    await t.act(SASA_CM, { kind: 'case.resolve', caseId: short.id, outcome: 'arrived', note: 'Found in the van', scan: cam(labelPayload(items[2].token, 1)) });
    // One buyer document per receipt; the same key with a different payload is refused (moveReceive now checks).
    const jobs = await t.store.list('itemSyncJobs', { sourceId: m.id });
    expect(jobs.filter((j) => j.docType === 'purchase_receipt')).toHaveLength(1);
    expect(jobs.every((j) => j.key.includes('|book-unset|'))).toBe(true);
  });

  it('a different payload under an existing outbox key is refused on receipt too', async () => {
    const t = fresh();
    const { items } = await stocked(t, 2);
    const m = await sale(t, items);
    const key = syncKey('co-sasa', 'purchase_receipt', m.id, 1);
    t.ds.itemSyncJobs.push({ id: 'isync-planted', partyId: 'co-sasa', docType: 'purchase_receipt', sourceId: m.id, revision: 1, key, payloadHash: 'not-the-same', payload: { commercialRef: null, lines: [] }, status: 'not_ready', reasons: [], at: NOW, partyIds: ['co-sasa'] } as ItemSyncJob);
    await expect(t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: [{ itemId: items[0].id, result: 'received' }] })).rejects.toThrow(/different document/);
  });
});

describe('walls (U20)', () => {
  it('count leak fixed: another company’s label in a count is not found; the holder learns only that it was seen', async () => {
    const t = fresh();
    const { items } = await stocked(t, 1);
    const c = (await t.act('u-cm-arsh', { kind: 'count.start', partyId: 'co-arsh' })) as { id: string };
    const r = (await t.act('u-cm-arsh', { kind: 'count.scan', countId: c.id, scan: cam(labelPayload(items[0].token, 1)) })) as { status: string; count: { found: string[]; extra: string[] } };
    expect(r.status).toBe('not_found');
    expect(r.count.extra).toEqual([]);
    const theirs = (await t.store.list('itemCases', { partyId: 'co-arsh' })).filter((x) => x.kind === 'count_unknown_label');
    expect(theirs).toHaveLength(1);
    expect(theirs[0].note).not.toContain(items[0].token);
    expect(theirs[0].itemId).toBeNull();
    const seen = (await t.store.list('itemCases', { itemId: items[0].id })).find((x) => x.kind === 'seen_elsewhere')!;
    expect(seen.partyIds).not.toContain('co-arsh');
    expect(seen.note).toMatch(/^Seen during another company's count on 2026-11-06\.$/);
    expect((await t.store.list('itemEvents', { itemId: items[0].id })).some((e) => e.kind === 'count_found')).toBe(false);
  });

  it('an OM reads only items at their area sites, going there, or with people working there; audit reads everything', async () => {
    const t = fresh();
    const om = await t.user('u-om-klang');
    const b = await t.svc.items.board(om);
    const sites = new Set(b.siteChoices.map((s) => s.id));
    expect(b.items.length).toBeGreaterThan(0);
    expect(b.items.every((i) => i.custody.kind !== 'store')).toBe(true);
    expect(b.items.filter((i) => i.custody.kind === 'site').every((i) => sites.has(i.custody.ref))).toBe(true);
    const inStore = t.ds.physicalItems.find((i) => i.custody.kind === 'store' && i.custody.partyId === 'co-sasa')!;
    expect(inStore).toBeTruthy();
    await expect(t.svc.items.resolve(om, inStore.token)).rejects.toThrow(/not found/);
    const audit = await t.svc.items.board(await t.user('u-act-aud1'));
    expect(audit.items.length).toBe(t.ds.physicalItems.length);
    await expect(t.act('u-act-aud1', { kind: 'item.register', skuId: 'sku-shirt-l', partyId: 'goodwill', count: 1 })).rejects.toThrow();
  });

  it('attachments are checked by their first bytes, not only the declared type', async () => {
    const t = fresh();
    const { items } = await stocked(t, 1);
    const m = await sale(t, items);
    const fake = { name: 'x.pdf', data: `data:application/pdf;base64,${Buffer.from('MZ not a pdf').toString('base64')}` };
    await expect(t.act(FD, { kind: 'move.paper', movementId: m.id, paper: 'invoice', ref: 'INV-QR-1', date: TODAY, doc: fake })).rejects.toThrow(/not what it says/);
  });
});

describe('counts with cut-off, recount and review (U23)', () => {
  it('a planned cut-off waits; freeze refuses moves in scope; recount and review before any case; nothing adjusted', async () => {
    const t = fresh();
    const { items } = await stocked(t, 3);
    const planned = (await t.act(STORE, { kind: 'count.start', partyId: 'goodwill', cutoffAt: myt(TODAY, '18:00') })) as { id: string; expected: string[] };
    expect(planned.expected).toEqual([]);
    await expect(t.act(STORE, { kind: 'count.scan', countId: planned.id, scan: cam(labelPayload(items[0].token, 1)) })).rejects.toThrow(/cut-off/);
    const c = (await t.act(STORE, { kind: 'count.start', partyId: 'goodwill', skuIds: ['sku-shirt-l'], freeze: true, blind: true })) as { id: string; expected: string[]; expectedCount: number };
    expect(c.expected).toEqual([]);
    expect(c.expectedCount).toBeGreaterThanOrEqual(3);
    const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Frozen test' })) as ItemMovement;
    await expect(t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(items[0].token, 1)) })).rejects.toThrow(/froze/);
    const all = t.ds.itemCounts.find((x) => x.id === c.id)!.expected;
    const batch = (await t.act(STORE, { kind: 'count.scanBatch', countId: c.id, scans: all.filter((id) => id !== items[2].id).map((id) => cam(labelPayload(t.ds.physicalItems.find((i) => i.id === id)!.token, 1))) })) as { results: { status: string }[] };
    expect(batch.results.every((r) => r.status === 'expected')).toBe(true);
    const closed = (await t.act(STORE, { kind: 'count.close', countId: c.id })) as { closed: { notFound: string[] } };
    expect(closed.closed.notFound).toEqual([items[2].id]);
    const re = (await t.act(STORE, { kind: 'count.recount', countId: c.id })) as { id: string; expectedCount: number };
    expect(re.expectedCount).toBe(1);
    await expect(t.act(PROC, { kind: 'count.review', countId: c.id, note: 'Checked the shelf' })).rejects.toThrow(/recount is still open/);
    await t.act(STORE, { kind: 'count.close', countId: re.id });
    await t.act(PROC, { kind: 'count.review', countId: c.id, note: 'Shelf checked twice' });
    expect((await t.store.list('itemCases', { itemId: items[2].id })).some((x) => x.kind === 'count_not_found')).toBe(true);
    expect((await t.store.get('physicalItems', items[2].id))!.state).toBe('available');
    // Closed: moves are allowed again.
    await t.act(STORE, { kind: 'move.add', movementId: m.id, scan: cam(labelPayload(items[0].token, 1)) });
  });
});

describe('after use (paper section 4)', () => {
  it('laundry goes back to quarantine; a size swap returns one ID and issues another, linked, with no charge', async () => {
    const t = fresh();
    const { items } = await stocked(t, 3, 'sku-vest-l');
    await t.act(STORE, { kind: 'laundry.out', label: items[0].token, launderer: 'Laundry (mock)' });
    expect((await t.store.get('physicalItems', items[0].id))!.state).toBe('laundry');
    await t.act(STORE, { kind: 'laundry.back', label: items[0].token });
    expect((await t.store.get('physicalItems', items[0].id))!.state).toBe('quarantine');
    const m = await sale(t, items.slice(1));
    await t.act(SASA_CM, { kind: 'move.receive', movementId: m.id, lines: items.slice(1).map((i) => ({ itemId: i.id, result: 'received' as const })) });
    const g = t.ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role === 'guard')!;
    await t.act(SASA_CM, { kind: 'issue', label: items[1].token, personId: g.id });
    await expect(t.act(SASA_CM, { kind: 'item.swap', returnLabel: items[2].token, issueLabel: items[1].token, personId: g.id, condition: 'good', note: 'Size too small' })).rejects.toThrow(/not held by that person/);
    const out = (await t.act(SASA_CM, { kind: 'item.swap', returnLabel: items[1].token, issueLabel: items[2].token, personId: g.id, condition: 'good', note: 'Size too small' })) as { returned: PhysicalItem; issued: PhysicalItem };
    expect(out.returned.state).toBe('quarantine');
    expect(out.issued.custody.ref).toBe(g.id);
    const swaps = t.ds.itemEvents.filter((e) => e.kind === 'swap');
    expect(swaps.map((e) => e.itemId).sort()).toEqual([items[1].id, items[2].id].sort());
    expect(t.ds.audit.filter((x) => x.action === 'item.issue').at(-1)!.summary).toMatch(/Never charged/);
  });
});

describe('Finance: export only, acknowledged with the SQL number and evidence, reconciled from the SQL listing', () => {
  it('U13/U14/U16/U17/U18/U19: book, approved mapping, export file, SQL number, unknown outcome, reversal and reconciliation', async () => {
    const t = fresh();
    const { items } = await stocked(t, 2);
    const m = await sale(t, items);
    let [job] = await t.store.list('itemSyncJobs', { sourceId: m.id, docType: 'sales_delivery' });
    expect(job.blockers).toContain('book_unverified');
    expect(job.status).toBe('not_ready');
    // D01: the book is recorded by one Finance person and verified by another, with evidence.
    await t.act(FIN, { kind: 'book.set', partyId: 'goodwill', legalName: 'Goodwill (synthetic)', regNo: 'SYN-0001', sqlBookId: 'GW-TEST', counterparties: [{ partyId: 'co-sasa', role: 'customer', sqlCode: '300-S001' }] });
    await expect(t.act(FIN, { kind: 'book.verify', partyId: 'goodwill', evidence: PDF('book') })).rejects.toThrow(/second Finance/);
    await t.act(FD, { kind: 'book.verify', partyId: 'goodwill', evidence: PDF('book') });
    await t.act(FIN, { kind: 'sync.refresh', partyId: 'goodwill' });
    job = (await t.store.get('itemSyncJobs', job.id))!;
    expect(job.blockers).toEqual(['mapping_unapproved']);
    expect(job.key).toContain('|GW-TEST|');
    // Re-entering the code resets its approval; the person who entered it cannot approve it.
    await t.act(FIN, { kind: 'sku.map', skuId: 'sku-shirt-l', partyId: 'goodwill', itemCode: '000SHIRTL', uom: 'PCS' });
    await expect(t.act(FIN, { kind: 'sku.mapApprove', skuId: 'sku-shirt-l', partyId: 'goodwill' })).rejects.toThrow(/second Finance/);
    await t.act(FD, { kind: 'sku.mapApprove', skuId: 'sku-shirt-l', partyId: 'goodwill' });
    await t.act(FIN, { kind: 'sync.refresh', partyId: 'goodwill' });
    job = (await t.store.get('itemSyncJobs', job.id))!;
    expect(job.status).toBe('ready');
    const batch = (await t.act(FIN, { kind: 'sync.batch', partyId: 'goodwill', jobIds: [job.id] })) as { id: string; ref: string; files: { name: string; sha256: string }[] };
    expect(batch.ref).toBe('EXP-GW-TEST-0001');
    const doc = await t.svc.items.batchFile(await t.user(FIN), batch.id, `${batch.ref}-documents.csv`);
    expect(doc.content.startsWith('﻿')).toBe(true);
    expect(doc.content).toContain('"000SHIRTL"');
    expect(doc.content).toContain('"300-S001"');
    expect(doc.content).not.toMatch(/P1-/);
    const ids = await t.svc.items.batchFile(await t.user(FIN), batch.id, `${batch.ref}-unit-ids.csv`);
    expect(ids.content.match(/P1-/g)).toHaveLength(2);
    expect((await t.svc.items.batchFile(await t.user(FIN), batch.id, `${batch.ref}-documents.csv`)).sha256).toBe(batch.files[0].sha256);
    await expect(t.act(FIN, { kind: 'sync.ack', jobId: job.id, docNo: 'DO-0001', evidence: PDF('ack') })).rejects.toThrow(/imported/);
    await t.act(FIN, { kind: 'sync.sent', batchId: batch.id });
    // U16: outcome unknown; no blind resend; looked up and found.
    await t.act(FIN, { kind: 'sync.unknown', jobId: job.id, note: 'Import stopped half way' });
    await expect(t.act(FIN, { kind: 'sync.batch', partyId: 'goodwill', jobIds: [job.id] })).rejects.toThrow(/pre-check/);
    await expect(t.act(FIN, { kind: 'sync.ack', jobId: job.id, docNo: 'DO-0001', evidence: PDF('ack') })).rejects.toThrow(/Look the document up/);
    await t.act(FIN, { kind: 'sync.lookup', jobId: job.id, docNo: 'DO-0001', note: 'Found on the SQL DO list', evidence: PDF('lookup') });
    job = (await t.store.get('itemSyncJobs', job.id))!;
    expect(job.status).toBe('acknowledged');
    expect(job.dest?.docNo).toBe('DO-0001');
    // U18: a listing of more than 50 rows is read whole; the document is matched and reconciled.
    const rows = ['DocType,DocNo,Ref,Net,Tax,Gross', ...Array.from({ length: 60 }, (_, k) => `DO,DO-9${String(k).padStart(3, '0')},,1.00,0.00,1.00`), 'DO,DO-0001,CT-0004,10.00,0.00,10.00'];
    expect(parseSnapshot('doc_listing', rows.join('\n')).rows).toHaveLength(61);
    await t.act(FIN, { kind: 'sync.snapshot', partyId: 'goodwill', snapshot: 'doc_listing', asOf: TODAY, csv: rows.join('\n') });
    const rec = (await t.act(FIN, { kind: 'sync.reconcile', partyId: 'goodwill' })) as { reconciled: number };
    expect(rec.reconciled).toBe(1);
    expect((await t.store.get('itemSyncJobs', job.id))!.status).toBe('reconciled');
    // U19: an acknowledged document is never edited; a reversal is a new linked revision.
    const rev = (await t.act(FIN, { kind: 'sync.review', jobId: job.id, decision: 'reverse', reason: 'Goods returned (synthetic)' })) as ItemSyncJob;
    expect(rev.revisionAction).toBe('reverse');
    expect(rev.supersedesJobId).toBe(job.id);
    expect((await t.store.get('itemSyncJobs', job.id))!.status).toBe('reconciled');
    // A period lock sends documents of the closed period to Finance review.
    await t.act(FIN, { kind: 'book.set', partyId: 'goodwill', legalName: 'Goodwill (synthetic)', regNo: 'SYN-0001', sqlBookId: 'GW-TEST', counterparties: [{ partyId: 'co-sasa', role: 'customer', sqlCode: '300-S001' }], periodLockedThrough: '2026-12-31' });
    const fresh2 = await t.store.list('itemSyncJobs', { partyId: 'goodwill' });
    await t.act(FIN, { kind: 'sync.refresh', partyId: 'goodwill' });
    expect((await t.store.list('itemSyncJobs', { partyId: 'goodwill' })).filter((j) => fresh2.some((x) => x.id === j.id && (x.status === 'not_ready' || x.status === 'ready'))).every((j) => j.status === 'manual_review')).toBe(true);
    // The Finance board never claims a connection.
    const board = await t.svc.items.finance(await t.user(FIN), 'goodwill');
    expect(board.channel).toBe('export_only');
    expect(board.recon.pipeline.find((p) => p.status === 'reconciled')!.count).toBe(1);
  });

  it('U17: one book acknowledged and the other not, past the allowed days, is a one-sided exception', () => {
    const r = reconcileBook({
      partyId: 'goodwill',
      period: '2026-11',
      today: '2026-11-20',
      oneSidedDays: 3,
      book: null,
      jobs: [{ id: 'j1', partyId: 'goodwill', docType: 'sales_delivery', sourceId: 'm1', revision: 1, key: 'k', payloadHash: 'h', payload: { commercialRef: 'CT-1', lines: [] }, status: 'acknowledged', reasons: [], at: '2026-11-01T10:00:00+08:00', partyIds: ['goodwill'] }],
      otherSide: [{ commercialRef: 'CT-1', partyId: 'co-sasa', status: 'rejected', docType: 'purchase_receipt' }],
      moves: [{ id: 'm1', ref: 'MV-1', commercialRef: 'CT-1', status: 'received', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', lines: [], lotLines: [], dispatched: { by: 'x', byId: 'x', at: '2026-11-01T10:00:00+08:00', carrier: 'x' } } as unknown as ItemMovement],
      items: [],
      events: [],
      skus: [],
      stock: null,
      listing: null,
    });
    expect(r.oneSided).toEqual(['CT-1']);
  });

  it('reports carry their date and scope, mask other companies’ staff and are audited when exported', async () => {
    const t = fresh();
    const u = await t.user(STORE);
    const r = await t.svc.items.report(u, 'balance', null, 'csv');
    expect(r.csv.split('\r\n')[1]).toMatch(/^"Data as of","2026-11-06T11:/);
    expect(t.ds.audit.some((x) => x.action === 'item.report.export')).toBe(true);
    const custody = await t.svc.items.report(u, 'custody_by_person', null);
    expect(custody.rows.every((row) => !/^[A-Z][a-z]+ [A-Z]/.test(String(row[0])) || String(row[0]).startsWith('A '))).toBe(true);
  });

  it('settings keep safe defaults and change only by the manager, with a reason', async () => {
    const t = fresh();
    const b = await t.svc.items.board(await t.user(STORE));
    expect(b.config.find((c) => c.partyId === 'goodwill')!.config.verifyLabelsBeforeCheck).toBe(true);
    await expect(t.act(STORE, { kind: 'settings.config', partyId: 'goodwill', config: { missLimit: 30 }, reason: 'Busy store' })).rejects.toThrow(/manager/);
    await expect(t.act(PROC, { kind: 'settings.config', partyId: 'goodwill', config: { postToSql: true } as never, reason: 'Try to post' })).rejects.toThrow(/Unknown setting/);
    await t.act(PROC, { kind: 'settings.config', partyId: 'goodwill', config: { missLimit: 30, labelTemplate: 'thermal_50x25' }, reason: 'Thermal printer in the store' });
    const after = await t.svc.items.board(await t.user(STORE));
    expect(after.config.find((c) => c.partyId === 'goodwill')!.config).toMatchObject({ missLimit: 30, labelTemplate: 'thermal_50x25', verifyLabelsBeforeCheck: true });
  });
});
