import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { User } from '@prima/core';
import { verifiedEntraAssertion, type VerifiedEntraAssertion } from '../auth';
import type { Db } from '../db';

/**
 * Delegated Microsoft helpers for the staff Email and Power BI connections.
 * Kept separate from connections.ts (SharePoint) so those files stay untouched; the two can be
 * consolidated later by the Connections owner. Same rules: fixed tenant, explicit scope, no token cache,
 * static errors that never include provider bodies, tokens or credentials.
 */
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const LOCAL_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const TIMEOUT_MS = 8000;

export interface DelegatedActor {
  user: User;
  visibleCompanyIds: string[];
  assertion: VerifiedEntraAssertion | null;
}
export interface DelegatedApp { tenantId: string; clientId: string; clientSecret: string }

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function idList(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= 50 &&
    value.every(v => typeof v === 'string' && LOCAL_ID.test(v)) && new Set(value).size === value.length;
}
export function label(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

/** The fixed-tenant confidential client, or null. A blank or oversized secret never counts as configured. */
export function delegatedApp(env: NodeJS.ProcessEnv, secretVar: string): DelegatedApp | null {
  const tenantId = env.ENTRA_TENANT_ID?.toLowerCase() ?? '';
  const clientId = (env.ENTRA_API_CLIENT_ID ?? env.ENTRA_CLIENT_ID)?.toLowerCase() ?? '';
  const clientSecret = env[secretVar] ?? '';
  if (!GUID.test(tenantId) || !GUID.test(clientId) || !clientSecret.trim() || clientSecret.length > 4096) return null;
  return { tenantId, clientId, clientSecret };
}

/** Request-local, signature-verified Entra evidence for exactly this Prima user and their current object-ID link. */
export function linkedIdentity(actor: DelegatedActor, app: DelegatedApp, message: string): VerifiedEntraAssertion {
  const identity = actor.assertion;
  if (actor.user.integration || !identity || identity.userId !== actor.user.id || identity.tenantId.toLowerCase() !== app.tenantId ||
      !actor.user.entraOid || actor.user.entraOid.toLowerCase() !== identity.oid.toLowerCase() || !identity.accessToken) {
    throw new ForbiddenException(message);
  }
  return identity;
}

export class ProviderUnavailable extends ServiceUnavailableException {}

/** Reads at most `maximum` bytes of a JSON object; anything else is unavailable. */
export async function boundedJson(response: Response, maximum: number, unavailable: () => never): Promise<Record<string, unknown>> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) unavailable();
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) unavailable();
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); unavailable(); }
      chunks.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!record(data)) unavailable();
    return data as Record<string, unknown>;
  } catch { return unavailable(); }
}

/**
 * On-behalf-of exchange for ONE explicit delegated scope. The returned scope list must be exactly that scope
 * (short or resource-qualified); a broader or extra scope fails closed rather than silently widening access.
 */
export async function onBehalfOf(http: typeof fetch, app: DelegatedApp, identity: VerifiedEntraAssertion, scope: string, unavailable: () => never): Promise<string> {
  const short = scope.slice(scope.lastIndexOf('/') + 1);
  try {
    const response = await http(`https://login.microsoftonline.com/${app.tenantId}/oauth2/v2.0/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', requested_token_use: 'on_behalf_of', assertion: identity.accessToken, scope }),
    });
    if (!response.ok) unavailable();
    const body = await boundedJson(response, 32 * 1024, unavailable);
    const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean).map(s => s === scope ? short : s) : [];
    if (body.token_type !== 'Bearer' || typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 16_000 ||
        !/^[\x21-\x7e]+$/.test(body.access_token) || !scopes.length || scopes.some(s => s !== short)) unavailable();
    return body.access_token as string;
  } catch { return unavailable(); }
}

/** Fresh scoped user and company visibility for every request (offboarded accounts are refused by Db.asUser). */
export function delegatedActor(db: Db, uid: string, request: object): Promise<DelegatedActor> {
  const assertion = verifiedEntraAssertion(request);
  return db.asUser(uid, async (svc, user) => ({ user, visibleCompanyIds: (await svc.visibleCompanies(user)).map(c => c.id), assertion }));
}
export function noQuery(query: Record<string, unknown>): void {
  if (Object.keys(query ?? {}).length) throw new BadRequestException('Query parameters are not supported.');
}
export function noBody(body?: unknown): void {
  if (body != null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new BadRequestException('This action takes no input.');
}
