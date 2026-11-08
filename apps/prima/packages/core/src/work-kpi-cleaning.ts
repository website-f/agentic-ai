import { RULES } from "./rules";
import { addDays } from "./time";
import { toMs } from "./time";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import { endOfOfficeDay } from "./work-kpi";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Cleaning operations and the monthly client acknowledgement on the Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be
 * done for all"). Read-only, no migration.
 *
 * - Cleaning jobs: done against the published day plan's own end time for the job, timed round the clock (sites are
 *   cleaned outside office hours too) from the job's planned start.
 * - The supervisor's check of a done job: from the job being marked done to the check.
 * - The client's signed acknowledgement of each month's work (all operations): uploaded by the 10th after the month
 *   closes, timed from the 1st.
 * Jobs the supervisor marked not needed that day, and briefings and breaks, are not anyone's timed work.
 */
const MYT = (d: IsoDate, hhmm: string): IsoDateTime => `${d}T${hhmm}:00+08:00`;
const earlier = (a: IsoDateTime, b: IsoDateTime): IsoDateTime => (toMs(a) > toMs(b) ? b : a);
function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

registerWorkKpiAdapter({
  id: 'cleaning-ops',
  depts: ['operations', 'client_relations'],
  tables: ['cleaningDays', 'clientAccounts'],
  targets: {
    'operations.cleaning_job.do': null, // the job's own end time in the published plan is the target
    'operations.cleaning_job.check': 60,
    'client_relations.work_ack.upload': null, // the 10th of the next month is the target
  },
  limits: {
    operations: {
      unknown: ['A cleaning job redone after a check: Prima keeps only its latest done time, so the redo is left out of speed (it still counts in quality)', 'Cleaning jobs are recorded by the supervisor, so the supervisor’s name is on them'],
      notTimed: ['Jobs marked not needed that day, briefings and breaks'],
    },
    client_relations: { unknown: [], notTimed: [] },
  },
  collect(data, put) {
    for (const d of data.cleaningDays ?? []) {
      if (d.status !== 'published') continue;
      for (const t of d.tasks) {
        if (t.type !== 'work' && t.type !== 'inspect' && t.type !== 'round') continue;
        const recordId = `${d.id}:${t.id}`;
        if (t.doneAt && t.status !== 'redo' && /^\d{2}:\d{2}$/.test(t.start) && /^\d{2}:\d{2}$/.test(t.end)) {
          const start = MYT(d.date, t.start);
          // A night job ending after midnight is due the next morning, not before it started.
          const due = t.end <= t.start ? MYT(addDays(d.date, 1), t.end) : MYT(d.date, t.end);
          // A job done before its planned start waited nothing: it counts, on time, rather than dropping out.
          put.step({ dept: 'operations', workflow: 'cleaning_job', stage: 'do', kind: 'work', recordId, companyId: d.companyId, byId: t.doneById, by: t.doneBy ?? 'Not recorded', arrivedAt: earlier(start, t.doneAt), doneAt: t.doneAt, dueAt: due, clock: 'round_the_clock' });
        }
        if (t.doneAt && t.checkedAt)
          put.step({ dept: 'operations', workflow: 'cleaning_job', stage: 'check', kind: 'check', recordId, companyId: d.companyId, byId: t.checkedById, by: t.checkedBy ?? 'Not recorded', arrivedAt: t.doneAt, doneAt: t.checkedAt, clock: 'round_the_clock' });
        if (t.status === 'checked' && t.checkedAt)
          put.finished({ dept: 'operations', workflow: 'cleaning_job', recordId, companyId: d.companyId, preparer: t.doneBy, finishedAt: t.checkedAt, returns: null, reopens: null, evidenceComplete: null, requesterConfirmed: null });
      }
    }
    for (const a of data.clientAccounts ?? []) {
      for (const w of a.workAcks ?? []) {
        if (!/^\d{4}-\d{2}$/.test(w.period)) continue;
        const next = nextMonth(w.period);
        put.step({ dept: 'client_relations', workflow: 'work_ack', stage: 'upload', kind: 'work', recordId: `${a.id}:${w.period}`, companyId: a.companyId, byId: null, by: w.by, arrivedAt: earlier(MYT(`${next}-01`, RULES.staffHours.value.start), w.at), doneAt: w.at, dueAt: endOfOfficeDay(`${next}-10`) });
        put.finished({ dept: 'client_relations', workflow: 'work_ack', recordId: `${a.id}:${w.period}`, companyId: a.companyId, preparer: w.by, finishedAt: w.at, returns: null, reopens: null, evidenceComplete: !!w.docId, requesterConfirmed: w.outcome === 'satisfied' });
      }
    }
  },
});