import { describe, expect, it } from 'vitest';
import { buildWorkKpi, type Dataset, type WorkKpiScope } from '../src';

// The FWM permit board on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['fwm'], companyIds: null, label: 'FWM' };

describe('FWM board work KPI adapter', () => {
  it('times FWM’s acknowledgement within the working day and the renewal against the deadline; never leadership acknowledgements', () => {
    // A permit expiring on 2026-12-07: FWM's step (30 days) is reached on Saturday 2026-11-07, so the ack is due on Monday.
    const data = {
      credentials: [
        {
          id: 'cr1', companyId: 'co-a', personId: 'p1', type: 'PLKS_PERMIT', number: 'x', issuedOn: '2025-12-07', expiresOn: '2026-12-07',
          fwAcks: [
            { level: 'FWM', expiresOn: '2026-12-07', by: 'FWM Exec (mock)', byId: 'u-fwm', at: '2026-11-09T10:00:00+08:00', note: '' },
            { level: 'CHIEF_OF_STAFF', expiresOn: '2026-12-07', by: 'CoS (mock)', byId: 'u-cos', at: '2026-11-12T10:00:00+08:00', note: '' },
          ],
        },
        // Not a foreign worker paper: ignored.
        { id: 'cr2', companyId: 'co-a', personId: 'p2', type: 'KDN_VETTING', number: 'x', issuedOn: '2025-01-01', expiresOn: null, fwAcks: [] },
      ],
      fwRenewals: [
        { id: 'r1', companyId: 'co-a', personId: 'p1', paper: 'FOMEMA', expiresOn: '2026-11-30', submittedOn: '2026-11-05', channel: 'FOMEMA', receiptDocIds: ['rc'], note: '', by: 'FWM Exec (mock)', at: '2026-11-05T11:00:00+08:00', doneAt: '2026-11-20T10:00:00+08:00' },
      ],
    } as unknown as Partial<Dataset>;
    const fwm = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(fwm.work).toEqual([
      expect.objectContaining({ workflow: 'paper', stage: 'acknowledge', count: 1, medianMinutes: 90, onTimePct: 100, target: expect.stringMatching(/own due time/) }),
      expect.objectContaining({ workflow: 'paper', stage: 'renewal_submit', count: 1, onTimePct: 100 }),
    ]);
    expect(fwm.people.map((p) => p.name)).toEqual(['FWM Exec (mock)']);
    expect(fwm.notTimed.join(' ')).toMatch(/Chief of Staff, COO and CEO acknowledgements/);
    expect(fwm.quality.find((q) => q.workflow === 'paper')).toMatchObject({ finished: 1, evidenceCompletePct: 100, returns: null });
  });
  it('keeps an acknowledgement made before FWM’s step was reached, with no wait', () => {
    const data = {
      credentials: [
        { id: 'cr3', companyId: 'co-a', personId: 'p1', type: 'PLKS_PERMIT', number: 'x', issuedOn: '2025-12-07', expiresOn: '2026-12-07', fwAcks: [{ level: 'FWM', expiresOn: '2026-12-07', by: 'FWM Exec (mock)', byId: 'u-fwm', at: '2026-11-03T10:00:00+08:00', note: '' }] },
      ],
      fwRenewals: [],
    } as unknown as Partial<Dataset>;
    const fwm = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(fwm.work).toEqual([expect.objectContaining({ workflow: 'paper', stage: 'acknowledge', count: 1, medianMinutes: 0, onTimePct: 100 })]);
  });
});
