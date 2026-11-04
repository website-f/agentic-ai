/** Pure request/recovery boundary for PR42 13c36ec. No HTTP or browser storage.
 * Production stays blocked: caller must durably save the owner-bound marker BEFORE POST.
 * Recovery is GET-only; never recreate an unknown request or persist source text here.
 */
export type PendingReview = Readonly<{ schema: 1; ownerId: 'u-fauzan'; requestId: string }>;
export type RecoveryPhase = 'prepared' | 'sending' | 'uncertain' | 'resolved';
const uuid4 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
function check(ok: unknown): asserts ok { if (!ok) throw Error('Review recovery requires the original owner and request ID.'); }
export function restorePendingReview(raw: unknown, ownerId: string): PendingReview {
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  const r = raw as Record<string, unknown>;
  check(Object.keys(r).sort().join(',') === 'ownerId,requestId,schema' && r.schema === 1 && r.ownerId === ownerId && ownerId === 'u-fauzan' && uuid4(r.requestId));
  return Object.freeze({ schema: 1, ownerId: 'u-fauzan', requestId: r.requestId });
}
/** Prepared JSON bytes are immutable. No automatic retries, fetches or source persistence. */
export class ReviewCreateRecovery {
  readonly marker: PendingReview;
  private phase: RecoveryPhase;
  private body: string | null;
  private persisted = false;
  constructor(marker: PendingReview, payload?: { kind: 'tickets' | 'jobs'; parts: unknown[] }) {
    this.marker = restorePendingReview(marker, marker.ownerId);
    this.phase = payload ? 'prepared' : 'uncertain';
    if (payload) {
      check(['tickets', 'jobs'].includes(payload.kind) && Array.isArray(payload.parts) && payload.parts.length === 1);
      const part = payload.parts[0] as { rows?: unknown[] } | null;
      check(part && Array.isArray(part.rows) && part.rows.length > 0 && part.rows.length <= 20);
      this.body = JSON.stringify({ requestId: marker.requestId, kind: payload.kind, parts: payload.parts });
    } else this.body = null;
  }
  get status() { return this.phase; }
  /** Host must call only after its durable write succeeds; this class does not prove persistence. */
  confirmMarkerSaved(saved: unknown, ownerId: string) {
    const r = restorePendingReview(saved, ownerId); check(r.requestId === this.marker.requestId);
    this.persisted = true;
  }
  takeCreate(ownerId: string) {
    check(ownerId === this.marker.ownerId && this.persisted && this.phase === 'prepared' && this.body !== null);
    this.phase = 'sending';
    const body = this.body; this.body = null;
    return { method: 'POST' as const, path: '/api/arisha/it-import/reviews', body };
  }
  lostResponse() { check(this.phase === 'sending'); this.phase = 'uncertain'; this.body = null; }
  recoveryRead(ownerId: string) {
    check(ownerId === this.marker.ownerId && this.phase === 'uncertain');
    return { method: 'GET' as const, path: `/api/arisha/it-import/reviews/${this.marker.requestId}` };
  }
  /** Call only after full response decoding; a not-found/denied/network response NEVER resolves the guard. */
  acceptDecodedReview(review: { id: string; canWrite: false }, ownerId: string) {
    check(ownerId === this.marker.ownerId && review.id === this.marker.requestId && review.canWrite === false && ['sending', 'uncertain'].includes(this.phase));
    this.phase = 'resolved'; this.body = null;
  }
}
