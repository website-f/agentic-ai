import { describe, expect, it } from 'vitest';
import { buildWorkKpi, workKpiDeptOf, type Dataset, type WorkKpiScope } from '../src';

// ACT on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['act', 'it', 'company_office'], companyIds: null, label: 'All' };
const at = (d: string, t: string) => `2026-11-${d}T${t}:00+08:00`;
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;

describe('ACT work KPI adapter', () => {
  it('maps a person to their department', () => {
    expect(workKpiDeptOf({ role: 'pwvsb_officer', department: 'audit' })).toBe('act');
    expect(workKpiDeptOf({ role: 'pwvsb_officer', department: 'it' })).toBe('it');
    expect(workKpiDeptOf({ role: 'company_manager', department: undefined })).toBe('company_office');
    expect(workKpiDeptOf({ role: 'guard', department: undefined } as never)).toBeNull();
    expect(workKpiDeptOf(undefined)).toBeNull();
  });

  it('times audits against their due day, the owner’s plan and fix under the owner’s department, and ACT’s check; never an investigation', () => {
    const data = {
      users: [{ id: 'u-it', role: 'pwvsb_officer', department: 'it', name: 'IT Lead (mock)' }],
      actAudits: [
        { id: 'a1', kind: 'workflow', status: 'done', area: 'x', companyId: null, dueOn: '2026-11-06', assigned: { by: 'ACT Lead (mock)', at: at('05', '09:00'), note: '' }, doneOn: '2026-11-05', by: 'Auditor (mock)', result: 'clean', note: '', findingIds: [] },
        { id: 'a2', kind: 'investigation', status: 'done', area: 'x', companyId: null, dueOn: null, assigned: { by: 'ACT Lead (mock)', at: at('05', '09:00'), note: '' }, doneOn: '2026-11-05', by: 'Auditor (mock)', result: null, note: '', findingIds: [], investigation: { ref: 'INV-1' } },
      ],
      actFindings: [
        {
          id: 'f1', ref: 'F1', companyId: null, area: 'IT', source: 'workflow_audit', title: '', detail: '', severity: 'medium', evidence: '', raisedBy: 'Auditor (mock)', raisedById: 'u-aud', raisedAt: at('02', '09:00'),
          ownerUserId: 'u-it', ownerName: 'IT Lead (mock)', dueOn: '2026-11-03',
          plan: { rootCause: 'x', solution: 'y', targetOn: '2026-11-05', by: 'IT Lead (mock)', at: at('02', '11:00') },
          fix: { proof: 'p', by: 'IT Lead (mock)', at: at('04', '10:00') },
          checks: [{ ok: false, note: 'not yet', by: 'Auditor (mock)', at: at('03', '10:00') }, { ok: true, note: 'ok', by: 'Auditor (mock)', at: at('04', '11:00') }],
          status: 'closed',
        },
      ],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    const act = dept(r, 'act');
    expect(act.work).toEqual([expect.objectContaining({ workflow: 'audit', stage: 'do', count: 1, onTimePct: 100, target: expect.stringMatching(/own due time/) })]);
    expect(act.checking).toEqual([expect.objectContaining({ workflow: 'finding', stage: 'check', count: 1, medianMinutes: 60 })]);
    expect(act.quality[0]).toMatchObject({ workflow: 'finding', finished: 1, returns: 1, firstPassPct: 0, evidenceCompletePct: 100 });
    expect(act.notTimed.join(' ')).toMatch(/Investigations/);
    const it = dept(r, 'it');
    expect(it.work).toEqual([
      // The redo is timed from ACT's failed check (3 Nov 10:00) to the fix (4 Nov 10:00): one working day.
      expect.objectContaining({ workflow: 'act_finding', stage: 'fix', count: 1, medianMinutes: 540, onTimePct: 100 }),
      expect.objectContaining({ workflow: 'act_finding', stage: 'plan', count: 1, medianMinutes: 120, onTimePct: 100 }),
    ]);
    // Only the non-investigation audit is shown.
    expect(act.people.map((p) => p.name)).toEqual(['Auditor (mock)']);
  });
});
