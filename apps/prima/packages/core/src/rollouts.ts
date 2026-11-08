import type { User } from "./types";




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
  GOV_OPS_ROLLOUT: 'gov_ops',
  FINANCE_ROLLOUT: 'finance',
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

/** Which started rollouts admit this person (for the sign-in log and the readiness screen). */
export function rolloutsAdmitting(user: User, on: ReadonlySet<string>): string[] {
  if (user.integration) return [];
  return [...on].filter((key) => REGISTRY.get(key)?.admits(user)).sort();
}

/** Started rollouts that no department has registered a rule for: they admit nobody, and readiness says so. */
export function unregisteredRollouts(on: ReadonlySet<string>): string[] {
  return [...on].filter((key) => !REGISTRY.has(key)).sort();
}
