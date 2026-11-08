// Time slip browser walk-through (rule HR-TIME-SLIP) on the test version (apps/web/dist-demo), as staff, department
// head, company head and HR, at 1280 px and 390 px. Synthetic data only: no API, no external calls (blocked).
// Portable: run `npm run build -w @prima/core && npm run build:demo -w @prima/web`, then
//   PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node scripts/time-slip-browser-smoke.mjs
// (or with playwright installed, no PLAYWRIGHT_MODULE). Screenshots and results-<width>.json go to
// TIME_SLIP_UAT_DIR (default artifacts/time-slip-uat). Exits 1 if any check fails.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(root, 'apps/web/dist-demo');
const outDir = resolve(root, process.env.TIME_SLIP_UAT_DIR || 'artifacts/time-slip-uat');
await mkdir(outDir, { recursive: true });
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href) : createRequire(import.meta.url)('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = resolve(dist, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok, fail) => {
  server.once('error', fail);
  server.listen(0, '127.0.0.1', ok);
});
const origin = `http://127.0.0.1:${server.address().port}`;

async function walk(browser, W) {
  const out = [];
  const log = (k, v) => {
    out.push([k, !!v]);
    console.log(`${v ? 'PASS' : 'FAIL'}  ${W}px  ${k}`);
  };
  const ctx = await browser.newContext({ viewport: { width: W, height: W < 500 ? 844 : 900 }, deviceScaleFactor: 1 });
  const external = [];
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin === origin || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue(); external.push(u.origin); return r.abort(); });
  // English screens, and every made-up staff member may sign in (test version only).
  await ctx.addInitScript(() => {
    localStorage.setItem('prima.lang', 'en');
    localStorage.setItem('prima-demo-all-staff', '1');
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  let n = 0;
  const shot = async (name, full = false) => {
    const s = p.getByRole('heading', { name: 'Time slip', exact: true });
    if (!full && (await s.count())) await s.first().scrollIntoViewIfNeeded();
    n += 1;
    await p.screenshot({ path: `${outDir}/${W}-${String(n).padStart(2, '0')}-${name}.png`, fullPage: full });
  };
  const as = async (who) => {
    await p.goto(origin);
    await p.evaluate(() => localStorage.removeItem('prima-demo-user'));
    await p.goto(origin);
    await p.getByText(who, { exact: true }).first().click();
    await p.waitForTimeout(2000);
    const a = p.getByRole('button', { name: /accept|agree|setuju|terima/i });
    if (await a.count()) {
      await a.first().click();
      await p.waitForTimeout(600);
    }
  };
  const nav = async (label) => {
    for (let i = 0; i < 3; i++) {
      const c = p.getByRole('button', { name: 'Close', exact: true });
      if ((await c.count()) && (await c.first().isVisible())) {
        await c.first().click();
        await p.waitForTimeout(300);
      } else break;
    }
    const re = new RegExp(`^\\s*${label}\\s*$`);
    const vis = p.locator('nav button:visible, nav a:visible').filter({ hasText: re });
    if (await vis.count()) await vis.first().click();
    else {
      await p.locator('nav.tabs button', { hasText: 'More' }).click();
      await p.waitForTimeout(300);
      await p.locator('.sheet-item', { hasText: re }).first().evaluate((el) => el.click());
    }
    await p.waitForTimeout(1200);
  };
  const ask = async (from, to, reason) => {
    const open = p.getByRole('button', { name: 'Ask for a time slip' });
    if (await open.count()) {
      await open.click();
      await p.waitForTimeout(200);
    }
    await p.getByLabel('Out at').fill(from);
    await p.getByLabel('Back at').fill(to);
    await p.getByLabel('Reason', { exact: true }).last().fill(reason);
    await p.getByRole('button', { name: 'Send for approval' }).click();
    await p.waitForTimeout(1000);
  };
  const has = async (re) => (await p.getByText(re).count()) > 0;
  const slipsTab = async () => {
    await nav('Staff clock');
    await p.getByRole('button', { name: 'Time slips', exact: true }).click();
    await p.waitForTimeout(1200);
  };
  const approveFirst = async (note) => {
    await p.getByLabel(/Comment for/).first().fill(note);
    await p.getByRole('button', { name: 'Approve', exact: true }).first().click();
    await p.waitForTimeout(1000);
  };

  // 1. Central staff (IT Executive 3): limits, then a good slip.
  await as('IT Executive 3 (mock)');
  await nav('Clock');
  log('staff: approver shown as Department head', await has(/Approved by: Department head/));
  await ask('12:00', '17:00', 'Bank appointment');
  log('staff: over 4 hours refused', await has(/at most 4 hours/));
  await shot('staff-over-4h-refused');
  await ask('16:00', '18:00', 'Bank appointment');
  log('staff: outside office hours refused', await has(/office hours, 08:30 to 17:30/));
  await ask('14:00', '16:00', 'Bank appointment');
  log('staff: slip sent, waiting for approval', await has(/^Waiting for approval$/));
  await shot('staff-asked');
  await ask('15:00', '17:00', 'Second errand');
  log('staff: overlapping slip refused', await has(/already have a time slip/));
  // 2. Department head (IT Manager) approves; a comment is needed.
  await as('IT Manager (mock)');
  await nav('Clock');
  log('dept head: slip waiting for them', await has(/Waiting for you to approve/));
  await p.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await p.waitForTimeout(700);
  log('dept head: approve without comment refused', await has(/comment to approve/));
  await approveFirst('Fine, go');
  log('dept head: nothing left to approve', !(await has(/Waiting for you to approve/)));
  await shot('depthead-approved');
  // 3. Staff sees the approval and the make-up target.
  await as('IT Executive 3 (mock)');
  await nav('Clock');
  log('staff: approved with hours to work back', await has(/to work back by/));
  await shot('staff-approved');
  // 4. Company staff asks; their own company head approves; another company head sees nothing.
  await as('Siti Hajar binti Rosli');
  await nav('Clock');
  log('company staff: approver shown as Company head', await has(/Approved by: Company head/));
  await ask('10:00', '12:00', 'Child school meeting');
  log('company staff: slip sent', await has(/^Waiting for approval$/));
  await ask('13:00', '14:00', 'Post office');
  log('company staff: second slip sent', (await p.getByText(/^Waiting for approval$/).count()) === 2);
  await p.getByRole('button', { name: 'Cancel this slip' }).first().click();
  await p.waitForTimeout(800);
  log('company staff: cancelled own waiting slip', await has(/^Cancelled$/));
  await shot('companystaff-cancelled');
  await as('Nor Azlina binti Hashim');
  await nav('Clock');
  log('other company head: nothing to approve', !(await has(/Waiting for you to approve/)));
  await as('Kenny Lau Chee Wah');
  await nav('Clock');
  log('company head: slip waiting for them', await has(/Waiting for you to approve/));
  await shot('companyhead-waiting');
  await p.getByRole('button', { name: 'Refuse', exact: true }).first().click();
  await p.waitForTimeout(700);
  log('company head: refuse without reason refused', await has(/why the time slip is refused/));
  await approveFirst('Approved, cover with Farah');
  log('company head: approved', !(await has(/Waiting for you to approve/)));
  await slipsTab();
  log('company head board: own company slips only', (await has(/Siti Hajar binti Rosli ·/)) && !(await has(/IT Executive 3 \(mock\) ·/)));
  log('company head board: cannot change approver', !(await has(/^Change to/)));
  await shot('companyhead-board', true);
  // 5. HR: told of both approvals, marks seen, changes who approves with a reason, approves, and changes it back.
  await as('PWVSB HR');
  await slipsTab();
  log('HR: both approvals shown as new', (await p.getByRole('button', { name: 'Mark seen' }).count()) === 2);
  // Two approved slips of 2 hours each, nothing worked back yet: the KPI shows 4 h (hours, not a count of slips).
  const kpi = (await p.locator('.kpi', { hasText: 'Hours still to work back' }).innerText()).replace(/\s+/g, ' ');
  log(`HR: KPI shows 4 h still to work back across 2 slips (saw "${kpi}")`, /Hours still to work back 4 h 2 slips/i.test(kpi));
  await shot('hr-board', true);
  await p.getByRole('button', { name: 'Mark seen' }).first().click();
  await p.waitForTimeout(800);
  log('HR: mark seen', (await p.getByRole('button', { name: 'Mark seen' }).count()) === 1);
  await p.getByRole('button', { name: /^Change to HR approves/ }).click();
  await p.waitForTimeout(700);
  log('HR: change without reason refused', await has(/reason for the change/i));
  await p.getByLabel('Reason for the change').fill('Pilot: HR approves for now');
  await p.getByRole('button', { name: /^Change to HR approves/ }).click();
  await p.waitForTimeout(1000);
  log('HR: setting now HR', await has(/set by PWVSB HR/));
  await as('Siti Hajar binti Rosli');
  await nav('Clock');
  log('company staff: approver now HR', await has(/Approved by: HR/));
  await ask('09:00', '10:00', 'Clinic check-up');
  await shot('companystaff-hr-approver');
  await as('PWVSB HR');
  await nav('Clock');
  log('HR: slip waiting for HR on own Clock screen', await has(/Waiting for you to approve/));
  await approveFirst('OK by HR');
  log('HR: approved', !(await has(/Waiting for you to approve/)));
  log('HR: own slip goes to HR Director', await has(/Approved by: HR Director/));
  await slipsTab();
  await p.getByLabel('Reason for the change').fill('Back to the default');
  await p.getByRole('button', { name: /^Change to company or department head/ }).click();
  await p.waitForTimeout(1000);
  log('HR: setting back to head', await has(/the company head \(company staff\) or the department head/));
  log('no page errors', errs.length === 0);
  // The page's web-font stylesheet is blocked like everything else; it is styling only, not data.
  log('no external calls except the blocked web font (all blocked)', external.every((o) => o === 'https://fonts.googleapis.com' || o === 'https://fonts.gstatic.com'));
  if (external.length) console.log('external tried:', [...new Set(external)]);
  if (errs.length) console.log(errs.slice(0, 3));
  await writeFile(`${outDir}/results-${W}.json`, JSON.stringify(out, null, 1));
  await ctx.close();
  return out;
}

let browser;
let failed = 0;
try {
  browser = await chromium.launch({ headless: true });
  for (const W of [1280, 390]) failed += (await walk(browser, W)).filter(([, ok]) => !ok).length;
} finally {
  await browser?.close();
  server.close();
}
console.log(failed ? `time slip walk-through: ${failed} check(s) failed` : 'time slip walk-through: all checks passed at 1280 px and 390 px');
if (failed) process.exitCode = 1;
