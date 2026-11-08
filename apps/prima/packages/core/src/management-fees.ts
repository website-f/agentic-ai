import { GOV_OPS_COMPANY_ID } from "./access";
import { PRIVATE_OPS_COMPANY_ID } from "./access";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { ManagementFee } from "./types";
import type { ManagementFeeChange } from "./types";


/**
 * Whether a fee comes off site profit and loss (Fauzan, 5 Nov 2026: the FD or the CEO puts any fee in or takes it out).
 * Unless they chose, the operations company's fee (Goodwill or Sasa Team) comes off and any other company's does not.
 */
export function feeTakenOffSiteProfit(chargedBy: Id | 'other', fee: Pick<ManagementFee, 'inSiteProfit'>): boolean {
  return fee.inSiteProfit ?? (chargedBy === GOV_OPS_COMPANY_ID || chargedBy === PRIVATE_OPS_COMPANY_ID);
}

/** A month as YYYY-MM. */
export const FEE_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The month before m (YYYY-MM). */
export function monthBefore(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

/** What a fee is worked on: the sector's sites for the two operations companies, else all the payer's sites. */
export function feeBasisOf(chargedBy: Id): 'government' | 'private' | 'all' {
  return chargedBy === GOV_OPS_COMPANY_ID ? 'government' : chargedBy === PRIVATE_OPS_COMPANY_ID ? 'private' : 'all';
}

/**
 * The fee chargedBy bills this company for month m (YYYY-MM), or null when none applies. The newest change whose
 * from-month is on or before m wins (ties go to the later change). A fee entered before changes were kept (no log
 * entry for that charging company) applies to every month.
 */
export function feeInEffect(fin: Pick<FinStatus, 'managementFees' | 'managementFeeLog'> | null | undefined, chargedBy: Id, m: string): ManagementFee | null {
  if (!fin) return null;
  const mine = (fin.managementFeeLog ?? []).filter((e) => e.chargedBy === chargedBy);
  if (!mine.length) return fin.managementFees?.[chargedBy] ?? null;
  const applies = mine.filter((e) => e.from <= m).sort((a, b) => a.from.localeCompare(b.from) || a.at.localeCompare(b.at));
  return applies.length ? applies[applies.length - 1].fee : null;
}

/** Changes still to come after month m, for chargedBy (scheduled from a later month). */
export function feeChangesAfter(fin: Pick<FinStatus, 'managementFeeLog'> | null | undefined, chargedBy: Id, m: string): ManagementFeeChange[] {
  return (fin?.managementFeeLog ?? []).filter((e) => e.chargedBy === chargedBy && e.from > m).sort((a, b) => a.from.localeCompare(b.from) || a.at.localeCompare(b.at));
}

/** Every company that has ever had a fee from chargedBy recorded on this Finance record. */
export function feeChargers(fin: Pick<FinStatus, 'managementFees' | 'managementFeeLog'> | null | undefined): Id[] {
  if (!fin) return [];
  return [...new Set([...Object.keys(fin.managementFees ?? {}).filter((k) => fin.managementFees?.[k]), ...(fin.managementFeeLog ?? []).map((e) => e.chargedBy)])];
}

export function feeLabel(fee: Pick<ManagementFee, 'kind' | 'value'> | null): string {
  return !fee ? 'no fee' : fee.kind === 'percent' ? `${fee.value}% of billing` : `RM${fee.value.toFixed(2)} a month`;
}