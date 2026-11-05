import type { FinCheckSection } from '@prima/core';

/**
 * Where a Finance home or Today item asked to open (staff-eye review, Fauzan 2 Nov 2026): the Checks tab, its section and
 * the company with the work. Read once by the Finance screen when it opens.
 */
export interface FinTarget {
  tab: 'checks' | 'payments' | 'close' | 'dashboard';
  section?: FinCheckSection;
  companyId?: string;
}

let pending: FinTarget | null = null;

export function setFinTarget(t: FinTarget | null) {
  pending = t;
}

export function takeFinTarget(): FinTarget | null {
  const t = pending;
  pending = null;
  return t;
}
