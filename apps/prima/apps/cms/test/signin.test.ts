// E7 (Fauzan, 11 Nov 2026): CMS operators sign in with Microsoft through Prima instead of a personal key. Synthetic
// secrets and names only; no network beyond a local test server.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { demoDirectory } from '../src/demo';
import { makeEvent } from '../src/event';
import { Hub } from '../src/hub';
import { GateLists } from '../src/adaptors/anpr';
import { configFromEnv, handler, type ServerConfig } from '../src/server';
import { Sessions, signInFromEnv, signTicket, verifyTicket, type TicketClaims } from '../src/signin';

const SECRET = 'synthetic-cms-signin-secret-for-tests-0001';
const T0 = new Date('2026-11-12T02:00:00Z');
const now = Math.floor(T0.getTime() / 1000);
const claims = (over: Partial<TicketClaims> = {}): TicketClaims => ({ v: 1, sub: 'u-cms-1', name: 'Synthetic Operator', posts: ['HEAD_CONTROL'], via: 'microsoft', iat: now, exp: now + 60, n: `nonce-${Math.random().toString(36).slice(2)}-0001`, ...over });
const signin = { secret: SECRET, accept: ['microsoft', 'office'] as TicketClaims['via'][], idleMin: 15, maxHours: 12, primaUrl: 'https://prima.example.test/#cms' };

// The same vector is checked by the Prima API test (cms-signin.test.ts), so Prima's tickets and the CMS's check agree.
const VECTOR =
  'cmst1.eyJ2IjoxLCJzdWIiOiJ1LWNtcy0xIiwibmFtZSI6IlN5bnRoZXRpYyBPcGVyYXRvciIsInBvc3RzIjpbIkhFQURfQ09OVFJPTCJdLCJ2aWEiOiJtaWNyb3NvZnQiLCJpYXQiOjE3OTQwMDAwMDAsImV4cCI6MTc5NDAwMDA2MCwibiI6InN5bnRoZXRpYy1ub25jZS0wMDAxIn0.UXs2wtPOxzSBxbK2fxyTilj71JFhg0ekVyMCjT8QTXc';

describe('E7 operator sign-in through Prima', () => {
  it('checks the ticket: signature, time, route, shape, and the shared vector', () => {
    const v = { v: 1, sub: 'u-cms-1', name: 'Synthetic Operator', posts: ['HEAD_CONTROL'], via: 'microsoft', iat: 1794000000, exp: 1794000060, n: 'synthetic-nonce-0001' } as TicketClaims;
    assert.equal(signTicket(v, SECRET), VECTOR);
    assert.equal(verifyTicket(VECTOR, signin, 1794000010_000).ok, true);
    const good = signTicket(claims(), SECRET);
    assert.equal(verifyTicket(good, signin, T0.getTime()).ok, true);
    assert.deepEqual(verifyTicket(good, { ...signin, secret: 'another-synthetic-secret-of-enough-length' }, T0.getTime()), { ok: false, reason: 'signature' });
    assert.deepEqual(verifyTicket(good, signin, T0.getTime() + 120_000), { ok: false, reason: 'expired' });
    assert.deepEqual(verifyTicket(signTicket(claims({ via: 'dev' }), SECRET), signin, T0.getTime()), { ok: false, reason: 'sign-in route not accepted' });
    assert.deepEqual(verifyTicket(signTicket(claims({ exp: now + 3600 }), SECRET), signin, T0.getTime()), { ok: false, reason: 'time' });
    assert.deepEqual(verifyTicket(signTicket(claims({ name: ' ' }), SECRET), signin, T0.getTime()), { ok: false, reason: 'shape' });
    assert.deepEqual(verifyTicket('Bearer abc', signin, T0.getTime()), { ok: false, reason: 'not a ticket' });
    // A tampered payload fails the signature.
    const [p, sig] = good.slice(6).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), name: 'Someone Else' })).toString('base64url');
    assert.equal(verifyTicket(`cmst1.${forged}.${sig}`, signin, T0.getTime()).ok, false);
  });

  it('takes a ticket once and ends a session after 15 idle minutes or 12 hours', () => {
    const s = new Sessions(signin);
    const c = claims();
    const one = s.start(c, T0.getTime());
    assert.ok(one);
    assert.equal(s.start(c, T0.getTime() + 1000), null);
    assert.equal(s.get(one.id, T0.getTime() + 14 * 60_000)?.operator, 'Synthetic Operator');
    assert.equal(s.get(one.id, T0.getTime() + 30 * 60_000), null);
    const two = s.start(claims(), T0.getTime())!;
    let t = T0.getTime();
    for (let i = 0; i < 12 * 6; i++) assert.ok(s.get(two.id, (t += 10 * 60_000)));
    assert.equal(s.get(two.id, (t += 10 * 60_000)), null);
  });

  it('signs in through Prima, refuses replays, cross-site changes and keys when break-glass is off', async () => {
    const cfg: ServerConfig = { operators: new Map(), signin, gateway: { key: 'gw', secret: 'gw-secret' }, prima: { key: 'pr', secret: 'pr-secret' } };
    let clock = T0.getTime();
    const hub = new Hub(demoDirectory(T0), () => new Date(clock));
    const state = { hub, lists: new GateLists(), routes: new Map() };
    const srv = createServer((req, res) => void handler(cfg, state, () => clock)(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    try {
      assert.deepEqual(await (await fetch(`${base}/auth/options`)).json(), { microsoft: true, primaUrl: 'https://prima.example.test/#cms', keys: false });
      assert.equal((await fetch(`${base}/api/state`)).status, 401);
      assert.equal((await fetch(`${base}/api/state`, { headers: { authorization: 'Bearer operator-key-for-tests-only-0001' } })).status, 401);
      const ticket = signTicket(claims(), SECRET);
      const r = await post('/auth/prima', { ticket });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { operator: 'Synthetic Operator', via: 'microsoft' });
      const cookie = r.headers.get('set-cookie') ?? '';
      assert.match(cookie, /^cms_session=[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
      const jar = cookie.split(';')[0];
      assert.equal((await post('/auth/prima', { ticket })).status, 401, 'a ticket is used once');
      assert.equal((await post('/auth/prima', { ticket: signTicket(claims(), 'another-synthetic-secret-of-enough-length') })).status, 401);
      assert.equal((await fetch(`${base}/api/state`, { headers: { cookie: jar } })).status, 200);
      assert.deepEqual(await (await fetch(`${base}/auth/me`, { headers: { cookie: jar } })).json(), { operator: 'Synthetic Operator', via: 'microsoft' });
      // A change needs the X-CMS-Request header (another site cannot send it); with it, the change is in the operator's name.
      hub.ingest(makeEvent({ id: 'ev-signin', kind: 'INTRUSION', companyId: 'co-jbk', siteId: 'site-jbk-plaza', deviceId: 'panel-plaza', source: 'test', summary: 'Synthetic intrusion', detail: {}, receivedAt: T0.toISOString() }));
      const alarm = hub.queue()[0];
      assert.ok(alarm);
      {
        assert.equal((await post(`/api/alarms/${alarm.id}/acknowledge`, {}, { cookie: jar })).status, 403);
        assert.equal((await post(`/api/alarms/${alarm.id}/acknowledge`, {}, { cookie: jar, 'x-cms-request': '1' })).status, 200);
        assert.equal(hub.audit.find((a) => a.action === 'acknowledge')?.operator, 'Synthetic Operator');
      }
      assert.ok(hub.audit.some((a) => a.action === 'sign-in' && a.operator === 'Synthetic Operator' && /through Prima \(microsoft\)/.test(a.note ?? '')));
      assert.ok(hub.refused.some((x) => x.source === 'operator-sign-in' && /used twice/.test(x.reason)));
      // Idle for 16 minutes: signed out.
      clock += 16 * 60_000;
      assert.equal((await fetch(`${base}/api/state`, { headers: { cookie: jar } })).status, 401);
      // Signing out ends the session at once.
      const r2 = await post('/auth/prima', { ticket: signTicket(claims({ iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 60 }), SECRET) });
      const jar2 = (r2.headers.get('set-cookie') ?? '').split(';')[0];
      assert.equal((await post('/auth/signout', {}, { cookie: jar2 })).status, 200);
      assert.equal((await fetch(`${base}/api/state`, { headers: { cookie: jar2 } })).status, 401);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('keeps the operator key only as a switched-off break-glass fallback', () => {
    const base = { CMS_GATEWAY_KEY: 'g', CMS_GATEWAY_SECRET: 'g', PRIMA_TO_CMS_KEY: 'p', PRIMA_TO_CMS_SECRET: 'p' };
    const keys = JSON.stringify({ 'operator-key-for-tests-only-0001': 'Break Glass' });
    // Microsoft through Prima only: no keys.
    assert.equal(configFromEnv({ ...base, CMS_SIGNIN_SECRET: SECRET }).operators.size, 0);
    // Keys left set without the switch: CMS refuses to start.
    assert.throws(() => configFromEnv({ ...base, CMS_SIGNIN_SECRET: SECRET, CMS_OPERATOR_KEYS: keys }), /CMS_BREAK_GLASS/);
    // The switch on: the sealed key works alongside Microsoft sign-in.
    assert.equal(configFromEnv({ ...base, CMS_SIGNIN_SECRET: SECRET, CMS_OPERATOR_KEYS: keys, CMS_BREAK_GLASS: 'true' }).operators.size, 1);
    assert.throws(() => configFromEnv({ ...base, CMS_BREAK_GLASS: 'true' }), /needs CMS_OPERATOR_KEYS/);
    // No way in at all, or a short secret: refused.
    assert.throws(() => configFromEnv(base), /CMS_SIGNIN_SECRET is not set/);
    assert.throws(() => signInFromEnv({ CMS_SIGNIN_SECRET: 'short' }), /at least 32/);
    // Development sign-in is never accepted outside the demo.
    assert.deepEqual(signInFromEnv({ CMS_SIGNIN_SECRET: SECRET, CMS_SIGNIN_ACCEPT: 'microsoft,dev' })?.accept, ['microsoft']);
    assert.deepEqual(signInFromEnv({ CMS_SIGNIN_SECRET: SECRET, CMS_SIGNIN_ACCEPT: 'microsoft,dev' }, true)?.accept, ['microsoft', 'dev']);
  });
});
