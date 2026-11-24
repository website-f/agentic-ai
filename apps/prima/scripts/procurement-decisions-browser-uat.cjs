// Run: build the demo (npm run build:demo -w @prima/web), serve apps/web/dist-demo on 127.0.0.1:4179
// (npx vite preview --mode demo --outDir dist-demo --host 127.0.0.1 --port 4179 --strictPort from apps/web), then:
// node scripts/procurement-decisions-browser-uat.cjs <screenshot-dir>.
// Synthetic browser UAT of the procurement decisions D1 to D5 (Fauzan, 23 Nov 2026 "Yes, all five as recommended") on the demo build: no
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
      // D3: the CEO sets the online buying limit on the Approval limits panel.
      await first('u-fauzan');
      const limits = p.locator('section', { has: p.getByRole('heading', { name: 'Approval limits' }) }).first();
      await limits.scrollIntoViewIfNeeded();
      step('the online buying row shows on Approval limits', (await limits.innerText()).includes('Buying from an online platform'));
      await limits.getByRole('button', { name: 'Change limits' }).click(); await p.waitForTimeout(400);
      await limits.getByLabel('Online buying limit').fill('1000');
      await limits.getByLabel('Why').fill('UAT small online buys');
      await limits.getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(1200);
      step('the CEO saves an online buying limit', (await limits.innerText()).includes('RM1,000.00'));
      await shot('d3-limits');
      // D5 + D3: the executive sees Urgent and the online choice when sending a purchase for approval.
      await first('u-proc-exec'); await nav(['Procurement']);
      let found = false;
      for (const row of await p.locator('.list-item', { hasText: 'Procurement: 3 quotes' }).all()) {
        await row.locator('button[aria-expanded]').first().click(); await p.waitForTimeout(400);
        if (await row.getByRole('button', { name: 'Send for approval' }).count()) {
          found = true;
          step('Urgent tick box offered when sending for approval', (await row.getByLabel('Urgent').count()) > 0);
          await row.getByLabel('Urgent').check(); await p.waitForTimeout(200);
          step('Urgent asks why', (await row.getByLabel('Why urgent').count()) > 0);
          const opts = await row.getByLabel('Chosen quote').locator('option').allInnerTexts();
          step('online listings can be chosen once the CEO set a limit', opts.some((o) => o.startsWith('Buy online')) || !(await row.innerText()).includes('Online price'), opts.join(' | '));
          await row.scrollIntoViewIfNeeded(); await shot('d5-urgent');
          break;
        }
        await row.locator('button[aria-expanded]').first().click(); await p.waitForTimeout(200);
      }
      step('a purchase ready to send was found', found);
      await p.getByRole('tab', { name: 'Suppliers' }).click().catch(() => {}); await p.waitForTimeout(600);
      step('suppliers say one group list', (await p.locator('body').innerText()).includes('New suppliers go on one group list'));
      // D4: the Inventory Manager links a store item to a serial item type.
      await first('u-proc-manager'); await nav(['Procurement']);
      await p.getByRole('tab', { name: 'Store' }).click(); await p.waitForTimeout(800);
      const link = p.getByRole('button', { name: 'Link to item register' }).first();
      step('the Inventory Manager sees Link to item register', (await link.count()) > 0);
      if (await link.count()) {
        await link.scrollIntoViewIfNeeded(); await link.click(); await p.waitForTimeout(300);
        const sel = p.locator('select[aria-label^="Item register type for"]').first();
        const values = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
        step('serial item types are offered', values.length > 0, String(values.length));
        if (values.length) {
          await sel.selectOption(values[0]);
          await p.getByLabel('Why the link changes').first().fill('UAT serial tracking');
          await shot('d4-link');
          await p.getByRole('button', { name: 'Save' }).first().click(); await p.waitForTimeout(1200);
          step('the link is saved', (await p.locator('body').innerText()).includes('each unit received gets an item register ID'));
        }
      }
      step(`no page errors at ${viewport.width}px`, errors.length === 0, errors.join(' | '));
    } catch (e) {
      step(`run at ${viewport.width}px`, false, String(e && e.message || e));
      await shot('error').catch(() => {});
    }
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
