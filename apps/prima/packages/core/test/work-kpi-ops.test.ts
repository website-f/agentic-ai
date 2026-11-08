import { describe, expect, it } from 'vitest';
import { buildWorkKpi, type Dataset, type WorkKpiScope } from '../src';

// Gov/Private Ops go-live work on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['operations', 'client_relations'], companyIds: null, label: 'All' };
const at = (d: string, t: string) => `2026-11-${d}T${t}:00+08:00`;
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;

describe('Ops go-live work KPI adapter', () => {
  it('times complaints, each hand of an equipment handover and the monthly invoice from arrival', () => {
    const data = {
      clientAccounts: [
        {
          id: 'ca1', companyId: 'co-a', onboarding: [], startedOn: '2026-01-01',
          complaints: [
            { id: 'c1', at: at('05', '09:00'), by: 'AE (mock)', from: 'Client (mock)', via: 'phone', what: 'x', siteId: null, resolvedAt: at('05', '11:00'), resolvedBy: 'OM (mock)', resolution: 'done', docIds: ['p'] },
            // Still open: nothing timed.
            { id: 'c2', at: at('05', '09:00'), by: 'AE (mock)', from: 'Client (mock)', via: 'phone', what: 'x', siteId: null, resolvedAt: null, resolvedBy: null, resolution: null, docIds: [] },
          ],
          invoices: [{ period: '2026-10', amount: 1, at: at('11', '10:00'), by: 'AE (mock)', hand: null, email: null, portal: null }],
        },
      ],
      stockIssues: [
        {
          id: 'si1', companyId: 'co-a', issuedAt: at('04', '09:00'), issuedBy: 'Store (mock)', acknowledged: true, returned: null,
          handover: {
            omUserId: 'u-om', omName: 'OM (mock)', om: { at: at('04', '10:00'), by: 'OM (mock)' },
            patrol: { personId: 'p1', name: 'Patrol (mock)', step: { at: at('04', '12:00'), by: 'OM (mock)' } },
            guard: { at: at('04', '13:00'), by: 'OM (mock)', photoDocIds: ['ph'] },
          },
        },
      ],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    const ops = dept(r, 'operations');
    expect(ops.work).toEqual([
      expect.objectContaining({ workflow: 'complaint', stage: 'resolve', count: 1, medianMinutes: 120 }),
      expect.objectContaining({ workflow: 'equipment_handover', stage: 'om_receive', count: 1, medianMinutes: 60 }),
      expect.objectContaining({ workflow: 'equipment_handover', stage: 'pass_on', count: 2, medianMinutes: 90 }),
    ]);
    expect(ops.quality).toEqual([
      expect.objectContaining({ workflow: 'complaint', finished: 1, evidenceCompletePct: 100, returns: null }),
      expect.objectContaining({ workflow: 'equipment_handover', finished: 1, reopens: 0, firstPassPct: 100, requesterConfirmedPct: 100 }),
    ]);
    expect(ops.notTimed.join(' ')).toMatch(/lost or damaged/);
    // Sent on 11 November: after the 10th, so late.
    expect(dept(r, 'client_relations').work).toEqual([expect.objectContaining({ workflow: 'invoice', stage: 'send', onTimePct: 0, target: expect.stringMatching(/own due time/) })]);
  });
  it('counts an invoice sent before the month closed as on time, never dropping it', () => {
    const data = { clientAccounts: [{ id: 'ca2', companyId: 'co-a', startedOn: '2026-01-01', onboarding: [], complaints: [], invoices: [{ period: '2026-10', amount: 1, at: '2026-10-31T16:00:00+08:00', by: 'AE (mock)', hand: null, email: null, portal: null }] }] } as unknown as Partial<Dataset>;
    expect(dept(buildWorkKpi(data, SCOPE, '2026-10'), 'client_relations').work).toEqual([expect.objectContaining({ workflow: 'invoice', stage: 'send', count: 1, medianMinutes: 0, onTimePct: 100 })]);
  });
});
