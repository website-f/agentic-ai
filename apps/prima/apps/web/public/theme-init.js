// P66: Prima follows the Agentic Office's light/dark choice (the same site, so the same saved
// setting), before the first paint and whenever it changes in another tab or the office around it.
// An external file (not inline) so the page's CSP can forbid inline scripts.
(function () {
  function apply() {
    var pref = 'system';
    try { pref = localStorage.getItem('agentic.theme') || 'system'; } catch (e) { /* storage blocked */ }
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  apply();
  window.addEventListener('storage', function (e) { if (e.key === 'agentic.theme') apply(); });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply); } catch (e) { /* old browsers */ }
})();
