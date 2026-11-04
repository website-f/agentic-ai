// After a staging deployment: opens the website in a headless browser, presses "Sign in with Microsoft" and checks
// that Microsoft's sign-in page opens for the right app, tenant and API scope, with no Microsoft error (for example
// a wrong redirect address). It cannot sign anyone in; the CEO's own sign-in is the final test.
// Usage: node scripts/staging-signin-check.mjs <website URL> <tenant ID> <web app client ID> <API App ID URI>
import { chromium } from 'playwright';

const [web, tenant, spa, apiUri] = process.argv.slice(2);
if (!web || !tenant || !spa || !apiUri) throw new Error('usage: <website URL> <tenant ID> <web app client ID> <API App ID URI>');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(web, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /sign in with microsoft/i }).click({ timeout: 30_000 });
  await page.waitForURL(/login\.microsoftonline\.com/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  const url = new URL(page.url());
  const q = url.searchParams;
  const fail = (m) => {
    console.error(`::error::${m}`);
    process.exitCode = 1;
  };
  if (!url.pathname.toLowerCase().startsWith(`/${tenant.toLowerCase()}/`)) fail(`Sign-in went to ${url.pathname}, not this tenant.`);
  if (q.get('client_id') !== spa) fail(`Sign-in used client ${q.get('client_id')}, not the Prima web app.`);
  if (!(q.get('scope') ?? '').split(' ').includes(`${apiUri}/access_as_user`)) fail(`Sign-in did not ask for ${apiUri}/access_as_user.`);
  if (q.get('code_challenge_method') !== 'S256') fail('Sign-in did not use PKCE (S256).');
  if (q.get('redirect_uri') !== `${web}/`) fail(`Sign-in returns to ${q.get('redirect_uri')}, expected ${web}/.`);
  // Microsoft shows either its e-mail box (the request was accepted) or an AADSTS error, such as a wrong return address.
  const shown = await page
    .waitForFunction(() => document.querySelector('input[name="loginfmt"]') || /AADSTS\d+/.test(document.body?.innerText ?? ''), null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const text = await page.locator('body').innerText();
  const aad = /AADSTS\d+[^\n]*/.exec(text);
  if (aad) fail(`Microsoft refused the sign-in request: ${aad[0]}`);
  else if (!shown) fail('Microsoft sign-in page did not show its e-mail box within 30 seconds.');
  if (!process.exitCode) console.log('Microsoft sign-in page opens for the Prima web app with the right tenant, scope and return address.');
} finally {
  await browser.close();
}
