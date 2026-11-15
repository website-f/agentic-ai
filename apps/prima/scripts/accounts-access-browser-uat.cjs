// Synthetic browser UAT of Accounts and Access on the demo build (no backend, no real data). Run: build the demo
// (cd apps/web && npx vite build --mode demo --outDir <dir>), serve it on 127.0.0.1:4179, then
// node scripts/accounts-access-browser-uat.cjs <screenshot-dir>. The IT Lead prepares one new account, the CEO (the
// demo shows pilot people only) approves it with a comment, and the new account appears in the list.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const { openPersonaChooser } = require('./browser-persona.cjs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2];
let failed = 0;
const step = (name, ok) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-11-16T09:00:00+08:00'));
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.route('**/*', (r) => (new URL(r.request().url()).origin === BASE ? r.continue() : r.abort()));
    await p.goto(BASE + '/');
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); }); await p.reload();
    const as = async (who) => {
      await openPersonaChooser(p, 'Switch person');
      await p.waitForSelector('.persona'); await p.locator('.persona', { hasText: who }).first().click(); await p.waitForTimeout(1800);
      const ok = p.getByRole('button', { name: 'I agree and will keep it confidential' }); if (await ok.count()) { await ok.click(); await p.waitForTimeout(600); }
    };
    const nav = async (name) => {
      const visible = async () => { for (const x of await p.getByRole('button', { name, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { await p.getByRole('button', { name: 'More', exact: true }).last().click(); await p.waitForTimeout(600); btn = await visible(); }
      if (!btn) throw new Error('No visible button ' + name);
      await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1400);
    };
    const w = viewport.width;
    await as('IT Lead (mock)'); await nav('Accounts and access');
    step(`${w}: IT Lead opens the screen`, /Everyone with an account/.test(await p.innerText('body')));
    await p.screenshot({ path: `${S}/${w}-01-it-board.png`, fullPage: false });
    await p.getByLabel('Full name').fill('Nur Synthetic binti Test');
    await p.getByLabel('Job title').fill('Admin Executive');
    await p.getByLabel('Company of the new account').selectOption({ index: 1 });
    await p.getByLabel('Microsoft object ID', { exact: true }).first().fill('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    await p.getByRole('button', { name: 'Add to the request' }).first().click(); await p.waitForTimeout(400);
    await p.getByLabel('Why').fill('Synthetic office staff starting 18 Nov');
    await p.screenshot({ path: `${S}/${w}-02-it-request.png`, fullPage: false });
    await p.getByRole('button', { name: 'Send for approval' }).click(); await p.waitForTimeout(1200);
    step(`${w}: request is waiting`, /waiting/.test(await p.innerText('body')));
    await as('Fauzan'); await nav('Accounts and access');
    const req = p.locator('.hx-row', { hasText: 'Synthetic office staff starting 18 Nov' }).first();
    await req.getByRole('button', { name: 'Approve' }).click(); await p.waitForTimeout(800);
    step(`${w}: approval without a comment is refused`, /comment/i.test(await p.innerText('body')));
    await req.getByLabel('Comment').fill('Checked against the synthetic list');
    await p.screenshot({ path: `${S}/${w}-03-ceo-approve.png`, fullPage: false });
    await req.getByRole('button', { name: 'Approve' }).click(); await p.waitForTimeout(1500);
    const t = await p.innerText('body');
    step(`${w}: approved and the account is listed`, /approved by Fauzan/.test(t) && /Nur Synthetic binti Test/.test(t));
    await p.screenshot({ path: `${S}/${w}-04-approved.png`, fullPage: false });
    step(`${w}: no page errors`, errors.length === 0);
    await ctx.close();
  }
  await b.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
