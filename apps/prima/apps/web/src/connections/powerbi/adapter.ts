import type { Adapter, ConfigurationView, Evidence, ResourceSelection } from '../contract';

/**
 * Power BI adapter: approved reports, viewed as the signed-in user so Power BI permissions and RLS apply.
 * Never Publish to web; the API returns no tokens. Runtime-import free so the offline tests can load it directly.
 */
export type ConnectionsTransport = (method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal) => Promise<unknown>;
export interface PowerBiView { reportKey: string; name: string; embedUrl: string; openInService: { url: string; label: string }; checkedAt: string; userId: string }

/**
 * The reviewed action this panel performs: open an approved report in the Power BI service (a clearly labelled
 * external link). In-app embedding is not built, so this panel declares viewReport, never embedReport or readMetadata.
 */
export const VIEW_REPORT = 'viewReport' as const;

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = (): never => { throw new Error('Invalid Power BI response.'); };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Second line of defence after the server: only an authenticated app.powerbi.com report URL is ever rendered. */
export function safePowerBiUrl(value: unknown, path: 'embed' | 'service'): string {
  if (typeof value !== 'string' || value.length > 2048) return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.protocol !== 'https:' || url.hostname !== 'app.powerbi.com' || url.port || url.username || url.password || url.hash || url.searchParams.has('r')) return invalid();
  if (path === 'embed' && (url.pathname !== '/reportEmbed' || !GUID.test(url.searchParams.get('reportId') ?? ''))) return invalid();
  if (path === 'service' && (!/^\/groups\/[0-9a-f-]{36}\/reports\/[0-9a-f-]{36}$/i.test(url.pathname) || url.search)) return invalid();
  return url.toString();
}

export function powerBiClient(call: ConnectionsTransport) {
  const key = (k: string) => `/connections/powerbi/${encodeURIComponent(k)}`;
  return {
    status: (signal?: AbortSignal) => call('GET', '/connections/powerbi', undefined, signal),
    check: (k: string, signal?: AbortSignal) => call('POST', `${key(k)}/check`, {}, signal),
    /** The answer must be for the signed-in user and the selected report, or it is not shown. */
    async embed(userId: string, k: string, signal?: AbortSignal): Promise<PowerBiView> {
      const r = await call('POST', `${key(k)}/embed`, {}, signal);
      if (!obj(r) || r.serviceId !== 'powerbi' || r.status !== 'VerifiedForCurrentUser' || r.reportKey !== k || typeof r.name !== 'string' ||
          r.userId !== userId || typeof r.checkedAt !== 'string' || r.tokenType !== 'Aad' || !obj(r.openInService) || typeof r.openInService.label !== 'string' ||
          'accessToken' in r || 'embedToken' in r) return invalid();
      return { reportKey: k, name: r.name, userId: r.userId, checkedAt: r.checkedAt, embedUrl: safePowerBiUrl(r.embedUrl, 'embed'),
        openInService: { url: safePowerBiUrl(r.openInService.url, 'service'), label: r.openInService.label } };
    },
  };
}
export type PowerBiClient = ReturnType<typeof powerBiClient>;

export function powerBiAdapterCore(client: PowerBiClient): Omit<Adapter, 'ProviderPanel'> {
  return {
    serviceId: 'powerbi', panelCapability: VIEW_REPORT,
    async getConfiguration(signal): Promise<ConfigurationView> {
      const r = await client.status(signal);
      if (!obj(r) || r.serviceId !== 'powerbi' || typeof r.userId !== 'string' || !['NotConfigured', 'ConfiguredNotVerified'].includes(r.status as string) || !Array.isArray(r.reports) ||
          r.reports.some(x => !obj(x) || typeof x.key !== 'string' || typeof x.name !== 'string')) return invalid();
      const configured = r.status === 'ConfiguredNotVerified';
      const reports = r.reports as { key: string; name: string }[];
      return {
        serviceId: 'powerbi', userId: r.userId, configuration: r.status as ConfigurationView['configuration'],
        resources: configured ? reports.map(x => ({ resourceKey: x.key, label: x.name })) : [],
        capabilities: configured && reports.length ? ['checkAccess', VIEW_REPORT] : [],
        reason: !configured ? 'ConfigurationMissing' : reports.length ? undefined : 'NoApprovedResources',
      };
    },
    async checkAccess(selection: ResourceSelection, signal): Promise<Evidence> {
      const r = await client.check(selection.resourceKey, signal);
      if (!obj(r) || r.serviceId !== 'powerbi' || r.status !== 'VerifiedForCurrentUser' || typeof r.userId !== 'string' || typeof r.reportKey !== 'string' || typeof r.checkedAt !== 'string') return invalid();
      return { serviceId: 'powerbi', userId: r.userId, selection: { resourceKey: r.reportKey }, checkedAt: r.checkedAt, kind: 'AccessVerified' };
    },
  };
}
