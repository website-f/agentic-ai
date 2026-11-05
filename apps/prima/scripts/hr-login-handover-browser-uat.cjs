// Run: build the demo (cd apps/web && npx vite build --mode demo --outDir <dir>), serve it on 127.0.0.1:4179
// (npx vite preview --outDir <dir> --port 4179), then: node scripts/hr-login-handover-browser-uat.cjs <screenshot-dir>.
// Screens in English. Uses the pre-installed Playwright. Demo build only: synthetic people, no backend, nothing leaves the machine.
//
// Synthetic browser UAT of the login handover after a transfer (Arisha main retest of 84b056e, 3 Nov 2026): HR prepares
// a transfer of an IT staff member with new pay and a private reason, the receiving head (Inas) and the CEO approve, the Chief of
// Staff authorises the login move, and an ordinary IT account (IT Executive 1) works it from the IT page. The IT account
// must see who, which account, from which company to which and from when, and never the pay or the reason; it must not
// need the HR screen; and Prima must refuse its confirmation while the account still points to the old record.
//
// The pilot sign-in list holds only the pilot people, so the receiving company head and the Chief of Staff are signed in
// by setting the demo's saved user (the same thing the persona button does). IT Executive 1 signs in by the persona button.
// Hosted CI passes its pinned Playwright as PLAYWRIGHT_MODULE (.github/workflows/ci.yml, job synthetic-browser); locally
// the pre-installed one is used. BASE_URL defaults to the local preview on 127.0.0.1:4179.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2] || '.';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const PAY = '9876';
const REASON = 'Sulit alasan peribadi sintetik';
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1400, height: 1000 }, { width: 390, height: 844 }]) {
    const tag = viewport.width;
    console.log(`\n== viewport ${tag}px ==`);
    const ctx = await b.newContext({ viewport });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    const external = []; await p.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin === BASE) return r.continue(); external.push(u.origin + u.pathname); return r.abort(); });
    await p.goto(BASE + '/');
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); }); await p.reload(); await p.waitForTimeout(1500);
    const consent = async () => { const ok = p.getByRole('button', { name: 'I agree and will keep it confidential' }); if (await ok.count()) { await ok.click(); await p.waitForTimeout(600); } };
    const asPersona = async (who) => {
      if (!(await p.locator('.persona').count())) await p.getByRole('button', { name: 'Switch person' }).first().click();
      await p.waitForSelector('.persona'); await p.locator('.persona', { hasText: who }).first().click(); await p.waitForTimeout(1800); await consent();
    };
    const asId = async (id) => { await p.evaluate((x) => localStorage.setItem('prima-demo-user', x), id); await p.reload(); await p.waitForTimeout(2200); await consent(); };
    // On a phone the More sheet can stay open over the page after a menu search; close it before working the page.
    const closeSheet = async () => {
      for (let i = 0; i < 3 && (await p.locator('.sheet[role="dialog"]').isVisible().catch(() => false)); i++) {
        await p.locator('.scrim').first().evaluate((e) => e.click()).catch(() => {}); await p.waitForTimeout(400);
      }
    };
    const visibleButton = async (names) => { for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x; return null; };
    const nav = async (...names) => {
      let btn = await visibleButton(names);
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); if (await more.count()) { await more.last().click(); await p.waitForTimeout(600); } btn = await visibleButton(names); }
      if (!btn) { await closeSheet(); return false; }
      await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1500);
      return true;
    };
    const movement = () => p.locator('section[aria-label="Staff movement"]');

    // 1. HR prepares the transfer of IT Executive 2 to Inas from today, with new pay and a private reason.
    await asId('u-pwvsb-hr'); await nav('HR monitor', 'HR');
    await movement().getByRole('button', { name: 'New movement' }).click();
    const staffSel = movement().getByLabel('Staff member', { exact: true });
    const opt = await staffSel.locator('option', { hasText: 'IT Executive 2' }).first().getAttribute('value');
    await staffSel.selectOption(opt);
    await movement().getByLabel('Movement', { exact: true }).selectOption('transfer');
    const inas = await movement().getByLabel('Other company').locator('option', { hasText: 'Inas' }).first().getAttribute('value');
    await movement().getByLabel('Other company').selectOption(inas);
    const today = await p.evaluate(() => { const d = new Date(Date.now() + 8 * 3600_000); return d.toISOString().slice(0, 10); });
    await movement().getByLabel('Takes effect on').fill(today);
    const branch = movement().getByLabel('New branch'); const bopts = await branch.locator('option').all();
    for (const o of bopts) { const v = await o.getAttribute('value'); if (v) { await branch.selectOption(v); break; } }
    await movement().getByLabel('New staff number').fill(`INAS-UAT-${tag}`);
    await movement().getByLabel('New basic pay').fill(PAY);
    await movement().getByLabel('Movement reason').fill(REASON);
    await movement().getByRole('button', { name: 'Send for approval' }).click(); await p.waitForTimeout(1500);
    step('HR prepares the transfer with new pay and a private reason', (await movement().innerText()).includes('IT Executive 2'));

    // 2. The receiving company head, then the CEO (standing in for the HR Director in the pilot), approve; it applies today.
    const approve = async (note) => {
      await closeSheet();
      const box = movement().getByLabel('Comment on IT Executive 2 (mock) movement').first();
      await box.fill(note);
      const btn = movement().getByRole('button', { name: /^Approve/ }).first(); await btn.click(); await p.waitForTimeout(1500);
    };
    await asId('u-cm-inas'); if (!(await nav('Company today'))) await nav('Company'); await movement().waitFor({ timeout: 8000 }).catch(() => {});
    await approve('Kami terima (sintetik)');
    await asPersona('Fauzan'); await nav('HR monitor', 'HR');
    await approve('Untuk Pengarah HR (sintetik)');
    let t = await movement().innerText();
    step('the transfer is approved and applied on its date', !/Not applied yet|due to apply/.test(t) && /applied \d/.test(t), (t.match(/Not applied yet[^\n]*/) ?? [''])[0]);

    // 3. The Chief of Staff (HR Director) authorises the login move from the HR screen.
    await asId('u-cos'); await nav('HR monitor', 'HR');
    await movement().getByLabel('Login comment for IT Executive 2 (mock)').fill('Pindah log masuk (sintetik)');
    await movement().getByRole('button', { name: 'Authorise login move' }).click(); await p.waitForTimeout(1500);
    step('the HR Director authorises the login move', /authorised/i.test(await movement().innerText()));

    // 4. An ordinary IT account works the handover from the IT page only.
    await asPersona('IT Executive 1');
    const hasHr = !!(await visibleButton(['HR monitor', 'HR'])) || (await (async () => { const more = p.getByRole('button', { name: 'More', exact: true }); if (!(await more.count())) return false; await more.last().click(); await p.waitForTimeout(500); const r = !!(await visibleButton(['HR monitor', 'HR'])); await p.keyboard.press('Escape'); await p.waitForTimeout(300); return r; })());
    await nav('IT'); await closeSheet();
    const panel = p.locator('section[aria-label="Login handovers"]');
    step('the IT page shows the login handover', (await panel.count()) === 1 && (await panel.innerText()).includes('IT Executive 2'));
    const pt = (await panel.innerText()) || '';
    step('the handover shows company, account and date', /Merdeka/.test(pt) && /Inas/.test(pt) && /u-it-ex2/.test(pt));
    const page = await p.$eval('.page', (e) => e.innerText);
    step('no salary or private reason anywhere on the IT page', !page.includes(PAY) && !/9,876/.test(page) && !page.includes(REASON) && !/RM\s?9/.test(pt), `HR nav visible to IT: ${hasHr}`);
    step('the staff movement panel (pay, reasons) is not on the IT page', (await movement().count()) === 0);
    await p.screenshot({ path: `${S}/it-login-handover-${tag}.png`, fullPage: false });
    // 5. Confirming before the account process moved the login is refused with the reason.
    await panel.getByLabel('Handover note for IT Executive 2 (mock)').fill('Akaun dipindah (sintetik)');
    await panel.getByRole('button', { name: 'Confirm login moved' }).click(); await p.waitForTimeout(1500);
    const after = await p.$eval('.page', (e) => e.innerText);
    step('Prima refuses the confirmation while the account still points to the old record', /still points to the old record/.test(after) && /no access to|still has access to/.test(after));
    await p.screenshot({ path: `${S}/it-login-handover-refused-${tag}.png`, fullPage: false });
    // The font stylesheet is the only outside address the page asks for; the test blocks it like everything else.
    const other = external.filter((x) => !x.startsWith('https://fonts.googleapis.com/'));
    step('no page errors; nothing but the blocked font stylesheet requested from outside', !errors.length && !other.length, [...errors, ...other].join('; '));
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
