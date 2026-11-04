import type { ExtractionPreview } from '../api/it-extraction';
import type { ImportReviewClient, ReviewCapability, ReviewPerson, ReviewRow, ReviewSnapshot, ReviewReceipt } from '../api/it-import-review';
export interface ReviewActor { id: string; opsTier?: string; integration?: boolean | string }
export interface ImportReviewState {
  capability: ReviewCapability | null; directory: ReviewPerson[]; rows: ReviewRow[];
  extraction: ExtractionPreview | null; snapshot: ReviewSnapshot | null;
  phase: 'idle' | 'editing' | 'loading' | 'previewing' | 'review' | 'approving' | 'uncertain' | 'done' | 'closed';
  pendingReviewId: string | null; skipRows: number[]; receipt: ReviewReceipt | null; message: string | null;
}
export class ImportReviewSession {
  private state: ImportReviewState = { capability: null, directory: [], rows: [], extraction: null, snapshot: null, phase: 'idle', pendingReviewId: null, skipRows: [], receipt: null, message: null };
  private reviewId: string | null = null;
  private listeners = new Set<() => void>(); private generation = 0; private disposed = false;
  constructor(private client: ImportReviewClient, readonly actor: ReviewActor, private now = () => Date.now()) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<ImportReviewState>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  activate() { this.disposed = false; }
  private exactCEO() { return this.actor.id === 'u-fauzan' && this.actor.opsTier === 'ceo' && !this.actor.integration; }
  ready() { const c = this.state.capability; return this.exactCEO() && !!c?.enabled && c.permitted && c.resumable && c.immutableEvidence && c.maxProposals === 20; }
  locked() { return ['loading', 'previewing', 'approving', 'uncertain', 'done', 'closed'].includes(this.state.phase); }
  async load() {
    if (this.disposed || this.locked()) return;
    const gen = ++this.generation; this.set({ phase: 'loading', capability: null, directory: [], snapshot: null, message: null });
    try {
      if (!this.exactCEO()) throw Error('permission');
      const [capability, people] = await Promise.all([this.client.capability(), this.client.directory()]);
      if (gen !== this.generation) return;
      const counts = new Map<string, number>(); people.forEach(p => counts.set(p.id, (counts.get(p.id) ?? 0) + 1));
      // Preserve exact authorized directory labels. Never fuzzy-match a name, use seed identities, or grant eligibility here.
      const directory = people.filter(p => p.id && p.name && counts.get(p.id) === 1 && ['lead', 'executive'].includes(p.itRole ?? ''));
      const pendingId = await this.client.pendingReviewId?.();
      if (gen !== this.generation) return;
      this.set({ capability, directory, pendingReviewId: pendingId ?? null, phase: pendingId ? 'uncertain' : this.state.extraction ? 'editing' : 'idle',
        message: pendingId ? `Recover pending review ${pendingId} before creating or approving another batch.` : null });
    } catch { if (gen === this.generation) this.set({ phase: 'idle', message: 'Authorized staff or readiness could not be loaded. Approval is disabled.' }); }
  }
  handoff(extraction: ExtractionPreview, edits: Record<string, string> = {}) {
    if (this.disposed || this.locked() || !this.exactCEO()) return;
    if (extraction.operationalWrites !== 0 || extraction.readyForT9Preview !== false || !extraction.rows.length || extraction.rows.length > 20 || !Number.isFinite(Date.parse(extraction.expiresAt)) || Date.parse(extraction.expiresAt) <= this.now()) {
      this.set({ message: 'This extraction is expired or unsupported. No review was created.' }); return;
    }
    ++this.generation; this.reviewId = null;
    const rows = extraction.rows.map(r => ({ row: r.row, errors: [...r.errors], warnings: [...r.warnings], fields: Object.fromEntries(Object.entries(r.fields).map(([k, evidence]) => [k, { value: edits[`${r.row}:${k}`] ?? evidence.raw ?? '', evidence: { ...evidence }, edited: Object.hasOwn(edits, `${r.row}:${k}`) }])) }));
    this.set({ extraction: structuredClone(extraction), rows, phase: 'editing', snapshot: null, skipRows: [], receipt: null, message: 'Local review only. Nothing has been saved or imported.' });
  }
  edit(row: number, field: string, value: string) {
    if (this.locked() || !this.state.rows.some(r => r.row === row && Object.hasOwn(r.fields, field))) return;
    ++this.generation;
    this.set({ rows: this.state.rows.map(r => r.row !== row ? r : { ...r, fields: { ...r.fields, [field]: { ...r.fields[field], value, edited: true, support: value ? 'human-entered' as const : 'cleared' as const } } }), snapshot: null, phase: 'editing', skipRows: [], message: 'Edited by you; a new server preview is required.' });
  }
  selectStaff(row: number, field: string, id: string) {
    if (!['doer', 'itPerson'].includes(field) || (id !== '' && !this.state.directory.some(p => p.id === id)) || (id === '' && field !== 'itPerson')) return;
    this.edit(row, field, id);
  }
  skip(row: number, value: boolean) {
    if (this.state.phase !== 'review' || !this.state.snapshot?.rows.some(r => r.row === row)) return;
    this.set({ skipRows: value ? [...new Set([...this.state.skipRows, row])] : this.state.skipRows.filter(n => n !== row) });
  }
  async preview() {
    const s = this.state;
    if (this.disposed || this.locked() || !this.ready()) return;
    if (!this.reviewId && (!s.extraction || Date.parse(s.extraction.expiresAt) <= this.now())) return;
    const gen = ++this.generation; this.set({ phase: 'previewing', snapshot: null, message: null });
    try {
      const snapshot = this.reviewId && this.client.updateSaved
        ? await this.client.updateSaved(structuredClone(s.rows))
        : await this.client.preview({ extraction: structuredClone(s.extraction!), rows: structuredClone(s.rows) });
      if (gen !== this.generation) return;
      if (!this.valid(snapshot) || snapshot.status !== 'review') throw Error('invalid');
      this.reviewId = snapshot.id;
      this.set({ snapshot, pendingReviewId: snapshot.id, rows: structuredClone(snapshot.rows), phase: 'review', skipRows: [] });
    } catch {
      let pendingId = this.state.pendingReviewId;
      try { pendingId = await this.client.pendingReviewId?.() ?? pendingId; } catch { /* Preserve uncertainty if storage/auth is unavailable. */ }
      if (gen === this.generation) this.set({ phase: 'uncertain', pendingReviewId: pendingId, message: 'Review creation could have reached the server. Do not create another batch. Reconcile the saved review before continuing.' });
    }
  }
  private staffValid(rows: ReviewRow[]) {
    const eligible = this.state.capability?.eligibleStaffIds ?? [];
    return rows.every(r => Object.entries(r.fields).every(([key, f]) => !['doer', 'itPerson'].includes(key) || (key === 'itPerson' && !f.value) || (eligible.includes(f.value) && this.state.directory.some(p => p.id === f.value))));
  }
  private valid(s: ReviewSnapshot) { return !!s.id && Number.isInteger(s.version) && s.version > 0 && !!s.previewToken && Number.isFinite(Date.parse(s.expiresAt)) && Date.parse(s.expiresAt) > this.now() && s.rows.length > 0 && s.rows.length <= 20; }
  canApprove() {
    const s = this.state;
    return this.ready() && s.phase === 'review' && !!s.snapshot && this.valid(s.snapshot) && s.snapshot.status === 'review' && !s.snapshot.errors.length && this.staffValid(s.snapshot.rows.filter(r => !s.skipRows.includes(r.row))) && s.snapshot.rows.some(r => !r.errors.length && !s.skipRows.includes(r.row));
  }
  async refresh() {
    if (!this.ready() || !this.client.refresh || this.state.phase !== 'review') return;
    const gen = ++this.generation; this.set({ phase: 'loading', message: null });
    try {
      const snapshot = await this.client.refresh();
      if (gen !== this.generation) return;
      if (!this.valid(snapshot) || snapshot.id !== this.state.snapshot?.id) throw Error('invalid');
      this.set({ snapshot, rows: structuredClone(snapshot.rows), phase: 'review', skipRows: [], message: 'Preview refreshed. Review all rows and approve separately.' });
    } catch { if (gen === this.generation) this.set({ phase: 'uncertain', message: 'Refresh outcome unknown. Recover the same saved review.' }); }
  }
  async approve() {
    if (!this.canApprove()) return;
    const snapshot = this.state.snapshot!; const skipRows = [...this.state.skipRows]; const gen = ++this.generation;
    this.set({ phase: 'approving', message: null });
    try {
      const receipt = await this.client.approve({ id: snapshot.id, version: snapshot.version, previewToken: snapshot.previewToken, skipRows });
      if (gen === this.generation) this.set({ phase: 'done', receipt, message: 'Server receipt received.' });
    } catch { if (gen === this.generation) this.set({ phase: 'uncertain', message: 'Approval outcome is unknown. Do not retry or create a new batch. Check the same review for its receipt.' }); }
  }
  async resume(id: string) {
    if (this.disposed || !this.ready() || ['loading', 'previewing', 'approving'].includes(this.state.phase) || !id.trim()) return;
    if (this.state.phase === 'uncertain' && this.state.snapshot && this.state.snapshot.id !== id) return;
    const gen = ++this.generation; this.set({ phase: 'loading', pendingReviewId: this.state.pendingReviewId ?? id, message: null });
    try {
      const snapshot = await this.client.resume(id);
      if (gen !== this.generation) return;
      if (snapshot.id !== id) throw Error('invalid');
      this.reviewId = id;
      // Expiry prevents writes, not retrieval of an already-issued receipt.
      if (snapshot.status === 'approved' && snapshot.receipt && Array.isArray(snapshot.receipt.created) && Array.isArray(snapshot.receipt.skipped)) this.set({ snapshot, phase: 'done', receipt: snapshot.receipt });
      else if (snapshot.status === 'review' && this.valid(snapshot)) this.set({ snapshot, rows: structuredClone(snapshot.rows), phase: 'review', skipRows: [], receipt: null });
      else if (snapshot.status === 'expired' || snapshot.status === 'abandoned') this.set({ snapshot, rows: [], phase: 'closed', receipt: null, message: `Saved review is ${snapshot.status}. It cannot be approved. Starting another requires confirmation of this closed state.` });
      else throw Error('inactive');
    } catch { if (gen === this.generation) this.set({ phase: 'uncertain', message: 'Cannot verify this saved review. Approval remains blocked; contact the release owner with its review ID.' }); }
  }
  cancel() {
    // Closing/back cannot undo an approval request or erase an uncertain outcome.
    if (['previewing', 'approving', 'uncertain', 'done', 'closed'].includes(this.state.phase)) return false;
    if (this.reviewId && this.client.pendingReviewId) { this.set({ phase: 'uncertain', message: `Saved review ${this.reviewId} remains open. Recover it before admitting another source.` }); return false; }
    ++this.generation; this.set({ extraction: null, rows: [], snapshot: null, skipRows: [], receipt: null, phase: 'idle', message: 'Local review cleared. This does not delete server reviews or imported records.' }); return true;
  }
  async startAnother() {
    if (!((this.state.phase === 'done' && this.state.receipt) || this.state.phase === 'closed')) return false;
    const priorPhase = this.state.phase;
    if (this.client.finishConfirmed) {
      const gen = ++this.generation; this.set({ phase: 'loading', message: null });
      try { await this.client.finishConfirmed(); if (gen !== this.generation) return false; this.set({ phase: priorPhase }); }
      catch { if (gen === this.generation) this.set({ phase: 'uncertain', message: 'Cannot retire the confirmed review marker. Recover the original review before starting another.' }); return false; }
    }
    return this.startNew();
  }
  startNew() {
    if (!((this.state.phase === 'done' && this.state.receipt) || (this.state.phase === 'closed' && ['expired', 'abandoned'].includes(this.state.snapshot?.status ?? '')))) return false;
    ++this.generation; this.reviewId = null;
    this.set({ extraction: null, rows: [], snapshot: null, skipRows: [], receipt: null, pendingReviewId: null, phase: 'idle', message: 'Previous review outcome confirmed. A new review requires a new explicit approval.' });
    return true;
  }
  dispose() { this.reviewId = null; ++this.generation; this.state = { ...this.state, extraction: null, rows: [], snapshot: null, receipt: null, skipRows: [], directory: [], capability: null }; this.disposed = true; this.listeners.clear(); }
}
