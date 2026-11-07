import { describe, expect, it } from 'vitest';
import { buildWorkKpi, workKpiAdapters, type Dataset, type WorkKpiScope } from '../src';

// The Client CRM on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['client_relations', 'operations'], companyIds: null, label: 'All' };
const at = (d: string, t: string) => `2026-11-${d}T${t}:00+08:00`;
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;

describe('CRM work KPI adapter', () => {
  it('times lead research, client requests against the needed day and the renewal proposal; never the renewal decision', () => {
    const renewal = { id: 'rn1', endsOn: '2026-12-31', openedAt: at('02', '09:00'), decision: { choice: 'renew', pricePct: 5, reason: 'x', by: 'CM (mock)', at: at('03', '09:00') }, proposal: { at: at('03', '15:00'), by: 'AE (mock)', docId: 'd' }, answer: { choice: 'accepted', at: at('05', '09:00'), by: 'AE (mock)', note: '', newEndsOn: '2027-12-31', docId: 'sig' }, closedAt: at('05', '09:00') };
    const data = {
      salesLeads: [{ id: 'l1', companyId: 'co-a', createdAt: at('04', '09:00'), research: { by: 'AE (mock)', at: at('04', '12:00') } }, { id: 'l2', companyId: 'co-a', createdAt: at('04', '09:00'), research: null }],
      clientAccounts: [
        {
          id: 'ca1', companyId: 'co-a', onboarding: [],
          requests: [
            { id: 'r1', kind: 'more_guards', what: '', from: '', at: at('04', '09:00'), by: 'AE (mock)', neededBy: '2026-11-04', status: 'done', closedAt: at('05', '09:00'), closedBy: 'OM (mock)', outcome: 'x', variationRef: null },
            // No date from the client: due in 14 days (proposed rule), so a week later is on time.
            { id: 'r2', kind: 'schedule_change', what: '', from: '', at: at('02', '09:00'), by: 'AE (mock)', neededBy: null, status: 'done', closedAt: at('09', '09:00'), closedBy: 'OM (mock)', outcome: 'x', variationRef: null },
          ],
          // The same renewal as the open one and in the history: counted once.
          renewal, renewals: [renewal],
          complaints: [{ id: 'c1', at: at('05', '09:00'), by: 'AE (mock)', from: 'x', via: 'call', what: 'x', siteId: null, resolvedAt: at('05', '10:00'), resolvedBy: 'OM (mock)', resolution: 'x', docIds: [] }],
        },
      ],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    const cr = dept(r, 'client_relations');
    expect(cr.work).toEqual([
      expect.objectContaining({ workflow: 'client_request', stage: 'close', count: 2, onTimePct: 50, target: expect.stringMatching(/own due time/) }),
      expect.objectContaining({ workflow: 'lead', stage: 'research', count: 1, medianMinutes: 180 }),
      // Sent 3 Nov for a contract ending 31 Dec: before the 45-day day (16 Nov), so on time.
      expect.objectContaining({ workflow: 'renewal', stage: 'proposal', count: 1, medianMinutes: 360, onTimePct: 100, target: expect.stringMatching(/own due time/) }),
    ]);
    expect(cr.people.map((p) => p.name)).toEqual(['AE (mock)', 'OM (mock)']);
    expect(cr.notTimed.join(' ')).toMatch(/decision on a renewal/);
    // Whether the client renews is a sales outcome, never counted as a confirmation of the team's work.
    expect(cr.quality[0]).toMatchObject({ workflow: 'renewal', finished: 1, requesterConfirmedPct: null });
    // Complaints come from the shared adapter, once.
    expect(workKpiAdapters().filter((a) => a.id === 'client-complaints')).toHaveLength(1);
    expect(dept(r, 'operations').work).toContainEqual(expect.objectContaining({ workflow: 'complaint', stage: 'resolve', count: 1, medianMinutes: 60 }));
  });
});
