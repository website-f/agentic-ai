import { registerRollout } from "./rollouts";
import type { User } from "./types";


/**
 * Central Admin, Phase 5, slice 5A (Fauzan, 1 Nov 2026).
 *
 * - Head office Corporate Admin records each company's SSM filings; the company secretary also monitors them; each
 *   company only views its own and supplies the papers.
 * - The Deputy Chief of Staff owns Corporate Admin; the Chief of Staff also has authority to monitor it (and keeps the
 *   PWVSB approval of corporate changes decided on 24 Oct 2026).
 * - The Heads of Company are the company managers.
 * - Every approval carries a reason, at least a short comment (Fauzan, 31 Oct 2026).
 */

/** The Deputy Chief of Staff: owns Corporate Admin, records filings and board resolutions, raises and approves changes. */
export function isCorpAdminOwner(user: User): boolean {
  return !user.integration && user.role === 'pwvsb_officer' && user.leadership === 'deputy_cos';
}

/** The company secretary (Permata Management): monitors the filings of the companies it serves, view only. */
export function isCompanySecretary(user: User): boolean {
  return !user.integration && user.role === 'pwvsb_officer' && user.corpSecretary === true;
}

/**
 * Who joins Prima for the Central Admin rollout: the Chief of Staff, the Deputy, the Director Office Administrator and
 * the company secretary. The API admits them only when CENTRAL_ADMIN_ROLLOUT=true is set; it is off by default, so the
 * IT pilot is unchanged until the CEO starts the Central Admin rollout. The Heads of Company (company managers) join
 * with their companies, starting with Sasa, Arrow Shield and Inas.
 */
export function inCentralAdminRollout(user: User): boolean {
  if (user.integration || user.role !== 'pwvsb_officer') return false;
  return user.leadership === 'cos' || user.leadership === 'deputy_cos' || user.department === 'director_office' || user.corpSecretary === true;
}

/** The reason an approver gives: required, trimmed and capped. Returns null when it is missing. */
export function approvalReason(note: unknown, max = 300): string | null {
  const text = String(note ?? '')
    .trim()
    .slice(0, max);
  return text ? text : null;
}

// Shared rollout switch (connect-departments work, 2 Nov 2026): PRIMA_ROLLOUTS=central_admin, or the legacy
// CENTRAL_ADMIN_ROLLOUT=true, admits the Central Admin team while the IT pilot is on.
registerRollout('central_admin', 'Central Admin', inCentralAdminRollout);