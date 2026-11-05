// Offline tests of the real Microsoft 365 Connections client and screen state. Synthetic data, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = path => readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
async function load(path) {
  const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { m365Client, serviceStatus } = await load('connections/m365/client.ts');
const { M365Session } = await load('connections/m365/state.ts');
const at = '2026-11-03T01:00:00.000Z', until = '2026-11-03T09:00:00.000Z';
const svc = (service, patch = {}) => ({ service, state: 'configured', reason: 'NotChecked', resources: service === 'outlook' ? [] : [{ key: `${service}-a`, name: `Synthetic ${service}` }], actions: ['check'], ...patch });
const status = (owner = 'user-a', patch = {}) => ({ userId: owner, services: [svc('outlook'), svc('teams'), svc('sharepoint')], teamsApprovals: { state: 'not_built', canApplyApprovals: false }, ...patch });
const guidance = () => ({ capabilities: Object.fromEntries(['outlook', 'teams', 'sharepoint'].map(s => [s, { why: { bm: 'b', en: 'e' }, data: { bm: 'b', en: 'e' }, whereToGetLink: { bm: 'b', en: 'e' }, whoHelps: { bm: 'b', en: 'e' }, delegatedScopes: [{ scope: 'Mail.ReadBasic' }] }])) });
const tick = () => new Promise(r => setTimeout(r, 0));

function transport(answers = {}) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    const a = answers[`${method} ${path}`];
    if (a instanceof Error) throw a;
    if (typeof a === 'function') return a(body);
    if (a !== undefined) return a;
    if (path === '/connections/m365/matrix') return guidance();
    if (path === '/connections/m365/status') return status();
    throw Error('unexpected ' + path);
  };
  return { calls, call };
}

test('client refuses another person\'s status and an unproven "connected"', async () => {
  const t = transport({ 'GET /connections/m365/status': status('user-b') });
  await assert.rejects(m365Client(t.call).status('user-a'));
  assert.throws(() => serviceStatus(svc('outlook', { state: 'connected', reason: 'Verified' })));
  assert.equal(serviceStatus(svc('outlook', { state: 'connected', reason: 'Verified', checkedAt: at, validUntil: until })).state, 'connected');
  assert.throws(() => serviceStatus(svc('outlook', { state: 'linked' })));
  assert.throws(() => serviceStatus(svc('outlook', { actions: ['send'] })));
  assert.throws(() => serviceStatus(svc('teams'), 'outlook'));
  await assert.rejects(m365Client(transport({ 'GET /connections/m365/status': status('user-a', { teamsApprovals: { state: 'connected', canApplyApprovals: true } }) }).call).status('user-a'));
});

test('opening the page reads Prima status and guidance only; Microsoft is asked only on Check', async () => {
  const t = transport({ 'POST /connections/m365/outlook/check': svc('outlook', { state: 'connected', reason: 'Verified', checkedAt: at, validUntil: until, actions: ['check', 'disconnect'] }) });
  const s = new M365Session('user-a', m365Client(t.call));
  s.start(); await tick(); await tick();
  assert.deepEqual(t.calls.map(c => c.path).sort(), ['/connections/m365/matrix', '/connections/m365/status']);
  assert.equal(s.snapshot().status.services[0].state, 'configured');
  assert.equal(s.snapshot().selected.teams, 'teams-a', 'single approved team is preselected');
  await s.check('outlook');
  assert.equal(s.snapshot().status.services[0].state, 'connected');
  assert.deepEqual(t.calls.at(-1), { method: 'POST', path: '/connections/m365/outlook/check', body: {} });
});

test('a failed status read never shows anything as connected', async () => {
  const s = new M365Session('user-a', m365Client(transport({ 'GET /connections/m365/status': new Error('PRIVATE provider text') }).call));
  await s.load();
  assert.equal(s.snapshot().status, null);
  assert.equal(s.snapshot().failure, true);
  assert.doesNotMatch(JSON.stringify(s.snapshot()), /PRIVATE/);
});

test('duplicate clicks send one check; disconnect drops a late check result', async () => {
  let release;
  const t = transport({ 'POST /connections/m365/outlook/check': () => new Promise(r => { release = r; }), 'POST /connections/m365/outlook/disconnect': svc('outlook', { reason: 'Disconnected' }) });
  const s = new M365Session('user-a', m365Client(t.call));
  await s.load();
  const first = s.check('outlook'); s.check('outlook'); s.check('outlook');
  assert.equal(t.calls.filter(c => c.path.endsWith('/check')).length, 1);
  await s.disconnect('outlook');
  release(svc('outlook', { state: 'connected', reason: 'Verified', checkedAt: at, validUntil: until, actions: ['check', 'disconnect'] }));
  await first;
  assert.equal(s.snapshot().status.services[0].reason, 'Disconnected');
  assert.match(s.snapshot().message.outlook, /forgotten its check/);
});

test('reconnect passes Microsoft\'s claims challenge to sign-in; without sign-in it explains instead', async () => {
  const claims = '{"access_token":{"polids":{"essential":true}}}';
  const t = transport({ 'GET /connections/m365/status': status('user-a', { services: [svc('outlook', { state: 'expired_or_revoked', reason: 'ReauthenticationRequired', claims, actions: ['reconnect', 'disconnect'] }), svc('teams'), svc('sharepoint')] }) });
  const seen = [];
  const s = new M365Session('user-a', m365Client(t.call), async c => { seen.push(c); });
  await s.load(); await s.reconnect('outlook');
  assert.deepEqual(seen, [claims]);
  const demo = new M365Session('user-a', m365Client(t.call));
  await demo.load(); await demo.reconnect('outlook');
  assert.match(demo.snapshot().message.outlook, /Sign out of Prima and sign in again/);
});

test('teams and sharepoint checks need an approved resource; links are checked only on request', async () => {
  const link = { service: 'teams', userId: 'user-a', outcome: 'NotAMember', checkedAt: at, status: svc('teams') };
  const t = transport({ 'GET /connections/m365/status': status('user-a', { services: [svc('outlook'), svc('teams', { resources: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] }), svc('sharepoint')] }), 'POST /connections/m365/teams/link': link });
  const s = new M365Session('user-a', m365Client(t.call));
  await s.load();
  await s.check('teams');
  assert.match(s.snapshot().message.teams, /Choose an approved team/);
  s.select('teams', 'not-approved');
  assert.equal(s.snapshot().selected.teams, '');
  s.editLink('teams', 'https://teams.microsoft.com/l/channel/x');
  assert.equal(t.calls.filter(c => c.path.endsWith('/link')).length, 0);
  await s.checkLink('teams');
  assert.equal(s.snapshot().links.teams.outcome, 'NotAMember');
  assert.deepEqual(t.calls.at(-1).body, { url: 'https://teams.microsoft.com/l/channel/x' });
});

test('a verified Teams link must carry a Teams address rebuilt by the server', async () => {
  const bad = { service: 'teams', userId: 'user-a', outcome: 'Verified', checkedAt: at, membershipType: 'private', openUrl: 'https://evil.example/', status: svc('teams') };
  await assert.rejects(m365Client(transport({ 'POST /connections/m365/teams/link': bad }).call).link('user-a', 'teams', 'x'));
});

test('a refused link format explains where to get a proper link', async () => {
  const e = Object.assign(new Error('bad'), { status: 400 });
  const s = new M365Session('user-a', m365Client(transport({ 'POST /connections/m365/sharepoint/link': e }).call));
  await s.load(); s.editLink('sharepoint', 'https://example.sharepoint.com/:w:/s/x'); await s.checkLink('sharepoint');
  assert.match(s.snapshot().message.sharepoint, /not a "Share" link/);
});

test('a status read started before Disconnect cannot bring Connected back', async () => {
  let release;
  const connected = status('user-a', { services: [svc('outlook', { state: 'connected', reason: 'Verified', checkedAt: at, validUntil: until, actions: ['check', 'disconnect'] }), svc('teams'), svc('sharepoint')] });
  let n = 0;
  const t = transport({ 'GET /connections/m365/status': () => (n++ === 0 ? connected : new Promise(r => { release = r; })), 'POST /connections/m365/outlook/disconnect': svc('outlook', { reason: 'Disconnected' }) });
  const s = new M365Session('user-a', m365Client(t.call));
  await s.load();
  const refresh = s.load();
  await s.disconnect('outlook');
  release(connected);
  await refresh;
  assert.equal(s.snapshot().status.services[0].reason, 'Disconnected');
  assert.equal(s.snapshot().phase, 'idle');
});
test('a verified link must say exactly what was confirmed', async () => {
  const base = { userId: 'user-a', checkedAt: at, status: svc('sharepoint') };
  await assert.rejects(m365Client(transport({ 'POST /connections/m365/sharepoint/link': { ...base, service: 'sharepoint', outcome: 'Verified' } }).call).link('user-a', 'sharepoint', 'x'));
  const ok = await m365Client(transport({ 'POST /connections/m365/sharepoint/link': { ...base, service: 'sharepoint', outcome: 'SiteVerifiedLibraryNotApproved', verifiedScope: 'site' } }).call).link('user-a', 'sharepoint', 'x');
  assert.equal(ok.verifiedScope, 'site');
});
