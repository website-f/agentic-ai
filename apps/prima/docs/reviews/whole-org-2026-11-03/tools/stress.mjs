// Group-scale stress test of the combined build's business code (synthetic data only).
// Scales the mock dataset from 3 detailed pilot companies to all 38 companies (~8,000 guards, ~2,000 sites)
// by cloning pilot detail into the 35 other companies with fresh ids, then times the screens each role opens,
// and then runs many people working at once (approvals, alerts, hand-overs).
import fs from 'node:fs';
const core = await import('/home/claude/prima-secure-app/packages/core/dist/index.js');
const { generateDataset, MemoryStore, PrimaService, withOrgLinks } = core;
const TODAY = '2026-11-03';
const NOW = '2026-11-03T10:30:00+08:00';
const out = { scale: {}, reads: [], writes: {}, errors: [] };

const t0 = Date.now();
const ds = generateDataset({ today: TODAY, now: NOW });
out.scale.baseGenMs = Date.now() - t0;
const pilots = [['co-sasa', 'sasa', 'SASA'], ['co-arsh', 'arsh', 'ARSH'], ['co-inas', 'inas', 'INAS']];
const SKIP = new Set(['users', 'grants', 'companies', 'licences', 'finStatus', 'webCompanies', 'corpProfiles', 'audit']);
const scaleT = Date.now();
const others = ds.companies.filter((c) => !c.isPilot);
others.forEach((c, i) => {
  const [pid, low, up] = pilots[i % 3];
  const n = c.id.slice(3); // '04'
  for (const [k, v] of Object.entries(ds)) {
    if (!Array.isArray(v) || SKIP.has(k)) continue;
    const rows = v.filter((r) => r && r.companyId === pid);
    if (!rows.length) continue;
    let j = JSON.stringify(rows);
    j = j.split(pid).join(c.id).split(`-${low}-`).join(`-c${n}-`).split(`-${low}`).join(`-c${n}`).split(`${up}-`).join(`C${n}-`).split(up).join(`C${n}`);
    v.push(...JSON.parse(j));
  }
  const pc = ds.companies.find((x) => x.id === pid);
  c.guardCount = pc.guardCount; c.siteCount = pc.siteCount;
});
out.scale.scaleMs = Date.now() - scaleT;
const guards = ds.people.filter((p) => (p.kind ?? p.role ?? 'guard') === 'guard' || /guard/i.test(p.jobTitle ?? p.title ?? 'guard')).length;
out.scale.companies = ds.companies.length;
out.scale.people = ds.people.length;
out.scale.guardsApprox = guards;
out.scale.sites = ds.sites.length;
out.scale.shifts = ds.shifts.length;
out.scale.attendance = ds.attendance.length;
out.scale.totalRows = Object.values(ds).filter(Array.isArray).reduce((a, v) => a + v.length, 0);
console.log('scale', out.scale);

const store = withOrgLinks(new MemoryStore(ds));
const svc = new PrimaService(store, () => NOW);

const ROLES = { CEO: 'u-fauzan', COO: 'u-coo', FD: 'u-fd', CoS: 'u-cos', DCoS: 'u-dcos', Chairman: 'u-chair', ViceChair: 'u-vchair', ACT: 'u-audit', CompanyMgrSasa: 'u-cm-sasa', OpsDirector: 'u-opsdir', OGM: 'u-ogm', HR: 'u-pwvsb-hr' };
const users = {};
for (const [k, id] of Object.entries(ROLES)) {
  try { users[k] = await svc.user(id); } catch (e) { out.errors.push(`user ${k} ${id}: ${e.message}`); }
}
// The screens a leader or manager opens: every service read that takes just the person (as the demo API calls them),
// plus the company-scoped ones on Sasa and on a cloned company.
const demoSrc = fs.readFileSync('/home/claude/prima-secure-app/apps/web/src/api/demo.ts', 'utf8');
const oneArg = [...new Set([...demoSrc.matchAll(/s\.([a-zA-Z0-9_.]+)\(u\)/g)].map((m) => m[1]))];
const coArg = [...new Set([...demoSrc.matchAll(/s\.([a-zA-Z0-9_.]+)\(u, ?(?:c|companyId)\)/g)].map((m) => m[1]))];
const call = (path, args) => {
  const parts = path.split('.');
  let obj = svc;
  for (const p of parts.slice(0, -1)) obj = obj[p];
  const fn = obj[parts.at(-1)];
  if (typeof fn !== 'function') throw new Error('no such method');
  return fn.apply(obj, args);
};
async function time(label, role, path, args) {
  const t = performance.now();
  try {
    await call(path, args);
    const ms = performance.now() - t;
    out.reads.push({ role, path, label, ms: Math.round(ms) });
  } catch (e) {
    const ms = performance.now() - t;
    out.reads.push({ role, path, label, ms: Math.round(ms), refused: String(e.message).slice(0, 100) });
  }
}
for (const [role, u] of Object.entries(users)) {
  for (const p of oneArg) await time('person', role, p, [u]);
  for (const p of coArg) {
    await time('co-sasa', role, p, [u, 'co-sasa']);
    await time('co-17', role, p, [u, 'co-17']);
  }
}
const ok = out.reads.filter((r) => !r.refused);
ok.sort((a, b) => b.ms - a.ms);
console.log('reads timed', out.reads.length, 'answered', ok.length);
console.log('slowest 25:');
for (const r of ok.slice(0, 25)) console.log(String(r.ms).padStart(6), 'ms', r.role, r.path, r.label);

// Concurrency: many people at once. 50 IT jobs + 50 help requests concurrently, then leader reads in parallel.
const W = {};
try {
  const mgr = await svc.user('u-it-mgr');
  const ex = ['u-it-ex1', 'u-it-ex2', 'u-it-ex3', 'u-it-ex4'];
  let t = performance.now();
  await Promise.all(Array.from({ length: 400 }, (_, i) => svc.giveItJob(mgr, { kind: 'task', title: `Load ${i}`, detail: '', priority: 'P3', technical: false, assigneeId: ex[i % 4], dueOn: TODAY })));
  W.itJobs400ConcurrentMs = Math.round(performance.now() - t);
  t = performance.now();
  await Promise.all(Object.values(users).map((u) => svc.home(u, 'co-sasa').catch(() => null)));
  W.allLeadersHomeAtOnceMs = Math.round(performance.now() - t);
  t = performance.now();
  await Promise.all(Array.from({ length: 100 }, (_, i) => svc.home(users[Object.keys(users)[i % 12]], 'co-' + String(4 + (i % 35)).padStart(2, '0')).catch(() => null)));
  W.hundredHomesAtOnceMs = Math.round(performance.now() - t);
} catch (e) { out.errors.push('writes: ' + e.message); }
// Hand-over volume after the burst.
try { W.handoverInboxCOOms = await (async () => { const t = performance.now(); await svc.orgLinks.inbox(users.COO); return Math.round(performance.now() - t); })(); } catch (e) { out.errors.push('inbox: ' + e.message); }
W.auditRowsAfter = ds.audit.length;
out.writes = W;
console.log('writes', W, 'errors', out.errors);
fs.writeFileSync('/tmp/claude-0/rev/stress-results.json', JSON.stringify(out, null, 1));
