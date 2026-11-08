// Run: build the demo (npm run build:demo -w @prima/web), serve apps/web/dist-demo on 127.0.0.1:4179
// (npx vite preview --outDir dist-demo --port 4179 from apps/web), then: node scripts/hr-languages-appeal-browser-uat.cjs <screenshot-dir>.
// Synthetic browser UAT of policy languages and discipline appeals (IKEA IWAY finding, Fauzan 6 Nov 2026) on the demo
// build: no backend, made-up people, nothing leaves the machine. Uses the pre-installed Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2] || '.';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    console.log(`\n== viewport ${viewport.width}px ==`);
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    const external = []; await p.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin === BASE) return r.continue(); external.push(u.origin + u.pathname); return r.abort(); });
    await p.addInitScript(() => { try { if (!sessionStorage.getItem('uat-init')) { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); sessionStorage.setItem('uat-init', '1'); } } catch {} });
    await p.goto(BASE + '/');
    const shot = (n) => p.screenshot({ path: `${S}/${viewport.width}-${n}.png`, fullPage: false });
    // The demo lists only pilot sign-ins; other synthetic people are opened by their demo user id.
    const as = async (id) => {
      await p.evaluate((x) => localStorage.setItem('prima-demo-user', x), id); await p.reload(); await p.waitForTimeout(2200);
      const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ }); if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(600); }
    };
    const nav = async (names) => {
      const visible = async () => { for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); if (await more.count()) { await more.last().click(); await p.waitForTimeout(600); btn = await visible(); } }
      if (!btn) throw new Error('No visible button ' + names.join('/'));
      await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1400);
    };
    const panel = (h) => p.locator('section.panel', { has: p.getByRole('heading', { name: h, exact: true }) }).first();
    const TITLE = `Guard code of conduct UAT ${viewport.width} (mock)`;

    // 1. HR publishes in English and Malay; English alone is not enough.
    await as('u-pwvsb-hr'); await nav(['HR monitor', 'HR']);
    const pol = panel('Handbook and policies'); await pol.scrollIntoViewIfNeeded();
    await pol.getByLabel('Policy kind').selectOption('code_of_conduct');
    await pol.getByLabel('Who must read it').selectOption('guards');
    await pol.getByLabel('Policy title').fill(TITLE);
    await pol.getByLabel('Policy text').fill('Be at your post on time, in uniform, and report every incident (mock text).');
    const publish = pol.getByRole('button', { name: 'Publish', exact: true });
    step('Publish stays off without the Malay copy', await publish.isDisabled());
    await pol.getByLabel('Malay title').fill('Kod kelakuan pengawal (mock)');
    await pol.getByLabel('Malay text', { exact: true }).fill('Berada di pos tepat pada masanya, beruniform, dan laporkan setiap insiden (mock).');
    await pol.getByLabel('Malay copy translated by').fill('HR (mock)');
    await shot('01-hr-publish-form');
    await publish.click(); await p.waitForTimeout(1200);
    let row = pol.locator('.list-item', { hasText: TITLE }).first();
    let t = await row.innerText();
    step('HR sees English and Malay copies and the missing Nepali copy', /Bahasa Melayu/.test(t) && /Nepali[^\n]*missing/.test(t), t.replace(/\s+/g, ' ').slice(0, 200));
    await row.scrollIntoViewIfNeeded(); await shot('02-hr-nepali-missing');

    // 2. HR adds the Nepali translation; the gap goes.
    await row.getByRole('button', { name: 'Add translation' }).click(); await p.waitForTimeout(300);
    await row.getByLabel('Translation language').selectOption('ne');
    await row.getByLabel('Translated title').fill('गार्ड आचार संहिता (mock)');
    await row.getByLabel('Translated by').fill('Translator A (mock)');
    await row.getByLabel('Translated text').fill('समयमै पोस्टमा पुग्नुहोस्, वर्दीमा रहनुहोस्, र हरेक घटना रिपोर्ट गर्नुहोस् (mock).');
    await shot('03-hr-add-nepali');
    await row.getByRole('button', { name: 'Save translation' }).click(); await p.waitForTimeout(1200);
    row = pol.locator('.list-item', { hasText: TITLE }).first(); t = await row.innerText();
    step('the Nepali copy is listed and no longer missing', /Nepali/.test(t) && !/Nepali[^\n]*missing/.test(t), t.replace(/\s+/g, ' ').slice(0, 200));

    // 3. The Nepali guard reads it in Nepali by default and signs.
    await as('u-guard-sasa-2');
    const mine = panel('Policies to read'); await mine.waitFor({ timeout: 5000 }).catch(() => {});
    const mrow = mine.locator('.list-item', { hasText: 'गार्ड आचार संहिता' }).first();
    step('the guard sees the Nepali title', (await mrow.count()) > 0);
    await mrow.getByRole('button', { name: 'Read', exact: true }).click(); await p.waitForTimeout(300);
    step('Nepali is chosen and the Nepali text shows', (await mrow.getByLabel('Language').inputValue()) === 'ne' && /घटना/.test(await mrow.innerText()));
    await mrow.scrollIntoViewIfNeeded(); await shot('04-guard-reads-nepali');
    await mrow.getByRole('button', { name: 'I have read and understood it' }).click(); await p.waitForTimeout(1200);
    t = await mine.innerText().catch(() => '');
    step('the guard acknowledgement records Nepali', /acknowledged \(Nepali/.test(t), t.replace(/\s+/g, ' ').slice(0, 160));
    await shot('05-guard-signed-nepali');

    // 4. The guard appeals the verbal warning on their own sign-in.
    await p.getByRole('tab', { name: 'My details' }).click(); await p.waitForTimeout(500);
    await p.getByRole('tab', { name: 'Warnings' }).click(); await p.waitForTimeout(600);
    const warn = p.locator('.list-item', { hasText: 'Left the post 40 minutes' }).first();
    t = await warn.innerText();
    step('the guard sees the appeal window on the warning', /You may appeal by/.test(t), t.replace(/\s+/g, ' ').slice(0, 160));
    await warn.getByRole('button', { name: 'Appeal', exact: true }).click(); await p.waitForTimeout(300);
    await warn.getByLabel('Grounds of appeal').fill('रिलिभर पहिले नै आइपुगेका थिए, सुपरभाइजरलाई थाहा थियो (mock)');
    await shot('06-guard-appeal-form');
    await warn.getByRole('button', { name: 'Send appeal' }).click(); await p.waitForTimeout(1200);
    t = await p.locator('.list-item', { hasText: 'Left the post 40 minutes' }).first().innerText();
    step('the appeal is lodged in Nepali and waits for the HR Director', /by the guard/.test(t) && /Nepali/.test(t) && /waiting for HR Director/.test(t), t.replace(/\s+/g, ' ').slice(0, 200));
    await shot('07-guard-appeal-sent');

    // 5. The company manager cannot decide; the Deputy CoS (HR Director) overturns with reasons.
    await as('u-dcos'); await nav(['HR monitor', 'HR']);
    const ap = panel('Guard discipline appeals'); await ap.scrollIntoViewIfNeeded();
    const arow = ap.locator('.list-item', { hasText: 'Bikash Gurung' }).first();
    step('the HR Director sees the appeal to decide', (await arow.getByRole('button', { name: 'Decide appeal' }).count()) > 0);
    await arow.getByLabel('Appeal decision', { exact: true }).selectOption('overturned');
    await arow.getByLabel('Reasons for the appeal decision').fill('Relief log shows the relief guard arrived early; warning set aside (mock).');
    await shot('08-hrd-decide');
    await arow.getByRole('button', { name: 'Decide appeal' }).click(); await p.waitForTimeout(1200);
    t = await ap.locator('.list-item', { hasText: 'Bikash Gurung' }).first().innerText();
    step('the appeal shows Overturned with reasons', /Overturned/.test(t) && /Relief log/.test(t), t.replace(/\s+/g, ' ').slice(0, 200));
    await shot('09-hrd-overturned');

    // 6. Same guard screen in Bahasa Melayu (the staff default).
    await as('u-guard-sasa-2');
    await p.evaluate(() => localStorage.setItem('prima.lang', 'ms')); await p.reload(); await p.waitForTimeout(1500);
    await p.getByRole('tab', { name: /Butiran saya|My details/ }).click().catch(() => {}); await p.waitForTimeout(400);
    await p.getByRole('tab', { name: /Amaran|Warnings/ }).click().catch(() => {}); await p.waitForTimeout(500);
    t = await p.$eval('.page', (e) => e.innerText).catch(() => '');
    step('the decided appeal shows in Bahasa Melayu', /Dibatalkan/.test(t), '');
    await shot('10-guard-bm-overturned');
    await p.evaluate(() => localStorage.setItem('prima.lang', 'en'));

    step('no page errors', errors.length === 0, errors.slice(0, 2).join(' / '));
    step('no request left this machine except blocked web fonts', external.every((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), [...new Set(external)].join(' '));
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
