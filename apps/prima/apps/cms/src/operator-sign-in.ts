// Operator Microsoft (Entra) sign-in for the CMS desk (Fitri package E7, 14 Nov 2026; plan
// docs/CMS_DURABILITY_AND_OPERATOR_SIGN_IN_PLAN.md section 3). OFF until CMS_ENTRA_SIGN_IN=true and the CMS app
// registration is set: until then operators keep their personal keys (CMS_OPERATOR_KEYS) exactly as before.
//
// When on:
// - The token is checked here: RS256 signature against the tenant's published keys, issuer, tenant, audience (the CMS
//   registration), expiry, not-before, and MFA (amr carries "mfa", unless the owner chooses Conditional Access
//   instead with CMS_ENTRA_MFA_BY_POLICY=true). No claim from the browser is trusted beyond that.
// - Who may sign in is decided by Prima's CMS desk roster, not by the token: the token's object ID must match a seat
//   Prima sent. The name used in CMS is the roster name.
// - On a current seat (with a grace before and after) the operator may act; on the roster but off shift, read only.
// - Personal keys are refused, except the one sealed break-glass key when CMS_BREAK_GLASS=true; each use is recorded.
import { createPublicKey, createVerify, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { DeskSeat } from './directory';

const SKEW_S = 5 * 60;
const KEYS_TTL_MS = 24 * 3_600_000;
const KEYS_RETRY_MS = 5 * 60_000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Proposed in the plan (owner may change): grace around a seat, in minutes. */
export const SHIFT_GRACE_MIN = 30;

export interface CmsEntraConfig {
  tenantId: string;
  /** The CMS app registration (application ID): tokens must be meant for it. */
  clientId: string;
  /** Its Application ID URI, normally api://<client ID>. */
  appIdUri: string;
  /** true: MFA is enforced by a Conditional Access policy the owner names, so amr is not checked here. */
  mfaByPolicy: boolean;
  graceMin: number;
}

/** null when Microsoft sign-in is off (the default). */
export function cmsEntraConfig(env: NodeJS.ProcessEnv = process.env): CmsEntraConfig | null {
  if (env.CMS_ENTRA_SIGN_IN !== 'true') return null;
  const tenantId = (env.CMS_ENTRA_TENANT_ID ?? '').trim().toLowerCase();
  const clientId = (env.CMS_ENTRA_CLIENT_ID ?? '').trim().toLowerCase();
  if (!GUID.test(tenantId) || !GUID.test(clientId)) throw new Error('CMS_ENTRA_SIGN_IN=true needs CMS_ENTRA_TENANT_ID and CMS_ENTRA_CLIENT_ID (GUIDs).');
  const grace = Number(env.CMS_SHIFT_GRACE_MIN ?? SHIFT_GRACE_MIN);
  return {
    tenantId,
    clientId,
    appIdUri: ((env.CMS_ENTRA_APP_ID_URI ?? '').trim() || `api://${clientId}`).replace(/\/+$/, '').toLowerCase(),
    mfaByPolicy: env.CMS_ENTRA_MFA_BY_POLICY === 'true',
    graceMin: Number.isFinite(grace) && grace >= 0 && grace <= 120 ? grace : SHIFT_GRACE_MIN,
  };
}

export class SignInError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
  }
}

export type KeySource = (kid: string) => Promise<KeyObject | null>;

/** The tenant's published signing keys, cached for a day, fetched again at most every 5 minutes for an unknown key. */
export function tenantKeys(tenantId: string, fetcher: typeof fetch = fetch, clock: () => number = Date.now): KeySource {
  const url = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  let keys = new Map<string, KeyObject>();
  let fetchedAt = -Infinity;
  let attemptedAt = -Infinity;
  let inflight: Promise<void> | null = null;
  const load = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    try {
      const res = await fetcher(url, { signal: ctrl.signal, redirect: 'error' });
      if (!res.ok) throw new Error('keys');
      const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string; use?: string })[] };
      const next = new Map<string, KeyObject>();
      for (const jwk of body.keys ?? []) {
        if (jwk.kty !== 'RSA' || !jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
        next.set(jwk.kid, createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' }));
      }
      keys = next;
      fetchedAt = clock();
    } finally {
      clearTimeout(timer);
    }
  };
  return async (kid) => {
    const now = clock();
    if (now - fetchedAt <= KEYS_TTL_MS && keys.has(kid)) return keys.get(kid)!;
    if (inflight || now - attemptedAt > KEYS_RETRY_MS) {
      if (!inflight) {
        attemptedAt = now;
        inflight = load().finally(() => {
          inflight = null;
        });
      }
      try {
        await inflight;
      } catch {
        if (clock() - fetchedAt <= KEYS_TTL_MS && keys.has(kid)) return keys.get(kid)!;
        throw new SignInError(503, 'Microsoft sign-in keys could not be reached; try again in a minute.');
      }
    }
    return clock() - fetchedAt <= KEYS_TTL_MS ? (keys.get(kid) ?? null) : null;
  };
}

interface Claims {
  iss?: string;
  aud?: string;
  tid?: string;
  oid?: string;
  exp?: number;
  nbf?: number;
  ver?: string;
  amr?: string[];
}

/** Checks one token; returns the Microsoft account object ID. */
export async function verifyOperatorToken(token: string, cfg: CmsEntraConfig, keys: KeySource, nowMs: number): Promise<string> {
  const refuse = (why: string): never => {
    throw new SignInError(401, `Microsoft sign-in refused: ${why}.`);
  };
  const segs = token.split('.');
  if (segs.length !== 3 || segs.some((s) => !s)) refuse('not a signed token');
  let header: { alg?: string; kid?: string } = {};
  let claims: Claims = {};
  try {
    header = JSON.parse(Buffer.from(segs[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(segs[1], 'base64url').toString('utf8'));
  } catch {
    refuse('unreadable');
  }
  if (header.alg !== 'RS256') refuse('wrong algorithm');
  if (!header.kid) refuse('no key id');
  const key = await keys(header.kid!);
  if (!key) refuse('unknown signing key');
  if (!createVerify('RSA-SHA256').update(`${segs[0]}.${segs[1]}`).verify(key!, Buffer.from(segs[2], 'base64url'))) refuse('bad signature');
  if (claims.ver !== '2.0') refuse('not a v2.0 token');
  if (claims.tid?.toLowerCase() !== cfg.tenantId) refuse('other tenant');
  if (claims.iss !== `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`) refuse('wrong issuer');
  const aud = claims.aud?.toLowerCase();
  if (aud !== cfg.clientId && aud !== cfg.appIdUri) refuse('meant for another app');
  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= now) refuse('expired');
  if (typeof claims.nbf === 'number' && claims.nbf - SKEW_S > now) refuse('not valid yet');
  if (!cfg.mfaByPolicy && !(Array.isArray(claims.amr) && claims.amr.includes('mfa'))) refuse('no MFA');
  if (!claims.oid || !GUID.test(claims.oid)) refuse('no account id');
  return claims.oid!.toLowerCase();
}

export interface OperatorAccess {
  name: string;
  oid: string;
  /** On a current seat (with grace): may act. Otherwise read only. */
  canAct: boolean;
  post: DeskSeat['post'] | null;
}

/** Prima's roster decides: a person with no seat in the copy Prima sent is refused; off shift is read only. */
export function rosterAccess(oid: string, desk: DeskSeat[] | undefined, nowMs: number, graceMin: number): OperatorAccess {
  const seats = (desk ?? []).filter((s) => s.entraOid?.toLowerCase() === oid && s.staffName);
  if (!seats.length) throw new SignInError(403, 'You are not on the CMS desk roster from Prima. Ask Arms Control.');
  const g = graceMin * 60_000;
  const current = seats.find((s) => Date.parse(s.start) - g <= nowMs && nowMs < Date.parse(s.end) + g);
  const seat = current ?? seats[0];
  return { name: seat.staffName!, oid, canAct: !!current, post: current?.post ?? null };
}
