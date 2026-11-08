import { describe, expect, it } from 'vitest';
import { FIN_AUTO, buildWorkKpi, workKpiAdapters, type Dataset, type WorkKpiScope } from '../src';

// Finance on the group Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be done for all"). Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['finance'], companyIds: null, label: 'Finance' };
const st = (step: string, by: string, at: string, byId = `u-${by}`) => ({ step, by, byId, at: `2026-11-05T${at}:00+08:00`, comment: '' });

describe('Finance work KPI adapter', () => {
  it('is registered once the module loads', () => {
    expect(workKpiAdapters().some((a) => a.id === 'finance-payments-closes')).toBe(true);
  });

  it('times review and rework from arrival, leaves approvals and automatic lapses untimed, and keeps preparation Unknown', () => {
    const payment = {
      id: 'p1', companyId: 'co-a', evidence: ['invoice.pdf'], status: 'released',
      steps: [
        st('prepared', 'Exec (mock)', '09:00'),
        st('reviewed', 'Leader (mock)', '09:10'),
        st('approved', 'FD (mock)', '11:00'),
        { ...st('returned', FIN_AUTO.by, '12:00'), byId: FIN_AUTO.byId },
        st('resubmitted', 'Exec (mock)', '12:30'),
        st('reviewed', 'Leader (mock)', '12:40'),
        st('approved', 'FD (mock)', '14:00'),
        st('released', 'Exec 2 (mock)', '14:15'),
      ],
    };
    const close = {
      id: 'c1', status: 'approved', bankRecRefs: [], explanations: [],
      steps: [st('prepared', 'Exec (mock)', '09:00'), st('returned', 'Leader (mock)', '09:30'), st('prepared', 'Exec (mock)', '10:00'), st('reviewed', 'Leader (mock)', '11:00'), st('approved', 'FD (mock)', '15:00')],
    };
    const data = { finStatus: [{ id: 'fin-co-a', companyId: 'co-a', team: 1, payments: [payment], closes: [close] }] } as unknown as Partial<Dataset>;
    const fin = buildWorkKpi(data, SCOPE, '2026-11').departments[0];

    expect(fin.checking).toEqual([
      expect.objectContaining({ workflow: 'close', stage: 'review', count: 1, medianMinutes: 60, target: expect.stringMatching(/90 office minutes \(proposed\)/) }),
      expect.objectContaining({ workflow: 'payment', stage: 'release', count: 1, medianMinutes: 15 }),
      expect.objectContaining({ workflow: 'payment', stage: 'review', count: 2, medianMinutes: 10, onTimePct: 100 }),
    ]);
    // Rework is staff work, timed from the return (here an automatic lapse) reaching the preparer.
    expect(fin.work).toEqual([expect.objectContaining({ workflow: 'payment', stage: 'rework', count: 1, medianMinutes: 30 })]);
    // Approvals and Prima's own lapse are never anyone's timed step.
    expect(fin.people.map((p) => p.name)).toEqual(['Exec (mock)', 'Exec 2 (mock)', 'Leader (mock)']);
    expect(fin.notTimed.join(' ')).toMatch(/Approvals/);
    expect(fin.unknown.join(' ')).toMatch(/Time to prepare/);
    // The lapse is not a return; the close's return counts against the preparer.
    expect(fin.quality).toEqual([
      expect.objectContaining({ workflow: 'close', finished: 1, returns: 1, reopens: 0, firstPassPct: 0, evidenceCompletePct: 0 }),
      expect.objectContaining({ workflow: 'payment', finished: 1, returns: 0, reopens: null, firstPassPct: 100, evidenceCompletePct: 100, requesterConfirmedPct: null }),
    ]);
  });
});
