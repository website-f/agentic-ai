import { registerWorkKpiAdapter } from './work-kpi';

/**
 * Job adverts for open posts on the Work KPIs screen (rule HR-JOB-ADVERT; Fauzan, 5 Nov 2026: "Kpi will be done for
 * all"). Read-only, no migration.
 *
 * - Writing the advert: from the head's signature that opens the post to HR's first submission for approval.
 * - Rework: from a return to the next submission.
 * - Posting by hand: from the approval to the first post HR records (social publishing is switched off).
 * The approval itself is never timed. A post HR records by hand is not checked by Prima, so it is not evidence.
 */
registerWorkKpiAdapter({
  id: 'hr-job-adverts',
  depts: ['hr'],
  tables: ['vacancies'],
  targets: { 'hr.job_advert.write': 480, 'hr.job_advert.rework': 240, 'hr.job_advert.post': 480 },
  limits: {
    hr: {
      unknown: ['Posts made by hand on social media: Prima has not checked them, so evidence is Unknown'],
      notTimed: ['Approval of a job advert (by someone other than its writer)'],
    },
  },
  collect(data, put) {
    for (const v of data.vacancies ?? []) {
      const a = v.advert;
      if (!a || !v.head) continue;
      const h = [...a.history].sort((x, y) => x.at.localeCompare(y.at));
      let prev: { at: string; action: string } = { at: v.head.at, action: 'opened' };
      let returns = 0;
      let finished = false;
      for (const e of h) {
        if (e.action === 'submit') {
          const rework = prev.action === 'return';
          // The first submission is timed from when the post opened; later drafts and edits are part of the same work.
          if (rework || prev.action === 'opened')
            put.step({ dept: 'hr', workflow: 'job_advert', stage: rework ? 'rework' : 'write', kind: 'work', recordId: v.id, companyId: v.companyId, byId: e.byId, by: e.by, arrivedAt: prev.at, doneAt: e.at });
          prev = e;
        } else if (e.action === 'return') {
          returns += 1;
          prev = e;
        } else if (e.action === 'approve') {
          prev = e;
        } else if (e.action === 'record_posted' && prev.action === 'approve') {
          put.step({ dept: 'hr', workflow: 'job_advert', stage: 'post', kind: 'work', recordId: v.id, companyId: v.companyId, byId: e.byId, by: e.by, arrivedAt: prev.at, doneAt: e.at });
          // One advert is one finished item, however many times it is approved and posted again.
          if (!finished) put.finished({ dept: 'hr', workflow: 'job_advert', recordId: v.id, companyId: v.companyId, preparer: a.writtenBy, finishedAt: e.at, returns, reopens: null, evidenceComplete: null, requesterConfirmed: null });
          finished = true;
          prev = e;
        }
      }
    }
  },
});
