// Interactive regression tests for the Mail and Power BI modules inside the real Connections card shell
// (views/Connections.tsx, session.ts) at desktop and mobile widths, in React StrictMode.
// Synthetic in-page transport only: no API, no Microsoft, no network beyond the local Vite server.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(resolve(root, '.mail-powerbi-browser-'));
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionCard } from '../apps/web/src/views/Connections';
import { mailAdapter } from '../apps/web/src/connections/mail/panel';
import { mailClient } from '../apps/web/src/connections/mail/adapter';
import { powerBiAdapter } from '../apps/web/src/connections/powerbi/panel';
import { powerBiClient } from '../apps/web/src/connections/powerbi/adapter';
import '../apps/web/src/styles.css';
const time = '2026-10-31T06:00:00.000Z';
const f = window.__f = { userId: 'user-a', calls: [], routes: {}, hold: null, release: null };
const defaults = {
  'GET /connections/mail': () => ({ serviceId: 'mail', userId: f.userId, status: 'ConfiguredNotVerified', canCompose: true, resources: [{ key: 'own-mailbox', name: 'Your own mailbox (send only)' }], recipientDomains: ['example.com'] }),
  'POST /connections/mail/own-mailbox/check': () => ({ serviceId: 'mail', userId: f.userId, status: 'VerifiedForCurrentUser', resourceKey: 'own-mailbox', checkedAt: time, proves: 'DelegatedTokenOnly' }),
  'GET /connections/powerbi': () => ({ serviceId: 'powerbi', userId: f.userId, status: 'ConfiguredNotVerified', reports: [{ key: 'r1', name: 'Synthetic report' }] }),
  'POST /connections/powerbi/r1/check': () => ({ serviceId: 'powerbi', userId: f.userId, status: 'VerifiedForCurrentUser', reportKey: 'r1', checkedAt: time }),
};
const call = async (method, path, body) => {
  f.calls.push({ method, path, body });
  const key = method + ' ' + path; const q = f.routes[key]; let r = Array.isArray(q) ? q.shift() : q;
  if (r === undefined && defaults[key]) r = defaults[key]();
  if (f.hold === key) { f.hold = null; await new Promise(done => { f.release = done; }); }
  if (r === undefined) throw Object.assign(new Error('Synthetic server error'), { status: 500 });
  if (r && r.__error) throw Object.assign(new Error(r.message), { status: r.status });
  return structuredClone(r);
};
const mail = mailAdapter(mailClient(call)); const powerbi = powerBiAdapter(powerBiClient(call));
function App() {
  const [userId, setUser] = useState('user-a'); window.__setUser = id => { f.userId = id; setUser(id); };
  return <><ConnectionCard key={'mail:' + userId} serviceId="mail" userId={userId} adapter={mail} />
    <ConnectionCard key={'powerbi:' + userId} serviceId="powerbi" userId={userId} adapter={powerbi} /></>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
`;
// Connections.tsx and ui.tsx import the real API client; the harness never loads it.
const apiStub = `export class ApiError extends Error {} export const api = new Proxy({}, { get() { throw new Error('Real API must not be called'); } });`;
const time = '2026-10-31T06:00:00.000Z';
const hash = 'a'.repeat(64);
const rid = '44444444-4444-4444-8444-444444444444';
const ws = '33333333-3333-4333-8333-333333333333';
const draft = (state, over = {}) => ({ serviceId: 'mail', userId: 'user-a', id: 'd1', state, contentHash: hash, to: ['client@example.com'], cc: [], subject: 'Synthetic visit', body: 'Dummy body', updatedAt: time, retryNotBefore: null, identityMatches: true, ...over });
const embed = over => ({ serviceId: 'powerbi', userId: 'user-a', status: 'VerifiedForCurrentUser', reportKey: 'r1', name: 'Synthetic', reportId: rid, tokenType: 'Aad', tokenScopes: [], checkedAt: time,
  embedUrl: `https://app.powerbi.com/reportEmbed?reportId=${rid}&groupId=${ws}`, openInService: { url: `https://app.powerbi.com/groups/${ws}/reports/${rid}`, label: 'Open in Power BI (opens the Power BI service, not part of Prima)' }, ...over });

let server, browser;
try {
  await writeFile(resolve(dir, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  await writeFile(resolve(dir, 'main.tsx'), harness);
  // The automatic JSX runtime is added by esbuild after Vite's dependency scan, so on a cold cache Vite used to find
  // react/jsx-dev-runtime only after the page had loaded, re-bundle React and order a full reload. A page that missed
  // or raced that reload could keep two React copies and render nothing, which showed up in CI as a 30-second wait for
  // the first card text. Listing every bare import up front makes the first bundle final: no late discovery, no reload.
  server = await createServer({ configFile: false, root: dir, logLevel: 'warn', esbuild: { jsx: 'automatic' },
    // A private cache per run: a cache left by another Vite setup made this run re-bundle React with the page open.
    cacheDir: resolve(dir, '.vite'),
    optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [{ name: 'synthetic-api', enforce: 'pre',
      resolveId(id, importer) { if ((id === '../api' && importer?.endsWith('/views/Connections.tsx')) || (id === './api' && importer?.endsWith('/src/ui.tsx'))) return '\0synthetic-api'; },
      load(id) { if (id === '\0synthetic-api') return apiStub; } }] });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  let passed = 0;
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); const errors = []; let outside = 0;
    page.on('pageerror', e => errors.push(e.message));
    // Kept for diagnosis: if a step fails, the console, page errors and a screenshot are printed and saved.
    const consoleLines = []; page.on('console', m => consoleLines.push(`${m.type()}: ${m.text().slice(0, 300)}`));
    await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); outside++; return route.abort(); });
    await page.goto(origin);
    const mail = page.getByRole('region', { name: 'Mail' }); const bi = page.getByRole('region', { name: 'Power BI' });
    const f = () => page.evaluate(() => window.__f);
    const routes = r => page.evaluate(r => { window.__f.routes = r; window.__f.calls = []; }, r);
    const step = async (name, fn) => {
      try { await fn(); } catch (e) {
        console.error(`not ok ${viewport.width}px - ${name}`);
        console.error(`page errors: ${JSON.stringify(errors)}`);
        console.error(`console:\n${consoleLines.slice(-40).join('\n')}`);
        console.error(`body text: ${(await page.locator('body').innerText().catch(() => '(unreadable)')).slice(0, 600)}`);
        const out = process.env.UAT_SCREENSHOTS;
        if (out) await page.screenshot({ path: resolve(out, `mailbi-failure-${viewport.width}.png`), fullPage: true }).catch(() => {});
        throw e;
      }
      passed++; console.log(`ok ${viewport.width}px - ${name}`);
    };
    const verify = async (card, label) => {
      await card.getByLabel('Approved resource').selectOption({ label });
      await card.getByRole('button', { name: 'Check my access' }).click();
      await card.getByText('Verified for this account and selected resource', { exact: false }).waitFor();
    };
    const failed = card => card.getByRole('alert').getByText('Access is unavailable', { exact: false }).waitFor();

    await step('opening reads setup status only; no panel, draft, check or report request before the explicit check', async () => {
      await mail.getByText('Configured — check required').waitFor(); await bi.getByText('Configured — check required').waitFor();
      assert.deepEqual([...new Set((await f()).calls.map(c => `${c.method} ${c.path}`))].sort(), ['GET /connections/mail', 'GET /connections/powerbi']);
      assert.equal(await mail.getByText('This sends real email', { exact: false }).count(), 0);
      assert.equal(await bi.getByRole('button', { name: 'Prepare this report' }).count(), 0);
    });
    await step('the shell mounts Mail only as composeSend, with its manual-send warning', async () => {
      await routes({}); await verify(mail, 'Your own mailbox (send only)');
      await mail.getByText('Manual email action: review recipients and message', { exact: false }).waitFor();
      await mail.getByText('This sends real email', { exact: false }).waitFor();
      assert.deepEqual((await f()).calls.map(c => c.path), ['/connections/mail/own-mailbox/check']);
    });
    await step('compose, save for review, then ONE send despite a double press; 202 reads as Accepted, not delivered', async () => {
      await routes({ 'POST /connections/mail/drafts': draft('Draft'), 'POST /connections/mail/drafts/d1/send': { draft: draft('Accepted'), alreadyHandled: false } });
      await mail.getByLabel('To').fill('client@example.com'); await mail.getByLabel('Subject').fill('Synthetic visit'); await mail.getByLabel('Message').fill('Dummy body');
      await mail.getByRole('button', { name: 'Save draft for review' }).click();
      await mail.getByRole('region', { name: 'Review before sending' }).getByText('Nothing has been sent').waitFor();
      assert.deepEqual((await f()).calls[0].body, { to: ['client@example.com'], cc: [], subject: 'Synthetic visit', body: 'Dummy body' });
      await page.evaluate(() => { window.__f.hold = 'POST /connections/mail/drafts/d1/send'; });
      const send = mail.getByRole('button', { name: 'Send from my mailbox' });
      await send.click(); await send.click({ force: true, timeout: 1000 }).catch(() => {}); await send.click({ force: true, timeout: 1000 }).catch(() => {});
      await page.evaluate(() => window.__f.release());
      await mail.getByText('Accepted by Microsoft for delivery', { exact: false }).waitFor();
      assert.ok(await mail.getByText('does not confirm delivery', { exact: false }).isVisible());
      assert.equal((await f()).calls.filter(c => c.path.endsWith('/send')).length, 1);
      assert.deepEqual((await f()).calls.find(c => c.path.endsWith('/send')).body, { reviewedHash: hash });
      assert.equal(await mail.getByRole('button', { name: 'Send from my mailbox' }).count(), 0, 'No Send after Accepted');
    });
    await step('Stop waiting during a send uses cancel(): neutral note, no recall, late answer discarded, draft recovered from the server', async () => {
      await routes({ 'GET /connections/mail/drafts/d1': draft('Draft'), 'POST /connections/mail/drafts/d1/send': { draft: draft('Accepted'), alreadyHandled: false } });
      await mail.getByRole('button', { name: 'Reload this draft' }).click();
      await page.evaluate(() => { window.__f.hold = 'POST /connections/mail/drafts/d1/send'; });
      await mail.getByRole('button', { name: 'Send from my mailbox' }).click();
      await mail.getByRole('button', { name: 'Stop waiting' }).click();
      await mail.getByText('Cancelled locally', { exact: false }).waitFor();
      assert.equal(await mail.getByRole('alert').count(), 0, 'Cancel is not shown as a failure');
      assert.equal(await mail.getByRole('region', { name: 'Review before sending' }).count(), 0);
      await page.evaluate(() => window.__f.release());
      await page.waitForTimeout(100);
      assert.equal(await mail.getByText('Accepted by Microsoft', { exact: false }).count(), 0, 'Late answer discarded');
      await routes({ 'GET /connections/mail/drafts': { serviceId: 'mail', userId: 'user-a', drafts: [draft('Accepted')] } });
      await verify(mail, 'Your own mailbox (send only)');
      await mail.getByRole('button', { name: 'Find my recent drafts' }).click();
      await mail.getByRole('button', { name: 'Synthetic visit' }).click();
      await mail.getByText('Accepted by Microsoft for delivery', { exact: false }).waitFor();
      assert.equal((await f()).calls.filter(c => c.path.endsWith('/send')).length, 0, 'Recovery never resends');
    });
    await step('429 shows the wait and hides Send', async () => {
      const later = new Date(Date.now() + 3600_000).toISOString();
      await routes({ 'GET /connections/mail/drafts': { serviceId: 'mail', userId: 'user-a', drafts: [draft('Failed', { retryNotBefore: later })] } });
      await mail.getByRole('button', { name: 'Find my recent drafts' }).click();
      await mail.getByRole('button', { name: 'Synthetic visit' }).click();
      await mail.getByText('Microsoft asked Prima to wait', { exact: false }).waitFor();
      assert.equal(await mail.getByRole('button', { name: 'Send from my mailbox' }).count(), 0);
    });
    await step('a lost send response uses fail(); recovery finds the locked Uncertain draft; not-found keeps it locked and resending needs a new reviewed draft', async () => {
      await routes({ 'GET /connections/mail/drafts/d1': draft('Draft'), 'POST /connections/mail/drafts/d1/send': undefined });
      await mail.getByRole('button', { name: 'Reload this draft' }).click();
      await mail.getByRole('button', { name: 'Send from my mailbox' }).click();
      await failed(mail);
      assert.equal(await mail.getByRole('region', { name: 'Review before sending' }).count(), 0, 'Failure clears the panel');
      await routes({ 'GET /connections/mail/drafts': { serviceId: 'mail', userId: 'user-a', drafts: [draft('Uncertain')] }, 'POST /connections/mail/drafts/d1/resolve': draft('Uncertain') });
      await verify(mail, 'Your own mailbox (send only)');
      await mail.getByRole('button', { name: 'Find my recent drafts' }).click();
      await mail.getByRole('button', { name: 'Synthetic visit' }).click();
      await mail.getByText('This draft is locked and will never be sent again', { exact: false }).waitFor();
      assert.equal(await mail.getByRole('button', { name: 'Send from my mailbox' }).count(), 0, 'Uncertain cannot be resent');
      await mail.getByRole('button', { name: 'It is not in Sent Items' }).click();
      await mail.getByText('Not finding it does not prove it was not sent', { exact: false }).waitFor();
      assert.deepEqual((await f()).calls.at(-1).body, { sentItems: 'not-found' });
      assert.equal(await mail.getByRole('button', { name: 'Send from my mailbox' }).count(), 0, 'Still locked after not-found');
      // Sending again means a NEW draft with its own review: same text, a create call, never a send of d1.
      await routes({ 'POST /connections/mail/drafts': draft('Draft', { id: 'd2' }) });
      await mail.getByRole('button', { name: 'Start a new draft from this' }).click();
      assert.equal(await mail.getByLabel('Subject').inputValue(), 'Synthetic visit');
      await mail.getByRole('button', { name: 'Save draft for review' }).click();
      await mail.getByRole('region', { name: 'Review before sending' }).getByText('Nothing has been sent').waitFor();
      assert.deepEqual((await f()).calls.map(c => `${c.method} ${c.path}`), ['POST /connections/mail/drafts']);
    });
    await step('a refused input shows the reason without failing the card', async () => {
      await routes({ 'POST /connections/mail/drafts/d2/edit': { __error: true, status: 400, message: 'Email can only go to approved domains: example.com.' } });
      await mail.getByLabel('To').fill('someone@outside.invalid');
      await mail.getByRole('button', { name: 'Save changes for review' }).click();
      await mail.getByRole('alert').getByText('approved domains', { exact: false }).waitFor();
      assert.equal(await mail.getByText('Access is unavailable', { exact: false }).count(), 0);
    });
    await step('a draft for another user fails the card; one written under another Microsoft account is never sendable', async () => {
      await routes({ 'GET /connections/mail/drafts/d2': draft('Draft', { id: 'd2', userId: 'user-b' }) });
      await mail.getByRole('button', { name: 'Reload this draft' }).click();
      await failed(mail);
      await routes({ 'GET /connections/mail/drafts': { serviceId: 'mail', userId: 'user-a', drafts: [draft('Draft', { identityMatches: false })] } });
      await verify(mail, 'Your own mailbox (send only)');
      await mail.getByRole('button', { name: 'Find my recent drafts' }).click();
      await mail.getByRole('button', { name: 'Synthetic visit' }).click();
      await mail.getByText('different Microsoft account', { exact: false }).waitFor();
      assert.equal(await mail.getByRole('button', { name: 'Send from my mailbox' }).count(), 0);
    });
    await step('switching account clears the open draft and needs a fresh access check', async () => {
      await page.evaluate(() => window.__setUser('user-b'));
      await mail.getByText('Configured — check required').waitFor();
      assert.equal(await mail.getByRole('region', { name: 'Review before sending' }).count(), 0);
      assert.equal(await mail.getByLabel('Subject').count(), 0);
      await routes({ 'GET /connections/mail/drafts': { serviceId: 'mail', userId: 'user-b', drafts: [] } });
      await verify(mail, 'Your own mailbox (send only)');
      assert.equal(await mail.getByLabel('Subject').inputValue(), '');
      await mail.getByRole('button', { name: 'Find my recent drafts' }).click();
      await mail.getByText('No recent drafts.').waitFor();
      await page.evaluate(() => window.__setUser('user-a'));
      await mail.getByText('Configured — check required').waitFor();
    });
    await step('Power BI mounts as viewReport: explicit prepare, labelled external link, limitation stated, no Publish to web', async () => {
      await routes({ 'POST /connections/powerbi/r1/embed': embed({}) });
      await verify(bi, 'Synthetic report');
      await bi.getByText('Report access: opening or embedding a report requires an explicit action', { exact: false }).waitFor();
      assert.ok(await bi.getByText('not shown inside Prima yet', { exact: false }).isVisible());
      assert.deepEqual((await f()).calls.map(c => c.path), ['/connections/powerbi/r1/check']);
      await bi.getByRole('button', { name: 'Prepare this report' }).click();
      const link = bi.getByRole('link', { name: 'Open in Power BI (opens the Power BI service, not part of Prima)' });
      await link.waitFor();
      assert.equal(await link.getAttribute('href'), `https://app.powerbi.com/groups/${ws}/reports/${rid}`);
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      for (const bad of [embed({ embedUrl: 'https://app.powerbi.com/view?r=eyJrIjoi' }), embed({ userId: 'user-b' })]) {
        await routes({ 'POST /connections/powerbi/r1/embed': bad });
        await verify(bi, 'Synthetic report');
        await bi.getByRole('button', { name: 'Prepare this report' }).click();
        await failed(bi);
        assert.equal(await bi.getByRole('link').count(), 0);
      }
    });
    await step('no horizontal scrolling at this width', async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    });
    assert.deepEqual(errors, []);
    assert.equal(outside, 0, 'No request left the local test server');
    await page.close();
  }
  console.log(`# pass ${passed}`);
} finally {
  await browser?.close(); await server?.close(); await rm(dir, { recursive: true, force: true });
}
