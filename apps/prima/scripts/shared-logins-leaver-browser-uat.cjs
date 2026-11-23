// Synthetic browser UAT of the leaving steps for shared logins on the demo build (no backend, no real data). Run: build
// the demo (cd apps/web && npx vite build --mode demo --outDir <dir>), serve it on 127.0.0.1:4179, then
// node scripts/shared-logins-leaver-browser-uat.cjs <screenshot-dir>. The IT Lead puts a Finance team leader on a login as
// the backup; HR opens that person's staff file, starts "Close access" and sees that login before closing; the IT Lead
// then sees the login marked for a password change.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const { openPersonaChooser } = require('./browser-persona.cjs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2];
const LEAVER = 'Finance Team Leader 1';
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
    const tap = async (l) => { await l.scrollIntoViewIfNeeded().catch(() => {}); await l.click({ timeout: 3000 }).catch(() => l.evaluate((e) => e.click())); };
    const nav = async (name) => {
      const visible = async () => { for (const x of await p.getByRole('button', { name, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { await p.getByRole('button', { name: 'More', exact: true }).last().click(); await p.waitForTimeout(600); btn = await visible(); }
      if (!btn) throw new Error('No visible button ' + name);
      await tap(btn); await p.waitForTimeout(1400);
    };
    const w = viewport.width;
    const system = `Synthetic leaver portal ${w}`;

    await as('IT Lead (mock)'); await nav('Shared logins');
    await p.getByRole('button', { name: 'Add a login', exact: true }).click(); await p.waitForTimeout(400);
    await p.getByLabel('System (for example').fill(system);
    await p.getByLabel('Sign-in page').fill('https://portal.example.test/login');
    await p.getByLabel('Company or central department').selectOption('d:it');
    await p.getByLabel('Owner of the login').selectOption({ label: await optionLabel(p, 'Owner of the login', 'IT Lead (mock)') });
    await p.getByLabel('Backup of the login').selectOption({ label: await optionLabel(p, 'Backup of the login', LEAVER) });
    await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1200);
    step(`${w}: IT Lead lists a login with a Finance team leader as backup`, /Up to date/.test(await p.locator('.list-item', { hasText: system }).first().innerText()));

    await as('PWVSB HR'); await nav('People');
    await tap(p.getByRole('button', { name: 'PWVSB central staff' })); await p.waitForTimeout(1200);
    await p.locator('#people-search').fill(LEAVER); await p.waitForTimeout(900);
    await tap(p.locator('tbody tr', { hasText: LEAVER }).first()); await p.waitForTimeout(1500);
    const account = p.locator('.list-item', { hasText: 'Prima account:' }).first();
    await account.scrollIntoViewIfNeeded();
    step(`${w}: HR opens the staff file and sees the Prima account`, await account.isVisible());
    step(`${w}: nothing about logins shows before HR starts closing`, !/Shared logins this person is on/.test(await account.innerText()));
    await tap(account.getByRole('button', { name: 'Close access' })); await p.waitForTimeout(1200);
    const text = await account.innerText();
    step(`${w}: the login shows with the person's part and the owner`, text.includes(`${system}: on it as backup. Owner IT Lead (mock)`));
    step(`${w}: HR is told the 3 working days and that IT names a new backup`, /within 3 working days/.test(text) && /IT names a new one/.test(text));
    await account.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${S}/${w}-06-hr-leaver-logins.png`, fullPage: false });
    await account.getByLabel('Reason').fill('Synthetic: resigned');
    await tap(account.getByRole('button', { name: 'Close access' }).last()); await p.waitForTimeout(1500);
    const after = await p.locator('.list-item', { hasText: 'Prima account:' }).first().innerText();
    step(`${w}: access is closed and the login list stays on the file`, /Closed from 23 Nov 2026/.test(after) && after.includes(system));
    await p.screenshot({ path: `${S}/${w}-07-hr-closed.png`, fullPage: false });

    await p.locator('.scrim').first().evaluate((e) => e.click()).catch(() => {}); await p.waitForTimeout(500);
    await as('IT Lead (mock)');
    // The IT team has no Home screen: the same reminder reaches them through the alert bell.
    await tap(p.locator('.alert-bell button').first()); await p.waitForTimeout(900);
    step(`${w}: the owner is told by the alert bell to change the password`, /shared password\(s\) to change now/.test(await p.locator('.alert-panel').innerText()));
    await p.screenshot({ path: `${S}/${w}-08-owner-alert.png`, fullPage: false });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await nav('Shared logins');
    const row = p.locator('.list-item', { hasText: system }).first();
    step(`${w}: the login is marked for a change because someone left`, /left/i.test(await row.innerText()));
    await row.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${S}/${w}-09-login-marked.png`, fullPage: false });
    step(`${w}: no page errors`, errors.length === 0);
    if (errors.length) console.log(errors.join('\n'));
    await ctx.close();
  }
  await b.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

/** The full text of the option that names this person (the pick list shows the name and the title). */
async function optionLabel(p, field, name) {
  const all = await p.getByLabel(field).locator('option').allInnerTexts();
  const hit = all.find((t) => t.includes(name));
  if (!hit) throw new Error(`${field}: no option for ${name}`);
  return hit;
}
