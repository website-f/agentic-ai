// Operator Microsoft sign-in (E7). Synthetic tenant, app and accounts only; a test key pair signs the tokens. No
// Microsoft, Prima or Azure connection.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { demoDirectory } from '../src/demo';
import { Hub } from '../src/hub';
import { GateLists } from '../src/adaptors/anpr';
import { configFromEnv, handler, type AppState, type ServerConfig } from '../src/server';
import { cmsEntraConfig, rosterAccess, verifyOperatorToken, type CmsEntraConfig } from '../src/operator-sign-in';

const T0 = new Date('2026-11-05T10:00:00Z');
const TENANT = '00000000-0000-4000-8000-000000000001';
const APP = '00000000-0000-4000-8000-000000000002';
const OID_HC = '00000000-0000-4000-8000-0000000000a1';
const OID_NEXT = '00000000-0000-4000-8000-0000000000a2';
const OID_NONE = '00000000-0000-4000-8000-0000000000a9';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = async (kid: string) => (kid === 'k1' ? publicKey : null);
const cfgE: CmsEntraConfig = { tenantId: TENANT, clientId: APP, appIdUri: `api://${APP}`, mfaByPolicy: false, graceMin: 30 };

function token(claims: Record<string, unknown>, alg = 'RS256'): string {
  const now = Math.floor(T0.getTime() / 1000);
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = { ver: '2.0', tid: TENANT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: APP, exp: now + 3600, nbf: now - 60, amr: ['pwd', 'mfa'], oid: OID_HC, ...claims };
  const head = `${b({ alg, kid: 'k1', typ: 'JWT' })}.${b(body)}`;
  return `${head}.${createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url')}`;
}

function directory() {
  const d = demoDirectory(T0);
  d.desk = d.desk!.map((s) => (s.staffName === 'Demo operator' ? { ...s, entraOid: OID_HC } : s.staffName === 'Sample Head Control B' ? { ...s, entraOid: OID_NEXT } : s));
  return d;
}

describe('CMS operator Microsoft sign-in (E7)', () => {
  it('is off by default and keeps operator keys exactly as before', () => {
    assert.equal(cmsEntraConfig({}), null);
    const base = { CMS_GATEWAY_KEY: 'g', CMS_GATEWAY_SECRET: 'g', PRIMA_TO_CMS_KEY: 'p', PRIMA_TO_CMS_SECRET: 'p' };
    assert.throws(() => configFromEnv(base), /CMS_OPERATOR_KEYS is not set/);
    const on = { ...base, CMS_ENTRA_SIGN_IN: 'true', CMS_ENTRA_TENANT_ID: TENANT, CMS_ENTRA_CLIENT_ID: APP };
    assert.equal(configFromEnv(on).operators.size, 0);
    // Cut-over: personal keys refused at start unless break-glass with exactly one sealed key.
    const keysJson = JSON.stringify({ 'sealed-key-for-tests-only-000001': 'Break-glass' });
    assert.throws(() => configFromEnv({ ...on, CMS_OPERATOR_KEYS: keysJson }), /remove CMS_OPERATOR_KEYS/);
    assert.equal(configFromEnv({ ...on, CMS_OPERATOR_KEYS: keysJson, CMS_BREAK_GLASS: 'true' }).breakGlass, true);
    assert.throws(() => configFromEnv({ ...on, CMS_ENTRA_CLIENT_ID: 'x' }), /GUIDs/);
  });

  it('refuses another tenant, another app, an expired token, no MFA, a bad signature and a non-RS256 token', async () => {
    const now = T0.getTime();
    assert.equal(await verifyOperatorToken(token({}), cfgE, keys, now), OID_HC);
    await assert.rejects(verifyOperatorToken(token({ tid: OID_NONE }), cfgE, keys, now), /other tenant/);
    await assert.rejects(verifyOperatorToken(token({ aud: OID_NONE }), cfgE, keys, now), /another app/);
    await assert.rejects(verifyOperatorToken(token({ exp: Math.floor(now / 1000) - 600 }), cfgE, keys, now), /expired/);
    await assert.rejects(verifyOperatorToken(token({ amr: ['pwd'] }), cfgE, keys, now), /no MFA/);
    assert.equal(await verifyOperatorToken(token({ amr: ['pwd'] }), { ...cfgE, mfaByPolicy: true }, keys, now), OID_HC);
    await assert.rejects(verifyOperatorToken(token({}, 'HS256'), cfgE, keys, now), /wrong algorithm/);
    const t = token({});
    await assert.rejects(verifyOperatorToken(t.slice(0, -4) + 'AAAA', cfgE, keys, now), /bad signature/);
  });

  it('admits only people on Prima\'s desk roster; off shift is read only; removal from the roster ends access', () => {
    const d = directory();
    const now = T0.getTime();
    assert.equal(rosterAccess(OID_HC, d.desk, now, 30).canAct, true);
    assert.equal(rosterAccess(OID_HC, d.desk, now, 30).name, 'Demo operator');
    assert.throws(() => rosterAccess(OID_NONE, d.desk, now, 30), /not on the CMS desk roster/);
    // Next Head Control starts at T0+30 min: within the 30-minute grace already, but not 2 hours before a later seat.
    assert.equal(rosterAccess(OID_NEXT, d.desk, now, 30).canAct, true);
    assert.equal(rosterAccess(OID_NEXT, d.desk, now, 0).canAct, false);
    assert.equal(rosterAccess(OID_HC, d.desk, now + 2 * 3_600_000, 30).canAct, false);
    const removed = d.desk!.filter((s) => s.entraOid !== OID_HC);
    assert.throws(() => rosterAccess(OID_HC, removed, now, 30), /not on the CMS desk roster/);
  });

  it('over HTTP: a rostered operator reads and acts, off shift reads only, keys are refused, break-glass is recorded', async () => {
    let t = T0.getTime();
    const hub = new Hub(directory(), () => new Date(t));
    const state: AppState = { hub, lists: new GateLists(), routes: new Map() };
    const SEALED = 'sealed-key-for-tests-only-000001';
    const cfg: ServerConfig = { operators: new Map([[SEALED, 'Break-glass operator']]), entra: cfgE, entraKeys: keys, breakGlass: false, gateway: { key: 'gw', secret: 'gw-s' }, prima: { key: 'pr', secret: 'pr-s' } };
    const srv = createServer((req, res) => void handler(cfg, state, () => t)(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const get = (p: string, bearer: string) => fetch(base + p, { headers: { authorization: `Bearer ${bearer}` } });
    const post = (p: string, bearer: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      assert.equal((await get('/api/state', token({}))).status, 200);
      assert.equal((await get('/api/state', token({ oid: OID_NONE }))).status, 403);
      assert.equal((await get('/api/state', SEALED)).status, 401);
      const fb = await post('/api/assistant/feedback', token({}), { key: 'x', useful: true });
      assert.notEqual(fb.status, 401);
      assert.notEqual(fb.status, 403);
      // Two hours after the seat ended: read yes, act no.
      t += 2 * 3_600_000 + 30 * 60_000;
      const late = token({ exp: Math.floor(t / 1000) + 3600, nbf: Math.floor(t / 1000) - 60 });
      assert.equal((await get('/api/state', late)).status, 200);
      assert.equal((await post('/api/assistant/feedback', late, { key: 'x', useful: true })).status, 403);
      // Break-glass on: the sealed key works and every use is recorded.
      cfg.breakGlass = true;
      const st = (await (await get('/api/state', SEALED)).json()) as { breakGlassUses: { operator: string }[] };
      assert.equal(st.breakGlassUses[0].operator, 'Break-glass operator');
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
