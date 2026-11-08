
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { boundedJson, delegatedApp, linkedIdentity, LOCAL_ID, onBehalfOf, record, TIMEOUT_MS, type DelegatedActor, type DelegatedApp } from './delegated';
import type { EmailAddress, EmailSnapshot, JobEmailRecord, JobEmailStore } from './job-email-store';

/**
 * Attach an Outlook email to a job (Fauzan, 31 Oct 2026): staff keep sending in Outlook; Prima reads ONLY the one
 * email a staff member chooses to attach, from their OWN mailbox, when they press the button. Prima never lists,
 * searches, syncs or watches a mailbox, never reads attachments, never sends, and Arisha does not read these.
 *
 * Microsoft has no per-message permission, so the delegated scope (Mail.Read) technically covers the person's own
 * mailbox; this code only ever requests the single message ID taken from the link they paste.
 */
export const READ_SCOPE = 'https://graph.microsoft.com/Mail.Read';
/** Fauzan, 31 Oct 2026: email copies are kept 30 days, then only the stub (who, when, Outlook link) remains. */
export const KEEP_DAYS = 30;
const KEEP_MS = KEEP_DAYS * 86_400_000;
const SELECT = 'id,internetMessageId,subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,body,hasAttachments,webLink';
const OUTLOOK_HOSTS = ['outlook.office.com', 'outlook.office365.com'];
const MESSAGE_ID = /^[A-Za-z0-9+/=_-]{16,400}$/;
const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_BODY = 50_000;
const MAX_SUBJECT = 500;
const MAX_RECIPIENTS = 100;
const MAX_LIST = 50;

/**
 * Who may attach to, and see the emails on, a job. Wired by the job screen's owner from the core job rules
 * (assignee, giver, IT Manager/Lead, ...). The default denies everything: this module never decides job access.
 */
export interface JobEmailAccess {
  canAttach(actor: DelegatedActor, jobId: string): Promise<boolean>;
  canView(actor: DelegatedActor, jobId: string): Promise<boolean>;
}
export const denyAllJobEmailAccess: JobEmailAccess = { async canAttach() { return false; }, async canView() { return false; } };

interface Identity { serviceId: 'mail'; userId: string; jobId: string }
export type JobEmailSetupReason='FeatureDisabled'|'ServerConfigurationRequired'|'StorageNotReady'|'MicrosoftSignInRequired'|'ReadyForSelectedPreview';
export interface JobEmailStatus { setupReason:JobEmailSetupReason;providerVerified:false; serviceId: 'mail'; userId: string; status: 'NotConfigured' | 'ConfiguredNotVerified'; keepDays: number }
export interface JobEmailPreview extends Identity { previewToken: string; expiresAt: string; snapshot: EmailSnapshot }
export interface JobEmailView extends Identity {
  id: string;
  attachedByName: string;
  attachedAt: string;
  expiresAt: string;
  webLink: string;
  state: 'Available' | 'Expired' | 'Removed';
  snapshot: EmailSnapshot | null;
  canRemove: boolean;
}

export function jobEmailApp(env: NodeJS.ProcessEnv): DelegatedApp | null {
  return env.JOB_EMAIL_ENABLED === 'true' && /^[0-9a-f]{64}$/.test(env.JOB_EMAIL_PREVIEW_SECRET ?? '') ? delegatedApp(env, 'JOB_EMAIL_OBO_CLIENT_SECRET') : null;
}

/** The Graph message ID from an Outlook on the web link (".../id/<id>" or "?ItemID=<id>"), or null. */
export function messageIdFromLink(link: unknown): string | null {
  if (typeof link !== 'string' || !link.trim() || link.length > 2048) return null;
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || !OUTLOOK_HOSTS.includes(url.hostname) || url.port || url.username || url.password) return null;
  if (url.hash) return null;
  const params = [...url.searchParams.keys()];
  if (params.some(k => !['ItemID', 'itemid', 'exvsurl', 'viewmodel', 'popoutv2'].includes(k)) || new Set(params).size !== params.length) return null;
  let id: string | null = null;
  // These are known Outlook web shapes, not a generic URL-to-Graph resolver. The ID must
  // actually resolve through /me/messages; unsupported Exchange formats fail without searching.
  if (/^\/owa\/?$/.test(url.pathname)) {
    if (url.searchParams.has('ItemID') && url.searchParams.has('itemid')) return null;
    id = url.searchParams.get('ItemID') ?? url.searchParams.get('itemid');
  } else {
    if (url.searchParams.has('ItemID') || url.searchParams.has('itemid')) return null;
    const match = url.pathname.match(/^\/mail\/(?:u\/\d+\/|\d+\/)?(?:(?:inbox|sentitems|drafts|deleteditems|junkemail|archive)\/)?id\/([^/]+)\/?$/)
      ?? url.pathname.match(/^\/mail\/deeplink\/read\/([^/]+)\/?$/);
    if (match) { try { id = decodeURIComponent(match[1]); } catch { return null; } }
  }
  return id && MESSAGE_ID.test(id) ? id : null;
}

const clean = (v: string) => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
function address(v: unknown): EmailAddress | null {
  const e = record(v) && record(v.emailAddress) ? v.emailAddress : null;
  if (!e || typeof e.address !== 'string' || e.address.length > 320) return null;
  return { name: typeof e.name === 'string' ? clean(e.name).slice(0, 200) : '', address: clean(e.address) };
}
function addresses(v: unknown): EmailAddress[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out = v.slice(0, MAX_RECIPIENTS).map(address);
  return out.some(a => !a) ? null : out as EmailAddress[];
}
const time = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
function outlookLink(v: unknown): string | null {
  // Provider links are rendered as navigation, never accepted as arbitrary Outlook URLs.
  return messageIdFromLink(v) && typeof v === 'string' ? new URL(v.trim()).toString() : null;
}

/** Keeps only the fields Prima shows; any malformed answer is refused, never partly stored. */
export function snapshotFrom(m: Record<string, unknown>): EmailSnapshot | null {
  const body = record(m.body) ? m.body : null;
  const from = m.from === undefined || m.from === null ? null : address(m.from);
  const to = addresses(m.toRecipients); const cc = addresses(m.ccRecipients);
  const webLink = outlookLink(m.webLink);
  if (typeof m.internetMessageId !== 'string' || !m.internetMessageId || m.internetMessageId.length > 998 || !body || body.contentType !== 'text' ||
      typeof body.content !== 'string' || (m.from != null && !from) || !to || !cc || !webLink || typeof m.hasAttachments !== 'boolean' ||
      (m.subject != null && typeof m.subject !== 'string')) return null;
  const text = clean(body.content);
  return {
    subject: clean((m.subject as string | null) ?? '').slice(0, MAX_SUBJECT), from, to, cc,
    sentAt: time(m.sentDateTime), receivedAt: time(m.receivedDateTime),
    body: text.slice(0, MAX_BODY), bodyTruncated: text.length > MAX_BODY, hasAttachments: m.hasAttachments, webLink,
    internetMessageId: clean(m.internetMessageId),
  };
}
const hashOf = (jobId: string, userId: string, s: EmailSnapshot) => createHash('sha256').update(JSON.stringify([jobId, userId, s])).digest('hex');
const snapshotHash = (s: EmailSnapshot) => createHash('sha256').update(JSON.stringify(s)).digest('hex');
export const PREVIEW_TTL_MS = 10 * 60 * 1000;
interface PreviewClaim { v: 2; userId: string; jobId: string; tenantId: string; oid: string; inputId: string; canonicalMessageId: string; hash: string; issuedAt: number; expiresAt: number }


export class JobEmail {
  constructor(
    private readonly store: JobEmailStore,
    private readonly access: JobEmailAccess = denyAllJobEmailAccess,
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly http: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** NotConfigured unless enabled, credentialled AND the store passes its readiness gate on this call. */
  private async app(): Promise<DelegatedApp | null> {
    const app = jobEmailApp(this.env());
    if (!app) return null;
    const ready = await this.store.readiness().catch(() => ({ ready: false as const, reason: 'Store readiness failed.' }));
    return ready.ready ? app : null;
  }
  private async ready() {
    const app = await this.app();
    if (!app) throw new ServiceUnavailableException('Attaching Outlook emails is not configured.');
    return app;
  }
  private job(jobId: string) { if (!LOCAL_ID.test(jobId)) throw new NotFoundException('Job not found.'); return jobId; }
  private async attachable(actor: DelegatedActor, jobId: string) {
    if (actor.user.integration || !(await this.access.canAttach(actor, jobId))) throw new ForbiddenException('You cannot attach emails to this job.');
  }
  private async viewable(actor: DelegatedActor, jobId: string) {
    if (actor.user.integration || !(await this.access.canView(actor, jobId))) throw new NotFoundException('Job not found.');
  }
  private unavailable(): never { throw new ServiceUnavailableException('Your mailbox could not be reached. Nothing was attached.'); }

  async status(actor: DelegatedActor): Promise<JobEmailStatus> {
    const env=this.env(),app=jobEmailApp(env);
    let setupReason:JobEmailSetupReason=env.JOB_EMAIL_ENABLED!=='true'?'FeatureDisabled':!app?'ServerConfigurationRequired':'StorageNotReady';
    const ready=!!app&&(await this.store.readiness().catch(()=>({ready:false}))).ready;
    if(ready){try{linkedIdentity(actor,app!,'Microsoft sign-in required.');setupReason='ReadyForSelectedPreview';}catch{setupReason='MicrosoftSignInRequired';}}
    return {serviceId:'mail',userId:actor.user.id,status:ready?'ConfiguredNotVerified':'NotConfigured',keepDays:KEEP_DAYS,setupReason,providerVerified:false};
  }

  /** Reads exactly one message, by ID, from the signed-in person's own mailbox. */
  private async fetchOne(app: DelegatedApp, actor: DelegatedActor, input: unknown): Promise<{ snapshot: EmailSnapshot; canonicalMessageId: string; inputId: string }> {
    const id = messageIdFromLink(record(input) ? input.outlookLink : undefined);
    if (!id) throw new BadRequestException('Paste the link to one email from your Outlook (outlook.office.com).');
    const identity = linkedIdentity(actor, app, 'Sign in with your linked Microsoft account to attach an email.');
    const token = await onBehalfOf(this.http, app, identity, READ_SCOPE, () => this.unavailable());
    let response: Response;
    try {
      response = await this.http(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}?$select=${SELECT}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"', Accept: 'application/json' },
      });
    } catch { return this.unavailable(); }
    if (response.status === 400 || response.status === 404) throw new BadRequestException('That email was not found in your own mailbox. Copy its link from your Outlook and try again.');
    if (!response.ok) this.unavailable();
    const data = await boundedJson(response, 1024 * 1024, () => this.unavailable());
    const snapshot = snapshotFrom(data);
    if (!snapshot || typeof data.id !== 'string' || !MESSAGE_ID.test(data.id)) this.unavailable();
    return { snapshot: snapshot!, canonicalMessageId: data.id as string, inputId: id };

  }
  private exact(input: unknown, keys: string[]) {
    if (!record(input) || Object.keys(input).some(k => !keys.includes(k)) || keys.some(k => !(k in input))) throw new BadRequestException(`Send ${keys.join(' and ')} only.`);
  }

  private sign(claim: PreviewClaim): string {
    const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url');
    const mac = createHmac('sha256', Buffer.from(this.env().JOB_EMAIL_PREVIEW_SECRET!, 'hex')).update(encoded).digest('base64url');
    return `${encoded}.${mac}`;
  }

  private verify(token: unknown, actor: DelegatedActor, app: DelegatedApp, jobId: string, inputId: string | null): PreviewClaim {
    const invalid = () => new ConflictException('Preview this email again before attaching it.');
    if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
    const [encoded, signature] = token.split('.');
    const wanted = createHmac('sha256', Buffer.from(this.env().JOB_EMAIL_PREVIEW_SECRET!, 'hex')).update(encoded).digest();
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw invalid();
    let c: PreviewClaim;
    try { c = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw invalid(); }
    const identity = linkedIdentity(actor, app, 'Sign in with your linked Microsoft account to attach an email.');
    const now = this.clock().getTime();
    if (!c || c.v !== 2 || c.userId !== actor.user.id || c.jobId !== jobId || c.tenantId !== identity.tenantId.toLowerCase()
      || c.oid !== identity.oid.toLowerCase() || c.inputId !== inputId || !MESSAGE_ID.test(c.canonicalMessageId)
      || !HASH.test(c.hash) || !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt)
      || c.expiresAt - c.issuedAt !== PREVIEW_TTL_MS || c.issuedAt > now || c.expiresAt <= now) throw invalid();
    return c;
  }

  /** A short-lived server-authenticated preview; no email content is stored before Attach. */
  async preview(actor: DelegatedActor, jobId: string, input: unknown): Promise<JobEmailPreview> {
    const app = await this.ready(); this.job(jobId); await this.attachable(actor, jobId); this.exact(input, ['outlookLink']);
    const read = await this.fetchOne(app, actor, input);
    const identity = linkedIdentity(actor, app, 'Sign in with your linked Microsoft account to attach an email.');
    const issuedAt = this.clock().getTime();
    const claim: PreviewClaim = { v: 2, userId: actor.user.id, jobId, tenantId: identity.tenantId.toLowerCase(), oid: identity.oid.toLowerCase(),
      inputId: read.inputId, canonicalMessageId: read.canonicalMessageId, hash: snapshotHash(read.snapshot), issuedAt, expiresAt: issuedAt + PREVIEW_TTL_MS };
    return { serviceId: 'mail', userId: actor.user.id, jobId, previewToken: this.sign(claim), expiresAt: new Date(claim.expiresAt).toISOString(), snapshot: read.snapshot };
  }

  /** Re-authorises, re-reads and binds the stored copy to the current mailbox and reviewed canonical message. */
  async attach(actor: DelegatedActor, jobId: string, input: unknown): Promise<JobEmailView> {
    const app = await this.ready(); this.job(jobId); await this.attachable(actor, jobId); this.exact(input, ['outlookLink', 'previewToken']);
    const body = input as Record<string, unknown>;
    const claim = this.verify(body.previewToken, actor, app, jobId, messageIdFromLink(body.outlookLink));
    const read = await this.fetchOne(app, actor, input);
    const hash = snapshotHash(read.snapshot);
    if (read.canonicalMessageId !== claim.canonicalMessageId || hash !== claim.hash || this.clock().getTime() >= claim.expiresAt)
      throw new ConflictException('This email or preview changed. Preview it again.');
    // Permissions may have changed during the upstream read. Database policy also checks the live job rule.
    await this.attachable(actor, jobId);
    const identity = linkedIdentity(actor, app, 'Sign in with your linked Microsoft account to attach an email.');
    const now = this.clock(); const snapshot = read.snapshot;
    const rec: JobEmailRecord = {
      id: randomUUID(), jobId, attachedBy: actor.user.id, attachedByName: actor.user.name ?? actor.user.id,
      attachedByTenantId: identity.tenantId.toLowerCase(), attachedByOid: identity.oid.toLowerCase(), canonicalMessageId: read.canonicalMessageId,
      attachedAt: now.toISOString(), expiresAt: new Date(now.getTime() + KEEP_MS).toISOString(), removedAt: null,
      internetMessageId: snapshot.internetMessageId, webLink: snapshot.webLink, snapshotHash: hash, snapshot,
      events: [{ at: now.toISOString(), by: actor.user.id, action: 'attached' }],
    };
    if (await this.store.insert(actor.user.id, rec) === 'duplicate') throw new ConflictException('This email is already attached to this job.');
    return this.view(actor, rec);
  }

  async list(actor: DelegatedActor, jobId: string): Promise<Identity & { emails: JobEmailView[] }> {
    await this.ready(); this.job(jobId); await this.viewable(actor, jobId);
    const rows = await this.store.list(actor.user.id, jobId, MAX_LIST);
    return { serviceId: 'mail', userId: actor.user.id, jobId, emails: rows.map(r => this.view(actor, r)) };
  }

  /** Only the person who attached it; once. Outlook is never changed. The copy is erased, the stub stays. */
  async remove(actor: DelegatedActor, jobId: string, id: string): Promise<JobEmailView> {
    await this.ready(); this.job(jobId); await this.viewable(actor, jobId);
    if (!ATTACHMENT_ID.test(id)) throw new NotFoundException('Attached email not found.');
    const current = await this.store.get(actor.user.id, jobId, id);
    if (!current) throw new NotFoundException('Attached email not found.');
    if (current.attachedBy !== actor.user.id) throw new ForbiddenException('Only the person who attached this email can remove it.');
    if (current.removedAt) return this.view(actor, current);
    const at = this.clock().toISOString();
    const next: JobEmailRecord = { ...current, removedAt: at, snapshot: null, events: [...current.events, { at, by: actor.user.id, action: 'removed' }] };
    const moved = await this.store.remove(actor.user.id, jobId, id, next);
    if (!moved) throw new ConflictException('This email changed in another window. Reload the job.');
    return this.view(actor, moved);
  }

  /** The 30-day rule is enforced on every read, even before the retention job has erased the copy. */
  private view(actor: DelegatedActor, r: JobEmailRecord): JobEmailView {
    const expired = Date.parse(r.expiresAt) <= this.clock().getTime();
    const state = r.removedAt ? 'Removed' : expired || !r.snapshot ? 'Expired' : 'Available';
    return {
      serviceId: 'mail', userId: actor.user.id, jobId: r.jobId, id: r.id, attachedByName: r.attachedByName, attachedAt: r.attachedAt, expiresAt: r.expiresAt,
      webLink: r.webLink, state, snapshot: state === 'Available' ? structuredClone(r.snapshot) : null,
      canRemove: state !== 'Removed' && r.attachedBy === actor.user.id,
    };
  }
}
