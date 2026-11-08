import { describe, expect, it } from 'vitest';
import { buildWorkKpi, workKpiScope, type Dataset, type WorkKpiScope } from '../src';

// Special Ops on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['arms_control', 'cms', 'company_office', 'legal'], companyIds: null, label: 'All' };
const at = (d: string, t: string) => `2026-11-${d}T${t}:00+08:00`;
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;
const log = (action: string, from: string, to: string, by: string, when: string) => ({ action, from, to, by, byId: `u-${by}`, at: when, reason: 'x' });

describe('Special Ops work KPI adapter', () => {
  it('times Arms Control’s review and the requester’s correction from arrival, never the authorisation or spending approval', () => {
    const data = {
      armsRequests: [
        {
          id: 'a1', companyId: 'co-a', ref: 'AR-1', kind: 'SERVICE', state: 'regulator_pending', openedAt: at('03', '09:00'), raisedBy: 'CM (mock)',
          log: [
            log('submit', 'draft', 'arms_review', 'CM (mock)', at('03', '09:00')),
            log('return', 'arms_review', 'draft', 'Arms Officer (mock)', at('03', '10:00')),
            log('resubmit', 'draft', 'arms_review', 'CM (mock)', at('03', '11:00')),
            // A spending approval in between never shortens the reviewer's time.
            log('spend', 'arms_review', 'arms_review', 'COO (mock)', at('03', '11:30')),
            log('pass', 'arms_review', 'company_auth', 'Arms Officer (mock)', at('03', '12:00')),
            log('authorise', 'company_auth', 'regulator_pending', 'CM (mock)', at('04', '09:00')),
          ],
        },
      ],
      siteAlarms: [],
      cmsSettings: [],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    const arms = dept(r, 'arms_control');
    expect(arms.checking).toEqual([expect.objectContaining({ workflow: 'arms_request', stage: 'review', count: 2, medianMinutes: 60 })]);
    expect(arms.people.map((p) => p.name)).toEqual(['Arms Officer (mock)']);
    expect(arms.notTimed.join(' ')).toMatch(/authorisation of an arms request/);
    const co = dept(r, 'company_office');
    // The company manager is timed only on the correction, never on the authorisation.
    expect(co.work).toEqual([expect.objectContaining({ workflow: 'arms_request', stage: 'rework', count: 1, medianMinutes: 60 })]);
  });

  it('times a CMS alarm round the clock against the settings, and keeps a missing acknowledger Unknown', () => {
    const data = {
      armsRequests: [],
      cmsSettings: [{ id: 'cms', alarmAckSec: 60 }],
      siteAlarms: [
        // 2 am on a Saturday: the night shift's work still counts.
        { id: 'al1', companyId: 'co-a', siteId: 's1', kind: 'PANIC', source: 'x', at: '2026-11-07T02:00:00+08:00', status: 'acknowledged', ackAt: '2026-11-07T02:00:45+08:00', ackBy: 'Monitor (mock)', verdict: null, caseId: null, note: null },
        { id: 'al2', companyId: 'co-a', siteId: 's1', kind: 'INTRUSION', source: 'x', at: '2026-11-07T03:00:00+08:00', status: 'acknowledged', ackAt: '2026-11-07T03:04:00+08:00', ackBy: null, verdict: null, caseId: null, note: null },
      ],
    } as unknown as Partial<Dataset>;
    const cms = dept(buildWorkKpi(data, SCOPE, '2026-11'), 'cms');
    expect(cms.work).toEqual([expect.objectContaining({ workflow: 'alarm', stage: 'acknowledge', count: 2, medianMinutes: 2.5, onTimePct: 50, clock: 'round_the_clock' })]);
    expect(cms.people.map((p) => p.name)).toEqual(['Monitor (mock)', 'Not recorded']);
  });
  it('holds only urgent alarms to the acknowledgement seconds and counts one CMS alarm once', () => {
    const data = {
      armsRequests: [],
      cmsSettings: [{ id: 'cms', alarmAckSec: 60 }],
      siteAlarms: [
        { id: 'al1', companyId: 'co-a', siteId: 's1', kind: 'FIRE', cmsAlarmId: 'A1', source: 'x', at: '2026-11-07T02:00:00+08:00', status: 'acknowledged', ackAt: '2026-11-07T02:00:30+08:00', ackBy: 'Monitor (mock)', verdict: null, caseId: null, note: null },
        // A second event of the same CMS alarm: not a second acknowledgement.
        { id: 'al1b', companyId: 'co-a', siteId: 's1', kind: 'FIRE', cmsAlarmId: 'A1', source: 'x', at: '2026-11-07T02:00:10+08:00', status: 'acknowledged', ackAt: '2026-11-07T02:09:00+08:00', ackBy: 'Monitor (mock)', verdict: null, caseId: null, note: null },
        // A lost link has no acknowledgement time set: timed, never judged late.
        { id: 'al3', companyId: 'co-a', siteId: 's1', kind: 'LINK_LOST', source: 'x', at: '2026-11-07T04:00:00+08:00', status: 'acknowledged', ackAt: '2026-11-07T04:10:00+08:00', ackBy: 'Monitor (mock)', verdict: null, caseId: null, note: null },
      ],
    } as unknown as Partial<Dataset>;
    const cms = dept(buildWorkKpi(data, SCOPE, '2026-11'), 'cms');
    expect(cms.work).toEqual([
      expect.objectContaining({ workflow: 'alarm', stage: 'acknowledge', count: 1, onTimePct: 100 }),
      expect.objectContaining({ workflow: 'alarm', stage: 'acknowledge_other', count: 1, onTimePct: null }),
    ]);
  });

  it('lets the Arms Control Manager, not an assistant or the one legal counsel, see the department', () => {
    const u = (title: string, department: string) => ({ id: 'u', name: 'x', title, role: 'pwvsb_officer', department, companyIds: [], siteIds: [] }) as never;
    expect(workKpiScope(u('Arms Control Manager, Arms Control Department', 'arms_control'), [], '2026-11-05')?.depts).toContain('arms_control');
    expect(workKpiScope(u('Arms Control Assistant, Arms Control Department', 'arms_control'), [], '2026-11-05')).toBeNull();
    expect(workKpiScope(u('Legal Counsel, PWVSB', 'legal'), [], '2026-11-05')).toBeNull();
  });
});
