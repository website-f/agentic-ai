import type { ImportReviewClient, ReviewPerson, ReviewSnapshot } from './it-import-review';
import { decodeReviewResponse, decodeApprovalReceipt, inspectReviewReadiness, type ContractReview } from './it-import-review-contract';
import { restorePendingReview, type PendingReview } from './it-import-review-recovery';
/** Injected interfaces only: no fetch, browser storage or production activation in this module. */
export interface ReviewMarkerStore {
  read(ownerId: string): Promise<unknown | null>;
  save(marker: PendingReview): Promise<void>;
  clearConfirmed(marker: PendingReview): Promise<void>;
}
export interface ReviewContractTransport { request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> }
const base = '/api/arisha/it-import';
const messages = (x: unknown): string[] => {
  if (!Array.isArray(x) || x.some(s => typeof s !== 'string')) throw Error('Invalid validation response');
  return [...x];
};
/** Local implementation behind an explicit default-off UI release gate and server readiness. */
export function contractReviewClient(options: {
  integrationEnabled: boolean; ownerId: 'u-fauzan'; transport: ReviewContractTransport; markers: ReviewMarkerStore;
  directory: () => Promise<ReviewPerson[]>; requestId: () => string;
  claim?: <T>(run: () => Promise<T>) => Promise<T>;
}): ImportReviewClient & { pendingReviewId(): Promise<string | null>; refresh(): Promise<ReviewSnapshot> } {
  if (options.integrationEnabled !== true || options.ownerId !== 'u-fauzan') throw Error('Review integration is disabled');
  const { transport, markers, ownerId } = options;
  let current: ContractReview | null = null;
  let busy = false;
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => { if (busy) throw Error('Request already in flight'); busy = true; try { return await (options.claim ? options.claim(fn) : fn()); } finally { busy = false; } };
  const pending = async () => { const raw = await markers.read(ownerId); return raw === null ? null : restorePendingReview(raw, ownerId); };
  const map = (raw: unknown, id: string): ReviewSnapshot => {
    const r = decodeReviewResponse(raw, { reviewId: id, actorId: ownerId });
    const wire = raw as { preview: { problems: unknown; missingColumns: unknown; rows: { errors: unknown; warnings: unknown; duplicateOf: unknown }[] } | null };
    const errors = r.needsRefresh ? ['Saved preview is stale. Refresh and review again before approving.'] : [];
    if (wire.preview) errors.push(...messages(wire.preview.problems), ...messages(wire.preview.missingColumns));
    const rows = r.rows.map((row, i) => {
      const result = wire.preview?.rows[i];
      if (r.status === 'reviewing' && !result) throw Error('Missing preview row');
      const warnings = result ? messages(result.warnings) : [];
      if (result?.duplicateOf) warnings.push('Existing duplicate; server will leave this row out.');
      return { row: row.sheetRow, errors: result ? messages(result.errors) : [], warnings,
        fields: Object.fromEntries(Object.entries(row.fields).map(([key, f]) => [key, { value: f.value ?? '', edited: f.support === 'human-entered' || f.support === 'cleared', support: f.support,
          evidence: { raw: null, start: null, end: null } }])) };
    });
    current = r;
    return { id: r.id, version: r.version, previewToken: r.savedPreviewToken, expiresAt: r.expiresAt, rows, errors,
      status: r.status === 'committed' ? 'approved' : r.status === 'reviewing' ? 'review' : r.status,
      ...(r.receipt ? { receipt: { created: r.receipt.created, skipped: r.receipt.skipped.map(s => ({ row: s.row, why: s.message })), already: true } } : {}) };
  };
  const recover = async (id: string) => {
    const marker = await pending(); if (!marker || marker.requestId !== id) throw Error('Recover the pending review first');
    return map(await transport.request('GET', `${base}/reviews/${id}`), id);
  };
  const updateRows = async (rows: import('./it-import-review').ReviewRow[]) => {
    if (!current || current.status !== 'reviewing' || !rows.length || rows.length > 20 || new Set(current.rows.map(r => r.extractionId)).size !== 1) throw Error('Load a supported review first');
    if ((await pending())?.requestId !== current.id) throw Error('Recover original review marker first');
        const parts = [...new Set(current.rows.map(r => r.extractionId))].map(extractionId => ({ extractionId, rows: rows.map(row => {
          const prior = current!.rows.find(r => r.sheetRow === row.row && r.extractionId === extractionId);
          if (!prior) throw Error('Stable row binding missing');
          return { rowId: prior.rowId, fields: Object.fromEntries(Object.entries(row.fields).map(([k, f]) => [k, f.value || null])) };
        }) }));
        return map(await transport.request('POST', `${base}/reviews/${current.id}`, { version: current.version, parts }), current.id);
  };
  return {
    directory: options.directory,
    updateSaved: rows => exclusive(() => updateRows(rows)),
    finishConfirmed: () => exclusive(async () => {
      const marker = await pending(); if (!marker) return;
      const result = await recover(marker.requestId);
      if (!(result.status === 'approved' && result.receipt) && !['abandoned', 'expired'].includes(result.status)) throw Error('Confirm the original receipt or closed review before starting another');
      await markers.clearConfirmed(marker); current = null;
    }),
    pendingReviewId: async () => (await pending())?.requestId ?? null,
    capability: async () => {
      const readiness = inspectReviewReadiness(await transport.request('GET', base));
      const team = await options.directory();
      return { enabled: readiness.serverEnabled, permitted: readiness.serverSaysReady, resumable: true, immutableEvidence: true,
        eligibleStaffIds: team.filter(p => ['lead', 'executive'].includes(p.itRole ?? '')).map(p => p.id), maxProposals: 20,
        reason: readiness.serverSaysReady ? 'Review capability verified by server; approval remains separate.' : 'Backend review capability is not ready.' };
    },
    preview: input => exclusive(async () => {
      if (!input.rows.length || input.rows.length > 20) throw Error('Unsupported AI batch');
      const marker = await pending();
      if (marker) throw Error('Recover pending review before admitting a new source');
      const fresh = restorePendingReview({ schema: 1, ownerId, requestId: options.requestId() }, ownerId);
      // Prepare immutable payload before persisting; source is sent only on first admission, never stored here.
      const body = JSON.parse(JSON.stringify({ requestId: fresh.requestId, kind: input.extraction.kind, parts: [{ extractionId: input.extraction.extractionId,
        source: input.extraction.source, rows: input.rows.map(row => ({ fields: Object.fromEntries(Object.entries(row.fields).map(([k, f]) => [k, f.value || null])),
          evidence: Object.fromEntries(Object.entries(row.fields).filter(([, f]) => f.evidence.start !== null && f.evidence.end !== null).map(([k, f]) => [k, { start: f.evidence.start, end: f.evidence.end }])) })) }] }));
      await markers.save(fresh);
      const saved = await pending(); if (saved?.requestId !== fresh.requestId) throw Error('Pending review marker not retained');
      return map(await transport.request('POST', `${base}/reviews`, body), fresh.requestId);
    }),
    resume: id => exclusive(() => recover(id)),
    refresh: () => exclusive(async () => { if (!current || current.status !== 'reviewing') throw Error('Load review first');
      return map(await transport.request('POST', `${base}/reviews/${current.id}/refresh`, { version: current.version }), current.id); }),
    approve: input => exclusive(async () => {
      const marker = await pending();
      if (!marker || marker.requestId !== input.id || !current || current.id !== input.id || current.needsRefresh || current.version !== input.version || current.savedPreviewToken !== input.previewToken) throw Error('Review again before approving');
      const receipt = decodeApprovalReceipt(await transport.request('POST', `${base}/reviews/${input.id}/approve`, { version: input.version, previewToken: input.previewToken, skipRows: input.skipRows }), input.id);
      return { created: receipt.created, skipped: receipt.skipped.map(s => ({ row: s.row, why: s.message })), already: receipt.already };
    }),
  };
}

/** Tests must explicitly opt into an injected fake transport; no production code uses this helper. */
export function syntheticContractReviewClient(options: Omit<Parameters<typeof contractReviewClient>[0], 'integrationEnabled'> & { syntheticOnly: true }) {
  if (options.syntheticOnly !== true) throw Error('Synthetic opt-in missing');
  return contractReviewClient({ ...options, integrationEnabled: true });
}
