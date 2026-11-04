import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import type { PrimaService, User } from '@prima/core';
import { AuthGuard } from '../src/auth';
import type { Db } from '../src/db';
import type { DelegatedActor } from '../src/connections-mail/delegated';
import { PowerBiReports, powerBiConfiguration } from '../src/connections-powerbi/power-bi';
import { MailConnectionsController, mailConnectionsModule } from '../src/connections-mail/controllers';
import { PowerBiConnectionsController } from '../src/connections-powerbi/controller';
import { StaffEmail } from '../src/connections-mail/staff-email';

const tenant = '11111111-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oid = '99999999-8888-7777-6666-555555555555';
const ws = '33333333-3333-4333-8333-333333333333';
const rid = '44444444-4444-4444-8444-444444444444';
const now = '2026-10-31T06:00:00.000Z';
const report = { key: 'group-finance', name: 'Synthetic finance summary', workspaceId: ws, reportId: rid, companyIds: ['co-a', 'co-b'], allowedUserIds: ['u-fd'] };
const embedUrl = `https://app.powerbi.com/reportEmbed?reportId=${rid}&groupId=${ws}&w=2&config=eyJzeW50aGV0aWMiOnRydWV9`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = () => json({ token_type: 'Bearer', access_token: 'PBI_TOKEN_PRIVATE', scope: 'Report.Read.All' });
const config = (reports: unknown = [report]): NodeJS.ProcessEnv => ({ POWERBI_CONNECTION_ENABLED: 'true', ENTRA_TENANT_ID: tenant, ENTRA_API_CLIENT_ID: client, POWERBI_OBO_CLIENT_SECRET: 'CLIENT_SECRET_PRIVATE', POWERBI_APPROVED_REPORTS_JSON: JSON.stringify(reports) });
const actor = (): DelegatedActor => ({ user: { id: 'u-fd', role: 'director', entraOid: oid } as unknown as User, visibleCompanyIds: ['co-a', 'co-b'], assertion: { userId: 'u-fd', oid, tenantId: tenant, accessToken: 'ASSERTION_PRIVATE' } });
function fixture(responses: (Response | Error)[] = [], env = config()) {
  const calls: { url: string; options: RequestInit }[] = [];
  const http = (async (url: string | URL | Request, options: RequestInit = {}) => {
    calls.push({ url: String(url), options });
    const r = responses.shift();
    if (!r) throw new Error('Unexpected request; no network permitted in test.');
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { service: new PowerBiReports(() => env, http, () => new Date(now)), calls };
}

describe('Power BI secure embed for the signed-in user (Power BI mocked)', () => {
  it('is NotConfigured unless enabled with a valid, strict allowlist', async () => {
    for (const env of [{}, { ...config(), POWERBI_CONNECTION_ENABLED: 'false' }, { ...config(), POWERBI_OBO_CLIENT_SECRET: '' }, config([])]) {
      const { service, calls } = fixture([], env);
      assert.deepEqual(service.status(actor()), { serviceId: 'powerbi', userId: 'u-fd', status: 'NotConfigured', reports: [] });
      await assert.rejects(service.embed(actor(), report.key), ServiceUnavailableException);
      assert.equal(calls.length, 0);
    }
    for (const bad of [
      { ...report, publishToWebUrl: 'https://app.powerbi.com/view?r=abc' }, { ...report, embedToken: 'x' }, { ...report, servicePrincipal: true },
      { ...report, reportId: 'not-a-guid' }, { ...report, workspaceId: 'me' }, { ...report, allowedUserIds: ['*'] }, { ...report, companyIds: [] }, { ...report, key: '../x' },
    ]) assert.equal(powerBiConfiguration(config([bad])), null);
    assert.equal(powerBiConfiguration(config([report, { ...report, key: 'dup' }])), null);
  });

  it('lists and embeds only for allowlisted users who see ALL mapped companies', async () => {
    const { service, calls } = fixture();
    assert.deepEqual(service.status(actor()).reports, [{ key: report.key, name: report.name }]);
    for (const who of [{ ...actor(), visibleCompanyIds: ['co-a'] }, { ...actor(), user: { ...actor().user, id: 'u-guard-fifth' } }, { ...actor(), user: { ...actor().user, integration: 'feed' } }] as DelegatedActor[]) {
      assert.deepEqual(service.status(who).reports, []);
      await assert.rejects(service.embed(who, report.key), ForbiddenException);
    }
    await assert.rejects(service.embed({ ...actor(), assertion: null }, report.key), /Sign in with your linked Microsoft account/);
    await assert.rejects(service.embed(actor(), 'unknown'), ForbiddenException);
    assert.equal(calls.length, 0);
  });

  it('verifies with the user\'s own delegated token and returns an authenticated embed URL, never a token', async () => {
    const { service, calls } = fixture([token(), json({ id: rid, name: 'PRIVATE_NAME', embedUrl, webUrl: 'https://evil.invalid', datasetId: 'PRIVATE' })]);
    const result = await service.embed(actor(), report.key);
    assert.deepEqual(result, {
      serviceId: 'powerbi', userId: 'u-fd', status: 'VerifiedForCurrentUser', reportKey: report.key, name: report.name, reportId: rid, embedUrl, tokenType: 'Aad',
      tokenScopes: ['https://analysis.windows.net/powerbi/api/Report.Read.All'],
      openInService: { url: `https://app.powerbi.com/groups/${ws}/reports/${rid}`, label: 'Open in Power BI (opens the Power BI service, not part of Prima)' },
      checkedAt: now,
    });
    assert.equal((calls[0].options.body as URLSearchParams).get('scope'), 'https://analysis.windows.net/powerbi/api/Report.Read.All');
    assert.equal(calls[1].url, `https://api.powerbi.com/v1.0/myorg/groups/${ws}/reports/${rid}`);
    assert.ok(calls.every(c => !c.url.includes('GenerateToken')), 'No app-owns-data embed tokens');
    for (const call of calls) assert.equal(call.options.redirect, 'error');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|evil|secret|access_token/);
  });

  it('check returns server-bound evidence for the exact report and no embed URL', async () => {
    const { service, calls } = fixture([token(), json({ id: rid, embedUrl })]);
    assert.deepEqual(await service.check(actor(), report.key), { serviceId: 'powerbi', userId: 'u-fd', status: 'VerifiedForCurrentUser', reportKey: report.key, checkedAt: now });
    assert.equal(calls.length, 2);
  });

  it('refuses Publish to web, foreign hosts and mismatched report or workspace URLs', async () => {
    for (const url of [
      'https://app.powerbi.com/view?r=eyJrIjoiUFVCTElDIn0', `https://app.powerbi.com/reportEmbed?reportId=${rid}&r=abc`,
      `https://evil.invalid/reportEmbed?reportId=${rid}`, `http://app.powerbi.com/reportEmbed?reportId=${rid}`,
      `https://app.powerbi.com/reportEmbed?reportId=${client}`, `https://app.powerbi.com/reportEmbed?reportId=${rid}&groupId=${client}`,
      `https://app.powerbi.com:8443/reportEmbed?reportId=${rid}`, `https://app.powerbi.com/reportEmbed?reportId=${rid}&redirect=https://evil.invalid`,
      `https://app.powerbi.com/reportEmbed?reportId=${rid}#x`, 42,
    ]) {
      const { service } = fixture([token(), json({ id: rid, embedUrl: url })]);
      await assert.rejects(service.embed(actor(), report.key), ServiceUnavailableException, String(url));
    }
    const other = fixture([token(), json({ id: client, embedUrl })]);
    await assert.rejects(other.service.embed(actor(), report.key), ServiceUnavailableException);
  });

  it('respects Power BI\'s own answer and fails closed with static errors', async () => {
    for (const status of [401, 403, 404]) {
      const { service } = fixture([token(), json({ error: 'PRIVATE' }, status)]);
      await assert.rejects(service.embed(actor(), report.key), ForbiddenException);
    }
    for (const responses of [[json({ error: 'PRIVATE' }, 400)], [token(), json({}, 500)], [token(), new Error('PRIVATE timeout')], [json({ token_type: 'Bearer', access_token: 'x', scope: 'Report.ReadWrite.All' })], [json({ token_type: 'Bearer', access_token: 'x', scope: 'Report.Read.All Dataset.Read.All' })]]) {
      const { service } = fixture(responses);
      await assert.rejects(service.embed(actor(), report.key), (e: unknown) => { assert.doesNotMatch(String(e), /PRIVATE/); return e instanceof ServiceUnavailableException; });
    }
  });
});

describe('Mail and Power BI controllers (not registered in AppModule yet)', () => {
  const user = { id: 'u-fd', role: 'director', entraOid: oid } as unknown as User;
  const db = { asUser: async (_uid: string, fn: (svc: PrimaService, u: User) => Promise<unknown>) => fn({ visibleCompanies: async () => [{ id: 'co-a' }] } as unknown as PrimaService, user) } as unknown as Db;
  const request = { headers: {}, verifiedEntraAssertion: { accessToken: 'forged' } } as unknown as Request;

  it('are behind AuthGuard and refuse query selectors and forged request assertions', async () => {
    for (const c of [MailConnectionsController, PowerBiConnectionsController]) assert.ok(Reflect.getMetadata(GUARDS_METADATA, c).includes(AuthGuard));
    let seen: DelegatedActor | undefined;
    const pbi = new PowerBiConnectionsController(db, { status: (a: DelegatedActor) => { seen = a; return { status: 'NotConfigured', reports: [] }; } } as unknown as PowerBiReports);
    assert.deepEqual(await pbi.status('u-fd', request, {}), { status: 'NotConfigured', reports: [] });
    assert.equal(seen?.assertion, null);
    assert.deepEqual(seen?.visibleCompanyIds, ['co-a']);
    await assert.rejects(pbi.status('u-fd', request, { url: 'https://app.powerbi.com/view?r=x' }), /not supported/);
    await assert.rejects(pbi.embed('u-fd', request, report.key, {}, { embedUrl: 'x' }), /no input/);
    const mail = new MailConnectionsController(db, { status: () => ({ status: 'NotConfigured' }) } as unknown as StaffEmail);
    await assert.rejects(mail.status('u-fd', request, { mailbox: 'someone-else' }), /not supported/);
  });

  it('default providers keep Email NotConfigured (non-durable ledger) even with full env', async () => {
    const email = (mailConnectionsModule().providers[0].useFactory as () => StaffEmail)();
    assert.equal((await email.status({ user, visibleCompanyIds: [], assertion: null })).status, 'NotConfigured');
  });
});
