// Interactive regression tests for the "Outlook emails on this job" panel in a real browser, StrictMode,
// desktop and mobile widths. Synthetic in-page transport only: no API, no Microsoft, no network.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (process.env.CI_SYNTHETIC_BROWSER !== 'true' || !process.env.PLAYWRIGHT_MODULE) throw Error('Run only in the approved synthetic browser CI environment.');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(resolve(root, '.job-emails-browser-'));
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JobEmails } from '../apps/web/src/connections/mail/job-emails';
import { jobEmailClient } from '../apps/web/src/connections/mail/job-emails-client';
import '../apps/web/src/styles.css';
const f = window.__f = { userId: 'user-a', jobId: 'j-1', calls: [], routes: window.__boot || {}, hold: null, release: null };
const call = async (method, path, body) => {
  f.calls.push({ method, path, body });
  const key = method + ' ' + path; const q = f.routes[key]; const r = Array.isArray(q) ? q.shift() : (typeof q === 'function' ? q() : q);
  if (f.hold === key) { f.hold = null; await new Promise(done => { f.release = done; }); }
  if (r === undefined) throw Object.assign(new Error('Synthetic server error'), { status: 500 });
  if (r && r.__error) throw Object.assign(new Error(r.message), { status: r.status });
  return structuredClone(r?.__setup ? {...r,requestId:body.requestId} : r);
};
const client = jobEmailClient(call);
function App() {
  const [s, set] = useState({ userId: 'user-a', jobId: 'j-1' }); window.__set = v => { Object.assign(f, v); set(x => ({ ...x, ...v })); };
  return <JobEmails key={s.userId + ':' + s.jobId} client={client} userId={s.userId} jobId={s.jobId} />;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
`;
const LINK = 'https://outlook.office.com/mail/inbox/id/AAMkAGI2TG93AAA-synthetic_message_id_0001%3D';
const web = 'https://outlook.office365.com/owa/?ItemID=AAMkAAAAAAAAAAAAAAAA&exvsurl=1';
const snap = (over = {}) => ({ subject: 'Synthetic: printer renewal', from: { name: 'Vendor', address: 'sales@example.com' }, to: [{ name: 'IT', address: 'it@example.org' }], cc: [],
  sentAt: '2026-10-30T02:00:00.000Z', receivedAt: '2026-10-30T02:00:05.000Z', body: 'Dummy quotation.\nLine two.', bodyTruncated: false, hasAttachments: true, webLink: web, internetMessageId: '<s1@example.com>', ...over });
const ident = (userId = 'user-a', jobId = 'j-1') => ({ serviceId: 'mail', userId, jobId });
const view = (over = {}) => ({ ...ident(), id: '44444444-4444-4444-8444-444444444444', attachedByName: 'Synthetic A', attachedAt: '2026-10-31T06:00:00.000Z', expiresAt: '2026-11-30T06:00:00.000Z',
  webLink: web, state: 'Available', snapshot: snap(), canRemove: true, ...over });
const status = (userId = 'user-a', configured = true) => ({ serviceId: 'mail', userId, status: configured ? 'ConfiguredNotVerified' : 'NotConfigured', keepDays: 30 });
const hash = 'b'.repeat(64)+'.'+'c'.repeat(43);
const previewExpiry='2099-01-01T00:00:00.000Z';

let server, browser;
const diagnostics = [];
try {
  await writeFile(resolve(dir, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  await writeFile(resolve(dir, 'main.tsx'), harness);
  server = await createServer({ configFile: false, root: dir, cacheDir: resolve(dir, '.vite-cache'), optimizeDeps: { entries: [resolve(dir, 'main.tsx')], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, logLevel: 'error', esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } });
  await server.listen();
  const transformed = await server.transformRequest('/main.tsx');
  assert.ok(transformed?.code.includes('JobEmails'), 'Synthetic mailbox fixture must transform before navigation');
  await server.waitForRequestsIdle();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  let passed = 0;
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); const errors = []; let outside = 0;
    page.on('pageerror', e => { errors.push(e.message); diagnostics.push({kind:'pageerror',width:viewport.width,message:e.message}); });
    page.on('console', m => { if(m.type()==='error') diagnostics.push({kind:'console',width:viewport.width,message:m.text()}); });
    page.on('requestfailed', r => diagnostics.push({kind:'requestfailed',width:viewport.width,url:r.url(),failure:r.failure()?.errorText}));
    page.on('response', r => { if(r.status()>=400) diagnostics.push({kind:'http',width:viewport.width,status:r.status(),url:r.url()}); });
    await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); outside++; return route.abort(); });
    const routes = r => page.evaluate(r => { window.__f.routes = r; window.__f.calls = []; }, r);
    const f = () => page.evaluate(() => window.__f);
    const step = async (name, fn) => { await fn(); passed++; console.log(`ok ${viewport.width}px - ${name}`); };
    await page.addInitScript(r => { window.__boot = r; }, { 'GET /connections/mail/jobs/status': status(), 'GET /connections/mail/jobs/j-1/emails': { ...ident(), emails: [] } });
    await page.goto(origin);
    const panel = page.getByRole('region', { name: 'Outlook emails on this job' });

    await step('opening reads only Prima (status and stored copies), never Microsoft', async () => {
      await panel.getByText('No emails attached yet.').waitFor();
      const paths = [...new Set((await f()).calls.map(c => `${c.method} ${c.path}`))].sort();
      assert.deepEqual(paths, ['GET /connections/mail/jobs/j-1/emails', 'GET /connections/mail/jobs/status']);
      assert.ok(await panel.getByText('keeps a copy for 30 days', { exact: false }).isVisible());
    });
    await step('paste a link, preview (nothing saved), then ONE attach despite a double press', async () => {
      await routes({ 'POST /connections/mail/jobs/j-1/emails/preview': { ...ident(), previewToken: hash, expiresAt:previewExpiry, snapshot: snap() }, 'POST /connections/mail/jobs/j-1/emails': view() });
      await panel.getByLabel('Link to the email in Outlook').fill(LINK);
      await panel.getByRole('button', { name: 'Preview this email' }).click();
      const pv = panel.getByRole('region', { name: 'Preview before attaching' });
      await pv.getByText('Nothing is saved until you press Attach', { exact: false }).waitFor();
      await pv.getByText('This email has files in Outlook. Prima does not copy them.').waitFor();
      assert.deepEqual((await f()).calls.map(c => [c.path, c.body]), [['/connections/mail/jobs/j-1/emails/preview', { outlookLink: LINK }]]);
      await page.evaluate(() => { window.__f.hold = 'POST /connections/mail/jobs/j-1/emails'; });
      const attach = pv.getByRole('button', { name: 'Attach to this job' });
      await attach.click(); await attach.click({ force: true, timeout: 1000 }).catch(() => {});
      await page.evaluate(() => window.__f.release());
      await panel.getByRole('link', { name: 'Open in Outlook' }).waitFor();
      const attaches = (await f()).calls.filter(c => c.method === 'POST' && c.path === '/connections/mail/jobs/j-1/emails');
      assert.equal(attaches.length, 1); assert.deepEqual(attaches[0].body, { outlookLink: LINK, previewToken: hash });
      assert.equal(await panel.getByRole('link', { name: 'Open in Outlook' }).getAttribute('rel'), 'noopener noreferrer');
      assert.equal(await panel.getByLabel('Link to the email in Outlook').inputValue(), '');
    });
    await step('unsupported link stays local; uncertain write reconciles saved copies', async () => {
      await routes({ 'POST /connections/mail/jobs/j-1/emails/preview': { __error: true, status: 400, message: 'Paste the link to one email from your Outlook (outlook.office.com).' } });
      await panel.getByLabel('Link to the email in Outlook').fill('https://outlook.office.com/mail/search?q=salary');
      assert.equal(await panel.getByRole('button', { name: 'Preview this email' }).isDisabled(),true);
      assert.equal((await f()).calls.length,0);
      await routes({ 'POST /connections/mail/jobs/j-1/emails/preview': { ...ident(), previewToken: hash, expiresAt:previewExpiry, snapshot: snap() },
        'POST /connections/mail/jobs/j-1/emails': { __error: true, status: 409, message: 'This email is not the one you previewed. Preview it again.' } });
      await panel.getByLabel('Link to the email in Outlook').fill(LINK);
      await panel.getByRole('button', { name: 'Preview this email' }).click();
      await panel.getByRole('button', { name: 'Attach to this job' }).click();
      await panel.getByRole('alert').getByText('server outcome is unknown', { exact: false }).waitFor();
      assert.equal(await panel.getByRole('button', { name: 'Cancel' }).isDisabled(),true);
      await routes({'GET /connections/mail/jobs/status':status(),'GET /connections/mail/jobs/j-1/emails':{...ident(),emails:[view()]}});
      await panel.getByRole('button',{name:'Refresh setup and saved copies'}).click();
      await panel.getByLabel('Link to the email in Outlook').waitFor();
      assert.equal(await panel.getByRole('listitem').count(), 1, 'Still only the first email');
    });
    await step('only the attacher sees Remove; removing erases the copy and keeps the stub', async () => {
      await routes({ 'POST /connections/mail/jobs/j-1/emails/44444444-4444-4444-8444-444444444444/remove': view({ state: 'Removed', snapshot: null, canRemove: false }) });
      await panel.getByRole('button', { name: 'Remove from this job' }).click();
      await panel.getByText('Removed from this job by the person who attached it.').waitFor();
      assert.equal(await panel.getByRole('link', { name: 'Open in Outlook' }).count(), 0);
      assert.equal(await panel.getByRole('button', { name: 'Remove from this job' }).count(), 0);
    });
    await step('an answer for another user or job, or an unsafe link, is refused and not shown', async () => {
      for (const bad of [{ ...ident('user-b'), previewToken: hash, expiresAt:previewExpiry, snapshot: snap() }, { ...ident('user-a', 'j-2'), previewToken: hash, expiresAt:previewExpiry, snapshot: snap() },
        { ...ident(), previewToken: hash, expiresAt:previewExpiry, snapshot: snap({ webLink: 'javascript:alert(1)' }) }, { ...ident(), previewToken: hash, expiresAt:previewExpiry, snapshot: snap({ webLink: 'https://evil.invalid/x' }) }]) {
        await routes({ 'POST /connections/mail/jobs/j-1/emails/preview': bad });
        await panel.getByLabel('Link to the email in Outlook').fill(LINK);
        await panel.getByRole('button', { name: 'Preview this email' }).click();
        await panel.getByRole('alert').getByText('The read could not be verified', { exact: false }).waitFor();
        assert.equal(await panel.getByRole('region', { name: 'Preview before attaching' }).count(), 0);
      }
    });
    await step('switching job or account clears the preview and reloads only that job copies', async () => {
      await routes({ 'POST /connections/mail/jobs/j-1/emails/preview': { ...ident(), previewToken: hash, expiresAt:previewExpiry, snapshot: snap() } });
      await panel.getByLabel('Link to the email in Outlook').fill(LINK);
      await panel.getByRole('button', { name: 'Preview this email' }).click();
      await panel.getByRole('region', { name: 'Preview before attaching' }).waitFor();
      await routes({ 'GET /connections/mail/jobs/status': status('user-b'), 'GET /connections/mail/jobs/j-2/emails': { ...ident('user-b', 'j-2'), emails: [view({ ...ident('user-b', 'j-2'), state: 'Expired', snapshot: null, canRemove: false })] } });
      await page.evaluate(() => window.__set({ userId: 'user-b', jobId: 'j-2' }));
      await panel.getByText('The copy is unavailable after 30 days; storage cleanup is separate.').waitFor();
      assert.equal(await panel.getByRole('region', { name: 'Preview before attaching' }).count(), 0);
      assert.equal(await panel.getByLabel('Link to the email in Outlook').inputValue(), '');
      assert.ok((await f()).calls.every(c => c.method === 'GET'), 'Switching never calls preview or attach');
    });
    await step('unconfigured mailbox offers setup request without mailbox read', async () => {
      await routes({ 'GET /connections/mail/jobs/status': status('user-b', false) });
      await page.evaluate(() => window.__set({ jobId: 'j-3' }));
      await panel.getByText('Mailbox setup is not ready.',{exact:false}).waitFor();
      assert.deepEqual([...new Set((await f()).calls.map(c => c.path))], ['/connections/mail/jobs/status'], 'StrictMode may repeat the status read; nothing else');
      assert.equal(await page.getByLabel('Link to the email in Outlook').count(), 0);
      await panel.getByLabel('Outlook email link',{exact:true}).fill(LINK);
      await routes({'POST /connections/mail/jobs/setup':{__setup:true,serviceId:'mail',userId:'user-b',ticketId:'it-1',ticketRef:'IT-1',replayed:false}});
      await panel.getByRole('button',{name:'Request Outlook setup from IT'}).click();
      await panel.getByText('IT reference IT-1.',{exact:false}).waitFor();
      const sent=(await f()).calls;assert.equal(sent.length,1);assert.deepEqual(Object.keys(sent[0].body),['requestId']);assert.equal(sent[0].path,'/connections/mail/jobs/setup');
    });
    await step('no horizontal scrolling at this width', async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    });
    assert.deepEqual(errors, []);
    assert.equal(outside, 0, 'No request left the local test server');
    await page.close();
  }
  console.log(`# pass ${passed}`);
} catch(error) {
  for(const context of browser?.contexts()??[]) for(const page of context.pages()) {
    try { diagnostics.push({kind:'synthetic-state',url:page.url(),body:(await page.locator('body').innerText()).slice(0,4000),calls:await page.evaluate(()=>window.__f?.calls?.map(c=>({method:c.method,path:c.path}))??null)}); } catch { diagnostics.push({kind:'snapshot-unavailable'}); }
  }
  console.error('Synthetic mailbox failure diagnostics',JSON.stringify(diagnostics));
  throw error;
} finally {
  await browser?.close(); await server?.close(); await rm(dir, { recursive: true, force: true });
}
