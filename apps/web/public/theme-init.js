// Runs before first paint so the page never flashes the wrong theme.
// External file (not inline) so the CSP can forbid inline scripts.
(function () {
  var pref = "system";
  try { pref = localStorage.getItem("agentic.theme") || "system"; } catch (e) { /* storage blocked */ }
  var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
