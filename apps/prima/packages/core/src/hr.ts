import { hasOwnStaffRecord, isFinanceStaff, isGroupLeader, isHrDirector } from './access';
import { RULES } from './rules';
import { registerRollout } from './rollouts';
import type { User } from './types';

/**
 * HR Phase 3, slice 3A (Fauzan, 1 Nov 2026).
 *
 * - The HR department governs HR in every company with full authority; each company only monitors its own staff's HR.
 * - The Chief of Staff is the HR Director; the Deputy Chief of Staff stands in for them.
 * - The HR Administrator keeps the records, deals with staff, does what the Chief of Staff assigns, and decides staff
 *   leave with the Vice Chairman's consent.
 * - Monthly staff payroll: the Chief of Staff approves, then the COO approves. The Vice Chairman consents to each salary
 *   amount when it is set each year or on review (a basic pay change), not to the monthly run.
 * - Every approval carries a comment (Fauzan, 31 Oct 2026: "every approval need reason to approve it").
 */

/**
 * Who joins Prima for the HR rollout: the HR approvers who are not in the IT pilot yet (the Chief of Staff, the Deputy
 * and the Vice Chairman). The API lets them sign in only when the CEO starts the HR rollout (PRIMA_ROLLOUTS=hr, or the
 * older HR_ROLLOUT=true); it is off by default, so the IT pilot is unchanged until then. Office staff of other departments join later, department by
 * department.
 */
export function inHrRollout(user: User): boolean {
  if (user.integration || user.role !== 'pwvsb_officer') return false;
  return user.leadership === 'cos' || user.leadership === 'deputy_cos' || user.leadership === 'vice_chairman';
}

// The shared department switch (packages/core/src/rollouts.ts): HR adds its people here, not in auth.ts.
registerRollout('hr', 'HR', inHrRollout);

/** PWVSB HR, the HR Administrator: keeps the records and decides staff leave (with the Vice Chairman's consent). */
export function isHrAdmin(user: User): boolean {
  return user.role === 'pwvsb_officer' && user.department === 'hr';
}

// ---------- Who may start each HR task. The service and the guide cards both call these, so they cannot drift. ----------

/** HR keeps the records: the HR Administrator and the HR Director (the Chief of Staff or Deputy). */
export function hrKeeps(user: User): boolean {
  return !user.integration && (isHrAdmin(user) || isHrDirector(user));
}

/** Office staff with their own staff record clock in on their own phone; guards and site devices do not. */
export function staffClockUser(user: User): boolean {
  return !user.integration && user.role !== 'guard' && user.role !== 'site_device' && hasOwnStaffRecord(user);
}

/** The Vice Chairman consents; the CEO stands in while the pilot rule is on (Fauzan, 28 Oct 2026). */
export function vcConsents(user: User): boolean {
  return (user.role === 'pwvsb_officer' && user.leadership === 'vice_chairman') || (RULES.pilot.value.on && user.opsTier === 'ceo');
}

/** Who may record a guard's papers in principle (the server then checks the company and area). */
export function guardPaperKeeper(user: User): boolean {
  if (user.integration) return false;
  if (hrKeeps(user) || user.role === 'company_manager') return true;
  return user.role === 'pwvsb_officer' && user.department === 'operations' && ['om', 'regional', 'ops_director', 'ogm', 'coo'].includes(user.opsTier ?? '');
}

/** What a user does in staff payroll. 'view' is group leadership and a company manager for their own company. */
export function staffPayRole(user: User): 'hr' | 'cos' | 'coo' | 'finance' | 'view' | null {
  if (user.integration || user.role === 'guard' || user.role === 'site_device') return null;
  if (user.role === 'pwvsb_officer' && user.department === 'hr') return 'hr';
  if (isHrDirector(user)) return 'cos';
  if (user.role === 'pwvsb_officer' && user.opsTier === 'coo') return 'coo';
  if (user.leadership === 'finance_director' || isFinanceStaff(user)) return 'finance';
  if (isGroupLeader(user) || user.role === 'company_manager') return 'view';
  return null;
}

/** Who takes a step in the monthly staff payroll: HR, the HR Director, the COO, Finance's paying team, or the CEO standing in. */
export function staffPayStepper(user: User): boolean {
  const r = staffPayRole(user);
  return r === 'hr' || r === 'cos' || r === 'coo' || r === 'finance' || (!user.integration && RULES.pilot.value.on && user.opsTier === 'ceo');
}

// ---------- HR gaps of 23 Nov 2026 (Fauzan: "Do the gap") ----------

/**
 * B1: who records the Vice Chairman's answer when he gives it outside Prima (by message, call, meeting or letter): the
 * Chief of Staff, the Deputy or the HR Administrator (Fauzan, 23 Nov 2026: "Cos or dcos or hr upload the consent given
 * from what app or call"). The server also refuses the person whose leave or pay it is, and whoever took the step just
 * before, so two people always stand behind each consent.
 */
export function vcRecorder(user: User): boolean {
  return hrKeeps(user);
}

/**
 * D1 (Fauzan, 23 Nov 2026: "Yes and hr adminstrator. Cos can delegate what needed"): the items only the Chief of Staff
 * did. The Deputy stands in for all of them while the Chief of Staff is on approved leave; the Chief of Staff may also
 * hand any of them to the Deputy or the HR Administrator, for good or until a date.
 */
export const COS_COVER_ITEMS = {
  staff_memo: 'Memos to all staff',
  office_requests: 'Office requests (consumables, utilities, rent)',
  staff_loans: 'Advance and loan scheme',
  pdpa_switch: 'PDPA switch on or off',
  office_run_by: 'Which office runs a company',
} as const;
export type CosCoverItem = keyof typeof COS_COVER_ITEMS;
export const COS_COVER_KEYS = Object.keys(COS_COVER_ITEMS) as CosCoverItem[];
export type CosCoverTo = 'dcos' | 'hr_admin';

/** One change the Chief of Staff makes; the latest row per item is in force. Rows are never changed or removed. */
export interface CosCoverRow {
  id: string;
  item: CosCoverItem;
  /** Who may act for the Chief of Staff on this item; empty takes the delegation back. */
  to: CosCoverTo[];
  /** Last day of the delegation; null holds until the Chief of Staff changes it. */
  until: string | null;
  reason: string;
  by: string;
  byId: string;
  at: string;
}

export function isChiefOfStaff(user: User): boolean {
  return !user.integration && user.role === 'pwvsb_officer' && user.leadership === 'cos';
}

/** The kind of stand-in a user can be: the Deputy or the HR Administrator. */
export function coverKindOf(user: User): CosCoverTo | null {
  if (user.integration || user.role !== 'pwvsb_officer') return null;
  if (user.leadership === 'deputy_cos') return 'dcos';
  if (user.department === 'hr' && !user.leadership) return 'hr_admin';
  return null;
}

/** The delegation in force for an item on a day: the latest row, while its last day has not passed. */
export function cosCoverInForce(rows: CosCoverRow[], item: CosCoverItem, today: string): CosCoverRow | null {
  const last = rows.filter((r) => r.item === item).sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
  if (!last || !last.to.length || (last.until && last.until < today)) return null;
  return last;
}

/**
 * Whether a user acts for the Chief of Staff on an item today, and why. The Chief of Staff always acts; the Deputy while
 * the Chief of Staff is on approved leave; the Deputy or the HR Administrator when the Chief of Staff delegated it.
 */
export function cosActs(
  user: User,
  item: CosCoverItem,
  rows: CosCoverRow[],
  cosOnLeave: boolean,
  today: string,
): { acts: boolean; as: 'cos' | 'leave_cover' | 'delegated' | null } {
  if (isChiefOfStaff(user)) return { acts: true, as: 'cos' };
  const kind = coverKindOf(user);
  if (!kind) return { acts: false, as: null };
  if (kind === 'dcos' && cosOnLeave) return { acts: true, as: 'leave_cover' };
  const row = cosCoverInForce(rows, item, today);
  if (row && row.to.includes(kind)) return { acts: true, as: 'delegated' };
  return { acts: false, as: null };
}
