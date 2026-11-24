// Synthetic browser UAT of the monthly reports Prima makes (Fauzan, 23 Nov 2026) on the demo build (no backend, no real
// data). Run: build the demo (cd apps/web && npx vite build --mode demo --outDir <dir>), serve it on 127.0.0.1:4179, then
// node scripts/auto-reports-browser-uat.cjs <screenshot-dir>. Turn the IT pilot persona limit off in the built page first
// (replace on:!0,area:"it" with on:!1,area:"it" in index.html), as scripts/staff-history-browser-uat.cjs does. On 1 Dec the Sasa company manager opens Reports, finds the
// November reports Prima made, keys in a note, downloads the PDF and sends one to the Director Office.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const { openPersonaChooser } = require('./browser-persona.cjs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2];
let failed = 0;
const step = (name, ok) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport, acceptDownloads: true });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-12-01T09:00:00+08:00'));
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.route('**/*', (r) => (new URL(r.request().url()).origin === BASE ? r.continue() : r.abort()));
    await p.goto(BASE + '/');
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); }); await p.reload();
    const as = async (who) => {
      // On a phone, Switch person is under More (whole-app review, 23 Nov 2026).
      const shown = async () => { for (const x of await p.getByRole('button', { name: 'Switch person', exact: true }).all()) if (await x.isVisible()) return x; return null; };
      if (!(await p.locator('.persona').first().isVisible()) && !(await shown())) { await p.getByRole('button', { name: 'More', exact: true }).last().click().catch(() => {}); await p.waitForTimeout(600); }
      if (await shown()) { await (await shown()).click(); await p.locator('.persona').first().waitFor({ state: 'visible' }); }
      else await openPersonaChooser(p, 'Switch person');
      await p.waitForSelector('.persona'); await p.locator('.persona', { hasText: who }).first().click(); await p.waitForTimeout(1800);
      const ok = p.getByRole('button', { name: 'I agree and will keep it confidential' }); if (await ok.count()) { await ok.click(); await p.waitForTimeout(600); }
    };
    const nav = async (name) => {
      const visible = async () => { for (const x of await p.getByRole('button', { name, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { await p.getByRole('button', { name: 'More', exact: true }).last().click(); await p.waitForTimeout(600); btn = await visible(); }
      if (!btn) throw new Error('No visible button ' + name);
      await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(2500);
    };
    const w = viewport.width;
    // The Director Office sets what the first company report must have and adds a part (Fauzan, 23 Nov 2026).
    await as('Nurul Huda');
    await nav('Reports');
    const dpanel = p.locator('section.panel', { hasText: 'Monthly reports made by Prima' });
    await dpanel.getByRole('button', { name: 'What each report must have' }).click(); await p.waitForTimeout(1500);
    await dpanel.locator('.list-button', { hasText: /management accounts/i }).first().click(); await p.waitForTimeout(800);
    await dpanel.locator('select').first().selectOption('must');
    await dpanel.getByRole('button', { name: 'Add a part' }).click();
    await dpanel.getByLabel('Added part 1 name').fill('Issues for the Director');
    await dpanel.getByLabel('Added part 1 what to write').fill('Anything the Director must decide');
    await dpanel.getByLabel('What changed').fill('Director wants issues each month.');
    await dpanel.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1500);
    step(`${w}: Director Office saved the report settings`, /1 must have, 0 left out, 1 added/.test(await dpanel.innerText()));
    await p.screenshot({ path: `${S}/${w}-00-report-settings.png`, fullPage: false });
    await as('Nor Azlina');
    // The Home and bell line is checked in packages/core/test/auto-reports.test.ts (the demo's long to-do list hides it here).
    await nav('Reports');
    const body = await p.innerText('body');
    step(`${w}: Reports shows the panel`, /Monthly reports made by Prima/.test(body));
    step(`${w}: November reports were made`, /November 2026/.test(body));
    const panel = p.locator('section.panel', { hasText: 'Monthly reports made by Prima' });
    await panel.scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${S}/${w}-01-made-by-prima.png`, fullPage: false });
    await panel.locator('.list-button', { hasText: /management accounts/i }).first().click(); await p.waitForTimeout(1200);
    step(`${w}: report opens with figures`, /Headcount|invoices|Shifts/.test(await panel.innerText()));
    step(`${w}: must-have and added parts shown`, /Must have/.test(await panel.innerText()) && /Issues for the Director/.test(await panel.innerText()));
    await panel.getByRole('button', { name: 'Leave out' }).first().click(); await p.waitForTimeout(1000);
    step(`${w}: owner leaves out an optional part`, /Left out/.test(await panel.innerText()));
    await panel.getByLabel('Name of your own part').fill('Client visits by the manager');
    await panel.getByRole('button', { name: 'Add part' }).click(); await p.waitForTimeout(1000);
    step(`${w}: owner adds own part`, /Your own part/.test(await panel.innerText()));
    await panel.getByRole('button', { name: 'Checked: send' }).click(); await p.waitForTimeout(1000);
    step(`${w}: send refused until must-have part is filled`, /wants these parts filled first/.test(await p.innerText('body')));
    // Key in the Director Office's added part.
    await panel.getByRole('button', { name: 'Key in' }).nth(await panel.locator('div[style*="border-left"]').evaluateAll((els) => els.filter((e) => !/Left out/.test(e.textContent || '')).findIndex((e) => /Issues for the Director/.test(e.textContent || '')))).click();
    await panel.locator('textarea').fill('Decision needed on a synthetic site rate.');
    await panel.getByRole('button', { name: 'Save note' }).click(); await p.waitForTimeout(1200);
    step(`${w}: added part keyed in`, /Note: Decision needed/.test(await panel.innerText()));
    await panel.getByRole('button', { name: 'Key in' }).last().click();
    await panel.locator('textarea').fill('Two new synthetic sites start in December.');
    await panel.getByRole('button', { name: 'Save note' }).click(); await p.waitForTimeout(1200);
    step(`${w}: note saved`, /Note: Two new synthetic sites/.test(await panel.innerText()));
    await p.screenshot({ path: `${S}/${w}-02-keyed-in.png`, fullPage: false });
    const dl = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await panel.getByRole('button', { name: 'Download PDF' }).click();
    step(`${w}: PDF downloads`, !!(await dl));
    await panel.getByRole('button', { name: 'Checked: send' }).click(); await p.waitForTimeout(1500);
    step(`${w}: sent`, /Sent by/.test(await panel.innerText()));
    await p.screenshot({ path: `${S}/${w}-03-sent.png`, fullPage: false });
    step(`${w}: no page errors`, errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }
  await b.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
