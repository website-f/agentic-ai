// The CEO's approval value limits (Fauzan, 3 Nov 2026). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

const TODAY = '2026-11-03';
const NOW = myt(TODAY, '10:30');
const pdf = (name: string) => [{ kind: 'document', name: `${name}.pdf`, data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 ' + name).toString('base64')}` }];

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const as = (id: string) => svc.user(id);
  return { ds, svc, as };
}

async function claimFor(svc: PrimaService, as: (id: string) => ReturnType<PrimaService['user']>, amount: number) {
  const c = await svc.submitStaffClaim(await as('u-ae-sasa'), { kind: 'MEDICAL', date: '2026-11-02', amount, note: 'Clinic visit (synthetic)' } as never, pdf(`receipt-${amount}`) as never);
  await svc.headVerifyClaim(await as('u-cm-sasa'), c.id, true, 'Receipt checked');
  return svc.hrDecideClaim(await as('u-pwvsb-hr'), c.id, true, 'Checked');
}

describe('approval limits set by the CEO', () => {
  it('only the CEO sets them, with a reason; others are refused', async () => {
    const { svc, as } = fresh();
    for (const id of ['u-coo', 'u-fd', 'u-cos', 'u-pwvsb-hr', 'u-cm-sasa'])
      await expect(svc.setApprovalLimits(await as(id), { claimsMax: 300, comment: 'Try' })).rejects.toThrow(/only the CEO/);
    await expect(svc.setApprovalLimits(await as('u-fauzan'), { claimsMax: 300, comment: '' })).rejects.toThrow(/why/);
    await expect(svc.setApprovalLimits(await as('u-fauzan'), { claimsMax: -5, comment: 'Bad' })).rejects.toThrow(/above 0/);
    const l = await svc.setApprovalLimits(await as('u-fauzan'), { claimsMax: 300, purchasesMax: 2000, comment: 'Free the COO for small items' });
    expect(l).toMatchObject({ claimsMax: 300, purchasesMax: 2000 });
    const view = await svc.approvalLimits(await as('u-coo'));
    expect(view.canSet).toBe(false);
    expect((await svc.approvalLimits(await as('u-fauzan'))).canSet).toBe(true);
    await expect(svc.approvalLimits(await as('u-ae-sasa'))).rejects.toThrow();
  });

  it('with no limit set, every claim still goes to the COO (today’s rule)', async () => {
    const { svc, as } = fresh();
    expect((await claimFor(svc, as, 120)).status).toBe('hr_checked');
  });

  it('a claim within the limit is final after HR and the company head; above it the COO still approves', async () => {
    const { svc, as, ds } = fresh();
    await svc.setApprovalLimits(await as('u-fauzan'), { claimsMax: 300, comment: 'Small claims' });
    const small = await claimFor(svc, as, 120);
    expect(small.status).toBe('approved');
    expect(small.cooDecision ?? null).toBeNull();
    expect(ds.audit.some((a) => a.entityId === small.id && a.action === 'claims.approve' && /CEO's limit/.test(a.summary))).toBe(true);
    const big = await claimFor(svc, as, 450);
    expect(big.status).toBe('hr_checked');
  });

  it('a purchase within the limit needs the COO only; above it the COO and the CEO', async () => {
    const { svc, as, ds } = fresh();
    await svc.setApprovalLimits(await as('u-fauzan'), { purchasesMax: 2000, comment: 'Small purchases' });
    const buy = async (unitPrice: number) => {
      const pr = await svc.raisePurRequest(await as('u-ae-sasa'), 'co-sasa', { title: 'Torchlights (synthetic)', category: 'OTHER', lines: [{ item: 'LED torchlight', stockItemId: null, qty: 10, unitPrice }] } as never);
      const sups = ds.purSuppliers.filter((s) => s.companyId === 'co-sasa').slice(0, 3);
      for (const [k, s] of sups.entries())
        await svc.purStep(await as('u-proc-exec'), pr.id, 'quote', { supplierId: s.id, amount: unitPrice * 10 + k * 10, ref: `Q-${k}`, note: 'quote', proof: pdf(`q${unitPrice}-${k}`) } as never);
      await svc.purStep(await as('u-proc-exec'), pr.id, 'online', { source: 'Marketplace', ref: 'listing', amount: unitPrice * 10, proof: pdf(`online-${unitPrice}`) } as never);
      await svc.purStep(await as('u-proc-exec'), pr.id, 'submit', { supplierId: sups[0].id, note: 'cheapest' } as never);
      return ds.purRequests.find((x) => x.id === pr.id)!;
    };
    expect((await buy(45)).tiers).toEqual(['coo']);
    expect((await buy(450)).tiers).toEqual(['coo', 'ceo']);
  });
});
