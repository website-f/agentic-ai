import { describe, expect, it } from 'vitest';
import { buildWorkKpi, type Dataset, type WorkKpiScope } from '../src';

// Cleaning operations and monthly client acknowledgements on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['operations', 'client_relations'], companyIds: null, label: 'All' };
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;
const task = (id: string, o: object) => ({ id, crewId: 'c', type: 'work', areaId: 'a', jobKey: 'j', checksTaskId: null, title: 'Mop lobby', start: '06:00', end: '07:00', minutes: 60, part: null, size: 100, late: false, status: 'planned', doneBy: null, doneById: null, doneAt: null, checkedBy: null, checkedById: null, checkedAt: null, note: '', ...o });

describe('cleaning work KPI adapter', () => {
  it('times jobs round the clock against the plan, the supervisor’s check from done, and the acknowledgement by the 10th', () => {
    const data = {
      cleaningDays: [
        {
          id: 'd1', companyId: 'co-a', siteId: 's1', date: '2026-11-07', status: 'published', tasks: [
            // Saturday 6 am: done at 6.50, checked at 7.10.
            task('t1', { status: 'checked', doneBy: 'Supervisor (mock)', doneById: 'u-s', doneAt: '2026-11-07T06:50:00+08:00', checkedBy: 'Supervisor 2 (mock)', checkedById: 'u-s2', checkedAt: '2026-11-07T07:10:00+08:00' }),
            // Not needed today, and a break: never timed.
            task('t2', { status: 'not_needed' }),
            task('t3', { type: 'break', status: 'done', doneAt: '2026-11-07T09:00:00+08:00', doneBy: 'Supervisor (mock)' }),
          ],
        },
        { id: 'd2', companyId: 'co-a', siteId: 's1', date: '2026-11-08', status: 'draft', tasks: [task('t4', { status: 'done', doneAt: '2026-11-08T06:30:00+08:00' })] },
      ],
      clientAccounts: [{ id: 'ca1', companyId: 'co-a', onboarding: [], workAcks: [{ period: '2026-10', at: '2026-11-06T10:00:00+08:00', by: 'OM (mock)', docId: 'doc', signer: 'x', signedOn: '2026-11-05', outcome: 'complaints', comment: 'x', action: 'y' }] }],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    const ops = dept(r, 'operations');
    expect(ops.work).toEqual([expect.objectContaining({ workflow: 'cleaning_job', stage: 'do', count: 1, medianMinutes: 50, onTimePct: 100, clock: 'round_the_clock' })]);
    expect(ops.checking).toEqual([expect.objectContaining({ workflow: 'cleaning_job', stage: 'check', count: 1, medianMinutes: 20, onTimePct: 100 })]);
    expect(ops.quality[0]).toMatchObject({ workflow: 'cleaning_job', finished: 1, returns: null, firstPassPct: null });
    expect(ops.notTimed.join(' ')).toMatch(/not needed/);
    const cr = dept(r, 'client_relations');
    expect(cr.work).toEqual([expect.objectContaining({ workflow: 'work_ack', stage: 'upload', onTimePct: 100 })]);
    expect(cr.quality[0]).toMatchObject({ workflow: 'work_ack', evidenceCompletePct: 100, requesterConfirmedPct: 0 });
  });
  it('holds a night job ending after midnight to the next morning, and keeps a job done early', () => {
    const data = {
      cleaningDays: [
        {
          id: 'd3', companyId: 'co-a', siteId: 's1', date: '2026-11-07', status: 'published', tasks: [
            // 11 pm to 1 am, done at 12.40 am: on time.
            task('n1', { start: '23:00', end: '01:00', status: 'done', doneBy: 'Supervisor (mock)', doneById: 'u-s', doneAt: '2026-11-08T00:40:00+08:00' }),
            // Planned 6 am, done at 5.50 am: no wait, on time.
            task('n2', { status: 'done', doneBy: 'Supervisor (mock)', doneById: 'u-s', doneAt: '2026-11-07T05:50:00+08:00' }),
          ],
        },
      ],
      clientAccounts: [],
    } as unknown as Partial<Dataset>;
    expect(dept(buildWorkKpi(data, SCOPE, '2026-11'), 'operations').work).toEqual([expect.objectContaining({ workflow: 'cleaning_job', stage: 'do', count: 2, onTimePct: 100 })]);
  });
});
