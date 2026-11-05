// HTTP stress against the local API on the group-scale PostgreSQL dataset (synthetic). Local only.
import fs from 'node:fs';
import { localFetch, orRefuse } from './target.mjs';
// Local API only, checked before any request (Arisha review, 3 Nov 2026).
const api = await orRefuse(() => localFetch(process.env.BASE ?? 'http://localhost:3077'));
const routes = fs.readFileSync(new URL('./get-routes.txt', import.meta.url), 'utf8').trim().split('\n');
const ROLES = { CEO: 'u-fauzan', COO: 'u-coo', FD: 'u-fd', CoS: 'u-cos', Chairman: 'u-chair', ACT: 'u-audit', CompanyMgr: 'u-cm-sasa', HR: 'u-pwvsb-hr', ITMgr: 'u-it-mgr', OpsDir: 'u-opsdir', OM: 'u-om-klang' };
const tok = {};
for (const [k, id] of Object.entries(ROLES)) {
  const r = await api('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id }) });
  if (r.ok) tok[k] = (await r.json()).token; else console.log('login failed', k, id, r.status);
}
const get = async (role, path) => {
  const t = performance.now();
  const r = await api(path, { headers: { authorization: `Bearer ${tok[role]}` } });
  const body = await r.text();
  // Every answer that is not 200 keeps its raw body (first 300 characters), so the kind of failure can be checked.
  return { status: r.status, ms: Math.round(performance.now() - t), kb: Math.round(body.length / 1024), ...(r.ok ? {} : { body: body.slice(0, 300) }) };
};
const out = { single: [], conc: [] };
const { classify, tally } = await import('./classify.mjs');
// 1. Every screen read, once per leader role.
for (const role of ['CEO', 'COO', 'FD', 'CompanyMgr']) {
  if (!tok[role]) continue;
  for (const p of routes) {
    const r = await get(role, p);
    out.single.push({ role, path: p, ...r });
  }
}
const ok = out.single.filter((r) => r.status === 200).sort((a, b) => b.ms - a.ms);
out.singleTally = tally(out.single);
console.log('single reads', out.single.length, out.singleTally);
for (const r of ok.slice(0, 20)) console.log(String(r.ms).padStart(6), 'ms', String(r.kb).padStart(6), 'KB', r.role, r.path);
for (const r of out.single.filter((r) => r.status >= 500)) console.log('5xx', r.role, r.path, r.status);
// 2. Morning rush: N people open their home screen at the same moment.
const pool = Object.keys(tok);
for (const n of [10, 25, 50, 100]) {
  const t = performance.now();
  const rs = await Promise.all(Array.from({ length: n }, (_, i) => get(pool[i % pool.length], `/api/home?companyId=co-${String(4 + (i % 35)).padStart(2, '0')}`)));
  const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
  const res = { n, wallMs: Math.round(performance.now() - t), p50: lat[Math.floor(n / 2)], p95: lat[Math.floor(n * 0.95) - 1] ?? lat.at(-1), max: lat.at(-1), tally: tally(rs), errors: rs.filter((r) => r.status !== 200).map((r) => ({ status: r.status, kind: classify(r.status), body: r.body })) };
  out.conc.push(res);
  console.log('home x', n, res);
}
// 3. Growth panel (Arisha review, 3 Nov 2026): group leaders open it at the same moment, then site margin on request.
out.growth = [];
const leaders = ['CEO', 'COO', 'FD', 'CoS', 'Chairman'].filter((k) => tok[k]);
for (const [path, n] of [['/api/growth', 10], ['/api/growth', 25], ['/api/growth/margin', 5]]) {
  const t = performance.now();
  const rs = await Promise.all(Array.from({ length: n }, (_, i) => get(leaders[i % leaders.length], path)));
  const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
  const res = { path, n, wallMs: Math.round(performance.now() - t), p50: lat[Math.floor(n / 2)], max: lat.at(-1), tally: tally(rs), errors: rs.filter((r) => r.status !== 200).map((r) => ({ status: r.status, kind: classify(r.status), body: r.body })) };
  out.growth.push(res);
  console.log('growth', path, 'x', n, res);
}
fs.writeFileSync(process.argv[2] ?? 'http-results.json', JSON.stringify(out, null, 1));
