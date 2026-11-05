// usage: node orglinks-upgrade-check.js <repo worktree> <previous org-links-v1.sql>  (run from anywhere; everything resolves from the worktree given)
// Upgrade path for the hand-over module: the previous org-links-v1.sql (given as argv[2]) installed first, with a
// hand-over row written, then this candidate's module over it. Checks the catalogue is clean, rows are kept, and
// code and database name the same office receivers with a run link set. Throwaway localhost DB, synthetic data.
const path = require('path');
const ROOT = path.resolve(process.argv[2] || '.');
const need = (m) => require(require.resolve(m, { paths: [ROOT] }));
const { Client } = need('pg');
const fs = require('fs');
const core = need('@prima/core');
const { PgStore } = require(path.join(ROOT, 'apps/api/dist/src/pg-store'));
const { migrationSql } = require(path.join(ROOT, 'apps/api/dist/src/schema'));
const { orgLinksProblems } = require(path.join(ROOT, 'apps/api/dist/src/org-links-readiness'));
const DB = 'prima_orglinks_upgrade_check';
const base = 'postgres://postgres:localdev@localhost:5432/';
const oldSql = fs.readFileSync(path.resolve(process.argv[3] || ''), 'utf8');
(async () => {
  const a = new Client({ connectionString: base + 'postgres' }); await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await a.query(`CREATE DATABASE ${DB}`); await a.end();
  const c = new Client({ connectionString: base + DB }); await c.connect();
  let fail = [];
  try {
    await c.query(migrationSql());
    const users = [
      { id: 'writer', name: 'Synthetic Writer', role: 'pwvsb_officer', department: 'transport', companyIds: ['co-run', 'co-parent'], siteIds: [] },
      { id: 'cm-run', name: 'Synthetic Run Manager', role: 'company_manager', companyIds: ['co-run'], siteIds: [] },
      { id: 'cm-p', name: 'Synthetic Parent Manager', role: 'company_manager', companyIds: ['co-parent'], siteIds: [] },
      { id: 'ae-p', name: 'Synthetic Parent Exec', role: 'admin_exec', companyIds: ['co-parent'], siteIds: [] },
      { id: 'cm-p-br', name: 'Synthetic Parent Branch Head', role: 'company_manager', branchId: 'br-x', companyIds: ['co-parent'], siteIds: [] },
    ].map((u) => ({ title: u.name, ...u }));
    for (const u of users) await c.query('INSERT INTO prima.users(id,data) VALUES($1,$2)', [u.id, u]);
    for (const id of ['co-run', 'co-parent']) await c.query('INSERT INTO prima.companies(id,data) VALUES($1,$2)', [id, { id, name: 'Synthetic ' + id }]);
    const audit = async (entityId, oldCode = false) => {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE prima_app');
      const u = users[0];
      await c.query("SELECT set_config('app.user_id',$1,true), set_config('app.company_ids',$2,true), set_config('app.group_user','off',true), set_config('app.walls',$3,true)", [u.id, u.companyIds.join(','), core.dataWalls(u).join(',')]);
      const store = new PgStore(c);
      if (oldCode) store.orgRunBy = undefined; // the previous API code did not ask the database for a running office
      await core.withOrgLinks(store).audit({ at: new Date().toISOString(), actor: u.name, companyId: 'co-run', action: 'credit.loan', entity: 'credit_loan', entityId, summary: 'synthetic' });
      await c.query('COMMIT');
      return (await c.query(`SELECT data FROM prima.org_tasks WHERE data->>'entityId'=$1 AND data->>'desk'='company_office'`, [entityId])).rows[0]?.data;
    };
    // 1. The previous module, with a hand-over written under it (prima.org_run_by does not exist yet).
    await c.query(oldSql);
    const hadRunBy = (await c.query("SELECT to_regproc('prima.org_run_by') IS NOT NULL AS f")).rows[0].f;
    if (hadRunBy) fail.push('previous module already has org_run_by (wrong old file?)');
    const old = await audit('loan-old-module', true);
    if (JSON.stringify(old?.userIds) !== '["cm-run"]') fail.push('old module row: ' + JSON.stringify(old?.userIds));
    // 2. The run-links table, then this candidate's module over the old one.
    for (const f of ['company-office-v1.sql', 'company-run-links-v1.sql']) await c.query(fs.readFileSync(path.join(ROOT, 'db/modules', f), 'utf8'));
    await c.query(fs.readFileSync(path.join(ROOT, 'db/modules/org-links-v1.sql'), 'utf8'));
    const before = await audit('loan-before-link');
    await c.query('INSERT INTO prima.company_run_links(id,data) VALUES($1,$2)', ['co-run', { id: 'co-run', companyId: 'co-run', runByCompanyId: 'co-parent' }]);
    const after = await audit('loan-after-link');
    // A second apply is repeat-safe and keeps the rows.
    const n1 = (await c.query('SELECT count(*)::int n FROM prima.org_tasks WHERE data->>\'desk\'=\'company_office\'')).rows[0].n;
    await c.query(fs.readFileSync(path.join(ROOT, 'db/modules/org-links-v1.sql'), 'utf8'));
    const n2 = (await c.query('SELECT count(*)::int n FROM prima.org_tasks WHERE data->>\'desk\'=\'company_office\'')).rows[0].n;
    if (n1 !== n2 || n1 !== 3) fail.push(`rows: ${n1} then ${n2}, expected 3 kept (old row + two new)`);
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE prima_app');
    const problems = await orgLinksProblems(c); await c.query('ROLLBACK');
    if (problems.length) fail.push('catalogue: ' + problems.join('; '));
    if (JSON.stringify(before.userIds) !== '["cm-run"]') fail.push('before link: ' + JSON.stringify(before.userIds));
    if (JSON.stringify([...after.userIds].sort()) !== '["ae-p","cm-p","cm-run"]') fail.push('after link: ' + JSON.stringify(after.userIds));
    // Parity for every company with the link set.
    const all = (await c.query('SELECT data FROM prima.users')).rows.map((r) => r.data);
    const day = new Date().toISOString().slice(0, 10);
    for (const co of ['co-run', 'co-parent']) {
      const runBy = (await c.query('SELECT prima.org_run_by($1) r', [co])).rows[0].r;
      const want = core.deskPeople('company_office', all, co, day, null, runBy).map((u) => u.id).sort();
      const got = [...(await c.query("SELECT prima.org_desk_people('company_office',$1,$2) ids", [co, day])).rows[0].ids].sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) fail.push(`parity ${co}: code ${want} db ${got}`);
    }
    console.log(JSON.stringify({ before: before.userIds, after: after.userIds, rowsKept: n1 === n2, catalogue: problems }));
  } finally { await c.end(); const a2 = new Client({ connectionString: base + 'postgres' }); await a2.connect(); await a2.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await a2.end(); }
  console.log(fail.length ? 'FAIL ' + fail.join(' | ') : 'PASS'); if (fail.length) process.exitCode = 1;
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
