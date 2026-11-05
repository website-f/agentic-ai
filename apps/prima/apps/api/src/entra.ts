import { createPublicKey, createVerify, type JsonWebKey, type KeyObject } from 'node:crypto';

// Microsoft Entra ID sign-in for office staff (CEO decision 28 Oct 2026, PR #9: Microsoft-first, single tenant pilot).
// The web app signs the person in with Microsoft and sends the Entra access token for this API on every call. The API
// checks the token itself: RS256 signature against Microsoft's published keys, issuer, audience, tenant, expiry,
// not-before and the delegated scope. A valid Microsoft account is identity only: it opens Prima only when IT has
// linked its object ID to one staff record. Entra identity never grants company access; Prima's own grants do.

/** Allowed clock difference between Microsoft and this server. */
const SKEW_S = 5 * 60;
/** Keys are fetched again after a day, or sooner when a token names a key we do not hold (at most every 5 minutes). */
const KEYS_TTL_MS = 24 * 3_600_000;
const KEYS_RETRY_MS = 5 * 60_000;
/** During a Microsoft outage, keys already held keep working for up to 3 days after the last good fetch.
 * PROPOSED (4 Nov 2026): chosen by the build, not decided by the owner; change it here once decided. */
const KEYS_STALE_MS = 3 * 24 * 3_600_000;
const KEYS_TIMEOUT_MS = Number(process.env.ENTRA_KEYS_TIMEOUT_MS ?? 5_000);

export interface EntraConfig {
  /** The directory (tenant) ID of the group's Microsoft 365. Not secret. */
  tenantId: string;
  /** The application (client) ID of the protected API registration ("Prima Secure API"): tokens must be meant for it. */
  apiClientId: string;
  /** The API's Application ID URI, normally api://<API client ID>. Tokens may name it or the API client ID as audience. */
  apiAppIdUri: string;
  /** The application (client) ID of the web app registration ("Prima Secure App"), the only client allowed to call. */
  spaClientId: string;
  /** The delegated scope the API registration exposes. */
  scope: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Entra sign-in settings from the environment, or null when it is off. Two registrations (web app and API):
 * ENTRA_TENANT_ID, ENTRA_SPA_CLIENT_ID, ENTRA_API_CLIENT_ID and, when not the default, ENTRA_API_APP_ID_URI.
 * The earlier single-registration setting ENTRA_CLIENT_ID still works and stands for both.
 */
export function entraConfig(env: NodeJS.ProcessEnv = process.env): EntraConfig | null {
  const v = (k: string) => env[k]?.trim() ?? '';
  const tenantId = v('ENTRA_TENANT_ID');
  const spaClientId = v('ENTRA_SPA_CLIENT_ID') || v('ENTRA_CLIENT_ID');
  const apiClientId = v('ENTRA_API_CLIENT_ID') || v('ENTRA_CLIENT_ID');
  if (!tenantId && !spaClientId && !apiClientId) return null;
  if (![tenantId, spaClientId, apiClientId].every((id) => GUID.test(id)))
    throw new Error('ENTRA_TENANT_ID, ENTRA_SPA_CLIENT_ID and ENTRA_API_CLIENT_ID must all be GUIDs (or ENTRA_CLIENT_ID for one registration).');
  const apiAppIdUri = (v('ENTRA_API_APP_ID_URI') || `api://${apiClientId}`).replace(/\/+$/, '').toLowerCase();
  if (!/^(api|https):\/\/\S+$/.test(apiAppIdUri)) throw new Error('ENTRA_API_APP_ID_URI must start with api:// or https://.');
  return {
    tenantId: tenantId.toLowerCase(),
    apiClientId: apiClientId.toLowerCase(),
    apiAppIdUri,
    spaClientId: spaClientId.toLowerCase(),
    scope: v('ENTRA_SCOPE') || 'access_as_user',
  };
}

/** The person a verified token belongs to. */
export interface EntraIdentity {
  /** The Microsoft account's object ID: stable, never reused, the only thing Prima links on. */
  oid: string;
  tid: string;
  name: string;
  /** Sign-in name (shown to IT only; never used to match, since a name or email can be reassigned). */
  username: string;
}

export class EntraTokenError extends Error {
  constructor(readonly reason: string) {
    super(`Microsoft token refused: ${reason}`);
    this.name = 'EntraTokenError';
  }
}

export type KeySource = (kid: string) => Promise<KeyObject | null>;

/** Microsoft's published signing keys for the tenant, cached. */
export function microsoftKeys(
  tenantId: string,
  fetcher: typeof fetch = fetch,
  clock: () => number = Date.now,
  timeoutMs = KEYS_TIMEOUT_MS,
): KeySource {
  const url = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  let keys = new Map<string, KeyObject>();
  let fetchedAt = -Infinity;
  const load = async () => {
    // A time limit on Microsoft's key endpoint (Arisha review, 3 Nov 2026): a hung fetch fails after KEYS_TIMEOUT_MS
    // and the 5-minute retry gap applies. The error names no token or secret.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let body: { keys?: (JsonWebKey & { kid?: string; use?: string })[] };
    try {
      const res = await fetcher(url, { signal: ctrl.signal, redirect: 'error' });
      if (!res.ok) throw new Error(`Could not load Microsoft signing keys (${res.status}).`);
      body = (await res.json()) as typeof body;
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error('Microsoft signing keys did not answer in time.');
      throw e instanceof Error && e.message.startsWith('Could not load') ? e : new Error('Could not reach Microsoft signing keys.');
    } finally {
      clearTimeout(timer);
    }
    const next = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
      next.set(jwk.kid, createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' }));
    }
    keys = next;
    fetchedAt = clock();
  };
  // At most one fetch at a time, shared by every request waiting on it, and at most one attempt per KEYS_RETRY_MS
  // whether it succeeded or failed (Arisha review, 3 Nov 2026: eight forged tokens at once caused eight fetches).
  // Only an expired cache (24 h) is refreshed without waiting for the retry gap.
  //
  // The same answer for every request in the same state (Arisha review, 4 Nov 2026), whether it started the fetch,
  // waited on it, or came during the retry gap after it:
  // - a key we hold (fetched in the last KEYS_STALE_MS) is used, even while a refresh fails;
  // - a key we do not hold is "unknown" (401, sign in again) only when the last attempt to fetch keys succeeded;
  //   when the last attempt failed it is "keys unavailable" (503, try again in a minute).
  let inflight: Promise<void> | null = null;
  let attemptedAt = -Infinity;
  let lastFailure: Error | null = null;
  const refresh = () => {
    if (!inflight) {
      attemptedAt = clock();
      inflight = load()
        .then(
          () => {
            lastFailure = null;
          },
          (e: unknown) => {
            lastFailure = e instanceof Error ? e : new Error('Could not reach Microsoft signing keys.');
            throw lastFailure;
          },
        )
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
  return async (kid) => {
    const now = clock();
    const held = () => (clock() - fetchedAt <= KEYS_STALE_MS ? keys.get(kid) ?? null : null);
    const expired = now - fetchedAt > KEYS_TTL_MS;
    if (!expired && keys.has(kid)) return keys.get(kid)!;
    if (inflight || now - attemptedAt > KEYS_RETRY_MS) {
      try {
        await refresh();
      } catch (e) {
        const k = held();
        if (k) return k;
        throw e;
      }
      return keys.get(kid) ?? null;
    }
    // In the retry gap: the outcome of the last attempt decides.
    const k = held();
    if (k) return k;
    if (lastFailure) throw lastFailure;
    return null;
  };
}

function part<T>(s: string): T {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as T;
}

interface Claims {
  iss?: string;
  aud?: string;
  tid?: string;
  oid?: string;
  exp?: number;
  nbf?: number;
  scp?: string;
  ver?: string;
  azp?: string;
  name?: string;
  preferred_username?: string;
}

/** Checks one Entra access token for this API; throws EntraTokenError with the reason when it is not acceptable. */
export async function verifyEntraToken(token: string, cfg: EntraConfig, keys: KeySource, nowMs = Date.now()): Promise<EntraIdentity> {
  const segs = token.split('.');
  if (segs.length !== 3 || segs.some((s) => !s)) throw new EntraTokenError('not a signed token');
  let header: { alg?: string; kid?: string; typ?: string };
  let claims: Claims;
  try {
    header = part(segs[0]);
    claims = part(segs[1]);
  } catch {
    throw new EntraTokenError('unreadable');
  }
  // Only Microsoft's RS256 is accepted: "none", HMAC and every other algorithm are refused before any key is used.
  if (header.alg !== 'RS256') throw new EntraTokenError('wrong algorithm');
  if (!header.kid) throw new EntraTokenError('no key id');
  const key = await keys(header.kid);
  if (!key) throw new EntraTokenError('unknown signing key');
  const ok = createVerify('RSA-SHA256').update(`${segs[0]}.${segs[1]}`).verify(key, Buffer.from(segs[2], 'base64url'));
  if (!ok) throw new EntraTokenError('bad signature');

  if (claims.ver !== '2.0') throw new EntraTokenError('not a v2.0 token');
  if (claims.tid?.toLowerCase() !== cfg.tenantId) throw new EntraTokenError('other tenant');
  if (claims.iss !== `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`) throw new EntraTokenError('wrong issuer');
  const aud = claims.aud?.toLowerCase();
  if (aud !== cfg.apiClientId && aud !== cfg.apiAppIdUri) throw new EntraTokenError('meant for another app');
  // Only the Prima web app may call with a user's token; another app in the tenant holding consent may not.
  if (claims.azp?.toLowerCase() !== cfg.spaClientId) throw new EntraTokenError('issued to another client');
  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= now) throw new EntraTokenError('expired');
  if (typeof claims.nbf === 'number' && claims.nbf - SKEW_S > now) throw new EntraTokenError('not valid yet');
  // A delegated user token must carry our scope; app-only tokens (no scp) are refused.
  if (!(claims.scp ?? '').split(' ').includes(cfg.scope)) throw new EntraTokenError('missing scope');
  if (!claims.oid || !GUID.test(claims.oid)) throw new EntraTokenError('no account id');
  return { oid: claims.oid.toLowerCase(), tid: claims.tid, name: claims.name ?? '', username: claims.preferred_username ?? '' };
}
