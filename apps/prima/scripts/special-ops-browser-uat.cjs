if (process.env.CI_SYNTHETIC_BROWSER !== 'true') throw Error('Synthetic browser opt-in required');
const { localOnly } = require('./browser-local-only.cjs');
// Run: npm run build:demo -w @prima/web; serve apps/web/dist-demo on :5180 (e.g. python3 -m http.server 5180);
// then node scripts/special-ops-browser-uat.cjs <out-dir> <width>. Not wired to CI.
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
    await dismiss();
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
  const TITLE = `Buy cartridges UAT ${W}`;

  // ---- Special Ops: arms request: enter, return, correct, resubmit, authorise, denial ----
  await step('Company GM raises an arms request on the company Arms screen', async () => {
    await signIn('u-gm-sasa');
    await nav('Arms control');
    await p.getByRole('button', { name: 'New arms request' }).click();
    const d = p.locator('.drawer, [role=dialog]').last();
    await d.getByText('Short title').locator('..').locator('input').fill(TITLE);
    await d.getByText('Why, and what papers you have').locator('..').locator('textarea').fill('Range practice; quotation QT-TEST-01 on file');
    await d.getByText('Quantity', { exact: true }).locator('..').locator('input').fill('800');
    await d.getByText('Estimated cost, RM (optional)').locator('..').locator('input').fill('2400');
    await shot('arms-raise-form');
    await d.getByRole('button', { name: 'Send to Arms Control' }).click();
    await toast(/Sent to Arms Control/);
    await p.getByText(TITLE).first().waitFor();
    await shot('arms-raised');
  });
  await step('The guide card opens in English and shows the fields', async () => {
    await p.getByRole('button', { name: 'Raise an arms request' }).click();
    await p.getByText('Arms control → your company → Arms requests → New arms request').first().waitFor();
    await shot('arms-guide');
  });
  await step('Arms Control assistant cannot send it back without a reason (button disabled), then sends it back', async () => {
    await signIn('u-pwvsb-arms-asst');
    await nav('Arms control');
    await p.locator('[role=tab]:visible', { hasText: /^Requests/ }).first().click();
    const item = p.locator('.list-item').filter({ hasText: TITLE }).first();
    await item.waitFor();
    assert.equal(await item.getByRole('button', { name: 'Send back' }).isDisabled(), true);
    await item.getByPlaceholder('Reason (needed for a decision)').fill('Two sessions need 400 at most');
    await item.getByRole('button', { name: 'Send back' }).click();
    await toast(/send back recorded/i);
    await shot('arms-sent-back');
  });
  await step('Another company user (the manager) sees it sent back but has no resubmit button', async () => {
    await signIn('u-cm-sasa');
    await nav('Arms control');
    const item = p.locator('.list-item').filter({ hasText: TITLE }).first();
    await item.waitFor();
    await item.getByText('Sent back').first().waitFor();
    assert.equal(await item.getByRole('button', { name: 'Correct and resubmit' }).count(), 0);
  });
  await step('The requester sees why, corrects the quantity and cost, and resubmits', async () => {
    await signIn('u-gm-sasa');
    await nav('Arms control');
    const item = p.locator('.list-item').filter({ hasText: TITLE }).first();
    await item.getByText(/Two sessions need 400 at most/).waitFor();
    assert.equal(await item.getByRole('button', { name: 'Correct and resubmit' }).isDisabled(), true);
    await item.getByLabel(/Quantity for/).fill('400');
    await item.getByLabel(/Cost for/).fill('1200');
    await item.getByLabel(/What was corrected/).fill('Cut to 400 rounds');
    await shot('arms-resubmit-form');
    await item.getByRole('button', { name: 'Correct and resubmit' }).click();
    await toast(/sent again to Arms Control/);
    await p.locator('.list-item').filter({ hasText: TITLE }).first().getByText(/400 pcs/).waitFor();
    await shot('arms-resubmitted');
  });
  await step('Arms Control passes the corrected request to the company', async () => {
    await signIn('u-pwvsb-arms-asst');
    await nav('Arms control');
    await p.locator('[role=tab]:visible', { hasText: /^Requests/ }).first().click();
    const item = p.locator('.list-item').filter({ hasText: TITLE }).first();
    await item.getByPlaceholder('Reason (needed for a decision)').fill('Quantity now matches two sessions');
    await item.getByRole('button', { name: 'Pass to company' }).click();
    await toast(/pass to company recorded/i);
  });
  await step('The company manager authorises with a reason', async () => {
    await signIn('u-cm-sasa');
    await nav('Arms control');
    const item = p.locator('.list-item').filter({ hasText: TITLE }).first();
    assert.equal(await item.getByRole('button', { name: 'Authorise' }).isDisabled(), true);
    await item.getByPlaceholder('Reason (needed for a decision)').fill('Needed for the December range');
    await item.getByRole('button', { name: 'Authorise' }).click();
    await toast(/authorise recorded/i);
    await shot('arms-authorised');
  });
  await step('Finance cannot open Arms control (no menu entry)', async () => {
    await signIn('u-fd');
    assert.equal(await offered('Arms control'), false);
  });
  await step('Arms Control does not see the directors-only legal tab; the CEO does', async () => {
    await signIn('u-pwvsb-arms');
    await nav('Arms control');
    assert.equal(await p.locator('[role=tab]:visible', { hasText: /Legal points/ }).count(), 0);
    await signIn('u-fauzan');
    await nav('Arms control');
    await p.locator('[role=tab]:visible', { hasText: /Legal points/ }).first().click();
    await p.getByText('Legal points for the directors').waitFor();
    await shot('legal-directors');
  });

  // ---- Asset Management: purchase: enter, approve, receipt refused above approval, ask again, re-approve, receive ----
  const ITEM = `UAT chairs ${W}`;
  await step('Asset team asks to buy (RM5,000)', async () => {
    await signIn('u-asset-re1');
    await nav('Asset Management');
    await p.getByRole('tab', { name: 'Purchases' }).click();
    await p.getByLabel('What to buy').fill(ITEM);
    await p.getByLabel('Quantity').first().fill('6');
    await p.getByLabel('Estimated cost (RM)').fill('5000');
    await p.getByLabel('Location').fill('Group office, level 3');
    await p.getByLabel('Owning entity').fill('PWVSB');
    await p.getByLabel('Reason', { exact: true }).fill('Broken chairs replaced');
    await p.getByRole('button', { name: 'Ask', exact: true }).click();
    await toast(/Purchase request sent/);
    await p.getByText(ITEM).first().waitFor();
  });
  await step('The asker cannot approve their own request (server refusal shown)', async () => {
    const item = p.locator('.list-item').filter({ hasText: ITEM }).first();
    await item.getByLabel(new RegExp(`Reason for ${ITEM}`)).fill('Approve my own');
    await item.getByRole('button', { name: 'Approve' }).click();
    await p.getByText(/Someone else decides/).first().waitFor();
    await shot('asset-self-approve-refused');
  });
  await step('The Finance Director approves with a reason', async () => {
    await signIn('u-fd');
    await nav('Asset Management');
    await p.getByRole('tab', { name: 'Purchases' }).click();
    const item = p.locator('.list-item').filter({ hasText: ITEM }).first();
    await item.getByLabel(new RegExp(`Reason for ${ITEM}`)).fill('Within the furniture budget');
    await item.getByRole('button', { name: 'Approve' }).click();
    await toast(/Purchase approved/);
  });
  await step('The team cannot receive it at RM6,000; it asks again at the new amount', async () => {
    await signIn('u-asset-re1');
    await nav('Asset Management');
    await p.getByRole('tab', { name: 'Purchases' }).click();
    const item = p.locator('.list-item').filter({ hasText: ITEM }).first();
    await item.getByLabel('Asset tag').fill(`FUR-UAT-${W}`);
    await item.getByLabel('Actual cost (RM)').fill('6000');
    assert.equal(await item.getByRole('button', { name: 'Received' }).count(), 0);
    await item.getByText(/it must be approved again/).waitFor();
    await item.getByLabel('Why the price changed').fill('Supplier price went up');
    await shot('asset-over-approved');
    await item.getByRole('button', { name: /Ask again at/ }).click();
    await toast(/Sent back for approval at the new amount/);
  });
  await step('The Finance Director approves the new amount; the team receives it', async () => {
    await signIn('u-fd');
    await nav('Asset Management');
    await p.getByRole('tab', { name: 'Purchases' }).click();
    let item = p.locator('.list-item').filter({ hasText: ITEM }).first();
    await item.getByText(/6,000/).first().waitFor();
    await item.getByLabel(new RegExp(`Reason for ${ITEM}`)).fill('New quote checked');
    await item.getByRole('button', { name: 'Approve' }).click();
    await toast(/Purchase approved/);
    await signIn('u-asset-re1');
    await nav('Asset Management');
    await p.getByRole('tab', { name: 'Purchases' }).click();
    item = p.locator('.list-item').filter({ hasText: ITEM }).first();
    await item.getByLabel('Asset tag').fill(`FUR-UAT-${W}`);
    await item.getByLabel('Actual cost (RM)').fill('6000');
    await item.getByRole('button', { name: 'Received' }).click();
    await toast(/Received: added to the register/);
    await shot('asset-received');
  });
  await step('A company manager has no Asset Management menu entry', async () => {
    await signIn('u-gm-sasa');
    assert.equal(await offered('Asset Management'), false);
  });
  await step('No page errors', async () => { assert.deepEqual(errors, []); });
  require('node:fs').writeFileSync(`${OUT}/results-${W}.json`, JSON.stringify({ width: W, results, errors }, null, 2));
  await b.close();
  process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
})();
