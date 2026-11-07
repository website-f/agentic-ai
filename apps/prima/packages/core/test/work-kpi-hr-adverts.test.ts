import { describe, expect, it } from 'vitest';
import { buildWorkKpi, type Dataset, type WorkKpiScope } from '../src';

// Job adverts on the Work KPIs screen (rule HR-JOB-ADVERT). Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['hr'], companyIds: null, label: 'HR' };
const at = (t: string) => `2026-11-05T${t}:00+08:00`;
const ev = (action: string, by: string, t: string) => ({ action, by, byId: `u-${by}`, at: at(t), version: 1, note: '' });

describe('HR job advert KPI adapter', () => {
  it('times writing, rework and posting from arrival, never the approval, and keeps hand posts Unknown', () => {
    const data = {
      vacancies: [
        {
          id: 'v1', companyId: 'co-a', status: 'open', head: { by: 'Head (mock)', byId: 'u-h', at: at('09:00'), note: '' }, closed: null,
          advert: {
            writtenBy: 'HR Exec (mock)', manualPosts: [],
            history: [
              ev('draft', 'HR Exec (mock)', '09:10'), ev('submit', 'HR Exec (mock)', '09:40'), ev('return', 'HR Lead (mock)', '10:00'),
              ev('edit', 'HR Exec (mock)', '10:10'), ev('submit', 'HR Exec (mock)', '10:20'), ev('approve', 'HR Lead (mock)', '13:00'),
              ev('record_posted', 'HR Exec (mock)', '14:00'),
            ],
          },
        },
      ],
    } as unknown as Partial<Dataset>;
    const hr = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(hr.work).toEqual([
      expect.objectContaining({ workflow: 'job_advert', stage: 'post', medianMinutes: 60, target: expect.stringMatching(/480 office minutes \(proposed\)/) }),
      expect.objectContaining({ workflow: 'job_advert', stage: 'rework', medianMinutes: 20 }),
      expect.objectContaining({ workflow: 'job_advert', stage: 'write', medianMinutes: 40 }),
    ]);
    // The approver is never timed.
    expect(hr.people.map((p) => p.name)).toEqual(['HR Exec (mock)']);
    expect(hr.quality.find((q) => q.workflow === 'job_advert')).toMatchObject({ finished: 1, returns: 1, firstPassPct: 0, evidenceCompletePct: null });
    expect(hr.notTimed.join(' ')).toMatch(/Approval of a job advert/);
    expect(hr.unknown.join(' ')).toMatch(/Posts made by hand/);
  });
  it('counts an advert once even when it is approved and posted again', () => {
    const data = {
      vacancies: [
        {
          id: 'v2', companyId: 'co-a', status: 'open', head: { by: 'Head (mock)', byId: 'u-h', at: at('09:00'), note: '' }, closed: null,
          advert: {
            writtenBy: 'HR Exec (mock)', manualPosts: [],
            history: [
              ev('submit', 'HR Exec (mock)', '09:30'), ev('approve', 'HR Lead (mock)', '10:00'), ev('record_posted', 'HR Exec (mock)', '10:30'),
              ev('edit', 'HR Exec (mock)', '11:00'), ev('submit', 'HR Exec (mock)', '11:10'), ev('approve', 'HR Lead (mock)', '11:30'), ev('record_posted', 'HR Exec (mock)', '12:00'),
            ],
          },
        },
      ],
    } as unknown as Partial<Dataset>;
    const hr = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(hr.quality.find((q) => q.workflow === 'job_advert')).toMatchObject({ finished: 1 });
  });
});
