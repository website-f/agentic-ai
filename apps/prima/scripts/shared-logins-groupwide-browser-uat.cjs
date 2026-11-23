// Synthetic browser UAT of the shared login list group-wide, on the demo build (no backend, no real data). Run: build
// the demo (cd apps/web && npx vite build --mode demo --outDir <dir>), serve it on 127.0.0.1:4179, then
// node scripts/shared-logins-groupwide-browser-uat.cjs <screenshot-dir>. IT adds a login for a security company, a
// central company and a central department; then each point of view (CEO, Company Manager, FWM Manager, OGM, an admin
// executive, a site officer) sees only what their job needs. The test opens every made-up staff member, not only the IT pilot people.
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
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); localStorage.setItem('prima-demo-all-staff', '1'); }); await p.reload();
    const tap = async (l) => { await l.scrollIntoViewIfNeeded().catch(() => {}); await l.click({ timeout: 3000 }).catch(() => l.evaluate((e) => e.click())); };
    const as = async (title) => {
      await openPersonaChooser(p, 'Switch person');
      await p.waitForSelector('.persona'); await tap(p.locator('.persona', { hasText: title }).first()); await p.waitForTimeout(1800);
      const ok = p.getByRole('button', { name: 'I agree and will keep it confidential' }); if (await ok.count()) { await ok.click(); await p.waitForTimeout(600); }
    };
    const findNav = async (name) => {
      const visible = async () => { for (const x of await p.getByRole('button', { name, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }).last(); if (await more.count()) { await tap(more); await p.waitForTimeout(600); btn = await visible(); } }
      return btn;
    };
    const nav = async (name) => { const btn = await findNav(name); if (!btn) throw new Error('No visible button ' + name); await tap(btn); await p.waitForTimeout(1400); };
    const listed = async () => (await p.locator('.list-item strong').allInnerTexts()).filter((t) => /\(synthetic \d+\)$/.test(t));
    const w = viewport.width;
    const tag = `(synthetic ${w})`;

    await as('IT Lead, Merdeka Network'); await nav('Shared logins');
    const across = p.locator('section', { has: p.getByRole('heading', { name: 'Across the group' }) });
    const summary = await across.innerText();
    step(`${w}: IT sees every company and department across the group`, /0 of 43 companies and 0 of 16 central/.test(summary));
    await across.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${S}/${w}-10-group-coverage.png`, fullPage: false });
    const add = async (system, scope, owner, backup, kind) => {
      await tap(p.getByRole('button', { name: 'Add a login', exact: true })); await p.waitForTimeout(400);
      await p.getByLabel('System (for example').fill(system);
      if (kind) await p.getByLabel('Kind of portal').selectOption(kind);
      if (kind === 'ewallet') { await p.getByLabel('E-wallet provider').fill("Touch 'n Go"); await p.getByLabel('Last 4 digits of each wallet').fill('4321'); }
      await p.getByLabel('Company or central department').selectOption(scope);
      const pick = async (field, name) => {
        const opts = await p.getByLabel(field).locator('option').allInnerTexts();
        await p.getByLabel(field).selectOption({ label: opts.find((t) => t.includes(name)) });
      };
      await pick('Owner of the login', owner); await pick('Backup of the login', backup);
      await tap(p.getByRole('button', { name: 'Save', exact: true })); await p.waitForTimeout(1200);
    };
    const groups = await p.getByLabel('Company or central department').locator('optgroup').evaluateAll((g) => g.map((x) => x.label)).catch(() => []);
    if (!groups.length) { await tap(p.getByRole('button', { name: 'Add a login', exact: true })); await p.waitForTimeout(400); }
    const labels = await p.getByLabel('Company or central department').locator('optgroup').evaluateAll((g) => g.map((x) => `${x.label}:${x.children.length}`));
    step(`${w}: the picker has central departments, 5 central companies and 38 security companies`, labels.includes('Central companies:5') && labels.includes('Security companies:38') && labels.some((l) => l.startsWith('Central departments:')));
    await tap(p.getByRole('button', { name: 'Cancel', exact: true }).first()); await p.waitForTimeout(300);
    await add(`SSM e-Info Sasa ${tag}`, 'c:co-sasa', 'IT Lead (mock)', 'IT Manager (mock)', 'ssm');
    await add(`SSM e-Info Goodwill ${tag}`, 'c:goodwill', 'IT Lead (mock)', 'IT Manager (mock)');
    await add(`MyIMMs ${tag}`, 'd:fwm', 'IT Lead (mock)', 'IT Manager (mock)');
    await add(`JPJ portal ${tag}`, 'd:transport', 'IT Lead (mock)', 'IT Manager (mock)');
    step(`${w}: IT added the four logins`, (await listed()).length === 4);
    const after = await across.innerText();
    step(`${w}: the group view counts them`, /2 of 43 companies and 2 of 16 central/.test(after));
    // A bank login reaching two accounts, and an e-wallet, for the same company.
    await tap(p.getByRole('button', { name: 'Add a login', exact: true })); await p.waitForTimeout(400);
    await p.getByLabel('System (for example').fill(`Maybank2E maker Sasa ${tag}`);
    await p.getByLabel('Kind of portal').selectOption('bank');
    await p.getByLabel('Bank (for example').fill('Maybank');
    await p.getByLabel('Last 4 digits of each account').fill('512345678901');
    await p.getByLabel('Company or central department').selectOption('c:co-sasa');
    for (const [field, name] of [['Owner of the login', 'IT Lead (mock)'], ['Backup of the login', 'IT Manager (mock)']]) {
      const opts = await p.getByLabel(field).locator('option').allInnerTexts();
      await p.getByLabel(field).selectOption({ label: opts.find((t) => t.includes(name)) });
    }
    await tap(p.getByRole('button', { name: 'Save', exact: true })); await p.waitForTimeout(800);
    step(`${w}: a full bank account number is refused`, /never the full number/.test(await p.innerText('body')));
    await p.getByLabel('Last 4 digits of each account').fill('1111, 2222');
    await tap(p.getByRole('button', { name: 'Save', exact: true })); await p.waitForTimeout(1200);
    const bankRow = p.locator('.list-item', { hasText: `Maybank2E maker Sasa ${tag}` }).first();
    step(`${w}: the bank login shows the bank and the last 4 digits only`, /Maybank: ••1111, ••2222/.test(await bankRow.innerText()));
    await bankRow.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${S}/${w}-14-bank-login.png`, fullPage: false });
    await add(`TNG eWallet Sasa ${tag}`, 'c:co-sasa', 'IT Lead (mock)', 'IT Manager (mock)', 'ewallet');
    const sasa = across.locator('.list-item', { hasText: 'Sasa Security Services' }).first();
    const sasaText = await sasa.innerText();
    const missingAdds = (await sasa.getByRole('button', { name: /^Add .+ for Sasa Security Services/ }).evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label')))).map((l) => l.replace(/^Add /, '').replace(/ for Sasa Security Services.*$/, ''));
    step(`${w}: Sasa shows its missing usual portals, not SSM or Bank, each with an Add button`, /Missing:/.test(sasaText) && missingAdds.includes('KDN eSIMS') && !missingAdds.includes('SSM') && !missingAdds.includes('Bank'));
    step(`${w}: Sasa counts 1 bank and 1 e-wallet login, and names Finance's bank accounts still without a login`, /1 bank · 1 e-wallet/.test(sasaText) && /Bank accounts with no login listed:[\s\S]*••\d{4}/.test(sasaText));
    await sasa.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${S}/${w}-13-missing-portals.png`, fullPage: false });
    // "Make sure it have add button to add anything more": the Add next to a missing portal opens the form filled in.
    const pickPeople = async () => {
      for (const [field, name] of [['Owner of the login', 'IT Lead (mock)'], ['Backup of the login', 'IT Manager (mock)']]) {
        const opts = await p.getByLabel(field).locator('option').allInnerTexts();
        await p.getByLabel(field).selectOption({ label: opts.find((t) => t.includes(name)) });
      }
    };
    await tap(sasa.getByRole('button', { name: 'Add KDN eSIMS for Sasa Security Services' })); await p.waitForTimeout(500);
    step(`${w}: Add next to a missing portal fills in the company and the kind`, (await p.getByLabel('Company or central department').inputValue()) === 'c:co-sasa' && (await p.getByLabel('Kind of portal').inputValue()) === 'kdn');
    await p.getByLabel('System (for example').fill(`KDN eSIMS Sasa ${tag}`); await pickPeople();
    await tap(p.getByRole('button', { name: 'Save', exact: true })); await p.waitForTimeout(1200);
    step(`${w}: after saving, Sasa no longer misses KDN eSIMS`, !/Missing: [^\n]*KDN eSIMS/.test(await across.locator('.list-item', { hasText: 'Sasa Security Services' }).first().innerText()));
    const bankBtn = across.locator('.list-item', { hasText: 'Sasa Security Services' }).first().getByRole('button', { name: /^Add a bank login for / }).first();
    const bankName = (await bankBtn.getAttribute('aria-label')) ?? '';
    await tap(bankBtn); await p.waitForTimeout(500);
    const m = /for (.*) ••(\d{4})$/.exec(bankName);
    step(`${w}: Add next to a bank account with no login fills in the bank and its last 4 digits`, !!m && (await p.getByLabel('Kind of portal').inputValue()) === 'bank' && (await p.getByLabel('Bank (for example').inputValue()) === m[1] && (await p.getByLabel('Last 4 digits of each account').inputValue()) === m[2]);
    await p.screenshot({ path: `${S}/${w}-15-add-from-gap.png`, fullPage: false });
    await tap(p.getByRole('button', { name: 'Cancel', exact: true }).first()); await p.waitForTimeout(300);
    // IT adds a new kind of portal that every security company must have; it shows as missing at once.
    await tap(p.getByRole('button', { name: 'Add a kind of portal' })); await p.waitForTimeout(400);
    await p.getByLabel('Name of the kind of portal').fill(`Majlis Daerah licence ${w}`);
    await p.getByLabel('Which companies must have a login for it').selectOption('security');
    await tap(p.getByRole('button', { name: 'Save kind' })); await p.waitForTimeout(1200);
    const sasa2 = await across.locator('.list-item', { hasText: 'Sasa Security Services' }).first().innerText();
    const gw2 = await across.locator('.list-item', { hasText: 'Goodwill Empire' }).first().innerText();
    step(`${w}: a new kind of portal can be added and shows as missing for security companies only`, sasa2.includes(`Majlis Daerah licence ${w}`) && !gw2.includes(`Majlis Daerah licence ${w}`));
    step(`${w}: the new kind is offered in the login form`, await (async () => { await tap(p.getByRole('button', { name: 'Add a login', exact: true })); await p.waitForTimeout(400); const o = await p.getByLabel('Kind of portal').locator('option').allInnerTexts(); await tap(p.getByRole('button', { name: 'Cancel', exact: true }).first()); return o.includes(`Majlis Daerah licence ${w}`); })());
    await p.locator('section', { has: p.getByRole('heading', { name: 'Kinds of portal' }) }).scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${S}/${w}-16-kinds-of-portal.png`, fullPage: false });
    await p.getByLabel('Show').selectOption('c:goodwill'); await p.waitForTimeout(400);
    step(`${w}: the filter shows one company's logins`, JSON.stringify(await listed()) === JSON.stringify([`SSM e-Info Goodwill ${tag}`]));
    await p.screenshot({ path: `${S}/${w}-11-filter-central-company.png`, fullPage: false });

    const view = async (title, expected, label) => {
      await as(title);
      const btn = await findNav('Shared logins');
      if (!btn) { step(`${w}: ${label}`, expected === null); return; }
      await tap(btn); await p.waitForTimeout(1400);
      const opened = /Logins on the list/i.test(await p.innerText('body'));
      const got = (await listed()).sort();
      step(`${w}: ${label}`, opened && expected !== null && JSON.stringify(got) === JSON.stringify(expected.map((x) => `${x} ${tag}`).sort()));
    };
    await view('Chief Executive Officer', ['SSM e-Info Sasa', 'SSM e-Info Goodwill', 'MyIMMs', 'JPJ portal', 'Maybank2E maker Sasa', 'TNG eWallet Sasa', 'KDN eSIMS Sasa'], 'the CEO sees every login');
    await view('Company Manager, Sasa Security Services', ['SSM e-Info Sasa', 'Maybank2E maker Sasa', 'TNG eWallet Sasa', 'KDN eSIMS Sasa'], 'the Sasa Company Manager sees Sasa only');
    await view('Company Manager, Arrow Shield', [], 'another Company Manager sees none of them');
    await view('FWM Manager, Foreign Worker Management', ['MyIMMs'], 'the FWM Manager sees the FWM login only');
    await view('Operations General Manager', ['SSM e-Info Goodwill'], 'the OGM sees Goodwill Empire only');
    await p.screenshot({ path: `${S}/${w}-12-ogm-view.png`, fullPage: false });
    await view('Head of Transport', ['JPJ portal'], 'the Head of Transport (named head) sees the Transport login only');
    await view('Legal Counsel', [], 'the Legal Counsel (head of Legal) sees none of these');
    await view('FWM Executive', [], 'an FWM executive not on a login sees none');
    await view('Admin Executive', [], 'a company admin executive not on a login sees none');
    await view('Site Officer, Sasa', null, 'a site officer has no shared login screen');
    step(`${w}: no page errors`, errors.length === 0);
    if (errors.length) console.log(errors.join('\n'));
    await ctx.close();
  }
  await b.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
