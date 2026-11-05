import { hasOwnStaffRecord, isGroupLeader, isHrDirector } from './access';
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
  if (user.leadership === 'finance_director' || (user.department === 'finance' && user.financeTeam != null)) return 'finance';
  if (isGroupLeader(user) || user.role === 'company_manager') return 'view';
  return null;
}

/** Who takes a step in the monthly staff payroll: HR, the HR Director, the COO, Finance's paying team, or the CEO standing in. */
export function staffPayStepper(user: User): boolean {
  const r = staffPayRole(user);
  return r === 'hr' || r === 'cos' || r === 'coo' || r === 'finance' || (!user.integration && RULES.pilot.value.on && user.opsTier === 'ceo');
}
