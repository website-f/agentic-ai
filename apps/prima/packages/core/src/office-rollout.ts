import { inFinanceRollout } from "./finance";
import { registerRollout } from "./rollouts";
import type { User } from "./types";

// Part N1 (Fauzan, 13 Nov 2026: "EVERYONE signs in from 18 Nov"): the Finance switch that FINANCE_ROLLOUT=true names,
// and one switch for every office person. Guards and patrolling officers stay in the JA app; site devices sign in on
// their own path. The IT pilot rule stays on, because several stand-ins depend on it.
registerRollout('finance', 'Finance (Finance Director and the 7 Finance teams)', inFinanceRollout);

/**
 * Every office department, the Chairman and Vice Chairman, PWVSB Legal, the PDPA officer, the Chief of Staff office,
 * FWM, Asset Management, the whole ACT team, company heads and admin executives, branch managers and stationed site
 * supervisors. Not guards, patrolling officers, site devices or system feeds.
 */
export function inAllOfficeRollout(user: User): boolean {
  if (user.integration) return false;
  if (user.role === 'guard' || user.role === 'site_device') return false;
  if (user.role === 'supervisor' && user.opsTier === 'patrol') return false;
  return ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'].includes(user.role);
}
registerRollout('all_office', 'Every office person (all departments, the Chairman, branch managers, site supervisors); not guards or patrolling officers', inAllOfficeRollout);
