import { toMs } from "./time";
import { endOfOfficeDay } from "./work-kpi";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Director Office tenders and quotations on the Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be done for all").
 * Read-only, no migration.
 *
 * - An opportunity found by the Director Office: from when it was recorded to when the Director Office set the first
 *   company to enter it.
 * - A quotation: from its approval reaching the company to the quotation sent to the client. Preparing it is not
 *   timed: Prima does not record when the request for it arrived.
 * - A tender (joint tenders, 26 Oct 2026): the preparer's signature is timed from the checklist reaching the company
 *   (the Director Office's review); the submission slip from the manager's signature. Both are judged against the
 *   closing day. The manager's signature is an approval and is not timed.
 */
registerWorkKpiAdapter({
  id: 'director-office-tenders',
  depts: ['director_office', 'company_office'],
  tables: ['tenders', 'tenderOpportunities', 'quotations'],
  targets: {
    'director_office.opportunity.assign': 240,
    'company_office.quotation.send': 240,
    'company_office.tender.prepare': null, // the closing day is the target
    'company_office.tender.submit': null, // the closing day is the target
  },
  limits: {
    director_office: {
      unknown: ['Checking the drafted tender checklist: Prima does not record when the papers reached the Director Office', 'Watching tender sites: checks are recorded as they happen, without a time the work was due'],
      notTimed: [],
    },
    company_office: {
      unknown: ['Preparing a quotation: Prima does not record when the client asked for it', 'Tenders found and entered by a company on its own: only the entry is kept, not when the company first saw it'],
      notTimed: ['The company manager’s signature on a tender', 'Approval of a quotation', 'The client’s or buyer’s decision'],
    },
  },
  // No head of its own: the Director Office is the Director Office Administrator's own work, and staff do not keep a
  // standing view of their own KPIs (Fauzan, 1 Nov 2026). The CEO, COO, ACT head and HR see it.
  collect(data, put) {
    for (const o of data.tenderOpportunities ?? []) {
      const assigned = o.entries.filter((e) => e.setBy === 'DOA').sort((a, b) => toMs(a.at) - toMs(b.at))[0];
      if (o.origin === 'DOA' && assigned)
        put.step({ dept: 'director_office', workflow: 'opportunity', stage: 'assign', kind: 'work', recordId: o.id, companyId: null, byId: assigned.userId, by: assigned.by, arrivedAt: o.foundAt, doneAt: assigned.at });
    }
    for (const q of data.quotations ?? []) {
      // Sending is the company's own part, from the approval reaching it; the approval itself is not timed.
      if (q.approvedAt && q.sent)
        put.step({ dept: 'company_office', workflow: 'quotation', stage: 'send', kind: 'work', recordId: q.id, companyId: q.companyId, byId: q.sent.userId, by: q.sent.by, arrivedAt: q.approvedAt, doneAt: q.sent.at });
    }
    for (const t of data.tenders ?? []) {
      const due = endOfOfficeDay(t.closesOn);
      const prep = (t.verifications ?? []).find((v) => v.level === 'PREPARER');
      const mgr = (t.verifications ?? []).find((v) => v.level === 'MANAGER');
      if (t.checklistReview && prep)
        put.step({ dept: 'company_office', workflow: 'tender', stage: 'prepare', kind: 'work', recordId: t.id, companyId: t.companyId, byId: prep.userId, by: prep.by, arrivedAt: t.checklistReview.at, doneAt: prep.at, dueAt: due });
      if (mgr && t.submission) {
        put.step({ dept: 'company_office', workflow: 'tender', stage: 'submit', kind: 'work', recordId: t.id, companyId: t.companyId, byId: null, by: t.submission.by, arrivedAt: mgr.at, doneAt: t.submission.at, dueAt: due });
        put.finished({ dept: 'company_office', workflow: 'tender', recordId: t.id, companyId: t.companyId, preparer: prep?.by ?? null, finishedAt: t.submission.at, returns: null, reopens: null, evidenceComplete: t.submission.proofIds.length > 0, requesterConfirmed: null });
      }
    }
  },
});
/**
 * The Director Office's own work (Director Office study B6, Fauzan 23 Nov 2026: "Do the gap"). Marketing now runs the
 * bids, so the Director Office is measured on what it does itself. Read-only, no migration.
 *
 * - Minutes of a meeting the Director Office set: from the end of the meeting to the minutes in Prima. Proposed target
 *   3 office days, the same window as the COO's monthly operations meetings (rule OPS-MEETING).
 * - The summary drafted from any meeting's minutes: from the draft to the Director Office's check. Proposed target
 *   1 office day.
 */
registerWorkKpiAdapter({
  id: 'director-office-desk',
  depts: ['director_office'],
  tables: ['meetings'],
  targets: {
    'director_office.meeting.minutes': 1620,
    'director_office.meeting.summary_check': 540,
  },
  limits: {
    director_office: {
      unknown: ['Reports due to the Director Office: the sender is timed against the due day on the Reports screen, not the Director Office'],
      notTimed: ['CEO instructions: timed for the person who was given each one, against its own due time'],
    },
  },
  collect(data, put) {
    for (const m of data.meetings ?? []) {
      if (m.status !== 'held') continue;
      if (m.department === 'director_office' && m.minutes)
        put.step({ dept: 'director_office', workflow: 'meeting', stage: 'minutes', kind: 'work', recordId: m.id, companyId: m.companyId ?? null, byId: null, by: m.minutes.by, arrivedAt: m.end, doneAt: m.minutes.at });
      if (m.summary?.checkedBy && m.summary.checkedAt)
        put.step({ dept: 'director_office', workflow: 'meeting', stage: 'summary_check', kind: 'check', recordId: m.id, companyId: m.companyId ?? null, byId: null, by: m.summary.checkedBy, arrivedAt: m.summary.at, doneAt: m.summary.checkedAt });
    }
  },
});
