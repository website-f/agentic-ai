import type { DutyOfflineContext } from '@prima/core';
export type { DutyOfflineContext } from '@prima/core';

// Memory only. A new tab/reload must verify online before it can open offline records.
let current: DutyOfflineContext | null = null;
let generation = 0;
export class OfflineContextError extends Error {}
export const contextGeneration = () => generation;
export function contextKey(c: DutyOfflineContext): string {
  const values = [c.accountId, c.companyId, c.siteId, c.deviceId, c.enrollmentId];
  if (values.some((v) => typeof v !== 'string' || !v.trim())) throw new OfflineContextError('Offline enrollment is incomplete.');
  return JSON.stringify(values);
}
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('prima-duty-session') : null;
export function invalidateDutyContext(broadcast = true): void {
  current = null;
  generation++;
  if (broadcast) channel?.postMessage('invalidate');
}
if (channel) channel.onmessage = () => invalidateDutyContext(false);
export function bindDutyContext(c: DutyOfflineContext | null, expectedGeneration: number): void {
  if (generation !== expectedGeneration) throw new OfflineContextError('Sign-in changed. Reopen the duty screen online.');
  if (c) contextKey(c);
  if (current && (!c || contextKey(current) !== contextKey(c))) generation++;
  current = c ? { ...c } : null;
}
export function dutyLease() {
  if (!current) throw new OfflineContextError('Offline access is locked. Open the duty screen online with an enrolled device. Pending records are retained.');
  return { context: { ...current }, generation };
}
export type DutyLease = ReturnType<typeof dutyLease>;
export function assertDutyLease(lease: DutyLease): void {
  if (!current || generation !== lease.generation || contextKey(current) !== contextKey(lease.context))
    throw new OfflineContextError('Account or device context changed. Pending records are retained for their original enrollment.');
}
