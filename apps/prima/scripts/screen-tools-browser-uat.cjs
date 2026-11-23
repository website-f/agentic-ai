// Run: build the demo (npx vite build --mode demo --outDir dist-demo in apps/web), serve it on 127.0.0.1:4179, then:
// node scripts/screen-tools-browser-uat.cjs <screenshot-dir>
// Synthetic browser UAT of the screen toolbar (Upload / Key in / Download on every screen; Fauzan, 23 Nov 2026) on the
// demo build: made-up people only, no backend, nothing leaves the machine.
const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2] || '.';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    console.log(`\n== viewport ${viewport.width}px ==`);
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.route('**/*', (r) => { const u = new URL(r.request().url()); return u.origin === BASE || u.protocol === 'blob:' || u.protocol === 'data:' ? r.continue() : r.abort(); });
    const shot = (n) => p.screenshot({ path: `${S}/${viewport.width}-${n}.png` });
    const as = async (id, hash) => {
      await p.addInitScript(([i]) => { try { localStorage.setItem('prima.lang', 'en'); localStorage.setItem('prima-demo-user', i); } catch {} }, [id]);
      await p.goto(`${BASE}/#${hash}`); await p.evaluate((i) => localStorage.setItem('prima-demo-user', i), id); await p.reload(); await p.waitForTimeout(2500);
      const ok = p.getByRole('button', { name: /I agree and will keep it confidential/ }); if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(500); }
    };
    const tool = (t) => p.locator(`[data-screen-tools] button[data-tool=${t}]`);

    // 1. A company manager on Sites: Key in shows the site record forms; Download gives Excel with no reason asked.
    await as('u-cm-sasa', 'sites');
    step('toolbar on Sites', (await tool('upload').count()) === 1 && (await tool('keyin').count()) === 1 && (await tool('download').count()) === 1);
    await shot('01-sites-toolbar');
    await tool('keyin').click(); await p.waitForTimeout(800);
    const drawer = p.locator('.drawer');
    step('Key in lists the site forms', (await drawer.getByRole('button', { name: /\+ Site/ }).count()) > 0, (await drawer.innerText()).slice(0, 160).replace(/\n/g, ' | '));
    await shot('02-sites-keyin');
    await drawer.getByRole('button', { name: 'Close' }).click();
    await tool('download').click(); await p.waitForTimeout(600);
    step('plain download asks no reason', (await drawer.getByLabel('Reason for the download').count()) === 0);
    await shot('03-sites-download');
    const [d1] = await Promise.all([p.waitForEvent('download'), drawer.getByRole('button', { name: 'Excel', exact: true }).click()]);
    const f1 = `${S}/${viewport.width}-sites.xlsx`; await d1.saveAs(f1);
    const head = fs.readFileSync(f1).subarray(0, 2).toString();
    step('Excel file saved', head === 'PK' && d1.suggestedFilename().endsWith('.xlsx'), d1.suggestedFilename());
    const [d1c] = await Promise.all([p.waitForEvent('download'), drawer.getByRole('button', { name: 'CSV', exact: true }).click()]);
    const f1c = `${S}/${viewport.width}-sites.csv`; await d1c.saveAs(f1c);
    const csv = fs.readFileSync(f1c, 'utf8');
    step('CSV file saved with the ref in its name and no stamp lines', /-EXP-\d{8}-[0-9A-F]{6}\.csv$/.test(d1c.suggestedFilename()) && !/Downloaded by/.test(csv) && csv.split('\r\n').length > 2, d1c.suggestedFilename());
    await drawer.getByRole('button', { name: 'Close' }).click().catch(() => {});

    // 2. Upload explains the file manager (in the demo the file store is on in memory).
    await tool('upload').click(); await p.waitForTimeout(1200);
    step('Upload opens the file panel', /Old files and data/.test(await drawer.innerText()));
    // Any kind of file is taken (zip, video, drawings, no extension); only programs are refused.
    await drawer.getByLabel('Files to add').setInputFiles([
      { name: 'site photos.zip', mimeType: 'application/zip', buffer: Buffer.from([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 8, 0]) },
      { name: 'floor plan.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('AC1032 synthetic drawing') },
      { name: 'EPF_Nov.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,IC,Amount\nMock Person,900101015555,100\n') },
      { name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from([0x4d, 0x5a, 0x90, 0]) },
    ]);
    await p.waitForTimeout(2000);
    const upTxt = await drawer.innerText();
    step('zip, drawing and CSV ready to save; the program refused', /site photos\.zip/.test(upTxt) && /floor plan\.dwg/.test(upTxt) && /EPF_Nov\.csv/.test(upTxt) && /Programs and scripts are not kept/.test(upTxt));
    await drawer.getByRole('button', { name: /Save all|Simpan semua/ }).click(); await p.waitForTimeout(2500);
    const saved = (await drawer.innerText()).match(/Saved/g)?.length ?? 0;
    step('the three files are saved', saved >= 3, `${saved} saved`);
    await shot('04-sites-upload');
    await drawer.getByRole('button', { name: 'Close' }).click();

    // 3. HR on Staff payroll: a reason is needed before the pay download.
    await as('u-pwvsb-hr', 'staffpay');
    await tool('download').click(); await p.waitForTimeout(600);
    const excel = drawer.getByRole('button', { name: 'Excel', exact: true });
    step('pay download blocked until a reason is given', await excel.isDisabled());
    await drawer.getByLabel('Reason for the download').fill('November payroll check (UAT, mock)');
    await shot('05-pay-reason');
    const [d2] = await Promise.all([p.waitForEvent('download'), drawer.getByRole('button', { name: 'PDF', exact: true }).click()]);
    const f2 = `${S}/${viewport.width}-pay.pdf`; await d2.saveAs(f2);
    const pdf = fs.readFileSync(f2).toString('latin1');
    step('PDF carries the confidential stamp and ref', pdf.startsWith('%PDF') && /SULIT \/ CONFIDENTIAL/.test(pdf) && /EXP-\d{8}-/.test(pdf));
    await drawer.getByRole('button', { name: 'Close' }).click().catch(() => {});

    // 4. The download is in the audit trail (CEO view).
    await as('u-fauzan', 'audit'); await p.waitForTimeout(800);
    const txt = await p.locator('[data-screen-content]').innerText();
    step('downloads are in the audit trail', /export\.download|Downloaded (Excel|PDF)/.test(txt));
    await shot('06-audit');

    // 5. Speak-up stays with its handlers: a company manager cannot download the speak-up tab.
    await as('u-cm-sasa', 'grc');
    const sp = p.locator('.main [role=tablist] [role=tab]', { hasText: /Speak/i }).first();
    if (await sp.count()) { await sp.click(); await p.waitForTimeout(600); await tool('download').click(); await p.waitForTimeout(500);
      step('speak-up download refused for a company manager', /only by the people who handle speak-up/.test(await drawer.innerText()));
      await shot('07-speakup-refused'); await drawer.getByRole('button', { name: 'Close' }).click(); }
    else step('speak-up tab present for the company manager', true, 'no speak-up tab in this menu');
    step(`no page errors at ${viewport.width}px`, errors.length === 0, errors.slice(0, 2).join(' / '));
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
})();
