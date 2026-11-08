import { describe, expect, it } from 'vitest';
import { buildWorkKpi, workKpiScope, type Dataset, type WorkKpiScope } from '../src';

// Director Office tenders and quotations on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['director_office', 'company_office'], companyIds: null, label: 'All' };
const at = (d: string, t: string) => `2026-11-${d}T${t}:00+08:00`;
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;

describe('Director Office work KPI adapter', () => {
  it('times assignment, tender preparation and submission from arrival against the closing day, never the manager’s signature', () => {
    const data = {
      tenderOpportunities: [
        { id: 'o1', kind: 'TENDER', origin: 'DOA', foundAt: at('03', '09:00'), foundBy: 'DOA (mock)', closesOn: '2026-11-10', entries: [{ companyId: 'co-a', setBy: 'DOA', userId: 'u-doa', by: 'DOA (mock)', at: at('03', '10:00'), note: '', tenderId: 't1' }] },
        // Told by a company: nothing for the Director Office to assign.
        { id: 'o2', kind: 'QUOTATION', origin: 'COMPANY', foundAt: at('03', '09:00'), foundBy: 'CM (mock)', closesOn: '2026-11-10', entries: [{ companyId: 'co-a', setBy: 'COMPANY', userId: 'u-cm', by: 'CM (mock)', at: at('03', '09:00'), note: '', tenderId: null }] },
      ],
      tenders: [
        {
          id: 't1', companyId: 'co-a', closesOn: '2026-11-04', checklistReview: { by: 'DOA (mock)', at: at('03', '11:00'), note: '', reader: 'x' },
          verifications: [
            { level: 'PREPARER', userId: 'u-p', by: 'Preparer (mock)', at: at('03', '15:00'), note: '' },
            { level: 'MANAGER', userId: 'u-m', by: 'Manager (mock)', at: at('04', '09:00'), note: '' },
          ],
          submission: { by: 'Preparer (mock)', at: at('04', '18:00'), note: '', proofIds: ['slip'] },
        },
      ],
      quotations: [{ id: 'q1', companyId: 'co-a', approvedAt: at('05', '09:00'), approvedBy: 'CM (mock)', sent: { userId: 'u-ae', by: 'AE (mock)', at: at('05', '09:45') } }],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    expect(dept(r, 'director_office').work).toEqual([expect.objectContaining({ workflow: 'opportunity', stage: 'assign', count: 1, medianMinutes: 60 })]);
    const co = dept(r, 'company_office');
    expect(co.work).toEqual([
      expect.objectContaining({ workflow: 'quotation', stage: 'send', medianMinutes: 45, onTimePct: 100 }),
      expect.objectContaining({ workflow: 'tender', stage: 'prepare', medianMinutes: 240, onTimePct: 100 }),
      // Submitted after 5.30 pm on the closing day: late.
      expect.objectContaining({ workflow: 'tender', stage: 'submit', onTimePct: 0, target: expect.stringMatching(/own due time/) }),
    ]);
    expect(co.people.map((p) => p.name)).toEqual(['AE (mock)', 'Preparer (mock)']);
    expect(co.notTimed.join(' ')).toMatch(/manager’s signature on a tender/);
    expect(co.unknown.join(' ')).toMatch(/Preparing a quotation/);
    expect(co.quality[0]).toMatchObject({ workflow: 'tender', finished: 1, returns: null, evidenceCompletePct: 100 });
  });
  it('does not give the Director Office Administrator a standing view of their own KPIs', () => {
    const doa = { id: 'u-doa', name: 'DOA (mock)', title: 'Director Office Administrator', role: 'pwvsb_officer', department: 'director_office', companyIds: [], siteIds: [] } as never;
    expect(workKpiScope(doa, [], '2026-11-05')).toBeNull();
  });
});
