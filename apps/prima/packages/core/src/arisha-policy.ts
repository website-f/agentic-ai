import type { RecordValues } from './records';

/** Exact identities for the leadership pilot. A matching title is never sufficient. */
export interface ArishaPilotUser {
  id: string;
  opsTier?: string | null;
  leadership?: string | null;
  actRole?: string | null;
  integration?: string | null;
}

export type ArishaLeader = 'ceo' | 'finance' | 'coo' | 'act';
export type ArishaContextKind = 'operations' | 'compliance' | 'finance-papers';

/** Context access is distinct from draft, write and approval permissions. */
export function arishaMayReadContext(user: ArishaPilotUser, context: string): context is ArishaContextKind {
  const role = arishaLeader(user);
  if (context !== 'operations' && context !== 'compliance' && context !== 'finance-papers') return false;
  if (role === 'ceo' || role === 'act') return true;
  return (role === 'coo' && context === 'operations') || (role === 'finance' && context === 'finance-papers');
}

export function arishaLeader(user: ArishaPilotUser): ArishaLeader | null {
  if (user.integration) return null;
  if (user.id === 'u-fauzan' && user.opsTier === 'ceo') return 'ceo';
  if (user.id === 'u-fd' && user.leadership === 'finance_director') return 'finance';
  if (user.id === 'u-coo' && user.opsTier === 'coo') return 'coo';
  if (user.id === 'u-audit' && user.actRole === 'lead') return 'act';
  return null;
}

export function arishaPilotAllowed(user: ArishaPilotUser): boolean {
  return arishaLeader(user) !== null;
}

/**
 * P80: everyone who opens Prima (owner, managers, staff; never an integration login) may consult Arisha: how to do
 * things, what a screen means, the rules and guide cards. That is read-only guidance; reading context and preparing
 * drafts stay with the leaders above, and every tool is still authorised per person by the service.
 */
export function arishaMayConsult(user: ArishaPilotUser): boolean {
  return !user.integration;
}

/** Existing CEO master-data preparation, separate from the cross-user create-only queue. */
export function arishaMayDraftCompany(user: ArishaPilotUser): boolean {
  return arishaLeader(user) === 'ceo';
}

/** AI never asserts source verification; the server must force verificationStatus='draft'. */
export const ARISHA_COMPANY_DRAFT_FIELDS: readonly string[] = Object.freeze([
  'name', 'ssmNo', 'registeredOn', 'registeredAddress', 'businessAddress', 'state', 'headOfCompany', 'sourceRef',
]);

/** A small initial drafting slice, not new operational or approval authority. */
export const ARISHA_DRAFT_RECORD_KINDS = Object.freeze(['site', 'post', 'checkpoint', 'itDomain'] as const);
export type ArishaRecordDraftKind = (typeof ARISHA_DRAFT_RECORD_KINDS)[number];
const NO_RECORD_KINDS: readonly ArishaRecordDraftKind[] = Object.freeze([]);

/** Explicit fields fail closed when a generic record schema gains a new field. */
export const ARISHA_DRAFT_RECORD_FIELDS: Readonly<Record<ArishaRecordDraftKind, readonly string[]>> = Object.freeze({
  site: Object.freeze(['code', 'name', 'client', 'address', 'branchId', 'lat', 'lng', 'geofenceM', 'risk', 'sector']),
  post: Object.freeze(['siteId', 'name', 'shiftStructure', 'guardsPerShift']),
  checkpoint: Object.freeze(['siteId', 'name', 'tagCode']),
  itDomain: Object.freeze(['name', 'kind', 'registrar', 'expiresOn', 'sslExpiresOn']),
});
const NO_FIELDS: readonly string[] = Object.freeze([]);

export function arishaRecordKindsFor(user: ArishaPilotUser): readonly ArishaRecordDraftKind[] {
  const role = arishaLeader(user);
  return role === 'ceo' || role === 'act' || role === 'coo' ? ARISHA_DRAFT_RECORD_KINDS : NO_RECORD_KINDS;
}

export function arishaMayDraftRecord(user: ArishaPilotUser, kind: string): kind is ArishaRecordDraftKind {
  return arishaRecordKindsFor(user).some((allowed) => allowed === kind);
}

export function arishaRecordFieldsFor(kind: string): readonly string[] {
  return Object.prototype.hasOwnProperty.call(ARISHA_DRAFT_RECORD_FIELDS, kind)
    ? ARISHA_DRAFT_RECORD_FIELDS[kind as ArishaRecordDraftKind]
    : NO_FIELDS;
}

/** Only preparation of an existing finance paper; never review, dispatch or payment. */
export function arishaMayPrepareFinance(user: ArishaPilotUser): boolean {
  const role = arishaLeader(user);
  return role === 'ceo' || role === 'act' || role === 'finance';
}

export type ArishaReviewPayload =
  | { type: 'record'; kind: ArishaRecordDraftKind; id: null; values: RecordValues }
  | { type: 'finance-paper'; pack: 'audit' | 'tax'; itemId: string; status: 'prepared' };

/**
 * Durable, immutable submitted proposal. This is not an approval or operational record.
 * sourceVersion is server-private comparison material, never included in model context.
 * Both commit and return require an authenticated human with existing write authority.
 * The author may review their own proposal only if they already have that authority.
 */
export interface ArishaReviewDraft {
  id: string;
  companyId: string | null;
  authorId: string;
  authorRole: ArishaLeader;
  createdAt: string;
  /** Preparation origin. Legacy arisha/human values are historical claims, not verified proof. */
  provenance: 'arisha' | 'human' | 'unverified';
  version: number;
  status: 'submitted' | 'returned' | 'committed';
  payload: ArishaReviewPayload;
  sourceVersion: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  resultId: string | null;
}

/** The browser may see the proposal, never the private source comparison snapshot. */
export type ArishaReviewDraftView = Omit<ArishaReviewDraft, 'sourceVersion'>;
