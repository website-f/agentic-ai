import { RULES } from './rules';
import { addDays, toMs } from './time';
import type { HrFiling, IsoDate, IsoDateTime, Person } from './types';
import { endOfOfficeDay, registerWorkKpiAdapter } from './work-kpi';

/**
 * HR Phase 3 on the group Work KPIs screen (Fauzan, 5 Nov 2026: "Kpi will be done for all"). Read-only, no migration.
 *
 * - Statutory filings (CP22, CP22A, EPF and SOCSO registration, EA, Borang E, the s.81H notice, JKKP 8): timed from
 *   when the duty arose (the hire day, the start of the filing year) to when HR recorded the filing, and on time
 *   against the legal latest day (the record's own due time).
 * - Filling an open post: from the company head's signature, which opens the post, to HR closing it as filled.
 * - The login move after a transfer is IT's own part: from the HR Director's authorisation (or the effective day, if
 *   later, since IT may not move the login before it) to IT's confirmation.
 * Approvals (CEO and head on a vacancy, every step of a staff movement, the login authorisation, flexible-work
 * decisions) are not timed. HR cases are left out entirely: they hold confidential complaints and legal waits.
 */
const HR_DAY_START = (d: IsoDate): IsoDateTime => `${d}T${RULES.staffHours.value.start}:00+08:00`;

/** When the duty to file arose and the legal latest day, for a filing HR has recorded; null when Prima cannot tell. */
export function hrFilingWindow(f: HrFiling, people: Pick<Person, 'id' | 'hiredOn' | 'leaving'>[]): { arose: IsoDate; latestBy: IsoDate } | null {
  const r = RULES.hrJoinLeave.value;
  const p = f.personId ? people.find((x) => x.id === f.personId) : null;
  const year = Number(f.period.slice(0, 4));
  switch (f.kind) {
    case 'CP22':
      return p ? { arose: p.hiredOn, latestBy: addDays(p.hiredOn, r.cp22Days) } : null;
    case 'SOCSO_REG':
      return p ? { arose: p.hiredOn, latestBy: addDays(p.hiredOn, r.socsoRegDays) } : null;
    case 'EPF_REG': {
      if (!p) return null;
      const [y, m] = p.hiredOn.split('-').map(Number);
      return { arose: p.hiredOn, latestBy: m === 12 ? `${y + 1}-01-15` : `${y}-${String(m + 1).padStart(2, '0')}-15` };
    }
    case 'CP22A': {
      // The duty arises when the leaving is known; Prima keeps only the last day, so the legal day is the target and
      // the time is counted from the latest day back by the notice the law gives.
      const last = p?.leaving?.lastDayOn;
      if (!last) return null;
      const latestBy = addDays(last, -r.cp22aDaysBefore);
      return { arose: addDays(latestBy, -r.cp22aDaysBefore), latestBy };
    }
    case 'EA':
      return Number.isFinite(year) ? { arose: `${year + 1}-01-01`, latestBy: `${year + 1}-${r.eaBy}` } : null;
    case 'BORANG_E':
      return Number.isFinite(year) ? { arose: `${year + 1}-01-01`, latestBy: `${year + 1}-${r.borangEBy}` } : null;
    case 'JKKP8':
      return Number.isFinite(year) ? { arose: `${year + 1}-01-01`, latestBy: `${year + 1}-01-31` } : null;
    case 'SH_NOTICE':
      return Number.isFinite(year) ? { arose: `${year}-01-01`, latestBy: `${year}-01-31` } : null;
    default:
      return null;
  }
}

registerWorkKpiAdapter({
  id: 'hr-phase3',
  depts: ['hr', 'it'],
  tables: ['hrFilings', 'people', 'vacancies', 'loginHandovers'],
  targets: {
    'hr.filing.file': null, // the legal latest day is the target
    'hr.vacancy.fill': null, // no target proposed yet: hiring time depends on the post and the market
    'it.login_handover.move': 240,
  },
  limits: {
    hr: {
      unknown: [
        'CP22A: Prima keeps only the last day, not when HR learned of the leaving, so the clock starts 30 days before the legal day',
        'Preparing a staff movement: Prima does not record when HR was asked, so only the approvals and the apply are kept',
        'HR cases (misconduct, complaints, grievances) are left out: they hold confidential matters and legal waits that are not HR’s speed',
      ],
      notTimed: ['CEO and company head approval of a vacancy', 'Every approval and consent on a promotion, transfer or secondment', 'Decisions on flexible-work requests (the 60-day legal answer is shown on the HR screen)'],
    },
    it: { unknown: [], notTimed: ['HR Director or CEO authorisation of a login move after a transfer'] },
  },
  collect(data, put) {
    const people = data.people ?? [];
    for (const f of data.hrFilings ?? []) {
      const w = hrFilingWindow(f, people);
      if (!w) continue;
      // A filing made before the computed day the duty arose (filed early) waited nothing: it still counts, on time.
      const arose = HR_DAY_START(w.arose);
      put.step({ dept: 'hr', workflow: 'filing', stage: 'file', kind: 'work', recordId: f.id, companyId: f.companyId, byId: f.byId, by: f.by, arrivedAt: toMs(arose) > toMs(f.at) ? f.at : arose, doneAt: f.at, dueAt: endOfOfficeDay(w.latestBy) });
    }
    for (const v of data.vacancies ?? []) {
      if (v.head && v.closed && v.status === 'filled') {
        put.step({ dept: 'hr', workflow: 'vacancy', stage: 'fill', kind: 'work', recordId: v.id, companyId: v.companyId, byId: v.closed.byId, by: v.closed.by, arrivedAt: v.head.at, doneAt: v.closed.at });
        put.finished({ dept: 'hr', workflow: 'vacancy', recordId: v.id, companyId: v.companyId, preparer: v.closed.by, finishedAt: v.closed.at, returns: null, reopens: null, evidenceComplete: null, requesterConfirmed: null });
      }
    }
    for (const h of data.loginHandovers ?? []) {
      if (!h.authorised || !h.done) continue;
      const effective = HR_DAY_START(h.effectiveOn);
      const arrived = toMs(h.authorised.at) > toMs(effective) ? h.authorised.at : effective;
      put.step({ dept: 'it', workflow: 'login_handover', stage: 'move', kind: 'work', recordId: h.id, companyId: h.toCompanyId, byId: h.done.byId, by: h.done.by, arrivedAt: arrived, doneAt: h.done.at });
      // Prima accepts IT's confirmation only once every account points to the new record, so it is complete when done.
      put.finished({ dept: 'it', workflow: 'login_handover', recordId: h.id, companyId: h.toCompanyId, preparer: h.done.by, finishedAt: h.done.at, returns: null, reopens: null, evidenceComplete: null, requesterConfirmed: null });
    }
  },
});
