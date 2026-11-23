// Run: build the demo (npx vite build --mode demo --outDir dist-demo in apps/web), serve it on 127.0.0.1:4179
// (npx vite preview --mode demo --outDir dist-demo --host 127.0.0.1 --port 4179 --strictPort), then:
// node scripts/screen-tools-audit.cjs <out.json> [--after]
// Synthetic, read-only crawl of the demo build (made-up people, no backend). Signs in as each test person, opens every
// screen in their menu and every top-level tab, and records whether the tab offers Upload, Key in and Download.
// With --after it also checks the screen toolbar (Upload / Key in / Download) is on every tab.
const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const OUT = process.argv[2] || 'screen-tools-audit.json';
const AFTER = process.argv.includes('--after');
const PEOPLE = (process.env.PEOPLE || 'u-fauzan,u-cm-sasa,u-ae-sasa,u-sv-sasa,u-pwvsb-hr,u-finance-am,u-fd,u-it-lead,u-it-mgr,u-pwvsb-arms,u-audit,u-proc-exec,u-asset-mm,u-transport,u-pdpa,u-fwm-ex1,u-cms-head,u-om-klang,u-cos,u-pwvsb-doa,u-mkt-mgr,u-legal,u-credit,u-coo,u-cosec').split(',');

async function inspect(p) {
  return p.evaluate(() => {
    const main = document.querySelector('.main');
    if (!main) return null;
    const inTools = (e) => !!e.closest('[data-screen-tools]');
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btns = [...main.querySelectorAll('button, a')].filter((e) => !e.closest('header.topbar') && !e.closest('.demo-band') && !inTools(e) && vis(e));
    const txt = (e) => (e.innerText || e.getAttribute('aria-label') || '').trim();
    const upload = !![...main.querySelectorAll('input[type=file]')].filter((e) => !inTools(e)).length || btns.some((b) => /upload|muat naik|attach|lampir|camera|kamera|take photo|ambil gambar|scan|import|choose file|pilih fail/i.test(txt(b)));
    const keyIn = btns.some((b) => /^(\+ ?)?(add|tambah|new|baru|record|rekod|key in|isi|create|cipta|daftar|register|log |raise|request|mohon|submit|hantar|save|simpan|report|lapor)/i.test(txt(b)) && !/report a problem/i.test(txt(b)));
    const download = !!main.querySelector('a[download]') || btns.some((b) => /download|muat turun|export|eksport|excel|\.xlsx|csv|pdf|print|cetak/i.test(txt(b)));
    const tools = main.querySelector('[data-screen-tools]');
    const toolBtns = tools ? [...tools.querySelectorAll('button')].map((b) => b.getAttribute('data-tool')).filter(Boolean) : [];
    const tables = main.querySelectorAll('table').length;
    const listItems = main.querySelectorAll('.list-item').length;
    return { upload, keyIn, download, toolBtns, tables, listItems };
  });
}

async function tabsOf(p) {
  return p.evaluate(() => {
    const main = document.querySelector('.main');
    const bar = main && [...main.querySelectorAll('[role=tablist]')].find((t) => !t.closest('header.topbar'));
    if (!bar) return [];
    return [...bar.querySelectorAll('[role=tab]')].map((b) => (b.innerText || '').replace(/\s+\d+$/, '').trim()).filter(Boolean);
  });
}

async function crawl(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.route('**/*', (r) => { const u = new URL(r.request().url()); return u.origin === BASE || u.protocol === 'blob:' || u.protocol === 'data:' ? r.continue() : r.abort(); });
  await p.addInitScript((id) => { try { localStorage.setItem('prima.lang', 'en'); localStorage.setItem('prima-demo-user', id); } catch {} }, who);
  await p.goto(BASE + '/');
  await p.waitForTimeout(2500);
  const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ });
  if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(500); }
  const views = await p.evaluate(() => [...document.querySelectorAll('aside.rail nav.nav button')].map((b) => b.innerText.trim()));
  const rows = [];
  for (let vi = 0; vi < views.length; vi++) {
    const label = views[vi];
    try {
      await p.locator('aside.rail nav.nav button').nth(vi).click({ timeout: 4000 });
      await p.waitForTimeout(900);
      const hash = await p.evaluate(() => location.hash.slice(1));
      const tabs = await tabsOf(p);
      if (!tabs.length) rows.push({ who, view: hash, viewLabel: label, tab: '', ...(await inspect(p)) });
      for (let ti = 0; ti < tabs.length; ti++) {
        const bar = p.locator('.main [role=tablist]').first();
        await bar.locator('[role=tab]').nth(ti).click({ timeout: 3000 }).catch(() => {});
        await p.waitForTimeout(600);
        rows.push({ who, view: hash, viewLabel: label, tab: tabs[ti], ...(await inspect(p)) });
      }
    } catch (e) {
      rows.push({ who, view: '?', viewLabel: label, tab: '', error: String(e.message).slice(0, 120) });
    }
  }
  await ctx.close();
  return rows;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const all = [];
  const queue = [...PEOPLE];
  await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) { const w = queue.shift(); const r = await crawl(browser, w); console.log(w, r.length); all.push(...r); } }));
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  if (AFTER) {
    const missing = all.filter((r) => !r.error && (!r.toolBtns || r.toolBtns.length === 0));
    console.log(`tabs checked ${all.length}, without the toolbar ${missing.length}`);
    for (const m of missing.slice(0, 40)) console.log('  missing', m.who, m.view, m.tab);
    process.exitCode = missing.length ? 1 : 0;
  }
})();
