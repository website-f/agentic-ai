// Synthetic harness boundary: allow loopback test servers only; never contact a provider.
async function localOnly(page) {
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    return ['127.0.0.1','localhost','[::1]'].includes(u.hostname) && ['http:','https:'].includes(u.protocol) ? route.continue() : route.abort();
  });
}
module.exports = { localOnly };
