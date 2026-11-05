const core = await import('/home/claude/prima-secure-app/packages/core/dist/index.js');
const { generateDataset } = core;
export function scaled(TODAY, NOW, out = { scale: {} }) {
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
    const ids = new Set(rows.map((r) => r.id));
    const cl = JSON.parse(j);
    for (const r of cl) if (r.id && ids.has(r.id)) r.id = `${r.id}-x${n}`;
    const have = new Set(v.map((r) => r.id));
    v.push(...cl.filter((r) => !r.id || !have.has(r.id)));
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
return ds;

}
