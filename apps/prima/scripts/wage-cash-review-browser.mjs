// Synthetic wage-cash reapproval UI only; no external services or worker data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { generateDataset, MemoryStore, PrimaService, myt } = require('../packages/core/dist');
if (process.env.CI_SYNTHETIC_BROWSER !== 'true' || !process.env.PLAYWRIGHT_MODULE) throw Error('Synthetic browser opt-in required');
const day = '2026-11-05', at = myt(day, '10:00');
const ds = generateDataset({ today: day, now: at, daysBack: 40 });
const svc = new PrimaService(new MemoryStore(ds), () => at);
const run = await svc.prepareGuardPay(await svc.user('u-pwvsb-hr'), 'co-arsh', '2026-10', []);
const guard = run.lines.find(l => l.net > 100);
assert(guard);
const log = [
  { userId: 'u-pwvsb-hr', op: 'prepareGuardPay', args: ['co-arsh', '2026-10', []], made: 'synthetic-run' },
  { userId: 'u-pwvsb-doa', op: 'guardPayCash', args: ['synthetic-run', guard.personId, 'list', { reason: 'Synthetic wage cash request' }] },
  { userId: 'u-fauzan', op: 'guardPayCash', args: ['synthetic-run', guard.personId, 'decide', { give: true, reason: 'Original named amount approved' }] },
  { userId: 'u-pwvsb-hr', op: 'setGuardPayLine', args: ['synthetic-run', guard.personId, { pcb: guard.pcb + 1 }] },
].map(c => ({ day, at, ...c }));
const html = await readFile(new URL('../apps/web/dist-demo/index.html', import.meta.url));
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true });
const out = new URL('../artifacts/wage-cash-review/', import.meta.url); await mkdir(out, { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.clock.setFixedTime(new Date(at));
    const errors = []; let external = 0;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => {
      const u = new URL(r.request().url());
      if (u.origin === origin) return r.continue();
      if (u.origin !== 'https://fonts.googleapis.com') external++;
      return r.abort();
    });
    await page.goto(origin);
    await page.evaluate(log => {
      localStorage.setItem('prima-demo-log-v1', JSON.stringify(log));
      localStorage.setItem('prima-demo-user', 'u-pwvsb-doa');
      localStorage.setItem('prima-demo-all-staff', '1');
    }, log);
    await page.reload();
    await page.getByRole('button', { name: /Saya setuju|I agree/ }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: 'EN', exact: true }).click({ timeout: 1000 }).catch(() => {});
    await page.getByRole('button', { name: 'Guard pay', exact: true }).first().click();
    await page.getByRole('button', { name: /^October 2026: Draft with HR/ }).first().click();
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'How it is paid', exact: true }) });
    await panel.getByRole('heading', { name: 'How it is paid', exact: true }).waitFor();
    await page.setViewportSize({ width, height: 1000 });
    await panel.getByLabel('Reason for replacing unpaid cash listing').fill('Corrected PCB needs fresh CEO approval');
    await panel.getByRole('button', { name: 'Replace and request fresh CEO approval', exact: true }).click();
    await panel.getByText('Waiting for the CEO', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Replace and request fresh CEO approval', exact: true }).count(), 0);
    await panel.locator('summary').filter({ hasText: 'Previous unpaid cash listings (1)' }).click();
    assert.match(await panel.innerText(), /Original named amount approved/);
    assert.match(await panel.innerText(), /Corrected PCB needs fresh CEO approval/);
    await panel.screenshot({ path: new URL(`wage-cash-${width}.png`, out).pathname });
    assert.deepEqual(errors, []); assert.equal(external, 0);
    await page.close();
    console.log(`PASS ${width}px: corrected unpaid cash → DOA replacement → fresh CEO pending; original decision visible; no replay button or external requests.`);
  }
} finally { await browser.close(); server.close(); }
