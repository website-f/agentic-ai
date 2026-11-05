import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Arisha main review round 2 (2 Nov 2026): a rejected purchase needs a correction and resubmission path. Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
let n = 0;
const proof = () => {
  n += 1;
  return { kind: 'document' as const, name: `Quote ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 quote ${n}`).toString('base64')}` };
};

async function rejected() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const proc = await svc.user('u-proc-exec');
  const coo = await svc.user('u-coo');
  const ceo = await svc.user('u-fauzan');
  const pr = await svc.raisePurRequest(proc, 'co-sasa', { title: 'Synthetic torches', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: null, qty: 100, unitPrice: 30 }] });
  for (const [k, amount] of [[1, 3100], [2, 2990], [3, 3050]] as const)
    await svc.purStep(proc, pr.id, 'quote', { supplierId: `sup-co-sasa-${k}`, amount, ref: `Q${k}`, proof: [proof()] });
  await svc.purStep(proc, pr.id, 'online', { source: 'Marketplace', ref: 'listing', amount: 2950, proof: [proof()] });
  await svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-2' });
  const r = await svc.purStep(coo, pr.id, 'reject', { note: 'Quantity too high for the sites' });
  expect(r.status).toBe('rejected');
  return { svc, proc, coo, ceo, pr };
}

describe('Procurement: correct and resubmit after a rejection', () => {
  it('Procurement corrects the items, keeps the rejected round, and the request goes back for fresh quotes and approvals', async () => {
    const { svc, proc, coo, ceo, pr } = await rejected();
    await expect(svc.purStep(proc, pr.id, 'reopen', {})).rejects.toThrow(/what was corrected/);
    const r = await svc.purStep(proc, pr.id, 'reopen', { note: 'Cut to 60 torches', lines: [{ item: 'Torch', stockItemId: null, qty: 60, unitPrice: 30 }] });
    expect(r).toMatchObject({ status: 'quoting', total: 1800, quotes: [], online: [], approvals: [], tiers: [], rejected: null, chosenSupplierId: null });
    expect(r.rounds).toHaveLength(1);
    expect(r.rounds![0]).toMatchObject({ total: 3000, rejected: { note: 'Quantity too high for the sites' }, reopened: { note: 'Cut to 60 torches', byId: proc.id } });
    expect(r.rounds![0].quotes).toHaveLength(3);
    // The same suppliers can quote again for the corrected items, and the full approval chain runs again.
    for (const [k, amount] of [[1, 1850], [2, 1790], [3, 1820]] as const)
      await svc.purStep(proc, pr.id, 'quote', { supplierId: `sup-co-sasa-${k}`, amount, ref: `Q${k}b`, proof: [proof()] });
    await svc.purStep(proc, pr.id, 'online', { source: 'Marketplace', ref: 'listing', amount: 1780, proof: [proof()] });
    await svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-2' });
    await svc.purStep(coo, pr.id, 'approve');
    expect((await svc.purStep(ceo, pr.id, 'approve')).status).toBe('approved');
  });

  it('only Procurement or the raiser reopens, never the rejecter, and only a rejected request', async () => {
    const { svc, proc, coo, pr } = await rejected();
    await expect(svc.purStep(coo, pr.id, 'reopen', { note: 'x' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.purStep(proc, pr.id, 'reopen', { note: 'Corrected' });
    await expect(svc.purStep(proc, pr.id, 'reopen', { note: 'Again' })).rejects.toThrow(/cannot reopen/);
  });
});
