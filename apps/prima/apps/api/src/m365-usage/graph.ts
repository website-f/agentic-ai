import { MY_APPS_APP_ID, RULES, parseReportCsv, type IsoDate, type UsageSources } from '@prima/core';

/**
 * Reads Microsoft's own usage records for the Microsoft use board (rule M365-USE). App-only, READ-ONLY permissions
 * that a Microsoft admin consents to once (Fauzan, 23 Nov 2026: "1. Ok"):
 *  - Reports.Read.All: the active users, mailbox and Office activation reports (counts and dates only);
 *  - AuditLog.Read.All: sign-in method registrations (Authenticator, password reset) and, from the Entra sign-in
 *    log, successful sign-ins to My Apps only (Fauzan, 23 Nov 2026: "1. Yes. 2. Agreed"). Only the account id and
 *    the day are kept; addresses, places, devices and every other field of a sign-in are dropped as they are read;
 *  - DeviceManagementManagedDevices.Read.All: Intune devices and whether they meet the rules.
 * Nothing here reads mail, chats, files or sign-in passwords, and nothing writes to Microsoft. Display names in the
 * report files are dropped as they are read; only sign-in names are used, to match people, and are never stored.
 * A source that fails is null (its checks show Unknown); errors never carry provider bodies or secrets.
 */
/** primaAppId: Prima's own sign-in app (ENTRA_SPA_CLIENT_ID or ENTRA_CLIENT_ID), to count Prima sign-ins; null when not set. */
export interface UsageGraphConfig { tenantId: string; clientId: string; clientSecret: string; primaAppId?: string | null }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const USAGE_TIMEOUT_MS = 20_000;
/** Microsoft hands report files out from its own download host; nothing else is followed. */
const DOWNLOAD_HOST = /(^|\.)(reports\.office\.com|office\.com|microsoft\.com)$/i;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_PAGES = 50;

type Fetch = typeof fetch;
const call = (http: Fetch, url: string, init: RequestInit = {}) => http(url, { ...init, signal: AbortSignal.timeout(USAGE_TIMEOUT_MS) });
const dateOrNull = (v: string | undefined): IsoDate | null => (v && DATE.test(v) ? v : null);
const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function usageGraphConfiguration(env: NodeJS.ProcessEnv): UsageGraphConfig | null {
  const tenantId = env.ENTRA_TENANT_ID?.toLowerCase() ?? '';
  const clientId = env.M365_USAGE_CLIENT_ID?.toLowerCase() ?? '';
  const clientSecret = env.M365_USAGE_CLIENT_SECRET ?? '';
  if (!GUID.test(tenantId) || !GUID.test(clientId) || !clientSecret.trim() || clientSecret.length > 4096) return null;
  const prima = (env.ENTRA_SPA_CLIENT_ID?.trim() || env.ENTRA_CLIENT_ID?.trim() || '').toLowerCase();
  return { tenantId, clientId, clientSecret, primaAppId: GUID.test(prima) ? prima : null };
}

export class GraphUsageReader {
  private token: { value: string; until: number } | null = null;
  constructor(private readonly cfg: UsageGraphConfig, private readonly http: Fetch = fetch, private readonly now: () => number = Date.now) {}

  private async bearer(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, scope: 'https://graph.microsoft.com/.default' });
    const r = await call(this.http, `https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`, { method: 'POST', body, redirect: 'error', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) throw new Error('Usage report sign-in failed.');
    const j = (await r.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== 'string' || !j.access_token) throw new Error('Usage report sign-in failed.');
    const life = typeof j.expires_in === 'number' ? j.expires_in : 600;
    this.token = { value: j.access_token, until: this.now() + Math.max(60, life - 120) * 1000 };
    return j.access_token;
  }

  /** A report file: Graph answers 302 to a short-lived download address that needs no sign-in. */
  private async report(fn: string): Promise<Record<string, string>[]> {
    const r = await call(this.http, `${GRAPH}/reports/${fn}`, { redirect: 'manual', headers: { authorization: `Bearer ${await this.bearer()}` } });
    let text: string;
    if (r.status === 302 || r.status === 303 || r.status === 307) {
      const loc = r.headers.get('location') ?? '';
      let u: URL;
      try {
        u = new URL(loc);
      } catch {
        throw new Error('Usage report download address not valid.');
      }
      if (u.protocol !== 'https:' || u.username || u.password || !DOWNLOAD_HOST.test(u.hostname)) throw new Error('Usage report download address not valid.');
      const d = await call(this.http, u.toString(), { redirect: 'error' });
      if (!d.ok) throw new Error('Usage report download failed.');
      text = await d.text();
    } else if (r.ok) text = await r.text();
    else throw new Error('Usage report not available.');
    return parseReportCsv(text);
  }

  /** A JSON list from Graph, following its next-page links on graph.microsoft.com only. */
  private async list(path: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let url: string | null = `${GRAPH}${path}`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const r = await call(this.http, url, { redirect: 'error', headers: { authorization: `Bearer ${await this.bearer()}` } });
      if (!r.ok) throw new Error('Usage list not available.');
      const j = (await r.json()) as { value?: unknown; '@odata.nextLink'?: unknown };
      if (Array.isArray(j.value)) for (const v of j.value) if (v && typeof v === 'object') out.push(v as Record<string, unknown>);
      const next = j['@odata.nextLink'];
      url = typeof next === 'string' && next.startsWith(`${GRAPH}/`) ? next : null;
    }
    return out;
  }

  private async safely<T>(read: () => Promise<T>, failed: string[], name: string): Promise<T | null> {
    try {
      return await read();
    } catch {
      failed.push(name);
      return null;
    }
  }

  /** Every source, each on its own: one that fails leaves only its own checks Unknown. */
  async read(): Promise<{ sources: UsageSources; failed: string[] }> {
    const failed: string[] = [];
    const active = await this.safely(async () => this.report("getOffice365ActiveUserDetail(period='D30')"), failed, 'active users');
    const mailbox = await this.safely(async () => this.report("getMailboxUsageDetail(period='D7')"), failed, 'mailbox');
    const sharePoint = await this.safely(async () => this.report("getSharePointActivityUserDetail(period='D30')"), failed, 'SharePoint activity');
    const appUse = await this.safely(async () => this.report("getM365AppUserDetail(period='D30')"), failed, 'Microsoft 365 apps');
    const activations = await this.safely(async () => this.report('getOffice365ActivationsUserDetail'), failed, 'Office activations');
    const registrations = await this.safely(
      async () => this.list('/reports/authenticationMethods/userRegistrationDetails?$select=id,userPrincipalName,isMfaRegistered,isSsprRegistered'),
      failed,
      'sign-in methods',
    );
    const devices = await this.safely(async () => this.list('/deviceManagement/managedDevices?$select=userId,complianceState'), failed, 'devices');
    const since = new Date(this.now() - RULES.m365Use.value.activeWithinDays * 86_400_000).toISOString().slice(0, 10);
    const prima = this.cfg.primaAppId ?? null;
    const apps = prima ? `(appId eq '${MY_APPS_APP_ID}' or appId eq '${prima}')` : `appId eq '${MY_APPS_APP_ID}'`;
    const signIns = await this.safely(
      async () => this.list(`/auditLogs/signIns?$filter=${encodeURIComponent(`${apps} and createdDateTime ge ${since}T00:00:00Z`)}&$top=1000`),
      failed,
      'sign-in log',
    );
    /** Successful sign-ins to one app: the account id and the day only; every other field is dropped here. */
    const daysFor = (appId: string) =>
      signIns?.flatMap((m) => {
        const day = typeof m.createdDateTime === 'string' ? dateOrNull(m.createdDateTime.slice(0, 10)) : null;
        const ok = (m.status as { errorCode?: unknown } | undefined)?.errorCode === 0;
        return typeof m.userId === 'string' && m.userId && day && ok && typeof m.appId === 'string' && m.appId.toLowerCase() === appId ? [{ oid: m.userId, day }] : [];
      }) ?? null;
    const refreshed = dateOrNull(active?.[0]?.['Report Refresh Date']);
    return {
      failed,
      sources: {
        refreshed,
        registrations:
          registrations?.flatMap((r) =>
            typeof r.id === 'string' && typeof r.userPrincipalName === 'string' ? [{ oid: r.id, upn: r.userPrincipalName, mfa: r.isMfaRegistered === true, sspr: r.isSsprRegistered === true }] : [],
          ) ?? null,
        active:
          active
            ?.filter((r) => r['Is Deleted'] !== 'True' && r['User Principal Name'])
            .map((r) => ({
              upn: r['User Principal Name'],
              products: r['Assigned Products'] ?? '',
              exchange: dateOrNull(r['Exchange Last Activity Date']),
              oneDrive: dateOrNull(r['OneDrive Last Activity Date']),
              sharePoint: dateOrNull(r['SharePoint Last Activity Date']),
              teams: dateOrNull(r['Teams Last Activity Date']),
            })) ?? null,
        mailbox:
          mailbox
            ?.filter((r) => r['Is Deleted'] !== 'True' && r['User Principal Name'])
            .map((r) => ({ upn: r['User Principal Name'], used: num(r['Storage Used (Byte)']), prohibitSend: num(r['Prohibit Send Quota (Byte)']) })) ?? null,
        sharePoint:
          sharePoint
            ?.filter((r) => r['Is Deleted'] !== 'True' && r['User Principal Name'])
            .map((r) => ({ upn: r['User Principal Name'], last: dateOrNull(r['Last Activity Date']), viewedOrEdited: num(r['Viewed Or Edited File Count']) })) ?? null,
        apps: appUse?.filter((r) => r['User Principal Name']).map((r) => ({ upn: r['User Principal Name'], oneNote: /^(yes|true|1)$/i.test(r['OneNote'] ?? '') })) ?? null,
        activations:
          activations
            ?.filter((r) => r['User Principal Name'])
            .map((r) => ({ upn: r['User Principal Name'], productType: r['Product Type'] ?? '', windows: num(r['Windows']), mac: num(r['Mac']) })) ?? null,
        devices: devices?.flatMap((d) => (typeof d.userId === 'string' && d.userId ? [{ oid: d.userId, compliant: d.complianceState === 'compliant' }] : [])) ?? null,
        myApps: daysFor(MY_APPS_APP_ID),
        primaSignIns: prima ? daysFor(prima) : null,
      },
    };
  }
}
