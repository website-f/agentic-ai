// Who may see and do what. The company controls company matters (V12): PWVSB and the
// Director Office see a company only through a dated authority grant, and act on it only
// with an 'act' grant. The database enforces the same walls with row-level security.

import type { AuthorityGrant, Id, IsoDate, Person, User } from './types';

export type Action =
  | 'view'
  | 'roster.edit'
  | 'roster.publish'
  | 'attendance.clock'
  | 'attendance.lock'
  | 'case.raise'
  | 'case.update'
  | 'case.close'
  | 'patrol.scan'
  /** See tenders and quotations: company managers, admin executives, and group users with a grant. */
  | 'commercial.view'
  /** Prepare quotations and update tender progress. */
  | 'commercial.prepare'
  /** Approve a quotation within written authority. The company decides, never PWVSB on its behalf. */
  | 'commercial.approve'
  /** See vaults, firearms and movements. Need-to-know: not admin staff or site devices. */
  | 'arms.view'
  /** Issue, receive and count firearms. Only the licensed company does this, never PWVSB (V14). */
  | 'arms.handle'
  /** See every company's workforce papers (PWVSB HR monitors; the company is the employer). */
  | 'hr.monitor'
  /** See the regional operations board across companies (Regional Operations Managers, Director Office). */
  | 'ops.region'
  /** Set a site's patrol time to follow the client's request (Regional Operations Manager, Fauzan 25 Oct 2026). */
  | 'site.patrol'
  /** See insurance policies, premiums, claims and guarantees (Chief of Staff insurance section, Fauzan 25 Oct 2026). */
  | 'insurance.view'
  /** Work the CMS phone desk for a company: see its extensions and calls, log call-backs (CMS staff, Arms Control). */
  | 'cms.desk'
  /** Act on an attendance alert: tell the guard, excuse with a reason (the company's PIC, Shahirah 25 Oct 2026). */
  | 'attendance.followup'
  /** Record a disciplinary step. The company decides; the app never issues it automatically. */
  | 'attendance.discipline'
  /** Record a site visit with GPS check-in and photos (supervisors, managers; PWVSB operations with a grant). */
  | 'site.visit'
  /**
   * Open a guard's profile: papers, training, hours, leave, warnings (Fauzan, 25 Oct 2026: the guard's company and
   * the HR administrator; operations too, to manage the roster). Not CMS, Arms Control or other departments.
   */
  | 'hr.profile'
  /** See a guard's pay and medical benefits: the guard's company and HR only, not operations. */
  | 'hr.pay'
  /** Ask for leave or give the reason for an absence (site device for the guard, or company staff for them). */
  | 'leave.request'
  /**
   * Approve or reject leave and absence reasons: the Operations Manager or higher only (Fauzan, 25 Oct 2026), under
   * the company's management agreement. Unanswered requests move up a level every 12 hours (rule LEAVE-ESCALATE).
   */
  | 'leave.decide';

const COMPANY_ROLE_ACTIONS: Record<User['role'], Action[]> = {
  director: [],
  pwvsb_officer: [],
  company_manager: [
    'view',
    'roster.edit',
    'roster.publish',
    'attendance.lock',
    'case.raise',
    'case.update',
    'case.close',
    'commercial.view',
    'commercial.prepare',
    'commercial.approve',
    'arms.view',
    'arms.handle',
    'site.patrol',
    'insurance.view',
    'attendance.followup',
    'attendance.discipline',
    'site.visit',
    'hr.profile',
    'hr.pay',
    'leave.request',
  ],
  admin_exec: [
    'view',
    'roster.edit',
    'case.raise',
    'case.update',
    'commercial.view',
    'commercial.prepare',
    'insurance.view',
    'attendance.followup',
    'hr.profile',
    'hr.pay',
    'leave.request',
  ],
  supervisor: [
    'view',
    'roster.edit',
    'roster.publish',
    'attendance.lock',
    'case.raise',
    'case.update',
    'arms.view',
    'arms.handle',
    'attendance.followup',
    'attendance.discipline',
    'site.visit',
    'hr.profile',
    'leave.request',
  ],
  site_device: ['view', 'attendance.clock', 'case.raise', 'patrol.scan', 'leave.request'],
  // A guard sees only their own record, through PrimaService.myDuty; no company action at all.
  guard: [],
};

/** Actions an 'act' grant allows a group-level user. Closing cases stays with the company. */
const GRANT_ACT_ACTIONS: Action[] = ['view', 'roster.edit', 'roster.publish', 'attendance.lock', 'case.raise', 'case.update'];

export function activeGrants(user: User, grants: AuthorityGrant[], today: IsoDate): AuthorityGrant[] {
  return grants.filter((g) => g.userId === user.id && g.validFrom <= today && today <= g.validTo);
}

/**
 * Who may see group data (Fauzan, 26 Oct 2026: "Group data only been view by ceo coo finance director cos deputy cos
 * chairman and vice chairman. Others can view only thier on respective line of work or things they part of only").
 * The Director Office sign-in counts while it stands in for every pilot role.
 */
export function isGroupLeader(user: User): boolean {
  if (user.role === 'director') return true;
  return user.role === 'pwvsb_officer' && (user.opsTier === 'ceo' || user.opsTier === 'coo' || !!user.leadership || isActHead(user));
}

/** The head of ACT (Audit, Compliance and Transformation) sees everything, to audit it (Fauzan, 28 Oct 2026). */
export function isActHead(user: User): boolean {
  return user.role === 'pwvsb_officer' && user.department === 'audit' && user.actRole === 'lead';
}

/**
 * The HR Director is the Chief of Staff and the Deputy Chief of Staff (Fauzan, 27 Oct 2026). PWVSB HR is the HR
 * Admin: it prepares; the HR Director checks staff leave and verifies every pay change.
 */
export function isHrDirector(user: User): boolean {
  return user.role === 'pwvsb_officer' && (user.leadership === 'cos' || user.leadership === 'deputy_cos');
}

/**
 * Who sees a company's total overview (Fauzan, 26 Oct 2026): the Finance Director, COO, CEO, Chief of Staff, Deputy
 * Chief of Staff, Chairman and Vice Chairman, and the company's own manager and admin executives. Operations officers
 * and supervisors work from their own screens instead.
 */
export function seesCompanyOverview(user: User): boolean {
  return isGroupLeader(user) || user.role === 'company_manager' || user.role === 'admin_exec';
}

/**
 * Who sees arms detail across companies (Fauzan, 26 Oct 2026: "Arms control detail only sees by cms, arm control and
 * company manager and coo or higher"): CMS, Arms Control, the COO, the CEO, the Chairman and Vice Chairman. The Finance
 * Director and the Chiefs of Staff do not. A company manager sees their own company; a supervisor only their own people.
 */
export function seesArmsDetail(user: User): boolean {
  if (user.role === 'director') return true;
  if (user.role !== 'pwvsb_officer') return false;
  return (
    user.department === 'arms_control' ||
    user.department === 'cms' ||
    user.opsTier === 'coo' ||
    user.opsTier === 'ceo' ||
    user.leadership === 'chairman' ||
    user.leadership === 'vice_chairman' ||
    isActHead(user)
  );
}

/** PWVSB's own staff records (central staff are employed by PWVSB, not by a security company). */
export const GROUP_EMPLOYER_ID = 'pwvsb';
/**
 * Merdeka Network Sdn Bhd (Fauzan, 28 Oct 2026): the IT department's company. It employs and pays the IT team, pays every
 * IT cost, owns every device and rents the devices to the group companies. Not a licensed security company.
 */
export const IT_COMPANY_ID = 'merdeka';
export const IT_COMPANY_NAME = 'Merdeka Network Sdn Bhd';
/** PWVSB and Merdeka Network employ central staff; neither is a licensed security company. */
export function isCentralEmployer(id: Id | null | undefined): boolean {
  return id === GROUP_EMPLOYER_ID || id === IT_COMPANY_ID;
}
export function centralStaffName(id: Id): string {
  return id === IT_COMPANY_ID ? `${IT_COMPANY_NAME} (IT team)` : 'PWVSB (central staff)';
}
/** The name of an employer that is not a security company: PWVSB or Merdeka Network. */
export function centralEmployerName(id: Id): string | null {
  return id === GROUP_EMPLOYER_ID ? 'PWVSB' : id === IT_COMPANY_ID ? IT_COMPANY_NAME : null;
}
/** The one branch of PWVSB's own central staff (head office). */
export const PWVSB_HQ_BRANCH = 'br-pwvsb-hq';

/**
 * Every staff member has their own record and clock, except the CEO, the Chairman and the Vice Chairman
 * (Fauzan, 26 Oct 2026: "Ceo chairman and vice chairman no need").
 */
export function hasOwnStaffRecord(user: User): boolean {
  if (user.role === 'site_device') return false;
  return !(user.opsTier === 'ceo' || user.leadership === 'chairman' || user.leadership === 'vice_chairman');
}

export function isGroupRole(user: User): boolean {
  return user.role === 'director' || user.role === 'pwvsb_officer';
}

/** Company ids this user can see today. A guard's own sign-in sees no company screen, only their own record. */
export function visibleCompanyIds(user: User, grants: AuthorityGrant[], today: IsoDate): Id[] {
  if (isGroupRole(user)) return [...new Set(activeGrants(user, grants, today).map((g) => g.companyId))];
  if (user.role === 'guard') return [];
  return user.companyIds;
}

/**
 * Companies whose rows the database lets this sign-in read (row-level security). For a guard that is their employer,
 * so their own record can be read; the service still shows them nothing but that record.
 */
export function tenantCompanyIds(user: User, grants: AuthorityGrant[], today: IsoDate): Id[] {
  if (user.role === 'guard') return user.companyIds;
  // Central staff can read PWVSB's own staff rows at the database; the service still shows each person only their own.
  return isGroupRole(user) ? [...visibleCompanyIds(user, grants, today), GROUP_EMPLOYER_ID, IT_COMPANY_ID] : visibleCompanyIds(user, grants, today);
}

export function can(user: User, grants: AuthorityGrant[], today: IsoDate, action: Action, companyId: Id, siteId?: Id | null): boolean {
  if (isGroupRole(user)) {
    // PWVSB is itself the employer of the central staff: its HR and group leadership need no grant to see them.
    const ownStaff = (companyId === GROUP_EMPLOYER_ID || companyId === IT_COMPANY_ID) && (isGroupLeader(user) || user.department === 'hr');
    const gs: AuthorityGrant[] = ownStaff
      ? [{ id: 'own-staff', userId: user.id, companyId, scope: 'monitor', basis: 'PWVSB is the employer', validFrom: today, validTo: today }]
      : activeGrants(user, grants, today).filter((g) => g.companyId === companyId);
    if (action === 'cms.desk') return gs.length > 0 && (user.role === 'director' || user.department === 'cms' || user.department === 'arms_control');
    if (action === 'arms.view') return gs.length > 0 && seesArmsDetail(user);
    // CMS staff see only the CMS desk and arms, never a company's own screens.
    if (user.department === 'cms') return false;
    const lead = isGroupLeader(user);
    if (action === 'view') return gs.length > 0;
    // Tenders and quotations: group leadership and the Director Office administrator's line of work.
    if (action === 'commercial.view') return gs.length > 0 && (lead || user.department === 'director_office');
    // Group users see HR only if their department needs to know (group leadership always).
    if (action === 'site.visit') return gs.length > 0 && (user.role === 'director' || user.department === 'operations');
    if (action === 'site.patrol') return gs.length > 0 && (user.role === 'director' || user.department === 'operations');
    if (action === 'ops.region') return gs.length > 0 && (lead || user.department === 'operations');
    if (action === 'insurance.view') return gs.length > 0 && (lead || user.department === 'chief_of_staff');
    if (action === 'hr.monitor') return gs.length > 0 && (lead || user.department === 'hr');
    // FWM opens foreign workers' records and payslips; the despatch does not (Fauzan, 26 Oct 2026). canSeePerson
    // narrows HR and FWM to their own workers.
    const fwm = user.department === 'fwm' && user.fwmRole !== 'despatch';
    if (action === 'hr.profile') return gs.length > 0 && (lead || user.department === 'hr' || user.department === 'operations' || fwm);
    if (action === 'hr.pay') return gs.length > 0 && (lead || user.department === 'hr' || fwm);
    // Leave from guards and officers is decided by the OM or higher; other staff by the HR administrator or higher
    // (Fauzan, 25 Oct 2026). The service checks which applies to each person.
    if (action === 'leave.decide')
      return (
        gs.length > 0 &&
        (user.role === 'director' ||
          user.department === 'hr' ||
          isHrDirector(user) ||
          (user.department === 'operations' && !!user.opsTier && user.opsTier !== 'patrol'))
      );
    if (action === 'leave.request') return false;
    return gs.some((g) => g.scope === 'act') && GRANT_ACT_ACTIONS.includes(action);
  }
  if (!user.companyIds.includes(companyId)) return false;
  // A shared site device only ever works on its own site, never company-wide lists.
  if (user.role === 'site_device' && !siteId) return false;
  if ((user.role === 'supervisor' || user.role === 'site_device') && siteId && !user.siteIds.includes(siteId)) {
    return false;
  }
  // A patrolling officer working for several companies sees the other companies only at the sites on the patrol.
  if (user.homeCompanyId && companyId !== user.homeCompanyId && !siteId) return false;
  return COMPANY_ROLE_ACTIONS[user.role].includes(action);
}

/**
 * A person's record and payslip (Fauzan, 26 Oct 2026): FWM sees every foreign worker, central HR every local worker
 * and staff member, and the company manager everyone in their own company. Others follow `can`.
 */
export function canSeePerson(
  user: User,
  grants: AuthorityGrant[],
  today: IsoDate,
  action: 'hr.profile' | 'hr.pay',
  person: Pick<Person, 'companyId' | 'nationality'>,
): boolean {
  if (user.role === 'pwvsb_officer' && user.department === 'fwm' && person.nationality === 'MY') return false;
  if (user.role === 'pwvsb_officer' && user.department === 'hr' && person.nationality !== 'MY') return false;
  return can(user, grants, today, action, person.companyId);
}

export class AccessDenied extends Error {
  constructor(action: Action, companyId: Id) {
    super(`Not allowed: ${action} for company ${companyId}. Ask the company or check your authority grant.`);
    this.name = 'AccessDenied';
  }
}

export function assertCan(user: User, grants: AuthorityGrant[], today: IsoDate, action: Action, companyId: Id, siteId?: Id | null): void {
  if (!can(user, grants, today, action, companyId, siteId)) throw new AccessDenied(action, companyId);
}

/**
 * Pilot phase (Fauzan, 28 Oct 2026, rule PILOT-IT): only the IT department, the COO and the CEO are on the system.
 * Everyone else is not part of it yet.
 */
export function inPilot(user: User): boolean {
  if (user.integration) return false;
  // Who starts with the IT pilot (Fauzan, 28 Oct 2026): the IT team, the COO, the CEO, the ACT head, the HR
  // administrator and the Finance Director, so each learns how it works and runs it.
  if (user.department === 'it' || user.opsTier === 'coo' || user.opsTier === 'ceo') return true;
  if (user.department === 'audit') return user.actRole === 'lead';
  if (user.department === 'hr') return true;
  return user.leadership === 'finance_director';
}

// ---------- Department walls (pre-publication review R2, Fauzan 31 Oct 2026) ----------
// Group-wide department tables have no company column, so the company wall cannot keep them apart. Each request also
// carries the department walls the person passes (app.walls); the database lets a row through only on a wall the
// person holds, so a bug in a screen cannot show another department's records. The service asks the same functions,
// so the two never disagree.

/** Asset Management: its team works the records; group leadership and Finance oversee them. */
export function assetRole(user: User): 'team' | 'oversee' | null {
  if (user.role === 'pwvsb_officer' && user.department === 'asset') return 'team';
  if (isGroupLeader(user) || (user.role === 'pwvsb_officer' && user.department === 'finance')) return 'oversee';
  return null;
}

/** ACT (Audit, Compliance and Transformation) and group leadership; owners of a finding see only their own. */
export function actRole(user: User): 'act' | 'leader' | null {
  if (user.integration) return null;
  if (user.department === 'audit') return 'act';
  if (isGroupLeader(user)) return 'leader';
  return null;
}

/** PDPA: the PDPA officer runs it; group leadership and the Operations Director monitor it. */
export function pdpaRole(user: User): 'officer' | 'monitor' | null {
  if (user.role === 'pwvsb_officer' && user.department === 'pdpa') return 'officer';
  if (isGroupLeader(user) || (user.role === 'pwvsb_officer' && user.opsTier === 'ops_director')) return 'monitor';
  return null;
}

/** Continuity (backups and drills): run by IT, watched by group leadership. */
export function bcmRole(user: User): 'it' | 'view' | null {
  if (user.integration) return null;
  if (user.department === 'it') return 'it';
  if (isGroupLeader(user)) return 'view';
  return null;
}

/**
 * Who may close a leaver's access: PWVSB HR (who records leaving), the HR Director (Chief of Staff and Deputy) and the
 * CEO. IT then disables the Microsoft account in Entra; Prima refuses the person from the closing day either way.
 */
export function canCloseAccess(user: User): boolean {
  if (user.integration) return false;
  return (user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user) || user.opsTier === 'ceo';
}

export type DataWall =
  /** Asset Management records: read. ACT reads them too, to audit (actSignals); it never writes them. */
  | 'asset_read'
  /** Asset Management records: write. */
  | 'asset_write'
  | 'act'
  | 'pdpa'
  | 'bcm'
  /** May close a leaver's access (prima.close_access in the database). */
  | 'offboard';

/** The department walls this person passes, sent to the database with every request. */
export function dataWalls(user: User): DataWall[] {
  const out: DataWall[] = [];
  if (assetRole(user) || actRole(user)) out.push('asset_read');
  // ACT audits Asset Management; it never changes its records, ACT head included.
  if (assetRole(user) && user.department !== 'audit') out.push('asset_write');
  if (actRole(user)) out.push('act');
  if (pdpaRole(user)) out.push('pdpa');
  if (bcmRole(user)) out.push('bcm');
  if (canCloseAccess(user)) out.push('offboard');
  return out;
}

/** Whether this account's access has been closed by today (offboarding). A closed account opens nothing. */
export function accessClosed(user: Pick<User, 'accessClosedFrom'>, today: IsoDate): boolean {
  return !!user.accessClosedFrom && user.accessClosedFrom <= today;
}

/** A closed account is refused like any other denial (403), with its own message. */
export class AccessClosed extends AccessDenied {
  constructor(public readonly from: IsoDate) {
    super('view', '(closed account)');
    this.message = `This Prima account was closed from ${from}. If you still work here, ask HR.`;
    this.name = 'AccessClosed';
  }
}
