import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt, type ExpenseRequest } from '../src';

// Central Admin 5F (automations 11 and 12): rent and utilities started from last month's approved request, and memo
// read reminders after 3 days. Dummy data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const clock = { now: NOW };
  return { ds, store, clock, svc: new PrimaService(store, () => clock.now) };
};
const rent = (over: Partial<ExpenseRequest>): ExpenseRequest => ({
  id: 'ex-off-2026-10-rent',
  kind: 'OFFICE',
  companyId: 'co-sasa',
  period: '2026-10',
  category: 'RENT',
  lines: [{ item: 'Office rent, Shah Alam (mock)', amount: 4200, note: '' }],
  total: 4200,
  docIds: ['doc-x'],
  userId: 'u-cm-sasa',
  requestedBy: 'Company manager (mock)',
  createdAt: myt('2026-10-02', '09:00'),
  status: 'approved',
  submittedAt: myt('2026-10-02', '09:00'),
  cosApproval: null,
  cooDecision: null,
  returned: null,
  ...over,
});

describe('Chief of Staff office automations (5F)', () => {
  it('starts this month’s rent from last month’s approved request as a draft, once, for the company manager only', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.prefillOfficeRequest(cm, { companyId: 'co-sasa', category: 'RENT' })).rejects.toThrow(/No approved request/);
    await store.insert('expenseRequests', rent({}));
    expect(JSON.stringify(await svc.home(cm, 'co-sasa'))).toMatch(/Rent for 2026-11: start from last month/);
    const d = await svc.prefillOfficeRequest(cm, {
      companyId: 'co-sasa',
      category: 'RENT',
    });
    expect(d).toMatchObject({
      status: 'draft',
      period: '2026-11',
      total: 4200,
      docIds: [],
    });
    expect(d.lines[0].note).toMatch(/Pre-filled from 2026-10/);
    // The bill for this month must still be attached before it can be sent.
    await expect(svc.submitExpense(cm, d.id)).rejects.toThrow(/Attach/);
    await expect(svc.prefillOfficeRequest(cm, { companyId: 'co-sasa', category: 'RENT' })).rejects.toThrow(/already/);
    expect(JSON.stringify(await svc.home(cm, 'co-sasa'))).not.toMatch(/Rent for 2026-11/);
    await expect(
      svc.prefillOfficeRequest(await svc.user('u-cos'), {
        companyId: 'co-sasa',
        category: 'RENT',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.prefillOfficeRequest(await svc.user('u-cm-arsh'), {
        companyId: 'co-sasa',
        category: 'RENT',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
  });

  it('reminds a reader who has not opened a memo after 3 days, until they read it', async () => {
    const { svc, clock } = fresh();
    const cm = await svc.user('u-cm-sasa');
    // The seeded staff memo is 2 days old: no reminder yet.
    expect(JSON.stringify(await svc.home(cm, 'co-sasa'))).not.toMatch(/not read yet/);
    clock.now = myt('2026-11-03', '11:00');
    expect(JSON.stringify(await svc.home(cm, 'co-sasa'))).toMatch(/memo not read yet/);
    await svc.readMemo(cm, 'memo-seed-staff-1');
    expect(JSON.stringify(await svc.home(cm, 'co-sasa'))).not.toMatch(/not read yet/);
  });
});
