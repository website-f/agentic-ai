import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, quotationCostCheck } from '../src';

// C10 (Fauzan, 11 Nov 2026): cost checks on quotations. Synthetic data and made-up rates only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const RATES = { uniform: 30, equipment: 20, hostel_foreign: 150, transport_foreign: 60 };

describe('C10: quotation cost checks', () => {
  it('adds wages, overtime, EPF, SOCSO, EIS, uniform and equipment, and hostel and transport for Nepali guards', () => {
    const c = quotationCostCheck({ guards: 4, nepaliGuards: 2, hoursPerDay: 12, ratePerGuard: 2000 }, RATES);
    expect(c.missing).toEqual([]);
    expect(c.perGuard.nepali! - c.perGuard.local).toBeLessThan(210); // hostel and transport added, lower EPF/SOCSO/EIS
    expect(c.lines.find((l) => l.label.startsWith('Hostel'))!.nepali).toBe(150);
    expect(c.below).toBe(true);
    expect(c.reasons.join(' ')).toMatch(/below the cost of one guard/);
    const ok = quotationCostCheck({ guards: 4, nepaliGuards: 2, hoursPerDay: 12, ratePerGuard: 4000 }, RATES);
    expect(ok.below).toBe(false);
    expect(ok.reasons).toEqual([]);
  });

  it('says "rate not set" for a rate not entered, never zero', () => {
    const c = quotationCostCheck({ guards: 2, nepaliGuards: 1, hoursPerDay: 8, ratePerGuard: 5000 }, { uniform: 30 });
    expect(c.monthlyCost).toBeNull();
    expect(c.missing).toEqual(['Equipment', 'Hostel, foreign (Nepali) guards', 'Transport, foreign (Nepali) guards']);
    expect(c.reasons.join(' ')).toMatch(/Rate not set/);
    expect(c.below).toBe(false);
    // Local guards only: hostel and transport are not needed.
    expect(quotationCostCheck({ guards: 2, hoursPerDay: 8, ratePerGuard: 5000 }, { uniform: 30, equipment: 20 }).missing).toEqual([]);
  });

  it('keeps the check on the quotation and shows the flag to the approver', async () => {
    const { svc } = fresh();
    await svc.setSiteCostRates(await svc.user('u-fd'), { rates: RATES, reason: 'Synthetic rate list for the test' });
    const ae = await svc.user('u-ae-arsh');
    const q = await svc.createQuotation(ae, 'co-arsh', { client: 'Synthetic client', siteName: 'Synthetic site', tenderId: null, guards: 3, nepaliGuards: 1, hoursPerDay: 12, ratePerGuard: 1800, validDays: 30 });
    expect(q.costCheck!.below).toBe(true);
    await svc.quotationAction(ae, q.id, 'submit');
    const board = await svc.tenderBoard(await svc.user('u-fauzan'));
    expect(board.quotationsWaiting.find((x) => x.id === q.id)!.costFlags.join(' ')).toMatch(/below the cost/);
    await expect(svc.createQuotation(ae, 'co-arsh', { client: 'X', siteName: 'Y', tenderId: null, guards: 2, nepaliGuards: 3, hoursPerDay: 12, ratePerGuard: 3000, validDays: 30 })).rejects.toThrow(/Nepali guards/);
  });
});
