// Remote and branch work plan (Fauzan, 27 Oct 2026): not everyone knows what to do, so every role has a written
// playbook, managers give tasks with a definition of done, and work is judged by output with proof. Far branches run
// on dated checklists with photo proof, a scorecard and a visit cycle. Tasks live in Prima and Microsoft Planner, with
// Planner preferred (P1); built for all staff now for study, on mock data (P3).

import { regionOfState } from './regions';
import { addDays, dateOf, myt } from './time';
import type { IsoDate, IsoDateTime, User } from './types';

export type WorkEvery = 'daily' | 'weekly' | 'monthly';

/** One recurring duty in a role playbook, with what "done" means so the person knows when it is finished. */
export interface PlaybookItem {
  id: string;
  text: string;
  doneMeans: string;
  every: WorkEvery;
  /** daily: due time HH:MM; weekly: weekday 1-5 (due 17:00); monthly: day of month (due 17:00). */
  due: string | number;
}

/** An output measure read from Prima's own records: audit actions whose name starts with one of the prefixes. */
export interface RoleMeasure {
  id: string;
  label: string;
  prefixes: string[];
  /** The standard per week, proposed for each role. */
  perWeek: number;
}

export interface Playbook {
  key: string;
  title: string;
  items: PlaybookItem[];
  measures: RoleMeasure[];
}

const d = (id: string, text: string, doneMeans: string, due = '17:00'): PlaybookItem => ({ id, text, doneMeans, every: 'daily', due });
const w = (id: string, text: string, doneMeans: string, due = 5): PlaybookItem => ({ id, text, doneMeans, every: 'weekly', due });
const m = (id: string, text: string, doneMeans: string, due = 25): PlaybookItem => ({ id, text, doneMeans, every: 'monthly', due });
const mz = (id: string, label: string, prefixes: string[], perWeek: number): RoleMeasure => ({ id, label, prefixes, perWeek });

/**
 * Draft playbooks, written from the job scopes Fauzan gave on 23-27 Oct 2026. Each department head edits their own
 * before go-live; HR keeps the signed copy. A role without one shows "No playbook yet" rather than an empty list.
 */
export const PLAYBOOKS: Playbook[] = [
  {
    key: 'it:executive',
    title: 'IT Executive',
    items: [
      d(
        'it-ex-queue',
        'Clear the helpdesk queue',
        'Every ticket older than 1 working day is answered, with the fix or the next step written in the ticket.',
        '12:00',
      ),
      d(
        'it-ex-onboard',
        'Set up accounts and devices for new staff starting this week',
        'Account, M365 licence and device issued and recorded against the person before day one.',
      ),
      w('it-ex-backup', 'Check the backup report', 'The weekly backup report is attached, with any failed job re-run or raised to the IT Lead.'),
      m('it-ex-assets', 'Count your share of electronic assets', 'Each asset on your list is seen, tagged and its holder confirmed in Prima.'),
    ],
    measures: [
      mz('it-tickets', 'Helpdesk tickets updated', ['it.ticket'], 15),
      mz('it-assets', 'Asset and onboarding records', ['it.asset', 'it.onboarding'], 2),
    ],
  },
  {
    key: 'it:lead',
    title: 'IT Lead',
    items: [
      d('it-ld-queue', 'Check the team queue and reassign stuck tickets', 'No ticket is past its target time without a named owner and a next step.', '10:00'),
      w('it-ld-maint', 'Plan next week’s maintenance', 'The maintenance list for next week is in Prima with an owner for each job.'),
      m('it-ld-report', 'Monthly IT report to the IT Manager', 'Tickets, assets, licences and risks for the month, sent with the figures from Prima.'),
    ],
    measures: [mz('it-maint', 'Maintenance and tickets', ['it.maintenance', 'it.ticket'], 8)],
  },
  {
    key: 'it:manager',
    title: 'IT Manager',
    items: [
      w('it-mg-review', 'Review open IT purchases and tenders', 'Each purchase and tender has a decision or a dated next step.'),
      m('it-mg-domains', 'Check domains, licences and renewals due in 60 days', 'Every renewal due has an owner and a payment request.'),
    ],
    measures: [mz('it-purchase', 'Purchases and tenders handled', ['it.purchase', 'it.tender'], 2)],
  },
  {
    key: 'finance:data_entry',
    title: 'Finance Data Entry Executive',
    items: [
      d(
        'fin-de-key',
        'Key in the day’s supplier invoices and receipts into SQL Account',
        'Every document received by 15:00 is keyed in, with the SQL Account document number written back on the paper record.',
      ),
      d('fin-de-file', 'File payment vouchers', 'Vouchers for payments made today are filed with their supporting documents.', '17:30'),
      w(
        'fin-de-recon',
        'Bank reconciliation for your team’s accounts',
        'Reconciliation agreed to the bank statement, with unmatched items listed for the Team Leader.',
      ),
    ],
    measures: [mz('fin-papers', 'Finance papers recorded', ['finance.', 'expense.', 'payroll.'], 10)],
  },
  {
    key: 'finance:deputy',
    title: 'Finance Deputy',
    items: [
      d(
        'fin-dp-check',
        'Check yesterday’s entries by the data entry team',
        'A sample of 10 entries is checked against the papers, errors returned with a note.',
        '11:00',
      ),
      w('fin-dp-recon', 'Review the bank reconciliations', 'Each reconciliation is signed off or returned with what to fix.'),
    ],
    measures: [mz('fin-papers', 'Finance papers checked', ['finance.', 'expense.'], 5)],
  },
  {
    key: 'finance:leader',
    title: 'Finance Team Leader',
    items: [
      w('fin-ld-cash', 'Weekly cash position for your companies', 'Cash in bank, due payments and receipts for next week, sent to the Finance Director.'),
      m(
        'fin-ld-close',
        'Month-end close for your companies',
        'All entries in, reconciliations signed, the close checklist complete by the 5th working day.',
        5,
      ),
    ],
    measures: [mz('fin-papers', 'Finance papers approved', ['finance.', 'payroll.'], 5)],
  },
  {
    key: 'hr',
    title: 'HR Admin',
    items: [
      d('hr-leave', 'Answer leave and claims waiting more than one day', 'Each request has a decision or is sent to the right approver with a note.', '12:00'),
      w('hr-hiring', 'Chase missing hiring documents', 'Every new hire’s checklist is complete or the gap has a date and an owner.'),
      m('hr-socso', 'Review open SOCSO cases', 'Each case has its next step and date written in Prima.'),
    ],
    measures: [mz('hr-records', 'HR records handled', ['leave.', 'hr.', 'socso.', 'claims.'], 10)],
  },
  {
    key: 'director_office',
    title: 'Director Office Administrator',
    items: [
      d('doa-tenders', 'Check tender deadlines in the next 7 days', 'Each tender has its checklist sent and the preparer named.', '10:00'),
      w('doa-weekly', 'Weekly report to the CEO', 'The weekly report is sent with the figures taken from Prima.', 1),
      w('doa-meetings', 'Prepare next week’s meetings', 'Each meeting has a numbered agenda and its pre-briefing checklist.'),
    ],
    measures: [mz('doa-work', 'Tenders and meetings handled', ['tender.', 'meeting.'], 8)],
  },
  {
    key: 'fwm:executive',
    title: 'FWM Executive',
    items: [
      d('fwm-ex-tasks', 'Follow up OM tasks due today', 'Each task has the proof uploaded and accepted, or a chaser sent with a new date.', '15:00'),
      w('fwm-ex-renew', 'Check permits and passports due in 120 days', 'Every renewal due has its papers started in Prima.'),
    ],
    measures: [mz('fwm-work', 'Foreign worker tasks and renewals', ['fwm.'], 8)],
  },
  {
    key: 'fwm:manager',
    title: 'FWM Manager or Deputy',
    items: [
      w('fwm-mg-ladder', 'Review renewals on the escalation ladder', 'Every renewal at 60 days or less has a named action and date.'),
      m('fwm-mg-report', 'Monthly foreign worker report to the Chief of Staff', 'Headcount, renewals, Year 10 plans and hostel issues, from Prima.'),
    ],
    measures: [mz('fwm-work', 'Foreign worker decisions', ['fwm.'], 4)],
  },
  {
    key: 'procurement:executive',
    title: 'Procurement Executive',
    items: [
      d('pur-ex-requests', 'Process purchase requests', 'Each request has 3 quotes and the online price check attached, or a note on why not.'),
      w('pur-ex-suppliers', 'Chase late deliveries', 'Each late order has a new delivery date from the supplier.'),
    ],
    measures: [mz('pur-work', 'Purchase requests handled', ['pur.', 'quotation.'], 5)],
  },
  {
    key: 'procurement:storekeeper',
    title: 'Storekeeper',
    items: [
      d('store-issue', 'Record every issue and return at the store', 'Each item out or in is in Prima with the receiver’s name the same day.', '17:30'),
      m('store-count', 'Stock count', 'The count sheet is matched to Prima and differences explained.'),
    ],
    measures: [mz('store-work', 'Store issues and returns', ['store.'], 10)],
  },
  {
    key: 'audit',
    title: 'ACT (Audit, Compliance and Transformation)',
    items: [
      w('act-findings', 'Follow up open findings', 'Each finding past its date is chased with the owner and the reply recorded.'),
      m('act-plan', 'Carry out the month’s audits on the plan', 'Each audit on the plan has its evidence and findings in Prima.'),
    ],
    measures: [mz('act-work', 'Audits and findings', ['act.', 'grc.'], 4)],
  },
  {
    key: 'legal',
    title: 'Legal Counsel',
    items: [w('legal-matters', 'Update every open legal matter', 'Each matter has its status and next court or filing date.')],
    measures: [mz('legal-work', 'Legal matters updated', ['legal.', 'corp.'], 3)],
  },
  {
    key: 'arms_control',
    title: 'Arms Control',
    items: [
      d('arms-count', 'Check the vault counts reported today', 'Every vault due a count has one recorded, and each difference is raised as a case.', '18:00'),
      w('arms-requests', 'Review armed job requests', 'Each request is approved, refused or has a dated question.'),
    ],
    measures: [mz('arms-work', 'Arms records', ['arms.'], 10)],
  },
  {
    key: 'cms',
    title: 'CMS Command Centre',
    items: [
      d('cms-handover', 'Shift handover', 'The handover note lists open alarms and calls, signed by both shifts.', '08:00'),
      m('cms-spot', 'Random video spot checks at far branches', 'Up to 2 checks per branch this month, each with its result recorded.'),
    ],
    measures: [mz('cms-work', 'Alarms, call-backs and handovers', ['arms.cms'], 15)],
  },
  {
    key: 'asset',
    title: 'Asset Management',
    items: [
      w('asset-rent', 'Chase rent arrears', 'Each tenant in arrears has a reminder sent or a payment recorded.'),
      m('asset-maint', 'Inspect your properties', 'Each property on the month’s list has an inspection note and photos.'),
    ],
    measures: [mz('asset-work', 'Asset records', ['asset.', 'rent.'], 3)],
  },
  {
    key: 'transport',
    title: 'Transport',
    items: [
      d('fleet-out', 'Check vehicles out and in', 'Every trip has its out and in readings recorded.', '18:00'),
      w('fleet-service', 'Plan services due', 'Each vehicle due a service has a booked date.'),
    ],
    measures: [mz('fleet-work', 'Fleet records', ['fleet.'], 10)],
  },
  {
    key: 'pdpa',
    title: 'PDPA Officer',
    items: [
      w('pdpa-requests', 'Answer data requests', 'Each access or correction request is answered within its due date.'),
      m('pdpa-review', 'Review consents and notices for new products', 'Each new product has its notice and consent checked.'),
    ],
    measures: [mz('pdpa-work', 'PDPA records', ['pdpa.'], 2)],
  },
  {
    key: 'company_manager',
    title: 'Company Manager',
    items: [
      d('cm-cover', 'Check guard cover and open cases for your company', 'Every unfilled post and open case past due has a named action.', '10:00'),
      w('cm-clients', 'Client follow-ups', 'Each client issue raised this week has a reply recorded.'),
      m('cm-branches', 'Review your branches’ scorecards', 'Each red or unknown measure has an action and a date.'),
    ],
    measures: [mz('cm-work', 'Company decisions recorded', ['case.', 'client.', 'roster.', 'branch.', 'remote.approve'], 5)],
  },
  {
    key: 'admin_exec',
    title: 'Company Admin Executive',
    items: [
      d('ae-docs', 'Record documents received today', 'Every licence, letter and invoice received is filed in Prima against its record.'),
      w('ae-renewals', 'Check licences and permits due in 60 days', 'Each renewal due has its papers started.'),
    ],
    measures: [mz('ae-work', 'Company records kept', ['client.', 'contract.', 'leave.', 'expense.'], 5)],
  },
  {
    key: 'branch_manager',
    title: 'Branch Manager (far branch)',
    items: [
      d('br-daily', 'Daily branch checklist with photo', 'Guard cover, posts visited and incidents checked, sent with a stamped photo by 10:00.', '10:00'),
      w('br-weekly', 'Weekly branch checklist', 'Client contact, vehicles, equipment and staff issues for the week, sent by Friday.'),
      m('br-monthly', 'Monthly branch checklist', 'Billing sent, collections chased, licences and training due, sent by the 25th.'),
    ],
    measures: [mz('br-work', 'Branch records', ['branch.', 'case.', 'site.visit'], 5)],
  },
  {
    key: 'operations:om',
    title: 'Operations Manager',
    items: [
      d('om-cases', 'Act on open cases in your area', 'Every case past its target time has a step recorded.', '12:00'),
      m('om-visits', 'Visit each far branch twice this month', 'Two visits per branch, each with findings and a photo.'),
    ],
    measures: [mz('om-work', 'Visits and cases', ['site.visit', 'case.', 'branch.visit'], 8)],
  },
  {
    key: 'operations:regional',
    title: 'Regional Operations Manager',
    items: [
      w('rom-review', 'Review OM visits and case escalations', 'Each escalated case has your confirmation or a returned note.'),
      m('rom-visit', 'Visit each far branch in your region once this month', 'One visit per branch with findings and a photo.'),
    ],
    measures: [mz('rom-work', 'Visits and confirmations', ['branch.visit', 'case.'], 3)],
  },
  {
    key: 'operations:patrol',
    title: 'Patrolling Officer',
    items: [
      d('po-attendance', 'Check guard attendance on your sites', 'Every no-show on your sites has a replacement or is raised to the OM.', '09:00'),
      d(
        'po-patrol',
        'Patrol your route and scan every checkpoint',
        'Every site on today’s route visited and scanned; any issue raised as a case with a photo.',
        '18:00',
      ),
      w('po-pic', 'Meet the client PIC at your main sites', 'One line per site on what the PIC said, recorded as a site visit.'),
    ],
    measures: [mz('po-work', 'Patrol scans and site visits', ['patrol.', 'site.visit'], 20)],
  },
  {
    key: 'supervisor',
    title: 'Site Officer',
    items: [
      d('so-handover', 'Shift handover and post check', 'Each post has its guard, log book signed, and any issue raised as a case.', '08:30'),
      w('so-training', 'Brief your guards on one SOP', 'The SOP briefed and the guards who attended, written in the site log.'),
    ],
    measures: [mz('so-work', 'Attendance and cases', ['attendance.', 'case.'], 10)],
  },
  {
    key: 'operations:senior',
    title: 'Senior Operations (COO, Operations Director, OGM)',
    items: [
      w('ops-escalated', 'Review escalated cases and red branches', 'Each escalated case and red branch measure has your decision or a dated action.', 1),
      m('ops-report', 'Monthly sector report', 'Cover, cases, clients and branches for your sector, from Prima.', 5),
    ],
    measures: [mz('ops-work', 'Cases and branch decisions', ['case.', 'branch.'], 2)],
  },
  {
    key: 'leadership',
    title: 'Group leadership (Chief of Staff, Deputy, Finance Director)',
    items: [
      d('lead-approvals', 'Clear approvals waiting on you', 'Nothing waits on you for more than one working day without a note.', '17:00'),
      w('lead-summary', 'Act on your departments’ Monday summary', 'Each red line on the summary has an owner and a date.', 1),
    ],
    measures: [],
  },
  {
    key: 'finance:officer',
    title: 'Finance Officer',
    items: [
      w('fin-of-update', 'Update the records you look after', 'Every record on your list is up to date, with differences raised to the Finance Director.'),
      m('fin-of-report', 'Monthly report to the Finance Director', 'Balances and issues for the month, from Prima and SQL Account.'),
    ],
    measures: [mz('fin-of-work', 'Finance and credit records', ['finance.', 'credit.', 'asset.'], 2)],
  },
];

export const NO_PLAYBOOK: Playbook = { key: 'none', title: 'No playbook yet', items: [], measures: [] };

/** Which playbook a person follows, from their department and role. */
export function playbookKey(u: User): string {
  if (u.branchId) return 'branch_manager';
  if (u.role === 'company_manager') return 'company_manager';
  if (u.role === 'admin_exec') return 'admin_exec';
  if (u.itRole) return `it:${u.itRole}`;
  if (u.financeRole) return `finance:${u.financeRole}`;
  if (u.fwmRole) return u.fwmRole === 'executive' || u.fwmRole === 'despatch' ? 'fwm:executive' : 'fwm:manager';
  if (u.procRole) return `procurement:${u.procRole}`;
  if (u.opsTier === 'om') return 'operations:om';
  if (u.opsTier === 'regional') return 'operations:regional';
  if (u.opsTier === 'patrol') return 'operations:patrol';
  if (u.role === 'supervisor') return 'supervisor';
  if (u.opsTier === 'ogm' || u.opsTier === 'ops_director' || u.opsTier === 'coo' || u.department === 'operations') return 'operations:senior';
  if (u.leadership === 'cos' || u.leadership === 'deputy_cos' || u.leadership === 'finance_director') return 'leadership';
  if (u.department === 'finance') return 'finance:officer';
  if (u.department && ['hr', 'director_office', 'audit', 'legal', 'arms_control', 'cms', 'asset', 'transport', 'pdpa'].includes(u.department))
    return u.department;
  return 'none';
}

export function playbookFor(u: User): Playbook {
  const key = playbookKey(u);
  return PLAYBOOKS.find((p) => p.key === key) ?? NO_PLAYBOOK;
}

/**
 * Each person's line manager, from the reporting lines Fauzan gave (IT, Finance, FWM, Procurement, ACT, Operations,
 * company managers and branches). Where no line is set, the Chief of Staff is shown and marked as assumed.
 */
export function lineManagerOf(u: User, users: User[]): { manager: User | null; assumed: boolean } {
  const find = (p: (x: User) => boolean) => users.find((x) => x.id !== u.id && !x.integration && p(x)) ?? null;
  const ceo = () => find((x) => x.opsTier === 'ceo');
  const coo = () => find((x) => x.opsTier === 'coo');
  const cos = () => find((x) => x.leadership === 'cos');
  const pick = (...steps: (() => User | null)[]) => {
    for (const s of steps) {
      const r = s();
      if (r) return { manager: r, assumed: false };
    }
    return { manager: cos(), assumed: true };
  };
  if (u.opsTier === 'ceo' || u.leadership === 'chairman' || u.leadership === 'vice_chairman') return { manager: null, assumed: false };
  if (u.opsTier === 'coo' || u.leadership === 'cos' || u.leadership === 'finance_director') return pick(ceo);
  if (u.leadership === 'deputy_cos') return pick(cos);
  if (u.opsTier === 'patrol') {
    // The officer's state is in their title, e.g. "Patrolling Officer, Sasa (Selangor)": the OM for that state, else the Regional OM.
    const state = (/\(([^)]+)\)\s*$/.exec(u.title)?.[1] ?? '').split(',')[0].trim();
    const region = regionOfState(state)?.id;
    return pick(
      () => find((x) => x.opsTier === 'om' && (x.areaStates ?? []).includes(state)),
      () => find((x) => x.opsTier === 'regional' && !!region && (x.regionIds ?? []).includes(region)),
    );
  }
  // A site officer reports to the patrolling officer for their sites (case escalation, 25 Oct 2026).
  if (u.role === 'supervisor')
    return pick(
      () => find((x) => x.opsTier === 'patrol' && x.siteIds.some((s) => u.siteIds.includes(s))),
      () => find((x) => x.role === 'company_manager' && !x.title.startsWith('General') && x.companyIds.includes(u.companyIds[0])),
    );
  if (u.branchId) return pick(() => find((x) => x.role === 'company_manager' && !x.title.startsWith('General') && x.companyIds.includes(u.companyIds[0])));
  if (u.role === 'admin_exec')
    return pick(() => find((x) => x.role === 'company_manager' && !x.title.startsWith('General') && x.companyIds.includes(u.companyIds[0])));
  if (u.role === 'company_manager') {
    if (u.title.startsWith('General')) return pick(coo);
    return pick(() => find((x) => x.role === 'company_manager' && x.title.startsWith('General') && x.companyIds.includes(u.companyIds[0])), coo);
  }
  if (u.itRole === 'executive') return pick(() => find((x) => x.itRole === 'lead'));
  if (u.itRole === 'lead') return pick(() => find((x) => x.itRole === 'manager'));
  if (u.itRole === 'manager') return pick(coo);
  if (u.financeRole === 'data_entry' || u.financeRole === 'deputy')
    return pick(() => find((x) => x.financeRole === 'leader' && x.financeTeam === u.financeTeam));
  if (u.financeRole === 'leader' || u.department === 'finance') return pick(() => find((x) => x.leadership === 'finance_director'));
  if (u.fwmRole === 'executive' || u.fwmRole === 'despatch')
    return pick(
      () => find((x) => x.fwmRole === 'deputy'),
      () => find((x) => x.fwmRole === 'manager'),
    );
  if (u.fwmRole === 'deputy') return pick(() => find((x) => x.fwmRole === 'manager'));
  if (u.fwmRole === 'manager') return pick(cos);
  if (u.procRole === 'storekeeper') return pick(() => find((x) => x.procRole === 'executive'));
  if (u.procRole === 'executive') return pick(() => find((x) => x.opsTier === 'ogm'));
  if (u.actRole === 'auditor' || u.actRole === 'enforcement') return pick(() => find((x) => x.actRole === 'lead'));
  if (u.actRole === 'lead') return pick(ceo);
  if (u.opsTier === 'om') return pick(() => find((x) => x.opsTier === 'regional' && (x.regionIds ?? []).some((r) => (u.regionIds ?? []).includes(r))));
  if (u.opsTier === 'regional') return pick(() => find((x) => x.opsTier === 'ops_director'));
  if (u.opsTier === 'ogm' || u.opsTier === 'ops_director') return pick(coo);
  if (u.department === 'pdpa') return pick(() => find((x) => x.opsTier === 'ops_director'));
  if (u.department === 'cms') return pick(() => find((x) => x.department === 'arms_control' && x.title.includes('Manager')));
  if (u.department === 'arms_control')
    return u.title.includes('Manager') ? pick(coo) : pick(() => find((x) => x.department === 'arms_control' && x.title.includes('Manager')));
  if (u.department === 'asset') return u.assetRole === 'director' ? pick(ceo) : pick(() => find((x) => x.assetRole === 'director'));
  if (u.department === 'transport' || u.department === 'operations') return pick(coo);
  if (u.department === 'hr' || u.department === 'director_office' || u.department === 'legal' || u.department === 'chief_of_staff') return pick(cos);
  return { manager: cos(), assumed: true };
}

/** The period a recurring duty belongs to: the date, the Monday of the week, or the month. */
export function periodOf(every: WorkEvery, date: IsoDate): string {
  if (every === 'daily') return date;
  if (every === 'monthly') return date.slice(0, 7);
  const wd = new Date(`${date}T12:00:00+08:00`).getUTCDay() || 7;
  return addDays(date, 1 - wd);
}

/** When a duty is due in its period. */
export function dueOf(item: PlaybookItem, date: IsoDate): IsoDateTime {
  if (item.every === 'daily') return myt(date, String(item.due));
  if (item.every === 'weekly') return myt(addDays(periodOf('weekly', date), Number(item.due) - 1), '17:00');
  const day = Math.min(28, Number(item.due));
  return myt(`${date.slice(0, 7)}-${String(day).padStart(2, '0')}`, '17:00');
}

/** Monday of the week a moment falls in. */
export function weekOf(t: IsoDateTime): IsoDate {
  return periodOf('weekly', dateOf(t));
}

/** Branch checklists (D8): what the branch manager confirms, and when each is due. */
export const BRANCH_CHECKS: Record<WorkEvery, { due: string; items: { key: string; label: string }[] }> = {
  daily: {
    due: '10:00',
    items: [
      { key: 'cover', label: 'Every post is covered (no-shows replaced)' },
      { key: 'incidents', label: 'Last night’s incidents read and cases raised' },
      { key: 'arms', label: 'Armed posts: firearms issued and returned match' },
      { key: 'office', label: 'Branch office open and phone answered' },
    ],
  },
  weekly: {
    due: 'Friday 17:00',
    items: [
      { key: 'clients', label: 'Client contact made for every site with an open issue' },
      { key: 'vehicles', label: 'Vehicles checked (tyres, fuel log, dashcam)' },
      { key: 'equipment', label: 'Radios, torches and uniforms checked' },
      { key: 'staff', label: 'Staff issues, leave and discipline written up' },
    ],
  },
  monthly: {
    due: '25th 17:00',
    items: [
      { key: 'billing', label: 'Billing papers sent to Finance' },
      { key: 'collections', label: 'Unpaid invoices chased with the client' },
      { key: 'licences', label: 'Guard permits, KDN vetting and CSG due checked' },
      { key: 'training', label: 'Training due next month booked' },
    ],
  },
};

export type ScoreState = 'green' | 'amber' | 'red' | 'unknown';

/** A measure with no data is UNKNOWN, never green (V15). */
export function scoreOf(value: number | null, green: number, amber: number): ScoreState {
  if (value === null || Number.isNaN(value)) return 'unknown';
  if (value >= green) return 'green';
  if (value >= amber) return 'amber';
  return 'red';
}

/** Microsoft Planner connection (P1). The mock stands in until Entra sign-in and the Graph permissions are approved. */
export interface PlannerGateway {
  readonly mode: 'mock' | 'graph';
  /** Create or update the task in Planner; returns Planner's task id. */
  push(task: {
    id: string;
    title: string;
    dueAt: string;
    done: boolean;
    assigneeEmail: string | null;
    planId: string;
    taskId: string | null;
  }): Promise<{ taskId: string }>;
}

export const mockPlannerGateway: PlannerGateway = {
  mode: 'mock',
  async push(t) {
    return { taskId: t.taskId ?? `mock-planner-${t.id}` };
  },
};

/** The same date some months later (end of month clamps). */
export function addMonthsIso(date: IsoDate, months: number): IsoDate {
  const [y, mo, dd] = date.split('-').map(Number);
  const total = y * 12 + (mo - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
}

/** The department a person is counted under on the CEO summary. */
export function workGroupOf(u: User): string {
  if (u.branchId) return 'Far branches';
  if (u.role === 'company_manager' || u.role === 'admin_exec') return 'Company offices';
  if (u.role === 'supervisor' || u.opsTier) return 'Operations';
  if (u.leadership) return 'Leadership';
  const names: Record<string, string> = {
    it: 'IT',
    finance: 'Finance',
    hr: 'HR',
    fwm: 'Foreign Worker Management',
    procurement: 'Procurement',
    audit: 'ACT',
    legal: 'Legal',
    director_office: 'Director Office',
    chief_of_staff: 'Leadership',
    arms_control: 'Arms Control and CMS',
    cms: 'Arms Control and CMS',
    asset: 'Asset Management',
    transport: 'Transport',
    pdpa: 'PDPA',
    operations: 'Operations',
  };
  return (u.department && names[u.department]) || 'Other';
}
