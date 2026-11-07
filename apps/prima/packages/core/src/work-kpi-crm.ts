import { RULES } from './rules';
import { addDays } from './time';
import { endOfOfficeDay, registerWorkKpiAdapter } from './work-kpi';

/**
 * The Client CRM on the Work KPIs screen (Fauzan, 4 Nov 2026: "We want complete"; 5 Nov 2026: "Kpi will be done for
 * all"). Read-only, no migration.
 *
 * - A new lead's research (SSM, payment record, current provider, risks): from the lead being created.
 * - A client's request (more or fewer guards, a temporary post, a schedule change): from the request to it being done
 *   or declined, on time against the day the client needs it.
 * - A contract renewal's proposal: from the company's decision on the renewal to the proposal sent to the client.
 * The renewal decision is the company's business decision and is not timed; the client's answer is the client's time.
 * Complaints are timed by the shared client-complaints adapter.
 */
registerWorkKpiAdapter({
  id: 'crm',
  depts: ['client_relations'],
  tables: ['salesLeads', 'clientAccounts'],
  targets: {
    'client_relations.lead.research': 960,
    'client_relations.client_request.close': null, // the day the client needs it, else 14 days (rule CRM-LIFECYCLE, proposed)
    'client_relations.renewal.proposal': null, // to the client by 45 days before the contract ends (Fauzan, 5 Nov 2026)
  },
  limits: {
    client_relations: {
      unknown: ['A lead’s site survey records only the day, so it is not timed', 'Who was given a lead to research: the research is shown under whoever recorded it'],
      notTimed: ['The company’s decision on a renewal (renew, new price, rebid or let go)', 'The client’s answer to a renewal proposal'],
    },
  },
  collect(data, put) {
    for (const l of data.salesLeads ?? [])
      if (l.research)
        put.step({ dept: 'client_relations', workflow: 'lead', stage: 'research', kind: 'work', recordId: l.id, companyId: l.companyId, byId: null, by: l.research.by, arrivedAt: l.createdAt, doneAt: l.research.at });
    for (const a of data.clientAccounts ?? []) {
      for (const r of a.requests ?? [])
        if (r.closedAt && r.status !== 'open')
          put.step({ dept: 'client_relations', workflow: 'client_request', stage: 'close', kind: 'work', recordId: `${a.id}:${r.id}`, companyId: a.companyId, byId: null, by: r.closedBy ?? 'Not recorded', arrivedAt: r.at, doneAt: r.closedAt, dueAt: endOfOfficeDay(r.neededBy ?? addDays(r.at.slice(0, 10), RULES.crm.value.requestDays)) });
      // The open renewal and past ones, each once.
      const renewals = new Map([...(a.renewals ?? []), ...(a.renewal ? [a.renewal] : [])].map((x) => [x.id, x]));
      for (const rn of renewals.values()) {
        if (rn.decision && rn.proposal)
          put.step({ dept: 'client_relations', workflow: 'renewal', stage: 'proposal', kind: 'work', recordId: `${a.id}:${rn.id}`, companyId: a.companyId, byId: null, by: rn.proposal.by, arrivedAt: rn.decision.at, doneAt: rn.proposal.at, dueAt: endOfOfficeDay(addDays(rn.endsOn, -RULES.crm.value.proposalByDays)) });
        // Whether the client renews is a sales outcome, not the quality of the team's work: never a confirmation here.
        if (rn.answer && rn.closedAt)
          put.finished({ dept: 'client_relations', workflow: 'renewal', recordId: `${a.id}:${rn.id}`, companyId: a.companyId, preparer: rn.proposal?.by ?? null, finishedAt: rn.closedAt, returns: null, reopens: null, evidenceComplete: !!rn.answer.docId, requesterConfirmed: null });
      }
    }
  },
});
