import { describe, expect, it } from 'vitest';
import { buildWorkKpi, type Dataset, type WorkKpiScope } from '../src';

// Branches and insurance claims on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['company_office', 'finance'], companyIds: null, label: 'All' };
const at = (d: string, t: string) => `2026-11-${d}T${t}:00+08:00`;
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;

describe('branches and insurance work KPI adapter', () => {
  it('times query answers, business case reviews, notice to the insurer and Finance’s receipt; never the offer acceptance', () => {
    const data = {
      branches: [
        {
          id: 'b1', companyId: 'co-a',
          purchases: [{ id: 'p1', queries: [{ at: at('05', '09:00'), by: 'CM (mock)', byId: 'u-cm', text: '?', answer: { at: at('05', '10:30'), by: 'Branch Mgr (mock)', text: 'ok' } }, { at: at('05', '11:00'), by: 'CM (mock)', byId: 'u-cm', text: '?', answer: null }] }],
          businessCases: [{ version: 1, by: 'Branch Mgr (mock)', byId: 'u-bm', at: at('04', '09:00'), reviewedBy: 'Finance (mock)', reviewedById: 'u-fin', reviewedAt: at('04', '11:00'), reviewNote: 'ok' }],
        },
      ],
      insuranceClaims: [
        {
          id: 'ic1', companyId: 'co-a', incidentOn: '2026-11-02', notifiedOn: '2026-11-03', status: 'settled', openedBy: 'Exec (mock)', openedById: 'u-e', docs: [{ name: 'police report', ref: 'r', by: 'Exec (mock)', at: at('03', '09:00') }],
          accepted: { by: 'CM (mock)', byId: 'u-cm', at: at('05', '09:00'), note: 'ok' },
          received: { bankRef: 'b', on: '2026-11-05', by: 'Finance Exec (mock)', byId: 'u-f', at: at('05', '15:00') },
        },
      ],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    const co = dept(r, 'company_office');
    expect(co.work).toEqual([
      expect.objectContaining({ workflow: 'branch_purchase_query', stage: 'answer', count: 1, medianMinutes: 90 }),
      // Incident on 2 Nov, told on 3 Nov: two office days at most.
      expect.objectContaining({ workflow: 'insurance_claim', stage: 'notify', count: 1, medianMinutes: 1080, onTimePct: 100 }),
    ]);
    // Finance reviews a branch business case: it is Finance's checking, not the company office's.
    expect(co.checking).toEqual([]);
    expect(dept(r, 'finance').checking).toEqual([expect.objectContaining({ workflow: 'branch_business_case', stage: 'review', medianMinutes: 120 })]);
    expect(co.people.map((p) => p.name)).toEqual(['Branch Mgr (mock)', 'Exec (mock)']);
    expect(co.notTimed.join(' ')).toMatch(/acceptance of an insurance offer/);
    expect(dept(r, 'finance').work).toEqual([expect.objectContaining({ workflow: 'insurance_claim', stage: 'receive', medianMinutes: 360 })]);
  });
});
