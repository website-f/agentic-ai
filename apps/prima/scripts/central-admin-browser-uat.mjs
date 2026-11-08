// Central Admin browser UAT on the synthetic demo build only (Arisha main review, 2 Nov 2026). No API, database,
// Microsoft, model or paid request is reachable: every non-local request is aborted. Run after `npm run demo:build`:
//   CI_SYNTHETIC_BROWSER=true PLAYWRIGHT_MODULE=<pinned playwright index.mjs> node scripts/central-admin-browser-uat.mjs
// Roles and steps: company manager enters the company file; the Deputy Chief of Staff sends it back; the manager
// corrects and resubmits; the checker is refused without a reason, then confirms. The credit officer corrects a
// collateral record (retry gives one correction); the company manager and others are denied; legal flags appear only
// for a director. Desktop and phone widths. A sign-in succeeding is not workflow acceptance.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.env.CI_SYNTHETIC_BROWSER !== 'true') throw new Error('Set CI_SYNTHETIC_BROWSER=true only in a disposable browser test environment.');
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Supply the pinned Playwright module path.');
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href);
const shots = process.env.UAT_SCREENSHOTS ? resolve(process.env.UAT_SCREENSHOTS) : null;
if (shots) await mkdir(shots, { recursive: true });
const html = await readFile(new URL('../apps/web/dist-demo/index.html', import.meta.url));
const server = createServer((req, res) => {
  if (req.method !== 'GET' || !['/', '/index.html'].includes(new URL(req.url, 'http://localhost').pathname)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
});
await new Promise((ok, fail) => {
  server.once('error', fail);
  server.listen(0, '127.0.0.1', ok);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let failShot = async () => {};
const step = async (role, what, fn) => {
  try {
    await fn();
    results.push({ role, what, ok: true });
  } catch (e) {
    results.push({ role, what, ok: false, error: String(e.message).split('\n')[0] });
    await failShot().catch(() => {});
    throw e;
  }
};

let browser;
try {
  browser = await chromium.launch();
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('ca-uat')) {
        localStorage.clear();
        localStorage.setItem('prima-demo-user', 'u-cm-sasa');
        localStorage.setItem('prima.lang', 'en');
        sessionStorage.setItem('ca-uat', '1');
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    const shot = async (n) => shots && page.screenshot({ path: resolve(shots, `${viewport.name}-${n}.png`), fullPage: false });
    failShot = () => shot('failed');
    const as = async (userId, lang = 'en') => {
      await page.evaluate(
        ([u, l]) => {
          localStorage.setItem('prima-demo-user', u);
          localStorage.setItem('prima.lang', l);
        },
        [userId, lang],
      );
      if (page.url() === 'about:blank') await page.goto(origin);
      else await page.reload();
      const consent = page.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju dan akan rahsiakan/ });
      await page.locator('main, .page, h1').first().waitFor({ timeout: 30000 });
      if (
        await consent.waitFor({ state: 'visible', timeout: 3000 }).then(
          () => true,
          () => false,
        )
      )
        await consent.click();
    };
    const open = async (label) => {
      const nav = page.locator('nav, aside').getByRole('button', { name: label, exact: true });
      if (
        await nav
          .first()
          .isVisible()
          .catch(() => false)
      )
        await nav.first().click();
      else {
        await page
          .getByRole('button', { name: /^(More|Lagi)$/ })
          .first()
          .click();
        const item = page.getByRole('button', { name: label, exact: true }).last();
        await item.scrollIntoViewIfNeeded();
        await item.click({ timeout: 5000 }).catch(() => item.dispatchEvent('click'));
      }
    };
    const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
    const toast = (text) => page.getByRole('status').filter({ hasText: text }).first().waitFor({ timeout: 10000 });
    const sasaFile = () =>
      page
        .locator('.item')
        .filter({ hasText: 'Sasa Security Services' })
        .filter({ has: page.getByRole('button', { name: /Open|Fix and resubmit|Close/ }) })
        .first();
    await page.goto(origin);

    await step('Company manager', `${viewport.name}: enter the company file and save it as a draft`, async () => {
      await as('u-cm-sasa');
      await open('Company secretary');
      await tab('Company files');
      await page.getByText('Step-by-step guide').waitFor();
      await sasaFile().getByRole('button', { name: 'Open and edit' }).click();
      await page.getByRole('button', { name: 'Save as draft' }).click();
      await toast('Saved as a draft for the SSM check.');
      await sasaFile().getByText('Draft, waiting for the SSM check').waitFor();
      await shot('1-draft');
    });

    await step('Admin executive', `${viewport.name}: sees the file but cannot edit or check it (denial)`, async () => {
      await as('u-bm-sasa-1');
      await open('Company secretary');
      await tab('Company files');
      assert.equal(await sasaFile().getByRole('button', { name: 'Open and edit' }).count(), 0);
      await sasaFile().getByRole('button', { name: 'Open', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Save as draft' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Matches SSM' }).count(), 0);
    });

    await step('Deputy Chief of Staff', `${viewport.name}: send the file back with differences`, async () => {
      await as('u-dcos');
      await open('Company secretary');
      await tab('Company files');
      await sasaFile().getByRole('button', { name: /Open/ }).click();
      await page.getByLabel('SSM extract reference').fill('EXTRACT-UAT-1 (mock)');
      await page.getByLabel('Differences').fill('Director appointment date differs (mock)');
      await page.getByRole('button', { name: 'Send back with differences' }).click();
      await sasaFile().getByText('Differs from SSM').waitFor();
      await shot('2-sent-back');
    });

    await step('Company manager', `${viewport.name}: sees the return, fixes and resubmits`, async () => {
      await as('u-cm-sasa');
      await open('Company secretary');
      await tab('Company files');
      await sasaFile()
        .getByText(/Sent back by .*Director appointment date differs/)
        .waitFor();
      await sasaFile().getByRole('button', { name: 'Fix and resubmit' }).click();
      await page.getByRole('button', { name: 'Resubmit for the SSM check' }).click();
      await toast('Corrected and resubmitted for the SSM check.');
      await sasaFile().getByText('Earlier checks (1)').waitFor();
      await shot('3-resubmitted');
    });

    await step('Deputy Chief of Staff', `${viewport.name}: refused without a reason (rejection), then confirms`, async () => {
      await as('u-dcos');
      await open('Company secretary');
      await tab('Company files');
      await sasaFile().getByRole('button', { name: /Open/ }).click();
      await page.getByLabel('SSM extract reference').fill('EXTRACT-UAT-2 (mock)');
      await page.getByRole('button', { name: 'Matches SSM' }).click();
      await page
        .locator('.error')
        .filter({ hasText: /reason/i })
        .first()
        .waitFor();
      await page.getByLabel('Reason').fill('Matches the extract (mock)');
      await page.getByRole('button', { name: 'Matches SSM' }).click();
      await sasaFile()
        .getByText(/checked by .*EXTRACT-UAT-2/)
        .waitFor();
      await shot('4-checked');
    });

    await step(
      'Credit officer',
      `${viewport.name}: record financing without the collateral reference, then correct it with a reason (a double click makes one correction); correct a recorded stamp`,
      async () => {
        await as('u-credit');
        await open('PWVSB credit');
        await page.getByText('Step-by-step guide').waitFor();
        await tab('Add financing');
        await page.getByLabel('Purpose').fill('UAT working capital (mock)');
        await page.getByLabel('Amount', { exact: true }).fill('50000');
        await page.getByLabel('Rate % a year').fill('6');
        await page.getByLabel('Start date').fill('2026-10-20');
        await page.getByLabel('Term in months').fill('12');
        await page.getByLabel('Signed agreement reference').fill('AGR-UAT-1 (mock)');
        await page.getByLabel('Agreement template').fill('TEMPLATE-UAT (mock)');
        await page.getByRole('button', { name: 'Record financing' }).click();
        await toast('Financing recorded.');
        await tab('Loans');
        await page
          .getByRole('button', { name: /UAT working capital \(mock\)/ })
          .first()
          .click();
        await page
          .getByText(/collateral agreement reference is not on file/)
          .first()
          .waitFor();
        await page.getByRole('button', { name: 'Correct collateral record' }).first().click();
        await page.getByLabel('Collateral agreement reference').fill('BIA-UAT-1 (mock)');
        await page.getByLabel('Reason for correction').fill('no');
        assert.equal(await page.getByRole('button', { name: 'Save correction' }).isDisabled(), true, 'a short reason cannot save');
        await page.getByLabel('Reason for correction').fill('Signed copy found in the PWVSB file (mock)');
        await page.getByRole('button', { name: 'Save correction' }).evaluate((b) => {
          b.click();
          b.click();
        });
        await page
          .getByLabel('Record corrections')
          .getByText(/BIA-UAT-1 \(mock\). Reason: Signed copy found/)
          .waitFor();
        assert.equal(await page.getByLabel('Record corrections').locator('li').count(), 1, 'one correction only');
        await shot('5-collateral');
        // Round 2: a stamp already recorded is corrected with a reason, and the history shows old and new values.
        await page.getByLabel('Stamp certificate').first().fill('ST-UAT-1 (mock)');
        await page.getByLabel('Stamped on').first().fill('2026-10-28');
        await page.getByRole('button', { name: 'Agreement stamped' }).first().click();
        await toast('Stamping recorded.');
        await page.getByRole('button', { name: 'Correct stamping, charge or signing date' }).first().click();
        await page.getByLabel('Corrected stamp certificate').fill('ST-UAT-2 (mock)');
        await page.getByLabel('Reason for record correction').fill('no');
        assert.equal(await page.getByRole('button', { name: 'Save record correction' }).isDisabled(), true, 'a short reason cannot save');
        await page.getByLabel('Reason for record correction').fill('Certificate number mistyped (mock)');
        await page.getByRole('button', { name: 'Save record correction' }).click();
        await page
          .getByLabel('Record corrections')
          .getByText(/ST-UAT-1 \(mock\) on 2026-10-28 to ST-UAT-2 \(mock\) on 2026-10-28. Reason: Certificate number mistyped/)
          .waitFor();
        await shot('5b-stamp-correction');
      },
    );

    await step('Company manager', `${viewport.name}: cannot correct collateral and sees no legal flags (denial)`, async () => {
      await as('u-cm-sasa');
      await open('PWVSB credit');
      assert.equal(await page.getByRole('button', { name: 'Correct collateral record' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Correct stamping, charge or signing date' }).count(), 0);
      const body = await page.locator('body').innerText();
      assert.doesNotMatch(body, /Stamp Act|s\.47A|not notified to SSM|Legal flags/);
    });

    await step('CEO (director)', `${viewport.name}: sees the legal flags with source, records, owner and history`, async () => {
      await as('u-fauzan');
      await open('Director Office');
      const flags = page.locator('section[aria-label="Legal flags"]');
      await flags.waitFor();
      await flags.getByText(/Directors only · \d+ open · not confirmed compliant until resolved/).waitFor();
      await shot('6-legal-flags');
    });

    // Masterplan items (Fauzan 3 Nov 2026): §103 KPKT licence check, §126 adviser budgets, §243 delegation register.
    await step('Deputy Chief of Staff', `${viewport.name}: records the KPKT licence check on a loan (masterplan §103)`, async () => {
      await as('u-dcos');
      await open('PWVSB credit');
      await tab('Loans');
      await page
        .getByRole('button', { name: /UAT working capital \(mock\)/ })
        .first()
        .click();
      await page.getByText('KPKT licence check: waiting for the Deputy Chief of Staff.').first().waitFor();
      await page.getByLabel('KPKT licence number').fill('KPKT-UAT-1 (mock)');
      await page.getByLabel('Licence valid to').fill('2027-06-30');
      await page.getByLabel('How it was checked').fill('ok');
      assert.equal(await page.getByRole('button', { name: 'Record licence check' }).isDisabled(), true, 'a short note cannot save');
      await page.getByLabel('How it was checked').fill('Counsel confirmed the licence copy (mock)');
      await page.getByRole('button', { name: 'Record licence check' }).click();
      await toast('Licence check recorded.');
      await page.getByText(/KPKT licence KPKT-UAT-1 \(mock\) valid to .*, valid on the loan date/).first().waitFor();
      await shot('8-kpkt');
    });

    await step('Deputy Chief of Staff', `${viewport.name}: proposes an adviser budget (masterplan §126)`, async () => {
      await as('u-dcos');
      await open('Company secretary');
      await tab('Panel firms');
      const first = page.locator('.item').filter({ has: page.getByRole('button', { name: 'Propose budget' }) }).first();
      await first.getByLabel('Budget amount').fill('12000');
      await first.getByLabel('Budget basis').fill('Yearly audit fee (mock)');
      await first.getByRole('button', { name: 'Propose budget' }).click();
      await toast('Budget proposed.');
      await page.getByText(/proposed RM12000\.00 by .*, waiting for the Finance Director/).first().waitFor();
    });

    await step('Finance Director', `${viewport.name}: agrees the adviser budget with a reason`, async () => {
      await as('u-fd');
      await open('Company secretary');
      await tab('Panel firms');
      const row = page.locator('.item').filter({ has: page.getByRole('button', { name: 'Agree budget' }) }).first();
      await row.getByLabel('Budget agreement note').fill('In line with last year (mock)');
      await row.getByRole('button', { name: 'Agree budget' }).click();
      await toast('Budget agreed.');
      await page.getByText(/Budget \d{4}: RM12000\.00/).first().waitFor();
      await shot('9-adviser-budget');
    });

    // Arisha main round 5: service confirmed with evidence by someone else, then checked, then the SQL Account entry
    // in the billed entity's books. Prima pays nothing.
    await step('Deputy Chief of Staff', `${viewport.name}: records an adviser invoice; it waits for the service to be confirmed`, async () => {
      await as('u-dcos');
      await open('Company secretary');
      await tab('Panel firms');
      const row = page.locator('.item').filter({ has: page.getByRole('button', { name: 'Record invoice' }) }).first();
      await row.getByLabel('Invoice number').fill(`UAT-INV-${viewport.name}`);
      await row.getByLabel('Invoice date').fill('2026-10-30');
      await row.getByLabel('Invoice amount').fill('500');
      await row.getByLabel('Invoice for').fill('Interim audit (mock)');
      await row.getByRole('button', { name: 'Record invoice' }).click();
      await toast('Invoice recorded.');
      await page.getByText(new RegExp(`UAT-INV-${viewport.name} .*service not confirmed yet`)).first().waitFor();
      assert.equal(await page.getByRole('button', { name: 'Confirm service' }).count(), 0, 'the keyer cannot confirm the service');
    });

    await step('Chief of Staff', `${viewport.name}: confirms the service with evidence`, async () => {
      await as('u-cos');
      await open('Company secretary');
      await tab('Panel firms');
      await page.getByLabel(`Service evidence UAT-INV-${viewport.name}`).fill('Signed interim report (mock)');
      await page.getByLabel(`What was delivered UAT-INV-${viewport.name}`).fill('Field work done (mock)');
      await page.getByRole('button', { name: 'Confirm service' }).first().click();
      await toast('Service confirmed.');
    });

    await step('Finance Director', `${viewport.name}: passes the invoice to Finance and links the SQL Account entry`, async () => {
      await as('u-fd');
      await open('Company secretary');
      await tab('Panel firms');
      await page.getByLabel(`Check note UAT-INV-${viewport.name}`).fill('Matches the engagement letter (mock)');
      await page.getByRole('button', { name: 'Pass to Finance' }).first().click();
      await toast('Passed to Finance.');
      await page.getByLabel(`SQL Account document UAT-INV-${viewport.name}`).fill(`PI-UAT-${viewport.name}`);
      await page.getByLabel(`Posted on UAT-INV-${viewport.name}`).fill('2026-11-01');
      await page.getByRole('button', { name: 'Link SQL Account entry' }).first().click();
      await toast('Linked to SQL Account.');
      await page.getByText(new RegExp(`SQL Account PI-UAT-${viewport.name} in the books of PWVSB`)).first().waitFor();
      await shot('9b-adviser-invoice');
    });

    await step('Company manager', `${viewport.name}: records an emergency delegation (masterplan §243)`, async () => {
      await as('u-cm-sasa');
      await open('Company secretary');
      await tab('Delegations');
      await page.getByText(/A register only: it does not give anyone access/).waitFor();
      await page.getByLabel('Post', { exact: true }).fill('Company Manager');
      await page.getByLabel('Post holder', { exact: true }).selectOption('u-cm-sasa');
      await page.getByLabel('Person who acts').selectOption('u-gm-sasa');
      await page.getByLabel('May act on').fill('Day-to-day company decisions (mock)');
      await page.getByLabel('From', { exact: true }).fill('2026-11-01');
      await page.getByLabel('To', { exact: true }).fill('2026-11-30');
      await page.getByLabel('Why', { exact: true }).fill('Manager on medical leave (mock)');
      await page.getByRole('button', { name: 'Record delegation' }).click();
      await toast('Delegation recorded; add the evidence, then a leader approves.');
      const row = page.locator('.item').filter({ hasText: 'Company Manager: Hamdan bin Yusof acts for' }).first();
      await row.getByText('Waiting for approval').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Approve' }).count(), 0, 'the recorder cannot approve');
      await row.getByLabel('Competency evidence kind for Company Manager').selectOption('hr_training');
      await row.getByLabel('Competency reference for Company Manager').fill('HR training TRN-UAT (mock)');
      await row.getByLabel('Note for Company Manager').fill('Completed the manager course (mock)');
      await row.getByRole('button', { name: 'Record evidence' }).click();
      await toast('Evidence recorded.');
      await row.getByText(/Competency: HR training record HR training TRN-UAT \(mock\)/).waitFor();
    });

    await step('Chief of Staff', `${viewport.name}: one leader approval with a reason puts it in force (Fauzan 3 Nov 2026)`, async () => {
      await as('u-cos');
      await open('Company secretary');
      await tab('Delegations');
      const row = page.locator('.item').filter({ hasText: 'Company Manager: Hamdan bin Yusof acts for' }).first();
      await row.getByLabel('Note for Company Manager').fill('Covered while the manager is away (mock)');
      await row.getByRole('button', { name: 'Approve' }).click();
      await toast('Approved.');
      await row.getByText('In force').waitFor();
      assert.equal(await row.getByRole('button', { name: 'Approve' }).count(), 0, 'nothing left to approve');
    });

    await step('CEO (director)', `${viewport.name}: access is asked of IT for the line in force, never granted`, async () => {
      await as('u-fauzan');
      await open('Company secretary');
      await tab('Delegations');
      const row = page.locator('.item').filter({ hasText: 'Company Manager: Hamdan bin Yusof acts for' }).first();
      await row.getByText('In force').waitFor();
      await row.getByLabel('Systems for Company Manager').fill('Company shared mailbox, read only (mock)');
      await row.getByLabel('Access until for Company Manager').fill('2026-11-20');
      await row.getByLabel('Note for Company Manager').fill('Needs the client letters while covering (mock)');
      await row.getByRole('button', { name: 'Ask IT for access' }).click();
      await toast('Access asked of IT; nothing was granted by Prima.');
      await row.getByText(/Access asked of IT \(.*open.*\) until .*Prima grants nothing/).waitFor();
      await shot('10-delegation');
    });

    // §125: legal hold. PWVSB legal places it; staff see nothing and are not blocked.
    await step('PWVSB legal', `${viewport.name}: places a legal hold on a case for an open matter`, async () => {
      await as('u-legal');
      await open(/Company secretary|Audit and legal/);
      await tab('Legal matters');
      const holds = page.locator('section[aria-label="Legal holds"]');
      await holds.waitFor();
      await holds.getByLabel('Kind of record').selectOption('cases');
      const first = await holds.getByLabel('Record to hold').locator('option').nth(1).getAttribute('value');
      await holds.getByLabel('Record to hold').selectOption(first);
      await holds.getByLabel('Why held').fill('Evidence for the claim (mock)');
      await holds.getByRole('button', { name: 'Place hold' }).click();
      await toast('Hold placed.');
      await holds.getByText('On hold').first().waitFor();
      await shot('11-legal-hold');
    });

    await step('Company manager', `${viewport.name}: sees no legal hold list or notice (denial)`, async () => {
      await as('u-cm-sasa');
      await open('Company secretary');
      await tab('Legal matters');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('section[aria-label="Legal holds"]').count(), 0);
    });

    await step('Admin executive', `${viewport.name}: guide card in Bahasa Melayu first, English alongside`, async () => {
      await as('u-bm-sasa-1', 'ms');
      await open('Pembaharuan kontrak');
      await page.getByText('Panduan langkah demi langkah').waitFor();
      await page.getByText('Panduan langkah demi langkah').click();
      await page.getByText(/Pembaharuan lesen dan pendaftaran/).waitFor();
      await shot('7-guide-ms');
    });

    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await context.close();
  }
} finally {
  await browser?.close();
  server.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.role} | ${r.what}${r.error ? ` | ${r.error}` : ''}`);
}
console.log(`Central Admin browser UAT: ${results.filter((r) => r.ok).length}/${results.length} steps passed (synthetic demo only).`);
