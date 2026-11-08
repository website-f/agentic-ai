// Microsoft sign-in token checks. Uses a made-up tenant and test keys: no Microsoft service is called.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { EntraTokenError, entraConfig, microsoftKeys, verifyEntraToken, type EntraConfig } from '../src/entra';
import { rateLimit } from '../src/security';

const TENANT = '11111111-2222-3333-4444-555555555555';
// Two registrations, as set up in the tenant: the web app (SPA) and the protected API, with different IDs.
const SPA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const API = 'cccccccc-1111-2222-3333-444444444444';
const OID = '99999999-8888-7777-6666-555555555555';
const cfg: EntraConfig = { tenantId: TENANT, apiClientId: API, apiAppIdUri: `api://${API}`, spaClientId: SPA, scope: 'access_as_user' };
const NOW = Date.UTC(2026, 9, 28, 3, 0, 0);
const sec = Math.floor(NOW / 1000);

const good = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = async (kid: string): Promise<KeyObject | null> => (kid === 'k1' ? good.publicKey : null);

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function claims(over: Record<string, unknown> = {}) {
  return {
    ver: '2.0',
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    aud: `api://${API}`,
    azp: SPA,
    tid: TENANT,
    oid: OID,
    scp: 'access_as_user',
    nbf: sec - 60,
    exp: sec + 3600,
    name: 'Test Person',
    preferred_username: 'test@example.com',
    ...over,
  };
}

function token(over: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = good.privateKey) {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'k1', ...header });
  const body = b64(claims(over));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

async function refused(t: string, reason: string) {
  await assert.rejects(verifyEntraToken(t, cfg, keys, NOW), (e: unknown) => e instanceof EntraTokenError && e.reason === reason);
}

describe('Microsoft sign-in token', () => {
  it('accepts a good token and returns the account ID', async () => {
    const who = await verifyEntraToken(token(), cfg, keys, NOW);
    assert.equal(who.oid, OID);
    assert.equal(who.tid, TENANT);
    assert.equal(who.username, 'test@example.com');
  });

  it('accepts the bare API client ID as audience too', async () => {
    assert.equal((await verifyEntraToken(token({ aud: API }), cfg, keys, NOW)).oid, OID);
  });

  it('refuses a token meant for the web app instead of the API', async () => {
    await refused(token({ aud: SPA }), 'meant for another app');
    await refused(token({ aud: `api://${SPA}` }), 'meant for another app');
  });

  it('refuses a token another client app in the tenant obtained for our API', async () => {
    await refused(token({ azp: '00000000-aaaa-bbbb-cccc-dddddddddddd' }), 'issued to another client');
    await refused(token({ azp: undefined }), 'issued to another client');
  });

  it('accepts a custom Application ID URI as audience', async () => {
    const custom = { ...cfg, apiAppIdUri: 'api://prima-secure-api-staging' };
    assert.equal((await verifyEntraToken(token({ aud: 'api://prima-secure-api-staging' }), custom, keys, NOW)).oid, OID);
    await assert.rejects(verifyEntraToken(token({ aud: `api://${API}` }), custom, keys, NOW), EntraTokenError);
  });

  it('refuses a token signed with another key', async () => {
    await refused(token({}, {}, other.privateKey), 'bad signature');
  });

  it('refuses a token whose claims were changed after signing', async () => {
    const [h, , s] = token().split('.');
    await refused(`${h}.${b64(claims({ oid: '00000000-0000-0000-0000-000000000001' }))}.${s}`, 'bad signature');
  });

  it('refuses alg "none" and HMAC tokens', async () => {
    const body = b64(claims());
    await refused(`${b64({ alg: 'none', kid: 'k1' })}.${body}.x`, 'wrong algorithm');
    const head = b64({ alg: 'HS256', kid: 'k1' });
    const pem = good.publicKey.export({ type: 'spki', format: 'pem' });
    const sig = createHmac('sha256', pem).update(`${head}.${body}`).digest('base64url');
    await refused(`${head}.${body}.${sig}`, 'wrong algorithm');
  });

  it('refuses an unknown signing key', async () => {
    await refused(token({}, { kid: 'k9' }), 'unknown signing key');
  });

  it('refuses another tenant, issuer or app', async () => {
    const t2 = '00000000-2222-3333-4444-555555555555';
    await refused(token({ tid: t2, iss: `https://login.microsoftonline.com/${t2}/v2.0` }), 'other tenant');
    await refused(token({ iss: 'https://sts.windows.net/' + TENANT + '/' }), 'wrong issuer');
    await refused(token({ aud: 'api://00000000-1111-2222-3333-444444444444' }), 'meant for another app');
    await refused(token({ aud: '00000003-0000-0000-c000-000000000000' }), 'meant for another app');
  });

  it('refuses expired and not-yet-valid tokens, allowing 5 minutes of clock difference', async () => {
    await refused(token({ exp: sec - 301 }), 'expired');
    await refused(token({ exp: undefined }), 'expired');
    await refused(token({ nbf: sec + 301 }), 'not valid yet');
    assert.equal((await verifyEntraToken(token({ exp: sec - 200 }), cfg, keys, NOW)).oid, OID);
  });

  it('refuses app-only tokens and tokens without our scope', async () => {
    await refused(token({ scp: undefined, roles: ['x'] }), 'missing scope');
    await refused(token({ scp: 'User.Read' }), 'missing scope');
  });

  it('refuses v1 tokens and tokens without an account ID', async () => {
    await refused(token({ ver: '1.0' }), 'not a v2.0 token');
    await refused(token({ oid: undefined }), 'no account id');
  });

  it('refuses things that are not tokens', async () => {
    await refused('abc.def', 'not a signed token');
    await refused('a.b.c', 'unreadable');
  });
});

describe('Microsoft sign-in settings', () => {
  it('stays off with no IDs and refuses half or malformed settings', () => {
    assert.equal(entraConfig({}), null);
    assert.throws(() => entraConfig({ ENTRA_TENANT_ID: TENANT }));
    assert.throws(() => entraConfig({ ENTRA_TENANT_ID: TENANT, ENTRA_SPA_CLIENT_ID: SPA }));
    assert.throws(() => entraConfig({ ENTRA_TENANT_ID: 'contoso', ENTRA_SPA_CLIENT_ID: SPA, ENTRA_API_CLIENT_ID: API }));
    assert.throws(() => entraConfig({ ENTRA_TENANT_ID: TENANT, ENTRA_SPA_CLIENT_ID: SPA, ENTRA_API_CLIENT_ID: API, ENTRA_API_APP_ID_URI: 'prima' }));
  });

  it('reads two registrations, and the earlier single registration as both', () => {
    assert.deepEqual(entraConfig({ ENTRA_TENANT_ID: TENANT.toUpperCase(), ENTRA_SPA_CLIENT_ID: SPA, ENTRA_API_CLIENT_ID: API }), cfg);
    assert.equal(entraConfig({ ENTRA_TENANT_ID: TENANT, ENTRA_SPA_CLIENT_ID: SPA, ENTRA_API_CLIENT_ID: API, ENTRA_API_APP_ID_URI: 'api://Prima-API/' })?.apiAppIdUri, 'api://prima-api');
    assert.deepEqual(entraConfig({ ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: SPA }), {
      tenantId: TENANT,
      apiClientId: SPA,
      apiAppIdUri: `api://${SPA}`,
      spaClientId: SPA,
      scope: 'access_as_user',
    });
  });

  it('caches Microsoft keys and fetches again only for a new key after 5 minutes', async () => {
    const jwk = { ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
    let calls = 0;
    let t = NOW;
    const fetcher = (async (url: string) => {
      calls += 1;
      assert.equal(url, `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`);
      return new Response(JSON.stringify({ keys: [jwk] }));
    }) as typeof fetch;
    const src = microsoftKeys(TENANT, fetcher, () => t);
    assert.ok(await src('k1'));
    assert.ok(await src('k1'));
    assert.equal(calls, 1);
    assert.equal(await src('k2'), null);
    assert.equal(calls, 1);
    t += 6 * 60_000;
    assert.equal(await src('k2'), null);
    assert.equal(calls, 2);
    assert.equal((await verifyEntraToken(token(), cfg, src, NOW)).oid, OID);
  });

  it('shares one key fetch between requests at once, and waits 5 minutes after a failed fetch (Arisha review)', async () => {
    const jwk = { ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
    let calls = 0;
    let fail = false;
    let t = NOW;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetcher = (async () => {
      calls += 1;
      await gate;
      if (fail) return new Response('down', { status: 503 });
      return new Response(JSON.stringify({ keys: [jwk] }));
    }) as typeof fetch;
    const src = microsoftKeys(TENANT, fetcher, () => t);
    // Eight requests at once, seven with made-up key ids: one fetch.
    const all = Promise.all([src('k1'), ...Array.from({ length: 7 }, (_, i) => src(`forged-${i}`))]);
    release();
    const got = await all;
    assert.equal(calls, 1);
    assert.ok(got[0]);
    assert.ok(got.slice(1).every((k) => k === null));
    // More made-up key ids within 5 minutes: no fetch at all.
    await Promise.all(Array.from({ length: 8 }, (_, i) => src(`forged-again-${i}`)));
    assert.equal(calls, 1);
    // A failed fetch is not retried for 5 minutes either, and does not throw away the keys already held.
    t += 6 * 60_000;
    fail = true;
    await assert.rejects(src('forged-later'));
    assert.equal(calls, 2);
    // In the retry gap after a failed fetch, a key we do not hold is "unavailable" too (Arisha review, 4 Nov 2026).
    await assert.rejects(src('forged-later-2'), /Could not load Microsoft signing keys \(503\)/);
    assert.ok(await src('k1'), 'the key already held still works');
    assert.equal(calls, 2);
  });

  it('gives up on a key fetch that does not answer in time, says so without any token, and waits 5 minutes (Arisha review)', async () => {
    let calls = 0;
    let t = NOW;
    let seenSignal: AbortSignal | undefined;
    // A key endpoint that never answers on its own; it stops only when the request is aborted.
    const hung = ((_url: string, init?: RequestInit) => {
      calls += 1;
      seenSignal = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as typeof fetch;
    const src = microsoftKeys(TENANT, hung, () => t, 30);
    const started = Date.now();
    await assert.rejects(src('k1'), (e: Error) => {
      assert.equal(e.message, 'Microsoft signing keys did not answer in time.');
      assert.doesNotMatch(e.message, /eyJ|Bearer|secret/i);
      return true;
    });
    assert.ok(Date.now() - started < 2_000, 'stopped by the time limit');
    assert.equal(seenSignal?.aborted, true, 'the request itself was aborted');
    // Within the retry gap nothing is fetched again; after it, one new attempt.
    await assert.rejects(src('k1'));
    assert.equal(calls, 1);
    t += 6 * 60_000;
    await assert.rejects(src('k1'));
    assert.equal(calls, 2);
  });

  it('tells every request waiting on a failed or timed-out key fetch that keys are unavailable, not that the key is unknown (Arisha review)', async () => {
    const jwk = { ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
    let calls = 0;
    let mode: 'hang' | 'down' | 'ok' = 'hang';
    let t = NOW;
    const fetcher = ((_url: string, init?: RequestInit) => {
      calls += 1;
      if (mode === 'down') return Promise.resolve(new Response('down', { status: 503 }));
      if (mode === 'ok') return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] })));
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as typeof fetch;
    const src = microsoftKeys(TENANT, fetcher, () => t, 30);
    // Five valid-token requests on a cold cache share one fetch that times out: all five are told keys are unavailable.
    const cold = await Promise.allSettled(Array.from({ length: 5 }, () => verifyEntraToken(token(), cfg, src, NOW)));
    assert.equal(calls, 1);
    for (const r of cold) {
      assert.equal(r.status, 'rejected');
      assert.ok(!((r as PromiseRejectedResult).reason instanceof EntraTokenError), 'never "unknown signing key"');
      assert.equal((r as PromiseRejectedResult).reason.message, 'Microsoft signing keys did not answer in time.');
    }
    // A shared fetch that fails with an error status: the same for every waiter.
    t += 6 * 60_000;
    mode = 'down';
    const down = await Promise.allSettled(Array.from({ length: 5 }, () => src('k1')));
    assert.equal(calls, 2);
    assert.ok(down.every((r) => r.status === 'rejected' && /Could not load Microsoft signing keys \(503\)/.test(String(r.reason?.message))));
    // Once keys are held, a later failed refresh does not stop a known key, and an unknown key is still refused as such.
    t += 6 * 60_000;
    mode = 'ok';
    assert.ok(await src('k1'));
    t += 6 * 60_000;
    mode = 'down';
    const later = await Promise.allSettled([src('new-kid'), src('k1'), src('k1')]);
    assert.equal(later[0].status, 'rejected', 'the request that started the failed refresh hears it failed');
    assert.ok(later.slice(1).every((r) => r.status === 'fulfilled' && r.value), 'known key still works for waiters');
  });

  it('rotated key during an outage: unavailable for the first request and for every later one in the retry gap, then recovers (Arisha review)', async () => {
    const k1 = { ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
    const k2 = { ...other.publicKey.export({ format: 'jwk' }), kid: 'k2', use: 'sig' };
    let calls = 0;
    let mode: 'old' | 'down' | 'rotated' = 'old';
    let t = NOW;
    const fetcher = (async () => {
      calls += 1;
      if (mode === 'down') return new Response('down', { status: 503 });
      return new Response(JSON.stringify({ keys: mode === 'old' ? [k1] : [k1, k2] }));
    }) as typeof fetch;
    const src = microsoftKeys(TENANT, fetcher, () => t);
    assert.ok(await src('k1'));
    // Microsoft rotates to k2 while its key endpoint is down.
    t += 6 * 60_000;
    mode = 'down';
    const first = await Promise.allSettled([src('k2'), src('k2'), src('k2')]);
    assert.equal(calls, 2);
    assert.ok(first.every((r) => r.status === 'rejected'), 'starter and waiters: unavailable');
    // Later in the retry gap: still unavailable, never "unknown key" (which would ask staff to sign in again).
    t += 60_000;
    await assert.rejects(src('k2'), /Could not load Microsoft signing keys \(503\)/);
    await assert.rejects(verifyEntraToken(token({}, { kid: 'k2' }, other.privateKey), cfg, src, NOW), (e: Error) => !(e instanceof EntraTokenError));
    assert.ok(await src('k1'), 'the old key still works');
    assert.equal(calls, 2, 'no fetch in the retry gap');
    // Endpoint back after the gap: one fetch, the new key works for everyone.
    t += 5 * 60_000;
    mode = 'rotated';
    const back = await Promise.all([src('k2'), src('k2')]);
    assert.ok(back.every(Boolean));
    assert.equal(calls, 3);
    // A key that really is unknown, after a good fetch, is "unknown" again.
    assert.equal(await src('k9'), null);
  });

  it('expired cache during an outage: the request that starts the refresh and those waiting on it get the same answer (Arisha review)', async () => {
    const k1 = { ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
    let calls = 0;
    let down = false;
    let release!: () => void;
    let gate: Promise<void> = Promise.resolve();
    let t = NOW;
    const fetcher = (async () => {
      calls += 1;
      await gate;
      if (down) return new Response('down', { status: 503 });
      return new Response(JSON.stringify({ keys: [k1] }));
    }) as typeof fetch;
    const src = microsoftKeys(TENANT, fetcher, () => t);
    assert.ok(await src('k1'));
    // A day later the cache has expired and Microsoft is down: starter and waiters all fail closed.
    t += 25 * 3_600_000;
    down = true;
    gate = new Promise<void>((r) => (release = r));
    const all = Promise.allSettled([src('k1'), src('k1'), src('k1'), src('nope')]);
    release();
    const got = await all;
    assert.equal(calls, 2);
    assert.ok(got.slice(0, 3).every((r) => r.status === 'rejected'), 'every expired k1 request fails closed, starter included');
    assert.equal(got[3].status, 'rejected', 'a key we do not hold is unavailable, not unknown');
    // And in the retry gap after that failure, the same.
    t += 60_000;
    await assert.rejects(src('k1'));
    await assert.rejects(src('nope'));
    // Held keys remain refused beyond 24 hours without a successful refresh; no unapproved 72-hour fallback.
    t = NOW + 3 * 24 * 3_600_000 + 60_000;
    await assert.rejects(src('k1'));
    // Recovery: one good fetch and everything answers normally.
    down = false;
    t += 6 * 60_000;
    assert.ok(await src('k1'));
    assert.equal(await src('nope'), null);
  });

  it('a burst of forged Microsoft sign-ins from one address causes at most one key fetch, checks every admitted request two at a time, and does no identity work once the address is over its limit', async () => {
    let calls = 0;
    let verifications = 0;
    let running = 0;
    let most = 0;
    const jwk = { ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
    const fetcher = (async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ keys: [jwk] }));
    }) as typeof fetch;
    const src = microsoftKeys(TENANT, fetcher, () => NOW);
    const identify = async (h: string) => {
      verifications += 1;
      most = Math.max(most, ++running);
      try {
        return `entra:${(await verifyEntraToken(h.slice(7), cfg, src, NOW)).oid}`;
      } finally {
        running -= 1;
      }
    };
    // Address limit 6 a minute, unverified limit 6, at most 2 identity checks at once per address.
    const limit = rateLimit(6, 60_000, () => NOW, 6, identify, 2);
    const run = (auth: string) =>
      new Promise<number>((resolve) => {
        const res = { setHeader: () => undefined, status: (s: number) => ({ json: () => resolve(s) }) };
        limit({ path: '/api/home', ip: '203.0.113.9', headers: { authorization: auth } } as never, res as never, () => resolve(200));
      });
    const forged = (i: number) => `Bearer ${token({}, { kid: `forged-${i}` })}`;
    const first = await Promise.all(Array.from({ length: 8 }, (_, i) => run(forged(i))));
    assert.equal(calls, 1, 'one shared key fetch');
    assert.ok(most <= 2, `only 2 identity checks ran at once (${most})`);
    assert.equal(verifications, 6, 'every admitted request was checked (queued, never passed unchecked)');
    assert.deepEqual(first.filter((s) => s === 429).length, 2, 'the address limit of 6 refuses the rest');
    const before = verifications;
    const later = await Promise.all(Array.from({ length: 5 }, (_, i) => run(forged(100 + i))));
    assert.ok(later.every((s) => s === 429));
    assert.equal(verifications, before, 'no identity check once the address is over its limit');
    assert.equal(calls, 1);
  });
});
