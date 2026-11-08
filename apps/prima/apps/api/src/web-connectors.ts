// Read-only website connectors. Configuration and an explicit authorized switch are both required.
// Keys remain server-side; missing configuration never broadens account access.
import type { CfProject, CfZone, ConnectorKey, ConnectorResult, GhRepo, RegistrarDomain, SpRequest, UpMonitor, WebFeed } from '@prima/core';

const TIMEOUT_MS = 8000;
const FEED_TIMEOUT_MS = 30_000;
const MAX_BYTES = 2 * 1024 * 1024;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Env = NodeJS.ProcessEnv;
type Json = Record<string, unknown>;
const rec = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');
const isoDate = (v: unknown): string | null => {
  const s = str(v, 40);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const isoTime = (v: unknown): string | null => {
  const s = str(v, 40);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

type FailureCode = 'REQUEST_FAILED' | 'PROVIDER_REJECTED' | 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'INCOMPLETE_RESPONSE' | 'INVALID_CONFIGURATION' | 'SYNC_TIMEOUT';
class ConnectorFailure extends Error { constructor(readonly code: FailureCode) { super(code); } }
const fail = (code: FailureCode): never => { throw new ConnectorFailure(code); };
function approvedRepos(env: Env): string[] | null {
  const repos = (env.GITHUB_WEBSITES_REPOS ?? '').split(',').map(s => s.trim());
  return repos.length > 0 && repos.length <= 20 && repos.every(s => /^[A-Za-z0-9_.-]{1,100}$/.test(s) && s !== '.' && s !== '..')
    && new Set(repos.map(s => s.toLowerCase())).size === repos.length ? repos : null;
}
function domainBatch(domains: string[]): string[] {
  const names = [...new Set(domains.map(d => d.toLowerCase().trim()))];
  if (names.length > 20 || names.some(d => d.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d))) fail('INCOMPLETE_RESPONSE');
  return names;
}
function cfResult(j: Json, limit: number): unknown[] {
  if (j.success !== true || !Array.isArray(j.result)) fail('INVALID_RESPONSE');
  const rows = j.result as unknown[]; const info = rec(j.result_info);
  if (rows.length >= limit || Number(info.total_pages ?? 1) > 1 || Number(info.total_count ?? rows.length) > rows.length) fail('INCOMPLETE_RESPONSE');
  return rows;
}

/** Which connectors have their settings on this server (not whether the CEO switched them on in Prima). */
export function webConnectorConfig(env: Env) {
  const tenant = env.ENTRA_TENANT_ID ?? '';
  const graphApp = GUID.test(tenant) && GUID.test(env.WEB_GRAPH_CLIENT_ID ?? '') && !!env.WEB_GRAPH_CLIENT_SECRET;
  return {
    cloudflare: !!env.CLOUDFLARE_API_TOKEN && /^[0-9a-f]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? ''),
    github: !!env.GITHUB_WEBSITES_TOKEN && /^[A-Za-z0-9-]{1,39}$/.test(env.GITHUB_WEBSITES_OWNER ?? '') && approvedRepos(env) !== null,
    uptime: !!env.UPTIMEROBOT_API_KEY,
    registrar: env.WEB_RDAP_ENABLED === 'true',
    maildns: env.WEB_MAILDNS_ENABLED === 'true',
    m365: false, // Sending is unavailable, even with legacy configuration.
    sharepoint: graphApp && /^[\w.-]+,[0-9a-f-]{36},[0-9a-f-]{36}$/i.test(env.WEB_REQUESTS_SITE_ID ?? '') && GUID.test(env.WEB_REQUESTS_LIST_ID ?? ''),
  } satisfies Record<ConnectorKey, boolean>;
}

export class WebConnectors {
  constructor(
    private readonly env: () => Env = () => process.env,
    private readonly http: typeof fetch = fetch,
    // Synthetic tests may shorten, but never enlarge, the production budget.
    private readonly budgetMs = FEED_TIMEOUT_MS,
    private readonly syncSignal?: AbortSignal,
  ) {}

  private abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new ConnectorFailure(this.syncSignal?.aborted ? 'SYNC_TIMEOUT' : 'REQUEST_FAILED'));
      if (signal.aborted) { promise.catch(() => undefined); abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  private async get(url: string, headers: Record<string, string>, init: RequestInit = {}): Promise<unknown> {
    if (this.syncSignal?.aborted) fail('SYNC_TIMEOUT');
    const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(this.syncSignal ? [this.syncSignal] : [])]);
    const res = await this.abortable(this.http(url, { ...init, method: init.method ?? 'GET', redirect: 'error', signal, headers: { Accept: 'application/json', ...headers } }), signal);
    if (!res.ok) { void res.body?.cancel().catch(() => undefined); fail('PROVIDER_REJECTED'); }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) { void res.body?.cancel().catch(() => undefined); fail('RESPONSE_TOO_LARGE'); }
    if (!res.body) fail('INVALID_RESPONSE');
    const reader = res.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await this.abortable(reader.read(), signal); if (done) break;
        size += value.byteLength; if (size > MAX_BYTES) fail('RESPONSE_TOO_LARGE'); chunks.push(value);
      }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
      catch { return fail('INVALID_RESPONSE'); }
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }

  private async run<T>(fn: () => Promise<T>): Promise<ConnectorResult<T>> {
    try { return { ok: true, data: await fn() }; }
    catch (e) {
      // Provider bodies, status text, thrown strings, URLs and credentials are never returned.
      return { ok: false, error: e instanceof ConnectorFailure ? e.code : 'REQUEST_FAILED' };
    }
  }

  /** Reads every configured connector the CEO switched on. `domains` are the register's domain names (for RDAP). */
  async feed(on: Record<ConnectorKey, boolean>, domains: string[], at = new Date().toISOString()): Promise<WebFeed> {
    const env = { ...this.env() };
    const cfg = webConnectorConfig(env);
    const signal = AbortSignal.timeout(Math.max(1, Math.min(FEED_TIMEOUT_MS, Number.isFinite(this.budgetMs) ? this.budgetMs : FEED_TIMEOUT_MS)));
    const worker = new WebConnectors(() => env, this.http, this.budgetMs, signal);
    const feed: WebFeed = { at };
    const jobs: Promise<void>[] = [];
    if (on.cloudflare && cfg.cloudflare) jobs.push(worker.run(() => worker.cloudflare()).then((r) => void (feed.cloudflare = r)));
    if (on.github && cfg.github) jobs.push(worker.run(() => worker.github()).then((r) => void (feed.github = r)));
    if (on.uptime && cfg.uptime) jobs.push(worker.run(() => worker.uptime()).then((r) => void (feed.uptime = r)));
    if (on.registrar && cfg.registrar) jobs.push(worker.run(() => worker.rdap(domains)).then((r) => void (feed.registrar = r)));
    if (on.maildns && cfg.maildns) jobs.push(worker.run(() => worker.maildns(domains)).then((r) => void (feed.maildns = r)));
    if (on.sharepoint && cfg.sharepoint) jobs.push(worker.run(() => worker.sharepoint()).then((r) => void (feed.sharepoint = r)));
    await Promise.all(jobs);
    // No newly fetched observation may be applied from a timed-out partial feed.
    if (signal.aborted) for (const key of ['cloudflare', 'github', 'uptime', 'registrar', 'maildns', 'sharepoint'] as const) {
      if (feed[key]) feed[key] = { ok: false, error: 'SYNC_TIMEOUT' };
    }
    return feed;
  }

  // 1. Cloudflare: Pages projects and DNS records, with a read-only API token (Pages Read, Zone Read, DNS Read).
  private async cloudflare(): Promise<{ projects: CfProject[]; zones: CfZone[] }> {
    const env = this.env();
    const h = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
    const base = 'https://api.cloudflare.com/client/v4';
    const pj = rec(await this.get(`${base}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects?per_page=100`, h));
    const projects: CfProject[] = cfResult(pj, 100).map((p) => {
      const x = rec(p);
      const d = rec(x.latest_deployment);
      const trig = rec(rec(d.deployment_trigger).metadata);
      return {
        name: str(x.name, 100),
        domains: [...arr(x.domains).map((v) => str(v, 253)), str(x.subdomain, 253)].filter(Boolean),
        latest: d.id
          ? { at: isoTime(d.created_on) ?? '', status: str(rec(d.latest_stage).status, 30), url: str(d.url, 300), branch: str(trig.branch, 100), commit: str(trig.commit_hash, 64) }
          : null,
      };
    });
    const zj = rec(await this.get(`${base}/zones?per_page=50&account.id=${env.CLOUDFLARE_ACCOUNT_ID}`, h));
    const zones: CfZone[] = [];
    for (const z of cfResult(zj, 50)) {
      const zone = rec(z);
      if (!/^[0-9a-f]{32}$/i.test(str(zone.id, 64))) fail('INVALID_RESPONSE');
      const rj = rec(await this.get(`${base}/zones/${str(zone.id, 64)}/dns_records?per_page=500`, h));
      zones.push({ name: str(zone.name, 253), records: cfResult(rj, 500).map((r) => ({ type: str(rec(r).type, 10), name: str(rec(r).name, 253), content: str(rec(r).content, 2000) })) });
    }
    return { projects, zones };
  }

  // 2. GitHub: website repositories of one owner, with a fine-grained read-only token (Contents and Metadata: read).
  private async github(): Promise<{ repos: GhRepo[] }> {
    const env = this.env();
    const h = { Authorization: `Bearer ${env.GITHUB_WEBSITES_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' };
    const owner = env.GITHUB_WEBSITES_OWNER!;
    const only = approvedRepos(env); if (!only) fail('INVALID_CONFIGURATION');
    const repos: GhRepo[] = [];
    for (const name of only!) {
      const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
      const r = rec(await this.get(base, h));
      if (typeof r.full_name !== 'string' || r.full_name.toLowerCase() !== `${owner}/${name}`.toLowerCase()
        || typeof r.default_branch !== 'string' || !r.default_branch || r.default_branch.length > 255) fail('INVALID_RESPONSE');
      const branch = r.default_branch as string;
      const c = rec(await this.get(`${base}/commits/${encodeURIComponent(branch)}`, h));
      if (typeof c.sha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(c.sha)) fail('INVALID_RESPONSE');
      const cm = rec(c.commit);
      repos.push({
        name,
        url: `https://github.com/${owner}/${name}`,
        pushedAt: isoTime(r.pushed_at),
        branch,
        lastCommit: c.sha ? { sha: str(c.sha, 64), at: isoTime(rec(cm.committer).date) ?? '', message: str(cm.message, 200).split('\n')[0] } : null,
      });
    }
    return { repos };
  }

  // 3. UptimeRobot: monitors with status and certificate expiry, with a read-only API key.
  private async uptime(): Promise<{ monitors: UpMonitor[] }> {
    const body = new URLSearchParams({ api_key: this.env().UPTIMEROBOT_API_KEY!, format: 'json', ssl: '1', logs: '1', logs_limit: '1' });
    const j = rec(await this.get('https://api.uptimerobot.com/v2/getMonitors', { 'Content-Type': 'application/x-www-form-urlencoded' }, { method: 'POST', body }));
    if (j.stat !== 'ok') fail('PROVIDER_REJECTED');
    if (!Array.isArray(j.monitors)) fail('INVALID_RESPONSE');
    if (arr(j.monitors).length >= 50 || Number(rec(j.pagination).total ?? arr(j.monitors).length) > arr(j.monitors).length) fail('INCOMPLETE_RESPONSE');
    const map: Record<number, UpMonitor['status']> = { 0: 'paused', 1: 'unknown', 2: 'up', 8: 'down', 9: 'down' };
    return {
      monitors: arr(j.monitors).map((m) => {
        const x = rec(m);
        const log = rec(arr(x.logs)[0]);
        const ssl = rec(x.ssl);
        return {
          url: str(x.url, 300),
          status: map[Number(x.status)] ?? 'unknown',
          since: typeof log.datetime === 'number' ? new Date(log.datetime * 1000).toISOString() : null,
          sslExpiresOn: typeof ssl.expires === 'number' ? new Date(ssl.expires * 1000).toISOString().slice(0, 10) : null,
        };
      }),
    };
  }

  // 6. Registry expiry through public RDAP (no account, no key). .my is served by MYNIC where it publishes RDAP.
  private async rdap(domains: string[]): Promise<{ domains: RegistrarDomain[] }> {
    const out: RegistrarDomain[] = [];
    for (const name of domainBatch(domains)) {
      // Redirects are not followed. Registry coverage needs a separately reviewed endpoint policy.
      // Any failure aborts this batch visibly; never pretend a skipped registry was a successful empty read.
      const j = rec(await this.get(`https://rdap.org/domain/${name}`, { Accept: 'application/rdap+json' }));
      if (j.objectClassName !== 'domain' || !Array.isArray(j.events)) fail('INVALID_RESPONSE');
      const ev = arr(j.events).map(rec).find(e => e.eventAction === 'expiration');
      const reg = arr(j.entities).map(rec).find(e => arr(e.roles).includes('registrar'));
      const vcard = arr(arr(rec(reg).vcardArray)[1]).map(arr).find(x => x[0] === 'fn');
      out.push({ name, expiresOn: isoDate(ev?.eventDate), registrar: str(vcard?.[3], 120) });
    }
    return { domains: out };
  }

  // Email DNS check: public DNS over HTTPS (Cloudflare resolver), no account or key. Microsoft 365 DKIM uses the
  // selector1 and selector2 CNAME records.
  private async maildns(domains: string[]) {
    const ask = async (name: string, type: 'TXT' | 'CNAME' | 'MX') => {
      const j = rec(await this.get(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { Accept: 'application/dns-json' }));
      if (typeof j.Status !== 'number' || !Number.isInteger(j.Status) || ![0, 3].includes(j.Status)
        || (j.TC !== undefined && typeof j.TC !== 'boolean') || j.TC === true) fail('INCOMPLETE_RESPONSE');
      if (j.Answer !== undefined && !Array.isArray(j.Answer)) fail('INVALID_RESPONSE');
      return arr(j.Answer).map((a) => str(rec(a).data, 2000).replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
    };
    const out: { name: string; spf: string | null; dmarc: string | null; dkim: boolean; mx: string[] }[] = [];
    for (const name of domainBatch(domains)) {
      const [txt, dmarc, k1, k2, mx] = await Promise.all([ask(name, 'TXT'), ask(`_dmarc.${name}`, 'TXT'), ask(`selector1._domainkey.${name}`, 'CNAME'), ask(`selector2._domainkey.${name}`, 'CNAME'), ask(name, 'MX')]);
      out.push({
        name,
        spf: txt.find((t) => /^v=spf1\b/i.test(t)) ?? null,
        dmarc: dmarc.find((t) => /^v=DMARC1\b/i.test(t)) ?? null,
        dkim: k1.length > 0 || k2.length > 0,
        mx: mx.map((m) => m.split(/\s+/).pop() ?? m),
      });
    }
    return { domains: out };
  }

  private async graphToken(): Promise<string> {
    const env = this.env();
    const j = rec(await this.get(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/token`,
      { 'Content-Type': 'application/x-www-form-urlencoded' }, {
        method: 'POST', body: new URLSearchParams({ client_id: env.WEB_GRAPH_CLIENT_ID!, client_secret: env.WEB_GRAPH_CLIENT_SECRET!, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
      }));
    if (typeof j.access_token !== 'string' || !j.access_token || j.access_token.length > 32768) fail('INVALID_RESPONSE');
    return j.access_token as string;
  }

  // 5. SharePoint list "Website requests" (app-only, Sites.Selected granted on that one site only).
  private async sharepoint(): Promise<{ requests: SpRequest[] }> {
    const env = this.env();
    const token = await this.graphToken();
    const j = rec(
      await this.get(`${GRAPH}/sites/${encodeURIComponent(env.WEB_REQUESTS_SITE_ID!)}/lists/${env.WEB_REQUESTS_LIST_ID}/items?$expand=fields&$top=200&$orderby=createdDateTime desc`, {
        Authorization: `Bearer ${token}`,
      }),
    );
    if (!Array.isArray(j.value)) fail('INVALID_RESPONSE');
    if (j['@odata.nextLink'] || arr(j.value).length >= 200) fail('INCOMPLETE_RESPONSE');
    const kinds = ['instruction', 'proposal', 'change'] as const;
    return {
      requests: arr(j.value).map((v) => {
        const x = rec(v);
        const f = rec(x.fields);
        const kind = kinds.find((k) => str(f.Kind ?? f.RequestType, 30).toLowerCase().startsWith(k)) ?? 'change';
        return {
          id: `sp-${str(x.id, 40)}`,
          kind,
          title: str(f.Title, 200),
          detail: str(f.Detail ?? f.Description, 1000),
          siteUrl: str(f.Website ?? f.SiteUrl, 300),
          requestedBy: str(rec(rec(x.createdBy).user).displayName, 120),
          at: isoTime(x.createdDateTime) ?? '',
          link: str(x.webUrl, 500),
        };
      }),
    };
  }

  /** Compatibility no-op: read/sync never requests a token, sends mail, calls a webhook or retries delivery. */
  async deliver(
    _queue: { id: string; title: string; email: boolean; teams: boolean; toEntraOid: string | null }[],
    _appUrl: string,
  ): Promise<{ id: string; email?: 'sent' | 'failed' | 'not_sent'; teams?: 'sent' | 'failed' | 'not_sent' }[]> {
    return [];
  }
}
