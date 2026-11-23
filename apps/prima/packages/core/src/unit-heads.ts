import { CENTRAL_EMPLOYER_IDS, GOV_OPS_COMPANY_ID, PRIVATE_OPS_COMPANY_ID } from './access';
import type { User } from './types';

/**
 * Heads of central departments and central companies (Fauzan, 23 Nov 2026: "Yes di" to marking the heads Prima did not
 * know yet). One marker shared by every module: a unit key is 'd_<department>' for a central department and
 * 'c_<companyId>' for one of the five central companies that are not security companies (PWVSB, Merdeka Network,
 * Goodwill Empire, Sasa Team, Perfect Global Logistics). The 38 security companies are headed by their Company Manager
 * and are not unit keys.
 *
 * Two sources, from server identity only:
 * - the job a sign-in already carries (FWM Manager and Deputy, the Asset Director, the OGM, the Inventory Manager, the
 *   Operations Director);
 * - `User.headOf`, set where the CEO or the Chief of Staff names a head in the app (the organisation chart). It is never
 *   taken from the browser.
 */
export const UNIT_DEPARTMENTS = [
  'finance', 'hr', 'fwm', 'it', 'procurement', 'transport', 'arms_control', 'asset', 'audit', 'operations', 'cms',
  'chief_of_staff', 'director_office', 'pdpa', 'legal', 'marketing',
] as const;
export const UNIT_HEAD_KEYS: readonly string[] = [...UNIT_DEPARTMENTS.map((d) => `d_${d}`), ...CENTRAL_EMPLOYER_IDS.map((c) => `c_${c}`)];

/** The units this person heads. A system feed, a non-central sign-in or a closed account heads nothing. */
export function unitHeadsOf(user: User): string[] {
  if (user.integration || user.role !== 'pwvsb_officer' || user.accessClosedFrom) return [];
  const out: string[] = [];
  if (user.department === 'fwm' && (user.fwmRole === 'manager' || user.fwmRole === 'deputy')) out.push('d_fwm');
  if (user.department === 'asset' && user.assetRole === 'director') out.push('d_asset');
  if (user.opsTier === 'ogm') out.push('d_operations', 'd_procurement', `c_${GOV_OPS_COMPANY_ID}`);
  if (user.department === 'procurement' && user.procRole === 'manager') out.push('d_procurement');
  // The Marketing Manager and Deputy head Marketing (Fauzan, 22-23 Nov 2026): they see its department logins.
  if (user.department === 'marketing' && (user.marketingRole === 'manager' || user.marketingRole === 'deputy')) out.push('d_marketing');
  if (user.opsTier === 'ops_director') out.push('d_operations', `c_${PRIVATE_OPS_COMPANY_ID}`);
  for (const k of Array.isArray(user.headOf) ? user.headOf : []) if (UNIT_HEAD_KEYS.includes(k)) out.push(k);
  return [...new Set(out)];
}
