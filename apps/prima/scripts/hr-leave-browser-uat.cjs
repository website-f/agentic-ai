// Run: build the demo (cd apps/web && npx vite build --mode demo --outDir <dir>), serve it on 127.0.0.1:4179
// (npx vite preview --outDir <dir> --port 4179), then: node scripts/hr-leave-browser-uat.cjs <screenshot-dir>. Uses the
// pre-installed Playwright. Demo build only: synthetic people, no backend, nothing leaves the machine.
// Synthetic browser UAT of the HR leave journey on the demo build (no backend, no real data).
// Hosted CI passes its pinned Playwright as PLAYWRIGHT_MODULE (.github/workflows/ci.yml, job synthetic-browser); locally
// the pre-installed one is used. BASE_URL defaults to the local preview on 127.0.0.1:4179.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const assert = require('node:assert/strict');
const S = process.argv[2];
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1400, height: 1000 }, { width: 390, height: 844 }]) {
    console.log(`\n== viewport ${viewport.width}px ==`);
    const ctx = await b.newContext({ viewport });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    const externalUrls = []; await p.route('**/*', r => { const u = new URL(r.request().url()); if (u.origin === BASE) return r.continue(); externalUrls.push(u.origin + u.pathname); return r.abort(); });
    await p.goto(BASE + '/');
    const as = async (who) => {
      if (!(await p.locator('.persona').count())) await p.getByRole('button', { name: 'Tukar user' }).first().click();
      await p.waitForSelector('.persona'); await p.locator('.persona', { hasText: who }).first().click(); await p.waitForTimeout(1800);
      const ok = p.getByRole('button', { name: 'Saya setuju dan akan rahsiakan' }); if (await ok.count()) { await ok.click(); await p.waitForTimeout(600); }
    };
    const nav = async (name) => {
      const names = name === 'HR monitor' ? ['HR monitor', 'HR'] : [name];
      const visible = async () => { for (const n of names) for (const b of await p.getByRole('button', { name: n, exact: true }).all()) if (await b.isVisible()) return b; return null; };
      let btn = await visible();
      if (!btn) { const more = p.getByRole('button', { name: 'More', exact: true }); await more.last().click(); await p.waitForTimeout(600); btn = await visible(); }
      if (!btn) throw new Error('No visible button ' + name);
      await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click())); await p.waitForTimeout(1400);
    };
    const myLeave = async () => { await nav('My details'); await p.getByRole('tab', { name: 'Leave', exact: true }).click(); await p.waitForTimeout(600); };
    const apply = async (from, to) => {
      await p.getByRole('button', { name: 'Ask for leave' }).click();
      await p.getByLabel('Kind of leave').selectOption('ANNUAL');
      await p.getByLabel('First day').fill(from); await p.getByLabel('Last day').fill(to); await p.getByLabel('Reason').fill('Urusan keluarga (sintetik)');
      await p.getByRole('button', { name: 'Send request' }).click(); await p.waitForTimeout(1200);
    };
    const hrItem = (txt) => p.locator('.list-item', { hasText: 'Urusan keluarga (sintetik)' }).filter({ hasText: txt }).first();
    const decide = async (txt, note, approve) => {
      const it = hrItem(txt); await it.getByRole('button', { name: 'Decide' }).click(); await p.waitForTimeout(400);
      await it.getByLabel('Decision note').fill(note);
      await it.getByRole('button', { name: approve, exact: true }).click(); await p.waitForTimeout(1200);
    };
    await p.evaluate(() => localStorage.clear()); await p.reload();
    // 1. Staff enters a request with the wrong last day.
    await as('IT Executive 1'); await myLeave(); await apply('2026-11-16', '2026-11-18');
    let t = await p.$eval('.page', e => e.innerText);
    step('staff enters leave request (16-18 Nov)', /16 Nov 2026 to 18 Nov 2026/.test(t) && /pending/.test(t));
    // 2. HR cannot decide with a blank note; HR refuses with a reason (returned to the staff member).
    await as('PWVSB HR'); await nav('HR monitor');
    let it = hrItem('18 Nov'); await it.getByRole('button', { name: 'Decide' }).click(); await p.waitForTimeout(300);
    const rejectBtn = it.getByRole('button', { name: 'Reject', exact: true });
    const blankBlocked = (await rejectBtn.isDisabled()) || (await (async () => { await rejectBtn.click(); await p.waitForTimeout(600); return /why|reason|comment/i.test(await it.innerText()); })());
    step('HR cannot refuse with a blank note', blankBlocked);
    await it.getByLabel('Decision note').fill('Tarikh salah: sila mohon 16-17 Nov sahaja (synthetic)');
    await it.getByRole('button', { name: 'Reject', exact: true }).click(); await p.waitForTimeout(1200);
    t = await p.$eval('.page', e => e.innerText);
    step('HR refuses with a reason', /Tarikh salah/.test(t) || !(await hrItem('18 Nov').getByRole('button', { name: 'Decide' }).count()));
    // 3. Staff sees the refusal and the reason, then corrects and sends again.
    await as('IT Executive 1'); await myLeave();
    t = await p.$eval('.page', e => e.innerText);
    step('staff sees the refusal and the reason', /reject|refus|ditolak/i.test(t) && /Tarikh salah/.test(t), (t.split('Requests')[1] || '').slice(0, 160).replace(/\s+/g, ' '));
    // Correct and send again: the form opens with the refused details; only the last day is corrected.
    await p.getByRole('button', { name: 'Correct and send again' }).first().click(); await p.waitForTimeout(500);
    step('the form opens with the refused details', (await p.getByLabel('First day').inputValue()) === '2026-11-16' && (await p.getByLabel('Reason').inputValue()) === 'Urusan keluarga (sintetik)');
    await p.getByLabel('Last day').fill('2026-11-17');
    await p.getByRole('button', { name: 'Send request' }).click(); await p.waitForTimeout(1200);
    t = await p.$eval('.page', e => e.innerText);
    step('staff resubmits the corrected request (16-17 Nov)', /16 Nov 2026 to 17 Nov 2026/.test(t));
    await p.screenshot({ path: `${S}/uat-${viewport.width}-staff-resubmitted.png` });
    // 4. HR approves the corrected request with a comment; it waits for the Vice Chairman's consent.
    await as('PWVSB HR'); await nav('HR monitor');
    await decide('17 Nov', 'Tarikh betul, diluluskan (synthetic)', 'Approve');
    t = await p.$eval('.page', e => e.innerText);
    step('HR approves with a comment; waits for consent', /Vice Chairman|Naib Pengerusi|consent/i.test(t));
    // 5. The CEO, standing in for the Vice Chairman in the pilot, consents.
    await as('Fauzan'); await nav('HR monitor');
    const c = hrItem('17 Nov'); const found = await c.count();
    if (found) { await c.getByRole('button', { name: 'Decide' }).click(); await c.getByLabel('Decision note').fill('Setuju (synthetic)'); await c.getByRole('button', { name: 'Consent', exact: true }).click(); await p.waitForTimeout(1200); }
    step('Vice Chairman stand-in (CEO) consents with a comment', found > 0);
    // 6. The directors-only legal points: CEO sees them, HR Admin does not.
    t = await p.$eval('.page', e => e.innerText);
    step('CEO sees the directors-only legal points', /Legal points for the directors/.test(t));
    await as('PWVSB HR'); await nav('HR monitor'); t = await p.$eval('.page', e => e.innerText);
    step('HR Admin does not see the legal points', !/Legal points for the directors/.test(t));
    step('HR guide cards show on the HR screen', /Panduan langkah demi langkah|How to do it/.test(t));
    // 7. Staff sees the approved leave.
    await as('IT Executive 1'); await myLeave(); t = await p.$eval('.page', e => e.innerText);
    step('staff sees the corrected request approved', /approved|diluluskan/i.test((t.split('Requests')[1] || '')), (t.split('Requests')[1] || '').slice(0, 200).replace(/\s+/g, ' '));
    await nav('Clock'); t = await p.$eval('.page', e => e.innerText);
    step('staff guide cards show on the Clock screen', /Panduan langkah demi langkah|How to do it/.test(t));
    // 8. Sick leave: HR refuses, the correction keeps the clinic, illness, MC number and MC file (Arisha review, 3 Nov 2026).
    await myLeave();
    await p.getByRole('button', { name: 'Ask for leave' }).click();
    await p.getByLabel('Kind of leave').selectOption('SICK');
    await p.getByLabel('Reason').fill('Demam (sintetik)');
    await p.getByLabel('Illness').fill('Demam ujian'); await p.getByLabel('Clinic').fill('Klinik Ujian Sintetik'); await p.getByLabel('MC serial number').fill(`KUS-${viewport.width}`);
    await p.locator('input[type=file]').first().setInputFiles({ name: 'mc-synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic MC') });
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Send request' }).click(); await p.waitForTimeout(1200);
    t = await p.$eval('.page', e => e.innerText);
    step('staff sends sick leave with the MC', /Demam ujian/.test(t) && /MC uploaded/.test(t));
    await as('PWVSB HR'); await nav('HR monitor');
    const sick = p.locator('.list-item', { hasText: 'Demam (sintetik)' }).first();
    await sick.getByRole('button', { name: 'Decide' }).click(); await p.waitForTimeout(300);
    await sick.getByLabel('Decision note').fill('Sila semak tarikh MC (synthetic)'); await sick.getByRole('button', { name: 'Reject', exact: true }).click(); await p.waitForTimeout(1200);
    await as('IT Executive 1'); await myLeave();
    await p.locator('.list-item', { hasText: 'Demam (sintetik)' }).getByRole('button', { name: 'Correct and send again' }).first().click(); await p.waitForTimeout(500);
    const kept = (await p.getByLabel('Illness').inputValue()) === 'Demam ujian' && (await p.getByLabel('Clinic').inputValue()) === 'Klinik Ujian Sintetik' && (await p.getByLabel('MC serial number').inputValue()) === `KUS-${viewport.width}`;
    t = await p.$eval('.page', e => e.innerText);
    step('the correction keeps the clinic, illness, MC number and MC file', kept && /from the refused request is kept with this one/.test(t));
    await p.getByRole('button', { name: 'Send request' }).click(); await p.waitForTimeout(1200);
    t = await p.$eval('.page', e => e.innerText);
    const reqs = t.split('Requests')[1] || '';
    step('the corrected sick leave is sent without uploading the MC again', /pending/.test(reqs) && (reqs.match(/MC uploaded/g) || []).length >= 2, reqs.slice(0, 220).replace(/\s+/g, ' '));
    step('a refusal can be corrected only once', !(await p.locator('.list-item', { hasText: 'Sila semak tarikh MC' }).getByRole('button', { name: 'Correct and send again' }).count()));
    await p.screenshot({ path: `${S}/uat-${viewport.width}-sick-corrected.png` });
    await p.screenshot({ path: `${S}/uat-${viewport.width}-done.png` });
    step('no page errors', errors.length === 0, errors.slice(0, 2).join(' / '));
    step('no request left this machine except blocked web fonts', externalUrls.every(u => /fonts\.(googleapis|gstatic)\.com/.test(u)), externalUrls.join(' '));
    await ctx.close();
  }
  await b.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
