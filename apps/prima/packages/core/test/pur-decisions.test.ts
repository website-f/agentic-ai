import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type StockItem } from '../src';

// Procurement decisions D1 to D5 (Fauzan, 23 Nov 2026: "Yes, all five as recommended"). Synthetic data only.
const TODAY = '2026-11-23'; // a Monday
const NOW = myt(TODAY, '10:00');
let n = 0;
const doc = (what = 'Quote') => {
  n += 1;
  return { kind: 'document' as const, name: `${what} ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${what} ${n}`).toString('base64')}` };
};
const ITEM = 'stk-co-sasa-test-torch';

function setup(clock = { now: NOW }) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const torch: StockItem = { id: ITEM, companyId: 'co-sasa', sku: 'T-001', name: 'Torch', kind: 'EQUIPMENT', size: null, onHand: 2, reorderAt: 5 } as StockItem;
  ds.stockItems.push(torch);
  const svc = new PrimaService(new MemoryStore(ds), () => clock.now);
  return { ds, svc, clock };
}

async function people(svc: PrimaService) {
  return {
    proc: await svc.user('u-proc-exec'),
    im: await svc.user('u-proc-manager'),
    sk: await svc.user('u-proc-store1'),
    coo: await svc.user('u-coo'),
    ceo: await svc.user('u-fauzan'),
    fd: await svc.user('u-fd'),
  };
}

async function quoted(svc: PrimaService, opts: { quotes?: number; online?: number; qty?: number; unitPrice?: number } = {}) {
  const { proc } = await people(svc);
  const qty = opts.qty ?? 10;
  const unitPrice = opts.unitPrice ?? 30;
  const pr = await svc.raisePurRequest(proc, 'co-sasa', { title: 'Synthetic torches', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: ITEM, qty, unitPrice }] });
  for (let k = 1; k <= (opts.quotes ?? 3); k++)
    await svc.purStep(proc, pr.id, 'quote', { supplierId: `sup-co-sasa-${k}`, amount: qty * unitPrice + k * 10, ref: `Q${k}`, proof: [doc()] });
  for (let k = 0; k < (opts.online ?? 1); k++)
    await svc.purStep(proc, pr.id, 'online', { source: 'Shopee', ref: `listing-${k}`, amount: qty * unitPrice + k, proof: [doc('Listing')] });
  return pr;
}

describe('Procurement decisions D1 to D5 (23 Nov 2026)', () => {
  it('D1: the Inventory Manager checks with a comment before the COO, and never their own purchase', async () => {
    const { svc } = setup();
    const { proc, im, coo } = await people(svc);
    const pr = await quoted(svc);
    const sub = await svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-1' });
    expect(sub.tiers).toEqual(['inventory', 'coo', 'ceo']);
    await expect(svc.purStep(coo, pr.id, 'approve', { note: 'ok' })).rejects.toThrow(/cannot approve/);
    await expect(svc.purStep(im, pr.id, 'approve', { note: '' })).rejects.toThrow(/comment|reason/i);
    const board = await svc.purBoard(im);
    const row = board.requests.find((r) => r.req.id === pr.id)!;
    expect(row).toMatchObject({ canApprove: true, nextTier: 'inventory', waiting: 'Inventory Manager to check' });
    expect((await svc.alertItems(im)).some((a) => a.title.includes(pr.ref))).toBe(true);
    const checked = await svc.purStep(im, pr.id, 'approve', { note: 'Store is short; quantity matches usage' });
    expect(checked.approvals[0]).toMatchObject({ tier: 'inventory', byId: im.id });
    expect(checked.status).toBe('awaiting_approval');
    // Raised by the Inventory Manager: no check by themselves; straight to the COO.
    const own = await svc.raisePurRequest(im, 'co-sasa', { title: 'IM own', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: ITEM, qty: 5, unitPrice: 30 }] });
    for (let k = 1; k <= 3; k++) await svc.purStep(proc, own.id, 'quote', { supplierId: `sup-co-sasa-${k}`, amount: 150 + k, ref: `Q${k}`, proof: [doc()] });
    await svc.purStep(proc, own.id, 'online', { source: 'Lazada', ref: 'l', amount: 150, proof: [doc('Listing')] });
    expect((await svc.purStep(proc, own.id, 'submit', { supplierId: 'sup-co-sasa-1' })).tiers).toEqual(['coo', 'ceo']);
  });

  it('D2: a new supplier goes on one group list, Finance checks it once, and every company can quote from it', async () => {
    const { svc, ds } = setup();
    const { proc, fd } = await people(svc);
    const s = await svc.addPurSupplier(proc, 'co-arsh', { name: 'Group Torch Supply (synthetic)', ssmNo: 'SSM-SYN-77', categories: ['GUARD_EQUIPMENT'], bankName: 'Synthetic Bank', bankAccount: '900011112222', coiDeclared: true, abcAck: true });
    expect(s.companyId).toBe('pwvsb');
    await expect(svc.addPurSupplier(proc, 'co-sasa', { name: 'Again', ssmNo: 'SSM-SYN-77', categories: [], bankName: 'Synthetic Bank', bankAccount: '900011112222', coiDeclared: true, abcAck: true })).rejects.toThrow(/group supplier list/);
    await svc.purSupplierStep(fd, s.id, 'verify_bank', 'Bank letter checked');
    await svc.purSupplierStep(fd, s.id, 'review', 'Yearly review done');
    // Used by a company it was not first added for.
    const pr = await svc.raisePurRequest(proc, 'co-sasa', { title: 'Torches', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: ITEM, qty: 2, unitPrice: 30 }] });
    const q = await svc.purStep(proc, pr.id, 'quote', { supplierId: s.id, amount: 60, ref: 'GQ1', proof: [doc()] });
    expect(q.quotes[0].supplierId).toBe(s.id);
    expect(ds.purSuppliers.filter((x) => x.ssmNo === 'SSM-SYN-77')).toHaveLength(1);
    // Another company's own (older) list is still refused.
    await expect(svc.purStep(proc, pr.id, 'quote', { supplierId: 'sup-co-arsh-1', amount: 61, ref: 'X', proof: [doc()] })).rejects.toThrow(/group list/);
  });

  it('D3: an online listing may be the source up to the CEO limit; Finance approves the payment before the order; the receipt replaces the e-Invoice', async () => {
    const { svc } = setup();
    const { proc, im, coo, ceo, sk, fd } = await people(svc);
    const pr = await quoted(svc);
    await expect(svc.purStep(proc, pr.id, 'submit', { online: 0 })).rejects.toThrow(/until the CEO sets/);
    await svc.setApprovalLimits(ceo, { onlineBuyMax: 200, comment: 'Small online buys' });
    await expect(svc.purStep(proc, pr.id, 'submit', { online: 0 })).rejects.toThrow(/up to RM200.00/);
    await svc.setApprovalLimits(ceo, { onlineBuyMax: 1000, comment: 'Raised' });
    expect((await svc.approvalLimits(ceo)).purchasesMax).toBeNull();
    const sub = await svc.purStep(proc, pr.id, 'submit', { online: 0 });
    expect(sub).toMatchObject({ chosenOnline: 0, chosenSupplierId: null });
    await svc.purStep(im, pr.id, 'approve', { note: 'Checked' });
    await svc.purStep(coo, pr.id, 'approve', { note: 'Ok' });
    await svc.purStep(ceo, pr.id, 'approve', { note: 'Ok' });
    await expect(svc.purStep(proc, pr.id, 'order', { ref: 'SHOPEE-1' })).rejects.toThrow(/Finance approves paying/);
    await expect(svc.purStep(proc, pr.id, 'pay_online', { note: 'x' })).rejects.toThrow(/cannot pay_online/);
    expect((await svc.purBoard(fd)).requests.find((r) => r.req.id === pr.id)!.canPayOnline).toBe(true);
    await expect(svc.purStep(fd, pr.id, 'pay_online', { note: '' })).rejects.toThrow();
    await svc.purStep(fd, pr.id, 'pay_online', { note: 'Listing matches; pay by company card' });
    const o = await svc.purStep(proc, pr.id, 'order', { ref: 'SHOPEE-1' });
    expect(o.po!.amount).toBe(300);
    await svc.purStep(sk, pr.id, 'receive', { qty: [10], ref: 'SHOPEE-PARCEL-1', proof: [doc('DO')] });
    await expect(svc.purStep(fd, pr.id, 'invoice', { number: 'SHP-INV-1', amount: 300 })).rejects.toThrow(/receipt/);
    const inv = await svc.purStep(fd, pr.id, 'invoice', { number: 'SHP-INV-1', amount: 300, proof: [doc('Receipt')] });
    expect(inv.match!.ok).toBe(true);
    expect(inv.receiptDocIds).toHaveLength(1);
    // The PO PDF works with no supplier record.
    expect((await svc.purOrderPdf(proc, pr.id)).base64.length).toBeGreaterThan(100);
  });

  it('D4: a linked serial store item gets one item register ID per good unit when received', async () => {
    const { svc, ds } = setup();
    const { proc, im, coo, ceo, sk } = await people(svc);
    await expect(svc.purLinkItemSku(proc, ITEM, 'sku-torch', 'Serial torches')).rejects.toThrow();
    await expect(svc.purLinkItemSku(im, ITEM, 'sku-torch', '')).rejects.toThrow(/why/);
    const bulk = ds.itemSkus.find((k) => k.tracking === 'BULK');
    if (bulk) await expect(svc.purLinkItemSku(im, ITEM, bulk.id, 'Try bulk')).rejects.toThrow(/counted by quantity/);
    expect((await svc.purLinkItemSku(im, ITEM, 'sku-torch', 'Each torch is tracked')).itemSkuId).toBe('sku-torch');
    expect((await svc.purBoard(im)).serialSkus.some((k) => k.id === 'sku-torch')).toBe(true);
    const before = ds.physicalItems.filter((i) => i.skuId === 'sku-torch').length;
    const pr = await quoted(svc);
    await svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-1' });
    await svc.purStep(im, pr.id, 'approve', { note: 'Checked' });
    await svc.purStep(coo, pr.id, 'approve', { note: 'Ok' });
    await svc.purStep(ceo, pr.id, 'approve', { note: 'Ok' });
    await svc.purStep(proc, pr.id, 'order', { ref: 'PO-SER-1' });
    const g = await svc.purStep(sk, pr.id, 'receive', { qty: [10], ref: 'DO-SER-1', proof: [doc('DO')], condition: [{ damaged: 2, note: 'Cracked lens' }] });
    expect(g.grn!.itemIds).toHaveLength(8);
    const made = ds.physicalItems.filter((i) => i.skuId === 'sku-torch');
    expect(made.length - before).toBe(8);
    expect(made.at(-1)).toMatchObject({ ownerPartyId: 'co-sasa', state: 'quarantine' });
    expect(ds.stockItems.find((i) => i.id === ITEM)!.onHand).toBe(10);
  });

  it('D5: urgent goes to the COO alone with a reason; the quotes follow within 3 working days and the CEO sees it after', async () => {
    const { svc, clock } = setup();
    const { proc, coo, ceo } = await people(svc);
    const pr = await quoted(svc, { quotes: 1, online: 0 });
    await expect(svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-1' })).rejects.toThrow(/3 quotes/);
    await expect(svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-1', urgent: true })).rejects.toThrow(/urgent/);
    const sub = await svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-1', urgent: true, urgentReason: 'Site radios down after a flood' });
    expect(sub.tiers).toEqual(['coo']);
    expect(sub.urgent).toMatchObject({ quotesDue: '2026-11-26', ceoSeen: null });
    expect((await svc.purStep(coo, pr.id, 'approve', { note: 'Urgent, approved' })).status).toBe('approved');
    // The CEO sees it afterwards.
    const ceoRow = (await svc.purBoard(ceo)).requests.find((r) => r.req.id === pr.id)!;
    expect(ceoRow.canSeeUrgent).toBe(true);
    // On the CEO's Home (the Monitor list of the executive view).
    expect(JSON.stringify(await svc.home(ceo))).toMatch(/urgent purchase the COO approved alone/);
    // The quotes still owed: due, then overdue after 3 working days.
    expect((await svc.purBoard(proc)).requests.find((r) => r.req.id === pr.id)!.urgentOwed).toBe('due');
    clock.now = myt('2026-11-27', '10:00');
    expect((await svc.alertItems(proc)).some((a) => a.tone === 'crit' && /past the 3 working days/.test(a.title))).toBe(true);
    await svc.purStep(proc, pr.id, 'quote', { supplierId: 'sup-co-sasa-2', amount: 320, ref: 'Q2', proof: [doc()] });
    await svc.purStep(proc, pr.id, 'quote', { supplierId: 'sup-co-sasa-3', amount: 330, ref: 'Q3', proof: [doc()] });
    await svc.purStep(proc, pr.id, 'online', { source: 'Lazada', ref: 'l', amount: 300, proof: [doc('Listing')] });
    expect((await svc.purBoard(proc)).requests.find((r) => r.req.id === pr.id)!.urgentOwed).toBeNull();
    await expect(svc.purStep(coo, pr.id, 'urgent_seen', {})).rejects.toThrow(/cannot urgent_seen/);
    const seen = await svc.purStep(ceo, pr.id, 'urgent_seen', { note: 'Noted' });
    expect(seen.urgent!.ceoSeen!.byId).toBe(ceo.id);
    await expect(svc.purStep(ceo, pr.id, 'urgent_seen', {})).rejects.toThrow();
  });
});
