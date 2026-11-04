import type { LedgerReadiness } from './ledger';

/** One recipient as Outlook shows it. */
export interface EmailAddress { name: string; address: string }
/** The copy Prima keeps of ONE email a staff member chose to attach. Plain text; no files or inline images. */
export interface EmailSnapshot {
  subject: string;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  sentAt: string | null;
  receivedAt: string | null;
  body: string;
  bodyTruncated: boolean;
  hasAttachments: boolean;
  webLink: string;
  internetMessageId: string;
}
export interface JobEmailEvent { at: string; by: string; action: 'attached' | 'removed' | 'expired' }
/**
 * One attached email. `snapshot` becomes null when the person removes it or when the 30-day keep period ends;
 * the stub (who, when, Outlook link) stays so the job still shows that an email was attached.
 */
export interface JobEmailRecord {
  id: string;
  jobId: string;
  attachedBy: string;
  attachedByName: string;
  attachedByTenantId: string;
  attachedByOid: string;
  attachedAt: string;
  expiresAt: string;
  removedAt: string | null;
  canonicalMessageId: string;
  internetMessageId: string;
  webLink: string;
  snapshotHash: string;
  snapshot: EmailSnapshot | null;
  events: JobEmailEvent[];
}

/**
 * Storage, always scoped to (signed-in user, job the API has authorised). `remove` succeeds only for the person
 * who attached it and only once. `insert` reports a duplicate when the same email is already attached to the job.
 */
export interface JobEmailStore {
  readiness(): Promise<LedgerReadiness>;
  insert(userId: string, record: JobEmailRecord): Promise<'ok' | 'duplicate'>;
  list(userId: string, jobId: string, limit: number): Promise<JobEmailRecord[]>;
  get(userId: string, jobId: string, id: string): Promise<JobEmailRecord | null>;
  remove(userId: string, jobId: string, id: string, next: JobEmailRecord): Promise<JobEmailRecord | null>;
}

/** Process memory only: fine for tests and demo; the module stays NotConfigured on it. */
export class MemoryJobEmailStore implements JobEmailStore {
  private readonly rows = new Map<string, JobEmailRecord>();
  constructor(private readonly trustedForTests = false) {}
  async readiness(): Promise<LedgerReadiness> {
    return this.trustedForTests ? { ready: true } : { ready: false, reason: 'In-memory store is not durable.' };
  }
  async insert(userId: string, record: JobEmailRecord) {
    if (record.attachedBy !== userId) throw new Error('Owner mismatch.');
    if ([...this.rows.values()].some(r => r.jobId === record.jobId && r.attachedByTenantId === record.attachedByTenantId && r.attachedByOid === record.attachedByOid && r.canonicalMessageId === record.canonicalMessageId && !r.removedAt)) return 'duplicate';
    this.rows.set(record.id, structuredClone(record));
    return 'ok';
  }
  async list(_userId: string, jobId: string, limit: number) {
    return [...this.rows.values()].filter(r => r.jobId === jobId).sort((a, b) => b.attachedAt.localeCompare(a.attachedAt)).slice(0, limit).map(r => structuredClone(r));
  }
  async get(_userId: string, jobId: string, id: string) {
    const r = this.rows.get(id);
    return r && r.jobId === jobId ? structuredClone(r) : null;
  }
  async remove(userId: string, jobId: string, id: string, next: JobEmailRecord) {
    const r = this.rows.get(id);
    if (!r || r.jobId !== jobId || r.attachedBy !== userId || r.removedAt || !next.removedAt || next.snapshot !== null) return null;
    this.rows.set(id, structuredClone(next));
    return structuredClone(next);
  }
  /** Test helper mirroring the privileged retention job. */
  expire(now: Date) {
    for (const r of this.rows.values()) if (r.snapshot && Date.parse(r.expiresAt) <= now.getTime()) {
      r.snapshot = null; r.events.push({ at: now.toISOString(), by: 'retention', action: 'expired' });
    }
  }
}
