import { arishaPilotAllowed, arishaRecordKindsFor, type ArishaPilotUser } from '@prima/core';
export { arishaPilotAllowed, type ArishaPilotUser } from '@prima/core';

/** Tools prepare narrow drafts only; operational save powers are unchanged. */
export function arishaCanPrepareRecords(user: ArishaPilotUser): boolean {
  return arishaRecordKindsFor(user).length > 0;
}

/** Opt-in access lock during real-data onboarding. Defaults off. */
export function leadershipOnboardingPermits(user: ArishaPilotUser, env: Record<string, string | undefined> = process.env): boolean {
  return env.LEADERSHIP_ONBOARDING_ONLY !== 'true' || arishaPilotAllowed(user);
}
