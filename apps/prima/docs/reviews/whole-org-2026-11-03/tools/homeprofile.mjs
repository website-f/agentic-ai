// Which tables and which home sections cost the most for one leader home at group scale (synthetic, in memory).
// Usage: node homeprofile.mjs u-coo [co-sasa]
import { scaled } from './scale.mjs';
const core = await import('/home/claude/prima-secure-app/packages/core/dist/index.js');
const { MemoryStore, PrimaService, myt } = core;
const who = process.argv[2] ?? 'u-coo';
const companyId = process.argv[3] ?? 'co-sasa';
const TODAY = '2026-11-03';
const NOW = myt(TODAY, '10:30');
const ds = scaled(TODAY, NOW);
const store = new MemoryStore(ds);
const rows = new Map();
const calls = new Map();
const seen = new Map();
const list = store.list.bind(store);
store.list = async (t, f) => {
  const r = await list(t, f);
  rows.set(t, (rows.get(t) ?? 0) + r.length);
  if (process.env.SHOW === t) { const k = JSON.stringify(f, (kk, v) => (Array.isArray(v) && v.length > 3 ? `[${v.length} ids]` : v)); seen.set(k, (seen.get(k) ?? 0) + 1); }
  calls.set(t, (calls.get(t) ?? 0) + 1);
  return r;
};
const svc = new PrimaService(store, () => NOW);
// Time every private *Home section and the big monitors.
const timed = new Map();
for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(svc))) {
  if (!/Home$|Monitor$|^attendanceIssues$|^companyDashboard$|^executiveHome$|^caseViews$|^fwmBoard$|^visibleCompanies$/.test(name)) continue;
  const fn = svc[name];
  if (typeof fn !== 'function') continue;
  svc[name] = async function (...a) {
    const t = performance.now();
    try {
      return await fn.apply(this, a);
    } finally {
      const e = timed.get(name) ?? { ms: 0, n: 0 };
      e.ms += performance.now() - t;
      e.n++;
      timed.set(name, e);
    }
  };
}
const u = await svc.user(who);
const t = performance.now();
await svc.home(u, companyId);
const total = Math.round(performance.now() - t);
const top = (m, k) => [...m.entries()].sort((a, b) => b[1][k] - a[1][k]);
console.log(JSON.stringify({ who, total, rowsRead: [...rows.values()].reduce((a, b) => a + b, 0) }));
console.log('tables by rows read:');
for (const [tb, n] of [...rows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(n).padStart(10), String(calls.get(tb)).padStart(6), 'calls', tb);
console.log('sections by time (nested sections overlap):');
for (const [nm, e] of top(timed, 'ms').slice(0, 20)) console.log(String(Math.round(e.ms)).padStart(8), 'ms', String(e.n).padStart(5), 'x', nm);
if (process.env.SHOW) for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(n, k);
