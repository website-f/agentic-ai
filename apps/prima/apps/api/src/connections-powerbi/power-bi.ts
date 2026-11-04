import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { boundedJson, delegatedApp, GUID, idList, KEY, label, linkedIdentity, onBehalfOf, record, TIMEOUT_MS, type DelegatedActor, type DelegatedApp } from '../connections-mail/delegated';

/**
 * Power BI "embed for your organization" (user owns data): each viewer sees an approved report under THEIR
 * OWN Microsoft identity, so Power BI workspace permissions and dataset row-level security still decide what
 * they see. Never Publish to web, never app-owns-data embed tokens, never a service principal identity.
 */
export const POWERBI_SCOPE = 'https://analysis.windows.net/powerbi/api/Report.Read.All';
const API = 'https://api.powerbi.com/v1.0/myorg';
const SERVICE_HOST = 'app.powerbi.com';

export interface ApprovedPowerBiReport {
  key: string;
  name: string;
  workspaceId: string;
  reportId: string;
  companyIds: string[];
  allowedUserIds: string[];
}
interface PowerBiConfiguration { app: DelegatedApp; reports: ApprovedPowerBiReport[] }
interface PowerBiIdentity { serviceId: 'powerbi'; userId: string }
export interface PowerBiStatus extends PowerBiIdentity { status: 'NotConfigured' | 'ConfiguredNotVerified'; reports: { key: string; name: string }[] }
export interface PowerBiCheck extends PowerBiIdentity { status: 'VerifiedForCurrentUser'; reportKey: string; checkedAt: string }
export interface PowerBiEmbed extends PowerBiIdentity {
  status: 'VerifiedForCurrentUser';
  reportKey: string;
  name: string;
  reportId: string;
  embedUrl: string;
  /** The browser gets its own Power BI token through MSAL for this scope; the API never hands out tokens. */
  tokenType: 'Aad';
  tokenScopes: string[];
  openInService: { url: string; label: string };
  checkedAt: string;
}

/** Invalid, missing or disabled configuration is NotConfigured, never a broad connection. */
export function powerBiConfiguration(env: NodeJS.ProcessEnv): PowerBiConfiguration | null {
  if (env.POWERBI_CONNECTION_ENABLED !== 'true') return null;
  const app = delegatedApp(env, 'POWERBI_OBO_CLIENT_SECRET');
  const raw = env.POWERBI_APPROVED_REPORTS_JSON ?? '';
  if (!app || raw.length > 32_000) return null;
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length || list.length > 30) return null;
    const reports: ApprovedPowerBiReport[] = [];
    for (const r of list) {
      // Unknown keys (embedToken, publishToWebUrl, servicePrincipal, url...) are refused, not ignored.
      if (!record(r) || Object.keys(r).some(k => !['key', 'name', 'workspaceId', 'reportId', 'companyIds', 'allowedUserIds'].includes(k)) ||
          typeof r.key !== 'string' || !KEY.test(r.key) || !label(r.name) ||
          typeof r.workspaceId !== 'string' || !GUID.test(r.workspaceId) || typeof r.reportId !== 'string' || !GUID.test(r.reportId) ||
          !idList(r.companyIds) || !idList(r.allowedUserIds)) return null;
      if (reports.some(x => x.key === r.key || x.reportId === r.reportId)) return null;
      reports.push({ key: r.key, name: r.name, workspaceId: r.workspaceId, reportId: r.reportId, companyIds: [...r.companyIds], allowedUserIds: [...r.allowedUserIds] });
    }
    return { app, reports };
  } catch { return null; }
}

export class PowerBiReports {
  constructor(
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly http: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private allowed(actor: DelegatedActor, r: ApprovedPowerBiReport): boolean {
    return !actor.user.integration && r.allowedUserIds.includes(actor.user.id) && r.companyIds.every(id => actor.visibleCompanyIds.includes(id));
  }

  status(actor: DelegatedActor): PowerBiStatus {
    const cfg = powerBiConfiguration(this.env());
    const identity = { serviceId: 'powerbi' as const, userId: actor.user.id };
    if (!cfg) return { ...identity, status: 'NotConfigured', reports: [] };
    return { ...identity, status: 'ConfiguredNotVerified', reports: cfg.reports.filter(r => this.allowed(actor, r)).map(r => ({ key: r.key, name: r.name })) };
  }

  private unavailable(): never { throw new ServiceUnavailableException('Power BI access could not be verified. Try again or ask IT to review the connection.'); }

  /** Access evidence only: the same checks as embed, without returning the embed URL. */
  async check(actor: DelegatedActor, key: string): Promise<PowerBiCheck> {
    const { report, checkedAt } = await this.verified(actor, key);
    return { serviceId: 'powerbi', userId: actor.user.id, status: 'VerifiedForCurrentUser', reportKey: report.key, checkedAt };
  }

  async embed(actor: DelegatedActor, key: string): Promise<PowerBiEmbed> {
    const { report, embedUrl, checkedAt } = await this.verified(actor, key);
    return {
      serviceId: 'powerbi', userId: actor.user.id,
      status: 'VerifiedForCurrentUser', reportKey: report.key, name: report.name, reportId: report.reportId, embedUrl,
      tokenType: 'Aad', tokenScopes: [POWERBI_SCOPE],
      openInService: { url: `https://${SERVICE_HOST}/groups/${report.workspaceId}/reports/${report.reportId}`, label: 'Open in Power BI (opens the Power BI service, not part of Prima)' },
      checkedAt,
    };
  }

  /** Re-checks the allowlist, the user's company access and the user's own Power BI access on every call. */
  private async verified(actor: DelegatedActor, key: string) {
    const cfg = powerBiConfiguration(this.env());
    if (!cfg) throw new ServiceUnavailableException('Power BI is not configured.');
    const report = cfg.reports.find(r => r.key === key);
    if (!report || !this.allowed(actor, report)) throw new ForbiddenException('This report is not available to this user.');
    const identity = linkedIdentity(actor, cfg.app, 'Sign in with your linked Microsoft account to open Power BI reports.');
    const token = await onBehalfOf(this.http, cfg.app, identity, POWERBI_SCOPE, () => this.unavailable());

    let data: Record<string, unknown>;
    try {
      const response = await this.http(`${API}/groups/${report.workspaceId}/reports/${report.reportId}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if ([401, 403, 404].includes(response.status)) throw new ForbiddenException('Power BI says you do not have access to this report.');
      if (!response.ok) this.unavailable();
      data = await boundedJson(response, 64 * 1024, () => this.unavailable());
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      return this.unavailable();
    }
    if (typeof data.id !== 'string' || data.id.toLowerCase() !== report.reportId) this.unavailable();
    return { report, embedUrl: this.secureEmbedUrl(data.embedUrl, report), checkedAt: this.clock().toISOString() };
  }

  /** Only an authenticated /reportEmbed URL for this exact report and workspace. Publish-to-web (/view?r=) never passes. */
  private secureEmbedUrl(value: unknown, report: ApprovedPowerBiReport): string {
    if (typeof value !== 'string' || value.length > 2048) this.unavailable();
    let url: URL;
    try { url = new URL(value as string); } catch { return this.unavailable(); }
    const params = [...url.searchParams.keys()];
    if (url.protocol !== 'https:' || url.hostname !== SERVICE_HOST || url.port || url.username || url.password || url.hash ||
        url.pathname !== '/reportEmbed' || url.searchParams.has('r') ||
        url.searchParams.get('reportId')?.toLowerCase() !== report.reportId ||
        (url.searchParams.has('groupId') && url.searchParams.get('groupId')?.toLowerCase() !== report.workspaceId) ||
        params.some(k => !['reportId', 'groupId', 'w', 'config'].includes(k)) || new Set(params).size !== params.length) this.unavailable();
    return url.toString();
  }
}
