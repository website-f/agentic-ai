import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Central Admin 5G (V8, V10): PWVSB credit checked against the plan. A loan agreement is stamped within 30 days of
// signing (Stamp Act 1949 s.47A) and the collateral agreement is on file. Dummy data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};
const loan = {
  kind: 'LOAN' as const,
  purpose: 'Working capital (mock)',
  secured: true,
  principal: 100000,
  ratePct: 8,
  startOn: '2026-09-15',
  termMonths: 12,
  agreementRef: 'AGR-1 (mock)',
  templateId: 'TEMPLATE-1',
  collateral: 'BENEFICIAL_INTEREST' as const,
  collateralRef: null,
  chargeCreatedOn: null,
};

describe('PWVSB credit against the plan (5G)', () => {
  it('flags an unstamped agreement after 30 days and a missing collateral agreement, until the officer records them', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-credit');
    const l = await svc.addCreditLoan(officer, 'co-sasa', loan);
    let row = (await svc.creditBoard(officer)).rows.find((r) => r.loan.id === l.id)!;
    expect(row).toMatchObject({ stampState: 'overdue', stampDays: 48, collateralMissing: true });
    await expect(svc.creditStamped(await svc.user('u-cm-sasa'), l.id, 'ST-1', '2026-10-30')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.creditStamped(officer, l.id, '', '2026-10-30')).rejects.toThrow(/certificate/);
    await expect(svc.creditStamped(officer, l.id, 'ST-1', '2026-12-30')).rejects.toThrow(/future/);
    await svc.creditStamped(officer, l.id, 'ST-1 (mock)', '2026-10-30');
    await expect(svc.creditStamped(officer, l.id, 'ST-2', '2026-10-30')).rejects.toThrow(/Already/);
    row = (await svc.creditBoard(officer)).rows.find((r) => r.loan.id === l.id)!;
    expect(row.stampState).toBe('ok');
  });

  it('does not flag a loan signed in the last 20 days', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-credit');
    const l = await svc.addCreditLoan(officer, 'co-sasa', { ...loan, startOn: '2026-10-25', collateral: 'NONE' });
    const row = (await svc.creditBoard(officer)).rows.find((r) => r.loan.id === l.id)!;
    expect(row).toMatchObject({ stampState: 'ok', collateralMissing: false });
  });
});
