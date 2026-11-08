/**
 * Client requirements and the yearly self-audit (Fauzan, 6 Nov 2026, after reviewing the IKEA IWAY audit of Sasa at
 * IKEA DC Klang, February 2026):
 *
 *  1. A client's code of conduct checklist lives on the client needs page of the site, done by the OM or ACT, because
 *     not every client needs one. A self-audit is done by every company every year, with reminders, for the company,
 *     one site or everything.
 *  6. Working-hours and break checks only for sites whose client needs them.
 *  8. Site and hostel inspection forms, with the items the client asks for.
 *
 * The IWAY list below is Prima's plain-words summary of the requirements a security service provider answered in that
 * audit file. It is a working list, not IKEA's text: the client's current standard governs, and ACT checks it.
 */
import type { Attendance, ClientCode, ClientHoursRule, ClientRequirement, ClientRoomRule, InspectionRoom, IsoDate, Person, RbaGrade, SelfAuditScope, Shift } from './types';
import { addDays, dateOf } from './time';

export const CLIENT_CODE_LABEL: Record<ClientCode['template'], string> = {
  IWAY: 'IKEA IWAY',
  RBA: 'RBA Code of Conduct v8.0',
  CUSTOM: "Client's own list",
};

const r = (code: string, area: string, level: ClientRequirement['level'], text: string, hint: string): ClientRequirement => ({ code, area, level, text, hint });

/** IWAY items a security service provider answers for (from the February 2026 audit file; items the client runs are left out). */
export const IWAY_REQUIREMENTS: ClientRequirement[] = [
  r('G1.1', 'Routines and dialogue', 'basic', 'A named manager is responsible for meeting the client code.', 'Appointment letter or org chart'),
  r('G1.2', 'Routines and dialogue', 'basic', 'An internal audit against the code is done at least every 12 months, and it reflects the real conditions.', 'Yearly self-audit in Prima'),
  r('G1.5', 'Routines and dialogue', 'basic', 'Sub-contractors used for this client are listed, and the code is checked at each one.', 'Sub-contractor list, or "none"'),
  r('G1.8', 'Routines and dialogue', 'basic', 'Workers are told their rights and duties under the code.', 'Briefing record, roll-call topics'),
  r('G1.9', 'Routines and dialogue', 'basic', 'There is a regular, structured talk with workers about the code.', 'Briefing or meeting minutes'),
  r('G2.1', 'Lawful business', 'must', 'No bribery, false documents or deceit in the business with the client.', 'Anti-bribery policy, gift register'),
  r('G2.2', 'Lawful business', 'basic', 'All laws, licences and permits that apply are kept, and there is a routine to track them.', 'KDN licence, PLKS, law and permit list'),
  r('G3.1', 'Children', 'must', 'No child labour; ages are checked when hiring.', 'Date of birth checked from IC or passport'),
  r('G4.1', 'Labour rights', 'must', 'No forced, bonded or prison labour; workers keep their own passports.', 'Passport location checks'),
  r('G4.2', 'Labour rights', 'basic', 'Overtime is voluntary and nobody is punished for refusing it.', 'Overtime consent, worker interviews'),
  r('G4.3', 'Labour rights', 'basic', 'Workers may join or not join worker organisations without fear.', 'Policy, worker interviews'),
  r('G4.4', 'Labour rights', 'basic', 'A grievance channel workers know, in their own language, anonymous, recorded and acted on, with no retaliation.', 'Grievance QR or form, complaint log'),
  r('G4.5', 'Labour rights', 'basic', 'Workers pay no fees or deposits for recruitment, employment or leaving.', 'Arrival fee checks, agency contract'),
  r('G4.6', 'Labour rights', 'basic', 'A written recruitment routine covers age checks, screening and the use of agencies.', 'Recruitment steps record'),
  r('G4.7', 'Labour rights', 'basic', 'A signed contract, understood and copied to the worker, before work starts; changes agreed in writing.', 'Signed contract in English and the worker\'s language'),
  r('G4.8', 'Labour rights', 'basic', 'No zero-hours contracts.', 'Contract template'),
  r('G4.9', 'Labour rights', 'basic', 'Written rules on discrimination, harassment, ethics, discipline, alcohol and drugs, told to workers.', 'Handbook with worker acknowledgements'),
  r('G4.10', 'Labour rights', 'basic', 'Discipline uses no threats, public punishment, fines or removal of benefits; workers can appeal.', 'Discipline records with right to be heard and appeal'),
  r('G4.13', 'Labour rights', 'basic', 'No discrimination, violence or harassment.', 'Worker interviews, complaint log'),
  r('G5.1', 'Hours and pay', 'must', 'Working hours, overtime included, are recorded reliably for every worker.', 'Attendance (clock-in) records'),
  r('G5.2', 'Hours and pay', 'basic', 'No more than 60 hours a week, overtime included.', 'Hours check in Prima'),
  r('G5.3', 'Hours and pay', 'basic', 'At least a 30-minute break after every 4.5 hours of work.', 'Break plan for the site'),
  r('G5.4', 'Hours and pay', 'basic', 'At least 24 hours of rest in a row after 6 days of work.', 'Roster, hours check'),
  r('G5.8', 'Hours and pay', 'must', 'At least the legal minimum wage.', 'Payslips'),
  r('G5.10', 'Hours and pay', 'basic', 'Wages paid as the contract says, on time, at least monthly.', 'Bank file, pay dates'),
  r('G5.11', 'Hours and pay', 'basic', 'A payslip showing all pay, benefits and deductions; loans and advances have clear rules.', 'Payslips, advance and loan rules'),
  r('G5.12', 'Hours and pay', 'basic', 'Uniforms are given free in enough quantity; no charge for cleaning or upkeep.', 'Uniform issue log'),
  r('G5.14', 'Hours and pay', 'basic', 'Workers know how to handle emergencies and the risks of their post before they start.', 'Emergency training records'),
  r('G5.15', 'Hours and pay', 'basic', 'Workers are trained for their tasks.', 'Training records, site briefing'),
  r('G6.1', 'Health and safety', 'must', 'No severe safety hazards; a death at work is told to the client at once.', 'Risk assessment, incident reports'),
  r('G6.2', 'Health and safety', 'must', 'Accident cover for every worker for work injuries and illness.', 'SOCSO registration'),
  r('G6.3', 'Health and safety', 'basic', 'Safety risks, mental health and ergonomics included, are assessed and acted on.', 'Risk assessment (HIRARC) with ergonomics'),
  r('G6.4', 'Health and safety', 'basic', 'Safe working routines for risky work.', 'Roll-call briefings, post orders'),
  r('G6.5', 'Health and safety', 'basic', 'Equipment is safe; warning signs are visible.', 'Site inspection'),
  r('G6.6', 'Health and safety', 'basic', 'Protective equipment (vest, shoes, raincoat) is free, clean, working and right for the risk.', 'PPE issue log, site inspection'),
  r('G6.7', 'Health and safety', 'basic', 'Accidents and near misses are reported, looked into and acted on, with records kept.', 'Incident and near-miss log'),
  r('G6.8', 'Health and safety', 'basic', 'Safety hazards are reported and followed up.', 'Patrol hazard reports'),
  r('G6.9', 'Health and safety', 'basic', 'Emergency risks are assessed and written emergency routines are in place.', 'Site emergency plan'),
  r('G6.23', 'Health and safety', 'basic', 'No health tests unrelated to work (such as pregnancy or HIV).', 'Hiring checklist'),
  r('G7.1', 'Working and living', 'basic', 'The workplace and hostel are clean, lit, ventilated and kept up.', 'Site and hostel inspections'),
  r('G7.4', 'Working and living', 'basic', 'Clean drinking water, free, close to work and in the hostel.', 'Site and hostel inspections'),
  r('A7.1', 'Hostel', 'must', 'Workers are not made to live in company housing.', 'Worker choice record'),
  r('A7.2', 'Hostel', 'must', 'Residents may leave the hostel at any time.', 'Hostel rules, worker interviews'),
  r('A7.3', 'Hostel', 'basic', 'Residents have a copy of the hostel rules they understand.', 'Hostel rules in workers\' languages'),
  r('A7.4', 'Hostel', 'basic', 'Residents get a breakdown of hostel costs and proof of what they paid.', 'Utility notices, or "free of charge"'),
  r('A7.5', 'Hostel', 'basic', 'Hostel costs are not above market rates.', 'Rent and utility records'),
  r('A7.7', 'Hostel', 'basic', 'Solid building with light, steady power and water, weather protection and ventilation.', 'Hostel inspection'),
  r('A7.8', 'Hostel', 'basic', 'Not in a building with high-risk work; away from loud noise.', 'Hostel inspection'),
  r('A7.9', 'Hostel', 'basic', 'Men and women in separate rooms unless they choose to share.', 'Hostel inspection'),
  r('A7.10', 'Hostel', 'basic', 'Each room at least 3.8 m2 a resident, ceiling at least 2.1 m, at most 8 in a room.', 'Hostel inspection rooms'),
  r('A7.11', 'Hostel', 'basic', 'Own bed and mattress, lockable storage, a room key; rooms lock from inside and outside.', 'Hostel inspection'),
  r('A7.14', 'Hostel', 'basic', 'Clean cooking areas in working order; cooking only there.', 'Hostel inspection'),
  r('A7.15', 'Hostel', 'basic', 'Enough showers and toilets, by gender, with hot water.', 'Hostel inspection'),
];

export const IWAY_HOURS: ClientHoursRule = { maxWeekHours: 60, maxDaysInRow: 6, breakAfterHours: 4.5, breakMinutes: 30 };
export const IWAY_ROOMS: ClientRoomRule = { m2PerPerson: 3.8, minCeilingM: 2.1, maxPerRoom: 8 };

export const IWAY_SITE_FORM: string[] = [
  'Guards wear the protective equipment the post needs (vest, safety shoes, raincoat), clean and given free',
  'Each guard has enough uniforms, given free',
  'Guards know the emergency routine, the assembly point and who to call',
  'First aid kit and fire extinguisher at the post are in date',
  'Guardhouse or post is clean, lit and ventilated',
  'Clean drinking water and a toilet guards can reach during the shift',
  'A place to eat and rest, away from hazards',
  'Seating and screen height in the CCTV or control room are comfortable for long shifts (ergonomics)',
  'Hazards found on rounds are written in the post log and reported',
  'Accidents and near misses at this post are recorded and followed up',
  'Guards know how to raise a complaint without giving their name (QR or form posted)',
  'Guards were told their rights under the client code (briefing in the last 6 months)',
];

export const IWAY_HOSTEL_FORM: string[] = [
  'Residents say they chose to live here and may leave at any time (asked in private)',
  'Hostel rules are posted in English and the residents\' languages',
  'Residents have a breakdown of any hostel costs, or the hostel is free',
  'Building is solid, with light, steady power, water, weather protection and ventilation',
  'Not next to high-risk work or loud noise',
  'Men and women in separate rooms',
  'Each resident has an own bed and mattress, lockable storage and a room key',
  'Rooms lock from inside and outside',
  'Cooking area is clean and working; no cooking in bedrooms',
  'Enough showers and toilets, clean, with hot water',
  'Clean drinking water, free',
  'Fire extinguisher in date and exits clear',
  'Complaint QR or form posted in the residents\' languages',
];

// ---------- RBA Code of Conduct v8.0 (Fauzan, 8 Nov 2026, after the RBA readiness checklist) ----------

/**
 * Prima's plain-words working list of what an RBA client checks at a security service provider, in the five RBA
 * sections (A Labour, B Health and safety, C Environment, D Ethics, E Management system). It is a working list, not
 * the RBA's text: the client's current version of the Code governs, and ACT checks it.
 */
export const RBA_REQUIREMENTS: ClientRequirement[] = [
  r('A1', 'A. Labour', 'must', 'No forced, bonded, indentured or prison labour; nobody works against their will.', 'Welfare talks, worker interviews'),
  r('A2', 'A. Labour', 'must', 'Workers keep their own passports and ID; any safekeeping is by their written choice and returned on request.', 'Passport location checks, consent letters'),
  r('A3', 'A. Labour', 'must', 'Workers pay no recruitment fees or related costs; any fee found is repaid.', 'Arrival fee checks, agency payback'),
  r('A4', 'A. Labour', 'basic', 'Foreign-worker recruitment is traceable: licensed agency, embassy approval, interview, age check.', 'Recruitment steps record'),
  r('A5', 'A. Labour', 'basic', 'Every worker has a signed contract in a language they understand, given before they leave home or start work.', 'Signed contract on file, language recorded'),
  r('A6', 'A. Labour', 'basic', 'Workers are free to resign on lawful notice, with no penalty, deposit or fee for leaving.', 'Resignation rule in the handbook, pay run checks'),
  r('A7', 'A. Labour', 'must', 'No child labour; ages checked from IC or passport when hiring.', 'Date of birth check'),
  r('A8', 'A. Labour', 'basic', 'Working hours, overtime included, are recorded reliably for every worker.', 'Attendance (clock-in) records'),
  r('A9', 'A. Labour', 'basic', 'No more than 60 hours a week, overtime included, and at least one day off in seven, unless an emergency.', 'Hours check, roster'),
  r('A10', 'A. Labour', 'basic', 'Overtime is voluntary, recorded and paid at the legal rate.', 'Overtime records, payslips'),
  r('A11', 'A. Labour', 'must', 'At least the legal minimum wage, paid on time into the worker\'s account.', 'Pay run, bank file and bank reference'),
  r('A12', 'A. Labour', 'basic', 'A clear payslip every month showing hours, pay and every deduction; no deduction as a punishment.', 'Payslips'),
  r('A13', 'A. Labour', 'basic', 'Rest days, leave and public holidays are given and recorded.', 'Leave records, roster'),
  r('A14', 'A. Labour', 'basic', 'No harsh or inhumane treatment, harassment or threats; written rules told to workers.', 'Handbook with acknowledgements'),
  r('A15', 'A. Labour', 'basic', 'No discrimination in hiring, pay, promotion or discipline.', 'Job adverts, complaint log'),
  r('A16', 'A. Labour', 'basic', 'Discipline follows written steps, is recorded, and the worker can be heard and appeal.', 'Discipline records, appeals'),
  r('A17', 'A. Labour', 'basic', 'Workers may join or not join worker organisations without fear.', 'Policy, worker interviews'),
  r('B1', 'B. Health and safety', 'basic', 'Each site has a written risk assessment, ergonomics and night work included, reviewed yearly.', 'Site risk assessment (HIRARC)'),
  r('B2', 'B. Health and safety', 'basic', 'Post orders (assignment instructions) for every post.', 'Assignment instructions'),
  r('B3', 'B. Health and safety', 'basic', 'An emergency response plan and an emergency contact list at every site.', 'Site emergency plan, 24-hour contacts'),
  r('B4', 'B. Health and safety', 'basic', 'Fire and evacuation procedures known at the post, with drill records.', 'Fire procedure, drill record'),
  r('B5', 'B. Health and safety', 'basic', 'Incidents and accidents are reported, investigated and corrected; an accident register is kept.', 'Incident cases, accident list, corrective actions'),
  r('B6', 'B. Health and safety', 'basic', 'Protective equipment the post needs is given free, and its use is checked.', 'PPE issue log, site check'),
  r('B7', 'B. Health and safety', 'basic', 'First aid: a trained first-aider or kit reachable on every shift.', 'First aid training, kit check'),
  r('B8', 'B. Health and safety', 'basic', 'Every guard had a safety induction for the site before working there.', 'Induction sign-off'),
  r('B9', 'B. Health and safety', 'basic', 'The guardhouse or post is checked every month (light, water, toilet, rest place, hazards).', 'Monthly site check with photos'),
  r('B10', 'B. Health and safety', 'basic', 'Worker hostels are safe, clean, with space, water, toilets and fire safety.', 'Hostel inspections'),
  r('C1', 'C. Environment', 'basic', 'Electronic and scheduled waste goes to a licensed contractor with a consignment note.', 'IT disposal records'),
  r('C2', 'C. Environment', 'basic', 'Patrol vehicle fuel use is recorded and checked.', 'Fuel card records'),
  r('C3', 'C. Environment', 'basic', 'Permits that apply are valid, and environmental complaints are logged and answered.', 'Permit list, complaint log'),
  r('D1', 'D. Ethics', 'must', 'No bribery, kickbacks or improper advantage; staff know the anti-bribery policy.', 'Anti-bribery policy, yearly declarations'),
  r('D2', 'D. Ethics', 'basic', 'Gifts and hospitality are declared and decided.', 'Gift register'),
  r('D3', 'D. Ethics', 'basic', 'Conflicts of interest are declared every year and reviewed.', 'Yearly declarations reviewed by ACT'),
  r('D4', 'D. Ethics', 'basic', 'A whistleblowing channel workers can use without giving their name, with no retaliation.', 'Speak-up reports, follow-up checks'),
  r('D5', 'D. Ethics', 'basic', 'Client information (visitors, keys, CCTV, incidents) is protected and shared only as needed.', 'PDPA register, need-to-know access'),
  r('D6', 'D. Ethics', 'basic', 'Worker personal data is protected.', 'Data walls, PDPA register'),
  r('D7', 'D. Ethics', 'basic', 'Reports are investigated by someone independent of the matter.', 'Investigation records'),
  r('D8', 'D. Ethics', 'basic', 'Sensitive transactions need management approval with a reason.', 'Approvals with reasons'),
  r('E1', 'E. Management system', 'basic', 'A named RBA committee under the CEO, members chosen each year by the Chief of Staff.', 'Committee register'),
  r('E2', 'E. Management system', 'basic', 'A monthly dashboard of RBA targets is reviewed by management.', 'Monthly RBA dashboard'),
  r('E3', 'E. Management system', 'basic', 'Internal reviews trace workers end to end, and the company does a yearly self-audit.', 'Trace reviews, self-audit'),
  r('E4', 'E. Management system', 'basic', 'Findings get corrective actions that are tracked to closure.', 'Findings and fixes'),
  r('E5', 'E. Management system', 'basic', 'Expiring documents (permits, licences, contracts) are reminded before they lapse.', 'Renewal reminders'),
];

/** RBA v8.0: 60 hours a week and a day off in seven; breaks follow local law (EA 1955 s.60A: 30 minutes after 5 hours). */
export const RBA_HOURS: ClientHoursRule = { maxWeekHours: 60, maxDaysInRow: 6, breakAfterHours: 5, breakMinutes: 30 };

/** The site safety file, checked by the OM every month (RBA checklist section B). */
export const RBA_SITE_FORM: string[] = [
  'Site risk assessment is on file and was reviewed this year',
  'Post orders (assignment instructions) are at the post and current',
  'Emergency response plan and emergency contact list are at the post',
  'Guards know the incident-reporting steps',
  'Accidents and near misses this month are in the register and followed up',
  'Protective equipment the post needs is given free and worn',
  'First-aid kit is stocked and a first-aider is reachable on each shift',
  'Fire extinguisher is in date; guards know the fire and evacuation steps',
  'Every guard at the site had a safety induction (signed)',
  'Training attendance for the site is up to date',
  'Guardhouse or workstation is safe: light, ventilation, water, toilet, rest place',
  'Open incidents have an investigation and a corrective action',
];

export const RBA_HOSTEL_FORM: string[] = [
  'Residents say they chose to live here and may leave at any time (asked in private)',
  'Hostel rules are posted in the residents\' languages',
  'Each resident has an own bed, lockable storage and a key',
  'Clean drinking water, working toilets and showers',
  'Fire extinguisher in date, exits clear, no locked fire doors',
  'Clean and safe kitchen; no cooking in bedrooms',
  'Any hostel cost is shown to residents, or the hostel is free',
];

/** Monthly site health and safety check for RBA sites (RBA checklist: the Operations Supervisor every month). */
export const RBA_SITE_CHECK_DAYS = 30;

/** Plain words for the RBA readiness grades. */
export const RBA_GRADE_LABEL: Record<RbaGrade, string> = {
  green: 'Green: compliant, evidence complete and practice checked',
  yellow: 'Yellow: minor gap in papers or controls, no serious harm to workers',
  orange: 'Orange: major gap, management must act',
  red: 'Red: possible forced labour, fee, wage, passport, safety or other serious worker-rights issue, escalate today',
};

/** A fresh client code from a template, before the OM or ACT changes it to what the client asked. */
export function clientCodeDefaults(template: ClientCode['template']): Pick<ClientCode, 'name' | 'requirements' | 'hours' | 'rooms' | 'siteForm' | 'hostelForm' | 'breakPlan' | 'siteInspectEveryDays'> {
  if (template === 'IWAY')
    return {
      name: CLIENT_CODE_LABEL.IWAY,
      requirements: IWAY_REQUIREMENTS.map((x) => ({ ...x })),
      hours: { ...IWAY_HOURS },
      rooms: { ...IWAY_ROOMS },
      siteForm: [...IWAY_SITE_FORM],
      hostelForm: [...IWAY_HOSTEL_FORM],
      breakPlan: null,
      siteInspectEveryDays: null,
    };
  if (template === 'RBA')
    return {
      name: CLIENT_CODE_LABEL.RBA,
      requirements: RBA_REQUIREMENTS.map((x) => ({ ...x })),
      hours: { ...RBA_HOURS },
      // RBA sets no room sizes; the hostel form checks safety and choice instead.
      rooms: null,
      siteForm: [...RBA_SITE_FORM],
      hostelForm: [...RBA_HOSTEL_FORM],
      breakPlan: null,
      siteInspectEveryDays: RBA_SITE_CHECK_DAYS,
    };
  return { name: '', requirements: [], hours: null, rooms: null, siteForm: [], hostelForm: [], breakPlan: null, siteInspectEveryDays: null };
}

// ---------- Working hours and breaks (only where the client's code sets them) ----------

export interface HoursFlag {
  personId: string;
  staffNo: string;
  name: string;
  kind: 'week_hours' | 'days_in_row' | 'planned_week_hours';
  value: number;
  limit: number;
  /** The last day of the 7 days counted, or the last day in the row. */
  upTo: IsoDate;
}

const hoursOf = (a: Attendance, shiftEnd: string | null, nowIso: string): number => {
  if (!a.clockIn) return 0;
  const end = a.clockOut ?? (shiftEnd && shiftEnd < nowIso ? shiftEnd : null);
  if (!end) return 0;
  const h = (Date.parse(end) - Date.parse(a.clockIn)) / 3_600_000;
  return h > 0 && h < 24 ? h : 0;
};

/**
 * Checks the client's working-time limits for the workers seen at a site: worked hours in each 7 days of the last
 * `days` days (every site counts, because the limit is on the worker), days worked in a row, and the published roster
 * for the next 7 days. Breaks are not clocked, so they are checked against the site's break plan instead.
 */
export function hoursReport(
  rule: ClientHoursRule,
  siteId: string,
  people: Person[],
  attendance: Attendance[],
  shifts: Shift[],
  today: IsoDate,
  nowIso: string,
  days = 14,
): { checked: number; flags: HoursFlag[] } {
  const from = addDays(today, -(days - 1));
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const recent = attendance.filter((a) => a.clockIn && dateOf(a.clockIn) >= addDays(from, -7) && dateOf(a.clockIn) <= today);
  const ids = new Set(recent.filter((a) => a.siteId === siteId && dateOf(a.clockIn!) >= from).map((a) => a.personId));
  for (const s of shifts) if (s.siteId === siteId && s.personId && s.status === 'published' && s.date > today && s.date <= addDays(today, 7)) ids.add(s.personId);
  const byId = new Map(people.map((p) => [p.id, p]));
  const flags: HoursFlag[] = [];
  for (const pid of [...ids].sort()) {
    const p = byId.get(pid);
    const who = { personId: pid, staffNo: p?.staffNo ?? '', name: p?.name ?? pid };
    const perDay = new Map<IsoDate, number>();
    for (const a of recent.filter((x) => x.personId === pid)) {
      const d = dateOf(a.clockIn!);
      perDay.set(d, (perDay.get(d) ?? 0) + hoursOf(a, a.shiftId ? shiftById.get(a.shiftId)?.end ?? null : null, nowIso));
    }
    // Worst 7-day window ending on each day in the period.
    let worst = { v: 0, d: today };
    for (let i = 0; i < days; i++) {
      const end = addDays(from, i);
      let sum = 0;
      for (let k = 0; k < 7; k++) sum += perDay.get(addDays(end, -k)) ?? 0;
      if (sum > worst.v) worst = { v: sum, d: end };
    }
    if (worst.v > rule.maxWeekHours) flags.push({ ...who, kind: 'week_hours', value: Math.round(worst.v * 10) / 10, limit: rule.maxWeekHours, upTo: worst.d });
    let run = 0;
    let best = { v: 0, d: today };
    for (let i = -7; i < days; i++) {
      const d = addDays(from, i);
      run = (perDay.get(d) ?? 0) > 0 ? run + 1 : 0;
      if (run > best.v) best = { v: run, d };
    }
    if (best.v > rule.maxDaysInRow) flags.push({ ...who, kind: 'days_in_row', value: best.v, limit: rule.maxDaysInRow, upTo: best.d });
    const planned = shifts
      .filter((s) => s.personId === pid && s.status === 'published' && s.date > today && s.date <= addDays(today, 7))
      .reduce((n, s) => n + Math.max(0, (Date.parse(s.end) - Date.parse(s.start)) / 3_600_000), 0);
    if (planned > rule.maxWeekHours) flags.push({ ...who, kind: 'planned_week_hours', value: Math.round(planned * 10) / 10, limit: rule.maxWeekHours, upTo: addDays(today, 7) });
  }
  return { checked: ids.size, flags };
}

/**
 * Whether the site's break plan meets the client's rule for the longest shift at the site: a break of at least the
 * client's minutes for every full stretch of `breakAfterHours` worked.
 */
export function breakPlanCheck(rule: ClientHoursRule, plan: { count: number; minutes: number } | null, longestShiftHours: number): { ok: boolean | null; needed: number; why: string } {
  const needed = longestShiftHours > rule.breakAfterHours ? Math.floor(longestShiftHours / rule.breakAfterHours) : 0;
  if (!needed) return { ok: true, needed, why: `Shifts are ${rule.breakAfterHours} hours or shorter.` };
  if (!plan) return { ok: null, needed, why: `No break plan recorded. A ${Math.round(longestShiftHours * 10) / 10}-hour shift needs ${needed} breaks of ${rule.breakMinutes} minutes.` };
  if (plan.count < needed) return { ok: false, needed, why: `The plan gives ${plan.count} breaks; a ${Math.round(longestShiftHours * 10) / 10}-hour shift needs ${needed}.` };
  if (plan.minutes < rule.breakMinutes) return { ok: false, needed, why: `Breaks of ${plan.minutes} minutes are shorter than ${rule.breakMinutes}.` };
  return { ok: true, needed, why: `${plan.count} breaks of ${plan.minutes} minutes cover a ${Math.round(longestShiftHours * 10) / 10}-hour shift.` };
}

/** Rooms that break the client's room rule, with the reason. */
export function roomProblems(rule: ClientRoomRule, rooms: InspectionRoom[]): { name: string; why: string }[] {
  const out: { name: string; why: string }[] = [];
  for (const x of rooms) {
    const why: string[] = [];
    if (x.residents > rule.maxPerRoom) why.push(`${x.residents} residents, most is ${rule.maxPerRoom}`);
    if (x.residents > 0 && x.areaM2 < rule.m2PerPerson * x.residents)
      why.push(`${x.areaM2} m2 for ${x.residents}, needs ${Math.round(rule.m2PerPerson * x.residents * 10) / 10} m2`);
    if (x.ceilingM < rule.minCeilingM) why.push(`ceiling ${x.ceilingM} m, least is ${rule.minCeilingM} m`);
    if (why.length) out.push({ name: x.name, why: why.join('; ') });
  }
  return out;
}

// ---------- Yearly self-audit ----------

/** What every company checks itself on each year (company office part). */
export const SELF_AUDIT_COMPANY: { key: string; text: string }[] = [
  { key: 'c.hours', text: 'Working hours, overtime included, are recorded for every worker' },
  { key: 'c.limits', text: 'Nobody works over the legal daily hours or overtime limit; everyone gets a rest day each week' },
  { key: 'c.wage', text: 'Everyone gets at least the minimum wage, paid by the 7th into a bank account' },
  { key: 'c.payslip', text: 'Every worker gets a full payslip that matches what was paid' },
  { key: 'c.advances', text: 'Advances and loans follow the written rules and are shown on payslips' },
  { key: 'c.contract', text: 'Every worker signed a contract before starting, in a language they understand, and has a copy' },
  { key: 'c.fees', text: 'No worker paid a recruitment fee or deposit' },
  { key: 'c.passport', text: 'Foreign workers keep their own passports (or gave written consent to safekeeping)' },
  { key: 'c.age', text: 'Every worker\'s age was checked from IC or passport when hired' },
  { key: 'c.handbook', text: 'The handbook (discipline, harassment, ethics, alcohol and drugs) was given and acknowledged' },
  { key: 'c.discipline', text: 'Discipline cases followed the handbook, with the right to be heard and to appeal; no fines' },
  { key: 'c.grievance', text: 'Workers know how to complain without giving their name, and every complaint was acted on' },
  { key: 'c.uniform', text: 'Uniforms and protective equipment were given free as the policy says' },
  { key: 'c.training', text: 'Training, including emergency training, is up to date for every worker' },
  { key: 'c.socso', text: 'Every worker is covered by SOCSO' },
  { key: 'c.risk', text: 'The risk assessment (HIRARC) was reviewed this year, including ergonomics and mental health' },
  { key: 'c.accidents', text: 'Accidents and near misses were recorded, looked into and acted on' },
  { key: 'c.permits', text: 'Company licences and worker permits are valid (KDN, PLKS, others)' },
  { key: 'c.hostels', text: 'Every worker hostel was inspected this year (if the company has any)' },
  { key: 'c.clientcodes', text: 'Every site with a client code had its checklist reviewed this year' },
];

/** What is checked for each site. */
export const SELF_AUDIT_SITE: { key: string; text: string }[] = [
  { key: 's.ppe', text: 'Guards at the site have the uniform and protective equipment their post needs' },
  { key: 's.emergency', text: 'Guards know the site emergency routine and who to call' },
  { key: 's.welfare', text: 'Water, toilet and a rest place are available to guards during the shift' },
  { key: 's.hours', text: 'Rosters at the site keep within the hours and rest-day limits' },
  { key: 's.log', text: 'The post log records hazards, accidents and near misses, and they were followed up' },
  { key: 's.client', text: 'The client code checklist and inspections for the site are up to date (if the client has one)' },
];

export function selfAuditItems(scope: SelfAuditScope): { key: string; text: string }[] {
  if (scope === 'site') return SELF_AUDIT_SITE;
  if (scope === 'company') return SELF_AUDIT_COMPANY;
  return [...SELF_AUDIT_COMPANY, ...SELF_AUDIT_SITE];
}

export type DueState = 'not_done' | 'ok' | 'soon' | 'due' | 'overdue';

/** Where a yearly self-audit stands against its due date, and the reminder that goes with it. */
export function selfAuditDue(lastDoneOn: IsoDate | null, today: IsoDate, everyMonths: number, remindDays: number[]): { dueOn: IsoDate | null; daysLeft: number | null; state: DueState } {
  if (!lastDoneOn) return { dueOn: null, daysLeft: null, state: 'not_done' };
  const d = new Date(`${lastDoneOn}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + everyMonths);
  const dueOn = d.toISOString().slice(0, 10);
  const daysLeft = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const far = Math.max(...remindDays);
  const near = Math.min(...remindDays);
  const state: DueState = daysLeft < 0 ? 'overdue' : daysLeft <= near ? 'due' : daysLeft <= far ? 'soon' : 'ok';
  return { dueOn, daysLeft, state };
}
