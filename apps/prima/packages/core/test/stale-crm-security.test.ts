import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

async function fixture() {
  const today = '2026-11-04';
  const now = myt(today, '10:00');
  const store = new MemoryStore(generateDataset({ today, now }));
  const svc = new PrimaService(store, () => now);
  const om = await svc.user('u-om-klang');
  const acct = (await svc.clientBoard(om)).accounts.find(a => a.canAct && a.stage === 'active' && a.companyId === 'co-sasa')!;
  expect(acct).toBeTruthy();
  const sup = (await store.list('users', {})).find(u => u.role === 'supervisor' && u.siteIds.some(id => acct.siteIds.includes(id)))!;
  expect(sup).toBeTruthy();
  await store.update('clientAccounts', acct.id, {
    billing: { asOf: today, invoicedTo: '2026-10', overdueAmount: 12345.67, overdueDays: 30, by: 'Synthetic finance reviewer' },
  });
  return { store, svc, acct, sup };
}

describe('Unified stack: preserve CRM #74 money redaction in KPI #108', () => {
  it('site supervisor must not receive client billing in a direct service call', async () => {
    const { svc, acct, sup } = await fixture();
    const result = await svc.crmClient(sup, acct.id);
    expect(result.account.billing).toBeNull();
  });
  it('site supervisor must not receive monthly contract/invoice values from CRM board', async () => {
    const { svc, sup } = await fixture();
    const result = await svc.crmBoard(sup);
    expect(result.clients.every(c => c.monthly === null)).toBe(true);
    expect(result.pipeline.every(p => p.monthly === null)).toBe(true);
  });
});

describe('CRM field-role redaction and authorized office view', () => {
  it('redacts supervisor and patrol financial fields while preserving the COO view', async () => {
    const { svc, store, acct, sup } = await fixture();
    await store.update('clientAccounts', acct.id, { invoices: [{ period: '2026-10', amount: 91827.43, at: myt('2026-11-04', '09:00'), by: 'Synthetic finance' }] } as never);
    for (const user of [sup, { ...sup, role: 'pwvsb_officer' as const, department: 'operations' as const, opsTier: 'patrol' as const }]) {
      const file = await svc.crmClient(user, acct.id);
      expect(file.seesMoney).toBe(false);
      expect(file.monthly).toBeNull();
      expect(file.monthlyFrom).toBeNull();
      expect(file.account.billing).toBeNull();
      expect(file.timeline.some(e => e.kind === 'Invoice')).toBe(false);
      const board = await svc.crmBoard(user);
      expect(board.seesMoney).toBe(false);
      expect(board.pipeline.every(p => p.monthly === null)).toBe(true);
    }
    const coo = await svc.user('u-coo');
    const file = await svc.crmClient(coo, acct.id);
    expect(file.seesMoney).toBe(true);
    expect(file.account.billing?.overdueAmount).toBe(12345.67);
    expect(file.timeline.some(e => e.kind === 'Invoice' && e.what.includes('91827.43'))).toBe(true);
  });
});
