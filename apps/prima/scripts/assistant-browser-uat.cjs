// Run: build the demo (npm run build:demo -w @prima/web), serve apps/web/dist-demo on 127.0.0.1:4179
// (npx vite preview --mode demo --outDir dist-demo --host 127.0.0.1 --port 4179 --strictPort from apps/web), then:
// node scripts/assistant-browser-uat.cjs <screenshot-dir>.
// Synthetic browser UAT of the Prima helper (Fauzan, 23 Nov 2026): the Inventory Manager types the OGM's instruction in
// plain words, the helper fills the site supplies request from Prima's own lists, the person checks it and presses
// Send, saves it as a team skill, and the skill fills the next one; the person's style is theirs to set and clear; a
// person who may not start supplies requests is not offered the job. Made-up data; the demo build has no backend;
// nothing leaves the machine. Uses the pre-installed Playwright.
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
    const click = (loc) => loc.click({ timeout: 3000 }).catch(() => loc.evaluate((e) => e.click()));
    const nav = async (names) => {
      const visible = async () => { for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); if (await more.count()) { await more.last().click(); await p.waitForTimeout(600); btn = await visible(); } }
      if (!btn) return false;
      await click(btn); await p.waitForTimeout(1400);
      return true;
    };
    const as = async (id) => {
      await p.evaluate((x) => localStorage.setItem('prima-demo-user', x), id); await p.reload(); await p.waitForTimeout(2200);
      const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ }); if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(600); }
    };
    const ask = async (text) => {
      await p.getByLabel('What do you need?').fill(text);
      await click(p.getByRole('button', { name: 'Fill the form', exact: true })); await p.waitForTimeout(1200);
    };

    // 1. The Inventory Manager types the OGM's instruction.
    await as('u-proc-manager');
    step('the Inventory Manager has the Helper in the menu', await nav(['Helper']));
    await p.getByRole('heading', { name: 'Prima helper', exact: true }).waitFor({ timeout: 8000 });
    await ask('OGM asks for 5 seluar saiz 32 for Pusat Perubatan Bukit Bintang 11');
    step('the helper picks the site supplies request', (await p.getByLabel('Job', { exact: true }).inputValue()) === 'site-supplies');
    step('the site is filled from Prima\'s own list', (await p.getByLabel('Site', { exact: true }).inputValue()) === 'st-sasa-011');
    const item = await p.getByLabel('Item 1', { exact: true }).locator('option:checked').innerText().catch(() => '');
    step('"seluar saiz 32" is read as the store\'s trousers size 32, quantity 5', /trousers/i.test(item) && /32/.test(item) && (await p.getByLabel('Quantity 1', { exact: true }).inputValue()) === '5', item);
    step('each filled box says where it came from', (await p.getByText('(from your words)').count()) >= 2);
    step('nothing is sent before Send', (await p.getByText('Sent.', { exact: false }).count()) === 0);
    await shot('01-filled');
    // Send without the receiving OM: the same check as the request screen.
    await click(p.getByRole('button', { name: 'Send', exact: true })); await p.waitForTimeout(900);
    step('the server\'s own check applies (the OM who receives must be chosen)', (await p.getByText(/Choose the OM or Regional OM/).count()) > 0);
    await p.getByLabel('OM who receives at the site', { exact: true }).selectOption({ index: 1 });
    await click(p.getByRole('button', { name: 'Send', exact: true })); await p.waitForTimeout(1200);
    step('Send makes the request, with its number', (await p.getByText(/Sent\.\s*PKK-\d{8}-\d{3}/).count()) > 0);
    await shot('02-sent');
    // Save it as a team skill.
    await p.getByLabel('Skill name', { exact: true }).fill('New site start-up');
    await p.getByLabel('Words that call it up', { exact: true }).fill('tapak baharu, new site');
    await p.getByLabel('For whom', { exact: true }).selectOption('dept:procurement');
    await click(p.getByRole('button', { name: 'Save skill', exact: true })); await p.waitForTimeout(1000);
    step('the skill is in the library', (await p.getByText('New site start-up', { exact: true }).count()) > 0);
    await ask('new site: 2 seluar saiz 34 for Pusat Perubatan Bukit Bintang 11');
    step('the next instruction uses the skill', (await p.getByText(/Skill used: New site start-up/).count()) > 0);
    step('the skill keeps the choices (for a new site, same site)', (await p.getByLabel('For a new site', { exact: true }).isChecked()) && (await p.getByLabel('Site', { exact: true }).inputValue()) === 'st-sasa-011');
    step('a size the store does not have is not swapped for another size: it is left for the person', (await p.getByLabel('Item 1', { exact: true }).count()) === 0 && (await p.getByText(/Still to fill:.*Items and quantity/).count()) > 0);
    await shot('03-skill');
    // Style: own only, and cleared on request.
    const so = p.getByLabel('My sign-off', { exact: true });
    await so.fill('Terima kasih'); await so.blur(); await p.waitForTimeout(900);
    step('the person sets their own sign-off', (await p.getByText(/Sign-off: Terima kasih/).count()) > 0);
    await click(p.getByRole('button', { name: 'Clear what it learned about me', exact: true })); await p.waitForTimeout(900);
    step('the person clears what it learned', (await p.getByText(/Sign-off: —/).count()) > 0);
    const body = await p.locator('main').innerText().catch(() => '');
    step('the screen names no AI product', !/claude|openai|chatgpt|gpt|anthropic|gemini/i.test(body));

    // 2. Someone who may not start supplies requests.
    await as('u-transport');
    step('Transport has the Helper too', await nav(['Helper']));
    await ask('Laptop rosak, segera');
    const jobs = await p.getByLabel('Job', { exact: true }).locator('option').allInnerTexts();
    step('Transport is not offered the site supplies request', !jobs.some((x) => /site supplies/i.test(x)) && jobs.length > 2, jobs.join(' | ').slice(0, 160));
    step('a broken laptop is an IT help request, urgent, about a device', (await p.getByLabel('Job', { exact: true }).inputValue()) === 'it-help' && (await p.getByLabel('About', { exact: true }).inputValue()) === 'DEVICE' && (await p.getByLabel('How urgent', { exact: true }).inputValue()) === 'P2');
    await shot('04-it-help');

    // 3. A Company Manager: an office bill, and leave for one of the company's guards (Fauzan, 23 Nov 2026: "Build").
    await as('u-cm-sasa');
    step('the Company Manager has the Helper', await nav(['Helper']));
    await ask('Bil elektrik pejabat November RM 420');
    step('an office bill is an office request', (await p.getByLabel('Job', { exact: true }).inputValue()) === 'office-request');
    step('the month and the amount come from the words; the only company is suggested', (await p.getByLabel('Month', { exact: true }).inputValue()) === '2026-11' && (await p.getByLabel('Amount (RM)', { exact: true }).inputValue()) === '420' && (await p.getByLabel('Company', { exact: true }).inputValue()) === 'co-sasa', await p.getByLabel('Month', { exact: true }).inputValue());
    step('a place to attach the bill is shown', (await p.getByLabel('Receipt, quotation or bill', { exact: true }).count()) > 0);
    await click(p.getByRole('button', { name: 'Send', exact: true })); await p.waitForTimeout(1200);
    step('without the bill it is kept as a draft, not submitted', (await p.getByText(/draft: attach the bill/).count()) > 0);
    await shot('05-office');
    await ask('Masukkan cuti tahunan untuk pengawal esok hingga lusa');
    step('leave for a guard is the leave-for job', (await p.getByLabel('Job', { exact: true }).inputValue()) === 'leave-for');
    const people = await p.getByLabel('Guard or staff member', { exact: true }).locator('option').count();
    step('the company\'s own staff are offered to choose from', people > 2, String(people));
    await p.getByLabel('Guard or staff member', { exact: true }).selectOption({ index: 1 });
    await click(p.getByRole('button', { name: 'Send', exact: true })); await p.waitForTimeout(1200);
    step('Send enters the leave for that person', (await p.getByText(/^Sent\./).count()) > 0 || (await p.getByText('Sent.', { exact: false }).count()) > 0);
    await shot('06-leave-for');

    step('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
    step('no request left this machine except blocked web fonts', external.every((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), [...new Set(external)].join(', ').slice(0, 200));
    await ctx.close();
  }
  await b.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
