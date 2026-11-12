// E7 (P100, Fauzan 11 Nov 2026): CMS operators sign in with Microsoft through Prima. The ticket format agrees with the
// CMS (shared vector in apps/cms/test/signin.test.ts), the setting is off until both values are set, and on the real
// store only roster staff with their own account (or Arms Control) get a ticket. Mock data and synthetic secrets only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { AccessDenied, myt } from '@prima/core';
import { CmsSignInController, cmsSignInSetup, signCmsTicket, type CmsTicketClaims } from '../src/cms-signin.controller';
import type { AuthedRequest } from '../src/auth';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const SECRET = 'synthetic-cms-signin-secret-for-tests-0001';
const VECTOR =
  'cmst1.eyJ2IjoxLCJzdWIiOiJ1LWNtcy0xIiwibmFtZSI6IlN5bnRoZXRpYyBPcGVyYXRvciIsInBvc3RzIjpbIkhFQURfQ09OVFJPTCJdLCJ2aWEiOiJtaWNyb3NvZnQiLCJpYXQiOjE3OTQwMDAwMDAsImV4cCI6MTc5NDAwMDA2MCwibiI6InN5bnRoZXRpYy1ub25jZS0wMDAxIn0.UXs2wtPOxzSBxbK2fxyTilj71JFhg0ekVyMCjT8QTXc';

describe('E7 CMS console sign-in (Prima side)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, myt('2026-11-12', '09:00'));
    db = new Db();
  });
  after(async () => {
    delete process.env.CMS_URL;
    delete process.env.CMS_SIGNIN_SECRET;
    await db.onModuleDestroy();
  });

  it('signs tickets the way the CMS checks them, and stays off until both settings are there', () => {
    const v: CmsTicketClaims = { v: 1, sub: 'u-cms-1', name: 'Synthetic Operator', posts: ['HEAD_CONTROL'], via: 'microsoft', iat: 1794000000, exp: 1794000060, n: 'synthetic-nonce-0001' };
    assert.equal(signCmsTicket(v, SECRET), VECTOR);
    assert.equal(cmsSignInSetup({}), null);
    assert.equal(cmsSignInSetup({ CMS_URL: 'https://cms.example.test' }), null);
    assert.equal(cmsSignInSetup({ CMS_URL: 'https://cms.example.test', CMS_SIGNIN_SECRET: 'short' }), null);
    assert.equal(cmsSignInSetup({ CMS_URL: 'http://cms.example.test', CMS_SIGNIN_SECRET: SECRET, NODE_ENV: 'production' }), null);
    assert.deepEqual(cmsSignInSetup({ CMS_URL: 'https://cms.example.test/', CMS_SIGNIN_SECRET: SECRET }), { url: 'https://cms.example.test', secret: SECRET });
  });

  it('gives roster staff a one-time ticket and refuses everyone else', async () => {
    const c = new CmsSignInController(db);
    const req = {} as AuthedRequest;
    await assert.rejects(c.signIn('u-cms-head', req), /not set up/);
    process.env.CMS_URL = 'https://cms.example.test';
    process.env.CMS_SIGNIN_SECRET = SECRET;
    assert.deepEqual(await c.status('u-cms-head'), { on: true, url: 'https://cms.example.test', may: true });
    assert.deepEqual(await c.status('u-cm-sasa'), { on: true, url: 'https://cms.example.test', may: false });
    const r = await c.signIn('u-cms-head', req);
    assert.match(r.url, /^https:\/\/cms\.example\.test\/#ticket=cmst1\.[\w-]+\.[\w-]+$/);
    const claims = JSON.parse(Buffer.from(r.url.split('#ticket=cmst1.')[1].split('.')[0], 'base64url').toString()) as CmsTicketClaims;
    assert.equal(claims.sub, 'u-cms-head');
    assert.equal(claims.exp - claims.iat, 60);
    assert.equal(claims.via, 'dev');
    // A second ticket is a different one-time number.
    const r2 = await c.signIn('u-cms-head', req);
    assert.notEqual(r2.url, r.url);
    for (const who of ['u-cm-sasa', 'u-transport']) await assert.rejects(c.signIn(who, req), (e) => e instanceof AccessDenied, who);
    // A guard phone session never opens the console.
    await assert.rejects(c.signIn('u-cms-head', { guardSessionId: 'gs-1' } as AuthedRequest), /guard phone/);
    const audit = (await db.pool.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' = 'cms.console.sign_in'`)).rows[0].n;
    assert.equal(audit, 2);
  });
});
