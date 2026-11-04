import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { User } from '@prima/core';
import type { VerifiedEntraAssertion } from './auth';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const LOCAL_ID = /^[A-Za-z0-9_-]{1,80}$/;
const DRIVE_ID = /^[A-Za-z0-9!_-]{1,200}$/;
const HOST = /^[a-z0-9][a-z0-9-]{0,62}\.sharepoint\.com$/;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'https://graph.microsoft.com/Sites.Selected';
const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 8000;

export interface ApprovedSharePointSite {
  key: string;
  name: string;
  siteId: string;
  host: string;
  companyIds: string[];
  allowedUserIds: string[];
  approvedDriveIds: string[];
}
interface SharePointConfiguration {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sites: ApprovedSharePointSite[];
}
export interface ConnectionsActor {
  user: User;
  visibleCompanyIds: string[];
  assertion: VerifiedEntraAssertion | null;
}
export type SharePointSetupReason='FeatureDisabled'|'ServerConfigurationRequired'|'ApprovedResourcesRequired'|'NoApprovedResourcesForUser'|'ApprovedLibrariesRequired'|'MicrosoftSignInRequired'|'ReadyForSelectedCheck';
export interface SharePointStatus {
  serviceId: 'sharepoint';
  userId: string;
  status: 'NotConfigured' | 'ConfiguredNotVerified';
  setupReason: SharePointSetupReason;
  providerVerified: false;
  sites: { key: string; name: string; hasApprovedLibraries: boolean }[];
}
export interface SharePointLibrary { id: string; name: string }
export interface SharePointItem { id: string; name: string; kind: 'file' | 'folder'; size: number | null; lastModifiedAt: string | null; webUrl?: string }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 50 && value.every(v => typeof v === 'string' && LOCAL_ID.test(v)) && new Set(value).size === value.length;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Browser display URL only, never a Graph downloadUrl or generated sharing grant. */
export function approvedBrowserUrl(value: unknown, host: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname);
    if (!HOST.test(host) || url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port || url.search || url.hash ||
        path.length < 2 || /[\\\u0000-\u001f\u007f]/.test(path) || /(?:^|\/)(?:_layouts|_api|_vti_bin)(?:\/|$)/i.test(path)) return;
    return url.href;
  } catch { return; }
}

/** Invalid, missing or disabled configuration never turns into a best-effort broad connection. */
export function sharePointConfiguration(env: NodeJS.ProcessEnv): SharePointConfiguration | null {
  if (env.SHAREPOINT_CONNECTION_ENABLED !== 'true') return null;
  const tenantId = env.ENTRA_TENANT_ID?.toLowerCase() ?? '';
  const clientId = (env.ENTRA_API_CLIENT_ID ?? env.ENTRA_CLIENT_ID)?.toLowerCase() ?? '';
  const clientSecret = env.SHAREPOINT_OBO_CLIENT_SECRET ?? '';
  const raw = env.SHAREPOINT_APPROVED_SITES_JSON ?? '';
  if (!GUID.test(tenantId) || !GUID.test(clientId) || !clientSecret.trim() || clientSecret.length > 4096 || raw.length > 32_000) return null;
  try {
    const sites: unknown = JSON.parse(raw);
    if (!Array.isArray(sites) || !sites.length || sites.length > 20) return null;
    const approved: ApprovedSharePointSite[] = [];
    for (const site of sites) {
      if (!record(site) || Object.keys(site).some(k => !['key', 'name', 'siteId', 'host', 'companyIds', 'allowedUserIds', 'approvedDriveIds'].includes(k)) ||
          typeof site.key !== 'string' || !KEY.test(site.key) || !text(site.name) ||
          typeof site.host !== 'string' || !HOST.test(site.host) || typeof site.siteId !== 'string' ||
          !ids(site.companyIds) || !ids(site.allowedUserIds)) return null;
      const approvedDriveIds = site.approvedDriveIds === undefined ? [] : site.approvedDriveIds;
      if (!Array.isArray(approvedDriveIds) || approvedDriveIds.length > 50 || approvedDriveIds.some(id => typeof id !== 'string' || !DRIVE_ID.test(id)) || new Set(approvedDriveIds).size !== approvedDriveIds.length) return null;
      const parts = site.siteId.split(',');
      if (parts.length !== 3 || parts[0] !== site.host || !GUID.test(parts[1]) || !GUID.test(parts[2])) return null;
      if (approved.some(s => s.key === site.key || s.siteId === site.siteId)) return null;
      approved.push({ key: site.key, name: site.name, host: site.host, siteId: site.siteId, companyIds: [...site.companyIds], allowedUserIds: [...site.allowedUserIds], approvedDriveIds: [...approvedDriveIds] });
    }
    return { tenantId, clientId, clientSecret, sites: approved };
  } catch { return null; }
}

/** Read-only, delegated, allowlisted metadata. No provider state or access token is cached. */
export class SharePointConnections {
  constructor(
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly http: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private allowed(actor: ConnectionsActor, site: ApprovedSharePointSite): boolean {
    return !actor.user.integration && site.allowedUserIds.includes(actor.user.id) && site.companyIds.every(id => actor.visibleCompanyIds.includes(id));
  }

  status(actor: ConnectionsActor): SharePointStatus {
    const env=this.env(),cfg=sharePointConfiguration(env);
    if(!cfg)return {serviceId:'sharepoint',userId:actor.user.id,status:'NotConfigured',sites:[],providerVerified:false,
      setupReason:env.SHAREPOINT_CONNECTION_ENABLED!=='true'?'FeatureDisabled':!env.SHAREPOINT_APPROVED_SITES_JSON?.trim()?'ApprovedResourcesRequired':'ServerConfigurationRequired'};
    const sites=cfg.sites.filter(s=>this.allowed(actor,s));
    const identity=actor.assertion;
    const linked=!!identity&&identity.userId===actor.user.id&&identity.tenantId.toLowerCase()===cfg.tenantId&&!!actor.user.entraOid&&actor.user.entraOid.toLowerCase()===identity.oid.toLowerCase()&&!!identity.accessToken;
    return {serviceId:'sharepoint',userId:actor.user.id,status:'ConfiguredNotVerified',providerVerified:false,
      setupReason:!sites.length?'NoApprovedResourcesForUser':!sites.some(s=>s.approvedDriveIds.length)?'ApprovedLibrariesRequired':!linked?'MicrosoftSignInRequired':'ReadyForSelectedCheck',
      sites:sites.map(s=>({key:s.key,name:s.name,hasApprovedLibraries:s.approvedDriveIds.length>0}))};
  }

  private authorize(actor: ConnectionsActor, key: string) {
    const cfg = sharePointConfiguration(this.env());
    if (!cfg) throw new ServiceUnavailableException('SharePoint is not configured.');
    const site = cfg.sites.find(s => s.key === key);
    if (!site || !this.allowed(actor, site)) throw new ForbiddenException('This SharePoint site is not available to this user.');
    const identity = actor.assertion;
    if (!identity || identity.userId !== actor.user.id || identity.tenantId.toLowerCase() !== cfg.tenantId ||
        !actor.user.entraOid || actor.user.entraOid.toLowerCase() !== identity.oid.toLowerCase() || !identity.accessToken) {
      throw new ForbiddenException('Sign in with your linked Microsoft account to check SharePoint access.');
    }
    return { cfg, site, identity };
  }

  private unavailable(): never { throw new ServiceUnavailableException('SharePoint access could not be verified. Try again or ask IT to review the connection.'); }
  private async json(response: Response, maximum = MAX_BYTES): Promise<Record<string, unknown>> {
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) this.unavailable();
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maximum) this.unavailable();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximum) { await reader.cancel(); this.unavailable(); }
        chunks.push(value);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!record(data)) this.unavailable();
      return data;
    } catch { return this.unavailable(); }
  }

  private async token(cfg: SharePointConfiguration, identity: VerifiedEntraAssertion): Promise<string> {
    try {
      const response = await this.http(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', requested_token_use: 'on_behalf_of', assertion: identity.accessToken, scope: SCOPE }),
      });
      if (!response.ok) this.unavailable();
      const body = await this.json(response, 32 * 1024);
      const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean).map(scope => scope === SCOPE ? 'Sites.Selected' : scope) : [];
      if (body.token_type !== 'Bearer' || typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 16_000 ||
          !/^[\x21-\x7e]+$/.test(body.access_token) || !scopes.length || scopes.some(scope => scope !== 'Sites.Selected')) this.unavailable();
      return body.access_token;
    } catch { return this.unavailable(); }
  }

  private async graph(path: string, token: string, budget?: AbortSignal): Promise<Record<string, unknown>> {
    try {
      if (budget?.aborted) this.unavailable();
      const signal = budget ? AbortSignal.any([budget, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
      const response = await this.http(`${GRAPH}${path}`, { method: 'GET', redirect: 'error', signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if ([401, 403, 404].includes(response.status)) throw new ForbiddenException('SharePoint access is not available for this user and site.');
      if (!response.ok) this.unavailable();
      return await this.json(response);
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      return this.unavailable();
    }
  }

  async check(actor: ConnectionsActor, key: string) {
    const { cfg, site, identity } = this.authorize(actor, key);
    const token = await this.token(cfg, identity);
    const metadata = await this.graph(`/sites/${encodeURIComponent(site.siteId)}?$select=id`, token);
    if (metadata.id !== site.siteId) this.unavailable();
    return { serviceId: 'sharepoint' as const, userId: actor.user.id, status: 'VerifiedForCurrentUser' as const, siteKey: key, checkedAt: this.clock().toISOString() };
  }

  private async driveMembership(site: ApprovedSharePointSite, token: string, budget?: AbortSignal): Promise<Set<string>> {
    // ID-only bounded membership proof: never retrieve unapproved library names.
    const data = await this.graph(`/sites/${encodeURIComponent(site.siteId)}/drives?$select=id&$top=50`, token, budget);
    if (!Array.isArray(data.value) || data.value.length > 50) this.unavailable();
    const ids = data.value.map((value: unknown): string => {
      if (!record(value) || typeof value.id !== 'string' || !DRIVE_ID.test(value.id)) this.unavailable();
      return value.id;
    });
    if (new Set(ids).size !== ids.length) this.unavailable();
    return new Set(ids); // No nextLink, counts or pagination hints cross the boundary.
  }

  async libraries(actor: ConnectionsActor, key: string) {
    const { cfg, site, identity } = this.authorize(actor, key);
    if (!site.approvedDriveIds.length) throw new ForbiddenException('No libraries are approved for this site.');
    const token = await this.token(cfg, identity);
    const budget = AbortSignal.timeout(15_000); // Total Graph listing budget; OBO separately capped at 8 seconds.
    const membership = await this.driveMembership(site, token, budget);
    if (site.approvedDriveIds.some(id => !membership.has(id))) this.unavailable();
    const libraries: SharePointLibrary[] = [];
    for (const id of site.approvedDriveIds) {
      const data = await this.graph(`/drives/${encodeURIComponent(id)}?$select=id,name`, token, budget);
      if (data.id !== id || !text(data.name)) this.unavailable();
      libraries.push({ id, name: data.name });
    }
    return { serviceId: 'sharepoint' as const, userId: actor.user.id, siteKey: key, checkedAt: this.clock().toISOString(), libraries, hasMore: false };
  }

  async items(actor: ConnectionsActor, key: string, driveId: string) {
    const { cfg, site, identity } = this.authorize(actor, key);
    if (!DRIVE_ID.test(driveId) || !site.approvedDriveIds.includes(driveId)) throw new ForbiddenException('This library is not available in the approved site.');
    const token = await this.token(cfg, identity);
    const membership = await this.driveMembership(site, token); // Never trust a client drive ID or previous listing.
    if (!membership.has(driveId)) this.unavailable();
    const data = await this.graph(`/drives/${encodeURIComponent(driveId)}/root/children?$select=id,name,size,lastModifiedDateTime,file,folder,webUrl,remoteItem&$top=25`, token);
    if (!Array.isArray(data.value) || data.value.length > 25) this.unavailable();
    const items = data.value.map((value: unknown): SharePointItem => {
      if (!record(value) || typeof value.id !== 'string' || !DRIVE_ID.test(value.id) || !text(value.name) || (record(value.file) === record(value.folder))) this.unavailable();
      const date = typeof value.lastModifiedDateTime === 'string' && value.lastModifiedDateTime.length <= 40 && Number.isFinite(Date.parse(value.lastModifiedDateTime)) ? new Date(value.lastModifiedDateTime).toISOString() : null;
      const webUrl = record(value.file) && value.remoteItem == null ? approvedBrowserUrl(value.webUrl, site.host) : undefined;
      return { ...(webUrl ? { webUrl } : {}), id: value.id, name: value.name, kind: record(value.folder) ? 'folder' : 'file', size: typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0 ? value.size : null, lastModifiedAt: date };
    });
    if (new Set(items.map(item => item.id)).size !== items.length) this.unavailable();
    return { serviceId: 'sharepoint' as const, userId: actor.user.id, siteKey: key, driveId, checkedAt: this.clock().toISOString(), items, hasMore: typeof data['@odata.nextLink'] === 'string' };
  }
}
