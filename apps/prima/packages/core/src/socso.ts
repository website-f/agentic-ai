// SOCSO (PERKESO) claims (Fauzan, 26 Oct 2026; SOCSO Claims SOP of the same day). Case types, the document list for
// each, the "Not sure" questions, deadlines and how injury MC days are paid.

import type { Finding } from './checks';
import { RULES } from './rules';
import { addDays, addMinutes, dateOf, toMs } from './time';
import type { IsoDate, IsoDateTime, Nationality, Shift, Site, SocsoCaseType, SocsoClaim, SocsoRehab, SocsoRestrictionKind, SocsoStatus } from './types';

export const SOCSO_TYPE_LABEL: Record<SocsoCaseType, string> = {
  WORK_ACCIDENT: 'Work accident',
  COMMUTING: 'Commuting accident',
  EMERGENCY: 'Emergency accident',
  OCCUPATIONAL_DISEASE: 'Occupational disease',
  NON_WORK_ACCIDENT: 'Non-work accident (LINDUNG 24 Jam)',
  INVALIDITY: 'Invalidity',
  DEATH: 'Death',
};

export const SOCSO_TYPE_DETAIL: Record<SocsoCaseType, string> = {
  WORK_ACCIDENT: 'Injury arising out of and during work: hurt on patrol, assaulted on duty, a fall at the guardhouse.',
  COMMUTING: 'Direct trip between home and site, travel for work, or to and from a permitted meal break. A detour or private stop breaks cover.',
  EMERGENCY: 'Hurt at the workplace while rescuing or protecting people during an emergency.',
  OCCUPATIONAL_DISEASE: 'A disease listed in the Fifth Schedule of Act 4, such as noise-induced hearing loss.',
  NON_WORK_ACCIDENT:
    'An accident in Malaysia outside work, such as a road accident on a rest day. Not accidents abroad, illness, or a foreign worker in breach of their pass.',
  INVALIDITY: 'Illness or a non-work condition that leaves the person permanently unable to work, confirmed by a Medical Board.',
  DEATH: 'Death from a work injury (dependants and funeral benefit) or from any other cause (survivors pension and funeral benefit).',
};

export const SOCSO_STATUS_LABEL: Record<SocsoStatus, string> = {
  DRAFT: 'Draft',
  REPORTED: 'Reported to PERKESO',
  DOCS_COMPLETE: 'Documents complete',
  UNDER_REVIEW: 'Under PERKESO review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  APPEAL: 'Appeal',
  CLOSED: 'Paid and closed',
};

export interface SocsoDocItem {
  id: string;
  label: string;
  required: boolean;
  /** Medical papers: only HR (the company's HR team and central HR) sees them. */
  medical: boolean;
  /** Filled from the app's own records, nothing to upload. */
  fromApp?: boolean;
}

/** The core set for every case, then each case type's own papers (SOP section 4). */
export function socsoDocItems(type: SocsoCaseType, nationality: Nationality): SocsoDocItem[] {
  const items: SocsoDocItem[] = [
    { id: 'FORM34', label: 'Form 34 (notice and benefit claim), as submitted in ASSIST', required: true, medical: false },
    nationality === 'MY'
      ? { id: 'ID', label: 'IC copy, front and back', required: true, medical: false }
      : { id: 'ID', label: 'Passport and PLKS (work pass) copy', required: true, medical: false },
    { id: 'INCIDENT', label: 'Incident report from the site, with witness names', required: type !== 'INVALIDITY', medical: false },
    { id: 'ATTENDANCE', label: 'Roster and clock-in record for the day', required: type !== 'INVALIDITY', medical: false, fromApp: true },
    { id: 'MC', label: 'Every medical certificate', required: type !== 'DEATH', medical: true },
    { id: 'DOCTOR', label: "Doctor's medical report", required: type !== 'DEATH', medical: true },
    { id: 'BANK', label: 'Bank account details for payment', required: true, medical: false },
    { id: 'FITNESS', label: 'Fitness to work certificate, when the doctor clears the return', required: false, medical: false },
  ];
  const extra: Record<SocsoCaseType, SocsoDocItem[]> = {
    WORK_ACCIDENT: [{ id: 'POLICE', label: 'Police report (assault on duty)', required: false, medical: false }],
    COMMUTING: [
      { id: 'POLICE', label: 'Police report, within 24 hours', required: true, medical: false },
      { id: 'SKETCH', label: 'Sketch map of the route from home to site', required: true, medical: false },
    ],
    EMERGENCY: [],
    OCCUPATIONAL_DISEASE: [
      { id: 'SPECIALIST', label: 'Specialist report', required: true, medical: true },
      { id: 'EXPOSURE', label: 'Work history showing the exposure (sites, posts, years)', required: true, medical: false, fromApp: true },
    ],
    NON_WORK_ACCIDENT: [
      { id: 'POLICE', label: 'Police report, where police attended', required: false, medical: false },
      { id: 'IN_MALAYSIA', label: 'Proof the accident happened in Malaysia (exact form to check)', required: true, medical: false },
    ],
    INVALIDITY: [{ id: 'SPECIALIST', label: 'Specialist report: diagnosis, prognosis, treatment and ability to work', required: true, medical: true }],
    DEATH: [
      { id: 'DEATH_CERT', label: 'Death certificate', required: true, medical: false },
      { id: 'POLICE', label: 'Police or post-mortem report', required: true, medical: true },
      { id: 'DEPENDANTS', label: "Dependants' IC, birth and marriage certificates", required: true, medical: false },
      { id: 'FUNERAL', label: 'Funeral and repatriation receipts', required: true, medical: false },
    ],
  };
  return [...items, ...extra[type]];
}

export interface SocsoTriage {
  onDuty: boolean;
  commuting: boolean;
  outsideWorkInMalaysia: boolean;
  illness: boolean;
  /** For an illness: it leaves the person permanently unable to work. */
  permanent?: boolean;
}

/** The "Not sure" questions: which case it is, or where to go when it is not a SOCSO claim. */
export function socsoTriage(a: SocsoTriage, nationality: Nationality): { type: SocsoCaseType | null; advice: string } {
  if (a.illness) {
    if (a.permanent) return { type: 'INVALIDITY', advice: 'An illness that leaves the person permanently unable to work is an Invalidity claim.' };
    return {
      type: null,
      advice:
        nationality === 'NP'
          ? 'Not a SOCSO claim. Ordinary illness is sick leave; clinic visits use the RM200 annual medical ledger; hospital bills go to SPIKPA.'
          : 'Not a SOCSO claim. Ordinary illness is sick leave under the company panel. Job loss is an EIS claim the worker makes within 60 days.',
    };
  }
  if (a.onDuty) return { type: 'WORK_ACCIDENT', advice: 'Hurt while on duty: a work accident.' };
  if (a.commuting)
    return { type: 'COMMUTING', advice: 'Hurt travelling directly between home and work: a commuting accident. A police report is needed within 24 hours.' };
  if (a.outsideWorkInMalaysia) return { type: 'NON_WORK_ACCIDENT', advice: 'An accident in Malaysia outside work: LINDUNG 24 Jam, if the person is covered.' };
  return {
    type: null,
    advice: 'An accident outside Malaysia and outside work is not covered by SOCSO. Use sick leave, and the company insurance if any.',
  };
}

const HOUR = 3_600_000;

/** Form 34 is due 48 hours after the company was told; a reminder at 24 hours, then the HR manager is alerted. */
export function socsoForm34Clock(
  c: Pick<SocsoClaim, 'toldAt' | 'reportedAt'>,
  now: IsoDateTime,
): {
  due: IsoDateTime;
  state: 'done' | 'ok' | 'reminder' | 'overdue';
  hoursLeft: number;
} {
  const due = addMinutes(c.toldAt, 48 * 60);
  const left = (toMs(due) - toMs(now)) / HOUR;
  if (c.reportedAt) return { due, state: 'done', hoursLeft: Math.round(left) };
  return { due, state: left < 0 ? 'overdue' : left <= 24 ? 'reminder' : 'ok', hoursLeft: Math.round(left) };
}

/** Later deadlines: the permanent disablement claim (12 months after the last MC day) and the appeal (90 days). */
export function socsoLaterDeadlines(c: Pick<SocsoClaim, 'mcs' | 'decision' | 'type'>): {
  permanentBy: IsoDate | null;
  appealBy: IsoDate | null;
  lastMcDay: IsoDate | null;
} {
  const lastMcDay = c.mcs.length
    ? c.mcs
        .map((m) => m.to)
        .sort()
        .at(-1)!
    : null;
  const accident = c.type !== 'INVALIDITY' && c.type !== 'DEATH';
  return {
    lastMcDay,
    permanentBy: accident && lastMcDay ? addDays(lastMcDay, 365) : null,
    appealBy: c.decision?.outcome === 'REJECTED' ? addDays(c.decision.on, 90) : null,
  };
}

/** Days of MC, counting both ends. */
export function socsoMcDays(c: Pick<SocsoClaim, 'mcs'>): number {
  return c.mcs.reduce((n, m) => n + Math.max(0, Math.round((Date.parse(m.to) - Date.parse(m.from)) / 86_400_000) + 1), 0);
}

/**
 * How payroll treats the injury MC days (Fauzan, 26 Oct 2026, with Employment Act s.60F(4)): 3 days or less is
 * company sick leave at basic pay; 4 days or more on an accepted case is not paid by the company because PERKESO
 * pays temporary disablement; while PERKESO decides, the days are held.
 */
export function socsoPayrollTreatment(c: Pick<SocsoClaim, 'mcs' | 'status' | 'decision'>): {
  days: number;
  treatment: 'none' | 'sick_leave' | 'perkeso' | 'held' | 'sick_leave_after_reject';
  text: string;
} {
  const days = socsoMcDays(c);
  if (!days) return { days, treatment: 'none', text: 'No MC days recorded yet.' };
  if (days <= RULES.injuryMcPay.value) return { days, treatment: 'sick_leave', text: `${days} MC day(s): company sick leave at basic pay.` };
  if (c.decision?.outcome === 'APPROVED' || c.status === 'CLOSED')
    return { days, treatment: 'perkeso', text: `${days} MC days: PERKESO pays temporary disablement; the company does not pay these days (EA s.60F(4)).` };
  if (c.decision?.outcome === 'REJECTED' && c.status !== 'APPEAL')
    return {
      days,
      treatment: 'sick_leave_after_reject',
      text: `${days} MC days: PERKESO rejected the claim, so these days are company sick leave at basic pay.`,
    };
  return { days, treatment: 'held', text: `${days} MC days: held for payroll until PERKESO decides, then settled.` };
}

export const SOCSO_RESTRICTION_LABEL: Record<SocsoRestrictionKind, string> = {
  NO_DUTY: 'No duty at all',
  NO_PATROL: 'No patrol posts',
  NO_ARMED: 'No armed posts',
  NO_NIGHT: 'No night shifts',
};

export function emptyRehab(): SocsoRehab {
  return { rtwRequestedOn: null, referralOn: null, caseManager: null, plan: '', targetReturn: null, appointments: [], restrictions: [], checkIns: [] };
}

/**
 * PERKESO's Return to Work programme is for Malaysians; foreign workers get appliances (prostheses, wheelchairs)
 * only (rehabilitation section of the SOP).
 */
export function socsoRtwOffered(nationality: Nationality): boolean {
  return nationality === 'MY';
}

/** A night shift: starts at 19:00 or later, or runs past midnight. */
function isNight(shift: Pick<Shift, 'start' | 'end'>): boolean {
  return Number(shift.start.slice(11, 13)) >= 19 || dateOf(shift.end) > dateOf(shift.start);
}

/**
 * What a guard's SOCSO claims say about one shift: injury MC days and work restrictions HR has not cleared block it.
 * `patrolSite` is true when the site has patrol checkpoints.
 */
export function socsoDutyFindings(
  claims: SocsoClaim[],
  shift: Pick<Shift, 'date' | 'start' | 'end'>,
  site: Pick<Site, 'armed'>,
  patrolSite: boolean,
): Finding[] {
  const out: Finding[] = [];
  for (const c of claims) {
    if (c.mcs.some((m) => m.from <= shift.date && shift.date <= m.to))
      out.push({ level: 'block', code: 'ON_INJURY_MC', message: 'On injury MC (SOCSO claim) on this day.' });
    for (const r of c.rehab?.restrictions ?? []) {
      if (r.clearedAt || r.from > shift.date) continue;
      const hits =
        r.kind === 'NO_DUTY' || (r.kind === 'NO_PATROL' && patrolSite) || (r.kind === 'NO_ARMED' && site.armed) || (r.kind === 'NO_NIGHT' && isNight(shift));
      if (hits)
        out.push({
          level: 'block',
          code: 'WORK_RESTRICTION',
          message: `Work restriction: ${SOCSO_RESTRICTION_LABEL[r.kind].toLowerCase()}${r.note ? ` (${r.note})` : ''}, until HR clears it.`,
        });
    }
  }
  return out;
}

/**
 * The officer's weekly check-in: due while the person is off on MC and for the first month after the return.
 * Returns null when no check-in is needed now.
 */
export function socsoCheckIn(c: Pick<SocsoClaim, 'mcs' | 'returnToWork' | 'rehab' | 'toldAt'>, today: IsoDate): { due: IsoDate; overdue: boolean } | null {
  const lastMc = c.mcs.length
    ? c.mcs
        .map((m) => m.to)
        .sort()
        .at(-1)!
    : null;
  const back = c.returnToWork ?? (lastMc ? addDays(lastMc, 1) : null);
  const firstMc = c.mcs.length ? c.mcs.map((m) => m.from).sort()[0] : null;
  if (!firstMc || today < firstMc) return null;
  if (back && today > addDays(back, 30)) return null;
  const every = RULES.socsoCheckInDays.value;
  const last = c.rehab?.checkIns.length ? dateOf(c.rehab.checkIns.at(-1)!.at) : firstMc;
  const due = addDays(last, every);
  return { due, overdue: today > due };
}
