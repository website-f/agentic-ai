import type { PurRequest } from './types';
import { registerWorkKpiAdapter } from './work-kpi';

/**
 * Buying on the Work KPIs screen (Fauzan, 23 Nov 2026 "Do the gap": purchases were not timed at all). Read from the
 * steps a purchase already keeps; read-only, no migration.
 * - Quoting: from the request to "sent for approval" (Procurement's 3 quotes and online price). Requests sent before
 *   23 Nov 2026 kept no sending time, so they are left out (Unknown).
 * - Ordering: from the last approval to the order placed (Procurement).
 * - Invoice match: from goods received to Finance matching the invoice.
 * The COO and CEO approvals are approvals, and the supplier's delivery is the supplier's time (it shows on the supplier's
 * record), so neither is timed here. Targets stay empty until the OGM or the Inventory Manager proposes them.
 */
registerWorkKpiAdapter({
  id: 'procurement-purchases',
  depts: ['procurement'],
  tables: ['purRequests'],
  targets: {
    'procurement.purchase.quote': null,
    'procurement.purchase.order': null,
    'procurement.purchase.invoice_match': null,
  },
  limits: {
    procurement: {
      unknown: ['Quoting time of purchases sent for approval before 23 Nov 2026 (the sending time was not kept)'],
      notTimed: ['COO and CEO approvals of purchases', "The supplier's delivery time (shown on each supplier's record instead)"],
    },
  },
  heads: [{ dept: 'procurement', is: (u) => u.role === 'pwvsb_officer' && u.department === 'procurement' && u.procRole === 'manager' }],
  collect(data, put) {
    for (const r of (data.purRequests ?? []) as PurRequest[]) {
      const base = { dept: 'procurement' as const, workflow: 'purchase', recordId: r.id, companyId: r.companyId };
      if (r.submitted) put.step({ ...base, stage: 'quote', kind: 'work', byId: r.submitted.byId, by: r.submitted.by, arrivedAt: r.at, doneAt: r.submitted.at });
      const lastApproval = r.approvals.at(-1);
      if (r.po && lastApproval && r.approvals.length === r.tiers.length)
        put.step({ ...base, stage: 'order', kind: 'work', byId: null, by: r.po.by, arrivedAt: lastApproval.at, doneAt: r.po.at });
      if (r.grn && r.invoice) put.step({ ...base, stage: 'invoice_match', kind: 'work', byId: null, by: r.invoice.by, arrivedAt: r.grn.at, doneAt: r.invoice.at });
      if (r.status === 'posted' && r.posted)
        put.finished({ ...base, preparer: r.submitted?.by ?? null, finishedAt: r.posted.at, returns: (r.rounds ?? []).length, reopens: null, evidenceComplete: r.quotes.every((q) => (q.docIds ?? []).length > 0) && (r.online ?? []).every((o) => (o.docIds ?? []).length > 0), requesterConfirmed: null });
    }
  },
});
