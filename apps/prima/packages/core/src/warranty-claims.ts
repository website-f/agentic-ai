// Equipment warranty claims (Fitri package A8 / J2 / N5, approved by Fauzan 11 Nov 2026). Insurance claims cover
// policies only; this covers a faulty item still under the maker's or supplier's warranty. Steps: the fault is reported
// with photo proof > the store or asset owner checks the warranty dates > the claim goes to the supplier > the outcome
// is recorded (repaired, replaced, or refused with the reason) > the item record is updated. A claim on an item out of
// warranty is refused with the reason at the check. Pure helpers; the service checks who may act.
import type { Id, IsoDate, IsoDateTime } from './types';

/** IT assets (IT department register) and devices issued from the Goodwill store (stock issues with a serial). */
export type WarrantySource = 'it_asset' | 'stock';
export type WarrantyStatus = 'reported' | 'checked' | 'sent' | 'closed';
export type WarrantyResult = 'repaired' | 'replaced' | 'refused';

export const WARRANTY_RESULT_LABEL: Record<WarrantyResult, string> = {
  repaired: 'Repaired under warranty',
  replaced: 'Replaced under warranty',
  refused: 'Refused',
};

export interface WarrantyClaim {
  id: Id;
  /** The owner of the item: the IT asset's owner, or the store's company for issued stock. */
  companyId: Id;
  ref: string;
  source: WarrantySource;
  itemId: Id;
  /** Tag, model or item name, as on the register when reported. */
  itemLabel: string;
  serial: string;
  fault: string;
  faultOn: IsoDate;
  reportedBy: string;
  reportedById: Id;
  reportedAt: IsoDateTime;
  proofIds: Id[];
  status: WarrantyStatus;
  check: { by: string; byId: Id; at: IsoDateTime; warrantyTo: IsoDate; fromRecord: boolean; supplier: string; inWarranty: boolean; note: string; docIds: Id[] } | null;
  sent: { by: string; byId: Id; at: IsoDateTime; on: IsoDate; supplierRef: string } | null;
  outcome: { by: string; byId: Id; at: IsoDateTime; result: WarrantyResult; note: string; replacementSerial: string | null } | null;
  /** The IT asset's status before it went to the supplier, put back when it returns. */
  priorStatus?: string | null;
}

/** Whether the fault falls inside the warranty, with the reason a claim out of warranty is refused. */
export function warrantyCheck(warrantyTo: IsoDate, faultOn: IsoDate): { inWarranty: boolean; reason: string } {
  return faultOn <= warrantyTo
    ? { inWarranty: true, reason: `In warranty: the warranty runs to ${warrantyTo} and the fault was found on ${faultOn}.` }
    : { inWarranty: false, reason: `Out of warranty: the warranty ended on ${warrantyTo}, before the fault was found on ${faultOn}.` };
}

/** Days left on the warranty from today (negative when ended); null when the date is not known. */
export function warrantyDaysLeft(warrantyTo: IsoDate | null, today: IsoDate): number | null {
  if (!warrantyTo) return null;
  return Math.round((Date.parse(`${warrantyTo}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
