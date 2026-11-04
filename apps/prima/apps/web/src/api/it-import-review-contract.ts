/** Read-only decoding of PR42 13c36ec. No transport or production integration is enabled here. */
export const REVIEW_CONTRACT_HEAD = '13c36ec6a3d471d63510197b0087c1552868af47';
const fieldsByKind = {
  tickets: ['title', 'category', 'priority', 'requester', 'channel', 'raisedOn', 'detail', 'itPerson'],
  jobs: ['title', 'kind', 'priority', 'technical', 'doer', 'dueOn', 'detail'],
} as const;
export type ContractRow = {
  sheetRow: number; rowId: string; extractionId: string;
  fields: Record<string, { value: string | null; support: 'source-supported' | 'human-entered' | 'cleared' | 'unverified' }>;
};
export type ContractReceipt = { reviewId: string; already: boolean; created: string[]; skipped: { row: number; message: string; code: string | null }[] };
export type ContractReview = {
  id: string; version: number; status: 'reviewing' | 'committed' | 'abandoned' | 'expired';
  savedPreviewToken: string; displayedPreviewToken: string | null; needsRefresh: boolean;
  expiresAt: string; purged: boolean; originalRowCount: number; rows: ContractRow[];
  receipt: ContractReceipt | null; canWrite: false;
};
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
function require(ok: unknown): asserts ok { if (!ok) throw new Error('Unsupported review response; keep approval disabled.'); }
const text = (x: unknown, max = 120): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const hash = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
function strings(x: unknown): string[] { require(Array.isArray(x) && x.every(v => typeof v === 'string')); return [...x]; }
const reasons: Record<string, string> = { error: 'Validation error', duplicate: 'Duplicate record', left_out: 'Left out by the reviewer' };
/** First approval has T9 `why`; retry/GET uses reason codes. Do not discard either or invent success. */
export function decodeApprovalReceipt(raw: unknown, expectedReviewId: string): ContractReceipt {
  require(object(raw) && raw.reviewId === expectedReviewId && uuid(raw.reviewId) && typeof raw.already === 'boolean');
  const created = strings(raw.created); require(created.length <= 200 && created.every(v => text(v)));
  require(Array.isArray(raw.skipped) && raw.skipped.length <= 200);
  const skipped = raw.skipped.map(s => {
    require(object(s) && Number.isInteger(s.row) && Number(s.row) >= 2 && Number(s.row) <= 201);
    const hasWhy = typeof s.why === 'string'; const hasReason = typeof s.reason === 'string';
    require(hasWhy !== hasReason);
    if (hasWhy) { require(text(s.why, 2000)); return { row: Number(s.row), message: s.why, code: null }; }
    require(typeof s.reason === 'string' && Object.hasOwn(reasons, s.reason));
    return { row: Number(s.row), message: reasons[s.reason], code: s.reason };
  });
  require(new Set(skipped.map(s => s.row)).size === skipped.length && new Set(created).size === created.length);
  return { reviewId: raw.reviewId, already: raw.already, created, skipped };
}
/** A status flag is useful display information, NOT an authorization to connect the write adapter. */
export function inspectReviewReadiness(raw: unknown) {
  require(object(raw) && typeof raw.enabled === 'boolean' && typeof raw.ready === 'boolean');
  require(!raw.ready || raw.enabled);
  const problems = raw.problems === undefined ? null : strings(raw.problems);
  require(problems === null || (problems.length <= 100 && problems.every(p => text(p, 1000))));
  require(!raw.ready || (problems !== null && problems.length === 0));
  return { serverEnabled: raw.enabled, serverSaysReady: raw.ready, databaseProblems: problems, canWrite: false as const,
    blockers: ['Backend SQL/HTTP and activation review pending', 'Durable owner-bound pending-request guard not wired'] };
}
/** Preserve server row IDs and sheet numbering (starts at2), not extraction row numbering (starts at1).
 * Server support labels never reconstruct missing source/evidence offsets or certify original AI output.
 */
export function decodeReviewResponse(raw: unknown, expected: { reviewId: string; actorId: string }): ContractReview {
  require(object(raw) && object(raw.review) && typeof raw.stale === 'boolean');
  const r = raw.review;
  require(r.id === expected.reviewId && uuid(r.id) && r.actorId === expected.actorId && expected.actorId === 'u-fauzan');
  require(r.kind === 'tickets' || r.kind === 'jobs');
  require(['reviewing', 'committed', 'abandoned', 'expired'].includes(String(r.status)));
  require(Number.isInteger(r.version) && Number(r.version) > 0 && hash(r.previewToken));
  require(typeof r.expiresAt === 'string' && Number.isFinite(Date.parse(r.expiresAt)) && typeof r.purged === 'boolean');
  require(object(r.counts) && Number.isInteger(r.counts.rows) && Number(r.counts.rows) >= 0 && Number(r.counts.rows) <= 200);
  require(Array.isArray(r.parts) && r.parts.length <= 10);
  const rows: ContractRow[] = []; const extractionIds = new Set<string>();
  for (const p of r.parts) {
    require(object(p) && uuid(p.extractionId) && !extractionIds.has(p.extractionId) && hash(p.sourceSha256) && Array.isArray(p.rows));
    extractionIds.add(p.extractionId); const rowIds = new Set<string>();
    for (const item of p.rows) {
      require(object(item) && text(item.rowId) && !rowIds.has(item.rowId) && object(item.fields)); rowIds.add(item.rowId);
      const allowed = fieldsByKind[r.kind]; require(Object.keys(item.fields).sort().join('|') === [...allowed].sort().join('|'));
      const quoted = strings(item.quoted), typed = strings(item.typed), cleared = strings(item.cleared);
      const labels = [...quoted, ...typed, ...cleared]; require(labels.every(k => (allowed as readonly string[]).includes(k)) && new Set(labels).size === labels.length);
      const fields: ContractRow['fields'] = {};
      for (const key of allowed) {
        const value = item.fields[key]; require(value === null || (typeof value === 'string' && value.length <= 1000));
        require(!cleared.includes(key) || value === null); require(!quoted.includes(key) || (value !== null && !['doer', 'itPerson'].includes(key)));
        fields[key] = { value, support: quoted.includes(key) ? 'source-supported' : typed.includes(key) ? 'human-entered' : cleared.includes(key) ? 'cleared' : 'unverified' };
      }
      rows.push({ sheetRow: rows.length + 2, rowId: item.rowId, extractionId: p.extractionId, fields });
    }
  }
  // Existing manual T9 accepts200; this AI frontend does not silently expand its20-proposal scope.
  require(rows.length <= 20 && (r.purged ? rows.length === 0 : rows.length === r.counts.rows));
  let displayedPreviewToken: string | null = null;
  if (r.status === 'reviewing') {
    require(!r.purged && object(raw.preview) && hash(raw.preview.previewToken) && raw.preview.kind === r.kind);
    displayedPreviewToken = raw.preview.previewToken;
    require(raw.stale === (displayedPreviewToken !== r.previewToken));
    require(Array.isArray(raw.preview.rows) && raw.preview.rows.length === rows.length);
    raw.preview.rows.forEach((p, i) => require(object(p) && p.row === rows[i].sheetRow));
  } else require(raw.preview === null && raw.stale === false);
  const receipt = r.status === 'committed' && object(r.receipt) ? decodeApprovalReceipt({ ...r.receipt, reviewId: r.id, already: true }, r.id) : null;
  require(r.status !== 'committed' || receipt !== null);
  return { id: r.id, version: Number(r.version), status: r.status as ContractReview['status'], savedPreviewToken: r.previewToken,
    displayedPreviewToken, needsRefresh: raw.stale, expiresAt: r.expiresAt, purged: r.purged,
    originalRowCount: Number(r.counts.rows), rows, receipt, canWrite: false };
}
