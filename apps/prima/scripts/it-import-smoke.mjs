// Synthetic demo UI checks for the CEO's IT import (task T9). Dummy rows only; never accepts an external app/API URL.
// CI builds core + dist-demo first and supplies an isolated, pinned Playwright module path.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

const ROWS = [
  'Title,Requester,Channel,Urgency,Detail',
  'CI synthetic printer,CI Staff A,Teams,P2,',
  '',
  'CI synthetic outlook,CI Staff B,email,P3,"line 1',
  'line 2"',
  'CI synthetic broken,CI Staff C,,P1,',
].join('\n');

let browser;
try {
  browser = await chromium.launch();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    async function session(userId) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      // No Azure, Microsoft sign-in, AI, external fonts or paid requests are permitted.
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.addInitScript(({ userId }) => {
        if (!sessionStorage.getItem('ci-fixture-initialized')) {
          localStorage.clear(); localStorage.setItem('prima-demo-user', userId); localStorage.setItem('prima.lang', 'en');
          sessionStorage.setItem('ci-fixture-initialized', 'true');
        }
      }, { userId });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${origin}/#it`, { waitUntil: 'domcontentloaded' });
      const consent = page.getByRole('button', { name: 'I agree and will keep it confidential' });
      if (await consent.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
        await consent.click(); await consent.waitFor({ state: 'hidden' });
      }
      await page.getByRole('tablist', { name: 'IT sections' }).waitFor({ timeout: 30000 });
      return { context, page, errors };
    }
    const approvals = page => page.evaluate(() => JSON.parse(localStorage.getItem('prima-demo-log-v1') ?? '[]').filter(x => x.op === 'itAct' && x.args[0] === 'importApprove').length);

    const lead = await session('u-it-lead');
    try {
      assert.equal(await lead.page.getByRole('tab', { name: 'Import', exact: true }).count(), 0, 'The IT Lead must not see the import');
      assert.deepEqual(lead.errors, []);
    } finally { await lead.context.close(); }

    const c = await session('u-fauzan');
    try {
      const { page } = c;
      await page.getByRole('tab', { name: 'Import', exact: true }).click();
      const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Import open IT work' }) });
      await panel.getByLabel('Where the rows come from').fill('CI synthetic sheet');
      await panel.getByLabel('Rows', { exact: true }).fill(ROWS);
      await panel.getByRole('button', { name: 'Preview' }).click();
      await panel.getByText('Source: CI synthetic sheet, row 5').waitFor();
      // Sheet row numbers survive the blank row and the two-line cell.
      for (const n of [2, 4, 5]) await panel.getByText(`Row ${n}`, { exact: true }).waitFor();
      assert.equal(await panel.getByText('Will be added').count(), 2);
      assert.equal(await panel.getByText('Left out: error').count(), 1);
      const bounds = await panel.boundingBox();
      assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, 'Import panel must fit the viewport');
      await panel.getByText(/Detail: line 1\s+line 2/).waitFor();

      // A row the CEO leaves out stays left out when the same rows are previewed again.
      await panel.getByLabel('Leave this row out').first().check();
      await panel.getByRole('button', { name: 'Approve and add 1' }).waitFor();
      await panel.getByRole('button', { name: 'Preview' }).click();
      await panel.getByText('Left out by you').waitFor();
      assert.equal(await panel.getByRole('button', { name: 'Approve and add 1' }).count(), 1, 'Previewing again keeps rows left out');
      await panel.getByLabel('Leave this row out').first().uncheck();

      // A file read that finishes after the CEO has typed new rows is dropped, not written over them.
      await page.evaluate(() => {
        const read = FileReader.prototype.readAsText;
        FileReader.prototype.readAsText = function (blob) { setTimeout(() => read.call(this, blob), 600); };
      });
      await panel.getByLabel('CSV file').setInputFiles({ name: 'ci-late.csv', mimeType: 'text/csv', buffer: Buffer.from('Title,Requester,Channel,Urgency\nCI late file row,CI Staff Z,Teams,P2') });
      assert.equal(await panel.getByRole('button', { name: 'Preview' }).isDisabled(), true, 'Preview waits while a file is still loading');
      const typed = `${ROWS}\nCI synthetic typed,CI Staff E,Teams,P3,`;
      await panel.getByLabel('Rows', { exact: true }).fill(typed);
      await page.waitForTimeout(1200);
      assert.equal(await panel.getByLabel('Rows', { exact: true }).inputValue(), typed, 'A late file read must not replace newer rows');

      // Any change to the input drops the preview, so what is approved is what was previewed.
      await panel.getByLabel('Rows', { exact: true }).fill(`${ROWS}\nCI synthetic added,CI Staff D,Teams,P2,`);
      assert.equal(await panel.getByRole('button', { name: /^Approve and add/ }).count(), 0, 'Editing the rows must clear the preview');
      await panel.getByLabel('Rows', { exact: true }).fill(ROWS);
      await panel.getByRole('button', { name: 'Preview' }).click();
      const approve = panel.getByRole('button', { name: 'Approve and add 2' });
      await approve.waitFor();

      // Slow responses: every change in the test version is held open for 800 ms.
      await page.evaluate(() => { globalThis.__primaDemoDelayMs = 800; });
      // While a preview is still loading, Approve cannot be used: a click that lands before the screen updates is
      // refused, and once the screen updates the button is disabled.
      const duringPreview = await panel.evaluate(async section => {
        const button = name => [...section.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(name));
        button('Preview').click();
        button('Approve and add').click();
        await new Promise(r => setTimeout(r, 50));
        return { approveDisabled: button('Approve and add').disabled, previewDisabled: button('Preview').disabled };
      });
      assert.deepEqual(duringPreview, { approveDisabled: true, previewDisabled: true }, 'Approve is disabled while a preview is loading');
      await page.waitForTimeout(1200);
      assert.equal(await approvals(page), 0, 'No approval runs while a preview is loading');
      await approve.waitFor();
      assert.equal(await approve.isEnabled(), true);

      // While an approval runs, the rows left out, the inputs and Preview are locked: clicks that land before the
      // screen updates change nothing, and a second Approve click does nothing.
      const duringApproval = await approve.evaluate(async button => {
        const section = button.closest('section');
        const boxes = () => [...section.querySelectorAll('input[type="checkbox"]')];
        const previewButton = () => [...section.querySelectorAll('button')].find(b => b.textContent.trim() === 'Preview');
        const before = boxes().map(b => b.checked);
        button.click();
        boxes()[0].click();
        previewButton().click();
        button.click();
        await new Promise(r => setTimeout(r, 50));
        return {
          boxes: boxes().length,
          boxesUnchanged: JSON.stringify(boxes().map(b => b.checked)) === JSON.stringify(before),
          boxesLocked: boxes().every(b => b.disabled),
          rowsLocked: section.querySelector('textarea').disabled,
          fileLocked: section.querySelector('input[type="file"]').disabled,
          previewLocked: previewButton().disabled,
        };
      });
      assert.ok(duringApproval.boxes > 0, 'The preview offers rows to leave out');
      assert.deepEqual(
        duringApproval,
        { boxes: duringApproval.boxes, boxesUnchanged: true, boxesLocked: true, rowsLocked: true, fileLocked: true, previewLocked: true },
        'Approval locks the screen',
      );
      await panel.getByText(/^Added: IT-\d{4}, IT-\d{4}\./).waitFor();
      assert.equal(await approvals(page), 1, 'Repeated clicks must import once');
      await page.evaluate(() => { delete globalThis.__primaDemoDelayMs; });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('tablist', { name: 'IT sections' }).waitFor({ timeout: 30000 });
      await page.getByRole('tab', { name: 'Import', exact: true }).click();
      await panel.getByLabel('Where the rows come from').fill('CI synthetic sheet again');
      await panel.getByLabel('Rows', { exact: true }).fill(ROWS);
      await panel.getByRole('button', { name: 'Preview' }).click();
      assert.equal(await panel.getByText(/already open in Prima/).count() >= 2, true, 'A second batch finds the imported rows already open');
      assert.equal(await panel.getByRole('button', { name: /^Approve and add [1-9]/ }).count(), 0, 'Nothing new to add');
      assert.deepEqual(c.errors, [], 'No uncaught browser errors');
    } finally { await c.context.close(); }
    console.log(`Synthetic IT import UI passed at ${viewport.width}x${viewport.height}.`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
