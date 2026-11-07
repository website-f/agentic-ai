import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  buildWorkKpi,
  generateDataset,
  myt,
  officeMinutes,
  registerWorkKpiAdapter,
  unregisterWorkKpiAdapter,
  workKpiCoveredDepts,
  workKpiScope,
  workKpiTargetAt,
  type WorkKpiData,
  type WorkKpiScope,
} from '../src';

// Workflow KPIs across departments (Fauzan, 1 Nov 2026; restarted 5 Nov 2026). Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const ALL: WorkKpiScope = { depts: ['it', 'operations', 'fwm', 'hr', 'chief_of_staff', 'pdpa', 'client_relations', 'finance'], companyIds: null, label: 'All departments' };
const empty = (): WorkKpiData => ({ itTickets: [], cases: [], fwmTasks: [], hostelBills: [], staffClaims: [], expenseRequests: [], pdpaCases: [], clientAccounts: [] });
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;

describe('office minutes', () => {
  it('counts only Monday to Friday, 8.30 am to 5.30 pm Malaysia time', () => {
    // Thursday 5 pm to Friday 9 am: 30 + 30 minutes.
    expect(officeMinutes('2026-11-05T17:00:00+08:00', '2026-11-06T09:00:00+08:00')).toBe(60);
    // Friday 5 pm to Monday 9 am: the weekend does not count.
    expect(officeMinutes('2026-11-06T17:00:00+08:00', '2026-11-09T09:00:00+08:00')).toBe(60);
    // Before opening and after closing do not count.
    expect(officeMinutes('2026-11-05T07:00:00+08:00', '2026-11-05T08:45:00+08:00')).toBe(15);
    expect(officeMinutes('2026-11-05T10:00:00+08:00', '2026-11-05T09:00:00+08:00')).toBe(0);
  });
  it('leaves out public holidays when they are given', () => {
    expect(officeMinutes('2026-11-05T17:00:00+08:00', '2026-11-09T09:00:00+08:00', ['2026-11-06'])).toBe(60);
  });
});

describe('round-the-clock desks', () => {
  it('counts real minutes for a 24-hour desk and office minutes otherwise', () => {
    const d = empty();
    registerWorkKpiAdapter({
      id: 'test-night',
      depts: ['cms'],
      tables: [],
      collect: (_data, put) => {
        // Saturday 2 am alarm, acknowledged 45 minutes later.
        put.step({ dept: 'cms', workflow: 'alarm', stage: 'acknowledge', kind: 'work', recordId: 'a1', companyId: null, byId: null, by: 'Night Monitor (mock)', arrivedAt: '2026-11-07T02:00:00+08:00', doneAt: '2026-11-07T02:45:00+08:00', clock: 'round_the_clock' });
        put.step({ dept: 'cms', workflow: 'report', stage: 'write', kind: 'work', recordId: 'r1', companyId: null, byId: null, by: 'Night Monitor (mock)', arrivedAt: '2026-11-07T02:00:00+08:00', doneAt: '2026-11-07T02:45:00+08:00' });
      },
    });
    try {
      const cms = buildWorkKpi(d, { ...ALL, depts: ['cms'] }, '2026-11').departments[0];
      expect(cms.work).toEqual([
        expect.objectContaining({ workflow: 'alarm', medianMinutes: 45, clock: 'round_the_clock' }),
        expect.objectContaining({ workflow: 'report', medianMinutes: 0, clock: 'office' }),
      ]);
    } finally {
      unregisterWorkKpiAdapter('test-night');
    }
  });
});

describe('targets', () => {
  it('are versioned, held against the version in force when the step happened', () => {
    expect(workKpiTargetAt('it.ticket.resolve_p1', '2026-11-05T10:00:00+08:00')).toEqual({ minutes: 60, version: 1 });
    const versions = [
      { version: 1, from: '2026-01-01T00:00:00+08:00', provisional: true, note: '', minutes: { k: 60 } },
      { version: 2, from: '2026-12-01T00:00:00+08:00', provisional: true, note: '', minutes: { k: 30 } },
    ];
    expect(workKpiTargetAt('k', '2026-11-20T10:00:00+08:00', versions)).toEqual({ minutes: 60, version: 1 });
    expect(workKpiTargetAt('k', '2026-12-02T10:00:00+08:00', versions)).toEqual({ minutes: 30, version: 2 });
    expect(workKpiTargetAt('unknown.key', '2026-12-02T10:00:00+08:00', versions)).toEqual({ minutes: null, version: 2 });
  });
});

describe('measuring from when work reaches the person', () => {
  it('times an IT request from when it was raised to when it was resolved, with reopen and confirmation as quality', () => {
    const d = empty();
    d.itTickets = [
      { id: 't1', ref: 'IT-1', raisedBy: 'Staff A (mock)', raisedById: 'u-a', category: 'M365', priority: 'P1', title: 'x', detail: '', at: '2026-11-05T09:00:00+08:00', assignedTo: 'IT Exec (mock)', assignedToId: 'u-x', status: 'resolved', resolvedAt: '2026-11-05T09:45:00+08:00', resolvedById: 'u-x', resolvedBy: 'IT Exec (mock)', resolution: 'done', confirmedAt: '2026-11-05T10:00:00+08:00', reopened: 0 },
      { id: 't2', ref: 'IT-2', raisedBy: 'Staff B (mock)', raisedById: 'u-b', category: 'M365', priority: 'P1', title: 'y', detail: '', at: '2026-11-05T09:00:00+08:00', assignedTo: 'IT Exec (mock)', status: 'resolved', resolvedAt: '2026-11-05T11:00:00+08:00', resolvedBy: 'IT Exec (mock)', resolution: 'done', confirmedAt: null, reopened: 1 },
    ] as WorkKpiData['itTickets'];
    const r = buildWorkKpi(d, ALL, '2026-11');
    const it = dept(r, 'it');
    // The reopened request is left out of speed: only its last resolve time is known.
    expect(it.work).toEqual([expect.objectContaining({ workflow: 'ticket', stage: 'resolve_p1', count: 1, medianMinutes: 45, onTimePct: 100 })]);
    expect(it.checking).toEqual([]);
    expect(it.quality[0]).toMatchObject({ finished: 2, firstPassPct: 50, reopens: 1, requesterConfirmedPct: 50, returns: null, evidenceCompletePct: null });
    expect(r.provisional).toBe(false);
    expect(r.targetsNote).toMatch(/Approved by the CEO/);
  });

  it('keeps checking apart from staff work and uses the record’s own due date when it has one', () => {
    const d = empty();
    d.fwmTasks = [
      {
        id: 'f1', companyId: 'sasa', personId: 'p1', kind: 'FOMEMA', what: 'x', place: 'y', dueOn: '2026-11-04', omUserId: 'u-om', createdBy: 'FWM (mock)', createdAt: '2026-11-03T09:00:00+08:00',
        status: 'accepted', proofIds: ['d1'], doneNote: 'ok', doneBy: 'OM (mock)', doneAt: '2026-11-05T09:00:00+08:00', reviewNote: 'ok', reviewedBy: 'FWM Exec (mock)', reviewedAt: '2026-11-05T10:00:00+08:00',
      },
    ] as WorkKpiData['fwmTasks'];
    const fwm = dept(buildWorkKpi(d, ALL, '2026-11'), 'fwm');
    expect(fwm.work).toEqual([expect.objectContaining({ stage: 'do', onTimePct: 0, target: expect.stringMatching(/own due time/) })]);
    expect(fwm.checking).toEqual([expect.objectContaining({ stage: 'review', medianMinutes: 60, onTimePct: 100 })]);
    // Earlier rounds are not kept, so returns are unknown, never zero.
    expect(fwm.quality[0]).toMatchObject({ finished: 1, returns: null, firstPassPct: null, evidenceCompletePct: 100 });
  });

  it('does not time approvals', () => {
    const d = empty();
    const step = (by: string, at: string) => ({ userId: `u-${by}`, by, at, note: '' });
    d.expenseRequests = [
      {
        id: 'e1', kind: 'OFFICE', companyId: 'sasa', period: '2026-11', category: 'SUPPLIES', lines: [], total: 10, docIds: ['d'], userId: 'u-cm', requestedBy: 'CM (mock)', createdAt: '2026-11-02T09:00:00+08:00',
        status: 'approved', submittedAt: '2026-11-02T09:00:00+08:00', cosApproval: step('CoS', '2026-11-03T09:00:00+08:00'), cooDecision: step('COO', '2026-11-04T09:00:00+08:00'), returned: null,
      },
    ] as WorkKpiData['expenseRequests'];
    const cos = dept(buildWorkKpi(d, ALL, '2026-11'), 'chief_of_staff');
    expect(cos.work).toEqual([]);
    expect(cos.checking).toEqual([]);
    expect(cos.quality[0]).toMatchObject({ finished: 1, returns: 0, firstPassPct: 100 });
    expect(cos.notTimed.join(' ')).toMatch(/approvals/);
  });

  it('lists people by name, never ranked by speed, and keeps the month', () => {
    const d = empty();
    const t = (id: string, by: string, mins: number, day = '05') => ({
      id, ref: id, raisedBy: 'S', raisedById: 's', category: 'M365', priority: 'P3', title: '', detail: '', at: `2026-11-${day}T09:00:00+08:00`, assignedTo: by, status: 'resolved',
      resolvedAt: `2026-11-${day}T${String(9 + Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00+08:00`, resolvedBy: by, resolution: '', reopened: 0,
    });
    d.itTickets = [t('a', 'Zara (mock)', 5), t('b', 'Adam (mock)', 300), t('c', 'Adam (mock)', 10, '01'.replace('01', '05'))] as WorkKpiData['itTickets'];
    d.itTickets.push({ ...(t('old', 'Old (mock)', 5) as WorkKpiData['itTickets'][number]), at: '2026-10-30T09:00:00+08:00', resolvedAt: '2026-10-30T09:05:00+08:00' });
    const it = dept(buildWorkKpi(d, ALL, '2026-11'), 'it');
    expect(it.people.map((p) => p.name)).toEqual(['Adam (mock)', 'Zara (mock)']);
  });
});

describe('fairness', () => {
  it('does not time a sign-off made by a higher level stepping in', () => {
    const d = empty();
    d.cases = [
      {
        id: 'c1', ref: 'c1', companyId: 'sasa', siteId: 's1', type: 'INCIDENT', severity: 'P2', title: '', description: '', reportedBy: 'g', openedAt: '2026-11-05T09:00:00+08:00', slaDueAt: '2026-11-05T17:00:00+08:00',
        status: 'escalated', owner: null, events: [{ at: '2026-11-05T09:00:00+08:00', by: 'g', action: 'Raised' }], level: 'OM',
        signOffs: [
          { level: 'OFFICER', outcome: 'verified', by: 'Officer (mock)', at: '2026-11-05T09:20:00+08:00', note: '' },
          { level: 'PATROL', outcome: 'verified', by: 'OM stepping in (mock)', at: '2026-11-05T13:00:00+08:00', note: '', stepIn: true },
        ],
      },
    ] as WorkKpiData['cases'];
    const ops = dept(buildWorkKpi(d, ALL, '2026-11'), 'operations');
    expect(ops.checking).toEqual([expect.objectContaining({ stage: 'sign_off', count: 1, medianMinutes: 20 })]);
    expect(ops.people.map((p) => p.name)).toEqual(['Officer (mock)']);
  });
});

describe('who sees the KPIs', () => {
  it('opens to the CEO, COO, ACT Director and HR for every department, and to heads for their own', async () => {
    const { svc } = fresh();
    for (const id of ['u-fauzan', 'u-coo', 'u-audit', 'u-pwvsb-hr', 'u-cos']) {
      const u = await svc.user(id);
      const r = await svc.workKpi(u);
      expect(r.departments.length, id).toBe(workKpiCoveredDepts().length);
    }
    expect((await svc.workKpi(await svc.user('u-fd'))).departments.map((d) => d.dept)).toEqual(['finance']);
    expect((await svc.workKpi(await svc.user('u-it-mgr'))).departments.map((d) => d.dept)).toEqual(['it']);
    expect((await svc.workKpi(await svc.user('u-fwm-mgr'))).departments.map((d) => d.dept)).toEqual(['fwm']);
  });

  it('refuses staff, executives and integrations, on the direct service call too', async () => {
    const { svc, ds } = fresh();
    const ids = ['u-fwm-ex1', 'u-ae-sasa', 'u-ja-sync', 'u-door-sync', 'u-planner-sync', 'u-proc-store1'].filter((id) => ds.users.some((u) => u.id === id));
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ids) {
      await expect(svc.workKpi(await svc.user(id)), id).rejects.toThrow(/workflow KPIs/);
    }
  });

  it('keeps a company manager to their own companies', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const scope = workKpiScope(cm, [], TODAY)!;
    // Plus the company office, once a module covers it.
    expect(scope.depts.filter((d) => d !== 'company_office')).toEqual(['operations', 'client_relations']);
    const d = empty();
    const kase = (id: string, companyId: string) => ({
      id, ref: id, companyId, siteId: null, type: 'COMPLAINT', severity: 'P3', title: '', description: '', reportedBy: 'x', openedAt: '2026-11-05T09:00:00+08:00', slaDueAt: '2026-11-05T17:00:00+08:00',
      status: 'acknowledged', owner: 'OM (mock)', events: [{ at: '2026-11-05T09:00:00+08:00', by: 'x', action: 'Raised' }, { at: '2026-11-05T09:10:00+08:00', by: 'OM (mock)', action: 'Acknowledged' }],
    });
    d.cases = [kase('mine', cm.companyIds[0]), kase('other', 'not-my-company')] as WorkKpiData['cases'];
    const ops = dept(buildWorkKpi(d, scope, '2026-11'), 'operations');
    expect(ops.work).toEqual([expect.objectContaining({ stage: 'acknowledge', count: 1, medianMinutes: 10, onTimePct: 100 })]);
  });

  it('runs on the demo data without errors and never reports a negative time', async () => {
    const { svc } = fresh();
    const r = await svc.workKpi(await svc.user('u-fauzan'), '2026-10');
    for (const d of r.departments) for (const s of [...d.work, ...d.checking]) expect(s.medianMinutes ?? 0).toBeGreaterThanOrEqual(0);
    expect(r.note).toMatch(/never used to grant access/);
  });
});

describe('every department adds its own adapter', () => {
  it('shows a new department once its module registers an adapter, with its head and proposed targets', async () => {
    const { svc, ds } = fresh();
    const coveredBefore = workKpiCoveredDepts().includes('arms_control');
    registerWorkKpiAdapter({
      id: 'test-arms',
      depts: ['arms_control'],
      tables: ['armsRequests'],
      targets: { 'arms_control.request.prepare': 120 },
      limits: { arms_control: { unknown: [], notTimed: ['Company authorisation'] } },
      heads: [{ dept: 'arms_control', is: (u) => u.id === 'u-pwvsb-arms' }],
      collect: (data, put) => {
        for (const r of data.armsRequests ?? []) put.step({ dept: 'arms_control', workflow: 'request', stage: 'prepare', kind: 'work', recordId: r.id, companyId: r.companyId, byId: null, by: 'Arms Officer (mock)', arrivedAt: '2026-11-05T09:00:00+08:00', doneAt: '2026-11-05T10:00:00+08:00' });
      },
    });
    try {
      expect(ds.armsRequests.length).toBeGreaterThan(0);
      const ceo = await svc.workKpi(await svc.user('u-fauzan'), '2026-11');
      const arms = ceo.departments.find((d) => d.dept === 'arms_control')!;
      expect(arms.work).toContainEqual(expect.objectContaining({ stage: 'prepare', medianMinutes: 60, target: expect.stringMatching(/120 office minutes \(proposed\)/) }));
      expect(arms.notTimed).toContain('Company authorisation');
      const head = await svc.workKpi(await svc.user('u-pwvsb-arms'), '2026-11');
      expect(head.departments.map((d) => d.dept)).toEqual(['arms_control']);
    } finally {
      unregisterWorkKpiAdapter('test-arms');
    }
    expect(workKpiCoveredDepts().includes('arms_control')).toBe(coveredBefore);
  });
});
