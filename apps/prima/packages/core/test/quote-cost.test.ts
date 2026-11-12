import { describe, expect, it } from 'vitest';
import { DEFAULT_PAY_LAW, DEFAULT_STATUTORY, MemoryStore, PrimaService, generateDataset, myt, quoteCostCheck } from '../src';

// C10 (Fauzan, 11 Nov 2026): quotation cost checks switched on with hostel and transport (Nepali guards) and uniform
// and equipment (all guards) from the rate book. Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');
const rates = (amounts: Partial<Record<'hostel_np' | 'transport_np' | 'uniform' | 'equipment', number>>) => ({
  rateLog: Object.entries(amounts).map(([key, amount]) => ({ key: key as 'uniform', scope: 'group' as const, from: '2026-01', amount: amount!, reason: 'Synthetic', by: 'FD', byId: 'u-fd', at: NOW })),
});

describe('C10 quotation cost check', () => {
  it('works the cost out by hand: minimum wage, overtime, EPF on basic, SOCSO and EIS, then the rate book lines', () => {
    const fin = rates({ hostel_np: 200, transport_np: 100, uniform: 30, equipment: 20 });
    const c = quoteCostCheck({ guards: 2, nepaliGuards: 1, hoursPerDay: 12, monthlyTotal: 20000 }, '2026-11', DEFAULT_PAY_LAW, DEFAULT_STATUTORY, fin, NOW);
    const line = (k: string) => c.lines.find((l) => l.key === k)!;
    // RM1,700 / 26 / 8 = RM8.1731 an hour; 4 h x 26 days = 104 h at 1.5x = RM1,275.00 a guard.
    expect(line('wage').amount).toBe(3400);
    expect(line('overtime').perGuard).toBe(1275);
    // EPF on basic: Malaysian 13% of RM1,700 = RM221; Nepali 2% = RM34. EIS Malaysian only.
    expect(line('epf').amount).toBe(221 + 34);
    expect(line('eis').amount).toBeGreaterThan(0);
    expect(line('hostel_np')).toMatchObject({ guards: 1, amount: 200 });
    expect(line('transport_np')).toMatchObject({ guards: 1, amount: 100 });
    expect(line('uniform')).toMatchObject({ guards: 2, amount: 60 });
    expect(line('equipment')).toMatchObject({ guards: 2, amount: 40 });
    const total = c.lines.reduce((n, l) => n + l.amount!, 0);
    expect(c.totalCost).toBeCloseTo(total, 2);
    expect(c.status).toBe('ok');
  });

  it('flags a price below the total cost with the reason, and a missing rate as incomplete (never zero)', () => {
    const low = quoteCostCheck({ guards: 2, nepaliGuards: 0, hoursPerDay: 12, monthlyTotal: 5000 }, '2026-11', DEFAULT_PAY_LAW, DEFAULT_STATUTORY, rates({ uniform: 30, equipment: 20 }), NOW);
    expect(low.status).toBe('below_cost');
    expect(low.reasons[0]).toMatch(/below the cost of RM/);
    const missing = quoteCostCheck({ guards: 2, nepaliGuards: 1, hoursPerDay: 8, monthlyTotal: 99999 }, '2026-11', DEFAULT_PAY_LAW, DEFAULT_STATUTORY, rates({ uniform: 30, equipment: 20 }), NOW);
    expect(missing.status).toBe('incomplete');
    expect(missing.totalCost).toBeNull();
    expect(missing.lines.find((l) => l.key === 'hostel_np')).toMatchObject({ amount: null, note: 'Rate not set' });
    expect(missing.reasons.join(' ')).toMatch(/Hostel, per Nepali guard: rate not set/);
    // 8-hour shifts have no overtime.
    expect(missing.lines.find((l) => l.key === 'overtime')!.amount).toBe(0);
  });

  it('keeps the check on the quotation and flags approval below cost; the wrong role cannot approve', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    let tick = 0;
    // Each call a minute later (quotation ids carry the time).
    const svc = new PrimaService(store, () => myt(TODAY, `10:${String(tick++ % 60).padStart(2, '0')}`));
    const co = ds.companies.find((c) => ds.users.some((u) => u.role === 'admin_exec' && u.companyIds.includes(c.id)) && ds.users.some((u) => u.role === 'company_manager' && u.companyIds.includes(c.id)))!;
    const fin = ds.finStatus.find((f) => f.companyId === co.id)!;
    fin.rateLog = rates({ hostel_np: 200, transport_np: 100, uniform: 30, equipment: 20 }).rateLog;
    const exec = await svc.user(ds.users.find((u) => u.role === 'admin_exec' && u.companyIds.includes(co.id))!.id);
    const mgr = await svc.user(ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(co.id))!.id);
    const q = await svc.createQuotation(exec, co.id, { client: 'Synthetic Client Sdn Bhd', siteName: 'Synthetic site', tenderId: null, guards: 3, nepaliGuards: 2, hoursPerDay: 12, ratePerGuard: 2000, validDays: 30 });
    expect(q.costCheck?.status).toBe('below_cost');
    expect(q.costCheck?.lines.find((l) => l.key === 'hostel_np')).toMatchObject({ guards: 2, amount: 400 });
    await expect(svc.createQuotation(exec, co.id, { client: 'X', siteName: '', tenderId: null, guards: 2, nepaliGuards: 3, hoursPerDay: 12, ratePerGuard: 4000, validDays: 30 })).rejects.toThrow(/Nepali guards/);
    await svc.quotationAction(exec, q.id, 'submit');
    // The preparer cannot approve; the manager can, and the audit keeps the flag.
    await expect(svc.quotationAction(exec, q.id, 'approve', 'ok')).rejects.toThrow();
    await svc.quotationAction(mgr, q.id, 'approve', 'Client is strategic; accepted below cost (synthetic)');
    const audit = (await store.list('audit', {})).find((a) => a.action === 'quotation.approve' && a.entityId === q.id)!;
    expect(audit.summary).toMatch(/BELOW COST/);
    // A correction to a price above cost clears the flag.
    const q2 = await svc.createQuotation(exec, co.id, { client: 'Synthetic Client B', siteName: '', tenderId: null, guards: 1, hoursPerDay: 8, ratePerGuard: 1000, validDays: 30 });
    const fixed = await svc.correctQuotation(exec, q2.id, { guards: 1, nepaliGuards: 0, hoursPerDay: 8, ratePerGuard: 4000, validUntil: '2026-12-01', reason: 'Priced to cover cost' });
    expect(fixed.costCheck?.status).toBe('ok');
  });
});
