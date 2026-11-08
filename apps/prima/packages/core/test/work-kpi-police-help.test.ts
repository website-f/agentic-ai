import { describe, expect, it } from 'vitest';
import { buildWorkKpi, type Dataset, type WorkKpiScope } from '../src';

// Police call or visit help on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['arms_control'], companyIds: null, label: 'Arms Control' };
const help = (o: object) => ({ kind: 'VISIT_NOW', reason: 'ARMOURY_CHECK', expectedAt: null, policeUnit: 'x', officer: 'x', asked: 'x', contactName: 'x', contactPhone: 'x', step: 'asked', askedById: 'u-cm', helper: null, outcome: null, confirmed: null, returns: [], withdrawn: null, ...o });
const kase = (id: string, openedAt: string, policeHelp: object) => ({ id, ref: id, companyId: 'co-a', siteId: null, type: 'ARMS', severity: 'P1', title: '', description: '', reportedBy: 'CM (mock)', openedAt, slaDueAt: openedAt, status: 'open', owner: null, events: [], policeHelp });

describe('police help work KPI adapter', () => {
  it('times the assignment round the clock and the outcome from the visit, leaves a returned round out, and never times the confirmation', () => {
    const data = {
      cases: [
        // Saturday night: the helper is assigned 10 minutes later.
        kase('p1', '2026-11-07T22:00:00+08:00', help({
          step: 'confirmed',
          helper: { name: 'Helper (mock)', phone: 'x', how: 'ON_SITE', eta: null, assignedById: 'u-ac', assignedBy: 'Arms Officer (mock)', at: '2026-11-07T22:10:00+08:00' },
          outcome: { note: 'ok', followUp: '', byId: 'u-ac', by: 'Arms Officer (mock)', at: '2026-11-07T23:10:00+08:00', proofIds: ['p'] },
          confirmed: { byId: 'u-cm', by: 'CM (mock)', at: '2026-11-08T09:00:00+08:00', note: 'ok' },
        })),
        // Sent back once: the outcome's speed is left out.
        kase('p2', '2026-11-09T09:00:00+08:00', help({
          step: 'helped',
          helper: { name: 'Helper (mock)', phone: 'x', how: 'PHONE', eta: null, assignedById: 'u-ac', assignedBy: 'Arms Officer (mock)', at: '2026-11-09T09:20:00+08:00' },
          outcome: { note: 'ok', followUp: '', byId: 'u-ac', by: 'Arms Officer (mock)', at: '2026-11-09T12:00:00+08:00', proofIds: [] },
          returns: [{ byId: 'u-cm', by: 'CM (mock)', at: '2026-11-09T11:00:00+08:00', note: 'not done' }],
        })),
      ],
    } as unknown as Partial<Dataset>;
    const arms = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(arms.work).toEqual([
      expect.objectContaining({ workflow: 'police_help', stage: 'assign_now', count: 2, medianMinutes: 15, onTimePct: 50, clock: 'round_the_clock' }),
      expect.objectContaining({ workflow: 'police_help', stage: 'outcome', count: 1, medianMinutes: 60 }),
    ]);
    expect(arms.people.map((p) => p.name)).toEqual(['Arms Officer (mock)']);
    expect(arms.quality[0]).toMatchObject({ workflow: 'police_help', finished: 1, returns: 0, requesterConfirmedPct: 100, evidenceCompletePct: 100 });
    expect(arms.notTimed.join(' ')).toMatch(/confirmation/);
  });
  it('keeps an outcome recorded before the police’s expected time, with no wait', () => {
    const data = {
      cases: [
        kase('p3', '2026-11-10T09:00:00+08:00', help({
          kind: 'VISIT_BOOKED', expectedAt: '2026-11-10T15:00:00+08:00', step: 'helped',
          helper: { name: 'Helper (mock)', phone: 'x', how: 'ON_SITE', eta: null, assignedById: 'u-ac', assignedBy: 'Arms Officer (mock)', at: '2026-11-10T10:00:00+08:00' },
          // The police came early.
          outcome: { note: 'ok', followUp: '', byId: 'u-ac', by: 'Arms Officer (mock)', at: '2026-11-10T13:00:00+08:00', proofIds: ['p'] },
        })),
      ],
    } as unknown as Partial<Dataset>;
    const arms = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    expect(arms.work).toEqual(expect.arrayContaining([expect.objectContaining({ workflow: 'police_help', stage: 'outcome', count: 1, medianMinutes: 0 })]));
  });
});
