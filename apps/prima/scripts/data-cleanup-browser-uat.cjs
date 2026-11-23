// Run: build the demo (npm run build:demo -w @prima/web), serve apps/web/dist-demo on 127.0.0.1:4179
// (npx vite preview --mode demo --outDir dist-demo --host 127.0.0.1 --port 4179 --strictPort from apps/web), then:
// node scripts/data-cleanup-browser-uat.cjs <screenshot-dir>.
// Synthetic browser UAT of the data clean-up checker (Part AG, AG15): a company manager sees only their own company's
// records by number, central HR sees staff lines only, the Finance Director (group leader) sees every company. Made-up
// data; the demo build has no backend; nothing leaves the machine. Uses the pre-installed Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2] || '.';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const companyOf = (t) => t.split(' · ')[0].trim();

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
    const nav = async (names) => {
      const visible = async () => { for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); if (await more.count()) { await more.last().click(); await p.waitForTimeout(600); btn = await visible(); } }
      if (!btn) return false;
      await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1400);
      return true;
    };
    const as = async (id) => {
      await p.evaluate((x) => localStorage.setItem('prima-demo-user', x), id); await p.reload(); await p.waitForTimeout(2200);
      const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ }); if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(600); }
    };
    const lines = () => p.locator('section.panel li').allInnerTexts();
    const heads = async () => (await p.locator('section.panel h3').allInnerTexts()).slice(1);

    // 1. Company manager of Sasa: own company only, by record number.
    await as('u-cm-sasa');
    step('the company manager has Data clean-up in the menu', await nav(['Data clean-up']));
    await p.getByRole('heading', { name: 'Data clean-up', exact: true }).waitFor({ timeout: 8000 });
    let l = await lines();
    step('every line belongs to the company manager\'s own company', l.length > 0 && new Set(l.map(companyOf)).size === 1, `${l.length} lines, ${[...new Set(l.map(companyOf))].join(',')}`);
    step('each problem says how to fix it', (await p.getByText('How to fix:').count()) > 0);
    await shot('01-company-manager');
    await p.getByRole('tab', { name: 'Contracts', exact: true }).click(); await p.waitForTimeout(900);
    let h = await heads();
    step('the Contracts tab shows contract problems only', h.every((x) => /contract/i.test(x)), h.join(' | ').slice(0, 160));

    // 2. Central HR: staff lines only, from every company.
    await as('u-pwvsb-hr');
    step('central HR has Data clean-up in the menu', await nav(['Data clean-up']));
    await p.getByRole('heading', { name: 'Data clean-up', exact: true }).waitFor({ timeout: 8000 });
    h = await heads();
    step('central HR sees staff problems only', h.length > 0 && !h.some((x) => /site has|contract/i.test(x)), h.join(' | ').slice(0, 200));
    await shot('02-central-hr');

    // 3. Finance Director (group leader): every company, with a company picker.
    await as('u-fd');
    step('the Finance Director has Data clean-up in the menu', await nav(['Data clean-up']));
    await p.getByRole('heading', { name: 'Data clean-up', exact: true }).waitFor({ timeout: 8000 });
    l = await lines();
    step('a group leader sees more than one company', new Set(l.map(companyOf)).size > 1, [...new Set(l.map(companyOf))].join(','));
    const pick = p.getByLabel('Show company');
    await pick.selectOption({ index: 1 }); await p.waitForTimeout(900);
    l = await lines();
    step('choosing a company narrows the list to it', l.length > 0 && new Set(l.map(companyOf)).size === 1, `${l.length} lines`);
    await shot('03-group-leader');

    // 4. Not for everyone.
    await as('u-transport');
    step('Transport has no Data clean-up', !(await nav(['Data clean-up'])));

    step('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
    step('no request left this machine except blocked web fonts', external.every((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), [...new Set(external)].join(', ').slice(0, 200));
    await ctx.close();
  }
  await b.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
