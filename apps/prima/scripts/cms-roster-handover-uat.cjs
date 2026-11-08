if (process.env.CI_SYNTHETIC_BROWSER !== 'true') throw Error('Synthetic browser opt-in required');
const { localOnly } = require('./browser-local-only.cjs');
// Run: npm run build:demo -w @prima/web; serve apps/web/dist-demo on :5180 (e.g. python3 -m http.server 5180);
// then node scripts/cms-roster-handover-uat.cjs <out-dir> <width>. Not wired to CI.
// Browser UAT of the CMS duty roster and the two-step shift handover on the demo build (synthetic data only, all in
// the browser; no API, no provider). The browser clock is fixed at 06:35 Malaysia time so the night shift is ending.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const OUT = process.argv[2];
const W = Number(process.argv[3] || 1280);
const results = [];
let n = 0;
const step = async (name, fn) => {
  try { await fn(); results.push({ n: ++n, name, ok: true }); console.log(`ok ${n} ${name}`); }
  catch (e) { await globalThis.__p.screenshot({ path: OUT + '/fail-' + W + '-' + (n + 1) + '.png' }).catch(() => {}); results.push({ n: ++n, name, ok: false, error: String(e.message).slice(0, 1200) }); console.log(`FAIL ${n} ${name}: ${e.message.slice(0, 400)}`); }
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await localOnly(p);
  await p.clock.install({ time: new Date('2026-11-05T22:35:00Z') }); // 6 Nov 2026 06:35 MYT
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
  const nav = async (label) => {
    await p.waitForTimeout(500); await dismiss();
    if (W >= 800) {
      const btn = p.locator('nav:visible button').filter({ hasText: new RegExp('^' + label + '$') }).first();
      if ((await btn.getAttribute('aria-current').catch(() => null)) !== 'page') await btn.click();
    } else {
      const SHORT = { 'HR monitor': 'HR' };
      const bar = p.locator('nav:visible button').filter({ hasText: new RegExp('^(' + label + '|' + (SHORT[label] || label) + ')$') });
      if (await bar.count()) { if ((await bar.first().getAttribute('aria-current')) !== 'page') await bar.first().click(); }
      else { await p.locator('nav:visible button').filter({ hasText: /^More$/ }).click(); await p.locator('[role=dialog] button, .sheet button, .more button').filter({ hasText: new RegExp('^' + label + '$') }).first().click(); }
    }
    await p.waitForTimeout(700);
  };
  const tab = async (name) => { await p.getByRole('tab', { name: new RegExp('^' + name + '$') }).first().click(); await p.waitForTimeout(300); };
  const toast = async (re) => { await p.getByText(re).first().waitFor({ timeout: 4000 }); };
  const noSideScroll = async () => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'page scrolls sideways');
  const DAY = 'cms-2026-11-06-0700-12h-hc-1';
  await p.goto(process.env.UAT_URL || 'http://localhost:5180/');
  await p.evaluate(() => { localStorage.removeItem('prima-demo-log-v1'); localStorage.setItem('prima.lang', 'en'); });

  await step('Arms Control takes the day Head Control off with a reason and puts Hafiz on the seat', async () => {
    await signIn('u-pwvsb-arms');
    await nav('CMS');
    await tab('Roster');
    const why = p.getByLabel(new RegExp('^Why take .* off ' + DAY + '$'));
    await why.scrollIntoViewIfNeeded();
    await why.fill('Annual leave (mock)');
    await why.locator('xpath=..').getByRole('button', { name: 'Take off' }).click();
    await toast(/Taken off the seat/);
    const pick = p.getByLabel(`Who sits Head Control ${DAY}`);
    await pick.selectOption('Hafiz bin Rahman');
    await pick.locator('xpath=..').getByRole('button', { name: 'Set' }).click();
    await toast(/Hafiz bin Rahman is on the seat/);
    await p.getByText(/taken off: .*Annual leave \(mock\)/).first().waitFor({ state: 'detached' }).catch(() => {});
    await p.getByLabel(`Who sits Head Control ${DAY}`).scrollIntoViewIfNeeded();
    await noSideScroll();
    await shot('arms-roster-rest-rules');
  });

  await step('The night Head Control writes the handover and cannot leave the desk before it is taken', async () => {
    await signIn('u-cms-head-b');
    await nav('CMS');
    const my = p.locator('section').filter({ has: p.getByRole('heading', { name: 'My seat' }) });
    await my.waitFor();
    await my.getByLabel('Handover for the next shift').fill('Vault watch check-ins on time; one forwarded call to return (Inas); intrusion at a Sasa site acknowledged, OM on the way');
    await my.getByRole('button', { name: 'Write handover' }).click();
    await toast(/Handover written/);
    await my.getByText(/Handover written at/).waitFor();
    await my.getByLabel('Why you are leaving early').fill('End of shift');
    await my.getByRole('button', { name: 'Clock out' }).click();
    await p.getByText(/Stay on the desk until Hafiz bin Rahman takes the handover/).first().waitFor();
    await noSideScroll();
    await shot('night-hc-wrote-handover');
  });

  await step('The incoming Head Control clocks in, reads the handover with the open items and takes it', async () => {
    await signIn('u-cms-head');
    await nav('CMS');
    const my = p.locator('section').filter({ has: p.getByRole('heading', { name: 'My seat' }) });
    await my.waitFor();
    await my.getByRole('button', { name: 'Clock in' }).click();
    await toast(/Clocked in/);
    await my.getByText('Take the handover').waitFor();
    await my.getByText(/1\. Handed over by: Siti Aishah binti Omar/).first().waitFor();
    await my.getByLabel('Handover taken, note').fill('Board checked with Siti; call to Inas returned at 06:40; OM confirmed at the Sasa site');
    await noSideScroll();
    await shot('day-hc-take-handover');
    await my.getByRole('button', { name: 'Agree and take over' }).click();
    await toast(/Handover taken/);
  });

  await step('The night Head Control now clocks out; the board shows both steps', async () => {
    await signIn('u-cms-head-b');
    await nav('CMS');
    const my = p.locator('section').filter({ has: p.getByRole('heading', { name: 'My seat' }) });
    // The browser clock is still 06:35: leaving 25 minutes before 07:00 needs a reason.
    await my.getByRole('button', { name: 'Clock out' }).click();
    await p.getByText('You are leaving before the shift ends. Say why.').first().waitFor();
    await my.getByLabel('Why you are leaving early').fill('Handover taken by Hafiz at 06:36; desk handed over');
    await my.getByRole('button', { name: 'Clock out' }).click();
    await toast(/Clocked out/);
    await signIn('u-cms-head');
    await nav('CMS');
    const ho = p.locator('.list-item').filter({ hasText: 'Handover to the 07:00 shift' });
    await ho.getByText(/2\. Taken by: Hafiz bin Rahman at/).waitFor();
    await ho.scrollIntoViewIfNeeded();
    await noSideScroll();
    await shot('board-handover-done');
  });

  await step('Arms Control sees who has a Prima account and the hours this month', async () => {
    await signIn('u-pwvsb-arms');
    await nav('CMS');
    await tab('Staff');
    await p.getByText('No Prima account: cannot clock in').first().waitFor();
    const h = p.getByRole('heading', { name: 'Hours this month' });
    await h.scrollIntoViewIfNeeded();
    await p.getByRole('row').filter({ hasText: 'Siti Aishah binti Omar' }).first().waitFor();
    await noSideScroll();
    await shot('arms-hours');
  });

  await step('HR views the CMS hours and the rest setting, with nothing to change', async () => {
    await signIn('u-pwvsb-hr');
    await nav('HR monitor');
    const h = p.getByRole('heading', { name: 'CMS staff hours' });
    await h.waitFor();
    await h.scrollIntoViewIfNeeded();
    await p.getByText(/View only\. Arms Control sets the roster and the rest between shifts: now \d+ hours/).waitFor();
    await p.getByRole('row').filter({ hasText: 'Hafiz bin Rahman' }).first().waitFor();
    assert.equal(await p.locator('section').filter({ has: h }).getByRole('button').count(), 0, 'HR must have no buttons here');
    await noSideScroll();
    await shot('hr-cms-hours-view');
  });

  await step('Default BM + English screen for the Head Control', async () => {
    await p.evaluate(() => localStorage.setItem('prima.lang', 'mix'));
    await signIn('u-cms-head');
    await nav('CMS');
    await p.getByText(/Seat saya/).first().waitFor();
    await shot('bm-my-seat');
  });

  await b.close();
  const fs = require('node:fs');
  fs.writeFileSync(`${OUT}/results-${W}.json`, JSON.stringify({ width: W, results, pageErrors: errors }, null, 2));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed, page errors: ${errors.length}`);
  process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
})();
