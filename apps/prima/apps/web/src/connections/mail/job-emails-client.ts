/**
 * Client for "attach an Outlook email to a job". Every answer must be for the signed-in user and this job, or it
 * is refused. Runtime-import free so the offline tests can load it directly.
 */
export type ConnectionsTransport = (method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal) => Promise<unknown>;
export interface EmailAddress { name: string; address: string }
export interface EmailSnapshot {
  subject: string; from: EmailAddress | null; to: EmailAddress[]; cc: EmailAddress[]; sentAt: string | null; receivedAt: string | null;
  body: string; bodyTruncated: boolean; hasAttachments: boolean; webLink: string; internetMessageId: string;
}
export interface JobEmailView {
  id: string; attachedByName: string; attachedAt: string; expiresAt: string; webLink: string;
  state: 'Available' | 'Expired' | 'Removed'; snapshot: EmailSnapshot | null; canRemove: boolean;
}
export const MAIL_SETUP_REASONS = ['FeatureDisabled','ServerConfigurationRequired','StorageNotReady','MicrosoftSignInRequired','ReadyForSelectedPreview'] as const;
export type MailSetupReason = typeof MAIL_SETUP_REASONS[number];
export interface JobEmailPreview { previewToken: string; expiresAt: string; snapshot: EmailSnapshot }

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = (): never => { throw new Error('Invalid job email response.'); };
const str = (v: unknown, max = 100_000): v is string => typeof v === 'string' && v.length <= max;
const OUTLOOK = ['outlook.office.com', 'outlook.office365.com'];

/** Only an https Outlook link is ever rendered as a link. */
export function safeOutlookLink(v: unknown): string {
  if (!str(v, 4096)) return invalid();
  let u: URL;
  try { u = new URL(v); } catch { return invalid(); }
  if (u.protocol !== 'https:' || !OUTLOOK.includes(u.hostname) || u.username || u.password || u.port) return invalid();
  return u.toString();
}
/** Format check only: no mailbox access, lookup or persistence. */
export function validOutlookMessageLink(value: string): boolean {
  try {
    if (value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
    const u = new URL(safeOutlookLink(value)); if (u.hash) return false;
    const keys=[...u.searchParams.keys()]; if(keys.some(k=>!['ItemID','itemid','exvsurl','viewmodel','popoutv2'].includes(k))||new Set(keys).size!==keys.length)return false;
    let id:string|null=null;
    if(/^\/owa\/?$/.test(u.pathname)){if(u.searchParams.has('ItemID')&&u.searchParams.has('itemid'))return false;id=u.searchParams.get('ItemID')??u.searchParams.get('itemid');}
    else {if(u.searchParams.has('ItemID')||u.searchParams.has('itemid'))return false;const m=u.pathname.match(/^\/mail\/(?:u\/\d+\/|\d+\/)?(?:(?:inbox|sentitems|drafts|deleteditems|junkemail|archive)\/)?id\/([^/]+)\/?$/)??u.pathname.match(/^\/mail\/deeplink\/read\/([^/]+)\/?$/);if(m)id=decodeURIComponent(m[1]);}
    return !!id&&/^[A-Za-z0-9+/=_-]{16,400}$/.test(id);
  }catch{return false;}
}
function messageDisplayLink(v:unknown):string { const url=safeOutlookLink(v); if(!validOutlookMessageLink(url))return invalid();return url; }
function addr(v: unknown): EmailAddress {
  if (!obj(v) || !str(v.name, 200) || !str(v.address, 320)) return invalid();
  return { name: v.name, address: v.address };
}
const addrs = (v: unknown) => Array.isArray(v) && v.length <= 100 ? v.map(addr) : invalid();
const when = (v: unknown) => v === null ? null : str(v, 40) && Number.isFinite(Date.parse(v)) ? v : invalid();
function snapshot(v: unknown): EmailSnapshot {
  if (!obj(v) || !str(v.subject, 500) || !str(v.body, 50_000) || typeof v.bodyTruncated !== 'boolean' || typeof v.hasAttachments !== 'boolean' || !str(v.internetMessageId, 998)) return invalid();
  return { subject: v.subject, from: v.from === null ? null : addr(v.from), to: addrs(v.to), cc: addrs(v.cc), sentAt: when(v.sentAt), receivedAt: when(v.receivedAt),
    body: v.body, bodyTruncated: v.bodyTruncated, hasAttachments: v.hasAttachments, webLink: messageDisplayLink(v.webLink), internetMessageId: v.internetMessageId };
}
const bound = (r: unknown, userId: string, jobId: string): Record<string, unknown> =>
  obj(r) && r.serviceId === 'mail' && r.userId === userId && r.jobId === jobId ? r : invalid();
function view(v: unknown, userId: string, jobId: string): JobEmailView {
  const r = bound(v, userId, jobId);
  if (!str(r.id, 64) || !str(r.attachedByName, 200) || !str(r.attachedAt, 40) || !str(r.expiresAt, 40) || typeof r.canRemove !== 'boolean' ||
      !['Available', 'Expired', 'Removed'].includes(r.state as string) || (r.state === 'Available') !== (r.snapshot !== null)) return invalid();
  return { id: r.id, attachedByName: r.attachedByName, attachedAt: r.attachedAt, expiresAt: r.expiresAt, webLink: messageDisplayLink(r.webLink),
    state: r.state as JobEmailView['state'], snapshot: r.snapshot === null ? null : snapshot(r.snapshot), canRemove: r.canRemove };
}

export function jobEmailClient(call: ConnectionsTransport) {
  const base = (jobId: string) => `/connections/mail/jobs/${encodeURIComponent(jobId)}/emails`;
  return {
    async setup(userId: string, requestId: string, signal?: AbortSignal) {
      const r=await call('POST','/connections/mail/jobs/setup',{requestId},signal);
      if(!obj(r)||r.serviceId!=='mail'||r.userId!==userId||r.requestId!==requestId||!str(r.ticketRef,80)||!str(r.ticketId,100)||typeof r.replayed!=='boolean')return invalid();
      return {ticketRef:r.ticketRef,ticketId:r.ticketId};
    },
    async status(userId: string, signal?: AbortSignal) {
      const r = await call('GET', '/connections/mail/jobs/status', undefined, signal);
      if (!obj(r) || r.serviceId !== 'mail' || r.userId !== userId || !['NotConfigured', 'ConfiguredNotVerified'].includes(r.status as string) || r.keepDays !== 30) return invalid();
      if(r.providerVerified!==undefined&&r.providerVerified!==false)return invalid();
      if(r.setupReason!==undefined&&!MAIL_SETUP_REASONS.includes(r.setupReason as MailSetupReason))return invalid();
      let setupRequest:{ticketId:string;ticketRef:string;status:'open'|'in_progress'}|null|undefined=undefined;
      if(r.setupRequest===null)setupRequest=null;
      if(r.setupRequest!==undefined&&r.setupRequest!==null){const q=r.setupRequest;if(!obj(q)||!str(q.ticketId,100)||!q.ticketId||!str(q.ticketRef,80)||!q.ticketRef||!['open','in_progress'].includes(q.status as string))return invalid();setupRequest={ticketId:q.ticketId,ticketRef:q.ticketRef,status:q.status as 'open'|'in_progress'};}
      return { configured: r.status === 'ConfiguredNotVerified', keepDays: r.keepDays, providerVerified:false as const,setupReason:r.setupReason as MailSetupReason|undefined,setupRequest };
    },
    async list(userId: string, jobId: string, signal?: AbortSignal): Promise<JobEmailView[]> {
      const r = bound(await call('GET', base(jobId), undefined, signal), userId, jobId);
      return Array.isArray(r.emails) && r.emails.length <= 50 ? r.emails.map(e => view(e, userId, jobId)) : invalid();
    },
    async preview(userId: string, jobId: string, outlookLink: string, signal?: AbortSignal): Promise<JobEmailPreview> {
      const r = bound(await call('POST', `${base(jobId)}/preview`, { outlookLink }, signal), userId, jobId);
      if (!str(r.previewToken, 4096) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(r.previewToken) || !str(r.expiresAt,40) || !Number.isFinite(Date.parse(r.expiresAt))) return invalid();
      return { previewToken: r.previewToken, expiresAt:r.expiresAt, snapshot: snapshot(r.snapshot) };
    },
    /** Never retried by the client; a repeated press is answered by the server ("already attached"). */
    attach: async (userId: string, jobId: string, outlookLink: string, previewToken: string, signal?: AbortSignal) =>
      view(await call('POST', base(jobId), { outlookLink, previewToken }, signal), userId, jobId),
    remove: async (userId: string, jobId: string, id: string, signal?: AbortSignal) =>
      view(await call('POST', `${base(jobId)}/${encodeURIComponent(id)}/remove`, {}, signal), userId, jobId),
  };
}
export type JobEmailClient = ReturnType<typeof jobEmailClient>;

export function previewStillCurrent(expiresAt: string, now=Date.now()): boolean { const expiry=Date.parse(expiresAt); return Number.isFinite(now)&&Number.isFinite(expiry)&&expiry>now; }
