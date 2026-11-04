import { sha256Hex } from './audit';
import { AccessDenied, accessClosed } from './access';
import { arishaLeader } from './arisha-policy';
import { IT_IMPORT_MAX_ROWS, type ItImportKind, type ItImportPreview } from './it-import';
import type { Store } from './store';
import type { AuditEntry, User } from './types';
import { BadRequest, NotFound, ReviewConflict, type PrimaService } from './service';

/**
 * Arisha's reviewed handoff into the T9 batch import (Fauzan, 31 Oct 2026: batch import in the app is a must and comes
 * together with Monday's real data; Arisha main asked for this interface the same day and reviewed it at a231e33).
 * Arisha's extraction stays preview-only. The CEO reviews the proposed rows here; Prima keeps that review in a ledger,
 * turns it into the same table text the T9 import reads, and the CEO approves the exact T9 preview. The only write to
 * IT records is still PrimaService.itImportApprove, with every T9 rule unchanged.
 *
 * Source admission and editing are separate. A part (one extraction) is admitted once, within the extraction's
 * 15 minutes, with its source text, which Prima checks against the audited fingerprint and the evidence offsets and
 * then drops: it is never stored. After that the CEO may edit, remove or add rows for the whole 24-hour life of the
 * review without the source. Nothing is ever deleted as a batch: a mistake is fixed record by record (Fauzan,
 * 31 Oct 2026). docs/ARISHA_T9_HANDOFF_PROPOSAL.md §11 has the retry, version and row-number contracts.
 */

export const IT_REVIEW_FIELDS = {
  tickets: ['title', 'category', 'priority', 'requester', 'channel', 'raisedOn', 'detail', 'itPerson'],
  jobs: ['title', 'kind', 'priority', 'technical', 'doer', 'dueOn', 'detail'],
} as const satisfies Record<ItImportKind, readonly string[]>;

/** Fields that name an IT person: the CEO picks a Prima account, sent and kept as its stable ID, never a name. */
export const IT_REVIEW_STAFF_FIELDS: readonly string[] = ['itPerson', 'doer'];

/** The heading Prima writes for each field; each is one T9 recognises (it-import.ts HEADINGS). */
const HEADING: Record<string, string> = {
  title: 'Title',
  category: 'About',
  priority: 'Urgency',
  requester: 'Requester',
  channel: 'Channel',
  raisedOn: 'Date raised',
  detail: 'Detail',
  itPerson: 'IT person',
  kind: 'Kind',
  technical: 'Technical',
  doer: 'Doer',
  dueOn: 'Due',
};

const FIELD_MAX: Record<string, number> = { title: 120, category: 30, priority: 10, requester: 80, channel: 20, raisedOn: 10, detail: 1000, itPerson: 80, kind: 20, technical: 5, doer: 80, dueOn: 10 };
/** How long a review stays open, and how long reviewed values are kept once it is closed (Fauzan, 31 Oct 2026). */
export const IT_REVIEW_OPEN_HOURS = 24;
export const IT_REVIEW_KEEP_DAYS = 30;
/** How long after the extraction its source may be admitted (the extraction preview's own expiry). */
export const IT_REVIEW_EXTRACTION_MINUTES = 15;
export const IT_REVIEW_MAX_PARTS = 10;
export const IT_REVIEW_MAX_SOURCE = 32_000;

/**
 * Where each value came from. `quoted`: the value is, word for word, the source text at the evidence offsets the
 * screen sent; that says only that the source contains it, not that it is true or that the AI was right. `typed`: the
 * CEO typed or changed it, or picked a person. `cleared`: the extraction proposed a value (it had evidence) and the CEO
 * emptied it.
 */
export interface ItReviewRow {
  rowId: string;
  fields: Record<string, string | null>;
  quoted: string[];
  typed: string[];
  cleared: string[];
}

export interface ItReviewPart {
  extractionId: string;
  sourceLabel: string;
  sourceSha256: string;
  admittedAt: string;
  rows: ItReviewRow[];
}

export interface ItReviewCounts {
  rows: number;
  quoted: number;
  typed: number;
  cleared: number;
}

/** What an import left out, as reason codes only: the full wording (which repeats row values) is not kept. */
export type ItReviewSkip = { row: number; reason: 'error' | 'duplicate' | 'left_out' };

export interface ItImportReview {
  id: string;
  actorId: string;
  kind: ItImportKind;
  parts: ItReviewPart[];
  /** Non-sensitive counts, kept after the values are cleared. */
  counts: ItReviewCounts;
  /** SHA-256 of the table text built from the parts; the approval must rebuild exactly this. */
  reviewedHash: string;
  /** The T9 preview the CEO last saw, saved with its version; approval must send exactly this token. */
  previewToken: string;
  status: 'reviewing' | 'committed' | 'abandoned' | 'expired';
  version: number;
  receipt: { created: string[]; skipped: ItReviewSkip[]; skipRows: number[] } | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  /** Set when the review closes; after it the reviewed values are cleared and only fingerprints and counts stay. */
  purgeAfter: string | null;
  purged: boolean;
  /** SHA-256 of the create request (kind and parts as sent), so a retry with the same request ID is recognised. */
  requestHash: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exactKeys = (x: unknown, keys: readonly string[], optional: readonly string[] = []): x is Record<string, unknown> =>
  isObj(x) && keys.every((k) => k in x) && Object.keys(x).every((k) => keys.includes(k) || optional.includes(k));
const ms = (iso: string) => Date.parse(iso);
const addMs = (iso: string, n: number) => new Date(ms(iso) + n).toISOString();
const ID = /^[0-9a-f-]{36}$/;

/** JSON with object keys sorted, so the same request always gives the same fingerprint. */
function stableJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableJson).join(',')}]`;
  if (isObj(x)) return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stableJson(x[k])}`).join(',')}}`;
  return JSON.stringify(x ?? null);
}

function csvCell(v: string | null): string {
  return `"${(v ?? '').replace(/"/g, '""')}"`;
}

/**
 * The table text T9 reads: a fixed heading row, then one row per reviewed row in part order, every cell quoted
 * (RFC 4180). Sheet row numbers therefore run from 2, across parts, in this order.
 */
export function renderItReview(kind: ItImportKind, parts: Pick<ItReviewPart, 'rows'>[]): string {
  const fields = IT_REVIEW_FIELDS[kind];
  const lines = [fields.map((f) => csvCell(HEADING[f])).join(',')];
  for (const p of parts) for (const r of p.rows) lines.push(fields.map((f) => csvCell(r.fields[f] ?? null)).join(','));
  return lines.join('\n');
}

export function itReviewHash(kind: ItImportKind, parts: Pick<ItReviewPart, 'rows'>[]): string {
  return sha256Hex(JSON.stringify(['it-review-v1', kind, renderItReview(kind, parts)]));
}

/** Where the rows came from, as T9 stores it on each item ("<source>, row N"). */
export function itReviewSource(id: string, parts: Pick<ItReviewPart, 'sourceLabel'>[]): string {
  const labels = [...new Set(parts.map((p) => p.sourceLabel))];
  const full = `Arisha review ${id.slice(0, 8)}: ${labels.join('; ')}`;
  return full.length <= 200 ? full : `Arisha review ${id.slice(0, 8)}: ${parts.length} sources`;
}

export function itReviewCounts(parts: Pick<ItReviewPart, 'rows'>[]): ItReviewCounts {
  const rows = parts.flatMap((p) => p.rows);
  return { rows: rows.length, quoted: rows.reduce((a, r) => a + r.quoted.length, 0), typed: rows.reduce((a, r) => a + r.typed.length, 0), cleared: rows.reduce((a, r) => a + r.cleared.length, 0) };
}

/** T9's wording for a left-out row repeats its values; keep only the kind of reason. */
function skipCode(why: string): ItReviewSkip['reason'] {
  if (why === 'Left out by the CEO.') return 'left_out';
  if (why.startsWith('Repeats ')) return 'duplicate';
  return 'error';
}

/** Close reviews left open past their time, and clear the values of closed reviews past their keeping time. */
export function tidyItReview(r: ItImportReview, now: string): Partial<ItImportReview> | null {
  if (r.status === 'reviewing' && ms(now) >= ms(r.expiresAt)) return { status: 'expired', updatedAt: now, purgeAfter: addMs(r.expiresAt, IT_REVIEW_KEEP_DAYS * 86_400_000) };
  if (r.status !== 'reviewing' && !r.purged && r.purgeAfter && ms(now) >= ms(r.purgeAfter)) return { parts: r.parts.map((p) => ({ ...p, rows: [] })), purged: true, updatedAt: now };
  return null;
}

/** The audit entry for an expiry or a clearing, by a request or by the daily job: metadata only. */
export function itReviewTidyAudit(c: { id: string; kind: string; outcome: 'expired' | 'purged' }, at: string, actor: string) {
  return {
    at,
    actor,
    companyId: null,
    action: `it.import.review.${c.outcome === 'expired' ? 'expire' : 'purge'}`,
    entity: 'it_import_review',
    entityId: c.id,
    summary: JSON.stringify({ kind: c.kind, outcome: c.outcome }),
  };
}

export class ItImportReviewService {
  constructor(
    private store: Store,
    private svc: PrimaService,
  ) {}

  /** What the database lacks for the handoff (none in memory). */
  async problems(): Promise<string[]> {
    return (await this.store.itImportProblems?.()) ?? [];
  }

  /** Only the CEO's own account, by ID and role, on every call; nothing about any review reaches anyone else. */
  private ceo(user: User) {
    if (arishaLeader(user) !== 'ceo') throw new AccessDenied('view', '(only the CEO imports IT work)');
  }

  private kindOf(raw: unknown): ItImportKind {
    if (raw !== 'tickets' && raw !== 'jobs') throw new BadRequest('Choose help requests or jobs.');
    return raw;
  }

  /** The extraction's own audited result: it must be the CEO's, successful, recent, and of the same source. */
  private async extraction(user: User, extractionId: string, kind: ItImportKind, sha: string) {
    const entries = (await this.store.list('audit', { entityId: extractionId } as never)) as AuditEntry[];
    const done = entries.find((e) => e.action === 'arisha.extraction.terminal' && e.entity === 'arisha_extraction' && e.actor === user.id);
    let facts: { sourceSha256?: string; kind?: string; outcome?: string } = {};
    try {
      facts = done ? JSON.parse(done.summary) : {};
    } catch {
      facts = {};
    }
    if (!done || facts.outcome !== 'success') throw new BadRequest('That Arisha extraction is not one of yours that finished. Run the extraction again.');
    if (facts.kind !== kind) throw new BadRequest('That extraction was for the other kind of IT work.');
    if (facts.sourceSha256 !== sha) throw new BadRequest('The source text is not the one Arisha read. Run the extraction again.');
    if (ms(this.svc.now()) - ms(done.at) > IT_REVIEW_EXTRACTION_MINUTES * 60_000)
      throw new BadRequest(`The extraction is more than ${IT_REVIEW_EXTRACTION_MINUTES} minutes old. Run it again to add its rows.`);
  }

  /** The IT staff a person field may name: IT Lead and IT Executives, not the IT Manager, not closed, by stable ID. */
  private async staff(): Promise<Map<string, User>> {
    const today = this.svc.today();
    const users = await this.store.list('users', {});
    return new Map(users.filter((u) => u.department === 'it' && u.itRole !== 'manager' && !u.integration && !accessClosed(u, today)).map((u) => [u.id, u]));
  }

  /** One field's value from the screen: text or empty, within its length, no control characters but lines in detail. */
  private value(f: string, v: unknown, where: string, staff: Map<string, User>): string | null {
    if (v !== null && typeof v !== 'string') throw new BadRequest(`${where}: ${f} must be text or empty.`);
    const value = v === null || v.trim() === '' ? null : v;
    if (value === null) return null;
    if (value.length > FIELD_MAX[f]) throw new BadRequest(`${where}: ${f} is longer than ${FIELD_MAX[f]} characters.`);
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value) || (f !== 'detail' && /[\n\t]/.test(value))) throw new BadRequest(`${where}: ${f} has a character Prima does not keep.`);
    if (IT_REVIEW_STAFF_FIELDS.includes(f) && !staff.has(value)) throw new BadRequest(`${where}: pick the ${f === 'doer' ? 'doer' : 'IT person'} from the IT staff list (the IT Lead or an active IT Executive).`);
    return value;
  }

  /** Admit a new part with its source text: rows are checked against the source, which is then dropped. */
  private async admit(user: User, kind: ItImportKind, raw: Record<string, unknown>, partNo: number, staff: Map<string, User>): Promise<ItReviewPart> {
    if (!exactKeys(raw, ['extractionId', 'source', 'rows'])) throw new BadRequest('A new part needs its extraction, source and rows.');
    const extractionId = raw.extractionId;
    if (typeof extractionId !== 'string' || !ID.test(extractionId)) throw new BadRequest('Unknown extraction.');
    const s = raw.source;
    if (!exactKeys(s, ['label', 'sha256', 'canonicalText'])) throw new BadRequest('The source needs its label, fingerprint and text.');
    const label = typeof s.label === 'string' ? s.label.trim() : '';
    if (label.length < 3 || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) throw new BadRequest('Give the source a label of 3 to 120 characters.');
    if (typeof s.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(s.sha256)) throw new BadRequest('Unknown source fingerprint.');
    const text = s.canonicalText;
    if (typeof text !== 'string' || !text || text.length > IT_REVIEW_MAX_SOURCE) throw new BadRequest('The source text is missing or too long.');
    if (sha256Hex(text) !== s.sha256) throw new BadRequest('The source text does not match its fingerprint.');
    await this.extraction(user, extractionId, kind, s.sha256);
    if (!Array.isArray(raw.rows) || !raw.rows.length) throw new BadRequest('A part needs at least one row.');
    const fields = IT_REVIEW_FIELDS[kind];
    const rows = raw.rows.map((r, i): ItReviewRow => {
      const where = `Part ${partNo}, row ${i + 1}`;
      if (!exactKeys(r, ['fields'], ['evidence']) || !exactKeys(r.fields, fields)) throw new BadRequest(`${where} must have exactly the ${kind === 'jobs' ? 'job' : 'help request'} fields.`);
      const ev = r.evidence;
      if (ev !== undefined && (!isObj(ev) || Object.keys(ev).some((k) => !(fields as readonly string[]).includes(k)))) throw new BadRequest(`${where} has evidence for an unknown field.`);
      const out: Record<string, string | null> = {};
      const quoted: string[] = [];
      const typed: string[] = [];
      const cleared: string[] = [];
      for (const f of fields) {
        const value = this.value(f, (r.fields as Record<string, unknown>)[f], where, staff);
        out[f] = value;
        const e = isObj(ev) ? ev[f] : undefined;
        let span: string | null = null;
        if (e !== undefined) {
          // Evidence must point inside the source; anything else is refused, not quietly treated as typed.
          if (!exactKeys(e, ['start', 'end']) || !Number.isInteger(e.start) || !Number.isInteger(e.end) || (e.start as number) < 0 || (e.end as number) <= (e.start as number) || (e.end as number) > text.length)
            throw new BadRequest(`${where}: the evidence for ${f} is outside the source.`);
          span = text.slice(e.start as number, e.end as number);
        }
        if (value === null) {
          if (span !== null) cleared.push(f);
        } else if (span !== null && span === value && !IT_REVIEW_STAFF_FIELDS.includes(f)) quoted.push(f);
        else typed.push(f);
      }
      return { rowId: `p${partNo}-r${i + 1}`, fields: out, quoted, typed, cleared };
    });
    return { extractionId, sourceLabel: label, sourceSha256: s.sha256, admittedAt: this.svc.now(), rows };
  }

  /**
   * Edit an admitted part without its source. A row that keeps its rowId keeps the labels of the values it keeps; a
   * changed value becomes typed, an emptied one cleared. A row left out is removed; a row with no rowId is new and typed.
   */
  private edit(kind: ItImportKind, prior: ItReviewPart, raw: Record<string, unknown>, partNo: number, staff: Map<string, User>): ItReviewPart {
    if (!exactKeys(raw, ['extractionId', 'rows'])) throw new BadRequest('An admitted part takes only its extraction and rows.');
    if (!Array.isArray(raw.rows) || !raw.rows.length) throw new BadRequest('A part needs at least one row. Remove the part instead.');
    const fields = IT_REVIEW_FIELDS[kind];
    const before = new Map(prior.rows.map((r) => [r.rowId, r]));
    const seen = new Set<string>();
    let fresh = Math.max(0, ...prior.rows.map((r) => Number(r.rowId.split('-r')[1]) || 0));
    const rows = raw.rows.map((r, i): ItReviewRow => {
      const where = `Part ${partNo}, row ${i + 1}`;
      if (!exactKeys(r, ['fields'], ['rowId']) || !exactKeys(r.fields, fields)) throw new BadRequest(`${where} must have exactly the ${kind === 'jobs' ? 'job' : 'help request'} fields.`);
      const old = r.rowId === undefined ? null : before.get(String(r.rowId));
      if (r.rowId !== undefined && !old) throw new BadRequest(`${where}: unknown row. Load the review again.`);
      if (old && seen.has(old.rowId)) throw new BadRequest(`${where}: the same row is in the review twice.`);
      if (old) seen.add(old.rowId);
      const out: Record<string, string | null> = {};
      const quoted: string[] = [];
      const typed: string[] = [];
      const cleared: string[] = [];
      for (const f of fields) {
        const value = this.value(f, (r.fields as Record<string, unknown>)[f], where, staff);
        out[f] = value;
        const was = old?.fields[f] ?? null;
        if (old && value === was) {
          if (old.quoted.includes(f)) quoted.push(f);
          if (old.typed.includes(f)) typed.push(f);
          if (old.cleared.includes(f)) cleared.push(f);
        } else if (value === null) {
          if (old && (was !== null || old.cleared.includes(f))) cleared.push(f);
        } else typed.push(f);
      }
      return { rowId: old?.rowId ?? `p${partNo}-r${++fresh}`, fields: out, quoted, typed, cleared };
    });
    return { ...prior, rows };
  }

  private async parts(user: User, kind: ItImportKind, raw: unknown, prior: ItReviewPart[]): Promise<ItReviewPart[]> {
    if (!Array.isArray(raw) || !raw.length || raw.length > IT_REVIEW_MAX_PARTS) throw new BadRequest(`Send 1 to ${IT_REVIEW_MAX_PARTS} parts.`);
    const staff = await this.staff();
    const parts: ItReviewPart[] = [];
    for (const [i, p] of raw.entries()) {
      if (!isObj(p)) throw new BadRequest('Unknown part.');
      const had = prior.find((x) => x.extractionId === p.extractionId);
      parts.push(had ? this.edit(kind, had, p, i + 1, staff) : await this.admit(user, kind, p, i + 1, staff));
    }
    const ids = parts.map((p) => p.extractionId);
    if (new Set(ids).size !== ids.length) throw new BadRequest('The same extraction is in the review twice.');
    const n = parts.reduce((a, p) => a + p.rows.length, 0);
    if (n > IT_IMPORT_MAX_ROWS) throw new BadRequest(`One batch takes at most ${IT_IMPORT_MAX_ROWS} rows. Split it.`);
    return parts;
  }

  private preview(user: User, r: Pick<ItImportReview, 'id' | 'kind' | 'parts'>): Promise<ItImportPreview> {
    return this.svc.itImportPreview(user, { kind: r.kind, text: renderItReview(r.kind, r.parts), source: itReviewSource(r.id, r.parts) });
  }

  /** Metadata only: never a value, a name or source text. */
  private async audit(tx: Store, user: User, r: ItImportReview, what: string) {
    await tx.audit({
      at: this.svc.now(),
      actor: user.name,
      companyId: null,
      action: `it.import.review.${what}`,
      entity: 'it_import_review',
      entityId: r.id,
      summary: JSON.stringify({
        kind: r.kind,
        version: r.version,
        ...r.counts,
        parts: r.parts.length,
        reviewed: r.reviewedHash.slice(0, 12),
        preview: r.previewToken.slice(0, 12),
        created: r.receipt?.created.length ?? null,
        skipped: r.receipt?.skipped.length ?? null,
      }),
    });
  }

  /**
   * Expire and clear. The database does it in one statement per review (prima.tidy_it_import_reviews), which also
   * runs from the daily job, so clean-up never depends on the CEO opening a review; the test store does it here.
   */
  private async tidy(tx: Store, user: User, onlyId?: string) {
    // In PostgreSQL the database function changes and audits in one step, so no clean-up goes unrecorded.
    if (tx.tidyItImportReviews) return void (await tx.tidyItImportReviews(user.name));
    const now = this.svc.now();
    const rows = onlyId ? [await tx.get('itImportReviews', onlyId)].filter((r): r is ItImportReview => !!r && r.actorId === user.id) : await tx.list('itImportReviews', { actorId: user.id });
    for (const r of rows) {
      const patch = tidyItReview(r, now);
      if (!patch) continue;
      await tx.update('itImportReviews', r.id, patch);
      await tx.audit(itReviewTidyAudit({ id: r.id, kind: r.kind, outcome: patch.status === 'expired' ? 'expired' : 'purged' }, now, user.name));
    }
  }

  private async held(tx: Store, user: User, id: unknown, version: unknown): Promise<ItImportReview> {
    if (typeof id !== 'string' || !ID.test(id)) throw new NotFound('Review');
    await this.tidy(tx, user, id);
    await tx.lock?.('itImportReviews', id);
    const r = await tx.get('itImportReviews', id);
    if (!r || r.actorId !== user.id) throw new NotFound('Review');
    if (r.status === 'committed') return r;
    if (r.status !== 'reviewing') throw new ReviewConflict(`This review is ${r.status}. Start a new one.`);
    if (version !== r.version) throw new ReviewConflict('This review changed since you opened it. Load it again.');
    return r;
  }

  private view(r: ItImportReview, preview: ItImportPreview | null, replayed = false) {
    return { review: r, preview, stale: !!preview && preview.previewToken !== r.previewToken, replayed };
  }

  /** The approval receipt, the same on the first approval and on every retry: reason codes, never T9's text. */
  private receipt(r: ItImportReview, already: boolean) {
    return { reviewId: r.id, already, created: r.receipt!.created, skipped: r.receipt!.skipped, skipRows: r.receipt!.skipRows };
  }

  /**
   * Start a review. The screen picks a fresh request ID (a UUID) and sends it again on any retry: the review is stored
   * under that ID, so a lost answer is recovered by sending the same request again (or reading GET /reviews/:requestId),
   * and never makes a second review. The same ID with a different request is refused.
   */
  async create(user: User, body: unknown) {
    this.ceo(user);
    if (!exactKeys(body, ['requestId', 'kind', 'parts'])) throw new BadRequest('Send the request ID, the kind and the parts.');
    const id = body.requestId;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new BadRequest('Send a new random request ID (UUID v4).');
    const kind = this.kindOf(body.kind);
    const requestHash = sha256Hex(stableJson({ kind, parts: body.parts }));
    return this.store.transaction(async (tx) => {
      await this.tidy(tx, user);
      await tx.lock?.('itImportReviews', id);
      const prior = await tx.get('itImportReviews', id);
      if (prior) {
        if (prior.actorId !== user.id || prior.requestHash !== requestHash) throw new ReviewConflict('That request ID was already used for a different review. Start again with a new one.');
        return this.view(prior, prior.status === 'reviewing' ? await this.preview(user, prior) : null, true);
      }
      const parts = await this.parts(user, kind, body.parts, []);
      const now = this.svc.now();
      const p = await this.preview(user, { id, kind, parts });
      const r: ItImportReview = {
        id,
        actorId: user.id,
        kind,
        parts,
        counts: itReviewCounts(parts),
        reviewedHash: itReviewHash(kind, parts),
        previewToken: p.previewToken,
        status: 'reviewing',
        version: 1,
        receipt: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: addMs(now, IT_REVIEW_OPEN_HOURS * 3_600_000),
        purgeAfter: null,
        purged: false,
        requestHash,
      };
      await tx.insert('itImportReviews', r);
      await this.audit(tx, user, r, 'create');
      return this.view(r, p);
    });
  }

  /** Replace the reviewed rows: edit admitted parts (no source needed), remove parts, or admit another extraction. */
  async update(user: User, id: unknown, body: unknown) {
    this.ceo(user);
    if (!exactKeys(body, ['version', 'parts'])) throw new BadRequest('Send the version and the parts.');
    return this.store.transaction(async (tx) => {
      const r = await this.held(tx, user, id, body.version);
      if (r.status === 'committed') throw new ReviewConflict('This review is already imported. Start a new one.');
      const parts = await this.parts(user, r.kind, body.parts, r.parts);
      const p = await this.preview(user, { ...r, parts });
      const updated = await tx.update('itImportReviews', r.id, {
        parts,
        counts: itReviewCounts(parts),
        reviewedHash: itReviewHash(r.kind, parts),
        previewToken: p.previewToken,
        version: r.version + 1,
        updatedAt: this.svc.now(),
      });
      await this.audit(tx, user, updated, 'update');
      return this.view(updated, p);
    });
  }

  /**
   * Run the T9 preview again (Prima may have changed since: someone logged the same request by hand) and save its token
   * with a new version, in one step, so the approval that follows can use exactly what the CEO now sees. Unchanged
   * preview: nothing is written and the version stays.
   */
  async refresh(user: User, id: unknown, body: unknown) {
    this.ceo(user);
    if (!exactKeys(body, ['version'])) throw new BadRequest('Send the version.');
    return this.store.transaction(async (tx) => {
      const r = await this.held(tx, user, id, body.version);
      if (r.status === 'committed') throw new ReviewConflict('This review is already imported.');
      const p = await this.preview(user, r);
      if (p.previewToken === r.previewToken) return this.view(r, p);
      const updated = await tx.update('itImportReviews', r.id, { previewToken: p.previewToken, version: r.version + 1, updatedAt: this.svc.now() });
      await this.audit(tx, user, updated, 'refresh');
      return this.view(updated, p);
    });
  }

  /** Read a review; `stale` says the saved preview no longer matches Prima, so refresh before approving. Only retention writes. */
  async get(user: User, id: unknown) {
    this.ceo(user);
    return this.store.transaction(async (tx) => {
      if (typeof id !== 'string' || !ID.test(id)) throw new NotFound('Review');
      await this.tidy(tx, user, id);
      const r = await tx.get('itImportReviews', id);
      if (!r || r.actorId !== user.id) throw new NotFound('Review');
      return this.view(r, r.status === 'reviewing' ? await this.preview(user, r) : null);
    });
  }

  /**
   * Approve the exact saved T9 preview of this review. The table text is rebuilt from the stored review, never from
   * the request, and must match the reviewed fingerprint; every person named is checked again by ID (still in IT, not
   * the IT Manager, not closed). The T9 batch ID is the review ID, so a retry after an uncertain answer returns the first
   * receipt; nothing is created twice. The whole request is one database transaction, so the review is marked
   * imported only together with the items.
   */
  async approve(user: User, id: unknown, body: unknown) {
    this.ceo(user);
    if (!exactKeys(body, ['version', 'previewToken', 'skipRows'])) throw new BadRequest('Send the version, the preview and the rows left out.');
    const skipRows = body.skipRows;
    if (!Array.isArray(skipRows) || skipRows.length > IT_IMPORT_MAX_ROWS + 1 || skipRows.some((n) => !Number.isInteger(n))) throw new BadRequest('Unknown rows left out.');
    if (typeof body.previewToken !== 'string' || !/^[0-9a-f]{64}$/.test(body.previewToken)) throw new BadRequest('Preview the batch again before approving it.');
    const skips = [...new Set(skipRows as number[])].sort((a, b) => a - b);
    return this.store.transaction(async (tx) => {
      const r = await this.held(tx, user, id, body.version);
      if (r.status === 'committed') {
        const same = r.previewToken === body.previewToken && r.receipt && r.receipt.skipRows.join(',') === skips.join(',');
        if (!same) throw new ReviewConflict('This review was already imported with a different preview or rows left out. Nothing was added.');
        return this.receipt(r, true);
      }
      if (itReviewHash(r.kind, r.parts) !== r.reviewedHash) throw new ReviewConflict('The stored review does not match what was reviewed. Nothing was added.');
      if (r.previewToken !== body.previewToken) throw new ReviewConflict('This is not the latest saved preview of the review. Refresh it and check the rows again.');
      const staff = await this.staff();
      const gone = r.parts
        .flatMap((p) => p.rows)
        .map((row, i) => ({ row: i + 2, ids: IT_REVIEW_STAFF_FIELDS.map((f) => row.fields[f]).filter((v): v is string => !!v) }))
        .filter((x) => x.ids.some((v) => !staff.has(v)));
      if (gone.length) throw new ReviewConflict(`Row ${gone.map((g) => g.row).join(', ')} names someone who can no longer be given IT work. Pick again.`);
      const out = await this.svc.itImportApprove(user, {
        kind: r.kind,
        text: renderItReview(r.kind, r.parts),
        source: itReviewSource(r.id, r.parts),
        batchId: r.id,
        previewToken: body.previewToken as string,
        skipRows: skips,
      });
      const now = this.svc.now();
      const skipped = out.skipped.map((s) => ({ row: s.row, reason: skipCode(s.why) }));
      const done = await tx.update('itImportReviews', r.id, {
        status: 'committed',
        version: r.version + 1,
        receipt: { created: out.created, skipped, skipRows: skips },
        updatedAt: now,
        purgeAfter: addMs(now, IT_REVIEW_KEEP_DAYS * 86_400_000),
      });
      await this.audit(tx, user, done, 'commit');
      // The same receipt as any retry returns. T9's full reasons were on the preview the CEO approved.
      return this.receipt(done, out.already);
    });
  }

  async abandon(user: User, id: unknown, body: unknown) {
    this.ceo(user);
    if (!exactKeys(body, ['version'])) throw new BadRequest('Send the version.');
    return this.store.transaction(async (tx) => {
      const r = await this.held(tx, user, id, body.version);
      if (r.status === 'committed') throw new ReviewConflict('This review is already imported. Fix any item on the IT screens, one by one.');
      const now = this.svc.now();
      const closed = await tx.update('itImportReviews', r.id, { status: 'abandoned', version: r.version + 1, updatedAt: now, purgeAfter: addMs(now, IT_REVIEW_KEEP_DAYS * 86_400_000) });
      await this.audit(tx, user, closed, 'abandon');
      return this.view(closed, null);
    });
  }
}
