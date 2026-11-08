import { toMs } from "./time";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Police call or visit help on the Work KPIs screen (Fauzan, 3 Nov 2026; 5 Nov 2026: "Kpi will be done for all").
 * Read-only, no migration.
 *
 * - Assigning a helper: Arms Control's response, timed round the clock from the company's request (the police can call
 *   or arrive at any hour). A call or a visit happening now is kept apart from a booked visit.
 * - Recording the outcome: from the helper's assignment, or the police's expected time if later, to Arms Control's
 *   outcome. A round sent back by the company keeps only the latest outcome, so it is left out of speed.
 * The company's confirmation is its own acceptance, shown as quality, never timed.
 */
registerWorkKpiAdapter({
  id: 'police-help',
  depts: ['arms_control'],
  tables: ['cases'],
  targets: { 'arms_control.police_help.assign_now': 15, 'arms_control.police_help.assign_booked': 240, 'arms_control.police_help.outcome': 240 },
  limits: {
    arms_control: {
      unknown: ['An outcome redone after the company sent it back: only the latest outcome is kept, so that round is left out of speed (the return still counts in quality)'],
      notTimed: ['The company’s confirmation that the help was given'],
    },
  },
  collect(data, put) {
    for (const c of data.cases ?? []) {
      const h = c.policeHelp;
      if (!h) continue;
      if (h.helper)
        put.step({ dept: 'arms_control', workflow: 'police_help', stage: h.kind === 'VISIT_BOOKED' ? 'assign_booked' : 'assign_now', kind: 'work', recordId: c.id, companyId: c.companyId, byId: h.helper.assignedById, by: h.helper.assignedBy, arrivedAt: c.openedAt, doneAt: h.helper.at, clock: 'round_the_clock' });
      if (h.helper && h.outcome && !h.returns.length) {
        const later = h.expectedAt && toMs(h.expectedAt) > toMs(h.helper.at) ? h.expectedAt : h.helper.at;
        // Police who came before the expected time: the outcome waited nothing, it still counts.
        const from = toMs(later) > toMs(h.outcome.at) ? h.outcome.at : later;
        put.step({ dept: 'arms_control', workflow: 'police_help', stage: 'outcome', kind: 'work', recordId: c.id, companyId: c.companyId, byId: h.outcome.byId, by: h.outcome.by, arrivedAt: from, doneAt: h.outcome.at, clock: 'round_the_clock' });
      }
      if (h.step === 'confirmed' && h.confirmed && h.outcome)
        put.finished({ dept: 'arms_control', workflow: 'police_help', recordId: c.id, companyId: c.companyId, preparer: h.outcome.by, finishedAt: h.confirmed.at, returns: h.returns.length, reopens: null, evidenceComplete: h.outcome.proofIds.length > 0, requesterConfirmed: true });
    }
  },
});