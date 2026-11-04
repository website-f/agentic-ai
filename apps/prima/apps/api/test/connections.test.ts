import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { User } from '@prima/core';
import { SharePointConnections, sharePointConfiguration, approvedBrowserUrl, type ConnectionsActor } from '../src/connections';

const tenant = '11111111-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oid = '99999999-8888-7777-6666-555555555555';
const host = 'example.sharepoint.com';
const siteId = `${host},11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222`;
const site = { key: 'approved-site', name: 'Synthetic approved site', siteId, host, companyIds: ['co-sasa', 'co-inas'], allowedUserIds: ['u-fauzan'], approvedDriveIds: ['b!drive_1', 'drive', 'foreign-drive'] };
const now = '2026-10-31T02:00:00.000Z';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = () => json({ token_type: 'Bearer', access_token: 'GRAPH_TOKEN_PRIVATE', scope: 'Sites.Selected' });
const config = (): NodeJS.ProcessEnv => ({ SHAREPOINT_CONNECTION_ENABLED: 'true', ENTRA_TENANT_ID: tenant, ENTRA_API_CLIENT_ID: client, SHAREPOINT_OBO_CLIENT_SECRET: 'CLIENT_SECRET_PRIVATE', SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([site]) });
const actor = (): ConnectionsActor => ({ user: { id: 'u-fauzan', role: 'director', opsTier: 'ceo', entraOid: oid } as User, visibleCompanyIds: ['co-sasa', 'co-inas'], assertion: { userId: 'u-fauzan', oid, tenantId: tenant, accessToken: 'INBOUND_ASSERTION_PRIVATE' } });
function fixture(responses: (Response | Error)[] = [], env = config()) {
  const calls: { url: string; options: RequestInit }[] = [];
  const http = (async (url: string | URL | Request, options: RequestInit = {}) => {
    calls.push({ url: String(url), options });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request; no network permitted in test.');
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return { service: new SharePointConnections(() => env, http, () => new Date(now)), calls, env, responses };
}

describe('SharePoint read-only Connections boundary (stubbed provider only)', () => {
  it('is off by default and does not claim configuration or call a provider', async () => {
    for (const env of [{}, { ...config(), SHAREPOINT_CONNECTION_ENABLED: 'false' }, { ...config(), SHAREPOINT_OBO_CLIENT_SECRET: '' }]) {
      const { service, calls } = fixture([], env);
      assert.deepEqual(service.status(actor()), { serviceId: 'sharepoint', userId: 'u-fauzan', status: 'NotConfigured', sites: [], providerVerified:false, setupReason:(env as NodeJS.ProcessEnv).SHAREPOINT_CONNECTION_ENABLED!=='true'?'FeatureDisabled':'ServerConfigurationRequired' });
      await assert.rejects(service.check(actor(), site.key), ServiceUnavailableException);
      assert.equal(calls.length, 0);
    }
  });

  it('rejects malformed configuration, arbitrary hosts, duplicate sites and wildcard principals', () => {
    for (const bad of [
      { ...site, host: 'https://example.sharepoint.com' }, { ...site, host: 'example.sharepoint.com.evil.invalid' },
      { ...site, siteId: `evil.invalid,${siteId.split(',').slice(1).join(',')}` },
      { ...site, siteId: `${host},not-guid,not-guid` }, { ...site, companyIds: [] },
      { ...site, allowedUserIds: ['*'] }, { ...site, key: '../escape' }, { ...site, url: 'https://evil.invalid' },
    ]) assert.equal(sharePointConfiguration({ ...config(), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([bad]) }), null);
    for (const value of ['not-json', '{}', '[]', JSON.stringify([site, { ...site, key: 'same-resource-other-scope', companyIds: ['co-sasa'] }])]) {
      assert.equal(sharePointConfiguration({ ...config(), SHAREPOINT_APPROVED_SITES_JSON: value }), null);
    }
    assert.equal(sharePointConfiguration({ ...config(), ENTRA_TENANT_ID: 'common' }), null);
  });

  it('requires user allowlisting and ALL mapped company grants without global verified state', async () => {
    const { service, calls } = fixture();
    assert.deepEqual(service.status(actor()), { serviceId: 'sharepoint', userId: 'u-fauzan', status: 'ConfiguredNotVerified', sites: [{ key: site.key, name: site.name, hasApprovedLibraries: true }], providerVerified:false, setupReason:'ReadyForSelectedCheck' });
    for (const who of [
      { ...actor(), visibleCompanyIds: ['co-sasa'] },
      { ...actor(), user: { ...actor().user, id: 'u-other' } },
      { ...actor(), user: { ...actor().user, integration: 'feed' as never } },
    ]) {
      assert.deepEqual(service.status(who).sites, []);
      await assert.rejects(service.check(who, site.key), ForbiddenException);
    }
    await assert.rejects(service.check(actor(), 'https://evil.invalid'), ForbiddenException);
    assert.equal(calls.length, 0);
  });

  it('requires request-local verified Entra evidence matching current user, tenant and current link', async () => {
    const { service, calls } = fixture();
    for (const assertion of [null, { ...actor().assertion!, userId: 'u-other' }, { ...actor().assertion!, tenantId: client }, { ...actor().assertion!, oid: client }]) {
      await assert.rejects(service.check({ ...actor(), assertion }, site.key), /Sign in with your linked Microsoft account/);
    }
    await assert.rejects(service.check({ ...actor(), user: { ...actor().user, entraOid: undefined } }, site.key), ForbiddenException);
    assert.equal(calls.length, 0);
  });

  it('performs OBO only at the fixed tenant with selected scope, then fixed Graph site check', async () => {
    const { service, calls } = fixture([token(), json({ id: siteId, webUrl: 'https://evil.invalid', content: 'PRIVATE_BODY' })]);
    const result = await service.check(actor(), site.key);
    assert.deepEqual(result, { serviceId: 'sharepoint', userId: 'u-fauzan', status: 'VerifiedForCurrentUser', siteKey: site.key, checkedAt: now });
    assert.equal(calls[0].url, `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`);
    const form = calls[0].options.body as URLSearchParams;
    assert.equal(form.get('scope'), 'https://graph.microsoft.com/Sites.Selected');
    assert.equal(form.get('requested_token_use'), 'on_behalf_of');
    assert.equal(form.get('assertion'), 'INBOUND_ASSERTION_PRIVATE');
    assert.equal(form.get('client_secret'), 'CLIENT_SECRET_PRIVATE');
    assert.equal(calls[1].url, `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}?$select=id`);
    for (const call of calls) { assert.equal(call.options.redirect, 'error'); assert.ok(call.options.signal instanceof AbortSignal); }
    assert.equal(service.status(actor()).status, 'ConfiguredNotVerified');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|token|secret|webUrl|content/);
    const revoked = { ...actor(), visibleCompanyIds: ['co-inas'] };
    await assert.rejects(service.libraries(revoked, site.key), ForbiddenException);
    assert.equal(calls.length, 2);
  });

  it('re-resolves drive membership on every item request and never follows nextLink', async () => {
    const libraries = { value: [{ id: 'b!drive_1', name: 'Documents', owner: { secret: 'PRIVATE_OWNER' } }], '@odata.nextLink': 'https://evil.invalid/steal' };
    const { service, calls } = fixture([token(), json(libraries), json({id: 'b!drive_1', name: 'Documents'}), token(), json(libraries), json({ value: [{ id: 'item-1', name: 'Synthetic.txt', size: 42, lastModifiedDateTime: now, file: {}, '@microsoft.graph.downloadUrl': 'https://evil.invalid/content', content: 'PRIVATE_BODY', createdBy: 'PRIVATE_PERSON' }], '@odata.nextLink': 'https://evil.invalid/next' })], { ...config(), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([{...site, approvedDriveIds:['b!drive_1']}]) });
    assert.deepEqual(await service.libraries(actor(), site.key), { serviceId: 'sharepoint', userId: 'u-fauzan', siteKey: site.key, checkedAt: now, libraries: [{ id: 'b!drive_1', name: 'Documents' }], hasMore: false });
    const result = await service.items(actor(), site.key, 'b!drive_1');
    assert.deepEqual(result.items, [{ id: 'item-1', name: 'Synthetic.txt', size: 42, lastModifiedAt: now, kind: 'file' }]);
    assert.equal(result.hasMore, true);
    assert.equal(calls.length, 6);
    assert.equal(calls.filter(c => c.url.includes('/oauth2/')).length, 2, 'No access-token cache');
    assert.ok(calls[4].url.includes(`/sites/${encodeURIComponent(siteId)}/drives?`));
    assert.ok(calls.every(c => new URL(c.url).hostname === 'graph.microsoft.com' || new URL(c.url).hostname === 'login.microsoftonline.com'));
    assert.ok(calls.every(c => !c.url.includes('/content')));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|download|webUrl|nextLink|evil/);
  });

  it('rejects forged, traversal and foreign-site drives before listing any items', async () => {
    const f = fixture();
    for (const id of ['https://evil.invalid', '../other', 'drive/contents', 'a'.repeat(201)]) await assert.rejects(f.service.items(actor(), site.key, id), ForbiddenException);
    assert.equal(f.calls.length, 0);
    const g = fixture([token(), json({ value: [{ id: 'allowed-drive', name: 'Documents' }] })]);
    await assert.rejects(g.service.items(actor(), site.key, 'foreign-drive'), ServiceUnavailableException);
    assert.equal(g.calls.length, 2);
  });

  it('rejects broad, missing or unexpected delegated scopes instead of silently widening permissions', async () => {
    for (const scope of [undefined, '', 'Sites.Read.All', 'Sites.Selected Sites.Read.All', 'Sites.Selected Files.Read.All', '.default']) {
      const { service, calls } = fixture([json({ token_type: 'Bearer', access_token: 'PRIVATE', scope })]);
      await assert.rejects(service.check(actor(), site.key), ServiceUnavailableException);
      assert.equal(calls.length, 1);
    }
  });

  it('accepts only the exact resource-qualified scope alias and rejects token header injection', async () => {
    const ok = fixture([json({ token_type: 'Bearer', access_token: 'SAFE_TOKEN', scope: 'https://graph.microsoft.com/Sites.Selected' }), json({ id: siteId })]);
    assert.equal((await ok.service.check(actor(), site.key)).status, 'VerifiedForCurrentUser');
    const bad = fixture([json({ token_type: 'Bearer', access_token: 'unsafe\r\nHeader:value', scope: 'Sites.Selected' })]);
    await assert.rejects(bad.service.check(actor(), site.key), ServiceUnavailableException);
    assert.equal(bad.calls.length, 1);
  });

  it('rejects duplicate item identities and normalizes allowed metadata dates', async () => {
    const item = { id: 'item1', name: 'Synthetic', file: {}, lastModifiedDateTime: '2026-10-31T10:00:00+08:00' };
    const bad = fixture([token(), json({ value: [{ id: 'drive', name: 'Docs' }] }), json({ value: [item, item] })]);
    await assert.rejects(bad.service.items(actor(), site.key, 'drive'), ServiceUnavailableException);
    const ok = fixture([token(), json({ value: [{ id: 'drive', name: 'Docs' }] }), json({ value: [item] })]);
    assert.equal((await ok.service.items(actor(), site.key, 'drive')).items[0].lastModifiedAt, now);
  });

  it('fails closed on provider failures and mismatched site IDs with static errors only', async () => {
    for (const responses of [
      [new Error('CLIENT_SECRET_PRIVATE INBOUND_ASSERTION_PRIVATE')],
      [json({ error: 'PRIVATE_PROVIDER_BODY' }, 400)],
      [token(), new Error('PRIVATE_GRAPH_TOKEN redirect')],
      [token(), json({ error: 'PRIVATE_PROVIDER_BODY' }, 403)],
      [token(), json({ error: 'PRIVATE_PROVIDER_BODY' }, 429)],
      [token(), json({ id: 'other-site' })],
    ]) {
      const { service } = fixture(responses);
      await assert.rejects(service.check(actor(), site.key), error => {
        assert.doesNotMatch(String(error), /PRIVATE|redirect|client_secret|access_token/);
        return error instanceof ForbiddenException || error instanceof ServiceUnavailableException;
      });
    }
  });

  it('bounds bytes, item counts and metadata types even when provider headers are misleading', async () => {
    const oversized = new Response(JSON.stringify({ value: 'x'.repeat(130 * 1024) }), { headers: { 'content-type': 'application/json', 'content-length': '1' } });
    for (const response of [oversized, new Response('<html>not-json</html>', { headers: { 'content-type': 'text/html' } }), json({ value: Array.from({ length: 51 }, (_, i) => ({ id: `drive-${i}`, name: 'Documents' })) })]) {
      const { service } = fixture([token(), response]);
      await assert.rejects(service.libraries(actor(), site.key), ServiceUnavailableException);
    }
    const { service } = fixture([token(), json({ value: [{ id: 'drive', name: 'Docs' }] }), json({ value: Array.from({ length: 26 }, (_, i) => ({ id: `item-${i}`, name: 'x', file: {} })) })]);
    await assert.rejects(service.items(actor(), site.key, 'drive'), ServiceUnavailableException);
  });

  it('defaults legacy and empty library approvals to zero metadata calls while retaining site-only checks', async () => {
    for (const approvedDriveIds of [undefined, []]) {
      const env = { ...config(), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([{ ...site, approvedDriveIds }]) };
      const f = fixture([token(), json({ id: siteId })], env);
      assert.equal(f.service.status(actor()).sites[0].hasApprovedLibraries, false);
      await assert.rejects(f.service.libraries(actor(), site.key), ForbiddenException);
      await assert.rejects(f.service.items(actor(), site.key, 'b!drive_1'), ForbiddenException);
      assert.equal(f.calls.length, 0);
      assert.equal((await f.service.check(actor(), site.key)).status, 'VerifiedForCurrentUser');
    }
  });

  it('rejects malformed, duplicate, wildcard and oversized library approval configuration', () => {
    for (const approvedDriveIds of [null, '*', ['*'], ['https://evil.invalid'], ['same', 'same'], [1], Array.from({length:51}, (_,i)=>`d${i}`)]) {
      assert.equal(sharePointConfiguration({ ...config(), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([{ ...site, approvedDriveIds }]) }), null);
    }
  });

  it('exposes only approved library names with exact response identity and no unapproved hints', async () => {
    const env = { ...config(), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([{ ...site, approvedDriveIds: ['approved'] }]) };
    const f = fixture([token(), json({ value: [{id:'unapproved', name:'PRIVATE_LIBRARY'}, {id:'approved'}], '@odata.nextLink':'https://evil.invalid' }), json({id:'approved', name:'Approved only', owner:'PRIVATE_OWNER'})], env);
    const result = await f.service.libraries(actor(), site.key);
    assert.deepEqual(result.libraries, [{id:'approved', name:'Approved only'}]);
    assert.equal(result.hasMore, false);
    assert.equal(result.serviceId, 'sharepoint'); assert.equal(result.userId, actor().user.id);
    assert.ok(f.calls[1].url.endsWith('/drives?$select=id&$top=50'));
    assert.ok(f.calls[2].url.endsWith('/drives/approved?$select=id,name'));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|unapproved|nextLink|evil/);
    const bad = fixture([token(), json({value:[{id:'approved'}]}), json({id:'other',name:'Other'})], env);
    await assert.rejects(bad.service.libraries(actor(), site.key), ServiceUnavailableException);
  });

  it('fails closed on incomplete first-page membership without fetching any library name', async () => {
    const f = fixture([token(), json({value:[{id:'unapproved'}], '@odata.nextLink':'https://evil.invalid'})]);
    await assert.rejects(f.service.libraries(actor(), site.key), error => {
      assert.equal(error instanceof ServiceUnavailableException, true);
      assert.doesNotMatch(String(error), /unapproved|nextLink|count|page|evil/); return true;
    });
    assert.equal(f.calls.length, 2);
  });

  it('denies unapproved and subsequently revoked library IDs before token or provider calls', async () => {
    const f = fixture([token(), json({ value:[{id:'drive'}] }), json({value:[]})]);
    const first = await f.service.items(actor(), site.key, 'drive');
    assert.equal(first.userId, actor().user.id); assert.equal(first.serviceId, 'sharepoint');
    f.env.SHAREPOINT_APPROVED_SITES_JSON = JSON.stringify([{...site, approvedDriveIds:[]}]);
    await assert.rejects(f.service.items(actor(), site.key, 'drive'), ForbiddenException);
    await assert.rejects(f.service.items(actor(), site.key, 'other'), ForbiddenException);
    assert.equal(f.calls.length, 3);
  });

  it('returns no partial library success if any approved name lookup fails', async () => {
    const env = { ...config(), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([{...site, approvedDriveIds:['one','two']}]) };
    const f = fixture([token(), json({value:[{id:'one'},{id:'two'}]}), json({id:'one',name:'One'}), new Error('PRIVATE_TIMEOUT')],env);
    await assert.rejects(f.service.libraries(actor(), site.key), ServiceUnavailableException);
    assert.equal(f.calls.length,4);
    for (const call of f.calls) assert.ok(call.options.signal instanceof AbortSignal);
  });

  it('stops before further Graph reads when the shared listing deadline is exhausted', async () => {
    const original = AbortSignal.timeout;
    AbortSignal.timeout = (milliseconds: number) => milliseconds === 15_000 ? AbortSignal.abort() : original(milliseconds);
    try {
      const f = fixture([token()]);
      await assert.rejects(f.service.libraries(actor(), site.key), ServiceUnavailableException);
      assert.equal(f.calls.length, 1, 'Only OBO completed; no Graph calls after exhausted listing budget');
    } finally { AbortSignal.timeout = original; }
  });

  it('combines the overall listing deadline with each Graph request signal', async () => {
    const original = AbortSignal.timeout;
    const budget = new AbortController();
    AbortSignal.timeout = (milliseconds: number) => milliseconds === 15_000 ? budget.signal : original(milliseconds);
    try {
      const env = { ...config(), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([{...site, approvedDriveIds:['one']}]) };
      const f = fixture([token(), json({value:[{id:'one'}]}), json({id:'one',name:'One'})], env);
      await f.service.libraries(actor(), site.key);
      const graphSignals = f.calls.slice(1).map(call => call.options.signal!);
      assert.ok(graphSignals.every(signal => signal !== budget.signal && !signal.aborted));
      budget.abort();
      assert.ok(graphSignals.every(signal => signal.aborted));
      assert.equal(f.calls[0].options.signal!.aborted, false, 'OBO retains its independent timeout');
    } finally { AbortSignal.timeout = original; }
  });

  it('does not reuse one user assertion or token for another user', async () => {
    const env = { ...config(), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([{ ...site, allowedUserIds: ['u-fauzan', 'u-fd'] }]) };
    const { service, calls } = fixture([token(), json({ id: siteId }), token(), json({ id: siteId })], env);
    const second: ConnectionsActor = { ...actor(), user: { ...actor().user, id: 'u-fd', entraOid: client }, assertion: { userId: 'u-fd', oid: client, tenantId: tenant, accessToken: 'SECOND_PRIVATE' } };
    await service.check(actor(), site.key); await service.check(second, site.key);
    assert.equal((calls[0].options.body as URLSearchParams).get('assertion'), 'INBOUND_ASSERTION_PRIVATE');
    assert.equal((calls[2].options.body as URLSearchParams).get('assertion'), 'SECOND_PRIVATE');
  });
});


describe('SharePoint explicit browser-link pilot', () => {
  it('only accepts direct HTTPS display URLs on the exact configured tenant host', () => {
    const good = 'https://example.sharepoint.com/sites/IT/Documents/Policy%20one.pdf';
    assert.equal(approvedBrowserUrl(good, host), good);
    for (const bad of ['javascript:alert(1)', 'http://example.sharepoint.com/file.pdf', 'https://other.sharepoint.com/file.pdf', 'https://example.sharepoint.com.evil.invalid/file.pdf', 'https://user@example.sharepoint.com/file.pdf', 'https://example.sharepoint.com:8443/file.pdf', 'https://example.sharepoint.com/_layouts/15/redirect.aspx', 'https://example.sharepoint.com/sites/IT/%5flayouts/15/download.aspx', 'https://example.sharepoint.com/file.pdf?download=1', 'https://example.sharepoint.com/file.pdf#secret', 'https://example.sharepoint.com/%0aevil', 'https://example.sharepoint.com/%ZZ', 'https://example.sharepoint.com/']) assert.equal(approvedBrowserUrl(bad, host), undefined, bad);
  });
  it('only returns safe file display links after fresh user and selected-drive authorization', async () => {
    const good = 'https://example.sharepoint.com/sites/IT/Documents/Policy.pdf';
    const f = fixture([token(), json({value:[{id:'drive'}]}), json({value:[
      {id:'a',name:'Policy.pdf',file:{},webUrl:good,'@microsoft.graph.downloadUrl':'PRIVATE_DOWNLOAD'},
      {id:'b',name:'Other.pdf',file:{},webUrl:'https://other.sharepoint.com/Other.pdf'},
      {id:'c',name:'Folder',folder:{},webUrl:'https://example.sharepoint.com/sites/IT/Documents/Folder'},
      {id:'d',name:'Remote',file:{},remoteItem:{id:'remote'},webUrl:good},
    ]})]);
    const result = await f.service.items(actor(),site.key,'drive');
    assert.equal(result.items[0].webUrl,good); assert.equal(result.items[1].webUrl,undefined); assert.equal(result.items[2].webUrl,undefined); assert.equal(result.items[3].webUrl,undefined);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DOWNLOAD|other.sharepoint/);
    assert.ok(f.calls[2].url.includes('webUrl')); assert.equal(f.calls.length,3);
    await assert.rejects(f.service.items({...actor(),visibleCompanyIds:[]},site.key,'drive'),ForbiddenException);
    await assert.rejects(f.service.items(actor(),site.key,'unapproved'),ForbiddenException); assert.equal(f.calls.length,3);
  });
});

it('explains scoped setup gaps without a provider read, resource IDs or secrets',()=>{
 const cases:[NodeJS.ProcessEnv,ConnectionsActor,string][]=[
 [{...config(),SHAREPOINT_APPROVED_SITES_JSON:undefined},actor(),'ApprovedResourcesRequired'],
 [config(),{...actor(),visibleCompanyIds:[]},'NoApprovedResourcesForUser'],
 [{...config(),SHAREPOINT_APPROVED_SITES_JSON:JSON.stringify([{...site,approvedDriveIds:[]}])},actor(),'ApprovedLibrariesRequired'],
 [config(),{...actor(),assertion:null},'MicrosoftSignInRequired'],
 [config(),actor(),'ReadyForSelectedCheck']];
 for(const [env,user,reason] of cases){const f=fixture([],env),s=f.service.status(user);assert.equal(s.setupReason,reason);assert.equal(s.providerVerified,false);assert.equal(f.calls.length,0);assert.ok(!JSON.stringify(s).includes('PRIVATE'));assert.ok(!JSON.stringify(s).includes(siteId));}
});
