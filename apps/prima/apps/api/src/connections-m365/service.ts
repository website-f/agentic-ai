/**
 * Microsoft 365 Connections (Arisha main review 2 Nov 2026, section B): one truthful status per person for Outlook,
 * Teams and SharePoint, using that person's own delegated Microsoft identity.
 *
 * - "connected" only after Microsoft answered a read-only check for THIS person; never from Prima sign-in, a saved link,
 *   a setup request or a successful login.
 * - Status is keyed by tenant + Entra object ID + Prima user + service. Another identity never sees it.
 * - Prima stores no Microsoft token. It keeps only the outcome of the last check, in memory: a verified status is shown
 *   for 8 hours, then it asks for a fresh check; any record is dropped after 24 hours or on disconnect.
 * - Duplicate clicks share one provider call. A disconnect during a check discards that check's late result.
 * - Retry-After is respected: no provider call until it has passed.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { User } from '@prima/core';
import type { VerifiedEntraAssertion } from '../auth';
import { sharePointConfiguration, type ApprovedSharePointSite } from '../connections';
import { delegatedApp, type DelegatedActor, type DelegatedApp } from '../connections-mail/delegated';
import { sharePointRequestUrl } from '../sharepoint-requests';
import { M365_ROLES, type M365Service } from './capabilities';
import { teamsChannelLink, teamsOpenUrl } from './links';
import { graphGet, obo, ProviderError, type Http, type ProviderFailure } from './provider';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const LOCAL_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const VERIFIED_FOR_MS = 8 * 60 * 60 * 1000;
export const RECORD_KEPT_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS = 5000;

export type ConnectionState = 'not_configured' | 'configured' | 'consent_needed' | 'connected' | 'expired_or_revoked' | 'unavailable';
export type ConnectionReason =
  | 'FeatureDisabled' | 'ServerConfigurationRequired' | 'NoApprovedResources' | 'RoleNotEligible' | 'MicrosoftSignInRequired'
  | 'NotChecked' | 'CheckExpired' | 'Disconnected' | 'Verified'
  | 'ConsentRequired' | 'ConsentRevoked' | 'ReauthenticationRequired' | 'SessionExpired'
  | 'AccessDenied' | 'NotTeamMember' | 'RateLimited' | 'ProviderUnavailable' | 'UnexpectedScopes';
export type ConnectionAction = 'check' | 'reconnect' | 'disconnect';

export interface ServiceStatus {
  service: M365Service;
  state: ConnectionState;
  reason: ConnectionReason;
  /** Approved teams or sites this person may check (empty for Outlook). */
  resources: { key: string; name: string }[];
  resourceKey?: string;
  /** When Microsoft last answered for this person (verified or refused). */
  checkedAt?: string;
  /** Verified status is shown until this time, then a fresh check is needed. */
  validUntil?: string;
  retryAfterSeconds?: number;
  /** Claims challenge for this person's own browser to pass to Microsoft sign-in. Not a secret, never a token. */
  claims?: string;
  actions: ConnectionAction[];
}
export interface M365Status {
  userId: string;
  services: ServiceStatus[];
  /** Teams Approvals evidence is not built. Never shown as connected. */
  teamsApprovals: { state: 'not_built'; canApplyApprovals: false };
}

export type LinkOutcome = 'Verified' | 'NotAMember' | 'NotApprovedOrNoAccess' | 'WrongOrganization' | 'WrongCompany' | 'NotApproved'
  | 'SiteVerifiedLibraryNotApproved' | 'SiteVerifiedLibraryNotFound' | 'Failed';
export interface LinkResult {
  service: 'teams' | 'sharepoint';
  userId: string;
  outcome: LinkOutcome;
  checkedAt: string;
  /** Teams only, when verified: standard, private or shared. */
  membershipType?: 'standard' | 'private' | 'shared';
  /** Teams only, when verified: an address rebuilt from validated IDs. */
  openUrl?: string;
  /** The approved team or site the link belongs to, when verified. */
  resourceKey?: string;
  /** What Microsoft actually confirmed: one channel, a whole site, or one approved library. */
  verifiedScope?: 'channel' | 'site' | 'library';
  /** When outcome is Failed: why (consent, session, throttling...). */
  reason?: ConnectionReason;
  retryAfterSeconds?: number;
  /** SharePoint: the normalized site or library address (no query, no token). */
  canonicalUrl?: string;
  /** A link check never changes the connection status above; it is shown for context only. */
  status: ServiceStatus;
}

export interface ApprovedTeam { key: string; name: string; teamId: string; companyIds: string[] }

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const name = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every(x => typeof x === 'string' && LOCAL_ID.test(x)) && new Set(v).size === v.length;

/** Approved teams: [{key, name, teamId, companyIds}]. Anything malformed means Teams is not configured. */
export function approvedTeams(raw: string | undefined): ApprovedTeam[] | null {
  if (!raw || raw.length > 32_000) return null;
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length || list.length > 100) return null;
    const out: ApprovedTeam[] = [];
    for (const t of list) {
      if (!obj(t) || Object.keys(t).some(k => !['key', 'name', 'teamId', 'companyIds'].includes(k))) return null;
      if (typeof t.key !== 'string' || !KEY.test(t.key) || !name(t.name) || typeof t.teamId !== 'string' || !GUID.test(t.teamId) || !ids(t.companyIds)) return null;
      if (out.some(o => o.key === t.key || o.teamId === t.teamId)) return null;
      out.push({ key: t.key, name: t.name, teamId: t.teamId, companyIds: [...t.companyIds] });
    }
    return out;
  } catch { return null; }
}

interface Config {
  enabled: boolean;
  outlook: DelegatedApp | null;
  teams: { app: DelegatedApp; teams: ApprovedTeam[] } | null;
  teamsReason: ConnectionReason;
  sharepoint: { app: DelegatedApp; sites: ApprovedSharePointSite[] } | null;
  sharepointReason: ConnectionReason;
  outlookReason: ConnectionReason;
}

export function m365Config(env: NodeJS.ProcessEnv): Config {
  const enabled = env.M365_CONNECTIONS_ENABLED === 'true';
  const app = delegatedApp(env, 'M365_OBO_CLIENT_SECRET');
  const outlookOn = env.M365_OUTLOOK_ENABLED === 'true';
  const teamsOn = env.M365_TEAMS_ENABLED === 'true';
  const teams = approvedTeams(env.M365_TEAMS_APPROVED_JSON);
  const sp = sharePointConfiguration(env);
  return {
    enabled,
    outlook: outlookOn && app ? app : null,
    outlookReason: !outlookOn ? 'FeatureDisabled' : 'ServerConfigurationRequired',
    teams: teamsOn && app && teams ? { app, teams } : null,
    teamsReason: !teamsOn ? 'FeatureDisabled' : !env.M365_TEAMS_APPROVED_JSON?.trim() ? 'NoApprovedResources' : 'ServerConfigurationRequired',
    sharepoint: sp ? { app: { tenantId: sp.tenantId, clientId: sp.clientId, clientSecret: sp.clientSecret }, sites: sp.sites } : null,
    sharepointReason: env.SHAREPOINT_CONNECTION_ENABLED !== 'true' ? 'FeatureDisabled' : !env.SHAREPOINT_APPROVED_SITES_JSON?.trim() ? 'NoApprovedResources' : 'ServerConfigurationRequired',
  };
}

/**
 * Every stored outcome is bound to the exact app registration, tenant and immutable Microsoft resource ID it was checked
 * against. If IT replaces a team or site ID under the same key, or the app registration changes, the old outcome no
 * longer matches and is never shown.
 */
type Stored =
  | { kind: 'verified'; at: number; binding: string; resourceKey?: string }
  | { kind: 'failed'; at: number; binding: string; failure: ProviderFailure; resourceKey?: string; retryUntil?: number; claims?: string; wasVerified: boolean }
  | { kind: 'disconnected'; at: number };

const FAILURE_STATE: Record<ProviderFailure, [ConnectionState, ConnectionReason]> = {
  ConsentRequired: ['consent_needed', 'ConsentRequired'],
  ReauthenticationRequired: ['expired_or_revoked', 'ReauthenticationRequired'],
  SessionExpired: ['expired_or_revoked', 'SessionExpired'],
  AccessDenied: ['unavailable', 'AccessDenied'],
  RateLimited: ['unavailable', 'RateLimited'],
  ProviderUnavailable: ['unavailable', 'ProviderUnavailable'],
  UnexpectedScopes: ['unavailable', 'UnexpectedScopes'],
};

export class M365Connections {
  private records = new Map<string, Stored>();
  private generations = new Map<string, number>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly http: Http = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now() { return this.clock().getTime(); }

  // ---------- identity and scope ----------

  private eligible(user: User) { return !user.integration && (M365_ROLES as readonly string[]).includes(user.role); }

  /** Request-local Entra evidence for exactly this Prima user, its current object-ID link and the configured tenant. */
  private identity(actor: DelegatedActor, tenantId: string): VerifiedEntraAssertion | null {
    const a = actor.assertion;
    if (!a || a.userId !== actor.user.id || a.tenantId.toLowerCase() !== tenantId || !actor.user.entraOid ||
        actor.user.entraOid.toLowerCase() !== a.oid.toLowerCase() || !a.accessToken) return null;
    return a;
  }

  private key(identity: VerifiedEntraAssertion, userId: string, service: M365Service) {
    return `${identity.tenantId.toLowerCase()}|${identity.oid.toLowerCase()}|${userId}|${service}`;
  }

  private teamsFor(actor: DelegatedActor, cfg: Config) {
    return (cfg.teams?.teams ?? []).filter(t => t.companyIds.every(c => actor.visibleCompanyIds.includes(c)));
  }
  private sitesFor(actor: DelegatedActor, cfg: Config) {
    return (cfg.sharepoint?.sites ?? []).filter(s => s.allowedUserIds.includes(actor.user.id) && s.companyIds.every(c => actor.visibleCompanyIds.includes(c)));
  }

  private appFor(cfg: Config, service: M365Service): DelegatedApp | null {
    return service === 'outlook' ? cfg.outlook : service === 'teams' ? cfg.teams?.app ?? null : cfg.sharepoint?.app ?? null;
  }

  /** tenant | app | service | key | immutable Microsoft ID (team ID, site ID; the mailbox owner for Outlook). */
  private binding(cfg: Config, service: M365Service, resourceKey?: string): string | null {
    const app = this.appFor(cfg, service);
    if (!app) return null;
    const id = service === 'outlook' ? 'me' : service === 'teams' ? cfg.teams?.teams.find(t => t.key === resourceKey)?.teamId : cfg.sharepoint?.sites.find(s => s.key === resourceKey)?.siteId;
    if (!id) return null;
    return `${app.tenantId}|${app.clientId}|${service}|${resourceKey ?? ''}|${id.toLowerCase()}`;
  }

  // ---------- stored outcomes ----------

  private read(key: string): Stored | undefined {
    const r = this.records.get(key);
    if (r && this.now() - r.at > RECORD_KEPT_MS) { this.records.delete(key); return; }
    return r;
  }
  private write(key: string, value: Stored) {
    const now = this.now();
    this.records.delete(key);
    for (const [k, v] of this.records) if (now - v.at > RECORD_KEPT_MS) this.records.delete(k);
    while (this.records.size >= MAX_RECORDS) this.records.delete(this.records.keys().next().value as string);
    this.records.set(key, value);
  }
  private generation(key: string) { return this.generations.get(key) ?? 0; }

  // ---------- status ----------

  private gate(actor: DelegatedActor, cfg: Config, service: M365Service): { status: ServiceStatus } | { app: DelegatedApp; identity: VerifiedEntraAssertion; resources: { key: string; name: string }[] } {
    const resources = service === 'teams' ? this.teamsFor(actor, cfg).map(t => ({ key: t.key, name: t.name }))
      : service === 'sharepoint' ? this.sitesFor(actor, cfg).map(s => ({ key: s.key, name: s.name })) : [];
    const stop = (state: ConnectionState, reason: ConnectionReason) => ({ status: { service, state, reason, resources: [], actions: [] as ConnectionAction[] } });
    if (!cfg.enabled) return stop('not_configured', 'FeatureDisabled');
    if (!this.eligible(actor.user)) return stop('unavailable', 'RoleNotEligible');
    const app = this.appFor(cfg, service);
    if (!app) return stop('not_configured', service === 'outlook' ? cfg.outlookReason : service === 'teams' ? cfg.teamsReason : cfg.sharepointReason);
    if (service !== 'outlook' && !resources.length) return stop('not_configured', 'NoApprovedResources');
    const identity = this.identity(actor, app.tenantId);
    if (!identity) return { status: { service, state: 'unavailable', reason: 'MicrosoftSignInRequired', resources, actions: [] } };
    return { app, identity, resources };
  }

  private describe(cfg: Config, service: M365Service, resources: { key: string; name: string }[], stored: Stored | undefined): ServiceStatus {
    const now = this.now();
    const base = { service, resources };
    if (!stored) return { ...base, state: 'configured', reason: 'NotChecked', actions: ['check'] };
    // Checked against a different team/site ID or app registration than the one configured now: not this resource.
    if (stored.kind !== 'disconnected' && stored.binding !== this.binding(cfg, service, stored.resourceKey)) return { ...base, state: 'configured', reason: 'NotChecked', actions: ['check', 'disconnect'] };
    if (stored.kind === 'disconnected') return { ...base, state: 'configured', reason: 'Disconnected', actions: ['check'] };
    const checkedAt = new Date(stored.at).toISOString();
    const resourceKey = stored.resourceKey;
    // A team or site that is no longer approved for this person is never shown as connected.
    if (resourceKey && !resources.some(r => r.key === resourceKey)) return { ...base, state: 'configured', reason: 'NotChecked', actions: ['check', 'disconnect'] };
    if (stored.kind === 'verified') {
      if (now - stored.at >= VERIFIED_FOR_MS) return { ...base, state: 'configured', reason: 'CheckExpired', checkedAt, ...(resourceKey ? { resourceKey } : {}), actions: ['check', 'disconnect'] };
      return { ...base, state: 'connected', reason: 'Verified', checkedAt, validUntil: new Date(stored.at + VERIFIED_FOR_MS).toISOString(), ...(resourceKey ? { resourceKey } : {}), actions: ['check', 'disconnect'] };
    }
    const [state, reason0] = FAILURE_STATE[stored.failure];
    const reason: ConnectionReason = stored.failure === 'ConsentRequired' && stored.wasVerified ? 'ConsentRevoked'
      : service === 'teams' && stored.failure === 'AccessDenied' ? 'NotTeamMember' : reason0;
    const waiting = stored.retryUntil && stored.retryUntil > now ? Math.ceil((stored.retryUntil - now) / 1000) : undefined;
    const actions: ConnectionAction[] = state === 'consent_needed' || state === 'expired_or_revoked' ? ['reconnect', 'disconnect'] : waiting ? ['disconnect'] : ['check', 'disconnect'];
    return { ...base, state, reason, checkedAt, ...(resourceKey ? { resourceKey } : {}), ...(waiting ? { retryAfterSeconds: waiting } : {}), ...(stored.claims ? { claims: stored.claims } : {}), actions };
  }

  private one(actor: DelegatedActor, cfg: Config, service: M365Service): ServiceStatus {
    const g = this.gate(actor, cfg, service);
    if ('status' in g) return g.status;
    return this.describe(cfg, service, g.resources, this.read(this.key(g.identity, actor.user.id, service)));
  }

  status(actor: DelegatedActor): M365Status {
    const cfg = m365Config(this.env());
    return {
      userId: actor.user.id,
      services: (['outlook', 'teams', 'sharepoint'] as const).map(s => this.one(actor, cfg, s)),
      teamsApprovals: { state: 'not_built', canApplyApprovals: false },
    };
  }

  // ---------- checks ----------

  private service(value: unknown): M365Service {
    if (value !== 'outlook' && value !== 'teams' && value !== 'sharepoint') throw new BadRequestException('Unknown connection.');
    return value;
  }

  /** Single flight per key: a second click while the first is running gets the same answer. */
  private shared<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const p = run().finally(() => { if (this.inflight.get(key) === p) this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }

  private remember(key: string, generation: number, outcome: Stored) {
    // A disconnect (or a newer check) while this one ran wins; this late result is discarded.
    if (this.generation(key) === generation) this.write(key, outcome);
  }

  private failure(key: string, e: unknown, binding: string, resourceKey?: string): Stored {
    const err = e instanceof ProviderError ? e : new ProviderError('ProviderUnavailable');
    const prior = this.read(key);
    const wasVerified = prior?.kind === 'verified' || (prior?.kind === 'failed' && prior.wasVerified);
    return { kind: 'failed', at: this.now(), binding, failure: err.reason, ...(resourceKey ? { resourceKey } : {}),
      ...(err.retryAfterSeconds ? { retryUntil: this.now() + err.retryAfterSeconds * 1000 } : {}),
      ...(err.claims ? { claims: err.claims } : {}), wasVerified };
  }

  /** Microsoft asked us to wait (Retry-After): no provider call until then. */
  private waiting(key: string) {
    const prior = this.read(key);
    return prior?.kind === 'failed' && !!prior.retryUntil && prior.retryUntil > this.now();
  }

  async check(actor: DelegatedActor, serviceValue: unknown, resourceKey?: unknown): Promise<ServiceStatus> {
    const service = this.service(serviceValue);
    const cfg = m365Config(this.env());
    const g = this.gate(actor, cfg, service);
    if ('status' in g) return g.status;
    if (service === 'outlook' ? resourceKey !== undefined : typeof resourceKey !== 'string' || !g.resources.some(r => r.key === resourceKey)) {
      throw new ForbiddenException(service === 'outlook' ? 'Outlook takes no resource.' : 'Choose a team or site approved for you.');
    }
    const key = this.key(g.identity, actor.user.id, service);
    if (this.waiting(key)) return this.describe(cfg, service, g.resources, this.read(key));
    const rk = typeof resourceKey === 'string' ? resourceKey : undefined;
    const binding = this.binding(cfg, service, rk)!;
    return this.shared(`${key}|check|${binding}`, async () => {
      const generation = this.generation(key);
      try {
        await this.probe(cfg, g.app, g.identity, service, rk);
        this.remember(key, generation, { kind: 'verified', at: this.now(), binding, ...(rk ? { resourceKey: rk } : {}) });
      } catch (e) {
        this.remember(key, generation, this.failure(key, e, binding, rk));
      }
      // Re-read the configuration: an ID replaced while Microsoft was answering must not inherit this result.
      return this.describe(m365Config(this.env()), service, g.resources, this.read(key));
    });
  }

  private async probe(cfg: Config, app: DelegatedApp, identity: VerifiedEntraAssertion, service: M365Service, resourceKey?: string) {
    const now = () => this.now();
    if (service === 'outlook') {
      const token = await obo(this.http, app, identity, 'Mail.ReadBasic', now);
      const folder = await graphGet(this.http, '/me/mailFolders/inbox?$select=id', token, now);
      if (typeof folder.id !== 'string' || !folder.id) throw new ProviderError('ProviderUnavailable');
      return;
    }
    if (service === 'teams') {
      const team = cfg.teams!.teams.find(t => t.key === resourceKey)!;
      const token = await obo(this.http, app, identity, 'Team.ReadBasic.All', now);
      // joinedTeams takes no query options. Only the IDs are used; names and other fields are dropped here.
      const joined = await graphGet(this.http, '/me/joinedTeams', token, now);
      if (!Array.isArray(joined.value)) throw new ProviderError('ProviderUnavailable');
      const member = joined.value.some(v => obj(v) && typeof v.id === 'string' && v.id.toLowerCase() === team.teamId);
      // Not in the list: Microsoft says this person is not a team member (they may still belong to one shared channel,
      // which the channel link check confirms separately). A paged answer that might hide it is not proof.
      if (!member) throw new ProviderError(typeof joined['@odata.nextLink'] === 'string' ? 'ProviderUnavailable' : 'AccessDenied');
      return;
    }
    const site = cfg.sharepoint!.sites.find(s => s.key === resourceKey)!;
    const token = await obo(this.http, app, identity, 'Sites.Selected', now);
    const data = await graphGet(this.http, `/sites/${encodeURIComponent(site.siteId)}?$select=id`, token, now);
    if (data.id !== site.siteId) throw new ProviderError('ProviderUnavailable');
  }

  async disconnect(actor: DelegatedActor, serviceValue: unknown): Promise<ServiceStatus> {
    const service = this.service(serviceValue);
    const cfg = m365Config(this.env());
    const g = this.gate(actor, cfg, service);
    if ('status' in g) return g.status;
    const key = this.key(g.identity, actor.user.id, service);
    this.generations.set(key, this.generation(key) + 1);
    this.write(key, { kind: 'disconnected', at: this.now() });
    return this.describe(cfg, service, g.resources, this.read(key));
  }

  // ---------- link checks ----------
  // A link check answers one question about one link. It never changes the connection status, so a verified channel or
  // library can never make the whole team or site look connected, and a refused one never makes it look broken.

  private linkWaits = new Map<string, number>();
  private linkFailure(key: string, e: unknown): { reason: ConnectionReason; retryAfterSeconds?: number } {
    const err = e instanceof ProviderError ? e : new ProviderError('ProviderUnavailable');
    if (err.retryAfterSeconds) this.linkWaits.set(key, this.now() + err.retryAfterSeconds * 1000);
    return { reason: FAILURE_STATE[err.reason][1], ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}) };
  }
  private linkWaiting(key: string): { reason: ConnectionReason; retryAfterSeconds: number } | null {
    const until = this.linkWaits.get(key);
    if (!until || until <= this.now()) { this.linkWaits.delete(key); return null; }
    return { reason: 'RateLimited', retryAfterSeconds: Math.ceil((until - this.now()) / 1000) };
  }

  async teamsLink(actor: DelegatedActor, url: unknown): Promise<LinkResult> {
    const link = teamsChannelLink(url);
    const cfg = m365Config(this.env());
    const g = this.gate(actor, cfg, 'teams');
    const result = (outcome: LinkOutcome, status: ServiceStatus, extra: Partial<LinkResult> = {}): LinkResult => ({ service: 'teams', userId: actor.user.id, outcome, checkedAt: this.clock().toISOString(), ...extra, status });
    if ('status' in g) return result('Failed', g.status, { reason: g.status.reason });
    const key = this.key(g.identity, actor.user.id, 'teams');
    const current = () => this.describe(m365Config(this.env()), 'teams', g.resources, this.read(key));
    if (link.tenantId !== g.app.tenantId) return result('WrongOrganization', current());
    const team = cfg.teams!.teams.find(t => t.teamId === link.teamId);
    if (!team) return result('NotApproved', current());
    if (!g.resources.some(r => r.key === team.key)) return result('WrongCompany', current());
    const wait = this.linkWaiting(key);
    if (wait) return result('Failed', current(), wait);
    return this.shared(`${key}|teams-link|${link.teamId}|${link.channelId}`, async () => {
      const now = () => this.now();
      try {
        const token = await obo(this.http, g.app, g.identity, 'Channel.ReadBasic.All', now);
        const channel = await graphGet(this.http, `/teams/${link.teamId}/channels/${encodeURIComponent(link.channelId)}?$select=id,membershipType`, token, now);
        const type = channel.membershipType;
        if (channel.id !== link.channelId || (type !== 'standard' && type !== 'private' && type !== 'shared')) throw new ProviderError('ProviderUnavailable');
        // Confirms THIS channel only. A shared-channel member may not belong to the team; team status is unchanged.
        return result('Verified', current(), { membershipType: type, openUrl: teamsOpenUrl(link), resourceKey: team.key, verifiedScope: 'channel' });
      } catch (e) {
        if (e instanceof ProviderError && e.reason === 'AccessDenied') return result('NotAMember', current());
        return result('Failed', current(), this.linkFailure(key, e));
      }
    });
  }

  async sharePointLink(actor: DelegatedActor, url: unknown): Promise<LinkResult> {
    const parsed = sharePointRequestUrl(url);
    const cfg = m365Config(this.env());
    const g = this.gate(actor, cfg, 'sharepoint');
    const result = (outcome: LinkOutcome, status: ServiceStatus, extra: Partial<LinkResult> = {}): LinkResult => ({ service: 'sharepoint', userId: actor.user.id, outcome, checkedAt: this.clock().toISOString(), canonicalUrl: parsed.canonicalUrl, ...extra, status });
    if ('status' in g) return result('Failed', g.status, { reason: g.status.reason });
    const key = this.key(g.identity, actor.user.id, 'sharepoint');
    const current = () => this.describe(m365Config(this.env()), 'sharepoint', g.resources, this.read(key));
    const all = cfg.sharepoint!.sites;
    // Only the organization's own approved hosts are ever looked up; anything else is refused without a call.
    if (!all.some(s => s.host === parsed.host)) return result('WrongOrganization', current());
    const mine = this.sitesFor(actor, cfg);
    if (!mine.some(s => s.host === parsed.host)) return result('NotApproved', current());
    const wait = this.linkWaiting(key);
    if (wait) return result('Failed', current(), wait);
    const path = new URL(parsed.canonicalUrl).pathname.split('/').slice(1, 3); // ['sites'|'teams', encoded name]
    return this.shared(`${key}|sp-link|${parsed.canonicalUrl}`, async () => {
      const now = () => this.now();
      try {
        const token = await obo(this.http, g.app, g.identity, 'Sites.Selected', now);
        const data = await graphGet(this.http, `/sites/${parsed.host}:/${path[0]}/${path[1]}?$select=id`, token, now);
        if (typeof data.id !== 'string') throw new ProviderError('ProviderUnavailable');
        const site = all.find(s => s.siteId === data.id);
        if (!site) return result('NotApproved', current());
        if (!mine.some(s => s.key === site.key)) return result('WrongCompany', current());
        if (parsed.kind === 'site') return result('Verified', current(), { resourceKey: site.key, verifiedScope: 'site' });
        // A library link is checked as that library: Microsoft must list it for this person on this site, and IT must
        // have approved its drive ID. Otherwise only the parent site is reported as confirmed.
        const drives = await graphGet(this.http, `/sites/${encodeURIComponent(site.siteId)}/drives?$select=id,webUrl&$top=50`, token, now);
        if (!Array.isArray(drives.value) || drives.value.length > 50) throw new ProviderError('ProviderUnavailable');
        const norm = (u: string) => { try { const x = new URL(u); return x.hostname === parsed.host ? decodeURIComponent(x.pathname).replace(/\/$/, '').toLowerCase() : null; } catch { return null; } };
        const target = norm(parsed.canonicalUrl);
        const drive = drives.value.find(d => obj(d) && typeof d.id === 'string' && typeof d.webUrl === 'string' && norm(d.webUrl) === target) as { id: string } | undefined;
        if (!drive) return result('SiteVerifiedLibraryNotFound', current(), { resourceKey: site.key, verifiedScope: 'site' });
        if (!site.approvedDriveIds.includes(drive.id)) return result('SiteVerifiedLibraryNotApproved', current(), { resourceKey: site.key, verifiedScope: 'site' });
        return result('Verified', current(), { resourceKey: site.key, verifiedScope: 'library' });
      } catch (e) {
        // With Sites.Selected, Microsoft refuses both "not approved for Prima" and "you cannot open it" the same way.
        if (e instanceof ProviderError && e.reason === 'AccessDenied') return result('NotApprovedOrNoAccess', current());
        return result('Failed', current(), this.linkFailure(key, e));
      }
    });
  }
}
