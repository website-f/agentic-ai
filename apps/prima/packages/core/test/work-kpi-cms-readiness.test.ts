import { describe, expect, it } from 'vitest';
import { buildWorkKpi, type Dataset, type WorkKpiScope } from '../src';

// CMS site readiness on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['arms_control'], companyIds: null, label: 'Arms Control' };
const at = (t: string) => `2026-11-05T${t}:00+08:00`;
const ans = (by: string, when: string) => ({ value: 'yes', note: '', ref: 'r', by, byId: `u-${by}`, at: when });

describe('CMS readiness work KPI adapter', () => {
  it('times Arms Control’s check from the last item recorded, keeps earlier returns Unknown, and times nothing that is not passed', () => {
    const data = {
      sites: [
        {
          id: 's1', companyId: 'co-a', name: 'Site 1',
          cmsReadiness: {
            devices: [{ id: 'd1', kind: 'CCTV_RECORDER', by: 'Site Sup (mock)', byId: 'u-s', at: at('09:00') }],
            answers: { survey: ans('Site Sup (mock)', at('09:30')), consent: ans('CM (mock)', at('10:00')) },
            check: { fingerprint: 'f', by: 'Arms Officer (mock)', byId: 'u-a', at: at('11:30'), note: 'ok' },
            returned: null,
          },
        },
        // Returned, not passed: nothing timed.
        { id: 's2', companyId: 'co-a', name: 'Site 2', cmsReadiness: { devices: [], answers: { survey: ans('Site Sup (mock)', at('09:30')) }, check: null, returned: { fingerprint: 'f', by: 'Arms Officer (mock)', byId: 'u-a', at: at('10:00'), note: 'fix' } } },
        { id: 's3', companyId: 'co-a', name: 'Site 3', cmsReadiness: null },
      ],
    } as unknown as Partial<Dataset>;
    const arms = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(arms.checking).toEqual([expect.objectContaining({ workflow: 'cms_readiness', stage: 'check', count: 1, medianMinutes: 90, onTimePct: 100, target: expect.stringMatching(/960 office minutes \(proposed\)/) })]);
    expect(arms.work).toEqual([]);
    expect(arms.quality[0]).toMatchObject({ workflow: 'cms_readiness', finished: 1, returns: null, firstPassPct: null });
    expect(arms.unknown.join(' ')).toMatch(/Recording a site’s devices/);
  });
});
