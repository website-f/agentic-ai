// The API over real HTTP, as the website calls it on Azure (pre-publication review, 28 Oct 2026): Microsoft sign-in,
// company walls, what a browser may see, CORS, security headers and the request limit. Uses the same throwaway local
// database as rls.test.ts and resets it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { entraSetup, resetEntraSetup } from '../src/auth';
import { Db } from '../src/db';
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
    assert.deepEqual(r.body, { microsoft: { tenantId: TENANT, clientId: SPA, scope: `api://${API}/access_as_user` }, devLogin: false });
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

  it('answers bad input with 400 and an unknown record with 404, never a server error', async () => {
    const t = token(CEO);
    const bad = await call('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(bad.status, 400);
    assert.equal((await call('/api/people/nobody', { as: t })).status, 404);
  });
});

describe('request limit', () => {
  it('answers 429 after the limit and starts again in the next minute, but never limits health checks', () => {
    let t = 0;
    const limit = rateLimit(3, 60_000, () => t);
    const run = (path = '/api/me', ip = '1.1.1.1') => {
      let status = 200;
      let passed = false;
      const res = { setHeader: () => undefined, status: (s: number) => ((status = s), { json: () => undefined }) };
      limit({ path, ip } as never, res as never, () => (passed = true));
      return passed ? 200 : status;
    };
    assert.deepEqual([run(), run(), run(), run()], [200, 200, 200, 429]);
    assert.equal(run('/api/me', '2.2.2.2'), 200, 'another address has its own count');
    assert.equal(run('/api/health'), 200);
    t = 60_000;
    assert.equal(run(), 200);
  });
});
