if (process.env.CI_SYNTHETIC_BROWSER !== 'true') throw Error('Synthetic browser opt-in required');
const { localOnly } = require('./browser-local-only.cjs');
// Run: npm run build:demo -w @prima/web; serve apps/web/dist-demo on :5180 (e.g. python3 -m http.server 5180);
// then node scripts/cms-masterplan-browser-uat.cjs <out-dir> <width>. Not wired to CI. Masterplan §191 and §195.
// Browser UAT on the demo build (synthetic data only, all in the browser; no API, no provider).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const OUT = process.argv[2];
const W = Number(process.argv[3] || 1280);
const results = [];
let n = 0;
const step = async (name, fn) => {
  try { await fn(); results.push({ n: ++n, name, ok: true }); console.log(`ok ${n} ${name}`); }
  catch (e) { await globalThis.__p.screenshot({ path: OUT + '/fail-' + (n + 1) + '.png' }).catch(() => {}); results.push({ n: ++n, name, ok: false, error: String(e.message).slice(0, 1200) }); console.log(`FAIL ${n} ${name}: ${e.message.slice(0, 300)}`); }
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
  const p = await ctx.newPage();
  // Keep the linked-CCTV/no-telemetry fixture stable across calendar changes.
  // Only the synthetic page's Date is fixed; its timers continue running.
  await p.clock.setFixedTime(new Date('2026-11-07T14:00:00Z'));
  await localOnly(p);
  p.setDefaultTimeout(8000);
  globalThis.__p = p;
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const shot = (name) => p.screenshot({ path: `${OUT}/${W}-${String(n + 1).padStart(2, '0')}-${name}.png`, fullPage: false });
  const signIn = async (id) => {
    await p.evaluate((u) => localStorage.setItem('prima-demo-user', u), id);
    await p.reload();
    await p.waitForTimeout(800);
    const agree = p.getByRole('button', { name: /Saya setuju|I agree|agree/i });
    if (await agree.waitFor({ timeout: 4000 }).then(() => true, () => false)) await agree.click();
    await p.waitForTimeout(300);
  };
  const dismiss = async () => { const g = p.locator('.confid-gate button'); if (await g.isVisible().catch(() => false)) { await g.first().click(); await p.waitForTimeout(300); } };
  const SHORT = { 'Arms control': 'Arms', 'Asset Management': 'Asset' };
  const nav = async (label) => {
    await p.waitForTimeout(500); await dismiss();
    if (W >= 800) {
      const btn = p.locator('nav:visible button').filter({ hasText: new RegExp('^' + label + '$') }).first();
      if ((await btn.getAttribute('aria-current').catch(() => null)) !== 'page') await btn.click();
    } else {
      const bar = p.locator('nav:visible button').filter({ hasText: new RegExp('^(' + label + '|' + (SHORT[label] || label) + ')$') });
      if (await bar.count()) { if ((await bar.first().getAttribute('aria-current')) !== 'page') await bar.first().click(); }
      else { await p.locator('nav:visible button').filter({ hasText: /^More$/ }).click(); await p.locator('[role=dialog] button, .sheet button, .more button').filter({ hasText: new RegExp('^' + label + '$') }).first().click(); }
    }
    await p.waitForTimeout(700);
  };
  // Is a menu entry offered at all (desktop sidebar, or the phone bar plus its More sheet)?
  const offered = async (label) => {
    if (W >= 800) return (await p.locator('nav:visible button').filter({ hasText: new RegExp('^' + label + '$') }).count()) > 0;
    const bar = await p.locator('nav:visible button').filter({ hasText: new RegExp('^(' + label + '|' + (SHORT[label] || label) + ')$') }).count();
    if (bar) return true;
    await p.locator('nav:visible button').filter({ hasText: /^More$/ }).click(); await p.waitForTimeout(300);
    const n = await p.locator('[role=dialog] button, .sheet button, .more button').filter({ hasText: new RegExp('^' + label + '$') }).count();
    await p.keyboard.press('Escape'); return n > 0;
  };
  const toast = async (re) => { await p.getByText(re).first().waitFor({ timeout: 4000 }); };
  await p.goto(process.env.UAT_URL || 'http://localhost:5180/');
  await p.evaluate(() => { localStorage.removeItem('prima-demo-log-v1'); localStorage.setItem('prima.lang', 'en'); });
  const noSideScroll = async () => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'page scrolls sideways');

  await step('§195 Head Control sees response and coverage on the CMS Sites tab', async () => {
    await signIn('u-cms-head');
    await nav('CMS');
    await p.getByRole('tab', { name: /^Sites$/ }).first().click();
    const h = p.getByRole('heading', { name: 'Response and coverage, last 24 hours' });
    await h.waitFor();
    await h.scrollIntoViewIfNeeded();
    await p.getByText(/Target: acknowledge within \d+ s \(CMS setting\)/).first().waitFor();
    await p.getByText(/Linked systems: \d+ online, \d+ offline/).first().waitFor();
    await p.locator('th').filter({ hasText: 'Systems unknown' }).waitFor();
    await noSideScroll();
    await shot('cms-kpis');
  });

  await step('§191 the new contract shows the CMS activation step, and Prima refuses it without a site', async () => {
    await signIn('u-ae-arsh');
    await nav('Contracts');
    await p.getByText('New client site A (ARSH, mock)').first().click();
    const item = p.locator('.list-item').filter({ hasText: /^CMS activation \(technical\): site CCTV or alarm panel/ }).last();
    await item.waitFor();
    await item.scrollIntoViewIfNeeded();
    await item.getByText(/Prima checks this before it can be marked done/).waitFor();
    await item.getByRole('button', { name: 'Mark done' }).click();
    await item.getByRole('button', { name: 'Use a test file', exact: true }).click();
    await item.getByRole('button', { name: 'Save as done', exact: true }).click();
    await toast(/CMS is not active yet: no site is on this contract yet/);
    await noSideScroll();
    await shot('contract-cms-step');
  });

  await step('Commissioning: the company manager records the signed CMS scope on a live contract', async () => {
    await signIn('u-cm-arsh');
    await nav('Contracts');
    await p.locator('.list-item').filter({ hasText: 'ARSH/CT/0072' }).first().click();
    const panel = p.locator('section').filter({ has: p.getByRole('heading', { name: 'CMS service' }) }).last();
    await panel.waitFor();
    await panel.scrollIntoViewIfNeeded();
    await panel.getByText('No signed CMS service scope yet.').waitFor();
    await panel.getByRole('button', { name: 'Record the signed CMS scope' }).click();
    await panel.getByLabel('Signed document reference').fill('CMS-SOW-UAT-01');
    await panel.getByLabel('Client signatory').fill('Sample Signatory');
    await panel.getByRole('button', { name: 'Save signed scope' }).click();
    await panel.getByText('Give the real date the scope was signed, not in the future.').waitFor(); // no date yet: refused
    await panel.getByLabel('Signed on').fill('2026-10-20');
    await panel.getByRole('button', { name: 'Save signed scope' }).click();
    await panel.getByText(/CMS-SOW-UAT-01/).first().waitFor();
    await panel.getByText(/not verified|Not verified/).first().waitFor();
    await noSideScroll();
    await shot('contract-cms-scope');
  });

  await step('Commissioning: the CMS desk verifies a contact by test call; only Arms Control may accept', async () => {
    await signIn('u-cms-head');
    await nav('CMS');
    await p.getByRole('tab', { name: /^Commissioning$/ }).first().click();
    await p.getByRole('heading', { name: 'Commissioning: signed CMS service per contract' }).waitFor();
    const row = p.locator('.card, .list-item, section').filter({ hasText: 'CMS-SOW-UAT-01' }).last();
    await row.waitFor();
    assert.equal(await row.getByRole('button', { name: /Accept for CMS/ }).count(), 0, 'CMS desk must not see Accept');
    const input = row.getByPlaceholder('Test call answered, number confirmed').first();
    await input.fill('Test call answered, number confirmed');
    await row.getByRole('button', { name: 'Mark verified' }).first().click();
    await toast(/Contact verified/);
    await row.getByText(/Verified by|verified by/).first().waitFor();
    // Acceptance test per service and site: the demo has no CMS up report, so the CCTV test is refused honestly.
    const test = row.getByLabel(/^Test of CCTV monitoring at /).first();
    await test.fill('Live view checked from CMS');
    await row.getByRole('button', { name: 'Record test' }).first().click();
    await toast(/not reported this CCTV up in the last 24 hours/);
    await row.getByText(/Alarm panel response: no acceptance test recorded|Alarm panel response: no alarm panel linked/).first().waitFor();
    await noSideScroll();
    await shot('cms-commissioning');
    await signIn('u-pwvsb-arms');
    await nav('CMS');
    await p.getByRole('tab', { name: /^Commissioning$/ }).first().click();
    await p.locator('.card, .list-item, section').filter({ hasText: 'CMS-SOW-UAT-01' }).last().getByRole('button', { name: /Accept for CMS/ }).waitFor();
  });

  await b.close();
  const fs = require('node:fs');
  fs.writeFileSync(`${OUT}/results-${W}.json`, JSON.stringify({ width: W, results, pageErrors: errors }, null, 2));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed, page errors: ${errors.length}`);
  process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
})();
