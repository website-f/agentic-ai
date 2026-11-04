// Offline tests of the actual browser state controller. No sockets, provider calls or new packages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../apps/web/src/views/connections-state.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { ConnectionsSession, sharePointBrowserUrl } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const time = '2026-10-31T00:00:00.000Z';
const configured = { serviceId: 'sharepoint', userId: 'synthetic-user', status: 'ConfiguredNotVerified', sites: [{ key: 'alpha', name: 'Synthetic alpha', hasApprovedLibraries: true }, { key: 'beta', name: 'Synthetic beta', hasApprovedLibraries: true }] };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const calls = [];
  const client = Object.fromEntries(Object.entries({
    sharePointStatus: async () => structuredClone(configured),
    sharePointCheck: async siteKey => ({ status: 'VerifiedForCurrentUser', siteKey, checkedAt: time }),
    sharePointLibraries: async siteKey => ({ siteKey, checkedAt: time, libraries: [{ id: 'library-a', name: 'Synthetic documents' }], hasMore: true }),
    sharePointItems: async (siteKey, driveId) => ({ siteKey, driveId, checkedAt: time, items: [{ id: 'item-a', name: 'Synthetic policy.pdf', kind: 'file', size: 10, lastModifiedAt: time }], hasMore: true }),
    ...overrides,
  }).map(([name, fn]) => [name, async (...args) => { calls.push({ name, args }); return { serviceId: 'sharepoint', userId: 'synthetic-user', ...await fn(...args) }; }]));
  return { session: new ConnectionsSession(client, 'synthetic-user'), calls, client };
}
async function ready(f) { await f.session.loadConfiguration(); f.session.selectSite('alpha'); await f.session.checkAccess(); }

test('off by default: NotConfigured never implies verified or calls provider methods', async () => {
  const f = fixture({ sharePointStatus: async () => ({ status: 'NotConfigured', sites: [] }) });
  assert.equal(f.calls.length, 0);
  await f.session.loadConfiguration(); f.session.selectSite('alpha');
  await f.session.checkAccess(); await f.session.listLibraries(); await f.session.listMetadata();
  assert.equal(f.session.getSnapshot().configuration.status, 'NotConfigured');
  assert.equal(f.session.getSnapshot().verification, null);
  assert.deepEqual(f.calls.map(c => c.name), ['sharePointStatus']);
});
test('configuration and selection do not verify; each metadata read requires an explicit action', async () => {
  const f = fixture(); await f.session.loadConfiguration(); f.session.selectSite('alpha');
  await f.session.listLibraries(); await f.session.listMetadata();
  assert.equal(f.calls.length, 1); assert.equal(f.session.getSnapshot().verification, null);
  await f.session.checkAccess(); assert.equal(f.calls.length, 2); assert.deepEqual(f.session.getSnapshot().libraries, []);
  await f.session.listLibraries(); assert.equal(f.calls.length, 3); assert.deepEqual(f.session.getSnapshot().items, []);
  f.session.selectLibrary('library-a'); assert.equal(f.calls.length, 3); assert.equal(f.session.getSnapshot().metadataCheckedAt, null);
  await f.session.listMetadata(); assert.equal(f.calls.length, 4);
  const s = f.session.getSnapshot(); assert.equal(s.items[0].name, 'Synthetic policy.pdf');
  assert.equal(s.metadataCheckedAt, time); assert.equal(s.libraryHasMore, true); assert.equal(s.itemHasMore, true);
});
test('unapproved site and foreign library are refused before any client call', async () => {
  const f = fixture(); await ready(f); await f.session.listLibraries();
  f.session.selectLibrary('foreign-library'); await f.session.listMetadata(); assert.equal(f.calls.length, 3);
  assert.equal(f.session.getSnapshot().libraryId, '');
  f.session.selectSite('foreign-site'); await f.session.checkAccess(); assert.equal(f.calls.length, 3);
  assert.equal(f.session.getSnapshot().siteKey, ''); assert.equal(f.session.getSnapshot().verification, null);
});
test('repeat click while pending produces one check; cancellation aborts and ignores late success', async () => {
  const d = deferred(); const f = fixture({ sharePointCheck: () => d.promise });
  await f.session.loadConfiguration(); f.session.selectSite('alpha');
  const pending = f.session.checkAccess(); await f.session.checkAccess();
  assert.equal(f.calls.length, 2); const signal = f.calls[1].args[1];
  f.session.cancel(); assert.equal(signal.aborted, true);
  d.resolve({ status: 'VerifiedForCurrentUser', siteKey: 'alpha', checkedAt: time }); await pending;
  assert.equal(f.session.getSnapshot().verification, null); assert.equal(f.session.getSnapshot().busy, null);
  assert.match(f.session.getSnapshot().note, /may have reached Microsoft/);
});
test('site change discards late response and removes all prior metadata', async () => {
  const d = deferred(); const f = fixture({ sharePointItems: () => d.promise });
  await ready(f); await f.session.listLibraries(); f.session.selectLibrary('library-a'); const pending = f.session.listMetadata();
  f.session.selectSite('beta'); d.resolve({ siteKey: 'alpha', driveId: 'library-a', checkedAt: time, items: [{ name: 'OLD PRIVATE NAME' }], hasMore: false }); await pending;
  const s = f.session.getSnapshot(); assert.equal(s.siteKey, 'beta'); assert.equal(s.verification, null);
  assert.deepEqual(s.items, []); assert.deepEqual(s.libraries, []); assert.equal(s.libraryId, '');
});
test('disposed user session cannot publish a late check into a new user session', async () => {
  const d = deferred(); const f = fixture({ sharePointCheck: () => d.promise }); let notices = 0;
  f.session.subscribe(() => notices++); await f.session.loadConfiguration(); f.session.selectSite('alpha');
  const pending = f.session.checkAccess(); f.session.dispose(); const count = notices;
  const other = new ConnectionsSession(f.client, 'other-user');
  d.resolve({ status: 'VerifiedForCurrentUser', siteKey: 'alpha', checkedAt: time }); await pending;
  assert.equal(notices, count); assert.equal(f.session.getSnapshot().verification, null);
  assert.equal(other.getSnapshot().configuration, null); assert.equal(other.getSnapshot().verification, null);
});
test('configuration refresh invalidates verification and cached metadata', async () => {
  const f = fixture(); await ready(f); await f.session.listLibraries(); f.session.selectLibrary('library-a'); await f.session.listMetadata();
  await f.session.loadConfiguration(); const s = f.session.getSnapshot();
  assert.equal(s.siteKey, ''); assert.equal(s.verification, null); assert.deepEqual(s.items, []); assert.deepEqual(s.libraries, []);
});
test('provider errors never expose raw secrets, leave a verified badge, or stale metadata', async () => {
  const f = fixture({ sharePointItems: async () => { throw new Error('Bearer secret-token https://tenant.sharepoint.com/private-document'); } });
  await ready(f); await f.session.listLibraries(); f.session.selectLibrary('library-a'); await f.session.listMetadata();
  const s = f.session.getSnapshot(); assert.equal(s.verification, null); assert.deepEqual(s.items, []); assert.deepEqual(s.libraries, []);
  assert.match(s.error, /Access was not verified/); assert.doesNotMatch(JSON.stringify(s), /secret-token|private-document|Bearer/);
});
test('mismatched verification, library and item responses fail closed', async () => {
  for (const op of ['sharePointCheck', 'sharePointLibraries', 'sharePointItems']) {
    const f = fixture({ [op]: async () => ({ status: 'VerifiedForCurrentUser', siteKey: 'WRONG', checkedAt: time, libraries: [], items: [], driveId: 'WRONG', hasMore: false }) });
    await ready(f); if (op !== 'sharePointCheck') await f.session.listLibraries();
    if (op === 'sharePointItems') { f.session.selectLibrary('library-a'); await f.session.listMetadata(); }
    assert.equal(f.session.getSnapshot().verification, null, op); assert.ok(f.session.getSnapshot().error, op);
  }
});
test('failed cancelled request cannot erase a subsequent successful site check', async () => {
  const d = deferred(); const f = fixture({ sharePointCheck: async key => key === 'alpha' ? d.promise : ({ status: 'VerifiedForCurrentUser', siteKey: key, checkedAt: time }) });
  await f.session.loadConfiguration(); f.session.selectSite('alpha'); const old = f.session.checkAccess();
  f.session.selectSite('beta'); await f.session.checkAccess(); d.reject(new Error('stale failure')); await old;
  assert.equal(f.session.getSnapshot().verification.siteKey, 'beta'); assert.equal(f.session.getSnapshot().error, null);
});

// Real card/panel SSR coverage now lives in connections-v2.test.mjs.
test('invalid verification timestamps cannot create a successful badge', async () => {
  for (const checkedAt of ['', 'not-a-date', '<script>bad</script>']) {
    const f = fixture({ sharePointCheck: async siteKey => ({ status: 'VerifiedForCurrentUser', siteKey, checkedAt }) });
    await ready(f); assert.equal(f.session.getSnapshot().verification, null); assert.ok(f.session.getSnapshot().error);
  }
});
test('disposal clears already fetched metadata and configuration', async () => {
  const f = fixture(); await ready(f); await f.session.listLibraries(); f.session.selectLibrary('library-a'); await f.session.listMetadata();
  f.session.dispose(); const s = f.session.getSnapshot(); assert.equal(s.configuration, null); assert.equal(s.verification, null);
  assert.deepEqual(s.libraries, []); assert.deepEqual(s.items, []); assert.equal(s.siteKey, '');
});
test('all 50 approved libraries remain selectable', async () => {
  const f = fixture({ sharePointLibraries: async siteKey => ({ siteKey, checkedAt: time, libraries: Array.from({ length: 50 }, (_, i) => ({ id: `lib-${i}`, name: `Library ${i}` })), hasMore: false }) });
  await ready(f); await f.session.listLibraries();
  assert.equal(f.session.getSnapshot().libraries.length, 50); assert.equal(f.session.getSnapshot().libraryHasMore, false);
  f.session.selectLibrary('lib-49'); assert.equal(f.session.getSnapshot().libraryId, 'lib-49');
});

test('missing approved libraries prevents library and item requests after a site check', async () => {
  const f = fixture({ sharePointStatus: async () => ({ ...configured, sites: configured.sites.map(s => ({ ...s, hasApprovedLibraries: false })) }) });
  await ready(f); await f.session.listLibraries(); await f.session.listMetadata();
  assert.deepEqual(f.calls.map(c => c.name), ['sharePointStatus', 'sharePointCheck']);
});
test('identity and service are validated for every server response', async () => {
  for (const identity of [{ userId: 'other-user' }, { serviceId: 'mail' }]) {
    for (const op of ['sharePointStatus', 'sharePointCheck', 'sharePointLibraries', 'sharePointItems']) {
      const f = fixture(); const old = f.client[op]; f.client[op] = async (...args) => ({ ...await old(...args), ...identity });
      await ready(f); await f.session.listLibraries(); f.session.selectLibrary('library-a'); await f.session.listMetadata();
      assert.equal(f.session.getSnapshot().verification, null, op); assert.deepEqual(f.session.getSnapshot().items, []);
    }
  }
});
test('panel scope hydration is network-free and StrictMode cleanup/restart rejects stale results', async () => {
  const d = deferred(); const f = fixture({ sharePointLibraries: () => d.promise });
  const check = { serviceId: 'sharepoint', userId: 'synthetic-user', status: 'VerifiedForCurrentUser', siteKey: 'alpha', checkedAt: time };
  f.session.initializeScope(configured, check); assert.equal(f.calls.length, 0);
  const old = f.session.listLibraries(); f.session.dispose(); f.session.initializeScope(configured, { ...check, siteKey: 'beta' });
  d.resolve({ siteKey: 'alpha', checkedAt: time, libraries: [{ id: 'old', name: 'OLD PRIVATE' }], hasMore: false }); await old;
  assert.equal(f.session.getSnapshot().verification.siteKey, 'beta'); assert.deepEqual(f.session.getSnapshot().libraries, []);
});

test('root items stay bounded to 25 and malformed/oversized library lists fail closed', async () => {
  const f = fixture({ sharePointItems: async (siteKey, driveId) => ({ siteKey, driveId, checkedAt: time, items: Array.from({ length: 26 }, (_, i) => ({ id: `item-${i}`, name: 'Synthetic', kind: 'file', size: 0, lastModifiedAt: null })), hasMore: false }) });
  await ready(f); await f.session.listLibraries(); f.session.selectLibrary('library-a'); await f.session.listMetadata();
  assert.equal(f.session.getSnapshot().items.length, 25); assert.equal(f.session.getSnapshot().itemHasMore, true);
  for (const libraries of [[{ id: 'x', name: { secret: 'not text' } }], Array.from({ length: 51 }, (_, i) => ({ id: `l-${i}`, name: 'Synthetic' }))]) {
    const bad = fixture({ sharePointLibraries: async siteKey => ({ siteKey, checkedAt: time, libraries, hasMore: false }) });
    await ready(bad); await bad.session.listLibraries(); assert.equal(bad.session.getSnapshot().verification, null); assert.deepEqual(bad.session.getSnapshot().libraries, []);
  }
});


test('browser display links remain explicit, bounded and cleared by library change/cancel', async () => {
  const good='https://example.sharepoint.com/sites/IT/Documents/Policy.pdf';
  for(const bad of ['javascript:alert(1)','https://evil.invalid/file','https://example.sharepoint.com/_layouts/15/redirect.aspx','https://example.sharepoint.com/f?download=1','https://user@example.sharepoint.com/f','https://example.sharepoint.com/%0a']) assert.equal(sharePointBrowserUrl(bad),undefined);
  const f=fixture({sharePointItems:async(siteKey,driveId)=>({siteKey,driveId,checkedAt:time,hasMore:false,items:[{id:'a',name:'Policy',kind:'file',size:1,lastModifiedAt:null,webUrl:good},{id:'b',name:'Unsafe',kind:'file',size:1,lastModifiedAt:null,webUrl:'javascript:alert(1)'},{id:'c',name:'Folder',kind:'folder',size:null,lastModifiedAt:null,webUrl:good}]})});
  await ready(f);await f.session.listLibraries();f.session.selectLibrary('library-a');await f.session.listMetadata();
  assert.equal(f.session.getSnapshot().items[0].webUrl,good);assert.equal(f.session.getSnapshot().items[1].webUrl,undefined);assert.equal(f.session.getSnapshot().items[2].webUrl,undefined);
  assert.equal(f.calls.length,4);f.session.selectLibrary('');assert.deepEqual(f.session.getSnapshot().items,[]);f.session.cancel();assert.deepEqual(f.session.getSnapshot().items,[]);
});
test('late file links cannot reappear after cancellation or a new library choice',async()=>{
  const pending=deferred();const f=fixture({sharePointItems:()=>pending.promise});await ready(f);await f.session.listLibraries();f.session.selectLibrary('library-a');const task=f.session.listMetadata();f.session.cancel();
  pending.resolve({siteKey:'alpha',driveId:'library-a',checkedAt:time,hasMore:false,items:[{id:'a',name:'Policy',kind:'file',size:1,lastModifiedAt:null,webUrl:'https://example.sharepoint.com/sites/IT/p.pdf'}]});await task;assert.deepEqual(f.session.getSnapshot().items,[]);assert.equal(f.session.getSnapshot().verification,null);
});
