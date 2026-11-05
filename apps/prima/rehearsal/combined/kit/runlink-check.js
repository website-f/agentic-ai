// usage: node runlink-check.js <repo worktree>  (run from anywhere; everything resolves from the worktree given)
// Combined-build check: real Company office + run-links + hand-over modules on a throwaway localhost DB. Synthetic data.
const path = require('path');
const ROOT = path.resolve(process.argv[2] || '.');
const need = (m) => require(require.resolve(m, { paths: [ROOT] }));
const { Client } = need('pg');
const fs = require('fs');
const core = need('@prima/core');
const { PgStore } = require(path.join(ROOT, 'apps/api/dist/src/pg-store'));
const { migrationSql } = require(path.join(ROOT, 'apps/api/dist/src/schema'));
const DB = 'prima_runlink_combined_check';
const base = 'postgres://postgres:localdev@localhost:5432/';
(async () => {
  const a = new Client({ connectionString: base + 'postgres' }); await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await a.query(`CREATE DATABASE ${DB}`); await a.end();
  const c = new Client({ connectionString: base + DB }); await c.connect();
  try {
    await c.query(migrationSql());
    for (const f of ['company-office-v1.sql', 'company-run-links-v1.sql', 'org-links-v1.sql']) await c.query(fs.readFileSync(path.join(ROOT, 'db/modules', f), 'utf8'));
    const users = [
      { id: 'writer', name: 'Synthetic Writer', role: 'pwvsb_officer', department: 'transport', companyIds: ['co-run'], siteIds: [] },
      { id: 'cm-p', name: 'Synthetic Parent Manager', role: 'company_manager', companyIds: ['co-parent'], siteIds: [] },
      { id: 'ae-p', name: 'Synthetic Parent Exec', role: 'admin_exec', companyIds: ['co-parent'], siteIds: [] },
      { id: 'cm-p-br', name: 'Synthetic Parent Branch Head', role: 'company_manager', branchId: 'br-x', companyIds: ['co-parent'], siteIds: [] },
    ].map((u) => ({ title: u.name, ...u }));
    for (const u of users) await c.query('INSERT INTO prima.users(id,data) VALUES($1,$2)', [u.id, u]);
    for (const id of ['co-run', 'co-parent']) await c.query('INSERT INTO prima.companies(id,data) VALUES($1,$2)', [id, { id, name: 'Synthetic ' + id }]);
    const run = async (entityId) => {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE prima_app');
      const u = users[0];
      await c.query("SELECT set_config('app.user_id',$1,true), set_config('app.company_ids',$2,true), set_config('app.group_user','off',true), set_config('app.walls',$3,true)", [u.id, u.companyIds.join(','), core.dataWalls(u).join(',')]);
      await core.withOrgLinks(new PgStore(c)).audit({ at: new Date().toISOString(), actor: u.name, companyId: 'co-run', action: 'credit.loan', entity: 'credit_loan', entityId, summary: 'synthetic' });
      await c.query('COMMIT');
      const t = (await c.query(`SELECT data FROM prima.org_tasks WHERE data->>'entityId'=$1 AND data->>'desk'='company_office'`, [entityId])).rows[0].data;
      const n = (await c.query(`SELECT data->>'userId' u FROM prima.org_notices WHERE data->>'taskId'=$1 ORDER BY 1`, [t.id])).rows.map((r) => r.u);
      return { userIds: t.userIds, unassigned: t.unassigned, notices: n };
    };
    const before = await run('loan-before');
    await c.query('INSERT INTO prima.company_run_links(id,data) VALUES($1,$2)', ['co-run', { id: 'co-run', companyId: 'co-run', runByCompanyId: 'co-parent' }]);
    const after = await run('loan-after');
    console.log(JSON.stringify({ before, after }));
    if (before.unassigned !== true || after.unassigned !== false || JSON.stringify([...after.userIds].sort()) !== '["ae-p","cm-p"]' || after.notices.join() !== 'ae-p,cm-p') { console.log('FAIL'); process.exitCode = 1; } else console.log('PASS');
  } finally { await c.end(); const a2 = new Client({ connectionString: base + 'postgres' }); await a2.connect(); await a2.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await a2.end(); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
