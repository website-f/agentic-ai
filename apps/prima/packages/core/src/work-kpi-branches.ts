import { RULES } from "./rules";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import { endOfOfficeDay } from "./work-kpi";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Branches and insurance claims on the Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be done for all"). Read-only,
 * no migration. A branch is part of its licensed company (never a separate employer), so its office work shows under
 * the company office, which only that company's head and group leaders see.
 *
 * - A company's query on a branch purchase: from the query to the branch's answer.
 * - A branch business case: Finance's review, from the version reaching Finance.
 * - Insurance claims: telling the insurer (from the incident day; Prima keeps only the day it was told, so it counts
 *   to the end of that day), and Finance recording the money from the company's acceptance of the offer.
 * The company manager's acceptance of an offer is an approval and is not timed; the insurer's own time is not the
 * group's.
 */
const DAY_START = (d: IsoDate): IsoDateTime => `${d}T${RULES.staffHours.value.start}:00+08:00`;

registerWorkKpiAdapter({
  id: 'branches-insurance',
  depts: ['company_office', 'finance'],
  tables: ['branches', 'insuranceClaims'],
  targets: {
    'company_office.branch_purchase_query.answer': 480,
    'finance.branch_business_case.review': 960,
    'company_office.insurance_claim.notify': 2400,
    'finance.insurance_claim.receive': 960,
  },
  limits: {
    company_office: {
      unknown: ['Insurance claims record only the day the insurer was told, so that time counts to the end of the day', 'Daily branch treasury entries are a daily record, not a request, so they are not timed'],
      notTimed: ['The company manager’s acceptance of an insurance offer', 'The insurer’s own assessment time'],
    },
  },
  collect(data, put) {
    for (const b of data.branches ?? []) {
      for (const p of b.purchases ?? [])
        for (const q of p.queries) {
          if (!q.answer) continue;
          put.step({ dept: 'company_office', workflow: 'branch_purchase_query', stage: 'answer', kind: 'work', recordId: `${b.id}:${p.id}:${q.at}`, companyId: b.companyId, byId: null, by: q.answer.by, arrivedAt: q.at, doneAt: q.answer.at });
        }
      for (const c of b.businessCases ?? [])
        if (c.reviewedAt && c.reviewedBy)
          // Finance reviews a branch business case (never one they entered), so the review is Finance's checking.
          put.step({ dept: 'finance', workflow: 'branch_business_case', stage: 'review', kind: 'check', recordId: `${b.id}:v${c.version}`, companyId: b.companyId, byId: c.reviewedById, by: c.reviewedBy, arrivedAt: c.at, doneAt: c.reviewedAt });
    }
    for (const c of data.insuranceClaims ?? []) {
      if (c.notifiedOn && c.openedBy)
        put.step({ dept: 'company_office', workflow: 'insurance_claim', stage: 'notify', kind: 'work', recordId: c.id, companyId: c.companyId, byId: c.openedById ?? null, by: c.openedBy, arrivedAt: DAY_START(c.incidentOn), doneAt: endOfOfficeDay(c.notifiedOn) });
      if (c.accepted && c.received)
        put.step({ dept: 'finance', workflow: 'insurance_claim', stage: 'receive', kind: 'work', recordId: c.id, companyId: c.companyId, byId: c.received.byId, by: c.received.by, arrivedAt: c.accepted.at, doneAt: c.received.at });
      if (c.status === 'settled' && c.received)
        put.finished({ dept: 'company_office', workflow: 'insurance_claim', recordId: c.id, companyId: c.companyId, preparer: c.openedBy ?? null, finishedAt: c.received.at, returns: null, reopens: null, evidenceComplete: (c.docs ?? []).length > 0, requesterConfirmed: null });
    }
  },
});