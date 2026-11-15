import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, myt, warrantyCheck } from '../src';

// Equipment warranty claims (A8 / N5, Fauzan 11 Nov 2026). Synthetic data only: the generated mock dataset.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const doc = (name: string) => [{ kind: 'document' as const, name: `${name}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString('base64')}` }];
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc };
};

describe('warranty check', () => {
  it('refuses a fault found after the warranty ended, with the reason', () => {
    expect(warrantyCheck('2026-10-31', '2026-11-01')).toEqual({ inWarranty: false, reason: expect.stringMatching(/Out of warranty: the warranty ended on 2026-10-31/) });
    expect(warrantyCheck('2026-11-01', '2026-11-01').inWarranty).toBe(true);
  });
});

describe('equipment warranty claims (A8)', () => {
  it('IT asset: reported with proof, checked from the register by someone else, sent, repaired; the asset record follows', async () => {
    const { ds, svc } = fresh();
    const asset = ds.itAssets.find((a) => a.status === 'in_use' && a.warrantyTo && a.warrantyTo >= TODAY)!;
    const ex = await svc.user('u-it-ex1');
    const lead = await svc.user('u-it-lead');
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.reportWarrantyFault(cm, { source: 'it_asset', itemId: asset.id, fault: 'Screen flickers', faultOn: TODAY, proof: doc('photo') })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.reportWarrantyFault(ex, { source: 'it_asset', itemId: asset.id, fault: 'Screen flickers', faultOn: TODAY, proof: [] })).rejects.toThrow(/photo of the fault/);
    const c = await svc.reportWarrantyFault(ex, { source: 'it_asset', itemId: asset.id, fault: 'Screen flickers', faultOn: TODAY, proof: doc('photo') });
    await expect(svc.reportWarrantyFault(ex, { source: 'it_asset', itemId: asset.id, fault: 'Again', faultOn: TODAY, proof: doc('photo2') })).rejects.toThrow(/already open/);
    await expect(svc.checkWarrantyClaim(ex, c.id, { supplier: 'Sample Supplier' })).rejects.toBeInstanceOf(AccessDenied);
    const checked = await svc.checkWarrantyClaim(lead, c.id, { supplier: 'Sample Supplier' });
    expect(checked.check!.fromRecord).toBe(true);
    expect(checked.status).toBe('checked');
    await expect(svc.closeWarrantyClaim(lead, c.id, { result: 'repaired', note: 'Fixed' })).rejects.toThrow(/Send the claim/);
    await svc.sendWarrantyClaim(lead, c.id, { on: TODAY, supplierRef: 'RMA-1' });
    expect((await svc['store'].get('itAssets', asset.id))!.status).toBe('repair');
    await expect(svc.closeWarrantyClaim(lead, c.id, { result: 'replaced', note: 'New unit' })).rejects.toThrow(/serial number of the replacement/);
    const closed = await svc.closeWarrantyClaim(lead, c.id, { result: 'repaired', note: 'Panel changed by the supplier' });
    expect(closed.status).toBe('closed');
    const after = (await svc['store'].get('itAssets', asset.id))!;
    expect(after.status).toBe('in_use');
    expect(after.maintenance!.at(-1)!.note).toMatch(/repaired/);
    const board = await svc.warrantyBoard(ex);
    expect(board.claims.some((x) => x.id === c.id)).toBe(true);
    expect(board.canCheckIt).toBe(false);
  });

  it('a claim on an item out of warranty is refused with the reason at the check', async () => {
    const { ds, svc } = fresh();
    const asset = ds.itAssets.find((a) => a.status === 'in_use' && a.warrantyTo && a.warrantyTo < TODAY)!;
    const ex = await svc.user('u-it-ex1');
    const mgr = await svc.user('u-it-mgr');
    const c = await svc.reportWarrantyFault(ex, { source: 'it_asset', itemId: asset.id, fault: 'Will not start', faultOn: TODAY, proof: doc('photo') });
    const out = await svc.checkWarrantyClaim(mgr, c.id, { supplier: 'Sample Supplier' });
    expect(out.status).toBe('closed');
    expect(out.outcome!.result).toBe('refused');
    expect(out.outcome!.note).toMatch(/Out of warranty/);
    await expect(svc.sendWarrantyClaim(mgr, c.id, { on: TODAY, supplierRef: 'X1' })).rejects.toThrow(/already with the supplier or closed/);
  });

  it('store item: no warranty date on record needs the warranty card; a replacement updates the serial; nobody handles their own report', async () => {
    const { ds, svc } = fresh();
    const issue = ds.stockIssues[0];
    issue.serial = 'SN-OLD-1';
    const store1 = await svc.user('u-proc-store1');
    const c = await svc.reportWarrantyFault(store1, { source: 'stock', itemId: issue.id, fault: 'Radio does not transmit', faultOn: addDays(TODAY, -2), proof: doc('photo') });
    await expect(svc.checkWarrantyClaim(store1, c.id, { supplier: 'Sample Supplier', warrantyTo: addDays(TODAY, 100), proof: doc('card') })).rejects.toThrow(/other than the reporter/);
    const other = ds.users.find((u) => u.department === 'procurement' && u.procRole === 'storekeeper' && u.id !== store1.id)!;
    const checker = await svc.user(other.id);
    await expect(svc.checkWarrantyClaim(checker, c.id, { supplier: 'Sample Supplier' })).rejects.toThrow(/warranty end date/);
    await expect(svc.checkWarrantyClaim(checker, c.id, { supplier: 'Sample Supplier', warrantyTo: addDays(TODAY, 100) })).rejects.toThrow(/warranty card/);
    await svc.checkWarrantyClaim(checker, c.id, { supplier: 'Sample Supplier', warrantyTo: addDays(TODAY, 100), proof: doc('card') });
    await svc.sendWarrantyClaim(checker, c.id, { on: TODAY, supplierRef: 'DN-22' });
    await svc.closeWarrantyClaim(checker, c.id, { result: 'replaced', note: 'Swapped', replacementSerial: 'SN-NEW-2' });
    expect((await svc['store'].get('stockIssues', issue.id))!.serial).toBe('SN-NEW-2');
    const audit = await svc['store'].list('audit', {});
    for (const a of ['warranty.report', 'warranty.check', 'warranty.send', 'warranty.close']) expect(audit.some((x) => x.action === a)).toBe(true);
  });
});
