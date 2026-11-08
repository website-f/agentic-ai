// The API over real HTTP, as the website calls it on Azure (pre-publication review, 28 Oct 2026): Microsoft sign-in,
// company walls, what a browser may see, CORS, security headers and the request limit. Uses the same throwaway local
// database as rls.test.ts and resets it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { entraSetup, issueToken, rateIdentity, resetEntraSetup } from '../src/auth';
import { Db } from '../src/db';
import { microsoftKeys } from '../src/entra';
import { linkEntra } from '../src/entra-link';
import { createApp } from '../src/main';
import { resetDb } from '../src/reset-db';
import { rateLimit } from '../src/security';

const URL_ = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL_;

const TENANT = '11111111-2222-3333-4444-555555555555';
const SPA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const API = 'cccccccc-1111-2222-3333-444444444444';
const CEO = '0c0c0c0c-0000-4000-8000-000000000001';
const LEAD = '0c0c0c0c-0000-4000-8000-000000000002';
const WEB = 'https://ashy-field-095365900.3.azurestaticapps.net';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function token(oid: string, over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'k1' });
  const body = b64({
    ver: '2.0',
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    aud: `api://${API}`,
    azp: SPA,
    tid: TENANT,
    oid,
    scp: 'access_as_user',
    nbf: now - 60,
    exp: now + 3600,
    ...over,
  });
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(pair.privateKey).toString('base64url')}`;
}

describe('API over HTTP with Microsoft sign-in', () => {
  let app: INestApplication;
  let base: string;
  const saved = { ...process.env };

  async function call(path: string, init: RequestInit & { as?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.as) headers.set('authorization', `Bearer ${init.as}`);
    const res = await fetch(`${base}${path}`, { ...init, headers });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: text ? JSON.parse(text) : null };
  }

  before(async () => {
    await resetDb(URL_);
    const db = new Db();
    const c = await db.pool.connect();
    try {
      await linkEntra(c, 'u-fauzan', CEO, 'Test');
      await linkEntra(c, 'u-it-lead', LEAD, 'Test');
    } finally {
      c.release();
      await db.onModuleDestroy();
    }
    Object.assign(process.env, { ENTRA_TENANT_ID: TENANT, ENTRA_SPA_CLIENT_ID: SPA, ENTRA_API_CLIENT_ID: API, WEB_ORIGIN: `${WEB}/` });
    delete process.env.ALLOW_DEV_LOGIN;
    resetEntraSetup();
    entraSetup(async (kid) => (kid === 'k1' ? pair.publicKey : null));
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  after(async () => {
    await app?.close();
    for (const k of ['ENTRA_TENANT_ID', 'ENTRA_SPA_CLIENT_ID', 'ENTRA_API_CLIENT_ID', 'WEB_ORIGIN', 'ALLOW_DEV_LOGIN']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEntraSetup();
  });

  it('tells the website to use Microsoft sign-in with the API scope, and keeps the test sign-in off', async () => {
    const r = await call('/api/auth/config');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { microsoft: { tenantId: TENANT, clientId: SPA, scope: `api://${API}/access_as_user` }, devLogin: false, guardPhone: false, office: false });
    assert.equal((await call('/api/auth/users')).status, 403);
    assert.equal((await call('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"userId":"u-fauzan"}' })).status, 403);
  });

  it('refuses every screen without a valid Microsoft sign-in', async () => {
    assert.equal((await call('/api/me')).status, 401);
    assert.equal((await call('/api/group/overview')).status, 401);
    const now = Math.floor(Date.now() / 1000);
    assert.equal((await call('/api/me', { as: token(CEO, { exp: now - 3600, nbf: now - 7200 }) })).status, 401, 'expired');
    assert.equal((await call('/api/me', { as: token(CEO, { tid: '99999999-2222-3333-4444-555555555555' }) })).status, 401, 'other tenant');
    assert.equal((await call('/api/me', { as: token(CEO, { azp: '99999999-bbbb-cccc-dddd-eeeeeeeeeeee' }) })).status, 401, 'other app');
    const [h, b] = token(CEO).split('.');
    assert.equal((await call('/api/me', { as: `${h}.${b}.AAAA` })).status, 401, 'forged');
    const unlinked = await call('/api/me', { as: token('0c0c0c0c-0000-4000-8000-0000000000ff') });
    assert.equal(unlinked.status, 403);
    assert.match(unlinked.body.message, /not linked/);
  });

  it("shows the CEO the group dashboard from the database's own records", async () => {
    const me = await call('/api/me', { as: token(CEO) });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, 'u-fauzan');
    assert.equal(me.body.companies.length, 38);
    assert.equal(me.body.dataMode, 'test', 'no PRIMA_DATA_MODE set: screens keep the test data label');
    const ov = await call('/api/group/overview', { as: token(CEO) });
    assert.equal(ov.status, 200);
  });

  it("keeps another company's staff, finance and dashboard away from a user without that company", async () => {
    const t = token(LEAD);
    const me = await call('/api/me', { as: t });
    assert.equal(me.status, 200);
    assert.ok(!me.body.companies.some((c: { id: string }) => c.id === 'co-sasa'));
    for (const path of ['/api/companies/co-sasa/dashboard', '/api/companies/co-sasa/people', '/api/companies/co-sasa/sites']) {
      const r = await call(path, { as: t });
      assert.ok(r.status === 403 || r.status === 404, `${path} answered ${r.status}`);
      assert.doesNotMatch(r.text, /"staffNo"|"idMasked"/);
    }
    assert.equal((await call('/api/group/overview', { as: t })).status, 403);
  });

  it("never sends a person's PIN to the browser", async () => {
    const r = await call('/api/companies/co-sasa/people', { as: token(CEO) });
    assert.equal(r.status, 200);
    assert.ok(r.body.length > 0);
    assert.ok(r.body[0].person.staffNo);
    assert.doesNotMatch(r.text, /"pin"/);
    // Nor its hash (pre-publication review R1): the profile says only whether a PIN is set.
    assert.doesNotMatch(r.text, /"pinHash"|h1\$/);
    const one = await call(`/api/people/${r.body[0].person.id}`, { as: token(CEO) });
    assert.equal(one.status, 200);
    assert.doesNotMatch(one.text, /"pinHash"|h1\$/);
    assert.equal(one.body.pinSet, true);
  });

  it('imports a batch of open IT requests for the CEO only, once, even when approved twice at the same moment', async () => {
    const text = 'Title\tRequester\tChannel\tUrgency\nUAT http printer\tUAT Staff H\tTeams\tP2\nUAT http bad\tUAT Staff I\t\tP1';
    const json = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const input = { kind: 'tickets', text, source: 'UAT http batch', batchId: 'batch-http-0001', skipRows: [] };
    const long = await call('/api/it/act/importPreview', { as: token(CEO), ...json({ ...input, source: 's'.repeat(201) }) });
    assert.equal(long.status, 400, 'a source that is too long is refused, not cut short');
    const lead = await call('/api/it/act/importApprove', { as: token(LEAD), ...json(input) });
    assert.equal(lead.status, 403, 'the IT Lead cannot import');
    const preview = await call('/api/it/act/importPreview', { as: token(CEO), ...json(input) });
    assert.equal(preview.status, 201);
    assert.equal(preview.body.ready, 1);
    const approve = { ...input, previewToken: preview.body.previewToken };
    const edited = await call('/api/it/act/importApprove', { as: token(CEO), ...json({ ...approve, text: text.replace('printer', 'scanner') }) });
    assert.equal(edited.status, 400, 'rows changed after the preview are refused');
    const [a, b] = await Promise.all([1, 2].map(() => call('/api/it/act/importApprove', { as: token(CEO), ...json(approve) })));
    assert.deepEqual([a.status, b.status], [201, 201]);
    assert.deepEqual([a.body.already, b.body.already].sort(), [false, true]);
    assert.deepEqual(a.body.created, b.body.created);
    assert.deepEqual(a.body.skipped, b.body.skipped, 'the retry returns the original receipt');
    assert.deepEqual(a.body.skipped.map((s: { row: number }) => s.row), [3]);
    assert.equal(a.body.created.length, 1);
    const retry = await call('/api/it/act/importApprove', { as: token(LEAD), ...json(approve) });
    assert.equal(retry.status, 403, 'a retry of an imported batch is still the CEO only');
    assert.doesNotMatch(retry.text, /IT-\d{4}/);
    const reused = await call('/api/it/act/importApprove', { as: token(CEO), ...json({ ...approve, text: text.replace('printer', 'scanner') }) });
    assert.equal(reused.status, 400, 'the same batch ID with different rows is refused');
    const board = await call('/api/it', { as: token(LEAD) });
    const rows = board.body.tickets.filter((t: { ticket: { importBatchId?: string } }) => t.ticket.importBatchId === 'batch-http-0001');
    assert.equal(rows.length, 1, 'one request created, not two');
    assert.equal(rows[0].ticket.sourceRef, 'UAT http batch, row 2');
  });

  it('lets only the Prima website call the API from a browser', async () => {
    const pre = (origin: string) =>
      call('/api/me', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    assert.equal((await pre(WEB)).headers.get('access-control-allow-origin'), WEB);
    assert.equal((await pre('https://evil.example')).headers.get('access-control-allow-origin'), null);
  });

  it('sends security headers and hides the server type', async () => {
    const r = await call('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  it('answers 503, not "sign in again", to every valid sign-in waiting on Microsoft keys that do not answer (Arisha review)', async () => {
    // A cold key cache and a key endpoint that never answers (time limit 50 ms here): five staff with valid tokens at once.
    let calls = 0;
    const hung = ((_url: string, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as typeof fetch;
    resetEntraSetup();
    entraSetup(microsoftKeys(TENANT, hung, Date.now, 50));
    try {
      const got = await Promise.all(Array.from({ length: 5 }, () => call('/api/me', { as: token(CEO) })));
      assert.equal(calls, 1, 'one shared fetch');
      assert.deepEqual(got.map((r) => r.status), [503, 503, 503, 503, 503]);
      for (const r of got) assert.doesNotMatch(r.text, /eyJ|Bearer/);
    } finally {
      resetEntraSetup();
      entraSetup(async (kid) => (kid === 'k1' ? pair.publicKey : null));
    }
    assert.equal((await call('/api/me', { as: token(CEO) })).status, 200, 'back to normal once keys answer');
  });

  it('answers bad input with 400 and an unknown record with 404, never a server error', async () => {
    const t = token(CEO);
    const bad = await call('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(bad.status, 400);
    assert.equal((await call('/api/people/nobody', { as: t })).status, 404);
  });
});

describe('request limit', () => {
  const runner =
    (limit: ReturnType<typeof rateLimit>) =>
    (path: string, ip: string, auth?: string) =>
      new Promise<number>((resolve) => {
        const res = { setHeader: () => undefined, status: (s: number) => ({ json: () => resolve(s) }) };
        limit({ path, ip, headers: auth ? { authorization: auth } : {} } as never, res as never, () => resolve(200));
      });

  it('answers 429 after the limit and starts again in the next minute, but never limits health checks', async () => {
    let t = 0;
    const go = runner(rateLimit(3, 60_000, () => t));
    const run = (path = '/api/me', ip = '1.1.1.1') => go(path, ip);
    assert.deepEqual([await run(), await run(), await run(), await run()], [200, 200, 200, 429]);
    assert.equal(await run('/api/me', '2.2.2.2'), 200, 'another address has its own count');
    assert.equal(await run('/api/health'), 200);
    t = 60_000;
    assert.equal(await run(), 200);
  });

  it('counts each verified person on a shared address separately; unverified headers share the address limit', async () => {
    const t = 0;
    // Only 'Bearer a' and 'Bearer b' pass the signature check; anything else is unverified.
    const verified: Record<string, string> = { 'Bearer a': 'dev:u-a', 'Bearer b': 'dev:u-b' };
    const go = runner(rateLimit(3, 60_000, () => t, 7, (h) => verified[h] ?? null));
    const run = (auth?: string, ip = '9.9.9.9') => go('/api/home', ip, auth);
    // Two staff in one office (one public address): each verified person has their own 3.
    assert.deepEqual([await run('Bearer a'), await run('Bearer a'), await run('Bearer a'), await run('Bearer a')], [200, 200, 200, 429]);
    assert.deepEqual([await run('Bearer b'), await run('Bearer b'), await run('Bearer b')], [200, 200, 200]);
    // Rotating made-up headers gains nothing: all unverified requests from the address share one count of 3.
    const fake = [];
    for (const h of ['Bearer x1', 'Bearer x2', 'Bearer x3', 'Bearer x4']) fake.push(await run(h, '7.7.7.7'));
    assert.deepEqual(fake, [200, 200, 200, 429]);
    assert.equal(await run(undefined, '7.7.7.7'), 429, 'no header shares the same unverified count');
    // The address as a whole stops at 7 (a, a, a, a, b, b, b already counted).
    assert.equal(await run('Bearer b'), 429);
    assert.equal(await run('Bearer c', '8.8.8.8'), 200, 'another address has its own count');
    // A verified person is counted as themselves even from another address.
    assert.equal(await run('Bearer a', '6.6.6.6'), 429);
    // The real identity check: only a correctly signed token names a person.
    const saved = { a: process.env.ALLOW_DEV_LOGIN, s: process.env.DEV_TOKEN_SECRET };
    process.env.ALLOW_DEV_LOGIN = 'true';
    process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'synthetic-rate-test';
    try {
      const good = issueToken('u-synthetic');
      assert.equal(await rateIdentity(`Bearer ${good}`), 'dev:u-synthetic');
      assert.equal(await rateIdentity(`Bearer ${good.slice(0, -2)}xx`), null);
      assert.equal(await rateIdentity('Bearer made.up'), null);
      assert.equal(await rateIdentity('Basic abc'), null);
    } finally {
      if (saved.a === undefined) delete process.env.ALLOW_DEV_LOGIN;
      else process.env.ALLOW_DEV_LOGIN = saved.a;
      if (saved.s === undefined) delete process.env.DEV_TOKEN_SECRET;
      else process.env.DEV_TOKEN_SECRET = saved.s;
    }
    // A failing identity check counts as unverified, never as an error.
    const broken = runner(rateLimit(1, 60_000, () => t, 7, () => { throw new Error('keys unavailable'); }));
    assert.deepEqual([await broken('/api/home', '5.5.5.5', 'Bearer a'), await broken('/api/home', '5.5.5.5', 'Bearer b')], [200, 429]);
  });
});

// Arisha review, 3 Nov 2026 (retest of 34d130e): with a real signed Microsoft token through the whole app, a request is
// verified once (the limiter and AuthGuard share the check), one person cannot pass their limit by sending at once,
// and a flood of forged tokens beyond the running and waiting slots is refused without being checked.
describe('request limit with signed Microsoft tokens through the whole app', () => {
  let app: INestApplication;
  let base: string;
  const saved = { ...process.env };
  const KEYS = ['ENTRA_TENANT_ID', 'ENTRA_SPA_CLIENT_ID', 'ENTRA_API_CLIENT_ID', 'WEB_ORIGIN', 'ALLOW_DEV_LOGIN', 'RATE_LIMIT_PER_MIN', 'RATE_IDENTIFY_CONCURRENCY', 'RATE_IDENTIFY_QUEUE'];
  let keyCalls = 0;
  let delayMs = 0;
  const me = async (tok: string) => (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${tok}` } })).status;

  before(async () => {
    await resetDb(URL_);
    const db = new Db();
    const c = await db.pool.connect();
    try {
      await linkEntra(c, 'u-fauzan', CEO, 'Test');
      await linkEntra(c, 'u-it-lead', LEAD, 'Test');
    } finally {
      c.release();
      await db.onModuleDestroy();
    }
    // Two calls a minute per person, two sign-in checks at once per address, two more may wait.
    Object.assign(process.env, {
      ENTRA_TENANT_ID: TENANT,
      ENTRA_SPA_CLIENT_ID: SPA,
      ENTRA_API_CLIENT_ID: API,
      WEB_ORIGIN: WEB,
      RATE_LIMIT_PER_MIN: '2',
      RATE_IDENTIFY_CONCURRENCY: '2',
      RATE_IDENTIFY_QUEUE: '2',
    });
    delete process.env.ALLOW_DEV_LOGIN;
    resetEntraSetup();
    // Every signature check asks the key source once, so its calls count the checks.
    entraSetup(async (kid) => {
      keyCalls += 1;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return kid === 'k1' ? pair.publicKey : null;
    });
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  after(async () => {
    await app?.close();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEntraSetup();
  });

  it('checks a signed token once per request: the limiter and AuthGuard share the result', async () => {
    keyCalls = 0;
    assert.equal(await me(token(CEO)), 200);
    assert.equal(keyCalls, 1, 'one signature check, not one in the limiter and another in AuthGuard');
  });

  it('lets one person through only up to their limit when they send at once', async () => {
    keyCalls = 0;
    delayMs = 50;
    const t = token(LEAD);
    const got = await Promise.all(Array.from({ length: 4 }, () => me(t)));
    delayMs = 0;
    assert.deepEqual([...got].sort(), [200, 200, 429, 429], 'limit 2: two answered, two refused');
    assert.equal(keyCalls, 4, 'every request was checked once (two running, two waiting), none passed unchecked');
  });

  it('refuses forged tokens beyond the running and waiting slots without checking them', async () => {
    keyCalls = 0;
    delayMs = 100;
    const [h, b] = token(CEO).split('.');
    const forged = (i: number) => `${h}.${b}.${Buffer.from(`forged-${i}`).toString('base64url')}`;
    const got = await Promise.all(Array.from({ length: 10 }, (_, i) => me(forged(i))));
    delayMs = 0;
    assert.equal(keyCalls, 4, 'only two running and two waiting were checked');
    assert.equal(got.filter((s) => s === 200).length, 0, 'no forged token is ever answered');
    assert.equal(got.filter((s) => s === 429).length, 8, 'six over the queue, then two over the shared unverified limit of 2');
    assert.equal(got.filter((s) => s === 401).length, 2, 'the two within the unverified limit are refused by AuthGuard, unchecked again');
  });
});
