const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.DEMO || 'file:///tmp/claude-0/rev/full-demo.html';
const OUT = '/tmp/claude-0/rev/crawl';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await ctx.newPage();
  let errs = [];
  const hook = (pg) => { pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); }); };
  await page.goto(URL);
  await page.waitForSelector('.persona', { timeout: 60000 });
  const personas = await page.$$eval('.persona', (bs) => bs.map((b) => ({ name: b.querySelector('.persona-name')?.textContent, title: b.querySelector('.persona-title')?.textContent })));
  const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : null;
  const results = [];
  for (let i = 0; i < personas.length; i++) {
    const p = personas[i];
    if (only && !only.includes(String(i))) continue;
    await ctx.close(); ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); page = await ctx.newPage(); hook(page);
    await page.goto(URL);
    await page.waitForSelector('.persona', { timeout: 60000 });
    errs = [];
    await (await page.$$('.persona'))[i].click();
    await page.waitForSelector('nav.nav button', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    for (let g = 0; g < 3; g++) {
      const gate = await page.$('.confid-gate');
      if (!gate) break;
      const cb = await gate.$$('input[type=checkbox]');
      for (const c of cb) await c.check().catch(() => {});
      const b = await gate.$$('button');
      for (const x of b) { const t = (await x.textContent()) || ''; if (/accept|agree|setuju|terima|faham|understand/i.test(t)) { await x.click().catch(() => {}); break; } }
      await page.waitForTimeout(700);
    }
    const navs = await page.$$eval('nav.nav button', (bs) => bs.map((b) => b.textContent.trim()));
    const r = { ...p, navs, views: [] };
    await page.screenshot({ path: `${OUT}/${i}-home.png` });
    for (let k = 0; k < navs.length; k++) {
      errs = [];
      const t0 = Date.now();
      const btn = (await page.$$('nav.nav button'))[k];
      if (!btn) continue;
      await btn.click();
      await page.waitForTimeout(400);
      await page
        .waitForFunction(() => !document.querySelector('.loading, [aria-busy="true"]'), null, { timeout: 15000 })
        .catch(() => errs.push('still loading after 15s'));
      const ms = Date.now() - t0;
      const info = await page.evaluate(() => {
        const main = document.querySelector('.main') || document.body;
        const crit = [...document.querySelectorAll('.notice[data-tone="crit"]')].map((n) => n.textContent.trim().slice(0, 160));
        const txt = main.innerText;
        return { len: txt.length, crit, unknowns: (txt.match(/\bUnknown\b/g) || []).length, sample: txt.slice(0, 400).replace(/\s+/g, ' ') };
      });
      r.views.push({ nav: navs[k], ms, errs: errs.slice(0, 5), ...info });
    }
    results.push(r);
    fs.writeFileSync(`${OUT}/results${process.argv[3] || ''}.json`, JSON.stringify({ personas, results }, null, 1));
    console.log(i, p.title, '|', p.name, 'navs', navs.length, 'problem views', r.views.filter((v) => v.errs.length || v.crit.length).length);
  }
  fs.writeFileSync(`${OUT}/results${process.argv[3] || ''}.json`, JSON.stringify({ personas, results }, null, 1));
  await browser.close();
})();
