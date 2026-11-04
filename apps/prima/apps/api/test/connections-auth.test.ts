import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import type { PrimaService, User } from '@prima/core';
import { AuthGuard, entraSetup, issueToken, resetEntraSetup, verifiedEntraAssertion, type AuthedRequest } from '../src/auth';
import { ConnectionsController } from '../src/connections.controller';
import type { ConnectionsActor, SharePointConnections } from '../src/connections';
import type { Db } from '../src/db';

const tenant = '11111111-2222-3333-4444-555555555555';
const api = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const spa = 'cccccccc-1111-2222-3333-444444444444';
const oid = '99999999-8888-7777-6666-555555555555';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const user = { id: 'u-fauzan', name: 'Synthetic CEO', title: 'CEO', role: 'director', opsTier: 'ceo', companyIds: [], siteIds: [], entraOid: oid } as User;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(over: Record<string, unknown> = {}) {
  const sec = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'synthetic-key' });
  const body = b64({ ver: '2.0', iss: `https://login.microsoftonline.com/${tenant}/v2.0`, aud: `api://${api}`, azp: spa, tid: tenant, oid, scp: 'access_as_user', nbf: sec - 60, exp: sec + 3600, ...over });
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(pair.privateKey).toString('base64url')}`;
}
function context(request: AuthedRequest): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('Connections receives only verified, mapped, request-local Microsoft assertions', () => {
  const keys = ['ENTRA_TENANT_ID', 'ENTRA_API_CLIENT_ID', 'ENTRA_SPA_CLIENT_ID', 'ENTRA_API_APP_ID_URI', 'ENTRA_SCOPE', 'ALLOW_DEV_LOGIN', 'DEV_TOKEN_SECRET', 'LEADERSHIP_ONBOARDING_ONLY'];
  const saved = new Map<string, string | undefined>();
  before(() => {
    for (const key of keys) { saved.set(key, process.env[key]); delete process.env[key]; }
    Object.assign(process.env, { ENTRA_TENANT_ID: tenant, ENTRA_API_CLIENT_ID: api, ENTRA_SPA_CLIENT_ID: spa, ALLOW_DEV_LOGIN: 'true', DEV_TOKEN_SECRET: 'synthetic-only' });
    resetEntraSetup();
    entraSetup(async kid => kid === 'synthetic-key' ? pair.publicKey : null);
  });
  after(() => {
    for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    resetEntraSetup();
  });
  function db(mapped = true): Db {
    return { pool: { query: async (_sql: string, params: unknown[]) => params[0] === oid && mapped ? { rowCount: 1, rows: [{ data: user }] } : { rowCount: 0, rows: [] } } } as unknown as Db;
  }

  it('sets the private assertion only after signature verification and linked identity checks', async () => {
    const token = jwt();
    const request = { headers: { authorization: `Bearer ${token}` }, verifiedEntraAssertion: { accessToken: 'forged-property' } } as unknown as AuthedRequest;
    assert.equal(verifiedEntraAssertion(request), null);
    assert.equal(await new AuthGuard(db()).canActivate(context(request)), true);
    assert.deepEqual(verifiedEntraAssertion(request), { userId: user.id, oid, tenantId: tenant, accessToken: token });
    assert.ok(Object.isFrozen(verifiedEntraAssertion(request)));
    assert.equal(verifiedEntraAssertion({ ...request }), null, 'The assertion is not a serializable request property');
  });

  it('never permits development HMAC sign-in or forged request properties to become OBO assertions', async () => {
    const request = { headers: { authorization: `Bearer ${issueToken(user.id)}` }, verifiedEntraAssertion: { accessToken: jwt() } } as unknown as AuthedRequest;
    assert.equal(await new AuthGuard(db()).canActivate(context(request)), true);
    assert.equal(request.userId, user.id);
    assert.equal(verifiedEntraAssertion(request), null);
  });

  it('clears previous verified evidence before a reused request changes to dev or invalid credentials', async () => {
    const guard = new AuthGuard(db());
    const request = { headers: { authorization: `Bearer ${jwt()}` } } as AuthedRequest;
    await guard.canActivate(context(request)); assert.ok(verifiedEntraAssertion(request));
    request.headers.authorization = `Bearer ${issueToken(user.id)}`;
    await guard.canActivate(context(request)); assert.equal(verifiedEntraAssertion(request), null);
    request.headers.authorization = `Bearer ${jwt()}`;
    await guard.canActivate(context(request)); assert.ok(verifiedEntraAssertion(request));
    request.headers.authorization = `Bearer ${jwt({ aud: 'https://graph.microsoft.com' })}`;
    await assert.rejects(guard.canActivate(context(request)));
    assert.equal(verifiedEntraAssertion(request), null);
  });

  it('rejects invalid signatures and tenant claims before retaining any assertion', async () => {
    for (const token of [jwt({ tid: 'aaaaaaaa-1111-2222-3333-444444444444' }), jwt().replace(/.$/, '!')]) {
      const request = { headers: { authorization: `Bearer ${token}` } } as AuthedRequest;
      await assert.rejects(new AuthGuard(db()).canActivate(context(request)));
      assert.equal(verifiedEntraAssertion(request), null);
    }
  });

  it('never retains a valid token whose account mapping failed', async () => {
    const request = { headers: { authorization: `Bearer ${jwt()}` } } as AuthedRequest;
    await assert.rejects(new AuthGuard(db(false)).canActivate(context(request)), /not linked/);
    assert.equal(verifiedEntraAssertion(request), null);
  });

  it('routes through fresh scoped database state and refuses user-supplied URLs, cursors and actors', async () => {
    let calls = 0;
    let received: ConnectionsActor | undefined;
    const scoped = { asUser: async (uid: string, fn: (svc: PrimaService, u: User) => Promise<unknown>) => {
      calls++; assert.equal(uid, user.id);
      return fn({ visibleCompanies: async () => [{ id: 'co-sasa' }] } as unknown as PrimaService, user);
    } } as unknown as Db;
    const connector = { status: (actor: ConnectionsActor) => { received = actor; return { status: 'ConfiguredNotVerified', sites: [] }; } } as unknown as SharePointConnections;
    const controller = new ConnectionsController(scoped, connector);
    const request = { headers: {}, userId: user.id, verifiedEntraAssertion: { accessToken: 'forged' } } as unknown as Request;
    assert.deepEqual(await controller.status(user.id, request, {}), { status: 'ConfiguredNotVerified', sites: [] });
    assert.deepEqual(received?.visibleCompanyIds, ['co-sasa']);
    assert.equal(received?.assertion, null);
    for (const query of [{ url: 'https://evil.invalid' }, { nextLink: 'https://graph.microsoft.com/other' }, { companyId: 'co-other' }, { actor: 'u-other' }]) {
      await assert.rejects(controller.status(user.id, request, query), /selectors/);
    }
    await assert.rejects(controller.check(user.id, request, 'site', {}, { url: 'https://evil.invalid' }), /selectors/);
    assert.equal(calls, 1);
    assert.ok(Reflect.getMetadata(GUARDS_METADATA, ConnectionsController).includes(AuthGuard));
  });
});
