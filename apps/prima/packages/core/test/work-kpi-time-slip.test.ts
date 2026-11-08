import { describe, expect, it } from 'vitest';
import { buildWorkKpi, workKpiAdapters, type Dataset, type WorkKpiScope } from '../src';

// Time slips on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['hr'], companyIds: null, label: 'HR' };

describe('time slip KPI adapter', () => {
  it('never times the head’s decision or Prima’s settlement, and says so', () => {
    expect(workKpiAdapters().some((a) => a.id === 'hr-time-slip')).toBe(true);
    const data = {
      timeSlips: [
        {
          id: 's1', userId: 'u-x', userName: 'Staff (mock)', companyId: 'co-a', date: '2026-11-05', from: '10:00', to: '12:00', minutes: 120, reason: 'x',
          requestedAt: '2026-11-04T09:00:00+08:00', status: 'approved', decidedBy: 'Head (mock)', decidedById: 'u-h', decidedAt: '2026-11-04T09:30:00+08:00',
          decisionNote: 'ok', approverMode: 'head', makeUpBy: '2026-12-05', hrNotice: { to: ['u-hr'], seen: ['u-hr'] }, settlement: null,
        },
      ],
    } as unknown as Partial<Dataset>;
    const hr = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(hr.work).toEqual([]);
    expect(hr.checking).toEqual([]);
    expect(hr.people).toEqual([]);
    expect(hr.notTimed.join(' ')).toMatch(/Decisions on time slips/);
    expect(hr.unknown.join(' ')).toMatch(/time slip notice/);
  });
});
