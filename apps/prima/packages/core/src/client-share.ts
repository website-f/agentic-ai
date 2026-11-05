import type { IsoDate, IsoDateTime, Id } from './types';

// Client portal, first step (Fauzan, 3 Nov 2026: "Shared report links first"). The company manager makes a read-only,
// expiring link for one client covering one period. Whoever opens it sees only that client's own sites: no Prima
// sign-in, no staff or guard names, no case descriptions, no money owed. A link can be revoked at any time.

/** Longest a link may stay open, in days. */
export const SHARE_MAX_DAYS = 30;
/** Longest period one link may cover, in days. */
export const SHARE_MAX_PERIOD_DAYS = 92;

export interface ClientShareLink {
  id: Id;
  /** Who at the client receives it, by role or name: kept for the audit, never shown on the page. */
  recipient: string;
  from: IsoDate;
  to: IsoDate;
  expiresOn: IsoDate;
  by: string;
  byId: Id;
  at: IsoDateTime;
  revokedBy: string | null;
  revokedAt: IsoDateTime | null;
  revokeReason: string | null;
  views: number;
  lastViewAt: IsoDateTime | null;
}

/** Case kinds a client may see on its own report. Staffing, identity, arms and compliance cases stay internal. */
export const SHARE_CASE_LABEL: Record<string, string> = {
  INCIDENT: 'Incident',
  SOS: 'Emergency alert',
  COMPLAINT: 'Complaint',
};

/** What the page shows a client. Built only from the client's own sites and period. */
export interface ClientShareReport {
  clientName: string;
  companyName: string;
  from: IsoDate;
  to: IsoDate;
  expiresOn: IsoDate;
  generatedAt: IsoDateTime;
  sites: { name: string; patrolScans: number; visits: number }[];
  incidents: { ref: string; on: IsoDate; site: string; kind: string; severity: string; status: 'Open' | 'In hand' | 'Resolved' }[];
  invoices: { period: string; amount: number; sentOn: IsoDate | null }[];
  reports: string[];
}

/** A share link is usable on `today` when it is not revoked and not past its expiry date. */
export function shareLinkLive(l: Pick<ClientShareLink, 'revokedAt' | 'expiresOn'>, today: IsoDate): boolean {
  return !l.revokedAt && today <= l.expiresOn;
}

/**
 * Invoices and monthly reports are kept per month (YYYY-MM). A month is listed on a link only when the whole month lies
 * inside the link's period, so a link for 20 to 26 October never shows the October invoice as if it covered those days.
 */
export function monthInsidePeriod(period: string, from: IsoDate, to: IsoDate): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-01` >= from && `${period}-${String(last).padStart(2, '0')}` <= to;
}
