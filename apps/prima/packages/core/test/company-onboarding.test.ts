import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, arishaPrepare, generateDataset } from '../src';

const TODAY = '2026-10-30';
const NOW = '2026-10-30T00:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}
const source = {
  name: 'Sasa Security Services Sdn Bhd',
  ssmNo: '201901002101',
  registeredOn: '2019-01-14',
  registeredAddress: 'No. 1 Jalan Contoh, Selangor',
  businessAddress: 'No. 2 Jalan Contoh, Selangor',
  state: 'Selangor',
  headOfCompany: 'Verified company manager',
  sourceRef: 'SSM official company profile document, dated 2026-10-30',
  verificationStatus: 'verified',
};

describe('CEO company master onboarding', () => {
  it('offers existing company IDs and prepares an AI draft without changing the dataset', async () => {
    const { ds, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const before = ds.companies.find((c) => c.id === 'co-sasa')!;
    const initialName = before.name;
    const chooser = await svc.recordForm(ceo, 'company', null, null);
    expect(chooser.chooseCompany?.some(([id]) => id === before.id)).toBe(true);
    const form = await svc.recordForm(ceo, 'company', null, before.id);
    expect(form.values.name).toBe(initialName);
    expect(form.values.ssmNo ?? null).toBeNull();
    const draft = arishaPrepare({ kind: 'company', companyId: before.id, values: source, summary: 'Company SSM profile' });
    expect(draft.companyId).toBe(before.id);
    expect(draft.values.ssmNo).toBe(source.ssmNo);
    expect(before.ssmNo).toBeUndefined();
  });

  it('updates the existing company row in place, tracks CEO verification and never creates a duplicate', async () => {
    const { ds, store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const original = ds.companies.find((c) => c.id === 'co-sasa')!;
    const originalCode = original.code;
    const originalCount = ds.companies.length;
    await svc.saveRecord(ceo, 'company', null, original.id, source);
    expect(ds.companies).toHaveLength(originalCount);
    const after = await store.get('companies', original.id);
    expect(after?.code).toBe(originalCode);
    expect(after?.name).toBe(source.name);
    expect(after?.ssmNo).toBe(source.ssmNo);
    expect(after?.verifiedBy).toBe(ceo.name);
    expect(after?.verifiedOn).toBe(TODAY);
    expect(after?.verificationStatus).toBe('verified');
  });

  it('blocks the Finance Director, COO and ACT Lead from changing company master records', async () => {
    const { svc } = fresh();
    for (const uid of ['u-fd', 'u-coo', 'u-audit', 'u-it-mgr']) {
      const person = await svc.user(uid);
      await expect(svc.recordForm(person, 'company', null, 'co-sasa')).rejects.toThrow();
      await expect(svc.saveRecord(person, 'company', null, 'co-sasa', source)).rejects.toThrow();
    }
  });

  it('rejects a nonexistent company, duplicate SSM, and unverified evidence', async () => {
    const { svc, store } = fresh();
    const ceo = await svc.user('u-fauzan');
    await expect(svc.saveRecord(ceo, 'company', null, 'not-a-real-company', source)).rejects.toThrow();
    await svc.saveRecord(ceo, 'company', null, 'co-sasa', source);
    const second = await store.get('companies', 'co-arsh');
    expect(second).toBeTruthy();
    await expect(svc.saveRecord(ceo, 'company', null, 'co-arsh', {
      ...source,
      name: 'Another Company Sdn Bhd',
    })).rejects.toThrow(/already assigned/);
    await expect(svc.saveRecord(ceo, 'company', null, 'co-arsh', {
      ...source,
      ssmNo: '201901002102',
      name: 'Another Company Sdn Bhd',
      registeredAddress: null,
    })).rejects.toThrow(/registered address/);
    expect((await store.get('companies', 'co-arsh'))?.ssmNo).toBeUndefined();
  });
});
