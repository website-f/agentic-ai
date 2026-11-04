// Synthetic demo UI checks only. Never accepts an external app/API URL or model credentials.
// CI builds core + dist-demo first and supplies an isolated, pinned Playwright module path.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { generateDataset, fromMs, dateOf, MemoryStore, PrimaService } = require('../packages/core/dist/index.js');
const now = fromMs(Date.now());
const day = dateOf(now);
const data = generateDataset({ today: day, now });
const companyId = 'co-sasa';
const site = data.sites.find(s => s.companyId === companyId);
const paper = data.finStatus.find(f => f.companyId === companyId)?.audit[0];
assert.ok(site && paper, 'Expected synthetic site and finance paper fixtures');
const record = { type: 'record', kind: 'checkpoint', id: null, values: { siteId: site.id, name: 'CI synthetic checkpoint', tagCode: 'CI-ARISHA-ONLY' } };
const finance = { type: 'finance-paper', pack: 'audit', itemId: paper.id, status: 'prepared' };
const logged = (userId, op, args) => ({ day, at: now, userId, op, args });
const recordLog = [logged('u-audit', 'arishaSubmit', [record, companyId])];
const financeLog = [logged('u-fd', 'setFinPack', [companyId, 'audit', paper.id, 'todo']), logged('u-fd', 'arishaSubmit', [finance, companyId])];

// This check is safe without sockets/browser: prove fixtures replay through real core authorization.
if (process.argv.includes('--check-fixtures')) {
  const svc = new PrimaService(new MemoryStore(data), () => now);
  const act = await svc.user('u-audit'), fd = await svc.user('u-fd'), ceo = await svc.user('u-fauzan');
  const d = await svc.arishaDrafts.submit(act, record, companyId, 'arisha');
  assert.equal((await svc.arishaDrafts.list(act))[0].canCommit, false);
  assert.equal((await svc.arishaDrafts.commit(ceo, d.id, 1)).status, 'committed');
  await svc.setFinPack(fd, companyId, 'audit', paper.id, 'todo');
  const f = await svc.arishaDrafts.submit(fd, finance, companyId, 'human');
  await svc.arishaDrafts.returnDraft(fd, f.id, 1);
  await svc.arishaDrafts.resubmit(fd, f.id, 2);
  assert.equal((await svc.arishaDrafts.commit(fd, f.id, 3)).status, 'committed');
  console.log('Synthetic browser fixture replay passed (not browser UAT).');
  process.exit(0);
}
if (process.env.CI_SYNTHETIC_BROWSER !== 'true') throw new Error('Set CI_SYNTHETIC_BROWSER=true only in a disposable browser test environment.');
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Supply the pinned temporary Playwright module path.');
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href);
const html = await readFile(new URL('../apps/web/dist-demo/index.html', import.meta.url));
const server = createServer((req, res) => {
  if (req.method !== 'GET' || !['/', '/index.html'].includes(new URL(req.url, 'http://localhost').pathname)) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html);
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    async function session(userId, log) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      // No Azure, Microsoft sign-in, Claude, external fonts or paid requests are permitted.
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.addInitScript(({ userId, log }) => {
        if (!sessionStorage.getItem('ci-fixture-initialized')) {
          localStorage.clear(); localStorage.setItem('prima-demo-user', userId);
          localStorage.setItem('prima-demo-log-v1', JSON.stringify(log)); localStorage.setItem('prima.lang', 'en');
          sessionStorage.setItem('ci-fixture-initialized', 'true');
        }
        // Deliberately do not install a Claude host capability or any mock paid provider.
      }, { userId, log });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await dismissGate(page);
      return { context, page, errors };
    }
    async function dismissGate(page) {
      await page.getByRole('button', { name: /^Draft reviews/ }).waitFor({ timeout: 30000 });
      const consent = page.getByRole('button', { name: 'I agree and will keep it confidential' });
      if (await consent.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) {
        await consent.click(); await consent.waitFor({ state: 'hidden' });
      }
    }
    async function queue(page) {
      const section = page.locator('section[aria-label="Draft reviews"]');
      if (await section.getByRole('button', { name: /^Draft reviews/ }).getAttribute('aria-expanded') !== 'true') await section.getByRole('button', { name: /^Draft reviews/ }).click();
      await section.locator('article').first().waitFor();
      const bounds = await section.boundingBox();
      assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, 'Review panel must fit viewport');
      return section;
    }
    async function status(card, value) { await card.locator('p').filter({ hasText: new RegExp(` · ${value} · `) }).waitFor(); }
    async function logCount(page, op) { return page.evaluate(op => JSON.parse(localStorage.getItem('prima-demo-log-v1') ?? '[]').filter(x => x.op === op).length, op); }

    const r = await session('u-audit', recordLog);
    try {
      let q = await queue(r.page), card = q.locator('article').filter({ hasText: 'CI synthetic checkpoint' });
      await status(card, 'submitted');
      assert.equal(await card.getByRole('button', { name: 'I reviewed — save this change' }).count(), 0, 'ACT must not gain operational save authority');
      await q.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await q.locator('article').count(), 0, 'Close clears visible review data');
      await queue(r.page);
      await r.page.evaluate(() => localStorage.setItem('prima-demo-user', 'u-fauzan')); await r.page.reload(); await dismissGate(r.page);
      q = await queue(r.page); card = q.locator('article').filter({ hasText: 'CI synthetic checkpoint' });
      r.page.once('dialog', d => d.dismiss()); await card.getByRole('button', { name: 'I reviewed — save this change' }).click();
      await status(card, 'submitted'); assert.equal(await logCount(r.page, 'arishaCommit'), 0, 'Cancel must not save');
      r.page.on('dialog', d => d.accept());
      await card.getByRole('button', { name: 'I reviewed — save this change' }).evaluate(button => { button.click(); button.click(); });
      await status(card, 'committed'); assert.equal(await logCount(r.page, 'arishaCommit'), 1, 'Repeated clicks must produce one save');
      await r.page.reload(); await dismissGate(r.page); q = await queue(r.page);
      await status(q.locator('article').filter({ hasText: 'CI synthetic checkpoint' }), 'committed');
      assert.equal(await q.locator('article').count(), 1, 'Reload preserves one durable demo proposal');
      assert.deepEqual(r.errors, [], 'No uncaught browser errors');
    } finally { await r.context.close(); }

    const f = await session('u-fd', financeLog);
    try {
      const q = await queue(f.page), card = q.locator('article').filter({ hasText: 'Finance paper preparation' });
      await status(card, 'submitted');
      await card.getByRole('button', { name: 'Return without saving' }).click(); await status(card, 'returned');
      f.page.once('dialog', d => d.dismiss()); await card.getByRole('button', { name: 'Resubmit for review' }).click();
      await status(card, 'returned'); assert.equal(await logCount(f.page, 'arishaResubmit'), 0);
      f.page.on('dialog', d => d.accept()); await card.getByRole('button', { name: 'Resubmit for review' }).click();
      await status(card, 'submitted'); assert.equal(await logCount(f.page, 'arishaResubmit'), 1);
      await card.getByRole('button', { name: 'I reviewed — save this change' }).click(); await status(card, 'committed');
      assert.equal(await logCount(f.page, 'arishaCommit'), 1);
      // The implicit label includes descendant option text, so exact 'Company'
      // is not a stable accessible-name match. Scope to this two-select form.
      const companyPicker = q.locator('fieldset').getByRole('combobox').first();
      assert.equal(await companyPicker.locator(`option[value="${companyId}"]`).count(), 1, 'Company picker must offer the permitted fixture company');
      await companyPicker.selectOption(companyId);
      await f.page.waitForFunction(() => document.querySelector('section[aria-label="Draft reviews"] fieldset')?.disabled === false);
      await q.getByRole('button', { name: 'Close', exact: true }).click(); await queue(f.page);
      assert.equal(await q.locator('fieldset').getByRole('combobox').first().inputValue(), '', 'Reopen must not retain old company selection');
      assert.deepEqual(f.errors, [], 'No uncaught browser errors');
    } finally { await f.context.close(); }
    console.log(`Synthetic Arisha review UI passed at ${viewport.width}x${viewport.height}.`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
