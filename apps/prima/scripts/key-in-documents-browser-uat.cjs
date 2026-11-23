// Run: build the demo (npm run build:demo -w @prima/web), serve apps/web/dist-demo on 127.0.0.1:4179
// (npx vite preview --mode demo --outDir dist-demo --host 127.0.0.1 --port 4179 --strictPort from apps/web), then:
// node scripts/key-in-documents-browser-uat.cjs <screenshot-dir>.
// Synthetic browser UAT of "Isi automatik" reading documents on a real form (Fauzan, 23 Nov 2026: "Make it read all
// type of document"): Transport records a fill-up from a Word receipt and from a text receipt; a company manager's
// KDN renewal EPF statement gives its months (AG21). The demo build has no
// backend and no online reader; made-up data; nothing leaves the machine. Photos and PDFs need the text and PDF
// readers of the server build and are not part of this journey. Uses the pre-installed Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const { deflateRawSync } = require('node:zlib');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2] || '.';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// A one-part Word file, built here (synthetic).
function docx(xml) {
  const name = Buffer.from('word/document.xml'); const raw = Buffer.from(xml); const data = deflateRawSync(raw);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, cd, name, end]);
}
const P = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const ROW = (a, b) => `<w:tr><w:tc>${P(a)}</w:tc><w:tc>${P(b)}</w:tc></w:tr>`;
const RECEIPT = `<w:document xmlns:w="x"><w:body>${P('STESEN MINYAK UAT (mock)')}${P('Tarikh: 20/11/2026')}<w:tbl>${ROW('Liter', '42.50')}${ROW('Jumlah', 'RM 87.13')}</w:tbl></w:body></w:document>`;

(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const external = []; await p.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin === BASE) return r.continue(); external.push(u.origin + u.pathname); return r.abort(); });
  await p.addInitScript(() => { try { if (!sessionStorage.getItem('uat-init')) { localStorage.clear(); localStorage.setItem('prima.lang', 'en'); sessionStorage.setItem('uat-init', '1'); } } catch {} });
  await p.goto(BASE + '/');
  await p.evaluate(() => localStorage.setItem('prima-demo-user', 'u-transport')); await p.reload(); await p.waitForTimeout(2200);
  const agree = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ }); if (await agree.count()) { await agree.first().click(); await p.waitForTimeout(600); }
  const nav = async (names) => {
    const visible = async () => { for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x; return null; };
    let btn = await visible();
    if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); if (await more.count()) { await more.last().click(); await p.waitForTimeout(600); btn = await visible(); } }
    if (!btn) throw new Error('No visible button ' + names.join('/'));
    await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1400);
  };
  await nav(['Vehicles', 'Fleet', 'Transport', 'Kenderaan']);
  await p.getByRole('tab', { name: /Fuel|usage/i }).first().click(); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Record fill-up' }).first().click(); await p.waitForTimeout(600);
  const pick = p.getByLabel('Auto-fill').first();
  step('the Auto-fill panel is on the fill-up form', (await pick.count()) === 1);

  // 1. A Word receipt: litres and amount are read and wait for a check.
  await pick.setInputFiles({ name: 'resit-minyak.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx(RECEIPT) });
  await p.waitForTimeout(1200);
  step('litres are read from the Word receipt', (await p.getByLabel('Litres').inputValue()) === '42.5', await p.getByLabel('Litres').inputValue());
  step('the amount is read from the Word receipt', (await p.getByLabel('Amount (RM)').inputValue()) === '87.13', await p.getByLabel('Amount (RM)').inputValue());
  step('the read values are marked Check', (await p.getByText('Check', { exact: true }).count()) >= 2);
  await p.screenshot({ path: `${S}/key-in-01-word-receipt.png` });
  await p.getByRole('button', { name: 'Confirm all' }).click(); await p.waitForTimeout(300);
  step('after Confirm all nothing waits for a check', (await p.getByText('Check', { exact: true }).count()) === 0);

  // 2. An old Word file is refused with plain advice.
  await pick.setInputFiles({ name: 'lama.doc', mimeType: 'application/msword', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]) });
  await p.waitForTimeout(600);
  step('an old .doc file is refused with advice', (await p.getByText(/Old Word or Excel files/).count()) === 1);
  await p.screenshot({ path: `${S}/key-in-02-old-doc.png` });

  // 3. KDN renewal pack (AG21): the company manager's EPF statement gives its first and last month; only the boxes the
  //    form has are shown, and the paper is read on the device only.
  await p.evaluate(() => localStorage.setItem('prima-demo-user', 'u-cm-sasa')); await p.reload(); await p.waitForTimeout(2200);
  { const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ }); if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(600); } }
  await nav(['Renewals', 'Pembaharuan']);
  const kdn = p.locator('section.panel', { has: p.getByRole('heading', { name: /Pembaharuan Lesen KDN/ }) }).first();
  await kdn.getByRole('button', { name: 'Buka pembaharuan KDN' }).click(); await p.waitForTimeout(500);
  await kdn.getByRole('button', { name: 'Send', exact: true }).click(); await p.waitForTimeout(1500);
  const epf = kdn.locator('li', { hasText: /^○ 3\.1/ }).first();
  await epf.getByRole('button', { name: 'Sedia' }).click(); await p.waitForTimeout(500);
  step('the KDN EPF paper says it is read on the device only', (await epf.getByText(/read on your own device only/).count()) === 1);
  await epf.getByLabel('Auto-fill').setInputFiles({ name: 'penyata-kwsp.txt', mimeType: 'text/plain', buffer: Buffer.from('PENYATA CARUMAN MAJIKAN KWSP (mock)\nNo. Majikan: 000000 (mock)\nBulan Caruman: Januari 2026 hingga Julai 2026\n') });
  await p.waitForTimeout(1200);
  const months = await epf.locator('input[type="month"]').evaluateAll((xs) => xs.map((x) => x.value));
  step('the first and last month are read from the EPF statement', months.join(',') === '2026-01,2026-07', months.join(','));
  step('only the boxes this paper needs are shown', (await epf.getByText('Year', { exact: true }).count()) === 0 && (await epf.getByText('Reference no.', { exact: true }).count()) === 0);
  await epf.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${S}/key-in-03-kdn-epf.png` });

  step('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  step('no request left this machine except blocked web fonts', external.every((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), [...new Set(external)].join(', ').slice(0, 200));
  await b.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
