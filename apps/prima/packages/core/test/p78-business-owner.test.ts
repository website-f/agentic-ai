import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// P78 (Agentic Office): the owner, signed in as Prima's CEO record, is the master administrator. On the business screens
// he enters what the department enters (tenders, leads, quotations, purchases, suppliers, asset requests, panel firms,
// products); approvals keep their own people and nobody approves what they entered. Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
let n = 0;
const proof = () => {
  n += 1;
  return { kind: 'document' as const, name: `Quote ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 quote ${n}`).toString('base64')}` };
};

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc };
}

const TENDER = {
  ref: 'JKR/T/2026/P78',
  title: 'Guarding of the district office',
  buyer: 'Synthetic district office',
  channel: 'GOVERNMENT' as const,
  closesOn: '2026-12-15',
  guards: 6,
  sites: 1,
  estMonthly: 21000,
};

describe('P78 business: the owner adds and starts, others approve', () => {
  it('enters a tender on the company screen, checked and audited; others without the right are refused', async () => {
    const { svc, ds } = fresh();
    const owner = await svc.user('u-fauzan');
    expect((await svc.commercial(owner, 'co-sasa')).can).toMatchObject({ prepare: true, approve: false, addTender: true });
    const t = await svc.addTender(owner, 'co-sasa', TENDER);
    expect(t).toMatchObject({ status: 'open', companyId: 'co-sasa', owner: owner.name, source: 'Entered on Prima' });
    expect((await svc.commercial(owner, 'co-sasa')).tenders.some((r) => r.tender.id === t.id)).toBe(true);
    expect(ds.audit.at(-1)).toMatchObject({ action: 'tender.add', entityId: t.id, actor: owner.name });
    await expect(svc.addTender(owner, 'co-sasa', TENDER)).rejects.toThrow(/already has tender/);
    await expect(svc.addTender(owner, 'co-sasa', { ...TENDER, ref: 'X-1', closesOn: '2026-10-01' })).rejects.toThrow(/closing date/);
    await expect(svc.addTender(owner, 'co-sasa', { ...TENDER, ref: 'X-2', guards: 0 })).rejects.toThrow(/Guards/);
    // The company's admin team enters its own; the Director Office Administrator too; HR does not.
    expect((await svc.addTender(await svc.user('u-ae-sasa'), 'co-sasa', { ...TENDER, ref: 'X-3' })).status).toBe('open');
    expect((await svc.addTender(await svc.user('u-pwvsb-doa'), 'co-sasa', { ...TENDER, ref: 'X-4' })).status).toBe('open');
    await expect(svc.addTender(await svc.user('u-pwvsb-hr'), 'co-sasa', { ...TENDER, ref: 'X-5' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('opens a lead and drafts a quotation; the company manager approves it, never the owner', async () => {
    const { svc } = fresh();
    const owner = await svc.user('u-fauzan');
    const lead = await svc.addSalesLead(owner, 'co-sasa', { prospect: 'Synthetic mall', sector: 'COMMERCIAL', source: 'Referral', guardsEst: 4, estMonthly: null, nextOn: null, nextWhat: '' });
    expect(lead.stage).toBe('new');
    const q = await svc.createQuotation(owner, 'co-sasa', { client: 'Synthetic mall', siteName: 'Main gate', tenderId: null, guards: 4, hoursPerDay: 12, ratePerGuard: 3200, validDays: 30 });
    await svc.quotationAction(owner, q.id, 'submit');
    await expect(svc.quotationAction(owner, q.id, 'approve')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.quotationAction(await svc.user('u-cm-sasa'), q.id, 'approve')).status).toBe('approved');
  });

  it('raises a purchase and adds a supplier; the COO approves an owner-raised purchase in the CEO tier', async () => {
    const { svc } = fresh();
    const owner = await svc.user('u-fauzan');
    const board = await svc.purBoard(owner);
    expect(board.raiseFor.some((c) => c.id === 'co-sasa')).toBe(true);
    expect(board.supplierFor.some((c) => c.id === 'co-sasa')).toBe(true);
    const s = await svc.addPurSupplier(owner, 'co-sasa', { name: 'Synthetic Supplies', ssmNo: 'P78-0001', categories: ['UNIFORM'], bankName: 'Bank', bankAccount: '1234567890', coiDeclared: true, abcAck: true });
    expect(s.bank.verifiedOn).toBeNull();
    const proc = await svc.user('u-proc-exec');
    const coo = await svc.user('u-coo');
    const pr = await svc.raisePurRequest(owner, 'co-sasa', { title: 'Synthetic torches', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: null, qty: 100, unitPrice: 30 }] });
    for (const [k, amount] of [[1, 3100], [2, 2990], [3, 3050]] as const)
      await svc.purStep(proc, pr.id, 'quote', { supplierId: `sup-co-sasa-${k}`, amount, ref: `Q${k}`, proof: [proof()] });
    await svc.purStep(proc, pr.id, 'online', { source: 'Marketplace', ref: 'listing', amount: 2950, proof: [proof()] });
    const sent = await svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-2' });
    expect(sent.tiers).not.toContain('ceo');
    await expect(svc.purStep(owner, pr.id, 'approve')).rejects.toThrow();
    expect((await svc.purStep(coo, pr.id, 'approve')).status).toBe('approved');
  });

  it('asks to buy an asset and records rent like the team; the COO decides, never the asker', async () => {
    const { svc } = fresh();
    const owner = await svc.user('u-fauzan');
    const board = await svc.amBoard(owner);
    expect(board.can.record).toBe(true);
    const a = await svc.amBuyRequest(owner, { description: 'Synthetic office chairs', category: 'FURNITURE', qty: 4, estCost: 1200, location: 'Head office', ownerEntity: 'PWVSB', reason: 'Broken chairs' });
    await expect(svc.amBuyDecide(owner, a.id, true, 'ok')).rejects.toThrow(/Someone else/);
    expect((await svc.amBuyDecide(await svc.user('u-coo'), a.id, true, 'Needed')).status).toBe('buy_approved');
    expect((await svc.fixedAssets(owner)).can.ask).toBe(true);
  });

  it('keeps the panel firms and the product list', async () => {
    const { svc } = fresh();
    const owner = await svc.user('u-fauzan');
    expect((await svc.panelBoard(owner)).canKeep).toEqual({ AUDIT: true, SECRETARY: true, LAW: true });
    const f = await svc.addPanelFirm(owner, { kind: 'AUDIT', name: 'Synthetic Audit PLT', regNo: 'AF-P78', appointedOn: TODAY });
    expect(f.addedById).toBe(owner.id);
    expect((await svc.productBoard(owner)).canKeep).toBe(true);
    const p = await svc.saveProduct(owner, { name: 'Synthetic camera', category: 'CCTV', mode: 'SALE', supplier: 'Synthetic', personalData: [], retentionDays: null, clientConsent: false, notes: '' });
    expect(p.name).toBe('Synthetic camera');
  });
});
