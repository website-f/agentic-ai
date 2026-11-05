// Run: npm run build -w @prima/cms; node scripts/cms-restart-uat.cjs apps/cms <out-dir>. Local only, port 8098, not wired to CI.
// Browser check of masterplan §193 and §195 in the CMS app: an operator acknowledges an alarm, the hub is stopped and
// started again from its saved state folder, and the alarm, the operator's action and the KPIs are still there.
// Synthetic sample directory; the state folder is a new temporary folder.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const D = path.resolve(process.argv[2], 'dist/src');
const OUT = process.argv[3];
const { Hub } = require(D + '/hub.js');
const { demoDirectory } = require(D + '/demo.js');
const { makeEvent } = require(D + '/event.js');
const { startHttp } = require(D + '/server.js');
const { StateStore } = require(D + '/persist.js');
const { GateLists } = require(D + '/adaptors/anpr.js');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const key = 'uat-operator-key-0123456789abcdef';
const cfg = { operators: new Map([[key, 'UAT operator']]), gateway: { key: 'g'.repeat(24), secret: 's'.repeat(24) }, prima: { key: 'p'.repeat(24), secret: 'q'.repeat(24) } };
const serve = (hub, store) => {
  const lists = new GateLists();
  return startHttp(cfg, { hub, lists, routes: new Map(), persist: () => store.save(hub, { ...lists.exportLists(), routes: [] }) }, 8098);
};
(async () => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-uat-state-'));
  const dir = demoDirectory();
  let store = new StateStore(dirPath);
  store.lock();
  let hub = new Hub(dir);
  const sites = dir.sites.filter((s) => dir.devices.some((d) => d.siteId === s.id)).slice(0, 2);
  ['uat-a', 'uat-b'].forEach((id, i) => { const site = sites[i]; const dev = dir.devices.find((d) => d.siteId === site.id); hub.ingest(makeEvent({ id, kind: 'INTRUSION', companyId: site.companyId, siteId: site.id, deviceId: dev.id, source: 'uat', summary: 'Intrusion ' + id, detail: {} })); });
  store.save(hub);
  let srv = serve(hub, store);
  const res = []; const ok = (n) => { res.push(n); console.log('ok ' + res.length + ' ' + n); };
  const b = await chromium.launch();
  for (const width of [1280, 390]) {
    const p = await b.newPage({ viewport: { width, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:8098/');
    await p.fill('#token', key); await p.click('#signin button');
    await p.waitForSelector('#queue tr');
    if (width === 1280) {
      await p.locator('#queue tr', { hasText: 'Intrusion uat-a' }).getByRole('button', { name: 'Acknowledge' }).click();
      await p.waitForTimeout(400);
      assert.ok(fs.readFileSync(path.join(dirPath, 'audit.jsonl'), 'utf8').includes('"acknowledge"'));
      ok('The acknowledgement is in the append-only audit journal before the screen updates');
      // Stop the hub and start it again from the saved folder.
      await new Promise((r) => srv.close(r));
      store.unlock();
      store = new StateStore(dirPath);
      store.lock();
      hub = store.load().hub;
      srv = serve(hub, store);
      await p.reload();
      await p.waitForSelector('#queue tr');
    }
    const row = p.locator('#queue tr', { hasText: 'Intrusion uat-a' });
    await row.waitFor();
    assert.match(await row.innerText(), /acknowledged/);
    assert.match(await row.innerText(), /CMS restarted at/);
    ok(`${width}px: after the restart the alarm is still open, still acknowledged, with a "CMS restarted" line`);
    await p.waitForSelector('#kpis tr');
    const kpi = await p.locator('#kpis').innerText();
    assert.match(kpi, /Alarms\s+2/);
    assert.match(await p.locator('#kpiDevices').innerText(), /unknown is never green/);
    ok(`${width}px: the response KPIs show both alarms and the devices CMS has not heard from as unknown`);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'page scrolls sideways');
    await p.locator('#kpis').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${OUT}/cms-restart-${width}.png` });
    assert.equal(errs.length, 0, errs.join('; '));
    await p.close();
  }
  await b.close();
  await new Promise((r) => srv.close(r));
  store.unlock();
  fs.rmSync(dirPath, { recursive: true, force: true });
  console.log(`${res.length}/5 passed`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
