// Synthetic browser UAT of the Director Office and company secretary gaps (Fauzan, 23 Nov 2026: "Do the gap") on the
// demo build (no backend, no real data). Run: npm run demo:build, then
// node scripts/director-office-browser-uat.cjs <screenshot-dir>
// The Director Office Administrator sees the desk before the tenders; the Deputy Chief of Staff opens another SSM
// filing and sees the filing executive form; the company secretary firm keys in a lodgement.
const { createServer } = require('node:http');
const { readFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');
const S = resolve(process.argv[2] || 'director-office-uat');
mkdirSync(S, { recursive: true });
const html = readFileSync(resolve(__dirname, '../apps/web/dist-demo/index.html'));
let failed = 0;
const step = (name, ok) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
(async () => {
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const w = viewport.width;
    const ctx = await b.newContext({ viewport, serviceWorkers: 'block' });
    await ctx.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    await p.goto(origin);
    const as = async (id) => {
      await p.evaluate((u) => { localStorage.setItem('prima-demo-user', u); localStorage.setItem('prima.lang', 'en'); }, id);
      await p.reload();
      await p.locator('main, .page, h1').first().waitFor({ timeout: 30000 });
      const ok = p.getByRole('button', { name: 'I agree and will keep it confidential' });
      if (await ok.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) await ok.click();
      await p.waitForTimeout(800);
    };
    const nav = async (name) => {
      // The first screen of a sign-in is already open on a phone (it sits on the bottom bar, not in More).
      if ((await p.locator('h1').first().innerText().catch(() => '')).trim() === name) return;
      const visible = async () => { for (const x of await p.getByRole('button', { name, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); if (await more.count()) { await more.last().click(); await p.waitForTimeout(600); } btn = await visible(); }
      if (!btn) { await p.screenshot({ path: `${S}/nav-missing-${name.replace(/\W+/g, '-')}.png` }); throw new Error('No visible button ' + name); }
      await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click()));
      await p.waitForTimeout(1500);
    };
    const body = () => p.innerText('body');

    // Director Office Administrator: the desk first, tenders after.
    await as('u-pwvsb-doa');
    await nav('Director Office');
    await p.getByText('This week', { exact: true }).first().waitFor({ timeout: 15000 });
    const weekY = (await p.getByRole('heading', { name: 'This week' }).first().boundingBox())?.y ?? Infinity;
    const tenderY = (await p.getByRole('heading', { name: /^Tenders/ }).first().boundingBox())?.y ?? -1;
    step(`${w}: Director Office shows the week before the tenders`, weekY < tenderY);
    await p.screenshot({ path: `${S}/${w}-01-doa-desk.png` });

    // Deputy Chief of Staff: open another filing; name a filing executive.
    await as('u-dcos');
    await nav('Company secretary');
    await p.getByRole('button', { name: 'Open another filing' }).click();
    await p.getByPlaceholder('For example: change of registered address').fill('Change of registered address (synthetic)');
    await p.locator('input[type=date]').first().fill('2026-12-07');
    await p.getByPlaceholder('For example: Companies Act 2016 s.46, within 14 days').fill('Companies Act 2016 s.46, 14 days');
    await p.screenshot({ path: `${S}/${w}-02-dcos-open-filing.png` });
    await p.getByRole('button', { name: 'Open the filing' }).click();
    await p.waitForTimeout(1500);
    step(`${w}: the new filing is listed`, /Change of registered address \(synthetic\)/.test(await body()));
    await p.screenshot({ path: `${S}/${w}-03-filing-opened.png` });
    await p.getByRole('tab', { name: 'Companies' }).click();
    await p.waitForTimeout(800);
    step(`${w}: Deputy sees the filing executive form`, /Name one Chief of Staff office executive/.test(await body()));
    await p.screenshot({ path: `${S}/${w}-04-dcos-filing-exec.png` });

    // Company secretary firm: keys in its own lodgement.
    await as('u-cosec');
    await nav('Company secretary');
    const line = p.locator('.list-item', { hasText: 'Change of registered address (synthetic)' }).first();
    const has = await line.count();
    step(`${w}: secretary firm sees the filing`, has > 0);
    if (has) {
      await line.getByLabel('Reference').fill('MBRS-SYN-1');
      await line.getByRole('button', { name: 'Secretary lodged it' }).click();
      await p.waitForTimeout(1200);
      step(`${w}: secretary firm recorded the lodgement`, /Awaiting SSM acknowledgement/.test(await line.innerText()));
      await p.screenshot({ path: `${S}/${w}-05-secretary-lodged.png` });
    }
    step(`${w}: no page errors`, errors.length === 0);
    if (errors.length) console.log(errors.slice(0, 3));
    await ctx.close();
  }
  await b.close();
  server.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
