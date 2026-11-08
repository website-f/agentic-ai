import { RULES } from "./rules";
import { toMs } from "./time";
import type { HandoverStep } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import { endOfOfficeDay } from "./work-kpi";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Government Ops (Goodwill) and Private Ops (Sasa Team) go-live work on the Work KPIs screen (Fauzan, 5 Nov 2026:
 * "Kpi will be done for all"). Read-only, no migration.
 *
 * - Client complaints are timed by the shared client-complaints adapter (work-kpi-client-complaints.ts).
 * - Goodwill equipment handovers: each hand of the chain (Operations Manager, patrolling officer, guard) timed from the
 *   hand before it, so the Operations Manager is timed on passing the item on, never on the store's issue.
 * - Monthly client invoices: sent by the 10th of the next month (Fauzan, 26 Oct 2026), timed from the 1st.
 */
const DAY_START = (d: IsoDate): IsoDateTime => `${d}T${RULES.staffHours.value.start}:00+08:00`;
function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

registerWorkKpiAdapter({
  id: 'ops-golive',
  depts: ['operations', 'client_relations'],
  tables: ['clientAccounts', 'stockIssues'],
  targets: {
    'operations.equipment_handover.om_receive': 960,
    'operations.equipment_handover.pass_on': 960,
    'client_relations.invoice.send': null, // the 10th of the next month is the target
  },
  limits: {
    operations: {
      unknown: ['The store’s issue to the Operations Manager: Prima does not record when the item was asked for', 'Signatures given on the Operations Manager’s screen are recorded by the OM, so the OM’s name is on those steps'],
      notTimed: ['The company manager’s confirmation of a lost or damaged item'],
    },
    client_relations: { unknown: [], notTimed: [] },
  },
  collect(data, put) {
    for (const a of data.clientAccounts ?? []) {
      for (const inv of a.invoices ?? []) {
        if (!/^\d{4}-\d{2}$/.test(inv.period)) continue;
        const next = nextMonth(inv.period);
        // An invoice sent before the month closed waited nothing: it counts, on time, rather than dropping out.
        const from = DAY_START(`${next}-01`);
        put.step({ dept: 'client_relations', workflow: 'invoice', stage: 'send', kind: 'work', recordId: `${a.id}:${inv.period}`, companyId: a.companyId, byId: null, by: inv.by, arrivedAt: toMs(from) > toMs(inv.at) ? inv.at : from, doneAt: inv.at, dueAt: endOfOfficeDay(`${next}-10`) });
      }
    }
    for (const s of data.stockIssues ?? []) {
      const h = s.handover;
      if (!h) continue;
      const chain: (HandoverStep | null | undefined)[] = [h.om, h.patrol?.step, h.guard];
      if (h.om) put.step({ dept: 'operations', workflow: 'equipment_handover', stage: 'om_receive', kind: 'work', recordId: s.id, companyId: s.companyId, byId: h.omUserId, by: h.omName, arrivedAt: s.issuedAt, doneAt: h.om.at });
      let prev = h.om;
      for (const step of chain.slice(1)) {
        if (!step) continue;
        if (prev) put.step({ dept: 'operations', workflow: 'equipment_handover', stage: 'pass_on', kind: 'work', recordId: s.id, companyId: s.companyId, byId: null, by: step.by, arrivedAt: prev.at, doneAt: step.at });
        prev = step;
      }
      if (h.guard && s.acknowledged) {
        const proof = !!(h.guard.signatureDocId || (h.guard.slipDocIds ?? []).length || (h.guard.photoDocIds ?? []).length);
        put.finished({ dept: 'operations', workflow: 'equipment_handover', recordId: s.id, companyId: s.companyId, preparer: h.omName, finishedAt: h.guard.at, returns: null, reopens: s.disputed ? 1 : 0, evidenceComplete: proof, requesterConfirmed: true });
      }
    }
  },
});