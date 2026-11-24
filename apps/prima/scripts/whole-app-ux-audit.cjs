// Whole-app UX crawl of the demo build (made-up people, no backend, read-only).
// Build and serve the demo as in scripts/screen-tools-audit.cjs, then:
//   node scripts/whole-app-ux-audit.cjs <out.json> [--width=390|1280] [--lang=en|ms|mix]
// For every person, every menu screen and every top-level tab it records: page errors and console errors,
// sideways scrolling (page wider than the phone), how long the tab took to settle, empty screens,
// the Upload / Key in / Download toolbar, buttons without a label, small tap targets on the phone,
// and broken text such as "undefined", "NaN", "[object Object]" or raw translation keys.
const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const OUT = process.argv[2] || 'ux-audit.json';
const WIDTH = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=1280').split('=')[1]);
const LANG = (process.argv.find((a) => a.startsWith('--lang=')) || '--lang=en').split('=')[1];
const SHOTS = process.env.SHOTS || '';
const PEOPLE = (process.env.PEOPLE || 'u-fauzan,u-coo,u-cos,u-dcos,u-chair,u-vchair,u-fd,u-fin-t1-lead,u-finance-am,u-cm-sasa,u-gm-sasa,u-ae-sasa,u-sv-sasa,u-om-klang,u-rom-central,u-opsdir,u-ogm,u-pwvsb-hr,u-it-lead,u-it-mgr,u-pwvsb-arms,u-cms-head,u-audit,u-act-mgr,u-proc-exec,u-proc-manager,u-proc-store1,u-asset-dir,u-asset-mm,u-transport,u-pdpa,u-fwm-mgr,u-fwm-ex1,u-pwvsb-doa,u-mkt-mgr,u-legal,u-credit,u-cosec').split(',');

async function inspect(p, width) {
  return p.evaluate((width) => {
    const main = document.querySelector('.main');
    if (!main) return { noMain: true };
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
    const text = (main.innerText || '').trim();
    const pageW = document.documentElement.scrollWidth;
    const wide = [];
    if (pageW > window.innerWidth + 2) {
      for (const e of main.querySelectorAll('*')) {
        const r = e.getBoundingClientRect();
        if (r.right > window.innerWidth + 2 && r.width > 0 && !e.closest('.table-wrap, [style*="overflow"]')) {
          const tag = e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0, 2).join('.') : '');
          wide.push(tag + ' ' + Math.round(r.right) + ' ' + (e.innerText || '').slice(0, 30).replace(/\s+/g, ' '));
          if (wide.length > 4) break;
        }
      }
    }
    const btns = [...main.querySelectorAll('button')].filter(vis);
    const unlabeled = btns.filter((b) => !(b.innerText || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
    const smallTaps = width < 600 ? btns.filter((b) => { const r = b.getBoundingClientRect(); return r.height < 28 || r.width < 28; }).map((b) => (b.innerText || b.getAttribute('aria-label') || '?').slice(0, 20)) : [];
    const bad = [];
    for (const re of [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b(?! ?island)/, /\b[a-z]+(?:\.[a-z][A-Za-z0-9_]+){2,}\b/, /Invalid Date/, /RM ?NaN/]) {
      const m = text.match(re); if (m) bad.push(m[0] + ' … ' + text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' '));
    }
    const tools = main.querySelector('[data-screen-tools]');
    const toolBtns = tools ? [...tools.querySelectorAll('button')].map((b) => b.getAttribute('data-tool')).filter(Boolean) : [];
    const disabled = btns.filter((b) => b.disabled && !b.title && !b.getAttribute('aria-describedby')).map((b) => (b.innerText || '').trim().slice(0, 30)).filter(Boolean);
    // In Bahasa Melayu, short labels (buttons, tabs, headings, field names) still in English.
    const english = [];
    if (document.documentElement.lang !== 'en' && localStorage.getItem('prima.lang') === 'ms') {
      const EN = /\b(the|and|for|with|from|your|add|new|save|edit|record|request|approve|approved|show|open|close|send|list|not|none|due|today|this|month|year)\b/i;
      for (const e of main.querySelectorAll('button, [role=tab], h1, h2, h3, th, label, .label')) {
        if (!vis(e) || e.closest('[data-no-translate]')) continue;
        const t = (e.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && t.length < 70 && EN.test(t) && (t.match(/\b[a-z]{3,}\b/gi) || []).length >= 2) english.push(t);
      }
    }
    return { english: [...new Set(english)].slice(0, 15), chars: text.length, pageW, wide, unlabeled, smallTaps: smallTaps.slice(0, 6), smallTapCount: smallTaps.length, bad, toolBtns, disabledNoReason: disabled.slice(0, 6), tables: main.querySelectorAll('table').length, heading: (main.querySelector('h1,h2')?.innerText || '').slice(0, 60) };
  }, width);
}

async function settle(p) {
  const t0 = Date.now();
  await p.waitForTimeout(150);
  await p.waitForFunction(() => !document.querySelector('.main .loading, .main [aria-busy=true], .main .spinner'), null, { timeout: 8000 }).catch(() => {});
  return Date.now() - t0;
}

async function crawl(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 }, isMobile: WIDTH < 600, hasTouch: WIDTH < 600 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  await p.route('**/*', (r) => { const u = new URL(r.request().url()); return u.origin === BASE || u.protocol === 'blob:' || u.protocol === 'data:' ? r.continue() : r.abort(); });
  await p.addInitScript(([id, lang]) => { try { localStorage.setItem('prima.lang', lang); localStorage.setItem('prima-demo-user', id); } catch {} }, [who, LANG]);
  const t0 = Date.now();
  await p.goto(BASE + '/');
  await p.waitForSelector('.main, aside.rail', { timeout: 30000 }).catch(() => {});
  const loadMs = Date.now() - t0;
  await p.waitForTimeout(1200);
  const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ });
  if (await ok.count()) { await ok.first().click(); await p.waitForTimeout(400); }
  const views = await p.evaluate(() => [...document.querySelectorAll('aside.rail nav.nav button')].map((b) => b.textContent.trim().replace(/\s+\d+$/, '')));
  const rows = [{ who, view: '_load', loadMs, menuItems: views.length }];
  for (let vi = 0; vi < views.length; vi++) {
    const label = views[vi];
    try {
      const tc = Date.now();
      await p.evaluate((i) => document.querySelectorAll('aside.rail nav.nav button')[i].click(), vi);
      let ms = await settle(p) + 0;
      ms = Date.now() - tc;
      const hash = await p.evaluate(() => location.hash.slice(1));
      const tabs = await p.evaluate(() => { const main = document.querySelector('.main'); const bar = main && [...main.querySelectorAll('[role=tablist]')].find((t) => !t.closest('header.topbar')); return bar ? [...bar.querySelectorAll('[role=tab]')].map((b) => (b.innerText || '').replace(/\s+\d+$/, '').trim()) : []; });
      errs.length = 0;
      const r0 = { who, view: hash, viewLabel: label, tab: '', ms, ...(await inspect(p, WIDTH)) };
      r0.errors = [...errs];
      rows.push(r0);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${WIDTH}-${who}-${hash || vi}.png` }).catch(() => {});
      for (let ti = 1; ti < tabs.length; ti++) {
        errs.length = 0;
        const bar = p.locator('.main [role=tablist]').first();
        const tt = Date.now();
        await bar.locator('[role=tab]').nth(ti).click({ timeout: 3000 }).catch(() => {});
        await settle(p);
        const tms = Date.now() - tt;
        const r = { who, view: hash, viewLabel: label, tab: tabs[ti], ms: tms, ...(await inspect(p, WIDTH)) };
        r.errors = [...errs];
        rows.push(r);
      }
    } catch (e) {
      rows.push({ who, view: '?', viewLabel: label, tab: '', error: String(e.message).slice(0, 160), errors: [...errs] });
    }
  }
  await ctx.close();
  return rows;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const all = [];
  const queue = [...PEOPLE];
  await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) { const w = queue.shift(); const r = await crawl(browser, w).catch((e) => [{ who: w, error: String(e.message) }]); console.log(w, r.length); all.push(...r); } }));
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
})();
