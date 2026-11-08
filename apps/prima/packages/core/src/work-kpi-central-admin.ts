import { RULES } from "./rules";
import { toMs } from "./time";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import { endOfOfficeDay } from "./work-kpi";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Central Admin (Phase 5) on the Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be done for all"). Read-only, no
 * migration. Corporate Admin sits under the Deputy Chief of Staff, so its work shows under the Chief of Staff office.
 *
 * - SSM filings: lodging is timed from when the filing was prepared, on time against the filing's own due date.
 * - The company file: the check is timed from the draft reaching the checker.
 * - Licence and permit renewals (5C): the company prepares the papers and submits; Finance pays the fee after the
 *   company manager signs; Central Admin confirms the new certificate. The manager's signature is an approval and is
 *   not timed; the agency's own time is not anyone's in the group.
 */
const DAY_START = (d: IsoDate): IsoDateTime => `${d}T${RULES.staffHours.value.start}:00+08:00`;
const latest = (xs: (IsoDateTime | null | undefined)[]) => xs.filter((x): x is IsoDateTime => !!x).sort((a, b) => toMs(a) - toMs(b)).pop() ?? null;

registerWorkKpiAdapter({
  id: 'central-admin',
  depts: ['chief_of_staff', 'company_office', 'finance'],
  tables: ['corpFilings', 'corpProfiles', 'licences'],
  targets: {
    'chief_of_staff.ssm_filing.lodge': null, // the filing's own due date is the target
    'chief_of_staff.company_file.check': 960,
    'chief_of_staff.renewal.confirm': 480,
    'company_office.renewal.papers': 2400,
    'company_office.renewal.submit': 960,
    'finance.renewal.fee': 960,
  },
  limits: {
    chief_of_staff: {
      unknown: ['Preparing an SSM filing: Prima does not record when the filing was opened, so only lodging is timed', 'Adviser invoice checks: the Finance Director or the Deputy checks, so they are not split by department yet'],
      notTimed: ['PWVSB approval of corporate changes', 'Company board resolutions'],
    },
    company_office: {
      unknown: ['Renewal papers redone after a return: Prima keeps only the latest tick on each paper, so that round is left out of speed (the return still counts in quality)'],
      notTimed: ['The company manager’s signature on a renewal', 'The agency’s own processing time after submission'],
    },
  },
  heads: [{ dept: 'chief_of_staff', is: (u) => u.role === 'pwvsb_officer' && (u.leadership === 'cos' || u.leadership === 'deputy_cos') }],
  collect(data, put) {
    for (const f of data.corpFilings ?? []) {
      if (f.prepared && f.lodged)
        put.step({ dept: 'chief_of_staff', workflow: 'ssm_filing', stage: 'lodge', kind: 'work', recordId: f.id, companyId: f.companyId, byId: null, by: f.lodged.by, arrivedAt: f.prepared.at, doneAt: f.lodged.at, dueAt: endOfOfficeDay(f.dueOn) });
      if (f.lodged)
        put.finished({ dept: 'chief_of_staff', workflow: 'ssm_filing', recordId: f.id, companyId: f.companyId, preparer: f.prepared?.by ?? null, finishedAt: f.lodged.at, returns: null, reopens: null, evidenceComplete: !!f.receipt, requesterConfirmed: null });
    }
    for (const p of data.corpProfiles ?? []) {
      const file = p.file;
      if (file?.checkedAt && file.checkedBy)
        put.step({ dept: 'chief_of_staff', workflow: 'company_file', stage: 'check', kind: 'check', recordId: p.id, companyId: p.companyId, byId: file.checkedById ?? null, by: file.checkedBy, arrivedAt: file.draftAt, doneAt: file.checkedAt });
    }
    for (const l of data.licences ?? []) {
      const r = l.renewal;
      if (!r) continue;
      const rec = { recordId: l.id, companyId: l.companyId };
      // Papers: from the renewal opening to the last paper ticked before the signature; a returned round is left out.
      const papersDone = latest(r.papers.map((x) => x.done?.at));
      const lastPaper = [...r.papers].filter((x) => x.done).sort((a, b) => toMs(a.done!.at) - toMs(b.done!.at)).pop()?.done;
      // Papers ticked by several people are the office's shared work: no one person is given the others' time.
      const tickers = new Set(r.papers.map((x) => x.done?.byId ?? x.done?.by));
      const one = tickers.size === 1;
      if (!r.returns.length && r.signed && papersDone && lastPaper && r.papers.every((x) => x.done))
        put.step({ dept: 'company_office', workflow: 'renewal', stage: 'papers', kind: 'work', ...rec, byId: one ? lastPaper.byId : null, by: one ? lastPaper.by : 'Company office (papers shared by several people)', arrivedAt: DAY_START(r.openedOn), doneAt: papersDone });
      if (r.signed && r.fee) put.step({ dept: 'finance', workflow: 'renewal', stage: 'fee', kind: 'work', ...rec, byId: r.fee.byId, by: r.fee.by, arrivedAt: r.signed.at, doneAt: r.fee.at });
      if (r.fee && r.submitted) put.step({ dept: 'company_office', workflow: 'renewal', stage: 'submit', kind: 'work', ...rec, byId: r.submitted.byId, by: r.submitted.by, arrivedAt: r.fee.at, doneAt: r.submitted.at });
      if (r.renewed && r.confirmed) {
        put.step({ dept: 'chief_of_staff', workflow: 'renewal', stage: 'confirm', kind: 'check', ...rec, byId: r.confirmed.byId, by: r.confirmed.by, arrivedAt: r.renewed.at, doneAt: r.confirmed.at });
        put.finished({ dept: 'company_office', workflow: 'renewal', ...rec, preparer: r.openedBy, finishedAt: r.confirmed.at, returns: r.returns.length, reopens: null, evidenceComplete: !!r.renewed.certificateRef, requesterConfirmed: null });
      }
    }
  },
});