import { isRealDate } from './time';
import type { InsuranceClaim, InsuranceKind, InsurancePolicy, IsoDate } from './types';

// Masterplan row 61 (insurance and warranty response) and 21: an insurance claim moves through steps a person records,
// each with its reference. Prima never contacts an insurer, accepts an offer for the company or receives money; a claim
// is settled only when Finance records the money received against the bank statement.

/** Documents insurers usually ask for, by cover. The insurer's own list wins: staff may add any other document. */
export const CLAIM_DOCS: Record<InsuranceKind, string[]> = {
  PUBLIC_LIABILITY: ['Claim form', 'Incident report', 'Police report', "Third party's letter of demand"],
  GROUP_PERSONAL_ACCIDENT: ['Claim form', 'Incident report', 'Medical report', 'Hospital or clinic bill'],
  GROUP_HOSPITALISATION: ['Claim form', 'Medical report', 'Hospital bill'],
  FW_HOSPITALISATION: ['Claim form', 'Medical report', 'Hospital bill', 'Passport and permit copy'],
  FIDELITY_GUARANTEE: ['Claim form', 'Police report', 'Investigation or audit report', 'Proof of loss'],
  ARMED_SERVICE: ['Claim form', 'Incident report', 'Police report', 'Firearm incident report'],
  CASH_IN_TRANSIT: ['Claim form', 'Incident report', 'Police report', 'Cash movement record'],
  MOTOR_FLEET: ['Claim form', 'Police report', 'Repair quotation', "Driver's licence copy"],
  FIRE_OFFICE: ['Claim form', 'Fire and Rescue (Bomba) report', 'List of items lost with values'],
};

export const CLAIM_STATUS_ORDER: InsuranceClaim['status'][] = ['to_notify', 'notified', 'documents', 'assessing', 'offered', 'settled', 'rejected'];

/** Documents still missing before the claim can be sent for assessment. Names compare without case. */
export function missingClaimDocs(kind: InsuranceKind | null, docs: { name: string }[]): string[] {
  const have = new Set(docs.map((d) => d.name.trim().toLowerCase()));
  return (kind ? CLAIM_DOCS[kind] : ['Claim form']).filter((n) => !have.has(n.toLowerCase()));
}

/** Whether the policy was in force on the incident date. A claim outside cover is still recorded, and flagged. */
export function coveredOn(policy: Pick<InsurancePolicy, 'startsOn' | 'expiresOn'> | null | undefined, on: IsoDate): boolean {
  return !!policy && policy.startsOn <= on && on <= policy.expiresOn;
}

/** A date written as YYYY-MM-DD that exists on the calendar. */
