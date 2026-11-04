import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { VerifiedEntraAssertion } from '../auth';
import { delegatedApp, idList, linkedIdentity, onBehalfOf, TIMEOUT_MS, type DelegatedActor, type DelegatedApp } from './delegated';
import type { EmailContent, EmailDraft, EmailDraftState, EmailEvent, StaffEmailLedger } from './ledger';

export { MemoryEmailLedger, type EmailDraft, type StaffEmailLedger } from './ledger';

/**
 * Staff email: compose and review in Prima, then the staff member explicitly presses Send and Microsoft Graph
 * accepts it from THEIR OWN mailbox (delegated Mail.Send, on-behalf-of). Never AI-initiated, never automatic
 * replies, never inbox reading, no attachments in phase 1. Each draft is sent at most once: Send is a
 * compare-and-set on a durable ledger, and an uncertain provider outcome stays locked; only the sender finding it in Sent Items settles it.
 */
export const MAIL_SCOPE = 'https://graph.microsoft.com/Mail.Send';
const SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Explicit open-sending value for STAFF_EMAIL_RECIPIENT_DOMAINS; never implied by a missing setting. */
const ANY_DOMAIN = '*';
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_TO = 10;
const MAX_CC = 10;
const MAX_SUBJECT = 200;
const MAX_BODY = 20_000;
const MAX_LIST = 20;
/** A Send whose outcome could not be recorded is treated as uncertain after this long. */
const STUCK_SENDING_MS = 5 * 60_000;
/** 429 without a usable Retry-After waits this long; a longer request is capped. */
const DEFAULT_RETRY_MS = 60_000;
const LOCKED: readonly EmailDraftState[] = ['Sending', 'Accepted', 'Uncertain'];

interface StaffEmailConfiguration { app: DelegatedApp; allowedUserIds: string[]; recipientDomains: string[] }
/** The only Mail resource: the signed-in user's own mailbox, send only. */
export const OWN_MAILBOX = 'own-mailbox';
interface MailIdentity { serviceId: 'mail'; userId: string }
export interface StaffEmailStatus extends MailIdentity {
  status: 'NotConfigured' | 'ConfiguredNotVerified';
  canCompose: boolean;
  resources: { key: string; name: string }[];
  /** Empty only while NotConfigured; a configured module always has an explicit domain allowlist (or "*"). */
  recipientDomains: string[];
}
/** A token check only: Microsoft will act for this user with Mail.Send. It does not prove the mailbox can send. */
export interface StaffEmailCheck extends MailIdentity { status: 'VerifiedForCurrentUser'; resourceKey: string; checkedAt: string; proves: 'DelegatedTokenOnly' }
/** What the screen gets: never the identity binding, event trail or provider details. */
export interface DraftView extends MailIdentity, EmailContent {
  id: string;
  state: EmailDraftState;
  contentHash: string;
  updatedAt: string;
  retryNotBefore: string | null;
  /** False when the draft was written under another Microsoft account; Send is refused until it is saved again. */
  identityMatches: boolean;
}

/** Off unless every piece is valid. A missing allowlist never means "everyone". */
export function staffEmailConfiguration(env: NodeJS.ProcessEnv): StaffEmailConfiguration | null {
  if (env.STAFF_EMAIL_ENABLED !== 'true') return null;
  const app = delegatedApp(env, 'STAFF_EMAIL_OBO_CLIENT_SECRET');
  if (!app) return null;
  const users = (env.STAFF_EMAIL_ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!idList(users)) return null;
  // Recipients fail closed like senders: no list means NotConfigured. Each outside domain staff may write to
  // (clients, auditors, regulators) is listed by name. Open sending needs the explicit value "*" on its own.
  const recipientDomains = (env.STAFF_EMAIL_RECIPIENT_DOMAINS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const open = recipientDomains.length === 1 && recipientDomains[0] === ANY_DOMAIN;
  if (!open && (!recipientDomains.length || recipientDomains.length > 50 || recipientDomains.some(d => d.length > 253 || !DOMAIN.test(d)) || new Set(recipientDomains).size !== recipientDomains.length)) return null;
  return { app, allowedUserIds: users, recipientDomains };
}

function contentHash(owner: Pick<EmailDraft, 'ownerUserId' | 'ownerTenantId' | 'ownerOid'>, c: EmailContent): string {
  return createHash('sha256').update(JSON.stringify([owner.ownerUserId, owner.ownerTenantId.toLowerCase(), owner.ownerOid.toLowerCase(), c.to, c.cc, c.subject, c.body])).digest('hex');
}
function boundTo(draft: EmailDraft, identity: VerifiedEntraAssertion): boolean {
  return draft.ownerUserId === identity.userId && draft.ownerTenantId.toLowerCase() === identity.tenantId.toLowerCase() && draft.ownerOid.toLowerCase() === identity.oid.toLowerCase();
}
/**
 * Seconds or an HTTP date, per RFC 9110. A valid value is honoured in full, however long (never shortened); only a
 * missing or unparseable header falls back to the default wait. The person can still start a new draft meanwhile.
 */
export function retryAfterMs(header: string | null, now: Date): number {
  const value = header?.trim() ?? '';
  if (/^\d{1,10}$/.test(value)) return Math.max(1000, Number(value) * 1000);
  // IMF-fixdate only (e.g. "Sat, 31 Oct 2026 09:00:00 GMT"); a bare number like "-5" is not a date.
  const at = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? Date.parse(value) : NaN;
  if (Number.isFinite(at)) return Math.max(1000, at - now.getTime());
  return DEFAULT_RETRY_MS;
}

export class StaffEmail {
  constructor(
    private readonly ledger: StaffEmailLedger,
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly http: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Mail stays NotConfigured unless the settings are complete AND the ledger passes its readiness gate on this call
   * (migrated version, columns, RLS, policy, privileges). A failed or unreachable check is never cached as ready.
   */
  private async config(): Promise<StaffEmailConfiguration | null> {
    const cfg = staffEmailConfiguration(this.env());
    if (!cfg) return null;
    const ready = await this.ledger.readiness().catch(() => ({ ready: false as const, reason: 'Ledger readiness failed.' }));
    return ready.ready ? cfg : null;
  }

  async status(actor: DelegatedActor): Promise<StaffEmailStatus> {
    const cfg = await this.config();
    const identity = { serviceId: 'mail' as const, userId: actor.user.id };
    if (!cfg) return { ...identity, status: 'NotConfigured', canCompose: false, resources: [], recipientDomains: [] };
    const canCompose = !actor.user.integration && cfg.allowedUserIds.includes(actor.user.id);
    return { ...identity, status: 'ConfiguredNotVerified', canCompose, resources: canCompose ? [{ key: OWN_MAILBOX, name: 'Your own mailbox (send only)' }] : [], recipientDomains: cfg.recipientDomains };
  }

  /** Every Mail action needs the allowlist AND the request's own verified Microsoft identity. */
  private async allowed(actor: DelegatedActor) {
    const cfg = await this.config();
    if (!cfg) throw new ServiceUnavailableException('Staff email is not configured.');
    if (actor.user.integration || !cfg.allowedUserIds.includes(actor.user.id)) throw new ForbiddenException('Staff email is not available to this user.');
    const identity = linkedIdentity(actor, cfg.app, 'Sign in with your linked Microsoft account to use email.');
    return { cfg, identity };
  }
  private unavailable(): never { throw new ServiceUnavailableException('Your mailbox could not be reached. Nothing was sent.'); }

  private view(draft: EmailDraft, identity: VerifiedEntraAssertion): DraftView {
    return { serviceId: 'mail', userId: draft.ownerUserId, id: draft.id, state: draft.state, to: [...draft.to], cc: [...draft.cc], subject: draft.subject, body: draft.body,
      contentHash: draft.contentHash, updatedAt: draft.updatedAt, retryNotBefore: draft.retryNotBefore ?? null, identityMatches: boundTo(draft, identity) };
  }

  async check(actor: DelegatedActor, resourceKey: string): Promise<StaffEmailCheck> {
    const { cfg, identity } = await this.allowed(actor);
    if (resourceKey !== OWN_MAILBOX) throw new ForbiddenException('Only your own mailbox can be checked.');
    await onBehalfOf(this.http, cfg.app, identity, MAIL_SCOPE, () => this.unavailable());
    return { serviceId: 'mail', userId: actor.user.id, status: 'VerifiedForCurrentUser', resourceKey, checkedAt: this.clock().toISOString(), proves: 'DelegatedTokenOnly' };
  }

  private content(input: unknown, cfg: StaffEmailConfiguration): EmailContent {
    const bad = (why: string): never => { throw new BadRequestException(why); };
    if (!input || typeof input !== 'object' || Array.isArray(input)) bad('Send to, cc, subject and body only.');
    const raw = input as Record<string, unknown>;
    if (Object.keys(raw).some(k => !['to', 'cc', 'subject', 'body'].includes(k))) bad('Only to, cc, subject and body are supported. Attachments, bcc and HTML are not.');
    const list = (value: unknown, max: number, name: string): string[] => {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string')) bad(`Up to ${max} ${name} addresses.`);
      const out = (value as string[]).map(v => v.trim());
      for (const address of out) {
        if (address.length > 254 || !EMAIL.test(address)) bad('One of the email addresses is not valid.');
        const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
        if (cfg.recipientDomains[0] !== ANY_DOMAIN && !cfg.recipientDomains.includes(domain)) bad(`Email can only go to approved domains: ${cfg.recipientDomains.join(', ')}.`);
      }
      return out;
    };
    const to = list(raw.to, MAX_TO, 'To');
    const cc = list(raw.cc, MAX_CC, 'Cc');
    const all = [...to, ...cc].map(a => a.toLowerCase());
    if (!to.length) bad('Add at least one To address.');
    if (new Set(all).size !== all.length) bad('Each address may appear only once.');
    if (typeof raw.subject !== 'string' || !raw.subject.trim() || raw.subject.length > MAX_SUBJECT || /[\u0000-\u001f\u007f]/.test(raw.subject)) bad(`Subject is required, one line, up to ${MAX_SUBJECT} characters.`);
    if (typeof raw.body !== 'string' || !raw.body.trim() || raw.body.length > MAX_BODY || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw.body)) bad(`Body is required, plain text, up to ${MAX_BODY} characters.`);
    return { to, cc, subject: (raw.subject as string).trim(), body: raw.body as string };
  }

  private async own(actor: DelegatedActor, id: string): Promise<EmailDraft> {
    const draft = DRAFT_ID.test(id) ? await this.ledger.get(actor.user.id, id) : null;
    if (!draft || draft.ownerUserId !== actor.user.id) throw new ForbiddenException('This draft is not available.');
    return draft;
  }
  private next(draft: EmailDraft, patch: Partial<EmailDraft>, action: EmailEvent['action']): EmailDraft {
    const at = this.clock().toISOString();
    return { ...draft, ...patch, version: draft.version + 1, updatedAt: at, events: [...draft.events, { at, action }] };
  }
  private async move(draft: EmailDraft, patch: Partial<EmailDraft>, action: EmailEvent['action']): Promise<EmailDraft> {
    const moved = await this.ledger.transition(draft.ownerUserId, draft.id, draft.version, this.next(draft, patch, action));
    if (!moved) throw new ConflictException('This draft changed in another window. Reload it before continuing.');
    return moved;
  }

  async create(actor: DelegatedActor, input: unknown): Promise<DraftView> {
    const { cfg, identity } = await this.allowed(actor);
    const content = this.content(input, cfg);
    const at = this.clock().toISOString();
    const owner = { ownerUserId: actor.user.id, ownerTenantId: identity.tenantId.toLowerCase(), ownerOid: identity.oid.toLowerCase() };
    const draft: EmailDraft = { id: randomUUID(), ...owner, state: 'Draft', ...content, contentHash: contentHash(owner, content), version: 1, createdAt: at, updatedAt: at, events: [{ at, action: 'created' }] };
    await this.ledger.create(draft);
    return this.view(draft, identity);
  }

  async get(actor: DelegatedActor, id: string): Promise<DraftView> {
    const { identity } = await this.allowed(actor);
    return this.view(await this.own(actor, id), identity);
  }

  /** Recovery after a reload, lost response or account switch: the signed-in user's own recent drafts. */
  async list(actor: DelegatedActor): Promise<{ serviceId: 'mail'; userId: string; drafts: DraftView[] }> {
    const { identity } = await this.allowed(actor);
    const drafts = (await this.ledger.list(actor.user.id, MAX_LIST)).filter(d => d.ownerUserId === actor.user.id);
    return { serviceId: 'mail', userId: actor.user.id, drafts: drafts.map(d => this.view(d, identity)) };
  }

  /** Saving again under the current Microsoft identity re-binds the draft, so it must be reviewed again. */
  async edit(actor: DelegatedActor, id: string, input: unknown): Promise<DraftView> {
    const { cfg, identity } = await this.allowed(actor);
    const draft = await this.own(actor, id);
    if (draft.state !== 'Draft' && draft.state !== 'Failed') throw new ConflictException('Only an unsent draft can be edited.');
    const content = this.content(input, cfg);
    const owner = { ownerUserId: actor.user.id, ownerTenantId: identity.tenantId.toLowerCase(), ownerOid: identity.oid.toLowerCase() };
    const moved = await this.move(draft, { ...content, ...owner, state: 'Draft', contentHash: contentHash(owner, content) }, boundTo(draft, identity) ? 'edited' : 'rebound');
    return this.view(moved, identity);
  }

  async discard(actor: DelegatedActor, id: string): Promise<DraftView> {
    const { identity } = await this.allowed(actor);
    const draft = await this.own(actor, id);
    if (draft.state !== 'Draft' && draft.state !== 'Failed') throw new ConflictException('Only an unsent draft can be discarded.');
    return this.view(await this.move(draft, { state: 'Discarded' }, 'discarded'), identity);
  }

  /**
   * The explicit Send. `reviewedHash` must match the content AND sender identity the user reviewed. Recipients are
   * checked again against today's domain policy. A second press, a retry, a concurrent worker or a restarted
   * replica gets the recorded state back without calling Microsoft again.
   */
  async send(actor: DelegatedActor, id: string, input: unknown): Promise<{ draft: DraftView; alreadyHandled: boolean }> {
    const { cfg, identity } = await this.allowed(actor);
    const reviewedHash = input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 1 ? (input as Record<string, unknown>).reviewedHash : undefined;
    if (typeof reviewedHash !== 'string' || !/^[0-9a-f]{64}$/.test(reviewedHash)) throw new BadRequestException('Send needs the reviewedHash of the draft you reviewed.');
    const draft = await this.own(actor, id);
    if (LOCKED.includes(draft.state)) return { draft: this.view(draft, identity), alreadyHandled: true };
    if (draft.state === 'Discarded') throw new ConflictException('This draft was discarded.');
    if (!boundTo(draft, identity)) throw new ConflictException('This draft was written under a different Microsoft account. Save it again and review it before sending.');
    if (draft.contentHash !== reviewedHash || contentHash(draft, draft) !== draft.contentHash) throw new ConflictException('The draft changed after you reviewed it. Review it again before sending.');
    if (draft.retryNotBefore && Date.parse(draft.retryNotBefore) > this.clock().getTime()) throw new ConflictException(`Microsoft asked Prima to wait. Try again after ${draft.retryNotBefore}.`);
    this.content({ to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body }, cfg); // today's recipient policy

    const claimed = await this.ledger.transition(draft.ownerUserId, draft.id, draft.version, this.next(draft, { state: 'Sending', retryNotBefore: undefined }, 'send-pressed'));
    if (!claimed) {
      const current = await this.own(actor, id);
      if (LOCKED.includes(current.state)) return { draft: this.view(current, identity), alreadyHandled: true };
      throw new ConflictException('This draft changed in another window. Reload it before continuing.');
    }

    let token: string;
    try {
      token = await onBehalfOf(this.http, cfg.app, identity, MAIL_SCOPE, () => this.unavailable());
    } catch {
      // No request reached the mailbox, so this is a definite "not sent".
      return { draft: this.view(await this.move(claimed, { state: 'Failed' }, 'failed'), identity), alreadyHandled: false };
    }

    let patch: Partial<EmailDraft>;
    let action: EmailEvent['action'];
    try {
      const response = await this.http(SEND_URL, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: claimed.subject,
            body: { contentType: 'Text', content: claimed.body },
            toRecipients: claimed.to.map(address => ({ emailAddress: { address } })),
            ccRecipients: claimed.cc.map(address => ({ emailAddress: { address } })),
            // Lets the sender find this exact message in Sent Items when an outcome is uncertain.
            internetMessageHeaders: [{ name: 'X-Prima-Draft-Id', value: claimed.id }],
          },
          saveToSentItems: true,
        }),
      });
      // 202 means Microsoft accepted it for delivery: not delivered, not yet in Sent Items. 429 is a refusal with a
      // wait; other 4xx are definite refusals; 5xx or anything else may have been accepted upstream.
      if (response.status === 202) { patch = { state: 'Accepted' }; action = 'accepted'; }
      else if (response.status === 429) { patch = { state: 'Failed', retryNotBefore: new Date(this.clock().getTime() + retryAfterMs(response.headers.get('retry-after'), this.clock())).toISOString() }; action = 'throttled'; }
      else if (response.status >= 400 && response.status < 500) { patch = { state: 'Failed' }; action = 'failed'; }
      else { patch = { state: 'Uncertain' }; action = 'uncertain'; }
      await response.body?.cancel().catch(() => undefined);
    } catch {
      patch = { state: 'Uncertain' }; action = 'uncertain'; // Timeout or dropped connection after the request left.
    }
    const moved = await this.ledger.transition(claimed.ownerUserId, claimed.id, claimed.version, this.next(claimed, patch, action)).catch(() => null);
    // If recording fails the draft stays Sending, which still blocks any resend until it is settled.
    return { draft: this.view(moved ?? claimed, identity), alreadyHandled: false };
  }

  /**
   * After checking Outlook Sent Items (search for the subject or the X-Prima-Draft-Id header), the sender records
   * what they found. "not-found" makes the draft Failed so they may press Send again; it never resends itself.
   */
  async resolveUncertain(actor: DelegatedActor, id: string, input: unknown): Promise<DraftView> {
    const { identity } = await this.allowed(actor);
    const found = input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 1 ? (input as Record<string, unknown>).sentItems : undefined;
    if (found !== 'found' && found !== 'not-found') throw new BadRequestException('Say whether the message is in your Sent Items: found or not-found.');
    const draft = await this.own(actor, id);
    if (!boundTo(draft, identity)) throw new ConflictException('Check Sent Items while signed in with the Microsoft account that sent it.');
    const stuck = draft.state === 'Sending' && this.clock().getTime() - Date.parse(draft.updatedAt) > STUCK_SENDING_MS;
    if (draft.state !== 'Uncertain' && !stuck) throw new ConflictException('Only an uncertain send needs this check.');
    // "Not in Sent Items" is not proof it was not sent: the original request may still complete. The draft stays
    // locked (a stale Sending becomes Uncertain) and is never resent; to send again the person starts a NEW draft
    // and reviews it, so any duplicate is a deliberate, recorded human decision.
    const moved = found === 'found' ? await this.move(draft, { state: 'Accepted' }, 'confirmed-in-sent-items') : await this.move(draft, { state: 'Uncertain' }, 'reported-not-in-sent-items');
    return this.view(moved, identity);
  }
}
