/**
 * Delegated Microsoft calls for the M365 Connections page, with honest failure classification.
 * - One explicit read-only scope per on-behalf-of exchange; a broader or extra granted scope fails closed.
 * - No token, provider body or error description ever leaves this file. Only a fixed reason code does.
 * - Only fixed Microsoft hosts are called; callers pass Graph paths built from validated IDs.
 */
import type { VerifiedEntraAssertion } from '../auth';
import type { DelegatedApp } from '../connections-mail/delegated';

const TIMEOUT_MS = 8000;
const MAX_BYTES = 128 * 1024;
export const GRAPH = 'https://graph.microsoft.com/v1.0';

export type ProviderFailure =
  | 'ConsentRequired'
  | 'ReauthenticationRequired'
  | 'SessionExpired'
  | 'AccessDenied'
  | 'RateLimited'
  | 'ProviderUnavailable'
  | 'UnexpectedScopes';

export class ProviderError extends Error {
  constructor(readonly reason: ProviderFailure, readonly retryAfterSeconds?: number, readonly claims?: string) {
    super(reason);
  }
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Retry-After as whole seconds (1 to 3600), or undefined. HTTP-date form is accepted too. */
export function retryAfter(header: string | null, now: number): number | undefined {
  if (!header) return;
  const n = /^\d{1,6}$/.test(header.trim()) ? Number(header.trim()) : (Date.parse(header) - now) / 1000;
  if (!Number.isFinite(n)) return;
  return Math.min(3600, Math.max(1, Math.ceil(n)));
}

/** A claims challenge is JSON. Accept only a small JSON object; it is passed back to the same person's browser for MSAL. */
export function safeClaims(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2000) return;
  try { return record(JSON.parse(value)) ? value : undefined; } catch { return; }
}

/** WWW-Authenticate: Bearer ... error="insufficient_claims", claims="<base64>" (continuous access evaluation). */
export function claimsFromChallenge(header: string | null): string | undefined {
  if (!header || header.length > 4000 || !/error="insufficient_claims"/i.test(header)) return;
  const m = header.match(/claims="([A-Za-z0-9+/=_-]{1,2800})"/);
  if (!m) return;
  try { return safeClaims(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return; }
}

async function bounded(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) return null;
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return record(data) ? data : null;
  } catch { return null; }
}

/**
 * Microsoft identity platform error → reason. Codes: 65001 consent required; 65004 user declined; 50076/50079/53003 and
 * any claims → reauthenticate; 50173/50133/70043/700082/500133 expired or revoked grant; 50057/50034/53003 blocked user.
 */
export function classifyTokenError(status: number, body: Record<string, unknown> | null, retry?: number): ProviderError {
  if (status === 429 || status >= 500) return new ProviderError(status === 429 ? 'RateLimited' : 'ProviderUnavailable', retry);
  if (!body) return new ProviderError('ProviderUnavailable');
  const error = typeof body.error === 'string' ? body.error : '';
  const sub = typeof body.suberror === 'string' ? body.suberror : '';
  const codes = Array.isArray(body.error_codes) ? body.error_codes.filter((c): c is number => typeof c === 'number') : [];
  const has = (...c: number[]) => c.some(x => codes.includes(x));
  const claims = safeClaims(body.claims);
  if (error === 'consent_required' || sub === 'consent_required' || has(65001, 65004)) return new ProviderError('ConsentRequired');
  if (claims || error === 'interaction_required' || has(50076, 50079, 50158)) return new ProviderError('ReauthenticationRequired', undefined, claims);
  if (has(50057, 50034, 53003, 50105)) return new ProviderError('AccessDenied');
  if (error === 'invalid_grant' || has(50173, 50133, 70043, 700082, 500133)) return new ProviderError('SessionExpired');
  return new ProviderError('ProviderUnavailable');
}

export type Http = typeof fetch;

/** On-behalf-of for exactly one delegated Graph scope. */
export async function obo(http: Http, app: DelegatedApp, identity: VerifiedEntraAssertion, shortScope: string, now: () => number): Promise<string> {
  const scope = `https://graph.microsoft.com/${shortScope}`;
  let response: Response;
  try {
    response = await http(`https://login.microsoftonline.com/${app.tenantId}/oauth2/v2.0/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', requested_token_use: 'on_behalf_of', assertion: identity.accessToken, scope }),
    });
  } catch { throw new ProviderError('ProviderUnavailable'); }
  const body = await bounded(response);
  if (!response.ok) throw classifyTokenError(response.status, body, retryAfter(response.headers.get('retry-after'), now()));
  if (!body) throw new ProviderError('ProviderUnavailable');
  const granted = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean).map(s => (s === scope ? shortScope : s)) : [];
  // Microsoft may also report the identity scopes it always includes; anything else is broader than asked.
  const extra = granted.filter(s => s !== shortScope && !['openid', 'profile', 'email', 'offline_access'].includes(s));
  if (!granted.includes(shortScope) || extra.length) throw new ProviderError('UnexpectedScopes');
  const token = body.access_token;
  if (body.token_type !== 'Bearer' || typeof token !== 'string' || !token || token.length > 16_000 || !/^[\x21-\x7e]+$/.test(token)) throw new ProviderError('ProviderUnavailable');
  return token;
}

/** GET a fixed Graph path. 403/404 mean Microsoft refused THIS person; 401 is a session or claims problem. */
export async function graphGet(http: Http, path: string, token: string, now: () => number): Promise<Record<string, unknown>> {
  if (!path.startsWith('/') || path.includes('//') || path.includes('..')) throw new ProviderError('ProviderUnavailable');
  let response: Response;
  try {
    response = await http(`${GRAPH}${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch { throw new ProviderError('ProviderUnavailable'); }
  if (response.status === 401) {
    const claims = claimsFromChallenge(response.headers.get('www-authenticate'));
    throw new ProviderError(claims ? 'ReauthenticationRequired' : 'SessionExpired', undefined, claims);
  }
  if (response.status === 403 || response.status === 404) throw new ProviderError('AccessDenied');
  if (response.status === 429 || response.status === 503 || response.status === 504) throw new ProviderError(response.status === 429 ? 'RateLimited' : 'ProviderUnavailable', retryAfter(response.headers.get('retry-after'), now()));
  if (!response.ok) throw new ProviderError('ProviderUnavailable');
  const body = await bounded(response);
  if (!body) throw new ProviderError('ProviderUnavailable');
  return body;
}
