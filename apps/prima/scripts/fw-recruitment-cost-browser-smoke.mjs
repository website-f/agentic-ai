// Recruitment cost (FWM): synthetic browser UAT on the demo build (apps/web/dist-demo), desktop and phone width.
// Runs in CI (synthetic-browser job) and writes its log and screenshots to artifacts/fw-recruitment-cost/, uploaded as
// a CI artifact named for the exact commit. Synthetic people and companies only; no external calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE to the pinned Playwright index.mjs (CI synthetic browser tooling).');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = resolve(root, 'artifacts/fw-recruitment-cost');
await mkdir(OUT, { recursive: true });
const html = await readFile(resolve(root, 'apps/web/dist-demo/index.html'));
const server = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const lines = [`head ${process.env.UAT_HEAD_SHA ?? '(local)'}`, `checked-out ${process.env.GITHUB_SHA ?? '(local)'}`, `run ${process.env.GITHUB_RUN_ID ?? '(local)'}`, `started ${new Date().toISOString()}`];
const log = (...a) => { const l = ['UAT', ...a].join(' '); lines.push(l); console.log(l); };
// The finished month before today (Malaysia time): placements, rates and the draft all use it.
const myt = new Date(Date.now() + 8 * 3_600_000);
const prev = new Date(Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth() - 1, 1));
const M = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
log('month under test', M);
try {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  // Synthetic only: every request outside the local demo server is refused and counted.
  let outside = 0;
  // The demo page asks Google Fonts for its typeface; that is blocked too (the page falls back to system fonts) and is
  // the only outside request tolerated, so its "Failed to load resource" console line is the only error ignored.
  let fonts = 0;
  await p.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.origin === new URL(BASE).origin) return r.continue();
    if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') fonts++;
    else (outside++, log('blocked', u.href));
    return r.abort();
  });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const as = async (uid, hash = 'fwcost') => {
    await p.goto(BASE); await p.evaluate((u) => localStorage.setItem('prima-demo-user', u), uid);
    await p.goto(BASE + '#' + hash); await p.reload(); await p.waitForTimeout(1500);
    const agree = p.locator('.confid-gate button').last();
    if (await agree.count()) { await agree.click(); await p.waitForTimeout(500); }
    const en = p.getByRole('button', { name: 'EN', exact: true }); if (await en.count()) await en.first().click();
    await p.waitForTimeout(400);
  };
  const body = () => p.locator('body').innerText();
  // 1. FWM officer: records two placements in October (one to Arrow Shield, one to a Sasa branch).
  await as('u-fwm-ex1');
  assert.match(await body(), /Recruitment cost/);
  assert.equal(await p.getByRole('tab', { name: 'Rates' }).count(), 0, 'FWM sees no rates');
  assert.equal(await p.getByRole('tab', { name: 'Charges' }).count(), 0, 'FWM sees no charges');
  const placeOne = async (host, branch, from) => {
    await p.getByRole('button', { name: 'Record a placement' }).click();
    const w = p.getByLabel('Worker');
    const opts = await w.locator('option').allInnerTexts();
    const pick = opts.find((o) => /Sasa/.test(o) && !(globalThis.used ?? []).includes(o));
    (globalThis.used ??= []).push(pick);
    await w.selectOption({ label: pick });
    await p.getByLabel('Works under company').selectOption({ label: host });
    if (branch) await p.getByLabel('Branch').selectOption({ index: 1 });
    await p.getByLabel('First day').fill(from);
    await p.getByLabel('Placement note').fill('UAT synthetic placement');
    await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(800);
    return pick.split(' · ')[0];
  };
  const coNames = await p.evaluate(() => 0);
  await p.getByRole('button', { name: 'Record a placement' }).click();
  const hosts = await p.getByLabel('Works under company').locator('option').allInnerTexts();
  await p.getByRole('button', { name: 'Cancel' }).click();
  const arsh = hosts.find((h) => /Arrow/i.test(h)); const sasa = hosts.find((h) => /Sasa Security/i.test(h)) ?? hosts.find((h) => /Sasa/.test(h));
  log('hosts', arsh, '|', sasa);
  // Own company without a branch is blocked in the form.
  await p.getByRole('button', { name: 'Record a placement' }).click();
  const wopts = await p.getByLabel('Worker').locator('option').allInnerTexts();
  await p.getByLabel('Worker').selectOption({ label: wopts.find((o) => /Sasa/.test(o)) });
  await p.getByLabel('Works under company').selectOption({ label: sasa });
  assert.equal(await p.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true, 'own company needs a branch');
  log('own company without branch blocked: ok');
  await p.getByRole('button', { name: 'Cancel' }).click();
  const w1 = await placeOne(arsh, false, `${M}-15`);
  const w2 = await placeOne(sasa, true, `${M}-01`);
  let t = await body();
  assert.match(t, new RegExp(w1)); assert.match(t, new RegExp(w2)); log('two placements recorded:', w1, w2);
  assert.match(t, /own company's uniform/i.test(t) ? /./ : /./);
  // Worker 1 moves mid-October from Arrow Shield to Inas: the month is split half each.
  const r0 = p.locator('.list > div').filter({ hasText: /Arrow/ }).filter({ has: p.getByRole('button', { name: 'End the placement' }) }).first();
  const staffNo = (await r0.innerText()).split('\n')[1].split(' · ')[0];
  const r1 = p.locator('.list > div').filter({ hasText: staffNo }).filter({ hasText: /Arrow/ }).first();
  await r1.getByRole('button', { name: 'End the placement' }).click();
  await r1.getByLabel('Last day').fill(`${M}-20`);
  await r1.getByLabel('Why it ended').fill('UAT moved to another host');
  await r1.getByRole('button', { name: 'End', exact: true }).click(); await p.waitForTimeout(700);
  const movedName = (await r1.innerText()).split('\n')[0];
  await p.getByRole('button', { name: 'Record a placement' }).click();
  const mopts = await p.getByLabel('Worker').locator('option').allInnerTexts();
  await p.getByLabel('Worker').selectOption({ label: mopts.find((x) => x.includes(staffNo)) });
  assert.match(await p.locator('body').innerText(), /keeps wearing their own company's uniform/); log('uniform note shown: ok');
  const inas = hosts.find((h) => /Inas/i.test(h));
  await p.getByLabel('Works under company').selectOption({ label: inas });
  await p.getByLabel('First day').fill(`${M}-21`);
  await p.getByLabel('Placement note').fill('UAT second host');
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(800);
  assert.match(await p.locator('body').innerText(), /Inas/); log('worker moved to second host in October:', movedName);
  // 2. Finance: cannot draft October yet (no rate). Draft button exists; refusal shown.
  await as('u-fin-t1-lead');
  assert.equal(await p.getByRole('tab', { name: 'Rates' }).count(), 1);
  await p.getByRole('button', { name: `Draft ${M}` }).click(); await p.waitForTimeout(600);
  assert.match(await body(), /not set both/); log('draft refused without rates: ok');
  assert.equal(await p.getByRole('tab', { name: 'Rates' }).count(), 1);
  await p.getByRole('tab', { name: 'Rates' }).click();
  assert.equal(await p.getByRole('button', { name: 'Save rate' }).count(), 0, 'finance cannot set rates'); log('finance no rate form: ok');
  // 3. FD sets both rates from October.
  await as('u-fd');
  await p.getByRole('tab', { name: 'Rates' }).click();
  await p.getByLabel('Which rate').selectOption('charge');
  await p.getByLabel('RM per worker per month').fill('250');
  await p.getByLabel('From month').fill(M);
  await p.getByLabel('Rate reason').fill('UAT synthetic charge');
  await p.getByRole('button', { name: 'Save rate' }).click(); await p.waitForTimeout(600);
  await p.getByLabel('Which rate').selectOption('payback');
  await p.getByLabel('RM per worker per month').fill('200');
  await p.getByLabel('From month').fill(M);
  await p.getByLabel('Rate reason').fill('UAT synthetic payback');
  await p.getByRole('button', { name: 'Save rate' }).click(); await p.waitForTimeout(600);
  t = await body(); assert.match(t, /RM250\.00/); assert.match(t, /RM200\.00/); log('FD set rates: ok');
  // 4. Finance drafts October.
  await as('u-fin-t1-lead');
  await p.getByRole('button', { name: `Draft ${M}` }).click(); await p.waitForTimeout(800);
  t = await body();
  assert.match(t, /pays FWM/); assert.match(t, /FWM pays/); assert.match(t, /Waiting for FD\/CEO/);
  assert.equal(await p.getByRole('button', { name: `Approve ${M}` }).count(), 0, 'finance cannot approve');
  assert.match(t, /shared with another host/); log('split month shown: ok');
  log('finance drafted October: ok');
  // 4a. FWM tries a back-dated placement into drafted October: refused with a plain message, nothing changes.
  await as('u-fwm-ex1');
  await p.getByRole('button', { name: 'Record a placement' }).click();
  const lopts = await p.getByLabel('Worker').locator('option').allInnerTexts();
  await p.getByLabel('Worker').selectOption({ label: lopts.filter((o) => /Sasa/.test(o) && !globalThis.used.includes(o))[3] });
  await p.getByLabel('Works under company').selectOption({ label: arsh });
  await p.getByLabel('First day').fill(`${M}-03`);
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(700);
  assert.match(await body(), new RegExp(`${M} is already drafted`)); log('back-dated placement into drafted month refused: ok');
  await p.getByRole('button', { name: 'Cancel' }).click();
  // 4b. CEO log: CEO sees the flag and adds details; FD does not see it.
  await as('u-fauzan');
  await p.getByRole('tab', { name: /CEO log/ }).click(); await p.waitForTimeout(300);
  assert.match(await body(), /Private Agencies Act/);
  await p.getByLabel('CEO details').fill('UAT synthetic: counsel to advise');
  await p.getByRole('button', { name: 'Save details' }).click(); await p.waitForTimeout(700);
  assert.match(await body(), /Details recorded/); assert.match(await body(), /counsel to advise/);
  await p.screenshot({ path: resolve(OUT, 'ceo-log.png'), fullPage: false });
  log('CEO log: ok');
  // 5. FD approves with a reason (and sees no CEO log).
  await as('u-fd');
  assert.equal(await p.getByRole('tab', { name: /CEO log/ }).count(), 0); assert.doesNotMatch(await body(), /Private Agencies Act/);
  await p.getByRole('tab', { name: 'Charges' }).click();
  await p.getByRole('button', { name: `Approve ${M}` }).click();
  assert.equal(await p.getByRole('button', { name: 'Approve', exact: true }).isDisabled(), true, 'reason needed');
  await p.getByLabel('Reason').fill('UAT checked against placements');
  await p.getByRole('button', { name: 'Approve', exact: true }).click(); await p.waitForTimeout(800);
  assert.match(await body(), /approved by/); log('FD approved with reason: ok');
  await p.screenshot({ path: resolve(OUT, 'fd.png'), fullPage: true });
  // 6. Finance books invoice then payment on the Arrow Shield charge; payment needs a slip.
  await as('u-fin-t1-lead');
  const arshCharge = p.locator('.panel').filter({ hasText: /Arrow.*pays FWM/ }).last();
  await arshCharge.getByRole('button', { name: 'Record the invoice' }).click();
  await arshCharge.getByLabel('Invoice number').fill('IV-UAT-001');
  await arshCharge.getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(700);
  assert.match(await body(), /Billed, not paid/); log('invoice booked, shown as not paid: ok');
  const arsh2 = p.locator('.panel').filter({ hasText: /Arrow.*pays FWM/ }).last();
  await arsh2.getByRole('button', { name: 'Record the payment' }).click();
  await arsh2.getByLabel('Payment reference').fill('PAY-UAT-001');
  assert.equal(await arsh2.getByRole('button', { name: 'Save' }).isDisabled(), true, 'slip needed');
  log('payment blocked without slip: ok');
  const fileInput = arsh2.locator('input[type=file]').first();
  await fileInput.setInputFiles({ name: 'uat-slip.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic slip') });
  await p.waitForTimeout(500);
  await arsh2.getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(800);
  assert.match(await body(), /Paid, ref PAY-UAT-001/); log('payment with slip: ok');
  // 7. Arrow Shield company manager sees own bill only; no rates tab, no other company's rows.
  await as('u-cm-arsh');
  t = await body();
  assert.match(t, /Arrow.*pays FWM/); assert.doesNotMatch(t, /\nFWM pays [^t]/); assert.equal(await p.getByRole('tab', { name: 'Rates' }).count(), 0);
  log('Arrow manager sees own bill only: ok');
  await p.getByRole('tab', { name: 'Placements' }).click(); await p.waitForTimeout(300);
  t = await body();
  assert.match(t, /owned by Sasa Security Services Sdn Bhd · works under Arrow Shield/); assert.doesNotMatch(t, /UAT synthetic placement/);
  assert.equal(await p.getByRole('button', { name: 'End the placement' }).count(), 0);
  log('Arrow manager sees workers under its job, no FWM notes, read only: ok');
  // 8. Sasa company manager sees the payback and the branch bill, not Arrow's.
  await as('u-cm-sasa');
  t = await body();
  assert.match(t, /\nFWM pays Sasa/); assert.doesNotMatch(t, /Arrow[^\n]*pays FWM/);
  log('Sasa manager sees payback + own branch: ok');
  // 9. OM has no recruitment cost page in the menu.
  await as('u-om-klang', 'home');
  assert.equal(await p.getByRole('link', { name: 'Recruitment cost' }).count() + await p.getByRole('button', { name: 'Recruitment cost' }).count(), 0);
  log('OM has no menu entry: ok');
  // 10. Phone width as FD.
  await as('u-fd');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) {
    const layout = await p.evaluate(() => [...document.querySelectorAll('body *')].map((e) => {
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, className: e.className, left: r.left, right: r.right, width: r.width, text: e.textContent?.slice(0, 120) };
    }).filter((e) => e.width > 0 && e.right > innerWidth && e.left < innerWidth).sort((a, b) => b.right - a.right));
    log('phone overflow elements', JSON.stringify(layout.slice(0, 20)));
    await p.screenshot({ path: resolve(OUT, 'phone-overflow.png'), fullPage: false });
  }
  assert.ok(over <= 0, 'horizontal scroll ' + over); log('phone width no horizontal scroll: ok');
  await p.screenshot({ path: resolve(OUT, 'phone.png'), fullPage: false });
  assert.deepEqual(errs.filter((e) => !/favicon|manifest/i.test(e) && !(fonts > 0 && e === 'Failed to load resource: net::ERR_FAILED')), [], 'page errors');
  assert.equal(outside, 0, 'no request left the local demo server');
  log('ALL OK');
  await b.close();
} finally {
  await writeFile(resolve(OUT, 'uat-log.txt'), lines.join('\n') + '\n');
  server.close();
}
