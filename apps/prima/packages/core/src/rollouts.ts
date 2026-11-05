// One shared rollout switch for every department (connect-departments work, 2 Nov 2026).
//
// While the IT pilot is on (rule PILOT-IT) only pilot users sign in. Each department adds its people when the CEO
// starts that department's rollout. Before this file, HR (#51), Central Admin (#52) and Special Ops (#53) each wrote
// their own `pilotAdmits()` with its own environment flag, in the same two files, so the three PRs could not merge
// together. Now a department registers one admit rule here from its OWN module file, and the API reads one list of
// started rollouts. Nobody edits auth.ts again to add a department.
//
// The list of started rollouts is configuration owned by the CEO (environment), never a request field or a client
// claim. An unknown key in the list admits nobody. A rollout key with no registered rule admits nobody.

import type { User } from './types';

export type RolloutAdmit = (user: User) => boolean;

const REGISTRY = new Map<string, { label: string; admits: RolloutAdmit }>();

const KEY = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * A department declares who joins when its rollout starts. Call once from the department's own module (at load).
 * Registering the same key twice with a different rule is a programming error and throws, so two PRs cannot quietly
 * override each other.
 */
export function registerRollout(key: string, label: string, admits: RolloutAdmit): void {
  if (!KEY.test(key)) throw new Error(`Rollout key "${key}" must be lower case letters, digits or _`);
  const have = REGISTRY.get(key);
  if (have && have.admits !== admits) throw new Error(`Rollout "${key}" is already registered`);
  REGISTRY.set(key, { label, admits });
}

/** Every registered rollout, for the readiness screen and checks. */
export function registeredRollouts(): { key: string; label: string }[] {
  return [...REGISTRY.entries()].map(([key, r]) => ({ key, label: r.label })).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Older single-department flags, still honoured so a department PR that already documents its own flag keeps working:
 * HR_ROLLOUT=true is the same as PRIMA_ROLLOUTS=hr.
 */
const LEGACY_FLAGS: Record<string, string> = {
  HR_ROLLOUT: 'hr',
  CENTRAL_ADMIN_ROLLOUT: 'central_admin',
  SPECIAL_OPS_ROLLOUT: 'special_ops',
  FINANCE_ROLLOUT: 'finance',
  // No GOV_OPS_ROLLOUT: Government Ops has not said who joins its rollout, so no flag pretends to start it.
};

/** The rollouts the CEO has started: PRIMA_ROLLOUTS="hr,central_admin" plus any legacy flag set to exactly "true". */
export function rolloutsOn(env: Record<string, string | undefined>): Set<string> {
  const on = new Set<string>();
  for (const part of (env.PRIMA_ROLLOUTS ?? '').split(',')) {
    const key = part.trim().toLowerCase();
    if (KEY.test(key)) on.add(key);
  }
  for (const [flag, key] of Object.entries(LEGACY_FLAGS)) if (env[flag] === 'true') on.add(key);
  return on;
}

/** Whether a started rollout admits this person. System feeds and closed accounts are refused elsewhere first. */
export function rolloutAdmits(user: User, on: ReadonlySet<string>): boolean {
  if (user.integration) return false;
  for (const key of on) {
    const r = REGISTRY.get(key);
    if (r && r.admits(user)) return true;
  }
  return false;
}

/** Started rollouts that no department has registered a rule for: they admit nobody, and readiness says so. */
export function unregisteredRollouts(on: ReadonlySet<string>): string[] {
  return [...on].filter((key) => !REGISTRY.has(key)).sort();
}

/** Which started rollouts admit this person (for the sign-in log and the readiness screen). */
export function rolloutsAdmitting(user: User, on: ReadonlySet<string>): string[] {
  if (user.integration) return [];
  return [...on].filter((key) => REGISTRY.get(key)?.admits(user)).sort();
}
