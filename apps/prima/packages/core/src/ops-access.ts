/**
 * Who may do what in Government Operations (Goodwill Empire), Private Operations (Sasa Team), the management fees and
 * client care (Fauzan, 2 Nov 2026). PrimaService uses these, and so do the guide cards, so a card is shown only to
 * people the server lets do the task.
 */
import { GOV_OPS_COMPANY_ID, PRIVATE_OPS_COMPANY_ID, accessClosed, isGroupLeader, isOwnerAdmin, type OpsCompanyId } from './access';
import { registerRollout } from './rollouts';
import type { IsoDate, Site, User } from './types';

/** An OM or Regional OM tied to one side works only that side's sites; with no side set, both. */
export function onOpsSide(user: Pick<User, 'opsSector'>, sector: Site['sector'] | null | undefined): boolean {
  return !user.opsSector || user.opsSector === (sector ?? 'private');
}

export function isOgm(user: User): boolean {
  return user.role === 'pwvsb_officer' && user.department === 'operations' && user.opsTier === 'ogm';
}

export function isOpsDirector(user: User): boolean {
  return user.role === 'pwvsb_officer' && user.department === 'operations' && user.opsTier === 'ops_director';
}

function sideOm(u: User, sector: 'government' | 'private', today: IsoDate): boolean {
  return (
    u.role === 'pwvsb_officer' &&
    u.department === 'operations' &&
    (u.opsTier === 'om' || u.opsTier === 'regional') &&
    onOpsSide(u, sector) &&
    !u.integration &&
    !accessClosed(u, today)
  );
}

/** A government-side Operations Manager or Regional OM, who carries Goodwill items to the sites. */
export function isGovOm(u: User, today: IsoDate): boolean {
  return sideOm(u, 'government', today);
}

/** A private-side Operations Manager or Regional OM (Sasa Team). */
export function isPrivateOm(u: User, today: IsoDate): boolean {
  return sideOm(u, 'private', today);
}

export function canGovOpsMonitor(u: User, today: IsoDate): boolean {
  return isGroupLeader(u) || isOgm(u) || isGovOm(u, today);
}

export function canPrivateOpsMonitor(u: User, today: IsoDate): boolean {
  return isGroupLeader(u) || isOpsDirector(u) || isPrivateOm(u, today);
}

/** The Finance Director or the CEO enters management fees from the signed agreements. */
export function canSetManagementFee(u: User): boolean {
  return !u.integration && ((u.role === 'pwvsb_officer' && u.leadership === 'finance_director') || u.opsTier === 'ceo');
}

/** Whose management fee bills a person sees: Finance, the COO and the CEO both; the OGM Goodwill's; the Operations Director Sasa Team's. */
export function managementFeeBillScope(u: User): OpsCompanyId[] {
  if (canSetManagementFee(u) || (u.role === 'pwvsb_officer' && u.opsTier === 'coo' && !u.integration)) return [GOV_OPS_COMPANY_ID, PRIVATE_OPS_COMPANY_ID];
  if (isOgm(u)) return [GOV_OPS_COMPANY_ID];
  if (isOpsDirector(u)) return [PRIVATE_OPS_COMPANY_ID];
  return [];
}

/** Who acts on clients (Operations Managers, the Operations Director, the OGM and officers) and who monitors. */
export function clientRoleOf(user: User): 'act' | 'monitor' | null {
  // P78: the owner opens clients for any company and works their care steps, as Operations does.
  if (isOwnerAdmin(user)) return 'act';
  if (user.role === 'supervisor' || user.opsTier === 'patrol') return 'act';
  if (user.role === 'pwvsb_officer' && user.department === 'operations' && ['om', 'regional', 'ogm', 'ops_director'].includes(user.opsTier ?? '')) return 'act';
  if (isGroupLeader(user) || user.role === 'company_manager' || user.role === 'admin_exec') return 'monitor';
  return null;
}

/** The Goodwill store's storekeepers and Procurement issue items to guards. */
export function canIssueGoodwillItems(u: User): boolean {
  return !u.integration && u.department === 'procurement';
}

/** The named OM records each handover step; the OGM may record the later steps. */
export function canRecordHandover(u: User, today: IsoDate): boolean {
  return isGovOm(u, today) || isOgm(u);
}

/**
 * Government Operations rollout (Fauzan, 2 Nov 2026: Government Ops and its Procurement & Inventory go live first).
 * When the CEO starts it (PRIMA_ROLLOUTS=gov_ops), these sign in during the IT pilot:
 * - the OGM;
 * - government-side Regional OMs and OMs (and OMs not tied to a side, who also work government sites);
 * - the Procurement & Inventory department (executive and storekeepers), who run the Goodwill store.
 * Group leaders, Finance and HR come in through the pilot or their own rollouts. Patrol officers and guards are not
 * admitted: they confirm Goodwill items by signature or signed slip on the OM's screen. Closed accounts and system
 * feeds are refused before this rule is asked.
 */
export function inGovOpsRollout(u: User): boolean {
  if (u.integration || u.role !== 'pwvsb_officer') return false;
  if (u.department === 'procurement') return true;
  if (u.department !== 'operations') return false;
  return u.opsTier === 'ogm' || ((u.opsTier === 'om' || u.opsTier === 'regional') && onOpsSide(u, 'government'));
}
registerRollout('gov_ops', 'Government Operations (Goodwill Empire) and Procurement & Inventory', inGovOpsRollout);

/**
 * Private Operations rollout (Sasa Team): the Operations Director and private-side Regional OMs and OMs (and OMs not
 * tied to a side). Started separately by the CEO with PRIMA_ROLLOUTS=private_ops.
 */
export function inPrivateOpsRollout(u: User): boolean {
  if (u.integration || u.role !== 'pwvsb_officer' || u.department !== 'operations') return false;
  return u.opsTier === 'ops_director' || ((u.opsTier === 'om' || u.opsTier === 'regional') && onOpsSide(u, 'private'));
}
registerRollout('private_ops', 'Private Operations (Sasa Team)', inPrivateOpsRollout);
