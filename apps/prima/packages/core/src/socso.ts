// SOCSO (PERKESO) claims (Fauzan, 26 Oct 2026; SOCSO Claims SOP of the same day). Case types, the document list for
// each, the "Not sure" questions, deadlines and how injury MC days are paid.

import type { Finding } from './checks';
import { RULES } from './rules';
import { addDays, addMinutes, addWorkingDays, daysBetween, dateOf, toMs } from './time';
import type {
  DependantPayKind,
  DependantPayRoute,
  DependantRelation,
  DoshKind,
  DoshNotice,
  IsoDate,
  IsoDateTime,
  LindungChannel,
  Nationality,
  Shift,
  Site,
  SocsoCaseType,
  SocsoClaim,
  SocsoDependant,
  SocsoRehab,
  SocsoRestrictionKind,
  SocsoStatus,
} from './types';

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
  // LINDUNG 24 Jam: the worker applies (Portal LINDUNG Faedah, or Form 34 non-work accident notice at a counter) with
  // the MC and their own bank statement; a police report if there is one. The company only confirms employment.
  if (type === 'NON_WORK_ACCIDENT')
    return [
      { id: 'APPLICATION', label: "The worker's LINDUNG application: Portal LINDUNG Faedah slip, or Form 34 (non-work accident) from the counter", required: true, medical: false },
      nationality === 'MY'
        ? { id: 'ID', label: 'IC copy, front and back', required: true, medical: false }
        : { id: 'ID', label: 'Passport and PLKS (work pass) copy', required: true, medical: false },
      { id: 'ATTENDANCE', label: 'Roster and clock-in record, to show the worker was off duty', required: true, medical: false, fromApp: true },
      { id: 'MC', label: 'Every medical certificate', required: true, medical: true },
      { id: 'BANK', label: "Bank statement of the worker's own account", required: true, medical: false },
      { id: 'POLICE', label: 'Police report, where there is one', required: false, medical: false },
      { id: 'IN_MALAYSIA', label: 'Proof the accident happened in Malaysia (police report, clinic or hospital letter)', required: true, medical: false },
      { id: 'DOCTOR', label: "Doctor's medical report, if PERKESO asks", required: false, medical: true },
      { id: 'FITNESS', label: 'Fitness to work certificate, when the doctor clears the return', required: false, medical: false },
    ];
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
    NON_WORK_ACCIDENT: [],
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
  c: Pick<SocsoClaim, 'toldAt' | 'reportedAt'> & { type?: SocsoCaseType },
  now: IsoDateTime,
): {
  due: IsoDateTime;
  state: 'done' | 'ok' | 'reminder' | 'overdue' | 'not_needed';
  hoursLeft: number;
} {
  const due = addMinutes(c.toldAt, 48 * 60);
  const left = (toMs(due) - toMs(now)) / HOUR;
  if (c.reportedAt) return { due, state: 'done', hoursLeft: Math.round(left) };
  // LINDUNG 24 Jam: the worker applies; there is no 48-hour employer notice (PERKESO LINDUNG 24 Jam FAQ, Aug 2026).
  if (c.type === 'NON_WORK_ACCIDENT') return { due, state: 'not_needed', hoursLeft: Math.round(left) };
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

// ---------- LINDUNG 24 Jam (non-work accident), 5 Nov 2026 ----------

export const LINDUNG_CHANNEL_LABEL: Record<LindungChannel, string> = {
  PORTAL: 'Online, Portal LINDUNG Faedah',
  COUNTER: 'Form 34 (non-work accident notice) at a PERKESO office',
};

export const LINDUNG_VERIFY_LABEL = {
  EMPLOYED: 'Still employed and working',
  NOT_EMPLOYED: 'Not employed by the company on that day',
  UNPAID_LEAVE: 'On unpaid leave that day',
} as const;

/**
 * What the app can check before HR confirms employment for a LINDUNG claim. PERKESO's LINDUNG 24 Jam FAQ: the
 * accident must be in Malaysia; a foreign worker in breach of the pass (Act 155) is not covered; no cover on unpaid
 * leave or for a month without contribution. If the worker was on duty, it is a work accident instead.
 */
export function lindungChecks(input: {
  nationality: Nationality;
  lindungOptOut?: boolean;
  incidentOn: IsoDate;
  /** Latest PLKS expiry on file, for a foreign worker. */
  plksExpiresOn: IsoDate | null;
  onDuty: boolean;
  unpaidLeave: boolean;
  status: 'active' | 'left' | string;
}): { level: 'block' | 'warn' | 'ok'; text: string }[] {
  const out: { level: 'block' | 'warn' | 'ok'; text: string }[] = [];
  if (input.nationality === 'MY' && input.lindungOptOut === true)
    out.push({ level: 'block', text: 'Opted out of LINDUNG 24 Jam: an accident outside work is not covered.' });
  if (input.nationality !== 'MY') {
    if (!input.plksExpiresOn) out.push({ level: 'warn', text: 'No work pass (PLKS) on file. PERKESO does not cover a foreign worker in breach of the pass.' });
    else if (input.plksExpiresOn < input.incidentOn)
      out.push({ level: 'warn', text: `The work pass expired on ${input.plksExpiresOn}, before the accident. PERKESO may refuse the claim.` });
    else out.push({ level: 'ok', text: `Work pass valid on the day (expires ${input.plksExpiresOn}).` });
  }
  if (input.onDuty)
    out.push({
      level: 'warn',
      text: 'Rostered or clocked in at the time. If it happened at work, this is a work accident: Form 34 in ASSIST within 48 hours, not LINDUNG.',
    });
  else out.push({ level: 'ok', text: 'Not on duty at the time, from the roster and clock-in record.' });
  if (input.unpaidLeave) out.push({ level: 'warn', text: 'On approved unpaid leave that day: PERKESO does not cover accidents during unpaid leave.' });
  if (input.status === 'left') out.push({ level: 'warn', text: 'The person has left the company.' });
  return out;
}

/** PERKESO emails the company to confirm employment; the company target to answer (rule HR-LINDUNG-VERIFY). */
export function lindungVerifyClock(l: { verifyAskedAt: IsoDateTime | null; verify: unknown }, today: IsoDate): { due: IsoDate; overdue: boolean } | null {
  if (!l.verifyAskedAt || l.verify) return null;
  const due = addWorkingDays(dateOf(l.verifyAskedAt), RULES.lindungVerifyDays.value);
  return { due, overdue: today > due };
}

// ---------- Dependants of a worker who died (5 Nov 2026) ----------

export const DEPENDANT_RELATION_LABEL: Record<DependantRelation, string> = {
  SPOUSE: 'Husband or wife',
  CHILD: 'Child',
  PARENT: 'Parent',
  SIBLING: 'Brother or sister',
  GRANDPARENT: 'Grandparent',
};

export const DEPENDANT_ROUTE_LABEL: Record<DependantPayRoute, string> = {
  PERKESO_OVERSEAS_BANK: "PERKESO pays the dependant's bank account abroad",
  PERKESO_VIA_EMBASSY: "PERKESO pays through the worker's embassy",
  PERKESO_MALAYSIAN_ACCOUNT: 'PERKESO pays a Malaysian bank account the dependant named',
};

export const DEPENDANT_PAY_LABEL: Record<DependantPayKind, string> = {
  DEPENDANTS_BENEFIT: "Dependants' benefit (work injury)",
  SURVIVORS_PENSION: "Survivors' pension",
  FUNERAL: 'Funeral benefit',
  REPATRIATION: 'Repatriation of remains',
  LUMP_SUM: 'Lump sum',
};

/**
 * PERKESO's published shares of the dependants' benefit, as a guide only (PERKESO foreign worker page, Nov 2026):
 * the husband or wife 3/5 and the children 2/5, each split equally. In any other family PERKESO works the shares out.
 */
export function dependantShareGuide(people: Pick<SocsoDependant, 'id' | 'relation'>[]): { id: string; share: number | null }[] & { note: string } {
  const spouses = people.filter((p) => p.relation === 'SPOUSE');
  const children = people.filter((p) => p.relation === 'CHILD');
  const known = spouses.length > 0 && children.length > 0;
  const rows = people.map((p) => ({
    id: p.id,
    share: !known ? null : p.relation === 'SPOUSE' ? 0.6 / spouses.length : p.relation === 'CHILD' ? 0.4 / children.length : 0,
  }));
  return Object.assign(rows, {
    note: known
      ? 'Guide from PERKESO’s published shares (husband or wife 3/5, children 2/5). PERKESO decides the final shares.'
      : 'PERKESO works out the shares for this family (with no husband or wife, or no children, the shares change).',
  });
}

/**
 * Foreign worker: the payment abroad is ready only when every dependant has a route PERKESO confirmed and, for papers
 * not in Malay or English, a certified translation (SOP open point: confirm with PERKESO).
 */
export function dependantsAbroadGaps(
  d: { people: SocsoDependant[]; embassyToldAt: IsoDateTime | null; immigrationToldAt: IsoDateTime | null },
  nationality: Nationality,
): string[] {
  const gaps: string[] = [];
  if (!d.people.length) gaps.push('No dependant recorded yet.');
  if (nationality !== 'MY') {
    if (!d.embassyToldAt) gaps.push('The embassy has not been told.');
    if (!d.immigrationToldAt) gaps.push('Immigration has not been told (worker leaves the workforce).');
  }
  for (const p of d.people) {
    if (!p.relationDocIds.length) gaps.push(`${p.name}: no birth or marriage certificate.`);
    if (p.country !== 'Malaysia' && !p.translationDocIds.length) gaps.push(`${p.name}: no certified translation of the papers.`);
    if (p.country !== 'Malaysia' && !p.routeConfirmed) gaps.push(`${p.name}: payment route not yet confirmed with PERKESO.`);
  }
  return gaps;
}

// ---------- DOSH (JKKP) accident notice, OSHA 1994 s.32 and NADOPOD 2004 (5 Nov 2026) ----------

export const DOSH_KIND_LABEL: Record<DoshKind, string> = {
  DEATH: 'Death (now or within a year of the accident)',
  SERIOUS: 'Serious bodily injury (NADOPOD list)',
  OVER_4_DAYS: 'Off work more than 4 calendar days',
  DISEASE: 'Occupational poisoning or disease',
  MINOR: 'Minor: register only',
};

export const DOSH_KIND_DETAIL: Record<DoshKind, string> = {
  DEATH: 'Tell the nearest DOSH office at once by the quickest means (phone, email), then send JKKP 6 within 7 working days.',
  SERIOUS:
    'Injuries on the NADOPOD 2004 list, such as amputation, loss of sight, a fracture or a dislocation (check the full list). Tell DOSH at once, then JKKP 6 within 7 working days.',
  OVER_4_DAYS: 'The person cannot work for more than 4 calendar days in a row. JKKP 6 within 7 working days.',
  DISEASE: 'A listed occupational poisoning or disease. JKKP 7 within 7 working days of the company learning of it.',
  MINOR: 'No notice to DOSH. Record it in the JKKP 8 register.',
};

/** Which SOCSO cases can be a workplace accident for DOSH. Commuting and non-work accidents are not. */
export function doshApplies(type: SocsoCaseType): boolean {
  return type === 'WORK_ACCIDENT' || type === 'EMERGENCY' || type === 'OCCUPATIONAL_DISEASE' || type === 'DEATH';
}

/** The longest run of MC days in a row. */
function longestMcRun(mcs: { from: IsoDate; to: IsoDate }[]): number {
  const days = new Set<IsoDate>();
  for (const m of mcs) for (let d = m.from; d <= m.to; d = addDays(d, 1)) days.add(d);
  let best = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue;
    let n = 0;
    while (days.has(addDays(d, n))) n += 1;
    best = Math.max(best, n);
  }
  return best;
}

/** What the claim's own facts suggest; HR decides and gives a reason. Serious injuries need a person to judge. */
export function doshSuggest(c: Pick<SocsoClaim, 'type' | 'mcs'>): DoshKind | null {
  if (!doshApplies(c.type)) return null;
  if (c.type === 'DEATH') return 'DEATH';
  if (c.type === 'OCCUPATIONAL_DISEASE') return 'DISEASE';
  return longestMcRun(c.mcs) > 4 ? 'OVER_4_DAYS' : null;
}

const DOSH_RANK: Record<DoshKind, number> = { MINOR: 0, DISEASE: 1, OVER_4_DAYS: 2, SERIOUS: 3, DEATH: 4 };
export function doshRaises(from: DoshKind, to: DoshKind): boolean {
  return DOSH_RANK[to] > DOSH_RANK[from];
}

/** The DOSH deadlines and what is still owed. */
export function doshClock(
  n: Pick<DoshNotice, 'kind' | 'from' | 'immediate' | 'form'>,
  today: IsoDate,
): { immediateNeeded: boolean; immediateDone: boolean; form: 'JKKP6' | 'JKKP7' | null; formDue: IsoDate | null; formDone: boolean; overdue: boolean; owed: string[] } {
  const immediateNeeded = n.kind === 'DEATH' || n.kind === 'SERIOUS';
  const form = n.kind === 'MINOR' ? null : n.kind === 'DISEASE' ? 'JKKP7' : 'JKKP6';
  const formDue = form ? addWorkingDays(n.from, RULES.doshFormWorkingDays.value) : null;
  const formDone = !!n.form && n.form.form === form && n.form.on >= n.from;
  const immediateDone = !!n.immediate && dateOf(n.immediate.at) >= n.from;
  const owed: string[] = [];
  if (immediateNeeded && !immediateDone) owed.push('Tell DOSH now by the quickest means');
  if (form && !formDone) owed.push(`Send ${form === 'JKKP6' ? 'JKKP 6' : 'JKKP 7'}`);
  return { immediateNeeded, immediateDone, form, formDue, formDone, overdue: (immediateNeeded && !immediateDone) || (!!formDue && !formDone && today > formDue), owed };
}

/** The JKKP 8 register goes to DOSH before 31 January of the next year and is kept for 5 years. */
export function doshRegisterDue(year: number): IsoDate {
  return `${year + 1}-01-31`;
}

/** A death counts as fatal for DOSH only within one year of the accident. */
export function doshDeathCounts(incidentOn: IsoDate, diedOn: IsoDate): boolean {
  return daysBetween(incidentOn, diedOn) <= 365;
}

export function emptyLindung(): import('./types').SocsoLindung {
  return { channel: null, appliedOn: null, verifyAskedAt: null, verify: null };
}

export function emptyDependants(): import('./types').SocsoDependants {
  return { people: [], payments: [], embassyToldAt: null, immigrationToldAt: null, familyToldAt: null };
}
