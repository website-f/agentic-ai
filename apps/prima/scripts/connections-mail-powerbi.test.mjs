// Offline tests of the Mail and Power BI adapters against the Connections V2 contract; no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = path => readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
async function load(path, patch = s => s) {
  const code = ts.transpileModule(patch(read(path)), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { ConnectionCardSession } = await load('connections/session.ts');
// The pre-722f398 contract (checkAccess/readMetadata only): an action panel must fail closed there, never mount read-only.
const legacy = await load('connections/session.ts', s => s.replace("c.capabilities.some(x => !capabilitiesByService[this.serviceId].includes(x))", "c.capabilities.some(x => !['checkAccess', 'readMetadata'].includes(x))"));
const proposed = { ConnectionCardSession };
const { createRegistry } = await load('connections/registry.ts');
const mail = await load('connections/mail/adapter.ts');
const pbi = await load('connections/powerbi/adapter.ts');
const time = '2026-10-31T06:00:00.000Z';
const hash = 'a'.repeat(64);
const rid = '44444444-4444-4444-8444-444444444444';
const ws = '33333333-3333-4333-8333-333333333333';
function transport(routes) {
  const calls = [];
  const call = async (method, path, body) => { calls.push({ method, path, body }); const r = routes[`${method} ${path}`]; if (!r) throw new Error('unexpected request'); return typeof r === 'function' ? r(body) : structuredClone(r); };
  return { call, calls };
}
const mailStatus = { serviceId: 'mail', userId: 'user-a', status: 'ConfiguredNotVerified', canCompose: true, resources: [{ key: 'own-mailbox', name: 'Your own mailbox (send only)' }], recipientDomains: ['example.com'] };
const mailCheck = { serviceId: 'mail', userId: 'user-a', status: 'VerifiedForCurrentUser', resourceKey: 'own-mailbox', checkedAt: time, proves: 'DelegatedTokenOnly' };
const draft = (state, over = {}) => ({ serviceId: 'mail', userId: 'user-a', id: 'd1', state, contentHash: hash, to: ['a@example.com'], cc: [], subject: 'Synthetic', body: 'Dummy', updatedAt: time, retryNotBefore: null, identityMatches: true, ...over });

test('Mail advertises and declares the explicit composeSend capability, never readMetadata', async () => {
  const t = transport({ 'GET /connections/mail': mailStatus });
  const core = mail.mailAdapterCore(mail.mailClient(t.call));
  const c = await core.getConfiguration(new AbortController().signal);
  assert.deepEqual(c.capabilities, ['checkAccess', 'composeSend']);
  assert.equal(core.panelCapability, 'composeSend');
});

test('a Mail panel without its declared capability, or relabelled as metadata, is refused by the shell', async () => {
  const t = transport({ 'GET /connections/mail': mailStatus });
  const Panel = () => null;
  for (const panelCapability of [undefined, 'viewReport']) {
    const s = new ConnectionCardSession('mail', 'user-a', { ...mail.mailAdapterCore(mail.mailClient(t.call)), panelCapability, ProviderPanel: Panel });
    await s.start(); assert.equal(s.getSnapshot().failure, 'InvalidResponse');
  }
  const ok = new ConnectionCardSession('mail', 'user-a', { ...mail.mailAdapterCore(mail.mailClient(t.call)), ProviderPanel: Panel });
  await ok.start(); assert.equal(ok.getSnapshot().failure, null);
});

test('the older contract refuses the send capability, so Mail stays unavailable instead of read-only', async () => {
  const t = transport({ 'GET /connections/mail': mailStatus });
  const s = new legacy.ConnectionCardSession('mail', 'user-a', mail.mailAdapterCore(mail.mailClient(t.call)));
  await s.start();
  assert.equal(s.getSnapshot().configuration, null);
  assert.equal(s.getSnapshot().failure, 'InvalidResponse');
});

test('with the 722f398 contract, Mail registers, reads only setup on start and checks access explicitly', async () => {
  const t = transport({ 'GET /connections/mail': mailStatus, 'POST /connections/mail/own-mailbox/check': mailCheck });
  const adapter = mail.mailAdapterCore(mail.mailClient(t.call));
  assert.equal(createRegistry([adapter]).get('mail'), adapter);
  const s = new proposed.ConnectionCardSession('mail', 'user-a', adapter);
  await s.start(); s.select('own-mailbox');
  assert.deepEqual(t.calls.map(c => c.path), ['/connections/mail']);
  await s.checkAccess();
  assert.equal(s.getSnapshot().evidence.selection.resourceKey, 'own-mailbox');
  assert.equal(s.getSnapshot().evidence.userId, 'user-a');
});

test('Mail evidence for another user or resource, or a check that over-claims, is rejected', async () => {
  for (const check of [{ ...mailCheck, userId: 'user-b' }, { ...mailCheck, resourceKey: 'shared' }, { ...mailCheck, proves: 'MailboxCanSend' }]) {
    const t = transport({ 'GET /connections/mail': mailStatus, 'POST /connections/mail/own-mailbox/check': check });
    const s = new proposed.ConnectionCardSession('mail', 'user-a', mail.mailAdapterCore(mail.mailClient(t.call)));
    await s.start(); s.select('own-mailbox'); await s.checkAccess();
    assert.equal(s.getSnapshot().evidence, null);
    assert.ok(s.getSnapshot().failure);
  }
});

test('Mail NotConfigured and not-allowlisted users show no resources or capabilities', async () => {
  for (const status of [{ ...mailStatus, status: 'NotConfigured', canCompose: false, resources: [] }, { ...mailStatus, canCompose: false, resources: [] }]) {
    const t = transport({ 'GET /connections/mail': status });
    const c = await mail.mailAdapterCore(mail.mailClient(t.call)).getConfiguration(new AbortController().signal);
    assert.deepEqual(c.resources, []); assert.deepEqual(c.capabilities, []);
  }
});

test('Mail client binds every draft to the signed-in user, quotes the reviewed hash and never retries', async () => {
  let sends = 0;
  const t = transport({
    'POST /connections/mail/drafts/d1/send': body => { sends++; assert.deepEqual(body, { reviewedHash: hash }); return { draft: draft('Uncertain'), alreadyHandled: false }; },
    'GET /connections/mail/drafts': { serviceId: 'mail', userId: 'user-a', drafts: [draft('Uncertain'), draft('Failed', { id: 'd2', retryNotBefore: time })] },
  });
  const client = mail.mailClient(t.call);
  const r = await client.send('user-a', 'd1', hash);
  assert.equal(r.draft.state, 'Uncertain'); assert.equal(sends, 1);
  assert.deepEqual((await client.list('user-a')).map(d => [d.id, d.state, d.retryNotBefore]), [['d1', 'Uncertain', null], ['d2', 'Failed', time]]);
  await assert.rejects(client.list('user-b'), /Invalid/);
  for (const bad of [draft('Draft', { userId: 'user-b' }), draft('Sent'), draft('Draft', { identityMatches: undefined }), { ...draft('Draft'), serviceId: 'sharepoint' }]) {
    const b = transport({ 'POST /connections/mail/drafts': bad });
    await assert.rejects(mail.mailClient(b.call).create('user-a', { to: [], cc: [], subject: '', body: '' }), /Invalid/);
  }
  assert.deepEqual(mail.addressList('a@example.com, b@example.com; c@example.com'), ['a@example.com', 'b@example.com', 'c@example.com']);
});

const embed = over => ({ serviceId: 'powerbi', userId: 'user-a', status: 'VerifiedForCurrentUser', reportKey: 'r1', name: 'Synthetic', reportId: rid, tokenType: 'Aad', tokenScopes: [], checkedAt: time,
  embedUrl: `https://app.powerbi.com/reportEmbed?reportId=${rid}&groupId=${ws}`, openInService: { url: `https://app.powerbi.com/groups/${ws}/reports/${rid}`, label: 'Open in Power BI (opens the Power BI service, not part of Prima)' }, ...over });
const pbiStatus = { serviceId: 'powerbi', userId: 'user-a', status: 'ConfiguredNotVerified', reports: [{ key: 'r1', name: 'Synthetic' }] };

test('Power BI declares viewReport (labelled external link, no in-app embed yet) and maps server-bound evidence', async () => {
  const t = transport({ 'GET /connections/powerbi': pbiStatus, 'POST /connections/powerbi/r1/check': { serviceId: 'powerbi', userId: 'user-a', status: 'VerifiedForCurrentUser', reportKey: 'r1', checkedAt: time } });
  const adapter = pbi.powerBiAdapterCore(pbi.powerBiClient(t.call));
  assert.deepEqual((await adapter.getConfiguration(new AbortController().signal)).capabilities, ['checkAccess', 'viewReport']);
  assert.equal(adapter.panelCapability, 'viewReport');
  const older = new legacy.ConnectionCardSession('powerbi', 'user-a', adapter); await older.start();
  assert.equal(older.getSnapshot().failure, 'InvalidResponse', 'Refused by the older contract');
  const s = new proposed.ConnectionCardSession('powerbi', 'user-a', adapter);
  await s.start(); s.select('r1'); assert.equal(t.calls.length, 3); await s.checkAccess();
  assert.equal(s.getSnapshot().evidence.selection.resourceKey, 'r1');
});

test('Power BI client refuses another user\'s answer, Publish to web, foreign hosts and any returned token', async () => {
  const ok = transport({ 'POST /connections/powerbi/r1/embed': embed({}) });
  assert.equal((await pbi.powerBiClient(ok.call).embed('user-a', 'r1')).openInService.url, `https://app.powerbi.com/groups/${ws}/reports/${rid}`);
  await assert.rejects(pbi.powerBiClient(ok.call).embed('user-b', 'r1'));
  for (const over of [{ userId: 'user-b' }, { embedUrl: 'https://app.powerbi.com/view?r=eyJrIjoi' }, { embedUrl: `https://evil.invalid/reportEmbed?reportId=${rid}` }, { embedUrl: `http://app.powerbi.com/reportEmbed?reportId=${rid}` },
    { openInService: { url: 'https://app.powerbi.com/view?r=x', label: 'x' } }, { openInService: { url: 'javascript:alert(1)', label: 'x' } }, { accessToken: 'PRIVATE' }, { embedToken: 'PRIVATE' }, { tokenType: 'Embed' }, { reportKey: 'r2' }]) {
    const t = transport({ 'POST /connections/powerbi/r1/embed': embed(over) });
    await assert.rejects(pbi.powerBiClient(t.call).embed('user-a', 'r1'));
  }
});
