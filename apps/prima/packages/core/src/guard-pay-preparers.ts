// P100 B1 (Fauzan, 11 Nov 2026): "each Company Manager monitors the pay run and delegates the preparing to whoever they
// choose in their company". Each security company prepares its own guard pay run. The Company Manager names the
// preparer(s) for their company, with a reason, and can change the choice later (each change kept). HR (PWVSB HR officers)
// and the OMs no longer prepare. The COO approves (the CEO stands in during the pilot), nobody approves a month they
// prepared or submitted, and the run stays TRIAL ONLY while the JA Group app pays guards (rule PAY-GUARD).
//
// The list is kept in its own table (prima.guard_pay_preparers, db/modules/guard-pay-preparers-v1.sql, an office module
// applied by prima-setup). Only the Company Manager of that company writes it (row-level security says so too).
import type { Id, IsoDateTime, User } from './types';

export interface GuardPayPreparerStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** Why the Company Manager named or removed this person (always given). */
  reason: string;
}

/** One person a Company Manager named to prepare their company's guard pay run. */
export interface GuardPayPreparer {
  /** `gpp-<companyId>-<userId>`: one record per person per company; naming them again reuses it. */
  id: Id;
  companyId: Id;
  userId: Id;
  userName: string;
  /** The person's title when named, for the list. */
  title: string;
  active: boolean;
  named: GuardPayPreparerStep;
  removed: GuardPayPreparerStep | null;
  /** Every earlier naming and removal, newest first. */
  history: { what: 'named' | 'removed'; step: GuardPayPreparerStep }[];
}

export const guardPayPreparerId = (companyId: Id, userId: Id) => `gpp-${companyId}-${userId}`;

/**
 * Who a Company Manager may name: a staff sign-in of their own company that works in the company office (an admin
 * executive, or another manager such as a General Manager). Never a guard, a site officer, a site device, an Operations
 * Manager (Fauzan: "The OM does NOT prepare it"), central HR, a feed, or a closed account.
 */
export function canBeGuardPayPreparer(u: User, companyId: Id, today: string): boolean {
  if (u.integration) return false;
  if (u.accessClosedFrom && u.accessClosedFrom <= today) return false;
  if (u.role !== 'admin_exec' && u.role !== 'company_manager') return false;
  return u.companyIds.includes(companyId);
}

/** Whether this user names the preparers for the company: its Company Manager (or General Manager). */
export function namesGuardPayPreparers(u: User, companyId: Id): boolean {
  return !u.integration && u.role === 'company_manager' && u.companyIds.includes(companyId);
}
