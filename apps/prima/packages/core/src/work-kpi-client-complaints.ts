import { registerWorkKpiAdapter } from './work-kpi';

/**
 * Client complaints on the Work KPIs screen (Fauzan, 2 Nov 2026: client satisfaction is monitored; 5 Nov 2026: "Kpi
 * will be done for all"). Read-only, no migration. Kept in its own adapter, with the same id wherever it is added
 * (Ops go-live and Client CRM), so a complaint is never counted twice.
 *
 * From the complaint reaching Operations to what was done being recorded. Evidence is the proof attached.
 */
registerWorkKpiAdapter({
  id: 'client-complaints',
  depts: ['operations'],
  tables: ['clientAccounts'],
  targets: { 'operations.complaint.resolve': 960 },
  limits: { operations: { unknown: ['Who resolved a complaint is recorded by name only'], notTimed: [] } },
  collect(data, put) {
    for (const a of data.clientAccounts ?? [])
      for (const c of a.complaints ?? []) {
        if (!c.resolvedAt) continue;
        const recordId = `${a.id}:${c.id}`;
        put.step({ dept: 'operations', workflow: 'complaint', stage: 'resolve', kind: 'work', recordId, companyId: a.companyId, byId: null, by: c.resolvedBy ?? 'Not recorded', arrivedAt: c.at, doneAt: c.resolvedAt });
        put.finished({ dept: 'operations', workflow: 'complaint', recordId, companyId: a.companyId, preparer: c.resolvedBy, finishedAt: c.resolvedAt, returns: null, reopens: null, evidenceComplete: c.docIds.length > 0, requesterConfirmed: null });
      }
  },
});
