// Synthetic browser UAT of vacancy job posts and the applicant list (rule HR-JOB-ADVERT, Fauzan 5 Nov 2026).
// Run: build the demo with the IT-pilot sign-in limit off in a local copy only (RULES.pilot.value.on = false; never
// commit that), serve it on 127.0.0.1:4179 (npx vite preview --outDir <dir> --port 4179), then:
//   node scripts/hr-job-posts-browser-uat.cjs <screenshot-dir>
// Demo build only: synthetic people, no backend, every request outside the local preview is blocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ? require('node:path').dirname(process.env.PLAYWRIGHT_MODULE) : 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4179';
const S = process.argv[2] || '.';
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const TAG = 'UAT synthetic';

(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const viewport of [{ width: 1400, height: 1000 }, { width: 390, height: 844 }]) {
    const w = viewport.width;
    console.log(`\n== viewport ${w}px ==`);
    // Malaysia time zone, so an interview typed as 10:00 must come back as 10:00 after the server stores it in UTC.
    const ctx = await b.newContext({ viewport, timezoneId: 'Asia/Kuala_Lumpur' });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const external = [];
    await p.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.origin === BASE) return r.continue();
      // The app's web-font stylesheet is blocked too; it is not part of this feature and carries no data.
      if (!/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) external.push(u.origin);
      return r.abort();
    });
    await p.goto(BASE + '/');
    // Screen language English for stable button names (the default BM+English mix is checked by screenshot only).
    await p.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('prima.lang', 'en');
    });
    await p.reload();
    const shot = (name) => p.screenshot({ path: `${S}/${w}-${name}.png`, fullPage: false });
    const as = async (who) => {
      if (!(await p.locator('.persona').count())) await p.getByRole('button', { name: /Switch person|Tukar user|Tukar pengguna/ }).first().click();
      await p.waitForSelector('.persona');
      await p.locator('.persona', { hasText: who }).first().click();
      await p.waitForTimeout(1500);
      const ok = p.getByRole('button', { name: /I agree and will keep it confidential|Saya setuju/ });
      if (await ok.count()) {
        await ok.click();
        await p.waitForTimeout(500);
      }
    };
    const nav = async (names) => {
      const visible = async () => {
        for (const n of names) for (const x of await p.getByRole('button', { name: n, exact: true }).all()) if (await x.isVisible()) return x;
        return null;
      };
      let btn = await visible();
      if (!btn) {
        const more = p.getByRole('button', { name: 'More', exact: true });
        if (await more.count()) {
          await more.last().click();
          await p.waitForTimeout(500);
        }
        btn = await visible();
      }
      if (!btn) throw new Error('No visible button ' + names.join('/'));
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 3000 }).catch(() => btn.evaluate((e) => e.click()));
      await p.waitForTimeout(1200);
    };
    const vac = (title) => p.locator('.list-item', { hasText: title }).first();
    const text = () => p.$eval('.page', (e) => e.innerText);

    // 1. HR raises a guard vacancy (Arrow Shield, Selangor) and a central staff vacancy.
    await as('PWVSB HR');
    await nav(['HR monitor', 'HR']);
    const raise = async (employer, title, kind, state) => {
      const panel = p.locator('section.panel', { has: p.getByRole('heading', { name: 'Vacancies', exact: true }) });
      await panel.getByRole('button', { name: 'Raise a vacancy' }).click();
      const sel = panel.getByLabel('Employer');
      const opt = await sel.locator('option', { hasText: employer }).first().getAttribute('value');
      await sel.selectOption(opt);
      await panel.getByLabel('Job title').fill(title);
      await panel.getByLabel('Kind of post').selectOption(kind);
      if (state) await panel.getByLabel('State').selectOption(state);
      await panel.getByLabel('How many').fill('2');
      await panel.getByLabel('Pay from').fill('1800');
      await panel.getByLabel('Pay to').fill('2100');
      await panel.getByLabel('Why the post is needed').fill(`${TAG}: new site`);
      await panel.getByRole('button', { name: 'Send to the CEO' }).click();
      await p.waitForTimeout(1000);
    };
    const GUARD = `Guard ${w}`;
    const CLERK = `Clerk ${w}`;
    await raise('Arrow Shield', GUARD, 'guard', 'Selangor');
    await raise('PWVSB (central)', CLERK, 'staff', null);
    let t = await text();
    step('HR raises a guard vacancy with its state, and a central staff vacancy', t.includes(GUARD) && t.includes(CLERK) && /patrolling officer|guard, Selangor/.test(t));

    // 2. The CEO approves both; the company head signs the guard post, the HR Director the central post.
    await as('Fauzan');
    await nav(['HR monitor', 'HR', 'People']);
    for (const title of [GUARD, CLERK]) {
      const it = vac(title);
      await it.getByLabel(`Comment on ${title}`).fill('Approved (synthetic)');
      await it.getByRole('button', { name: 'Approve', exact: true }).click();
      await p.waitForTimeout(900);
    }
    await as('Kenny Lau');
    await nav(['Company today', 'Company']);
    {
      const it = vac(GUARD);
      await it.getByLabel(`Comment on ${GUARD}`).fill('Signed (synthetic)');
      await it.getByRole('button', { name: 'Sign the approval' }).click();
      await p.waitForTimeout(900);
    }
    t = await text();
    step('company head signs the guard vacancy', /open/.test(await vac(GUARD).innerText()));
    step('company manager sees no applicant list', !(await vac(GUARD).getByRole('button', { name: /^Applicants/ }).count()));
    await as('Aisyah binti Rahman');
    await nav(['HR monitor', 'HR', 'People']);
    {
      const it = vac(CLERK);
      await it.getByLabel(`Comment on ${CLERK}`).fill('Signed for PWVSB (synthetic)');
      await it.getByRole('button', { name: 'Sign the approval' }).click();
      await p.waitForTimeout(900);
    }
    step('HR Director signs the central vacancy', /open/.test(await vac(CLERK).innerText()));

    // 3. HR drafts the guard job post, checks JobStreet is marked paid, sends it for approval.
    await as('PWVSB HR');
    await nav(['HR monitor', 'HR']);
    const write = async (title) => {
      const it = vac(title);
      await it.getByRole('button', { name: 'Write the job post' }).click();
      await p.waitForTimeout(300);
      const paidShown = /JobStreet \(paid per post/.test(await it.innerText());
      await it.getByText('JobStreet', { exact: false }).first().click();
      await it.getByLabel('How to apply').fill('Apply at the company careers form');
      await it.getByRole('button', { name: 'Draft for me' }).click();
      await p.waitForTimeout(900);
      return paidShown;
    };
    const paid = await write(GUARD);
    let gt = await vac(GUARD).innerText();
    step('JobStreet is marked paid per post', paid);
    if (process.env.UAT_DEBUG) { await vac(GUARD).scrollIntoViewIfNeeded(); await shot('debug-after-draft'); console.log(gt.slice(0, 1500)); }
    step('Draft for me writes BM and English, labelled as template', /JAWATAN KOSONG/.test(gt) && /WE ARE HIRING/.test(gt) && /template \(AI not connected\)/.test(gt));
    await vac(GUARD).getByRole('button', { name: 'Send for approval' }).click();
    await p.waitForTimeout(900);
    gt = await vac(GUARD).innerText();
    step('guard post waits for the Selangor OM', /waiting for approval/.test(gt) && /Operations Manager for Selangor/.test(gt));
    await vac(GUARD).scrollIntoViewIfNeeded();
    await shot('01-hr-guard-post-waiting');

    // 4. The HR Director cannot approve a guard post; the Selangor OM can, and sees the auto-posting warning.
    await as('Aisyah binti Rahman');
    await nav(['HR monitor', 'HR', 'People']);
    step('HR Director has no approve button on a guard post', !(await vac(GUARD).getByRole('button', { name: 'Approve wording' }).count()));
    await as('Azman bin Osman');
    await nav(['Regional ops', 'Regional']);
    gt = await vac(GUARD).innerText();
    step('Selangor OM sees the post and the posts-by-itself warning', /Approving queues this wording for .*goes out without another check/.test(gt));
    await vac(GUARD).getByLabel('Job post comment').fill('Wording fine (synthetic)');
    await vac(GUARD).getByRole('button', { name: 'Approve wording' }).click();
    await p.waitForTimeout(900);
    gt = await vac(GUARD).innerText();
    step('OM approves; queued per channel, nothing posted', /approved, not published/.test(gt) && /waiting for the account to be connected/.test(gt) && !/\bposted\b(?! by hand)/i.test(gt.replace(/Posted by hand.*$/m, '')));
    await vac(GUARD).scrollIntoViewIfNeeded();
    await shot('02-om-approved-queued');
    await as('Tan Boon Huat');
    await nav(['Regional ops', 'Regional']);
    step('Johor OM does not see the Selangor guard post', !(await p.locator('.list-item', { hasText: GUARD }).count()));
    await as('Rajesh a/l Subramaniam');
    await nav(['Regional ops', 'Regional']);
    step('central Regional OM sees the guard vacancy (backup approver)', (await p.locator('.list-item', { hasText: GUARD }).count()) > 0);

    // 5. Staff post: HR drafts and sends; the HR Director approves.
    await as('PWVSB HR');
    await nav(['HR monitor', 'HR']);
    await write(CLERK);
    await vac(CLERK).getByRole('button', { name: 'Send for approval' }).click();
    await p.waitForTimeout(800);
    await as('Aisyah binti Rahman');
    await nav(['HR monitor', 'HR', 'People']);
    await vac(CLERK).getByLabel('Job post comment').fill('Approved (synthetic)');
    await vac(CLERK).getByRole('button', { name: 'Approve wording' }).click();
    await p.waitForTimeout(900);
    step('HR Director approves the staff post', /approved, not published/.test(await vac(CLERK).innerText()));

    // 6. HR keeps the applicant list for the guard vacancy.
    await as('PWVSB HR');
    await nav(['HR monitor', 'HR']);
    await vac(GUARD).getByRole('button', { name: /^Applicants/ }).click();
    await p.waitForTimeout(600);
    const add = async (name, phone) => {
      const it = vac(GUARD);
      await it.getByLabel('Applicant name').fill(name);
      await it.getByLabel('Applicant phone').fill(phone);
      await it.getByLabel('Where they saw the post').selectOption('jobstreet');
      await it.getByRole('button', { name: 'Add applicant' }).click();
      await p.waitForTimeout(800);
    };
    await add('Synthetic Applicant One', '012-111 2222');
    await add('Synthetic Duplicate', '+60121112222');
    gt = await vac(GUARD).innerText();
    step('HR adds an applicant; the same phone is refused', /Synthetic Applicant One/.test(gt) && /already on the list/.test(await p.$eval('.page', (e) => e.innerText)));
    const one = vac(GUARD);
    await one.getByRole('button', { name: 'Shortlist' }).click();
    await p.waitForTimeout(700);
    await one.getByLabel('Interview time for Synthetic Applicant One').fill('2026-11-10T10:00');
    await one.getByRole('button', { name: 'Set interview' }).click();
    await p.waitForTimeout(700);
    gt = await vac(GUARD).innerText();
    step('interview time is kept in Malaysia time (10:00)', /interview .*10:00/.test(gt), (gt.match(/interview [^\n·]*/) || [''])[0]);
    const offer = vac(GUARD).getByRole('button', { name: 'Offer' });
    step('offering needs a comment', await offer.isDisabled());
    await vac(GUARD).getByLabel('Comment on Synthetic Applicant One').fill('Offer RM1,900 (synthetic)');
    await offer.click();
    await p.waitForTimeout(700);
    await vac(GUARD).getByLabel('Comment on Synthetic Applicant One').fill('Accepted (synthetic)');
    await vac(GUARD).getByRole('button', { name: 'Hired' }).click();
    await p.waitForTimeout(700);
    gt = await vac(GUARD).innerText();
    step('applicant moves to hired', /hired/.test(gt));
    await vac(GUARD).scrollIntoViewIfNeeded();
    await shot('03-hr-applicants');

    // 7. HR records a post made by hand on a notice board (no link).
    await vac(GUARD).getByLabel('Posted on').selectOption('notice_board');
    await vac(GUARD).getByLabel('Where it was posted').fill('Office notice board (synthetic)');
    await vac(GUARD).getByRole('button', { name: 'Record a post I made' }).click();
    await p.waitForTimeout(800);
    step('HR records a notice-board post with no link', /notice board: Office notice board \(synthetic\) \(no link\)/.test(await vac(GUARD).innerText()));

    step('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    step('no data request left the machine (web fonts blocked)', external.length === 0, [...new Set(external)].join(', '));
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  require('node:fs').writeFileSync(`${S}/results.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
