// One-pass pin reconciliation for the combined rehearsal (run inside the combined worktree, after all merges).
// Rebuilds db/release-manifest.json as the union of every component's manifest modules, in order, with every
// sha256 recomputed from the combined files; re-pins every db/proposed/*.json base and module hash to the same
// bytes. Prints old -> new for each pin. Reviewed operator packages (ops/*) and workflows are NOT regenerated here:
// their stale pins are listed by stale-pins.sh for their owners.
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const branches = process.argv.slice(2);
const mods = new Map();
let version = 1;
for (const b of branches) {
  let m;
  try { m = JSON.parse(cp.execSync(`git show ${b}:db/release-manifest.json`, { encoding: 'utf8' })); } catch { continue; }
  version = m.version ?? version;
  for (const x of m.modules) if (!mods.has(x.id)) mods.set(x.id, { id: x.id, path: x.path, requires: x.requires ?? [] });
    else { const y = mods.get(x.id); y.requires = [...new Set([...y.requires, ...(x.requires ?? [])])]; }
}
// R14: the add-on modules from db/proposed/*.json join the one manifest (after the department modules), with the
// requires they declare. Nothing is installed outside the manifest any more.
for (const f of fs.readdirSync('db/proposed').filter((x) => x.endsWith('.json')).sort())
  for (const x of JSON.parse(fs.readFileSync('db/proposed/' + f, 'utf8')).modules ?? [])
    if (!mods.has(x.id)) mods.set(x.id, { id: x.id, path: x.path, requires: x.requires ?? [] });
const ORDER = ['procurement', 'rental_corrections', 'cleanup', 'metrics', 'job_email', 'central_admin_walls', 'central_admin_panel', 'central_admin_delegations', 'central_admin_legal_holds', 'company_office', 'company_run_links', 'org_links', 'special_ops', 'fw_welfare', 'time_series_indexes'];
const ordered = new Map([...mods.entries()].sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)));
mods.clear(); for (const [k, v] of ordered) mods.set(k, v);
const out = { version, base: { path: 'db/migrations/001_init.sql', sha256: sha('db/migrations/001_init.sql') }, modules: [...mods.values()].map((x) => ({ id: x.id, path: x.path, sha256: sha(x.path), requires: x.requires })) };
let old = null; try { old = JSON.parse(fs.readFileSync('db/release-manifest.json', 'utf8')); } catch { old = null; }
fs.writeFileSync('db/release-manifest.json', JSON.stringify(out, null, 2) + '\n');
console.log(`manifest base ${out.base.sha256}${old ? '' : ' (merged file was not valid JSON; rebuilt)'}`);
for (const m of out.modules) console.log(`manifest ${m.id} ${m.sha256} requires [${m.requires.join(',')}]`);
for (const f of fs.readdirSync('db/proposed').filter((x) => x.endsWith('.json'))) {
  const p = `db/proposed/${f}`, j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.base?.path) { const n = sha(j.base.path); if (j.base.sha256 !== n) console.log(`${p} base ${j.base.sha256.slice(0, 12)} -> ${n.slice(0, 12)}`); j.base.sha256 = n; }
  if (Array.isArray(j.after)) { const ids = out.modules.map((m) => m.id); const first = Math.min(...(j.modules ?? []).map((x) => ids.indexOf(x.id)).filter((i) => i >= 0)); const want = Number.isFinite(first) ? ids.slice(0, first) : ids; /* installs after the modules before it in the one manifest */ if (JSON.stringify(j.after) !== JSON.stringify(want)) console.log(`${p} after -> [${want.join(',')}]`); j.after = want; }
  for (const m of j.modules ?? []) if (m.path && fs.existsSync(m.path)) { const n = sha(m.path); if (m.sha256 !== n) console.log(`${p} ${m.id} ${String(m.sha256).slice(0, 12)} -> ${n.slice(0, 12)}`); m.sha256 = n; }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
