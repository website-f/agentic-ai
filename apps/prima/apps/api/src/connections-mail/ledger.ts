import { ConflictException } from '@nestjs/common';

export type EmailDraftState = 'Draft' | 'Sending' | 'Accepted' | 'Failed' | 'Uncertain' | 'Discarded';
export interface EmailContent { to: string[]; cc: string[]; subject: string; body: string }
export interface EmailEvent {
  at: string;
  action: 'created' | 'edited' | 'rebound' | 'send-pressed' | 'accepted' | 'failed' | 'throttled' | 'uncertain' | 'confirmed-in-sent-items' | 'reported-not-in-sent-items' | 'discarded';
}
export interface EmailDraft extends EmailContent {
  id: string;
  ownerUserId: string;
  /** The Microsoft identity the draft was written and reviewed under. Send refuses any other identity. */
  ownerTenantId: string;
  ownerOid: string;
  state: EmailDraftState;
  /** sha256 over the sender identity and the content; Send must quote the hash the user reviewed. */
  contentHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Set after a 429: Send is refused until then. */
  retryNotBefore?: string;
  /** Metadata only: no content, recipients or provider bodies in the event trail. */
  events: EmailEvent[];
}

/**
 * Persistence boundary, always scoped to the owner. `transition` is an atomic compare-and-set on `version` and
 * returns null when another request, worker or replica changed the draft first. Only a durable, shared ledger may
 * back a live Send: otherwise a restart or a second replica could forget a Sending or Uncertain state and send twice.
 */
export type LedgerReadiness = { ready: true } | { ready: false; reason: string };
export interface StaffEmailLedger {
  /**
   * Whether this ledger may back a live Send right now. A durable flag is not enough: the PostgreSQL ledger checks
   * the migrated table, its version marker, row-level security and the API role's exact privileges every time.
   */
  readiness(): Promise<LedgerReadiness>;
  create(draft: EmailDraft): Promise<void>;
  get(ownerUserId: string, id: string): Promise<EmailDraft | null>;
  /** Newest first, excluding Discarded, at most `limit`. */
  list(ownerUserId: string, limit: number): Promise<EmailDraft[]>;
  transition(ownerUserId: string, id: string, expectedVersion: number, next: EmailDraft): Promise<EmailDraft | null>;
}

/** Process memory only. Fine for tests and demo; Mail stays NotConfigured on it. */
export class MemoryEmailLedger implements StaffEmailLedger {
  private readonly rows = new Map<string, EmailDraft>();
  /** `trustedForTests` lets unit tests exercise Send logic; production never passes it. */
  constructor(private readonly trustedForTests = false) {}
  async readiness(): Promise<LedgerReadiness> {
    return this.trustedForTests ? { ready: true } : { ready: false, reason: 'In-memory ledger is not durable.' };
  }
  async create(draft: EmailDraft) {
    if (this.rows.has(draft.id)) throw new ConflictException('Draft already exists.');
    this.rows.set(draft.id, structuredClone(draft));
  }
  async get(owner: string, id: string) {
    const row = this.rows.get(id);
    return row && row.ownerUserId === owner ? structuredClone(row) : null;
  }
  async list(owner: string, limit: number) {
    return [...this.rows.values()].filter(r => r.ownerUserId === owner && r.state !== 'Discarded')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map(r => structuredClone(r));
  }
  async transition(owner: string, id: string, expectedVersion: number, next: EmailDraft) {
    const row = this.rows.get(id);
    if (!row || row.ownerUserId !== owner || next.ownerUserId !== owner || next.id !== id || row.version !== expectedVersion || next.version !== expectedVersion + 1) return null;
    this.rows.set(id, structuredClone(next));
    return structuredClone(next);
  }
}
