/**
 * Microsoft 365 Connections client. Every response is checked against the signed-in Prima user before it is shown;
 * anything malformed is treated as "status unavailable", never as connected.
 */
export type M365Service = 'outlook' | 'teams' | 'sharepoint';
export type ConnectionState = 'not_configured' | 'configured' | 'consent_needed' | 'connected' | 'expired_or_revoked' | 'unavailable';
export type ConnectionAction = 'check' | 'reconnect' | 'disconnect';
export interface ServiceStatus {
  service: M365Service; state: ConnectionState; reason: string;
  resources: { key: string; name: string }[]; resourceKey?: string;
  checkedAt?: string; validUntil?: string; retryAfterSeconds?: number; claims?: string;
  actions: ConnectionAction[];
}
export interface M365Status { userId: string; services: ServiceStatus[]; teamsApprovals: { state: 'not_built'; canApplyApprovals: false } }
export type LinkOutcome = 'Verified' | 'NotAMember' | 'NotApprovedOrNoAccess' | 'WrongOrganization' | 'WrongCompany' | 'NotApproved' | 'SiteVerifiedLibraryNotApproved' | 'SiteVerifiedLibraryNotFound' | 'Failed';
export interface LinkResult {
  service: 'teams' | 'sharepoint'; userId: string; outcome: LinkOutcome; checkedAt: string;
  membershipType?: 'standard' | 'private' | 'shared'; openUrl?: string; resourceKey?: string; canonicalUrl?: string;
  verifiedScope?: 'channel' | 'site' | 'library'; reason?: string; retryAfterSeconds?: number;
  status: ServiceStatus;
}
export type M365Transport = (method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal) => Promise<unknown>;
export interface M365Client {
  status(owner: string, signal?: AbortSignal): Promise<M365Status>;
  check(owner: string, service: M365Service, resourceKey: string | undefined, signal?: AbortSignal): Promise<ServiceStatus>;
  disconnect(owner: string, service: M365Service, signal?: AbortSignal): Promise<ServiceStatus>;
  link(owner: string, service: 'teams' | 'sharepoint', url: string, signal?: AbortSignal): Promise<LinkResult>;
  guidance(signal?: AbortSignal): Promise<Record<M365Service, Guidance>>;
}
export interface Bilingual { bm: string; en: string }
/** Arisha's plain guidance per connection, from the server's capability matrix. */
export interface Guidance { why: Bilingual; data: Bilingual; whereToGetLink: Bilingual; whoHelps: Bilingual; scopes: string[] }

const SERVICES: M365Service[] = ['outlook', 'teams', 'sharepoint'];
const STATES: ConnectionState[] = ['not_configured', 'configured', 'consent_needed', 'connected', 'expired_or_revoked', 'unavailable'];
const OUTCOMES: LinkOutcome[] = ['Verified', 'NotAMember', 'NotApprovedOrNoAccess', 'WrongOrganization', 'WrongCompany', 'NotApproved', 'SiteVerifiedLibraryNotApproved', 'SiteVerifiedLibraryNotFound', 'Failed'];
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const time = (v: unknown) => v === undefined || (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)));
const bad = (): never => { throw new Error('Invalid connection response.'); };

export function serviceStatus(v: unknown, expected?: M365Service): ServiceStatus {
  if (!obj(v) || !SERVICES.includes(v.service as M365Service) || (expected && v.service !== expected) || !STATES.includes(v.state as ConnectionState) || !str(v.reason, 60)) return bad();
  if (!Array.isArray(v.resources) || v.resources.length > 100 || v.resources.some(r => !obj(r) || !str(r.key, 60) || !str(r.name))) return bad();
  if (!Array.isArray(v.actions) || v.actions.some(a => !['check', 'reconnect', 'disconnect'].includes(a as string))) return bad();
  if (!time(v.checkedAt) || !time(v.validUntil) || (v.resourceKey !== undefined && !str(v.resourceKey, 60))) return bad();
  if (v.retryAfterSeconds !== undefined && (typeof v.retryAfterSeconds !== 'number' || !Number.isInteger(v.retryAfterSeconds) || v.retryAfterSeconds < 1 || v.retryAfterSeconds > 3600)) return bad();
  if (v.claims !== undefined && !str(v.claims, 2000)) return bad();
  // "connected" must carry the time Microsoft answered and an end time; otherwise it is not believed.
  if (v.state === 'connected' && (!v.checkedAt || !v.validUntil)) return bad();
  return structuredClone(v) as unknown as ServiceStatus;
}

const bilingual = (v: unknown): v is Bilingual => obj(v) && str(v.bm, 600) && str(v.en, 600);

export function m365Client(call: M365Transport): M365Client {
  return {
    async guidance(signal) {
      const v = await call('GET', '/connections/m365/matrix', undefined, signal);
      if (!obj(v) || !obj(v.capabilities)) return bad();
      const caps = v.capabilities;
      const out = {} as Record<M365Service, Guidance>;
      for (const s of SERVICES) {
        const c = caps[s];
        if (!obj(c) || !bilingual(c.why) || !bilingual(c.data) || !bilingual(c.whereToGetLink) || !bilingual(c.whoHelps) || !Array.isArray(c.delegatedScopes)) return bad();
        const scopes = c.delegatedScopes.map(x => (obj(x) && str(x.scope, 60) ? x.scope : bad()));
        out[s] = { why: c.why, data: c.data, whereToGetLink: c.whereToGetLink, whoHelps: c.whoHelps, scopes };
      }
      return out;
    },
    async status(owner, signal) {
      const v = await call('GET', '/connections/m365/status', undefined, signal);
      if (!obj(v) || v.userId !== owner || !Array.isArray(v.services) || v.services.length !== 3) return bad();
      const services = v.services.map(s => serviceStatus(s));
      if (services.map(s => s.service).join() !== SERVICES.join()) return bad();
      if (!obj(v.teamsApprovals) || v.teamsApprovals.state !== 'not_built' || v.teamsApprovals.canApplyApprovals !== false) return bad();
      return { userId: owner, services, teamsApprovals: { state: 'not_built', canApplyApprovals: false } };
    },
    async check(owner, service, resourceKey, signal) {
      return serviceStatus(await call('POST', `/connections/m365/${service}/check`, resourceKey === undefined ? {} : { resourceKey }, signal), service);
    },
    async disconnect(owner, service, signal) {
      return serviceStatus(await call('POST', `/connections/m365/${service}/disconnect`, {}, signal), service);
    },
    async link(owner, service, url, signal) {
      const v = await call('POST', `/connections/m365/${service}/link`, { url }, signal);
      if (!obj(v) || v.userId !== owner || v.service !== service || !OUTCOMES.includes(v.outcome as LinkOutcome) || !time(v.checkedAt)) return bad();
      const status = serviceStatus(v.status, service);
      if (v.membershipType !== undefined && !['standard', 'private', 'shared'].includes(v.membershipType as string)) return bad();
      const openUrl = typeof v.openUrl === 'string' && /^https:\/\/teams\.microsoft\.com\/l\/channel\/[A-Za-z0-9%._-]+\/channel\?groupId=[0-9a-f-]{36}&tenantId=[0-9a-f-]{36}$/.test(v.openUrl) ? v.openUrl : undefined;
      if (v.outcome === 'Verified' && service === 'teams' && (!openUrl || !v.membershipType || v.verifiedScope !== 'channel')) return bad();
      if (v.outcome === 'Verified' && service === 'sharepoint' && v.verifiedScope !== 'site' && v.verifiedScope !== 'library') return bad();
      if (v.verifiedScope !== undefined && !['channel', 'site', 'library'].includes(v.verifiedScope as string)) return bad();
      if (v.reason !== undefined && !str(v.reason, 60)) return bad();
      if (v.retryAfterSeconds !== undefined && (typeof v.retryAfterSeconds !== 'number' || !Number.isInteger(v.retryAfterSeconds) || v.retryAfterSeconds < 1 || v.retryAfterSeconds > 3600)) return bad();
      return { service, userId: owner, outcome: v.outcome as LinkOutcome, checkedAt: v.checkedAt as string, status,
        ...(v.membershipType ? { membershipType: v.membershipType as LinkResult['membershipType'] } : {}),
        ...(openUrl ? { openUrl } : {}), ...(str(v.resourceKey, 60) ? { resourceKey: v.resourceKey } : {}),
        ...(str(v.canonicalUrl, 750) ? { canonicalUrl: v.canonicalUrl } : {}),
        ...(v.verifiedScope ? { verifiedScope: v.verifiedScope as LinkResult['verifiedScope'] } : {}),
        ...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
        ...(typeof v.retryAfterSeconds === 'number' ? { retryAfterSeconds: v.retryAfterSeconds } : {}) };
    },
  };
}
