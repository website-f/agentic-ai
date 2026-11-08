import { FW_ACK_FROM } from "./fw";
import { FW_PAPERS } from "./fw";
import { addFwWorkingDays } from "./fw";
import { fwDeadline } from "./fw";
import { RULES } from "./rules";
import { addDays } from "./time";
import { toMs } from "./time";
import type { FwPaper } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import { endOfOfficeDay } from "./work-kpi";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * The FWM permit board on the Work KPIs screen (FW design v3; Fauzan, 5 Nov 2026: "Kpi will be done for all").
 * Read-only, no migration.
 *
 * - FWM's acknowledgement of a paper at 30 days (rule FWM-ACK): from the day the paper reached FWM's step to the
 *   acknowledgement, on time within the rule's working days.
 * - Submitting a renewal: from the paper entering the ladder (120 days) to FWM's submission with its receipt, on time
 *   against the paper's own deadline.
 * The Chief of Staff's, COO's and CEO's acknowledgements are leadership oversight and are not timed. The agency's time
 * to issue the new paper is not the group's.
 */
const DAY_START = (d: IsoDate): IsoDateTime => `${d}T${RULES.staffHours.value.start}:00+08:00`;
// Work done before it formally reached FWM (acknowledged or submitted early) waited nothing: it counts, on time.
const earlier = (a: IsoDateTime, b: IsoDateTime): IsoDateTime => (toMs(a) > toMs(b) ? b : a);
const isPaper = (t: string): t is FwPaper => (FW_PAPERS as string[]).includes(t);

registerWorkKpiAdapter({
  id: 'fwm-board',
  depts: ['fwm'],
  tables: ['credentials', 'fwRenewals'],
  targets: {
    'fwm.paper.acknowledge': null, // the rule's working days are the target
    'fwm.paper.renewal_submit': null, // the paper's own deadline is the target
  },
  limits: {
    fwm: {
      unknown: ['Papers kept in the JA app and only read here: an acknowledgement or renewal recorded in JA is not timed in Prima'],
      notTimed: ['Chief of Staff, COO and CEO acknowledgements of papers near expiry', 'The agency’s time to issue the new paper'],
    },
  },
  collect(data, put) {
    for (const c of data.credentials ?? []) {
      if (!isPaper(c.type)) continue;
      for (const a of c.fwAcks ?? []) {
        if (a.level !== 'FWM') continue;
        const reached = addDays(fwDeadline(c.type, a.expiresOn), -FW_ACK_FROM.FWM);
        const due = addFwWorkingDays(reached, RULES.fwmAck.value.workingDays);
        put.step({ dept: 'fwm', workflow: 'paper', stage: 'acknowledge', kind: 'work', recordId: `${c.id}:${a.expiresOn}`, companyId: c.companyId, byId: a.byId, by: a.by, arrivedAt: earlier(DAY_START(reached), a.at), doneAt: a.at, dueAt: endOfOfficeDay(due) });
      }
    }
    const ladderStart = Math.max(...RULES.fwmLadder.value);
    for (const r of data.fwRenewals ?? []) {
      const deadline = fwDeadline(r.paper, r.expiresOn);
      put.step({ dept: 'fwm', workflow: 'paper', stage: 'renewal_submit', kind: 'work', recordId: r.id, companyId: r.companyId, byId: null, by: r.by, arrivedAt: earlier(DAY_START(addDays(deadline, -ladderStart)), r.at), doneAt: r.at, dueAt: endOfOfficeDay(deadline) });
      if (r.doneAt)
        put.finished({ dept: 'fwm', workflow: 'paper', recordId: r.id, companyId: r.companyId, preparer: r.by, finishedAt: r.doneAt, returns: null, reopens: null, evidenceComplete: r.receiptDocIds.length > 0, requesterConfirmed: null });
    }
  },
});