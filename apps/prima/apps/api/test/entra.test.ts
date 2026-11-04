// Microsoft sign-in token checks. Uses a made-up tenant and test keys: no Microsoft service is called.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { EntraTokenError, entraConfig, microsoftKeys, verifyEntraToken, type EntraConfig } from '../src/entra';

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
});
