import { RULES } from "./rules";
import { toMs } from "./time";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import { endOfOfficeDay } from "./work-kpi";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Asset Management work orders and their bills of quantities on the Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will
 * be done for all"). Read-only, no migration.
 *
 * - Completing a work order against its own due day. Work orders keep days only, so the time runs from the start of
 *   the day it was raised to the end of the day it was done.
 * - Preparing the BQ: from the work order being raised to the BQ submitted for approval.
 * - Recommending the award: from the last quote keyed in to the award recommendation (the contractors' own time to
 *   quote is not the team's).
 * The Asset Director's, COO's, CEO's and Chairman's approvals of BQs, awards and variations are never timed.
 */
const DAY_START = (d: IsoDate): IsoDateTime => `${d}T${RULES.staffHours.value.start}:00+08:00`;

registerWorkKpiAdapter({
  id: 'asset-work-orders',
  depts: ['asset'],
  tables: ['amWorkOrders'],
  targets: {
    'asset.work_order.complete': null, // the work order's own due day is the target
    'asset.bq.prepare': 960,
    'asset.bq.recommend_award': 480,
  },
  limits: {
    asset: {
      unknown: ['Work orders record days only, so their time counts from the start of the day raised to the end of the day done', 'A BQ returned and resubmitted keeps only its latest submission, so earlier returns are Unknown'],
      notTimed: ['Asset Director, COO, CEO and Chairman approvals of BQs, awards and variations', 'Contractors’ time to quote'],
    },
  },
  heads: [{ dept: 'asset', is: (u) => u.role === 'pwvsb_officer' && u.department === 'asset' && u.assetRole === 'director' }],
  collect(data, put) {
    for (const w of data.amWorkOrders ?? []) {
      const companyId = null;
      if (w.status === 'done' && w.doneOn)
        put.step({ dept: 'asset', workflow: 'work_order', stage: 'complete', kind: 'work', recordId: w.id, companyId, byId: null, by: 'Work orders (contractor’s work, the team follows up)', arrivedAt: DAY_START(w.raisedOn), doneAt: endOfOfficeDay(w.doneOn), dueAt: endOfOfficeDay(w.dueOn) });
      const bq = w.bq;
      if (!bq) continue;
      if (bq.status !== 'draft')
        put.step({ dept: 'asset', workflow: 'bq', stage: 'prepare', kind: 'work', recordId: w.id, companyId, byId: bq.preparedById, by: bq.preparedBy, arrivedAt: DAY_START(w.raisedOn), doneAt: bq.preparedAt });
      const lastQuote = [...bq.quotes].sort((a, b) => toMs(a.at) - toMs(b.at)).pop();
      if (bq.award && lastQuote)
        put.step({ dept: 'asset', workflow: 'bq', stage: 'recommend_award', kind: 'work', recordId: w.id, companyId, byId: bq.award.askedById, by: bq.award.askedBy, arrivedAt: lastQuote.at, doneAt: bq.award.askedAt });
      if (bq.award?.final)
        put.finished({ dept: 'asset', workflow: 'bq', recordId: w.id, companyId, preparer: bq.preparedBy, finishedAt: (bq.award.coo ?? bq.award.director)?.at ?? bq.award.askedAt, returns: null, reopens: (bq.rounds ?? []).length, evidenceComplete: bq.quotes.length > 0, requesterConfirmed: null });
    }
  },
});