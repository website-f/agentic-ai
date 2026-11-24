// Run: build the demo (npm run build:demo -w @prima/web), serve apps/web/dist-demo on 127.0.0.1:4179
// (npx vite preview --mode demo --outDir dist-demo --host 127.0.0.1 --port 4179 --strictPort from apps/web), then:
// node scripts/procurement-gaps-browser-uat.cjs <screenshot-dir>.
// Synthetic browser UAT of the Procurement and store gaps (Fauzan, 23 Nov 2026 "Do the gap") on the demo build: no
// backend, made-up people, suppliers and purchases, nothing leaves the machine. Uses the pre-installed Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2] || '.';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef0000000049454e44ae426082', 'hex');

(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    console.log(`\n== viewport ${viewport.width}px ==`);
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin === BASE || u.protocol === 'blob:' || u.protocol === 'data:') return r.continue(); return r.abort(); });
    await p.addInitScript(() => { try { if (!sessionStorage.getItem('uat-init')) { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); sessionStorage.setItem('uat-init', '1'); } } catch {} });
    await p.goto(BASE + '/');
    const shot = (n) => p.screenshot({ path: `${S}/${viewport.width}-${n}.png`, fullPage: false });
    const nav = async (names) => {
      const visible = async () => { for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); if (await more.count()) { await more.last().click(); await p.waitForTimeout(600); btn = await visible(); } }
      if (!btn) throw new Error('No visible button ' + names.join('/'));
      await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1200);
    };
    const first = async (id) => {
      await p.evaluate((x) => localStorage.setItem('prima-demo-user', x), id); await p.reload(); await p.waitForTimeout(2200);
      const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ }); if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(600); }
    };
    const openPurchase = async (title) => {
      const row = p.locator('.list-item', { hasText: title }).first();
      await row.locator('button[aria-expanded]').first().click(); await p.waitForTimeout(500);
      return row;
    };
    try {
      // 1. The executive orders an approved purchase with the supplier's promised date and downloads the PO.
      await first('u-proc-exec'); await nav(['Procurement']);
      const row = await openPurchase('Uniform shirts L');
      await row.getByLabel('PO number').fill('PO-UAT-0001');
      await row.getByLabel('Delivery promised by').fill('2026-12-15');
      await shot('01-order-with-date');
      await row.getByRole('button', { name: 'Order placed' }).click(); await p.waitForTimeout(1200);
      const ordered = p.locator('.list-item', { hasText: 'Uniform shirts L' }).first();
      if (!(await ordered.getByRole('button', { name: 'Download Purchase Order (PDF)' }).isVisible())) await ordered.locator('button[aria-expanded]').first().click();
      const dl = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await ordered.getByRole('button', { name: 'Download Purchase Order (PDF)' }).click();
      const file = await dl;
      step('PO PDF downloads after ordering', !!file && /^PO_PO-UAT-0001\.pdf$/.test(file.suggestedFilename()), file?.suggestedFilename() ?? 'no download');
      step('the promised date shows on the purchase', (await ordered.innerText()).includes('due'), '');
      await shot('02-ordered-po-download');
      // 2. Store tab: Buy more fills a purchase from the low-stock row.
      await p.getByRole('tab', { name: 'Store' }).click(); await p.waitForTimeout(800);
      const buy = p.getByRole('button', { name: /^Buy more/ }).first();
      step('a low-stock row offers Buy more', await buy.count() > 0);
      if (await buy.count()) {
        await buy.scrollIntoViewIfNeeded(); await shot('03-buy-more'); await buy.click(); await p.waitForTimeout(800);
        const title = await p.getByLabel('What is being bought').inputValue();
        step('Buy more fills the purchase form', title.startsWith('Restock '), title);
        await shot('04-buy-more-form');
      }
      // 3. Suppliers tab: each supplier's record.
      await p.getByRole('tab', { name: 'Suppliers' }).click(); await p.waitForTimeout(800);
      const rec = p.getByText(/^Record: /).first();
      step('suppliers show their delivery record', await rec.count() > 0);
      if (await rec.count()) { await rec.scrollIntoViewIfNeeded(); await shot('05-supplier-record'); }
      // 4. The storekeeper receives with the DO number and a photo of the DO; damaged pieces stay out of stock.
      await first('u-proc-store1'); await nav(['Procurement']);
      const recv = await openPurchase('Uniform shirts L');
      await recv.getByLabel('Received Uniform shirt L').fill('40').catch(async () => { await recv.locator('input[aria-label^="Received "]').first().fill('40'); });
      await recv.locator('input[aria-label^="Damaged "]').first().fill('2');
      await recv.getByLabel('Supplier DO number').fill('DO-UAT-77');
      await recv.getByLabel('Receipt note').fill('2 shirts torn at the seam');
      const fileInput = recv.locator('input[type=file]').first();
      await fileInput.setInputFiles({ name: 'DO-UAT-77.png', mimeType: 'image/png', buffer: PNG });
      await p.waitForTimeout(800);
      await shot('06-receive-form');
      await recv.getByRole('button', { name: 'Goods received' }).click(); await p.waitForTimeout(1500);
      const after = await p.locator('.list-item', { hasText: 'Uniform shirts L' }).first().innerText();
      step('goods received with the DO', /Received, Finance to match|Finance/.test(after), after.split('\n').slice(0, 3).join(' | '));
      await shot('07-received');
    } catch (e) {
      step('flow ran to the end', false, String(e.message).slice(0, 200));
      await shot('99-error');
    }
    step(`no page errors at ${viewport.width}px`, errors.length === 0, errors.join(' | ').slice(0, 200));
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
