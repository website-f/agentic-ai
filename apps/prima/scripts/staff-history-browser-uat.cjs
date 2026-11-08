// Synthetic browser UAT of the group employment history (Fauzan, 4 Nov 2026) on the demo build: no backend, no real data.
// Run: npm run build:demo -w @prima/web, then node scripts/staff-history-browser-uat.cjs <screenshot-dir> (it serves a
// test copy of apps/web/dist-demo/index.html itself). Uses the pre-installed Playwright (or PLAYWRIGHT_MODULE).
// The mock data holds one Selangor guard at Sasa who worked at Arrow Shield from 2018 to 2022 (seed.ts seedGroupHistory).
// Access per Fauzan, 4 Nov 2026: only ROM and above (and FWM management) see history, by typing the IC or passport.
if(process.env.CI_SYNTHETIC_BROWSER!=='true'||!process.env.PLAYWRIGHT_MODULE)throw Error('Synthetic browser opt-in and pinned tooling required');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const fs = require('node:fs');
// The IT pilot gate limits sign-in to pilot people, so the company heads, the OMs, the COO and the Chief of Staff are reached by
// switching the pilot flag off in a served test copy of the demo page (the shipped build is unchanged).
const DIST = process.env.DEMO_DIST || require('node:path').resolve(__dirname, '../apps/web/dist-demo/index.html');
const PORT = 4189;
const BASE = `http://127.0.0.1:${PORT}`;
const S = process.argv[2] || 'staff-history-uat';
fs.mkdirSync(S, { recursive: true });
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
(async () => {
  const html = fs.readFileSync(DIST, 'utf8');
  const patched = html.replace('on:!0,area:"it"', 'on:!1,area:"it"');
  if (patched === html) throw new Error('pilot flag not found in the demo page');
  const srv = require('node:http').createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'text/html' });
    r.end(patched);
  });
  await new Promise((res) => srv.listen(PORT, '127.0.0.1', res));
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const w = viewport.width;
    console.log(`\n== viewport ${w}px ==`);
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const external = [];
    await p.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.origin === BASE) return r.continue();
      // The page asks for its web font; it is blocked here like everything else outside the test copy.
      if (!/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) external.push(u.origin);
      return r.abort();
    });
    await p.goto(BASE + '/');
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); });
    await p.reload();
    const shot = (n) => p.screenshot({ path: `${S}/${w}-${n}.png`, fullPage: false });
    const as = async (who) => {
      await p.locator('.persona, .topbar').first().waitFor();
      if (!(await p.locator('.persona').count())) await p.getByRole('button', { name: /Switch person|Tukar user|Tukar pengguna/ }).first().click();
      await p.waitForSelector('.persona');
      await p.locator('.persona', { hasText: who }).first().click();
      await p.waitForTimeout(1800);
      const ok = p.locator('.confid-gate button');
      if (await ok.waitFor({state:'visible',timeout:3000}).then(()=>true,()=>false)) {
        await ok.click();
        await p.locator('.confid-gate').waitFor({state:'hidden'});
      }
    };
    const nav = async (names) => {
      const visible = async () => {
        for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x;
        return null;
      };
      let btn = await visible();
      if (!btn) {
        const more = p.getByRole('button', { name: 'More', exact: true });
        if (await more.count()) {
          await more.last().click();
          await p.waitForTimeout(600);
          btn = await visible();
        }
      }
      if (!btn) throw new Error('No visible button ' + names.join('/'));
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click()));
      await p.waitForTimeout(1400);
    };
    const drawerText = () => p.locator('.drawer, [role="dialog"]').last().innerText();

    // 1. HR: the history board lists the returning guard; the profile shows both employments with how each ended.
    await as('PWVSB HR');
    await nav(['HR monitor', 'HR']);
    const panel = p.locator('section[aria-label="Group employment history"]');
    await panel.scrollIntoViewIfNeeded();
    const row = panel.locator('tbody tr').first();
    const name = (await row.locator('td').first().locator('div').first().innerText()).trim();
    step('HR board lists the returning guard', /Arrow Shield/i.test(await row.innerText()) && /Sasa/i.test(await row.innerText()), name);
    await shot('01-hr-board');
    await row.click();
    await p.waitForTimeout(1200);
    let t = await drawerText();
    step('HR sees both employments, how the first ended and the suggestion', /2018/.test(t) && /30 Jun 2022|2022/.test(t) && /Terminated/.test(t) && /Suggestion/.test(t));
    step('HR sees CSG from the earlier employment, carry button offered', /CSG/.test(t) && /Carry to this record/.test(t));
    await shot('02-hr-history');
    // 2. HR marks "check first" with a reason; do not hire again is not offered to HR officers.
    await p.getByRole('button', { name: 'Rehire decision' }).click();
    const opts = await p.getByLabel('Rehire decision').locator('option').allInnerTexts();
    step('HR officer is not offered "do not hire again"', !opts.some((o) => /Do not hire/.test(o)));
    await p.getByLabel('Rehire decision').selectOption('check_first');
    await p.getByLabel('Rehire reason').fill('Ditamatkan 2022 kerana tidak hadir 5 hari; semak dengan pengurus (sintetik)');
    await p.getByRole('button', { name: 'Save decision' }).click();
    await p.waitForTimeout(1200);
    t = await drawerText();
    step('mark saved and reason kept for HR', /Check with HR before hiring/.test(t));
    await p.getByRole('button', { name: 'Carry to this record' }).first().click();
    await p.waitForTimeout(1200);
    t = await drawerText();
    step('CSG carried to the current record', !/Carry to this record/.test(t));
    await shot('03-hr-marked');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);

    // 3. Fauzan, 4 Nov 2026: company heads and OMs see no history at all, not even by number.
    const lookupBtn = () => p.getByRole('button', { name: 'Look up staff history' });
    await as('Nor Azlina');
    await nav(['Guards', 'People']);
    step('Sasa head has no lookup', (await lookupBtn().count()) === 0);
    await p.locator('#people-search').fill(name);
    await p.waitForTimeout(900);
    await p.locator('tr.clickable', { hasText: name }).first().click();
    await p.waitForTimeout(1200);
    step('Sasa head has no group history tab', (await p.getByRole('tab', { name: 'Group history' }).count()) === 0);
    await shot('04-company-head-nothing');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    await as('Azman');
    await nav(['Guards', 'People']);
    step('Selangor OM has no lookup', (await lookupBtn().count()) === 0);

    // 4. The Regional OM types the number: a summary of that one person, no reasons, the masked number only.
    const lookup = async (num) => {
      await p.getByLabel('IC or passport to look up').fill(num);
      await p.locator('section[aria-label="Look up staff history"]').getByRole('button', { name: 'Look up' }).click();
      await p.waitForTimeout(1200);
      return p.locator('[aria-label="Lookup result"]').innerText();
    };
    await as('Rajesh');
    await nav(['Guards', 'People']);
    await lookupBtn().click();
    let res = await lookup('900515-14-5051');
    step('ROM lookup: both companies, the mark, masked number only', /Arrow Shield/i.test(res) && /Sasa/i.test(res) && /Check with HR/.test(res) && /\*+5051/.test(res) && !/900515|tidak hadir|Terminated|ARSH-H-0001/.test(res));
    step('ROM lookup: no red notice yet', !/DO NOT HIRE AGAIN/.test(res));
    res = await lookup('770707-07-7777');
    step('unknown number: not found', /not found in the group/.test(res));
    await shot('05-rom-lookup');

    // 5. The HR Director marks do not hire again; the red notice shows.
    await as('Aisyah');
    await nav(['HR monitor', 'HR', 'Guards', 'People']).catch(() => {});
    const dirPanel = p.locator('section[aria-label="Group employment history"]');
    if (await dirPanel.count()) {
      await dirPanel.locator('tbody tr').first().click();
      await p.waitForTimeout(1000);
      await p.getByRole('button', { name: 'Rehire decision' }).click();
      const o2 = await p.getByLabel('Rehire decision').locator('option').allInnerTexts();
      step('HR Director is offered "do not hire again"', o2.some((o) => /Do not hire/.test(o)));
      await p.getByLabel('Rehire decision').selectOption('do_not_rehire');
      await p.getByLabel('Rehire reason').fill('Ditamatkan 2022, tidak hadir berulang kali selepas amaran (sintetik)');
      await p.getByRole('button', { name: 'Save decision' }).click();
      await p.waitForTimeout(1200);
      step('red notice on the history after the mark', /DO NOT HIRE AGAIN/.test(await drawerText()));
      await shot('06-hr-director-red-notice');
      await p.keyboard.press('Escape');
    } else step('HR Director is offered "do not hire again"', false, 'history panel not on the HR Director screen');

    // 6. The ROM now sees the red notice, still without the reason.
    await as('Rajesh');
    await nav(['Guards', 'People']);
    await lookupBtn().click();
    res = await lookup('900515-14-5051');
    step('ROM sees the red notice without the reason', /DO NOT HIRE AGAIN/.test(res) && !/tidak hadir/.test(res));
    await shot('07-rom-red-notice');

    // 7. The COO looks up, reads the reasons and may decide.
    await as('Ahmad Faisal');
    await nav(['Guards', 'People']);
    if (await lookupBtn().count()) {
      await lookupBtn().click();
      res = await lookup('900515-14-5051');
      step('COO sees the red notice and the reasons, and may decide', /DO NOT HIRE AGAIN/.test(res) && (await p.getByLabel('Lookup rehire decision').count()) === 1);
      await shot('08-coo-lookup');
    } else step('COO sees the red notice and the reasons, and may decide', false, 'no lookup button on the COO screen');

    step('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    step('nothing sent outside the test version', external.length === 0, [...new Set(external)].join(', '));
    await ctx.close();
  }
  await b.close();
  srv.close();
  fs.writeFileSync(`${S}/results.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
