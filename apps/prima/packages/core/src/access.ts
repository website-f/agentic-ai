import type { AuthorityGrant } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { Person } from "./types";
import type { User } from "./types";
import { isCompanySecretary } from "./central-admin";
import { registeredWallsOf } from "./walls";












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
  | 'leave.decide'
  /** Share the company office's work out to desks: the company's own Company Manager or GM only (Fauzan, 2 Nov 2026). */
  | 'office.desks';

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
/** Maker steps the owner (isOwnerAdmin) takes for any company it sees (P78). */
const OWNER_MAKER_ACTIONS: Action[] = ['roster.edit', 'roster.publish', 'case.raise', 'case.update'];

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

/**
 * P83: a foreign worker is someone whose RECORDED nationality is not Malaysian. A nationality not recorded yet (staff
 * loaded from the real staff list, 6 Nov 2026) is not "foreign": it must not move a person from HR to the foreign
 * worker team, nor onto foreign-worker boards. Safety rules (armed posts, government sites) keep treating "not
 * recorded" as "not shown to be Malaysian" and stay strict.
 */
export function isForeign(person: Pick<Person, 'nationality'>): boolean {
  return !!person.nationality && person.nationality !== 'MY';
}

/**
 * P78 (Agentic Office): the owner, signed in as Prima's CEO record, is the master administrator of every module
 * ("the CEO is the owner and master administrator of every system", PILOT-IT). Where a module lets a department
 * enter or start a record (a maker step), the owner may enter it too, for any company. Checks, approvals and
 * payments keep their own people, and nobody ever approves a record they entered themselves (maker-checker).
 * Every entry is in the audit trail under the owner's name.
 */
export function isOwnerAdmin(user: User): boolean {
  return !user.integration && user.opsTier === 'ceo' && (user.role === 'director' || user.role === 'pwvsb_officer');
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
/** PWVSB, Merdeka Network and Goodwill Empire employ central staff; none is a licensed security company. */
export function isCentralEmployer(id: Id | null | undefined): boolean {
  return !!id && CENTRAL_EMPLOYER_IDS.includes(id);
}
export function centralStaffName(id: Id): string {
  return id === IT_COMPANY_ID
    ? `${IT_COMPANY_NAME} (IT team)`
    : id === GOV_OPS_COMPANY_ID
      ? `${GOV_OPS_COMPANY_NAME} (Government Operations)`
      : id === PRIVATE_OPS_COMPANY_ID
        ? `${PRIVATE_OPS_COMPANY_NAME} (Private Operations)`
        : id === LOGISTICS_COMPANY_ID
          ? `${LOGISTICS_COMPANY_NAME} (Transport)`
          : 'PWVSB (central staff)';
}
/** The name of an employer that is not a security company: PWVSB, Merdeka Network or Goodwill Empire. */
export function centralEmployerName(id: Id): string | null {
  return id === GROUP_EMPLOYER_ID
    ? 'PWVSB'
    : id === IT_COMPANY_ID
      ? IT_COMPANY_NAME
      : id === GOV_OPS_COMPANY_ID
        ? GOV_OPS_COMPANY_NAME
        : id === PRIVATE_OPS_COMPANY_ID
          ? PRIVATE_OPS_COMPANY_NAME
          : id === LOGISTICS_COMPANY_ID
            ? LOGISTICS_COMPANY_NAME
            : null;
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
  return isGroupRole(user) ? [...visibleCompanyIds(user, grants, today), ...CENTRAL_EMPLOYER_IDS] : visibleCompanyIds(user, grants, today);
}


export function can(user: User, grants: AuthorityGrant[], today: IsoDate, action: Action, companyId: Id, siteId?: Id | null): boolean {
  if (isGroupRole(user)) {
    // PWVSB is itself the employer of the central staff: its HR and group leadership need no grant to see them.
    const ownStaff = isCentralEmployer(companyId) && (isGroupLeader(user) || user.department === 'hr');
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
    // P78: the owner prepares like the company's admin team (leads, tenders, quotations); approving stays with the
    // company manager ('commercial.approve'), and nobody approves a quotation they prepared.
    if (action === 'commercial.prepare' && isOwnerAdmin(user)) return gs.length > 0;
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
    // P78: the owner works the roster and raises and updates cases for every company it can see, not only those under
    // an 'act' grant. Locking attendance and closing cases stay with the company.
    if (isOwnerAdmin(user) && gs.length > 0 && OWNER_MAKER_ACTIONS.includes(action)) return true;
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
  if (user.role === 'pwvsb_officer' && user.department === 'fwm' && !isForeign(person)) return false;
  if (user.role === 'pwvsb_officer' && user.department === 'hr' && isForeign(person)) return false;
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

/**
 * HR legal points (review, 2 Nov 2026): only the authorized directors, the HR Director (Chief of Staff or Deputy) and
 * the CEO. Never staff, HR officers or company managers; routine screens show no legal notice.
 */
export function seesHrLegal(user: User): boolean {
  return !user.integration && (isHrDirector(user) || user.opsTier === 'ceo');
}

/** HR database wall: full IC or passport numbers. HR, the HR Director (Chief of Staff and Deputy) and the CEO. */
export function seesStaffIds(user: User): boolean {
  if (user.integration) return false;
  return (user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user) || user.opsTier === 'ceo';
}

/** HR database wall: full salary accounts. The same people, plus Finance. */
export function seesStaffAccounts(user: User): boolean {
  if (user.integration) return false;
  return seesStaffIds(user) || user.leadership === 'finance_director' || (user.department === 'finance' && user.financeTeam != null);
}

/**
 * A company manager sees (never changes) the full IC and salary account of their own company's staff (Fauzan, 1 Nov
 * 2026). The database lets them read only rows of the companies in app.company_ids.
 */
export function seesOwnCompanyStaffNumbers(user: User): boolean {
  return !user.integration && user.role === 'company_manager';
}

/** Whether this person may read one staff member's full numbers: the HR wall, or that staff member's company manager. */
export function seesStaffNumbersOf(user: User, companyId: string, which: 'ids' | 'accounts'): boolean {
  if (which === 'ids' ? seesStaffIds(user) : seesStaffAccounts(user)) return true;
  return seesOwnCompanyStaffNumbers(user) && user.companyIds.includes(companyId);
}

/** Existing staff-payroll Finance role, for non-personal statutory configuration only.
 * Keep the same precedence as staffPayRole: this is not ACT authority or access to pay-formula tables. */
export function readsStatutoryForPayroll(user: User): boolean {
  if (user.integration || user.role === 'guard' || user.role === 'site_device') return false;
  if ((user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user) ||
      (user.role === 'pwvsb_officer' && user.opsTier === 'coo')) return false;
  return user.leadership === 'finance_director' || (user.department === 'finance' && user.financeTeam != null);
}

export type DataWall =
  /** Payroll Finance: SELECT only on group statutory contribution settings; no employee data or write authority. */
  | 'statutory_read'
  /** Pay formulas, pay law and statutory settings: read, for HR preparing guard and staff pay (guard pay module). */
  | 'pay_read'
  /** Asset Management records: read. ACT reads them too, to audit (actSignals); it never writes them. */
  | 'asset_read'
  /** Asset Management records: write. */
  | 'asset_write'
  | 'act'
  | 'pdpa'
  | 'bcm'
  /** May close a leaver's access (prima.close_access in the database). */
  | 'offboard'
  /** HR wall: full IC or passport numbers (prima.staff_ids). */
  | 'staff_ids'
  /** HR wall: full salary accounts (prima.staff_accounts). */
  | 'staff_accounts'
  /** Read only: full numbers of the staff of the companies this person manages (company managers). */
  | 'staff_company'
  /** HR and the HR Director: registered faces for clock in (prima.staff_faces). */
  | 'staff_faces'
  /** HR, the HR Director and the CEO: confidential HR cases, such as sexual harassment complaints (prima.hr_cases). */
  | 'hr_cases'
  /** HR, the HR Director and the CEO: people who applied for vacancies (prima.applicants). */
  | 'applicants'
  /** FWM: read the passport numbers of foreign workers (slice 3G). */
  | 'fw_ids'
  /** The JA Group app feed: writes the guard rows of the HR wall it is the source for (slice 3G). */
  | 'guard_feed'
  /** The HR Director and the CEO: HR legal points to verify (prima.hr_legal_checks). */
  | 'hr_legal'
  /** Staff movements with proposed pay and private reasons: HR, the HR Director, the CEO, the Vice Chairman and company heads (row narrowed by company). */
  | 'staff_movements'
  /** Login handovers after a transfer, without pay or reasons: IT, HR, the HR Director and the CEO (prima.login_handovers). */
  | 'login_handover'
  | 'corporate'
  | 'legal'
  | 'mandates'

  | (string & { readonly registeredWall?: true })

  | 'staff_history'
  | 'fw_history'
  | 'history_lookup'
  | 'history_local'
  | 'history_mark'
  | 'reg_desk'
  | 'reg_risk';






/**
 * Staff movements carry the proposed pay and the private reason (Arisha main review, 3 Nov 2026): HR, the HR Director,
 * the CEO, the Vice Chairman and company heads (the receiving or sending company only, by row). Nobody else, IT included.
 */
export function seesStaffMovements(user: User): boolean {
  if (user.integration) return false;
  return (
    (user.role === 'pwvsb_officer' && user.department === 'hr') ||
    isHrDirector(user) ||
    user.opsTier === 'ceo' ||
    (user.role === 'pwvsb_officer' && user.leadership === 'vice_chairman') ||
    user.role === 'company_manager'
  );
}

/** Login handovers after a transfer (no pay, no reasons): IT does the account work; HR, the HR Director and the CEO follow. */
export function seesLoginHandovers(user: User): boolean {
  if (user.integration) return false;
  return user.department === 'it' || (user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user) || user.opsTier === 'ceo';
}

/** Applicants for vacancies (Fauzan, 5 Nov 2026: HR only): HR, the HR Director and the CEO. */
export function seesApplicants(user: User): boolean {
  if (user.integration) return false;
  return (user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user) || user.opsTier === 'ceo';
}

/** The department walls this person passes, sent to the database with every request. */
export function dataWalls(user: User): DataWall[] {
  const out: DataWall[] = [];
  if (assetRole(user) || actRole(user)) out.push('asset_read');
  // ACT audits Asset Management; it never changes its records, ACT head included.
  if (assetRole(user) && user.department !== 'audit') out.push('asset_write');
  if (actRole(user)) out.push('act');
  if (!user.integration && user.role === 'pwvsb_officer' && user.department === 'hr') out.push('pay_read');
  if (readsStatutoryForPayroll(user)) out.push('statutory_read');
  if (pdpaRole(user)) out.push('pdpa');
  if (bcmRole(user)) out.push('bcm');
  if (canCloseAccess(user)) out.push('offboard');
  if (seesStaffIds(user)) out.push('staff_ids');
  if (seesStaffAccounts(user)) out.push('staff_accounts');
  if (seesOwnCompanyStaffNumbers(user)) out.push('staff_company');
  if (!user.integration && ((user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user))) out.push('staff_faces');
  if (!user.integration && ((user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user) || user.opsTier === 'ceo')) out.push('hr_cases');
  if (seesApplicants(user)) out.push('applicants');
  if (!user.integration && user.role === 'pwvsb_officer' && user.department === 'fwm' && user.fwmRole !== 'despatch') out.push('fw_ids');
  if (user.integration === 'ja') out.push('guard_feed');
  if (seesHrLegal(user)) out.push('hr_legal');
  if (seesStaffMovements(user)) out.push('staff_movements');
  if (seesLoginHandovers(user)) out.push('login_handover');
  if (seesCorporate(user)) out.push('corporate');
  if (seesLegal(user)) out.push('legal');
  if (seesMandates(user)) out.push('mandates');
  // Walls a department registered from its own module (walls.ts registerWall); never one already listed.
  for (const w of registeredWallsOf(user)) if (!out.includes(w as DataWall)) out.push(w as DataWall);
  // The Asset Management developer system's feed (Special Ops slice 4G) reads and updates the units it reports.
  if (user.integration === 'am' || user.integration === 'whatsapp') out.push('asset_read', 'asset_write');
  const history = staffHistoryRole(user);
  if (history === 'hr') out.push('staff_history');
  if (history === 'fwm') out.push('fw_history');
  if (history) out.push('history_lookup');
  // HR officers keep Malaysians only, in the database too (history tables and the lookup function).
  if (history === 'hr' && historyPopulation(user) === 'local') out.push('history_local');
  if (history !== 'hr' && canMarkDoNotRehire(user)) out.push('history_mark');
  if (!user.integration && (user.role === 'pwvsb_officer' || user.role === 'director')) {
    const ceo = user.opsTier === 'ceo';
    if (ceo || user.leadership === 'cos' || user.leadership === 'deputy_cos') out.push('reg_desk');
    if (ceo || (user.role === 'pwvsb_officer' && user.department === 'audit')) out.push('reg_risk');
  }
  // The OM and above read the live guard formulas and pay law for the salary calculator (Fauzan, 6 Nov 2026); read only.
  if (!user.integration && salaryCalcTier(user) && !out.includes('pay_read')) out.push('pay_read');
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

/**
 * Central Admin database walls (5A part 2). These records already sit behind the company wall; these walls also keep
 * them from central departments that have a company grant for other work (HR, FWM, arms, CMS, transport and others)
 * and from site staff. The service still decides who may change what.
 */

/** Company secretary records (profiles, filings, changes, audits): the company's managers and admin executives, Corporate
 * Admin and the Chief of Staff, the company secretary, group leaders, PWVSB legal, and ACT (reads them to audit). */
export function seesCorporate(user: User): boolean {
  if (user.integration) return false;
  if (user.role === 'company_manager' || user.role === 'admin_exec') return true;
  if (isGroupLeader(user) || isCompanySecretary(user)) return true;
  return user.department === 'legal' || !!actRole(user);
}

/** Legal matters are need-to-know: the same people, except the company secretary. */
export function seesLegal(user: User): boolean {
  return seesCorporate(user) && !isCompanySecretary(user);
}

/** Mandates (management agreements, board mandates): PWVSB legal, group leaders and the company manager. */
export function seesMandates(user: User): boolean {
  if (user.integration) return false;
  if (user.role === 'company_manager' || isGroupLeader(user)) return true;
  return user.department === 'legal';
}

/** Arms Control (and directors) run the CMS desk and review arms requests. Shared by the service and the guide cards. */
export function canRunCms(user: User): boolean {
  return user.role === 'director' || (user.role === 'pwvsb_officer' && user.department === 'arms_control');
}
/**
 * Goodwill Empire Sdn Bhd (Fauzan, 2 Nov 2026): the Government Operations department's company, a wholly owned PWVSB
 * subsidiary. It employs the OGM's team (HQ and seven regions) and the inventory and store team, and owns the
 * operational equipment it issues to guards and bills to the companies. Not a licensed security company.
 */
export const GOV_OPS_COMPANY_ID = 'goodwill';
export const GOV_OPS_COMPANY_NAME = 'Goodwill Empire Sdn Bhd';
/**
 * Sasa Team Sdn Bhd (Fauzan, 2 Nov 2026): the private-sector operations company, a wholly owned PWVSB subsidiary and a
 * different company from Sasa Security Services. It employs the Operations Director's team (Regional OMs, OMs and admin
 * staff) and runs private-sector operations for the group companies for a management fee. It has no inventory: all
 * equipment comes from the Goodwill store. Not a licensed security company.
 */
export const PRIVATE_OPS_COMPANY_ID = 'sasateam';
export const PRIVATE_OPS_COMPANY_NAME = 'Sasa Team Sdn Bhd';
/** The operations company that runs a site's sector and bills the management fee for it. */
export type OpsCompanyId = typeof GOV_OPS_COMPANY_ID | typeof PRIVATE_OPS_COMPANY_ID;
export function opsCompanyOf(sector: 'government' | 'private' | null | undefined): OpsCompanyId {
  return sector === 'government' ? GOV_OPS_COMPANY_ID : PRIVATE_OPS_COMPANY_ID;
}
/** The central employers that are not licensed security companies. */
export const LOGISTICS_COMPANY_ID = 'pgl';
export const CENTRAL_EMPLOYER_IDS: readonly Id[] = [GROUP_EMPLOYER_ID, IT_COMPANY_ID, GOV_OPS_COMPANY_ID, PRIVATE_OPS_COMPANY_ID, LOGISTICS_COMPANY_ID];

/** The ACT job of a department member (Director, Auditor or Enforcement), from server identity only. */
export function actJobOf(user: User): 'director' | 'auditor' | 'enforcement' | null {
  if (actRole(user) !== 'act') return null;
  if (user.actRole === 'lead') return 'director';
  if (user.actRole === 'auditor') return 'auditor';
  if (user.actRole === 'enforcement') return 'enforcement';
  return null;
}

/** Who can be named the owner of an ACT finding: company managers and central staff outside ACT. */
export function actCanOwnFindings(user: User): boolean {
  return !user.integration && (user.role === 'company_manager' || user.role === 'director' || (user.role === 'pwvsb_officer' && user.department !== 'audit'));
}

/**
 * Group employment history (Fauzan, 4 Nov 2026). Who reads what (Fauzan, 4 Nov 2026: "Only rom or higher can see staff
 * history when they key in the person ic or passport. Fwm management can see also. But they see what they key in. Not
 * everyone."):
 * - hr: HR, the HR Director and the CEO keep the history: the board, every profile, HR's notes (HR officers Malaysians).
 * - fwm: FWM management (manager and deputy): the full history of a foreign worker, only after typing their number.
 * - lookup: the Regional OM, OGM, Operations Director, COO and other group leaders: a summary of the one person whose
 *   number they type (companies, jobs, dates, the rehire mark, CSG/TNG). Never a list, never a profile tab.
 * Company heads, OMs, FWM executives and everyone else: nothing.
 */
export function staffHistoryRole(user: User): 'hr' | 'fwm' | 'lookup' | null {
  if (user.integration || user.role === 'guard' || user.role === 'site_device') return null;
  if ((user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user) || user.opsTier === 'ceo') return 'hr';
  if (user.role === 'pwvsb_officer' && user.department === 'fwm' && (user.fwmRole === 'manager' || user.fwmRole === 'deputy')) return 'fwm';
  if (user.role === 'pwvsb_officer' && user.department === 'operations' && ['regional', 'ops_director', 'ogm', 'coo'].includes(user.opsTier ?? '')) return 'lookup';
  if (isGroupLeader(user)) return 'lookup';
  return null;
}

/**
 * Whose history this person may look up (Fauzan, 26 Oct 2026): HR officers Malaysians, FWM foreign workers, everyone
 * else with history access (the HR Director, the CEO, the Regional OM and above) both.
 */
export function historyPopulation(user: User): 'all' | 'local' | 'foreign' {
  const role = staffHistoryRole(user);
  if (role === 'fwm') return 'foreign';
  if (role === 'hr' && user.role === 'pwvsb_officer' && user.department === 'hr' && !isHrDirector(user) && user.opsTier !== 'ceo') return 'local';
  return 'all';
}

/**
 * Who decides "do not hire again" (Fauzan, 4 Nov 2026): the HR Director (Chief of Staff or Deputy), the COO, the OGM and
 * the Operations Director, and the CEO. Only they may lift it again.
 */
export function canMarkDoNotRehire(user: User): boolean {
  if (user.integration) return false;
  if (user.opsTier === 'ceo') return true;
  return user.role === 'pwvsb_officer' && (isHrDirector(user) || ['coo', 'ogm', 'ops_director'].includes(user.opsTier ?? ''));
}
/**
 * Perfect Global Logistics Sdn Bhd (Fauzan, 5 Nov 2026): rents all transport in the group. It employs the Transport
 * department, which runs it under the OGM; the COO monitors it. Its fees and rents are set by the FD or the CEO. Not a
 * licensed security company.
 */

export const LOGISTICS_COMPANY_NAME = 'Perfect Global Logistics Sdn Bhd';

/** Ops tiers that use the salary calculator: the OM and above (Fauzan, 6 Nov 2026). */
export const SALARY_CALC_TIERS = ['om', 'regional', 'ogm', 'ops_director', 'coo', 'ceo'] as const;
export function salaryCalcTier(user: Pick<User, 'opsTier'>): boolean {
  return !!user.opsTier && (SALARY_CALC_TIERS as readonly string[]).includes(user.opsTier);
}
