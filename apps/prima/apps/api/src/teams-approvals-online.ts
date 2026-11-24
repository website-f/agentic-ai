// Teams approvals reader schedule (Fauzan, 23 Nov 2026, Finance study D5: "Pilot have finish. We doing all now").
// Every 10 minutes, while switched on and fully configured, the server signs in to Microsoft Graph as the read-only
// Teams approvals app (client credentials) and runs one pass of readTeamsApprovals (teams-approvals.ts). Each result
// goes through Prima's checks (packages/core/src/finance-teams.ts) as the system sign-in u-teams-approvals. Nothing is
// written to Microsoft 365. Off unless every value below is set:
//
//   TEAMS_APPROVALS_READ=true                  switch (off unless exactly "true"); the CEO's go
//   ENTRA_TENANT_ID                            tenant (GUID)
//   TEAMS_APPROVALS_CLIENT_ID                  the read-only app registration (GUID)
//   TEAMS_APPROVALS_CLIENT_SECRET              its secret, from the secret store only
//   TEAMS_APPROVALS_SITE_ID                    <approved-site-id>
//   TEAMS_APPROVALS_RESULTS_LIST_ID            the Results list
//   TEAMS_APPROVALS_REQUESTS_LIST_ID           the Requests list
//   TEAMS_FLOW_SERVICE_OID                     the flow's service account (checked by Prima)
//   TEAMS_APPROVALS_USER_ID                    optional; default u-teams-approvals (integration teams_approvals)
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Db } from './db';
import { readTeamsApprovals } from './teams-approvals';

type Fetch = typeof fetch;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const ID = /^[A-Za-z0-9,.{}_-]{1,200}$/;

export interface TeamsReaderConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  resultsListId: string;
  requestsListId: string;
  userId: string;
}

/** The reader's configuration, or null (and the reader stays off) when the switch is off or anything is missing. */
export function teamsReaderConfig(env: NodeJS.ProcessEnv = process.env): TeamsReaderConfig | null {
  if (env.TEAMS_APPROVALS_READ !== 'true') return null;
  const tenantId = env.ENTRA_TENANT_ID?.trim().toLowerCase() ?? '';
  const clientId = env.TEAMS_APPROVALS_CLIENT_ID?.trim().toLowerCase() ?? '';
  const clientSecret = env.TEAMS_APPROVALS_CLIENT_SECRET ?? '';
  const siteId = env.TEAMS_APPROVALS_SITE_ID?.trim() ?? '';
  const resultsListId = env.TEAMS_APPROVALS_RESULTS_LIST_ID?.trim() ?? '';
  const requestsListId = env.TEAMS_APPROVALS_REQUESTS_LIST_ID?.trim() ?? '';
  if (!GUID.test(tenantId) || !GUID.test(clientId) || !clientSecret.trim() || clientSecret.length > 4096) return null;
  if (![siteId, resultsListId, requestsListId].every((x) => ID.test(x))) return null;
  if (!env.TEAMS_FLOW_SERVICE_OID?.trim()) return null;
  return { tenantId, clientId, clientSecret, siteId, resultsListId, requestsListId, userId: env.TEAMS_APPROVALS_USER_ID?.trim() || 'u-teams-approvals' };
}

/** GET on graph.microsoft.com only, with an app token that is cached until shortly before it expires. */
export function graphReader(cfg: TeamsReaderConfig, http: Fetch = fetch, now: () => number = Date.now) {
  let token: { value: string; until: number } | null = null;
  const bearer = async () => {
    if (token && token.until > now()) return token.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default' });
    const r = await http(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, { method: 'POST', body, redirect: 'error', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) throw new Error('Teams approvals sign-in failed.');
    const j = (await r.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== 'string' || !j.access_token) throw new Error('Teams approvals sign-in failed.');
    const life = typeof j.expires_in === 'number' ? j.expires_in : 600;
    token = { value: j.access_token, until: now() + Math.max(60, life - 120) * 1000 };
    return j.access_token;
  };
  return async (path: string): Promise<unknown> => {
    if (!path.startsWith('/') || path.includes('://')) throw new Error('Not a Graph path.');
    const r = await http(`${GRAPH}${path}`, { redirect: 'error', headers: { authorization: `Bearer ${await bearer()}`, accept: 'application/json' } });
    if (!r.ok) throw new Error(`Graph answered ${r.status}.`);
    return r.json();
  };
}

/** One pass: read the Results list and record each result through Prima's checks as the system sign-in. */
export async function runTeamsApprovals(db: Db, cfg: TeamsReaderConfig, http: Fetch = fetch) {
  const graphGet = graphReader(cfg, http);
  return readTeamsApprovals({
    graphGet,
    siteId: cfg.siteId,
    resultsListId: cfg.resultsListId,
    requestsListId: cfg.requestsListId,
    record: (companyId, result, request) => db.asUser(cfg.userId, (svc) => svc.financeTeams.record(companyId, result, request)),
  });
}

/** Runs 2 minutes after the server starts, then every 10 minutes, only while configured. Off otherwise. */
@Injectable()
export class TeamsApprovalsRunner implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  constructor(private db: Db) {}
  onModuleInit() {
    const cfg = teamsReaderConfig();
    if (!cfg) return;
    const tick = () => {
      if (this.running) return;
      this.running = true;
      void runTeamsApprovals(this.db, cfg)
        .then((r) => r.read && console.log(`Teams approvals: ${r.read} result(s) read ${JSON.stringify(r.verdicts)}`))
        .catch((e: unknown) => console.error(`Teams approvals: ${e instanceof Error ? e.message : 'failed'}`))
        .finally(() => {
          this.running = false;
        });
    };
    const first = setTimeout(tick, 2 * 60_000);
    const every = setInterval(tick, 10 * 60_000);
    first.unref();
    every.unref();
    this.timers.push(first, every);
  }
  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }
}
