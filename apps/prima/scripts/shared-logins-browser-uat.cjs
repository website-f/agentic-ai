// Synthetic browser UAT of the shared login list on the demo build (no backend, no real data). Run: build the demo
// (cd apps/web && npx vite build --mode demo --outDir <dir>), serve it on 127.0.0.1:4179, then
// node scripts/shared-logins-browser-uat.cjs <screenshot-dir>. The IT Lead adds a login after a password-looking note is
// refused; the CEO sees it and records a password change.
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
    await p.clock.setFixedTime(new Date('2026-11-23T09:00:00+08:00'));
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
    await as('IT Lead (mock)'); await nav('Shared logins');
    step(`${w}: IT Lead opens the screen`, /Prima keeps the list only/.test(await p.innerText('body')));
    await p.screenshot({ path: `${S}/${w}-01-it-empty.png`, fullPage: false });
    await p.getByRole('button', { name: 'Add a login', exact: true }).click(); await p.waitForTimeout(400);
    await p.getByLabel('System (for example').fill(`Synthetic portal ${w}`);
    await p.getByLabel('Sign-in page').fill('https://portal.example.test/login');
    await p.getByLabel('Company or central department').selectOption('d:it');
    await p.getByLabel('Owner of the login').selectOption({ index: 1 });
    await p.getByLabel('Backup of the login').selectOption({ index: 2 });
    await p.getByLabel('Note (optional').fill('password: NotARealOne1');
    await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(800);
    step(`${w}: a password typed in the note is refused`, /Never type a password/.test(await p.innerText('body')));
    await p.screenshot({ path: `${S}/${w}-02-password-refused.png`, fullPage: false });
    await p.getByLabel('Note (optional').fill('Used by the IT team (synthetic)');
    await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1200);
    const item = p.locator('.list-item', { hasText: `Synthetic portal ${w}` }).first();
    step(`${w}: the login is on the list, up to date`, /Up to date/.test(await item.innerText()));
    await p.screenshot({ path: `${S}/${w}-03-on-the-list.png`, fullPage: false });
    await as('Fauzan'); await nav('Shared logins');
    const row = p.locator('.list-item', { hasText: `Synthetic portal ${w}` }).first();
    const tap = async (l) => { await l.scrollIntoViewIfNeeded().catch(() => {}); await l.click({ timeout: 3000 }).catch(() => l.evaluate((e) => e.click())); };
    await tap(row.getByRole('button', { name: 'Password changed' })); await p.waitForTimeout(300);
    await row.getByLabel('Why (for example').fill('Synthetic 90-day change');
    await p.screenshot({ path: `${S}/${w}-04-record-change.png`, fullPage: false });
    await tap(row.getByRole('button', { name: 'Save', exact: true })); await p.waitForTimeout(1200);
    step(`${w}: the change is recorded with today's date`, /Last changed 23 Nov 2026/.test(await row.innerText()));
    await p.screenshot({ path: `${S}/${w}-05-recorded.png`, fullPage: false });
    step(`${w}: no page errors`, errors.length === 0);
    await ctx.close();
  }
  await b.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
