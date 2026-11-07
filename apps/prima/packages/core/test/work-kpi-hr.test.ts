import { describe, expect, it } from 'vitest';
import { buildWorkKpi, hrFilingWindow, workKpiAdapters, type Dataset, type WorkKpiScope } from '../src';

// HR Phase 3 on the Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be done for all"). Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['hr', 'it'], companyIds: null, label: 'HR, IT' };
const at = (d: string, t: string) => `${d}T${t}:00+08:00`;
const sign = (by: string, when: string) => ({ by, byId: `u-${by}`, at: when, note: 'ok' });

describe('HR work KPI adapter', () => {
  it('is registered once the module loads', () => {
    expect(workKpiAdapters().some((a) => a.id === 'hr-phase3')).toBe(true);
  });

  it('works out the legal window of a filing, and says Unknown when it cannot', () => {
    const people = [{ id: 'p1', hiredOn: '2026-10-01' }];
    expect(hrFilingWindow({ kind: 'CP22', personId: 'p1', period: '2026-10-01' } as never, people)).toEqual({ arose: '2026-10-01', latestBy: '2026-10-31' });
    expect(hrFilingWindow({ kind: 'EPF_REG', personId: 'p1', period: '2026-10-01' } as never, people)).toEqual({ arose: '2026-10-01', latestBy: '2026-11-15' });
    expect(hrFilingWindow({ kind: 'EA', personId: null, period: '2025' } as never, people)).toEqual({ arose: '2026-01-01', latestBy: '2026-02-28' });
    // A staff record Prima cannot see: no window, so no time at all rather than a guess.
    expect(hrFilingWindow({ kind: 'CP22', personId: 'gone', period: '2026-10-01' } as never, people)).toBeNull();
  });

  it('times a filing against the legal day, the login move from authorisation, and never an approval', () => {
    const data = {
      people: [{ id: 'p1', hiredOn: '2026-11-02' }],
      hrFilings: [
        { id: 'CP22-p1-2026-11-02', kind: 'CP22', companyId: 'co-a', personId: 'p1', period: '2026-11-02', ref: 'x', filedOn: '2026-11-03', by: 'HR Exec (mock)', byId: 'u-hr', at: at('2026-11-03', '10:30') },
        { id: 'CP22-gone', kind: 'CP22', companyId: 'co-a', personId: 'gone', period: '2026-11-02', ref: 'x', filedOn: '2026-11-03', by: 'HR Exec (mock)', byId: 'u-hr', at: at('2026-11-03', '11:00') },
      ],
      vacancies: [
        // Approved by the CEO and head, still open: nothing is timed.
        { id: 'v1', companyId: 'co-a', status: 'open', ceo: { ...sign('CEO (mock)', at('2026-11-02', '09:00')), approve: true }, head: sign('Head (mock)', at('2026-11-02', '10:00')), closed: null },
      ],
      loginHandovers: [
        // Authorised before the effective day: IT's clock starts on the effective day, not before.
        { id: 'h1', toCompanyId: 'co-b', effectiveOn: '2026-11-04', status: 'done', authorised: sign('HR Director (mock)', at('2026-11-02', '09:00')), done: sign('IT Exec (mock)', at('2026-11-04', '10:30')) },
      ],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    const hr = r.departments.find((d) => d.dept === 'hr')!;
    const it = r.departments.find((d) => d.dept === 'it')!;
    expect(hr.work).toEqual([expect.objectContaining({ workflow: 'filing', stage: 'file', count: 1, onTimePct: 100, target: expect.stringMatching(/own due time/) })]);
    expect(hr.checking).toEqual([]);
    expect(hr.people.map((p) => p.name)).toEqual(['HR Exec (mock)']);
    expect(hr.notTimed.join(' ')).toMatch(/approval of a vacancy/);
    expect(hr.unknown.join(' ')).toMatch(/HR cases/);
    expect(it.work).toEqual([expect.objectContaining({ workflow: 'login_handover', stage: 'move', count: 1, medianMinutes: 120, onTimePct: 100 })]);
    expect(it.people.map((p) => p.name)).toEqual(['IT Exec (mock)']);
    expect(it.notTimed.join(' ')).toMatch(/authorisation of a login move/);
  });
  it('counts a filing made before the duty arose as on time with no wait, never dropping it', () => {
    const data = {
      people: [{ id: 'p1', hiredOn: '2026-11-10' }],
      // Filed the Friday before the hire day.
      hrFilings: [{ id: 'CP22-early', kind: 'CP22', companyId: 'co-a', personId: 'p1', period: '2026-11-10', ref: 'x', filedOn: '2026-11-06', by: 'HR Exec (mock)', byId: 'u-hr', at: at('2026-11-06', '10:00') }],
    } as unknown as Partial<Dataset>;
    const hr = buildWorkKpi(data, SCOPE, '2026-11').departments.find((d) => d.dept === 'hr')!;
    expect(hr.work).toEqual([expect.objectContaining({ workflow: 'filing', stage: 'file', count: 1, medianMinutes: 0, onTimePct: 100 })]);
  });
});
