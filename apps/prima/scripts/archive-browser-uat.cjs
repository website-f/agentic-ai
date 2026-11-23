// Run: build the demo (npm run build:demo -w @prima/web), serve apps/web/dist-demo on 127.0.0.1:4179
// (npx vite preview --mode demo --outDir dist-demo --host 127.0.0.1 --port 4179 --strictPort from apps/web), then:
// node scripts/archive-browser-uat.cjs <screenshot-dir>.
// Synthetic browser UAT of the data and file manager (Fauzan, 23 Nov 2026: "Do also a data and file manager. As staff
// upload all old data we have, even the hard copy scan to computer") on the demo build: no backend, files kept in
// memory, made-up people and papers, nothing leaves the machine. Photos and PDFs are kept but not read in the demo
// (the text and PDF readers ship with the server build). Uses the pre-installed Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const { deflateRawSync } = require('node:zlib');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2] || '.';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

function docx(xml) {
  const name = Buffer.from('word/document.xml'); const raw = Buffer.from(xml); const data = deflateRawSync(raw);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, cd, name, end]);
}
const P = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const INVOICE = docx(`<w:document xmlns:w="x"><w:body>${P('TAX INVOICE (mock)')}${P('Syarikat Contoh UAT Sdn Bhd')}${P('Date: 14/03/2021')}${P('Grand Total RM 3,480.00')}</w:body></w:document>`);
const PAYSLIP = Buffer.from('SLIP GAJI (mock)\nKWSP 11%\nTarikh: 31/05/2019\nNama: Pekerja Contoh\n');
// A scan larger than one piece, so the upload really travels in pieces.
const SCAN = Buffer.concat([Buffer.from('%PDF-1.4 synthetic scan\n'), Buffer.alloc(1_700_000, 0x20)]);

(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    console.log(`\n== viewport ${viewport.width}px ==`);
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    const external = []; await p.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin === BASE || u.protocol === 'blob:') return r.continue(); external.push(u.origin + u.pathname); return r.abort(); });
    await p.addInitScript(() => { try { if (!sessionStorage.getItem('uat-init')) { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); sessionStorage.setItem('uat-init', '1'); } } catch {} });
    await p.goto(BASE + '/');
    const shot = (n) => p.screenshot({ path: `${S}/${viewport.width}-${n}.png`, fullPage: false });
    const nav = async (names) => {
      const visible = async () => { for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x; return null; };
      let btn = await visible();
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); if (await more.count()) { await more.last().click(); await p.waitForTimeout(600); btn = await visible(); } }
      if (!btn) throw new Error('No visible button ' + names.join('/'));
      await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1200);
    };
    const first = async (id) => {
      await p.evaluate((x) => localStorage.setItem('prima-demo-user', x), id); await p.reload(); await p.waitForTimeout(2200);
      const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ }); if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(600); }
    };
    const panel = (h) => p.locator('section.panel', { has: p.getByRole('heading', { name: h, exact: true }) }).first();

    // 1. Finance adds three old files at once; the rules suggest the folder, date and title.
    await first('u-finance-am'); await nav(['Old files and data']);
    const addP = panel('Add files');
    await addP.getByLabel('Files to add').setInputFiles([
      { name: 'INV_2021-0457_Syarikat_Contoh.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: INVOICE },
      { name: 'scan0012.txt', mimeType: 'text/plain', buffer: PAYSLIP },
      { name: 'lesen KDN 2020 scan.pdf', mimeType: 'application/pdf', buffer: SCAN },
    ]);
    await p.waitForTimeout(1500);
    step('the invoice is suggested for Finance with its date', (await addP.getByLabel('Folder for INV_2021-0457_Syarikat_Contoh.docx').inputValue()) === 'finance' && (await addP.getByLabel('Date on INV_2021-0457_Syarikat_Contoh.docx').inputValue()) === '2021-03-14');
    step('the payslip is suggested for the restricted pay folder', (await addP.getByLabel('Folder for scan0012.txt').inputValue()) === 'pay' && (await addP.getByText('Restricted').count()) >= 1);
    step('the licence scan is suggested for Licences from its name', (await addP.getByLabel('Folder for lesen KDN 2020 scan.pdf').inputValue()) === 'licences');
    await addP.getByLabel('Title for scan0012.txt').fill('Payslip May 2019 (mock)');
    await addP.getByLabel('Checked INV_2021-0457_Syarikat_Contoh.docx').check();
    await addP.getByLabel('Checked scan0012.txt').check();
    await addP.scrollIntoViewIfNeeded(); await shot('01-add-three-files');
    await addP.getByRole('button', { name: /Save all/ }).click();
    await addP.getByText('Saved').nth(2).waitFor({ timeout: 20000 });
    step('all three files are saved, the big scan in pieces', (await addP.getByText('Saved').count()) === 3);

    // 2. The same file again is a duplicate, not a second copy.
    await addP.getByLabel('Files to add').setInputFiles([{ name: 'copy of invoice.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: INVOICE }]);
    await p.waitForTimeout(1200);
    await addP.getByRole('button', { name: /Save all/ }).click();
    await addP.getByText(/Already kept/).first().waitFor({ timeout: 10000 });
    step('the same file added again is marked already kept', true);

    // 3. Find by words inside the document; the unchecked scan waits under To check.
    const find = panel('Find a file');
    await find.getByLabel('Find a file').fill('syarikat contoh uat'); await find.getByRole('button', { name: 'Find', exact: true }).click(); await p.waitForTimeout(900);
    let t = await find.locator('.list').innerText();
    step('a file is found by words inside the document', /INV 2021-0457 Syarikat Contoh/.test(t) && !/Payslip/.test(t), t.replace(/\s+/g, ' ').slice(0, 160));
    await find.getByLabel('Find a file').fill(''); await find.getByRole('button', { name: 'Find', exact: true }).click(); await p.waitForTimeout(600);
    await find.getByRole('tab', { name: /To check/ }).click(); await p.waitForTimeout(900);
    t = await find.locator('.list').innerText();
    step('the scan saved without a check waits under To check', /lesen KDN 2020 scan/.test(t) && !/INV 2021/.test(t));
    await find.scrollIntoViewIfNeeded(); await shot('02-to-check');
    await find.getByRole('button', { name: /Checked/ }).first().click(); await p.waitForTimeout(900);
    step('after the check nothing waits', /No files/.test(await find.locator('.list').innerText()));

    // 4. Open gives the same bytes back.
    await find.getByRole('tab', { name: 'All', exact: true }).click(); await p.waitForTimeout(900);
    const row = find.locator('.list-item', { hasText: 'INV 2021-0457' }).first();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), row.getByRole('button', { name: 'Open', exact: true }).click()]);
    const got = require('node:fs').readFileSync(await dl.path());
    step('Open hands back the same file', got.equals(INVOICE) && dl.suggestedFilename() === 'INV_2021-0457_Syarikat_Contoh.docx');

    // A big scan comes back whole from its pieces.
    const bigRow = find.locator('.list-item', { hasText: 'lesen KDN 2020 scan' }).first();
    // On a phone the last row sits behind the bottom menu until the person scrolls; the test presses it directly.
    const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), bigRow.getByRole('button', { name: /^Open/ }).evaluate((e) => e.click())]);
    step('a big scan is handed back whole from its pieces', require('node:fs').readFileSync(await dl2.path()).equals(SCAN));

    // 5. Set aside with a reason: it leaves the list and stays under Set aside.
    await row.getByRole('button', { name: 'Set aside', exact: true }).click();
    await row.getByLabel('Reason to set aside').fill('Belongs to another company (mock)');
    await row.getByRole('button', { name: 'Set aside', exact: true }).last().click(); await p.waitForTimeout(900);
    step('a file set aside leaves the list', !/INV 2021-0457/.test(await find.locator('.list').innerText()));
    await find.getByRole('tab', { name: 'Set aside', exact: true }).click(); await p.waitForTimeout(900);
    step('and stays on record with its reason', /Belongs to another company/.test(await find.locator('.list').innerText()));
    await shot('03-set-aside');

    step('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
    step('no request left this machine except blocked web fonts', external.every((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), [...new Set(external)].join(', ').slice(0, 200));
    await ctx.close();
  }
  await b.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
