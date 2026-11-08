// Run: build the demo (cd apps/web && npx vite build --mode demo --outDir <dir>), serve it on 127.0.0.1:4179
// (npx vite preview --outDir <dir> --port 4179), then: node scripts/rba-browser-uat.cjs [screenshot-dir].
// Synthetic browser UAT of RBA readiness on the demo build (no backend, no real data): the CoS names the committee,
// a staff member signs the ethics declaration, ACT runs a trace review, and an anonymous reporter and the handler talk
// through the receipt code. Uses the pre-installed Playwright (or PLAYWRIGHT_MODULE in hosted CI).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const { openPersonaChooser } = require('./browser-persona.cjs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2];
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1400, height: 1000 }, { width: 390, height: 844 }]) {
    console.log(`\n== viewport ${viewport.width}px ==`);
    const ctx = await b.newContext({ viewport });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-11-06T09:00:00+08:00'));
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    const external = []; await p.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin === BASE) return r.continue(); if (!/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) external.push(u.origin); return r.abort(); });
    await p.goto(BASE + '/');
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); }); await p.reload();
    const as = async (who) => {
      await openPersonaChooser(p, 'Switch person');
      await p.locator('.persona', { hasText: who }).first().click(); await p.waitForTimeout(1800);
      const ok = p.getByRole('button', { name: 'I agree and will keep it confidential' }); if (await ok.count()) { await ok.click(); await p.waitForTimeout(600); }
    };
    const nav = async (name) => {
      const visible = async () => { for (const x of await p.getByRole('button', { name, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { await p.getByRole('button', { name: 'More', exact: true }).last().click(); await p.waitForTimeout(600); btn = await visible(); }
      if (!btn) throw new Error('No visible button ' + name);
      await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1400);
    };
    const tab = async (name) => { await p.getByRole('tab', { name: new RegExp('^' + name) }).click(); await p.waitForTimeout(700); };
    const page = () => p.$eval('.page', (e) => e.innerText);
    const shot = async (n) => { if (S) await p.screenshot({ path: `${S}/rba-${viewport.width}-${n}.png`, fullPage: true }); };
    try {
      // 1. The pilot sign-in list has no Chief of Staff, so the CEO opens the page and sees the committee is not named
      // (naming it is tested in core and on PostgreSQL).
      await as('Fauzan'); await nav('RBA readiness');
      step('RBA page opens with the monthly targets', /Monthly targets/.test(await page()));
      await shot('dashboard');
      await tab('Committee');
      let t = await page();
      step('committee shows not named, and only the CoS names it', /Not named yet/.test(t) && !/Name the committee/.test(t));
      // 2. A staff member signs the ethics declaration (once, on entering service).
      await as('IT Executive 3'); await nav('RBA readiness');
      t = await page();
      step('staff without an RBA role still reach the ethics declaration', /ethics declaration/i.test(t));
      for (const c of await p.locator('.page label input[type=checkbox]').all()) await c.check();
      await p.getByRole('button', { name: 'Sign', exact: true }).click(); await p.waitForTimeout(1200);
      step('staff sign the declaration', /Signed 2026-11-06/.test(await page()));
      await shot('ethics');
      // 3. ACT runs a trace review.
      await as('ACT Director'); await nav('RBA readiness'); await tab('Trace review');
      await p.getByRole('button', { name: 'Run the trace' }).click(); await p.waitForTimeout(1500);
      t = await page();
      step('ACT runs the trace review', /TR001/.test(t) && /workers/.test(t));
      await shot('trace');
      // 4. Speak-up: an anonymous report, the handler asks, the reporter answers with the code.
      await as('IT Executive 3'); await nav('Speak up and assurance');
      await p.locator('textarea').first().fill('A synthetic report: a supervisor asked guards for cash to get better shifts.');
      await p.getByRole('button', { name: 'Send report' }).click(); await p.waitForTimeout(1200);
      const code = ((await page()).match(/SU-\d{4}-[0-9A-Z]{3}/) || [])[0];
      step('reporter gets a receipt code', !!code, code || '');
      await as('ACT Director'); await nav('Speak up and assurance');
      await tab('Reports to handle');
      const line = p.locator('.list-item', { hasText: code }).first();
      await line.getByLabel('Message to the reporter').fill('Which site was this, and roughly when?');
      await line.getByRole('button', { name: 'Send to reporter' }).click(); await p.waitForTimeout(1200);
      step('handler sends a message to the reporter', /You to the reporter/.test(await line.innerText()));
      await as('IT Executive 3'); await nav('Speak up and assurance');
      await p.getByLabel('Receipt code').fill(code); await p.getByRole('button', { name: 'Check', exact: true }).click(); await p.waitForTimeout(1000);
      step('reporter reads the handler message by code', /Which site was this/.test(await page()));
      await p.getByLabel('Your answer').fill('Port Klang, the first week of October.');
      await p.getByRole('button', { name: 'Send answer' }).click(); await p.waitForTimeout(1200);
      step('reporter answers anonymously', /You:\s*Port Klang/.test(await page()));
      await shot('speakup');
    } catch (e) {
      step('journey finished', false, e.message.split('\n')[0]);
      await shot('error');
    }
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    step('no horizontal page scroll', !wide);
    step('no page errors', errors.length === 0, errors.join('; '));
    step('nothing leaves the machine (web fonts blocked)', external.length === 0, external.join(', '));
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
