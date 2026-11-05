const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'file:///tmp/claude-0/rev/full-demo.html';
const [idx, ...views] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.waitForSelector('.persona', { timeout: 60000 });
  await (await p.$$('.persona'))[Number(idx)].click();
  await p.waitForSelector('nav.nav button', { timeout: 30000 });
  await p.waitForTimeout(1000);
  const gate = await p.$('.confid-gate');
  if (gate) { for (const c of await gate.$$('input[type=checkbox]')) await c.check().catch(() => {}); for (const x of await gate.$$('button')) { if (/accept|agree|setuju|terima|faham|understand/i.test((await x.textContent()) || '')) { await x.click(); break; } } await p.waitForTimeout(700); }
  // English screen language for the review.
  const en = p.getByRole('button', { name: 'English', exact: true });
  if (await en.count()) { await en.first().click().catch(() => {}); await p.waitForTimeout(500); }
  for (const v of views) {
    await p.locator('nav.nav button').filter({ hasText: new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first().click();
    await p.waitForTimeout(2500);
    const txt = await p.evaluate(() => (document.querySelector('.main') || document.body).innerText);
    const safe = v.replace(/[^a-z0-9]+/gi, '_');
    fs.writeFileSync(`/tmp/claude-0/rev/crawl/view-${idx}-${safe}.txt`, txt);
    await p.screenshot({ path: `/tmp/claude-0/rev/crawl/view-${idx}-${safe}.png`, fullPage: true });
    console.log('==', v, txt.length);
  }
  await b.close();
})();
