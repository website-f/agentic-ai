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
        put.finished({ dept: 'asset', workflow: 'bq', recordId: w.id, companyId, preparer: bq.preparedBy, finishedAt: (bq.award.ceo ?? bq.award.vc ?? bq.award.coo ?? bq.award.director)?.at ?? bq.award.askedAt, returns: null, reopens: (bq.rounds ?? []).length, evidenceComplete: bq.quotes.length > 0, requesterConfirmed: null });
    }
  },
});
/**
 * Office repairs and staff house stays on the Work KPIs screen (Asset Management department check, 23 Nov 2026, gap 2).
 * Read from each record's own history, so no migration. Targets come from the rules already in force:
 * - Office repair (AM-OFFICE, in force 18 Nov 2026): check within 1 office hour of the report, quotes within 2 office
 *   hours of the check, and the repair finished within the set days of the start (the due day is the target).
 * - Staff house stay (AM-SHORT-STAY): the Asset team answers a request (hold, return or not available) within 10 minutes.
 * The Asset Director's, Vice Chairman's, operations head's and CEO's approvals are never timed.
 */
const firstAfter = (h: { at: IsoDateTime; action: string }[], action: string, from = 0) => h.slice(from).find((x) => x.action === action) ?? null;

registerWorkKpiAdapter({
  id: 'asset-office-and-stays',
  depts: ['asset'],
  tables: ['officeAmRecs', 'stayRequests'],
  targets: {
    'asset.office_repair.check': RULES.officeAm.value.repair.checkHours * 60,
    'asset.office_repair.quotes': RULES.officeAm.value.repair.quotesHours * 60,
    'asset.office_repair.repair': null, // the start day plus the set repair days is the target
    'asset.staff_stay.answer': 10,
  },
  limits: {
    asset: {
      unknown: ['An office repair reopened after a turn-down keeps only its first check and quotes', 'Rental homes keep their own clocks on the Rumah sewa screen and are not yet on this screen'],
      notTimed: ['Asset Director, Vice Chairman, operations head and CEO approvals of office repairs and buys', 'The requester’s confirmation of finished work'],
    },
  },
  collect(data, put) {
    const repairDays = RULES.officeAm.value.repair.repairDays;
    for (const r of data.officeAmRecs ?? []) {
      if (r.kind !== 'repair') continue;
      const h = r.history ?? [];
      const created = h[0] ?? null;
      if (!created) continue;
      const iChecked = h.findIndex((x) => x.action === 'accepted');
      const checked = iChecked >= 0 ? h[iChecked] : null;
      const companyId = r.companyId ?? null;
      if (checked) put.step({ dept: 'asset', workflow: 'office_repair', stage: 'check', kind: 'work', recordId: r.id, companyId, byId: checked.byId, by: checked.by, arrivedAt: created.at, doneAt: checked.at });
      const quoted = checked ? firstAfter(h, 'quotes', iChecked) : null;
      if (checked && quoted) put.step({ dept: 'asset', workflow: 'office_repair', stage: 'quotes', kind: 'work', recordId: r.id, companyId, byId: (quoted as { byId?: string }).byId ?? null, by: (quoted as { by?: string }).by ?? '', arrivedAt: checked.at, doneAt: quoted.at });
      const iStart = h.findIndex((x) => x.action === 'start');
      const done = iStart >= 0 ? firstAfter(h, 'work_done', iStart) : null;
      if (iStart >= 0 && done) {
        const startOn = h[iStart].at.slice(0, 10) as IsoDate;
        const due = new Date(`${startOn}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() + repairDays);
        put.step({ dept: 'asset', workflow: 'office_repair', stage: 'repair', kind: 'work', recordId: r.id, companyId, byId: null, by: 'Office repairs (contractor’s work, the unit follows up)', arrivedAt: h[iStart].at, doneAt: done.at, dueAt: endOfOfficeDay(due.toISOString().slice(0, 10) as IsoDate) });
      }
    }
    for (const s of data.stayRequests ?? []) {
      const answer = (s.history ?? []).find((x) => toMs(x.at) > toMs(s.at) && x.by !== s.requester && /^(Held at|Confirmed at|Returned for correction|Not available)/.test(x.what));
      if (answer) put.step({ dept: 'asset', workflow: 'staff_stay', stage: 'answer', kind: 'work', recordId: s.id, companyId: null, byId: null, by: answer.by, arrivedAt: s.at, doneAt: answer.at });
    }
  },
});
