// Part N4 (Fitri package, 13 Nov 2026): the CEO adds a company without touching the code. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

const NOW = myt('2026-11-14', '10:00');

describe('N4 add a company', () => {
  it('only the CEO adds, with SSM number, source and a reason; as a draft; no duplicate code or SSM number', async () => {
    const ds = generateDataset({ today: '2026-11-14', now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const ceo = await svc.user('u-fauzan');
    const input = { code: 'syn1', name: 'Synthetic Guarding Sdn Bhd', ssmNo: '202601009999 (1234567-X)', state: 'Selangor', sourceRef: 'SSM profile 14 Nov (mock)', reason: 'New licensed company joins the group (mock).' };
    for (const id of ['u-cm-sasa', 'u-fd', 'u-pwvsb-hr']) await expect(svc.addCompany(await svc.user(id), input)).rejects.toThrow(/only the CEO/);
    await expect(svc.addCompany(ceo, { ...input, reason: '' })).rejects.toThrow(/Why/);
    const c = await svc.addCompany(ceo, input);
    expect(c).toMatchObject({ id: 'co-syn1', code: 'SYN1', verificationStatus: 'draft', draftById: 'u-fauzan', guardCount: 0 });
    expect(ds.companies.some((x) => x.id === 'co-syn1')).toBe(true);
    expect(ds.audit.at(-1)!.action).toBe('company.added');
    await expect(svc.addCompany(ceo, input)).rejects.toThrow(/already used/);
    await expect(svc.addCompany(ceo, { ...input, code: 'SYN2' })).rejects.toThrow(/already on/);
  });
});
