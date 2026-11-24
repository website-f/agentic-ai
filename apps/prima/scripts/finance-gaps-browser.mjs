// Finance gaps in the browser (Fauzan, 23 Nov 2026, Finance study B4): the Finance Director confirms the limits and
// delegates to the Account Manager; a data entry clerk prepares a salary payout; the team leader records it paid.
// Runs the demo build (in-browser memory data, synthetic only); no API, provider or real data. Desktop and phone width.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { generateDataset, myt } = require('../packages/core/dist');
if (process.env.CI_SYNTHETIC_BROWSER !== 'true' || !process.env.PLAYWRIGHT_MODULE) throw Error('Synthetic browser opt-in required');
const day = '2026-11-23', at = myt(day, '10:00');
const ds = generateDataset({ today: day, now: at, daysBack: 40 });
const run = ds.staffPayRuns.find((r) => r.stage === 'coo_approved');
assert(run, 'the sample has a staff pay run approved by the COO');
// Team 1 has the sample's data entry clerks: the FD moves the company to Team 1 first (a logged demo step).
const team = 1;
const log = [{ day, at, userId: 'u-fd', op: 'finSetSettings', args: [{ teams: { [run.companyId]: 1 } }, 'Team 1 covers it this year'] }];
const html = await readFile(new URL('../apps/web/dist-demo/index.html', import.meta.url));
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true });
const out = new URL('../artifacts/finance-gaps/', import.meta.url);
await mkdir(out, { recursive: true });

async function as(page, userId) {
  await page.evaluate((u) => {
    localStorage.setItem('prima-demo-user', u);
    localStorage.setItem('prima-demo-all-staff', '1');
    localStorage.setItem('prima.lang', 'en');
  }, userId);
  await page.reload();
  await page.getByRole('button', { name: /Saya setuju|I agree/ }).click({ timeout: 2500 }).catch(() => {});
  await page.getByRole('button', { name: 'EN', exact: true }).click({ timeout: 1000 }).catch(() => {});
}
async function finance(page, tab) {
  // The side menu is open at desktop width; the work itself is then done at the width under test.
  const width = page.viewportSize().width;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button').filter({ has: page.getByText('Finance', { exact: true }) }).first().click();
  await page.getByRole('tab', { name: tab, exact: true }).first().click();
  await page.setViewportSize({ width, height: 1000 });
}
const panelOf = (page, heading) => page.locator('section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.clock.setFixedTime(new Date(at));
    const errors = [];
    let external = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.origin === origin) return r.continue();
      if (u.origin !== 'https://fonts.googleapis.com') external++;
      return r.abort();
    });
    await page.goto(origin);
    await page.evaluate((log) => {
      localStorage.clear();
      localStorage.setItem('prima-demo-log-v1', JSON.stringify(log));
    }, log);

    // 1. The Finance Director confirms the limits and thresholds (D3) and delegates to the Account Manager (D1).
    await as(page, 'u-fd');
    await finance(page, 'Settings');
    const confirm = panelOf(page, 'Limits and thresholds confirmed');
    await confirm.getByText(/Not confirmed yet/).waitFor();
    await confirm.getByLabel('What you checked (needed)').fill('Checked against the 2027 budget papers');
    await confirm.getByRole('button', { name: 'Confirm these values' }).click();
    await confirm.getByText(/Confirmed by/).waitFor();
    const am = panelOf(page, 'Account Manager');
    await am.getByLabel('Account Manager').selectOption({ label: 'Finance Account Manager' });
    await am.getByLabel('What they may do').selectOption({ index: 2 });
    await am.getByPlaceholder('What is delegated and why (needed)').fill('Covers collections while a team is short');
    await am.getByRole('button', { name: 'Save delegation' }).click();
    await am.getByText(/set by .*Covers collections/).waitFor();
    await page.screenshot({ path: new URL(`settings-${width}.png`, out).pathname, fullPage: false });

    // 2. A data entry clerk of the company's team prepares the salary payout (D2): picks the account it is paid from.
    await as(page, `u-fin-t${team}-de1`);
    await finance(page, 'Checks');
    await page.getByRole('combobox').first().selectOption({ value: run.companyId });
    await page.getByRole('tab', { name: /Paying out/ }).click();
    const payouts = panelOf(page, 'Salary and claim payouts');
    const item = payouts.locator('.list-item').filter({ hasText: 'Staff salary' }).first();
    await item.getByLabel('Paid from').selectOption({ index: 1 });
    await item.getByRole('button', { name: 'Prepare for payment' }).click();
    await payouts.getByText(/Prepared by/).first().waitFor();
    assert.equal(await item.getByRole('button', { name: 'Record paid' }).count(), 0, 'the preparer cannot record it paid');

    // 3. The team leader records it paid with the bank reference (not the preparer).
    await as(page, `u-fin-t${team}-lead`);
    await finance(page, 'Checks');
    await page.getByRole('combobox').first().selectOption({ value: run.companyId });
    await page.getByRole('tab', { name: /Paying out/ }).click();
    const lead = panelOf(page, 'Salary and claim payouts').locator('.list-item').filter({ hasText: 'Staff salary' }).first();
    await lead.getByPlaceholder('Bank reference').fill('SAL-NOV-SYNTH-1');
    await lead.getByLabel('Paid on').fill(day);
    await lead.getByText('PCB checked').click();
    await lead.getByRole('button', { name: 'Record paid' }).click();
    const paid = panelOf(page, 'Salary and claim payouts');
    await paid.getByRole('heading', { name: 'Paid in the last three months' }).waitFor();
    await paid.getByText(/ref SAL-NOV-SYNTH-1/).waitFor();
    await page.screenshot({ path: new URL(`payouts-${width}.png`, out).pathname, fullPage: false });
    // No horizontal scroll at phone width.
    if (width < 500) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone');
    assert.equal(external, 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Finance gaps browser check passed at desktop and phone widths: FD confirms and delegates, clerk prepares, leader records paid.');
} catch (e) {
  for (const c of browser.contexts()) for (const pg of c.pages()) console.error('Page:', (await pg.locator('body').innerText().catch(() => '')).slice(0, 1500));
  throw e;
} finally {
  await browser.close();
  server.close();
}
