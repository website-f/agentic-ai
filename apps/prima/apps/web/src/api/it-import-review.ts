import type { ExtractionPreview } from './it-extraction';
/** UI boundary, not a claim that PR42 currently implements these guarantees. */
export interface ReviewCapability {
  enabled: boolean; permitted: boolean; resumable: boolean; immutableEvidence: boolean;
  eligibleStaffIds: string[]; maxProposals: number; reason: string;
}
export interface ReviewPerson { id: string; name: string; itRole: string | null }
export interface ReviewField { support?: 'source-supported' | 'human-entered' | 'cleared' | 'unverified'; value: string; evidence: { raw: string | null; start: number | null; end: number | null }; edited: boolean }
export interface ReviewRow { row: number; fields: Record<string, ReviewField>; errors: string[]; warnings: string[] }
export interface ReviewInput { extraction: ExtractionPreview; rows: ReviewRow[] }
export interface ReviewSnapshot {
  id: string; version: number; previewToken: string; expiresAt: string;
  rows: ReviewRow[]; errors: string[]; status: 'review' | 'approved' | 'abandoned' | 'expired';
  receipt?: ReviewReceipt;
}
export interface ReviewReceipt { created: string[]; skipped: { row: number; why: string }[]; already: boolean }
export interface ImportReviewClient {
  capability(): Promise<ReviewCapability>;
  pendingReviewId?(): Promise<string | null>;
  refresh?(): Promise<ReviewSnapshot>;
  updateSaved?(rows: ReviewRow[]): Promise<ReviewSnapshot>;
  finishConfirmed?(): Promise<void>;
  directory(): Promise<ReviewPerson[]>;
  preview(input: ReviewInput): Promise<ReviewSnapshot>;
  resume(id: string): Promise<ReviewSnapshot>;
  approve(input: { id: string; version: number; previewToken: string; skipRows: number[] }): Promise<ReviewReceipt>;
}
/** Never infer readiness from a green build, extraction status, or mere route presence.
 * No review mutation is connected until the server contract passes independent review.
 * In particular GET from PR42 a231e33 cannot safely reconstruct or reapprove a review.
 */
export function blockedImportReviewClient(directory: () => Promise<ReviewPerson[]>): ImportReviewClient {
  const blocked = async (): Promise<never> => { throw new Error('Review integration is not enabled.'); };
  return {
    capability: async () => ({ enabled: false, permitted: false, resumable: false, immutableEvidence: false,
      eligibleStaffIds: [], maxProposals: 20,
      reason: 'Batch approval is unavailable: secure review resumption and immutable source evidence are awaiting backend verification.' }),
    directory, preview: blocked, resume: blocked, approve: blocked,
  };
}
