import { createHash } from 'node:crypto';
import { alertItem, applyAlertPrefs, planAlerts, renderAlertEmail, renderTeamsCard, uniqueAlerts, type AlertItem, type AlertMode, type AlertPrefs, type HomeItem } from '@prima/core';

/**
 * Alerts to Teams and email (staff usability rule 7; Fauzan, 5 Nov 2026: "Yes" to Teams and email alerts).
 *
 * OFF unless every setting is present and valid. Sending needs, separately:
 *  - email: an app registration with Microsoft Graph Mail.Send (application) limited by Exchange to ONE shared
 *    alert mailbox, plus User.ReadBasic.All to find each person's address from their linked Microsoft account;
 *    a Microsoft admin must consent to both;
 *  - Teams: one Teams Workflows webhook address per department channel ("When a Teams webhook request is received").
 * People get only their OWN to-do items, read with their own permissions. Prima never acts on a reply.
 * Each alert is claimed in the sent-record BEFORE it is sent, so two runs or two servers never send it twice;
 * a failed send gives the claim back so the next run tries again.
 */
export interface AlertMail { tenantId: string; clientId: string; clientSecret: string; sender: string }
export interface AlertsConfig {
  runKey: string;
  appUrl: string | null;
  mail: AlertMail | null;
  /** Department -> Teams Workflows webhook address. */
  teams: Record<string, string>;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const DEPT = /^[a-z_]{1,40}$/;
/** Teams Workflows (Power Automate) webhook hosts; the retired Office 365 connector webhooks are not accepted. */
const WEBHOOK_HOST = /(^|\.)(logic\.azure\.com|environment\.api\.powerplatform\.com)$/;
export const ALERT_TIMEOUT_MS = 8000;

function httpsUrl(v: string | undefined, host?: RegExp): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password || (host && !host.test(u.hostname))) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Null (alerts off) unless switched on with a run key and at least one valid channel. A bad channel is left out. */
export function alertsConfiguration(env: NodeJS.ProcessEnv): AlertsConfig | null {
  if (env.ALERTS_ENABLED !== 'true') return null;
  const runKey = env.ALERTS_RUN_KEY ?? '';
  if (runKey.length < 32 || runKey.length > 512) return null;
  const tenantId = env.ENTRA_TENANT_ID?.toLowerCase() ?? '';
  const clientId = env.ALERTS_CLIENT_ID?.toLowerCase() ?? '';
  const clientSecret = env.ALERTS_CLIENT_SECRET ?? '';
  const sender = env.ALERTS_SENDER_MAILBOX ?? '';
  const mail = GUID.test(tenantId) && GUID.test(clientId) && clientSecret.trim() && clientSecret.length <= 4096 && EMAIL.test(sender)
    ? { tenantId, clientId, clientSecret, sender }
    : null;
  const teams: Record<string, string> = {};
  try {
    const raw = JSON.parse(env.ALERTS_TEAMS_WEBHOOKS_JSON ?? '{}') as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      for (const [dept, url] of Object.entries(raw as Record<string, unknown>)) {
        const ok = typeof url === 'string' ? httpsUrl(url, WEBHOOK_HOST) : null;
        if (DEPT.test(dept) && ok) teams[dept] = ok;
      }
  } catch {
    /* an unreadable list means no Teams channels */
  }
  if (!mail && !Object.keys(teams).length) return null;
  return { runKey, appUrl: httpsUrl(env.ALERTS_APP_URL), mail, teams };
}

/** The sent-record. Ids are hashes; the record holds no names, addresses or item text. */
export interface AlertLedger {
  /** True when this id was not claimed before (and is now). */
  claim(id: string, channel: 'email' | 'teams'): Promise<boolean>;
  /** Gives a claim back after a failed send, so the next run tries again. */
  release(id: string): Promise<void>;
}
export class MemoryAlertLedger implements AlertLedger {
  readonly ids = new Set<string>();
  async claim(id: string) {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    return true;
  }
  async release(id: string) {
    this.ids.delete(id);
  }
}
export const deliveryId = (...parts: string[]) => createHash('sha256').update(parts.join('␟')).digest('hex');

type Fetch = typeof fetch;
async function call(http: Fetch, url: string, init: RequestInit): Promise<Response> {
  return http(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(ALERT_TIMEOUT_MS) });
}

/** Email through Microsoft Graph from the one shared alert mailbox. Errors never carry provider bodies or secrets. */
export class GraphAlertMail {
  private token: { value: string; until: number } | null = null;
  constructor(private readonly cfg: AlertMail, private readonly http: Fetch = fetch, private readonly now: () => number = Date.now) {}

  private async bearer(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, scope: 'https://graph.microsoft.com/.default' });
    const r = await call(this.http, `https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) throw new Error('Alert mail sign-in failed.');
    const j = (await r.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== 'string' || !j.access_token) throw new Error('Alert mail sign-in failed.');
    const life = typeof j.expires_in === 'number' ? j.expires_in : 600;
    this.token = { value: j.access_token, until: this.now() + Math.max(60, life - 120) * 1000 };
    return j.access_token;
  }

  /** The person's work address, found from their linked Microsoft account (never typed into Prima). */
  async addressOf(entraOid: string): Promise<string | null> {
    if (!GUID.test(entraOid.toLowerCase())) return null;
    const r = await call(this.http, `https://graph.microsoft.com/v1.0/users/${entraOid.toLowerCase()}?$select=mail`, { headers: { authorization: `Bearer ${await this.bearer()}` } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Alert mail address lookup failed.');
    const j = (await r.json()) as { mail?: unknown };
    return typeof j.mail === 'string' && EMAIL.test(j.mail) ? j.mail : null;
  }

  async send(to: string, m: { subject: string; html: string }): Promise<void> {
    const r = await call(this.http, `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.cfg.sender)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.bearer()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { subject: m.subject, body: { contentType: 'HTML', content: m.html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }),
    });
    if (r.status !== 202) throw new Error('Alert mail was not accepted.');
  }
}

export async function postTeams(http: Fetch, url: string, card: Record<string, unknown>): Promise<void> {
  const r = await call(http, url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(card) });
  if (!r.ok) throw new Error('Teams channel did not accept the alert.');
}

export interface AlertRecipient { id: string; entraOid: string; department: string | null }
export interface AlertRunSummary {
  mode: AlertMode;
  people: number;
  emails: number;
  teamsPosts: number;
  nothingToSend: number;
  noAddress: number;
  failed: number;
}

/**
 * One run: every linked person's own items, then email (urgent: new red items; digest: once a day) and,
 * for urgent runs, each department channel's new red items once.
 */
export async function runAlerts(deps: {
  config: AlertsConfig;
  mode: AlertMode;
  today: string;
  recipients: AlertRecipient[];
  itemsFor: (userId: string) => Promise<HomeItem[]>;
  /** J6: the person's own choices (null = today's defaults). Urgent safety alerts are sent whatever they say. */
  prefsFor?: (userId: string) => Promise<Pick<AlertPrefs, 'urgent' | 'digest' | 'muted'> | null>;
  ledger: AlertLedger;
  mail: Pick<GraphAlertMail, 'addressOf' | 'send'> | null;
  http: Fetch;
}): Promise<AlertRunSummary> {
  const { config, mode, today, ledger } = deps;
  const out: AlertRunSummary = { mode, people: deps.recipients.length, emails: 0, teamsPosts: 0, nothingToSend: 0, noAddress: 0, failed: 0 };
  const byDept = new Map<string, AlertItem[]>();
  for (const p of deps.recipients) {
    let items: AlertItem[];
    try {
      items = uniqueAlerts((await deps.itemsFor(p.id)).map(alertItem));
    } catch {
      out.failed++;
      continue;
    }
    if (mode === 'urgent' && p.department && config.teams[p.department])
      byDept.set(p.department, [...(byDept.get(p.department) ?? []), ...items.filter((i) => i.tone === 'crit')]);
    if (!deps.mail) continue;
    let prefs: Pick<AlertPrefs, 'urgent' | 'digest' | 'muted'> | null = null;
    try {
      prefs = deps.prefsFor ? await deps.prefsFor(p.id) : null;
    } catch {
      prefs = null; // the choices cannot be read: today's defaults (everything), never fewer safety alerts
    }
    const planned = planAlerts(applyAlertPrefs(items, prefs, mode), mode, () => false);
    // Urgent: claim each new red item for this person; digest: claim the day once.
    const claims = mode === 'urgent' ? planned.map((i) => ({ i, id: deliveryId('email', p.id, i.key) })) : [];
    const fresh: { i: AlertItem; id: string }[] = [];
    for (const c of claims) if (await ledger.claim(c.id, 'email')) fresh.push(c);
    const dayId = deliveryId('email', p.id, 'digest', today);
    const toSend = mode === 'urgent' ? fresh.map((c) => c.i) : planned;
    if (!toSend.length || (mode === 'digest' && !(await ledger.claim(dayId, 'email')))) {
      out.nothingToSend++;
      continue;
    }
    const giveBack = () => Promise.all(mode === 'urgent' ? fresh.map((c) => ledger.release(c.id)) : [ledger.release(dayId)]);
    try {
      const to = await deps.mail.addressOf(p.entraOid);
      if (!to) {
        out.noAddress++;
        await giveBack();
        continue;
      }
      await deps.mail.send(to, renderAlertEmail(mode, toSend, { appUrl: config.appUrl, today }));
      out.emails++;
    } catch {
      out.failed++;
      await giveBack();
    }
  }
  for (const [dept, items] of byDept) {
    const fresh: { i: AlertItem; id: string }[] = [];
    for (const i of uniqueAlerts(items)) {
      const id = deliveryId('teams', dept, i.key);
      if (await ledger.claim(id, 'teams')) fresh.push({ i, id });
    }
    if (!fresh.length) continue;
    try {
      await postTeams(deps.http, config.teams[dept], renderTeamsCard(dept, fresh.map((f) => f.i), { appUrl: config.appUrl }));
      out.teamsPosts++;
    } catch {
      out.failed++;
      await Promise.all(fresh.map((f) => ledger.release(f.id)));
    }
  }
  return out;
}
