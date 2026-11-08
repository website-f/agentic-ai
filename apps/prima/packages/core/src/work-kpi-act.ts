import { toMs } from "./time";
import type { User } from "./types";
import { WORK_KPI_DEPTS } from "./work-kpi";
import { endOfOfficeDay } from "./work-kpi";
import { registerWorkKpiAdapter } from "./work-kpi";
import type { WorkKpiDept } from "./work-kpi";


/**
 * ACT (Audit, Compliance and Transformation) on the Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be done for all").
 * Read-only, no migration.
 *
 * - ACT's assigned audits (workflow, report review, timing, field check): from the assignment to done, against the
 *   audit's due date. Prima keeps only the day it was done, so it counts to the end of that day.
 * - A finding's owner: the plan (from the finding being raised) and the fix (from the plan, or from ACT's failed check),
 *   on time against the owner's own target day. These are the owner's work, shown under the owner's department.
 * - ACT's check of a fix: from the fix to ACT's check.
 * Investigations are restricted to ACT and are never on this screen.
 */
const DEPTS = new Set<string>(WORK_KPI_DEPTS);
/** The department whose work a person's step is: a central department, or the company office for company staff. */
export function workKpiDeptOf(u: Pick<User, 'role' | 'department'> | undefined): WorkKpiDept | null {
  if (!u) return null;
  if (u.role === 'pwvsb_officer') {
    const d = u.department === 'audit' ? 'act' : u.department;
    return d && DEPTS.has(d) ? (d as WorkKpiDept) : null;
  }
  if (u.role === 'company_manager' || u.role === 'admin_exec') return 'company_office';
  return null;
}

registerWorkKpiAdapter({
  id: 'act',
  depts: ['act'],
  tables: ['actAudits', 'actFindings', 'users'],
  targets: {
    'act.audit.do': null, // the audit's own due date is the target
    'act.finding.check': 480,
  },
  limits: {
    act: {
      unknown: [
        'Audits record only the day they were done, so their time counts to the end of that day',
        'A finding owner’s plan and fix show under the owner’s department once that department is on this screen; an owner outside a central department or a company office is not shown (the finding still counts in quality)',
        'ACT checks that sent a fix back: the fix is cleared, so only the check that closed the finding is timed (the send-backs still count in quality)',
      ],
      notTimed: ['Investigations: restricted to ACT, never shown here'],
    },
  },
  heads: [{ dept: 'act', is: (u) => u.role === 'pwvsb_officer' && u.department === 'audit' && u.actRole === 'lead' }],
  collect(data, put) {
    for (const a of data.actAudits ?? []) {
      if (a.kind === 'investigation' || a.investigation) continue;
      if (a.assigned && a.doneOn && a.status === 'done')
        put.step({ dept: 'act', workflow: 'audit', stage: 'do', kind: 'work', recordId: a.id, companyId: a.companyId, byId: null, by: a.by, arrivedAt: a.assigned.at, doneAt: endOfOfficeDay(a.doneOn), dueAt: a.dueOn ? endOfOfficeDay(a.dueOn) : null });
    }
    const users = new Map((data.users ?? []).map((u) => [u.id, u]));
    for (const f of data.actFindings ?? []) {
      const ownerDept = workKpiDeptOf(users.get(f.ownerUserId));
      const due = endOfOfficeDay(f.plan?.targetOn ?? f.dueOn);
      if (f.plan && ownerDept)
        put.step({ dept: ownerDept, workflow: 'act_finding', stage: 'plan', kind: 'work', recordId: f.id, companyId: f.companyId, byId: null, by: f.plan.by, arrivedAt: f.raisedAt, doneAt: f.plan.at, dueAt: endOfOfficeDay(f.dueOn) });
      if (f.plan && f.fix && ownerDept) {
        // A failed ACT check sends the fix back; the redo is timed from that check.
        const failed = f.checks.filter((c) => !c.ok && toMs(c.at) <= toMs(f.fix!.at)).pop();
        put.step({ dept: ownerDept, workflow: 'act_finding', stage: 'fix', kind: 'work', recordId: f.id, companyId: f.companyId, byId: null, by: f.fix.by, arrivedAt: failed?.at ?? f.plan.at, doneAt: f.fix.at, dueAt: due });
      }
      // ACT's checks: each from the fix it checked. A failed check clears the fix, so only the last check is known.
      const last = f.checks[f.checks.length - 1];
      if (f.fix && last && toMs(last.at) >= toMs(f.fix.at))
        put.step({ dept: 'act', workflow: 'finding', stage: 'check', kind: 'check', recordId: f.id, companyId: f.companyId, byId: null, by: last.by, arrivedAt: f.fix.at, doneAt: last.at });
      if (f.status === 'closed' && last)
        put.finished({ dept: 'act', workflow: 'finding', recordId: f.id, companyId: f.companyId, preparer: f.ownerName, finishedAt: last.at, returns: f.checks.filter((c) => !c.ok).length, reopens: null, evidenceComplete: !!f.fix?.proof, requesterConfirmed: null });
    }
  },
});