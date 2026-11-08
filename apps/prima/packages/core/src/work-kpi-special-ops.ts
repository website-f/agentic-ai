import type { ArmsRequest } from "./types";
import type { IsoDateTime } from "./types";
import { toMs } from "./time";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Special Ops (Phase 4) on the Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be done for all"). Read-only, no
 * migration.
 *
 * - Arms requests: Arms Control's review, the requester's correction after a return, PWVSB legal's check, and Arms
 *   Control's verification and register reconciliation, each timed from when the request reached that step (the log
 *   entry that moved it there, so a COO spending approval in between never shortens anyone's time). The company
 *   manager's authorisation and the COO's or CEO's spending approval are approvals and are not timed; the police's time
 *   is not anyone's in the group.
 * - CMS alarms: acknowledging an alarm, timed round the clock (CMS is manned 24 hours), on time against the alarm
 *   acknowledgement seconds in the CMS settings.
 */
const ARRIVED_BY: Partial<Record<string, { dept: 'arms_control' | 'company_office' | 'legal'; stage: string; kind: 'work' | 'check' }>> = {
  pass: { dept: 'arms_control', stage: 'review', kind: 'check' },
  return: { dept: 'arms_control', stage: 'review', kind: 'check' },
  resubmit: { dept: 'company_office', stage: 'rework', kind: 'work' },
  legal_ok: { dept: 'legal', stage: 'legal_check', kind: 'check' },
  legal_stop: { dept: 'legal', stage: 'legal_check', kind: 'check' },
  verify: { dept: 'arms_control', stage: 'verify', kind: 'check' },
  reconcile: { dept: 'arms_control', stage: 'reconcile', kind: 'work' },
};

/** When the request reached the state a log entry starts from: the latest earlier entry that moved it into that state. */
function reachedAt(r: ArmsRequest, i: number): IsoDateTime | null {
  const log = r.log ?? [];
  const from = log[i].from;
  for (let j = i - 1; j >= 0; j -= 1) if (log[j].to === from && log[j].from !== log[j].to) return log[j].at;
  // The first submission moves draft to review at raising; nothing earlier is kept.
  return from === 'arms_review' || from === 'submitted' ? r.openedAt : null;
}

const URGENT = new Set<string>(['GUARD_SOS', 'PANIC', 'INTRUSION', 'FIRE']);

registerWorkKpiAdapter({
  id: 'special-ops',
  depts: ['arms_control', 'cms', 'company_office', 'legal'],
  tables: ['armsRequests', 'siteAlarms', 'cmsSettings'],
  targets: {
    'arms_control.arms_request.review': 480,
    'arms_control.arms_request.verify': 960,
    'arms_control.arms_request.reconcile': 480,
    'company_office.arms_request.rework': 960,
    'legal.arms_request.legal_check': 960,
    'cms.alarm.acknowledge': null, // the CMS settings' acknowledgement seconds are the target (panic, SOS, intrusion, fire)
    'cms.alarm.acknowledge_other': null, // no acknowledgement time is set for camera tamper, link lost or other events
  },
  limits: {
    arms_control: {
      unknown: ['Vault watches and firearm issue and return are checked against their own schedule on the Arms screens, not as work speed'],
      notTimed: ['The company manager’s authorisation of an arms request', 'The COO’s or CEO’s spending approval', 'The police’s and the regulator’s own time'],
    },
    cms: {
      unknown: ['When a false alarm was closed: Prima keeps the closer, not the time, so the Head Control review of false alarms is not timed', 'Changes to the acknowledgement time in the CMS settings: each alarm is held against the current setting'],
      notTimed: [],
    },
    legal: { unknown: [], notTimed: [] },
  },
  // The Arms Control Manager is the department's head (found by title, as the Arms Control screens do); assistants do
  // not see colleagues' KPIs. Legal is one counsel: no standing view of their own KPIs (Fauzan, 1 Nov 2026).
  heads: [{ dept: 'arms_control', is: (u) => u.role === 'pwvsb_officer' && u.department === 'arms_control' && /\bManager\b/.test(u.title ?? '') }],
  collect(data, put) {
    for (const r of data.armsRequests ?? []) {
      const log = r.log ?? [];
      log.forEach((e, i) => {
        const s = ARRIVED_BY[e.action];
        if (!s) return;
        const arrived = reachedAt(r, i);
        if (!arrived) return;
        put.step({ dept: s.dept, workflow: 'arms_request', stage: s.stage, kind: s.kind, recordId: r.id, companyId: r.companyId, byId: e.byId, by: e.by, arrivedAt: arrived, doneAt: e.at });
      });
      const closed = [...log].reverse().find((e) => e.to === 'closed' || e.to === 'reconciled');
      if (closed && (r.state === 'closed' || r.state === 'reconciled'))
        put.finished({ dept: 'arms_control', workflow: 'arms_request', recordId: r.id, companyId: r.companyId, preparer: r.raisedBy, finishedAt: closed.at, returns: log.filter((e) => e.action === 'return').length, reopens: null, evidenceComplete: null, requesterConfirmed: null });
    }
    const settings = (data.cmsSettings ?? [])[0] as { alarmAckSec?: number } | undefined;
    const ackSec = typeof settings?.alarmAckSec === 'number' ? settings.alarmAckSec : null;
    // One alarm from the CMS app may arrive as several events: only its first row is the operator's acknowledgement.
    const seen = new Set<string>();
    for (const a of [...(data.siteAlarms ?? [])].sort((x, y) => toMs(x.at) - toMs(y.at))) {
      if (!a.ackAt) continue;
      if (a.cmsAlarmId) {
        if (seen.has(a.cmsAlarmId)) continue;
        seen.add(a.cmsAlarmId);
      }
      // The acknowledgement seconds apply to panic, SOS, intrusion and fire only; other events are timed without a target.
      const urgent = URGENT.has(a.kind);
      put.step({
        dept: 'cms', workflow: 'alarm', stage: urgent ? 'acknowledge' : 'acknowledge_other', kind: 'work', recordId: a.id, companyId: a.companyId, byId: null, by: a.ackBy ?? 'Not recorded',
        arrivedAt: a.at, doneAt: a.ackAt, clock: 'round_the_clock', dueAt: urgent && ackSec != null ? new Date(toMs(a.at) + ackSec * 1000).toISOString() : null,
      });
      if (a.status === 'closed')
        put.finished({ dept: 'cms', workflow: 'alarm', recordId: a.id, companyId: a.companyId, preparer: a.ackBy, finishedAt: a.ackAt, returns: a.falseReview ? (a.falseReview.agree ? 0 : 1) : null, reopens: null, evidenceComplete: null, requesterConfirmed: null });
    }
  },
});