// Combined schema rehearsal on a disposable local PostgreSQL only. Prints names, hashes and check results; no data.
// Fails closed: exit 1 when the base or any module is not pinned, does not install (twice), or any catalogue check
// reports a problem afterwards. Run from apps/api after `npm run build` (it loads the compiled checks from dist/src).
//   PRIMA_REHEARSAL_PG  superuser URL of a disposable local server (default postgres://postgres:localdev@localhost:5432/postgres)
const { Client } = require(require.resolve('pg', { paths: [process.cwd()] })); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const API = process.cwd(); const ROOT = path.resolve(API, '../..');
const need = (m) => { const p = path.join(API, 'dist/src', m); if (!fs.existsSync(p + '.js')) { console.error(`Build apps/api first: ${p}.js is missing.`); process.exit(1); } return require(p); };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const { moduleCatalogProblems, RELEASE_MODULE_IDS } = need('release-catalog');
const { installSelectedModule } = need('module-install'); const { releaseArtifact } = need('release-artifact');
const BASE = process.env.PRIMA_REHEARSAL_PG ?? 'postgres://postgres:localdev@localhost:5432/postgres';
const host = new URL(BASE).hostname; if (!['localhost', '127.0.0.1', '::1'].includes(host)) { console.error('Local disposable server only.'); process.exit(1); }
const DB = 'prima_combined_rehearsal'; const OWNER = 'prima_combined_owner';
const ownerUrl = (() => { const u = new URL(BASE); u.username = OWNER; u.password = 'local-test-only'; u.pathname = '/' + DB; return u.toString(); })();
async function q(url, fn) { const c = new Client({ connectionString: url }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const asApp = (fn) => (c) => c.query('BEGIN').then(() => c.query('SET LOCAL ROLE prima_app')).then(() => fn(c)).finally(() => c.query('ROLLBACK'));
(async () => {
  const problems = [];
  await q(BASE, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    if (!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [OWNER])).rowCount) await c.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`);
    if ((await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount) await c.query(`GRANT prima_app TO ${OWNER} WITH ADMIN OPTION`);
    await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/release-manifest.json')));
  const out = { base: { path: manifest.base.path, file: sha(manifest.base.path), manifest: manifest.base.sha256 }, steps: [] };
  if (out.base.file !== out.base.manifest) problems.push('base not pinned');
  const ids = manifest.modules.map((m) => m.id);
  if (JSON.stringify(ids) !== JSON.stringify([...RELEASE_MODULE_IDS])) problems.push(`manifest modules ${ids.join(',')} differ from the release catalogue ${RELEASE_MODULE_IDS.join(',')}`);
  for (const f of fs.readdirSync(path.join(ROOT, 'db/proposed')).filter((x) => x.endsWith('.json')))
    for (const m of JSON.parse(fs.readFileSync(path.join(ROOT, 'db/proposed', f))).modules ?? []) if (!ids.includes(m.id)) problems.push(`${m.id} (${f}) is outside the manifest`);
  await q(ownerUrl, async (c) => { await c.query(fs.readFileSync(path.join(ROOT, manifest.base.path), 'utf8')); await c.query('INSERT INTO prima.schema_info VALUES(1,$1,now()) ON CONFLICT (id) DO UPDATE SET migration_sha256=EXCLUDED.migration_sha256', [manifest.base.sha256]); });
  // Both passes go through the reviewed operator installer (module-install.ts), as the release owner would: pass 1 must
  // install each module and verify its catalogue; pass 2 must find every module already installed and verified.
  const art = releaseArtifact();
  for (const pass of [1, 2]) for (const m of manifest.modules) {
    const r = { id: m.id, pass, sha256: sha(m.path), pinned: m.sha256 === sha(m.path) };
    if (!r.pinned) problems.push(`${m.id} not pinned`);
    try { const res = await q(ownerUrl, (c) => installSelectedModule(c, { id: m.id, releaseSha256: art.sha256, moduleSha256: m.sha256, confirm: 'INSTALL_SELECTED_MODULE' })); r.status = res.status; const want = pass === 1 ? 'installed' : 'already_installed'; if (res.status !== want) problems.push(`${m.id} pass ${pass}: ${res.status}, expected ${want}`); } catch (e) { r.status = 'refused'; r.error = e.message.slice(0, 200); problems.push(`${m.id} pass ${pass} refused by the installer: ${r.error}`); }
    r.catalog = await q(ownerUrl, asApp((c) => moduleCatalogProblems(c, m.id))).catch((e) => ['CHECK_FAILED ' + e.message]);
    if (r.catalog.length) problems.push(`${m.id} pass ${pass} catalogue: ${r.catalog.join('; ')}`);
    out.steps.push(r);
  }
  out.hashes = { base: sha(manifest.base.path), modules: Object.fromEntries(manifest.modules.map((m) => [m.id, sha(m.path)])) };
  out.tables = (await q(ownerUrl, (c) => c.query("SELECT count(*)::int n, count(*) FILTER (WHERE relforcerowsecurity)::int forced FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='prima' AND relkind='r'"))).rows[0];
  await q(BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`));
  out.problems = problems; out.ok = problems.length === 0;
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
