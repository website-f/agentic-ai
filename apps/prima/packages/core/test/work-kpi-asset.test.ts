import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, buildWorkKpi, generateDataset, myt, type Dataset, type WorkKpiScope } from '../src';

// Asset Management work orders and BQs on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['asset'], companyIds: null, label: 'Asset Management' };
const at = (d: string, t: string) => `2026-11-${d}T${t}:00+08:00`;
const step = (by: string, when: string) => ({ by, byId: `u-${by}`, at: when, approve: true, note: 'ok' });

describe('Asset Management work KPI adapter', () => {
  it('times work orders against their due day, the BQ and the award recommendation from arrival; never an approval', () => {
    const data = {
      amWorkOrders: [
        {
          id: 'w1', unitId: 'u1', propertyId: null, title: 'Repaint', source: 'tenant', raisedOn: '2026-11-02', dueOn: '2026-11-06', status: 'done', cost: 100, contractor: 'Contractor A (mock)', doneOn: '2026-11-05',
          bq: {
            jobKind: 'PAINTING', measurements: {}, lines: [], status: 'approved', route: 'RFQ', estimate: 1000, preparedBy: 'AM Exec (mock)', preparedById: 'u-am', preparedAt: at('02', '15:00'),
            director: step('Asset Director (mock)', at('03', '09:00')), coo: null,
            quotes: [{ id: 'q1', contractor: 'A', ref: 'x', receivedOn: '2026-11-03', validUntil: null, lines: [], statedTotal: 900, addedBy: 'AM Exec (mock)', addedById: 'u-am', at: at('03', '10:00') }],
            award: { quoteId: 'q1', total: 900, reason: 'lowest', askedBy: 'AM Exec (mock)', askedById: 'u-am', askedAt: at('03', '11:00'), director: step('Asset Director (mock)', at('03', '15:00')), coo: null, final: true },
            version: 1,
          },
        },
      ],
    } as unknown as Partial<Dataset>;
    const asset = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(asset.work).toEqual([
      expect.objectContaining({ workflow: 'bq', stage: 'prepare', count: 1, medianMinutes: 390 }),
      expect.objectContaining({ workflow: 'bq', stage: 'recommend_award', count: 1, medianMinutes: 60, onTimePct: 100 }),
      expect.objectContaining({ workflow: 'work_order', stage: 'complete', count: 1, onTimePct: 100, target: expect.stringMatching(/own due time/) }),
    ]);
    // The Asset Director approves twice and is never timed.
    expect(asset.people.map((p) => p.name)).not.toContain('Asset Director (mock)');
    expect(asset.notTimed.join(' ')).toMatch(/approvals of BQs/);
    expect(asset.quality[0]).toMatchObject({ workflow: 'bq', finished: 1, reopens: 0, evidenceCompletePct: 100 });
  });

  it('opens Asset Management to the Asset Director only for their own department', async () => {
    const TODAY = '2026-11-05';
    const NOW = myt(TODAY, '10:00');
    const svc = new PrimaService(new MemoryStore(generateDataset({ today: TODAY, now: NOW })), () => NOW);
    const r = await svc.workKpi(await svc.user('u-asset-dir'), '2026-11');
    expect(r.departments.map((d) => d.dept)).toEqual(['asset']);
  });
});
