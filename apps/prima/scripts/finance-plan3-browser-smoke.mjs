// Synthetic demo browser check of the actual Budget revisions screen (Finance PR #49). CI builds core + dist-demo first and
// supplies the pinned Playwright module. Demo data only, runs the real core rules in the browser; no API, SQL or provider calls.
// Regression (Arisha main, 4 Nov 2026): after revision 1 is withdrawn and revision 2 drafted, the screen must act on
// revision 2 ("Change revision 2", "Send revision 2"), never on the withdrawn one.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.CI_SYNTHETIC_BROWSER !== 'true' || !process.env.PLAYWRIGHT_MODULE)
  throw Error('Existing synthetic CI browser tooling required; no local fallback.');
const dist = resolve(fileURLToPath(new URL('../apps/web/dist-demo', import.meta.url)));
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
const server = createServer(async (req, res) => {
  const path = resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = path === dist || !path.startsWith(dist + sep) ? resolve(dist, 'index.html') : path;
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(resolve(dist, 'index.html')));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { width: 1440, height: 1600 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    let outside = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.origin === origin) return r.continue();
      // The page's font stylesheet is blocked too; anything else leaving the demo fails the check.
      if (u.origin !== 'https://fonts.googleapis.com') outside++;
      return r.abort();
    });
    const as = async (user) => {
      // The phone menu is icons only, so the menu is reached at desktop width; the panel is then used at the tested width.
      await page.setViewportSize({ width: 1440, height: 1600 });
      await page.goto(origin);
      await page.evaluate((u) => localStorage.setItem('prima-demo-user', u), user);
      await page.reload();
      await page
        .getByRole('button', { name: /Saya setuju|I agree/ })
        .click({ timeout: 4000 })
        .catch(() => {});
      await page
        .getByRole('button', { name: 'EN', exact: true })
        .click({ timeout: 2000 })
        .catch(() => {});
      await page.getByRole('button', { name: 'Finance', exact: true }).first().click();
      await page
        .getByRole('tab', { name: /^Checks/ })
        .first()
        .click();
      const sel = page.locator('label.field:has-text("Company") select').first();
      await sel.selectOption('co-09');
      await page.getByRole('tab', { name: /Tax and month-end/ }).click();
      const panel = page.locator('section.panel:has(h3:has-text("Budget and forecast"))').first();
      await panel.waitFor();
      await page.setViewportSize(viewport);
      await panel.waitFor();
      return panel;
    };
    await page.goto(origin);
    await page.evaluate(() => localStorage.clear());

    // The yearly budget is drafted by the deputy and approved by the FD, so revisions can start.
    let pn = await as('u-fin-t1-dep');
    await pn.locator('summary:has-text("Draft the budget")').click();
    await pn.getByLabel('Revenue', { exact: true }).fill('1200000');
    await pn.locator('textarea').first().fill('Synthetic budget for the browser check');
    await pn.getByRole('button', { name: 'Save draft' }).click();
    await pn.getByRole('button', { name: 'Submit budget for approval' }).click();
    pn = await as('u-fd');
    await pn.getByPlaceholder(/Comment \(needed; 10\+ characters to return\)/).fill('Synthetic approval of the budget');
    await pn.getByRole('button', { name: 'Approve budget' }).click();
    await pn.locator('summary:has-text("Draft a budget revision")').waitFor();

    // The team leader drafts revision 1, then withdraws it with a reason.
    const draft = async (reason) => {
      // Open the form (it may still be open from the last save).
      await pn
        .locator('details:has(> summary:has-text("budget revision")), details:has(> summary:has-text("Change revision"))')
        .first()
        .evaluate((d) => (d.open = true));
      await pn.locator('label.field:has-text("First month it applies") input').fill('2026-12');
      await pn.locator('label.field:has-text("revenue (one yearly") input').fill('1300000');
      await pn.locator('label.field:has-text("Why the budget is revised") textarea').fill(reason);
      await pn.getByRole('button', { name: 'Save revision' }).click();
    };
    pn = await as('u-fin-t1-lead');
    await draft('Synthetic revision one for withdrawal');
    await pn.getByRole('button', { name: 'Send revision 1 for approval' }).waitFor();
    await pn.getByLabel('Withdraw reason').fill('Synthetic withdrawal, figures changed');
    await pn.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await pn.locator('summary:has-text("Draft a budget revision")').waitFor();
    assert.equal(await pn.getByRole('button', { name: /Send revision 1/ }).count(), 0, 'withdrawn revision offers no send');

    // Revision 2: the screen now acts on it, never on the withdrawn revision 1.
    await draft('Synthetic revision two after withdrawal');
    await pn.locator('summary:has-text("Change revision 2")').waitFor();
    assert.equal(await pn.locator('summary:has-text("Change revision 1")').count(), 0, 'withdrawn revision is not selected');
    await pn.getByRole('button', { name: 'Send revision 2 for approval' }).click();
    await pn.getByText('waiting for the FD or the CEO').first().waitFor();

    // One approval by the FD puts revision 2 in force; revision 1 stays withdrawn.
    pn = await as('u-fd');
    await pn.getByLabel('Revision comment').fill('Synthetic approval of revision two');
    await pn.getByRole('button', { name: 'Approve', exact: true }).first().click();
    await pn.getByText('approved by the FD').first().waitFor();
    const text = await pn.innerText();
    assert.match(text, /withdrawn[\s\S]*Revision 1 from 2026-12/);
    assert.match(text, /approved[\s\S]*Revision 2 from 2026-12/);
    assert.equal(outside, 0, 'no request left the synthetic demo');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Synthetic budget revision withdraw, new draft, send and approve passed at 1440px and 390px (demo data, real core rules, no API/SQL calls).');
} finally {
  await browser.close();
  server.close();
}
