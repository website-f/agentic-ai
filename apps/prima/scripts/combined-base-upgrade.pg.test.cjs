'use strict';
// Regression ONLY, never a deployment/migration CLI. Requires a fresh disposable
// PostgreSQL 16 cluster on an explicit loopback test port. Uses synthetic records.
// Build @prima/core and @prima/api before running this file with node --test.
const {before, after, it} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Client, Pool} = require('pg');

const ROOT = path.resolve(__dirname, '..');
const OLD_SHA = '4b4cf4d3c67d0c5b09ca3c9592c74504a2c7335430dcffeccdd4f48710ed78fe';
const FROZEN_MANIFEST_SHA = '734f15d2d04be8e56f0ad7d562742d5a8760de9fb922b69d197c877c5f3ec3ab';
const SYNTHETIC_PASSWORD = 'prima-local-synthetic-only';
const MODULE_IDS = ['procurement', 'rental_corrections', 'cleanup', 'metrics', 'job_email'];
// Modules added to the release after the frozen main artifact: absent from the old
// database, so the base upgrade alone must leave them not ready until installed.
const NEW_MODULE_IDS = ['item_register', 'item_register_v2'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// No default URL, remote hosts, standard production port, arbitrary credentials,
// connection options, or implicit opt-in. Fail before opening any database client.
assert.equal(process.env.PRIMA_DISPOSABLE_PG_TEST, '1', 'Explicit disposable-cluster opt-in required');
assert(process.env.TEST_POSTGRES_URL, 'Explicit TEST_POSTGRES_URL required');
const base = new URL(process.env.TEST_POSTGRES_URL);
assert(['postgres:', 'postgresql:'].includes(base.protocol), 'PostgreSQL URL required');
assert.equal(base.hostname, '127.0.0.1', 'Only literal IPv4 loopback is permitted');
assert(/^\d+$/.test(base.port) && Number(base.port) >= 1024 && Number(base.port) <= 65535 && base.port !== '5432', 'Explicit non-default local test port required');
assert.equal(base.pathname, '/postgres', 'Disposable admin database must be postgres');
assert.equal(base.username, 'postgres', 'Disposable admin must be postgres');
assert.equal(decodeURIComponent(base.password), SYNTHETIC_PASSWORD, 'Known synthetic-only credential required');
assert.equal(base.search, '', 'Connection-option overrides are forbidden');
assert.equal(base.hash, '', 'URL fragments are forbidden');

const oldSql = fs.readFileSync(path.join(ROOT, 'ops/base-transition/candidate.sql'), 'utf8');
assert.equal(sha(oldSql), OLD_SHA, 'Frozen main baseline bytes changed');
const frozenRoot = path.join(ROOT, 'ops/existing-admin/modules/working');
const frozenManifestBytes = fs.readFileSync(path.join(frozenRoot, 'db/release-manifest.json'));
assert.equal(sha(frozenManifestBytes), FROZEN_MANIFEST_SHA, 'Frozen main module manifest changed');
const frozenManifest = JSON.parse(frozenManifestBytes);
assert.equal(frozenManifest.base.sha256, OLD_SHA);
assert.deepEqual(frozenManifest.modules.map(m => m.id), MODULE_IDS);
const oldModules = frozenManifest.modules.map(m => {
  const filename = path.resolve(frozenRoot, m.path);
  assert(filename.startsWith(frozenRoot + path.sep), 'Module path must remain in frozen artifact');
  const sql = fs.readFileSync(filename, 'utf8');
  assert.equal(sha(sql), m.sha256, 'Frozen module bytes changed: ' + m.id);
  return {id: m.id, sql};
});
const currentManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/release-manifest.json'), 'utf8'));
assert.equal(currentManifest.base.path, 'db/migrations/001_init.sql');
const nextSql = fs.readFileSync(path.join(ROOT, currentManifest.base.path), 'utf8');
const NEXT_SHA = sha(nextSql);
assert.equal(NEXT_SHA, currentManifest.base.sha256, 'Combined base does not match release manifest');
assert.notEqual(NEXT_SHA, OLD_SHA, 'Regression requires a changed combined base');
assert.deepEqual(currentManifest.modules.map(m=>m.id), [...MODULE_IDS, ...NEW_MODULE_IDS], 'The five frozen modules plus the reviewed item register (two parts) only');
// Test-only exact source delta, not an operator migration command. Immutable old
// SQL remains the starting point. Reject every unreviewed change beyond two scope functions.
const moduleDeltaBodies = [];
for (const current of currentManifest.modules) {
  if (NEW_MODULE_IDS.includes(current.id)) { assert.equal(sha(fs.readFileSync(path.join(ROOT,current.path),'utf8')),current.sha256); continue; }
  const frozen = frozenManifest.modules.find(m=>m.id===current.id);
  assert.deepEqual({...current,sha256:frozen.sha256}, frozen);
  const source = fs.readFileSync(path.join(ROOT,current.path),'utf8');
  assert.equal(sha(source),current.sha256);
  const prior = oldModules.find(m=>m.id===current.id).sql;
  if (!['cleanup','rental_corrections'].includes(current.id)) { assert.equal(source,prior); continue; }
  const oldAllow = "company IN ('pwvsb','merdeka')";
  const newAllow = "company IN ('pwvsb','merdeka','goodwill','sasateam','pgl')";
  assert.equal(prior.split(oldAllow).length,2,'Exactly one reviewed allowlist change');
  assert.equal(source,prior.replace(oldAllow,newAllow),'Unexpected module delta '+current.id);
  const name = current.id==='cleanup'?'ic_scope':'rc_scope';
  const start = source.indexOf('FUNCTION prima.'+name+'(');
  const bodyEnd = source.indexOf('$$;',source.indexOf('AS $$',start))+3;
  assert(start>0 && bodyEnd>start);
  moduleDeltaBodies.push('CREATE OR REPLACE '+source.slice(start,bodyEnd));
}
assert.equal(moduleDeltaBodies.length,2);
const upgradeBody = () => nextBody+'\n'+moduleDeltaBodies.join('\n');
assert.equal((nextSql.match(/^BEGIN;\s*$/gm) || []).length, 1);
assert.equal((nextSql.match(/^COMMIT;\s*$/gm) || []).length, 1);
const nextBody = nextSql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
const {releaseCatalogState} = require(path.join(ROOT, 'apps/api/dist/src/release-catalog.js'));
const {installSelectedModule} = require(path.join(ROOT, 'apps/api/dist/src/module-install.js'));
const {releaseArtifact} = require(path.join(ROOT, 'apps/api/dist/src/release-artifact.js'));

let admin;
const createdDatabases = new Set();
const createdRoles = [];
const nonce = crypto.randomBytes(6).toString('hex');
function sqlName(name) {
  assert(/^prima_upgrade_[a-z_]+_[a-f0-9]{12}$/.test(name) && name.length < 63, 'Only generated dedicated test names allowed');
  return name;
}
function connection(database = 'postgres', user = 'postgres') {
  const url = new URL(base);
  url.pathname = '/' + database;
  url.username = user;
  url.password = SYNTHETIC_PASSWORD;
  return {connectionString: url.toString()};
}
async function client(database, user) {
  const c = new Client(connection(database, user));
  await c.connect();
  return c;
}
async function tableNames(c) {
  return (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='prima' ORDER BY tablename")).rows.map(r => r.tablename);
}
async function rowsSnapshot(c, names) {
  const result = {};
  for (const name of names) {
    assert(/^[a-z_]+$/.test(name));
    result[name] = (await c.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM prima.${name} t`)).rows[0].rows;
  }
  return result;
}
async function roleSnapshot() {
  return (await admin.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig FROM pg_roles WHERE rolname LIKE 'prima_%' ORDER BY rolname")).rows;
}
async function membershipSnapshot() {
  return (await admin.query("SELECT pg_get_userbyid(roleid) AS role,pg_get_userbyid(member) AS member,pg_get_userbyid(grantor) AS grantor,admin_option,inherit_option,set_option FROM pg_auth_members WHERE pg_get_userbyid(roleid) LIKE 'prima_%' OR pg_get_userbyid(member) LIKE 'prima_%' ORDER BY roleid,member,grantor")).rows;
}
async function createRole(name, attributes) {
  // Fixed application roles are created only after the cluster freshness gate.
  assert(['prima_app', 'prima_api'].includes(name) || sqlName(name));
  await admin.query(`CREATE ROLE ${name} ${attributes}`);
  createdRoles.push(name);
}
before(async () => {
  admin = await client('postgres', 'postgres');
  const identity = (await admin.query("SELECT current_user,session_user,current_database() AS db,inet_server_addr()::text AS address,inet_server_port() AS port,current_setting('server_version_num')::int AS version")).rows[0];
  assert.deepEqual({...identity, version: undefined}, {current_user: 'postgres', session_user: 'postgres', db: 'postgres', address: '127.0.0.1/32', port: Number(base.port), version: undefined});
  assert(identity.version >= 160000 && identity.version < 170000, 'PostgreSQL 16 required');
  assert.deepEqual((await admin.query("SELECT rolname FROM pg_roles WHERE rolname <> 'postgres' AND rolname NOT LIKE 'pg_%'")).rows, [], 'Refuse a cluster with existing application/user roles');
  const databases = (await admin.query('SELECT datname FROM pg_database')).rows.map(r => r.datname);
  assert(databases.every(n => ['postgres', 'template0', 'template1', 'prima_merge_test'].includes(n)), 'Refuse a cluster with existing non-test databases');
  // The local helper may pre-create this empty synthetic database. Never accept
  // a real application's populated database merely because its name looks test-like.
  if (databases.includes('prima_merge_test')) {
    const emptyTestDb = await client('prima_merge_test', 'postgres');
    try {
      assert.equal((await emptyTestDb.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'")).rows[0].n, 0, 'Synthetic helper database must have no custom schemas');
      assert.equal((await emptyTestDb.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows[0].n, 0, 'Synthetic helper database must be empty');
    } finally { await emptyTestDb.end(); }
  }
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()")).rows[0].n, 0, 'Disposable cluster must have no other client sessions');
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' AND c.relkind IN ('r','p','v','m','f')")).rows[0].n, 0, 'Admin database must contain no user relations');
  await createRole('prima_app', 'NOLOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS');
  await createRole('prima_api', `LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD '${SYNTHETIC_PASSWORD}'`);
  await admin.query('GRANT prima_app TO prima_api');
});
after(async () => {
  if (!admin) return;
  const errors = [];
  for (const name of createdDatabases) {
    try { await admin.query(`DROP DATABASE ${sqlName(name)} WITH (FORCE)`); createdDatabases.delete(name); } catch (e) { errors.push(e); }
  }
  for (const name of createdRoles.reverse()) {
    try { await admin.query(`DROP ROLE ${name}`); } catch (e) { errors.push(e); }
  }
  await admin.end();
  if (errors.length) throw new AggregateError(errors, 'Disposable resource cleanup failed');
});

for (const [profile, attributes] of [
  ['restricted', 'NOCREATEDB NOCREATEROLE NOBYPASSRLS'],
  ['existing_admin', 'CREATEDB CREATEROLE BYPASSRLS'],
]) {
  it(`main-to-combined upgrade preserves data and boundaries (${profile})`, async t => {
    const name = sqlName(`prima_upgrade_${profile}_${nonce}`);
    await createRole(name, `LOGIN NOSUPERUSER INHERIT ${attributes} PASSWORD '${SYNTHETIC_PASSWORD}'`);
    if (profile === 'existing_admin') await admin.query(`GRANT prima_app TO ${name} WITH INHERIT FALSE, SET TRUE`);
    await admin.query(`CREATE DATABASE ${name} OWNER ${name}`);
    createdDatabases.add(name);
    let owner, observer, runtime, pool;
    try {
      owner = await client(name, name);
      observer = await client(name, 'postgres');
      await owner.query(oldSql);
      await owner.query('INSERT INTO prima.schema_info VALUES(1,$1,now())', [OLD_SHA]);
      await owner.query('GRANT USAGE ON SCHEMA prima TO prima_api');
      await owner.query('GRANT SELECT ON prima.users,prima.grants,prima.schema_info TO prima_api');
      for (const m of oldModules) await owner.query(m.sql);
      await observer.query(`
        INSERT INTO prima.users VALUES('u-kept','{"id":"u-kept","entraOid":"11111111-1111-4111-8111-111111111111"}');
        INSERT INTO prima.grants VALUES('g-kept','co-a','{"id":"g-kept","userId":"u-kept","companyId":"co-a"}');
        INSERT INTO prima.audit VALUES(1,'co-a','{"seq":1,"companyId":"co-a","action":"synthetic.preserved","hash":"unchanged"}');
        INSERT INTO prima.people VALUES('p-kept','co-a','{"id":"p-kept","companyId":"co-a","name":"Synthetic only"}');
      `);
      const names = await tableNames(observer), beforeRows = await rowsSnapshot(observer, names);
      const beforeRoles = await roleSnapshot(), beforeMembership = await membershipSnapshot();
      // Failure after ALL new DDL and stamp must roll back both, with old data intact.
      await owner.query('BEGIN');
      try {
        await owner.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
        await owner.query(upgradeBody());
        await owner.query('UPDATE prima.schema_info SET migration_sha256=$1 WHERE id=1', [NEXT_SHA]);
        await owner.query('SELECT 1/0');
        assert.fail('Injected failure did not throw');
      } catch (e) {
        await owner.query('ROLLBACK');
        assert.equal(e.code, '22012');
      }
      assert.deepEqual(await tableNames(observer), names);
      assert.deepEqual(await rowsSnapshot(observer, names), beforeRows);
      assert.deepEqual(await roleSnapshot(), beforeRoles);
      assert.deepEqual(await membershipSnapshot(), beforeMembership);
      t.diagnostic('Rollback preserves old schema, every old row, and role authority');
      await owner.query('BEGIN');
      await owner.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
      await owner.query(upgradeBody());
      await owner.query('UPDATE prima.schema_info SET migration_sha256=$1 WHERE id=1', [NEXT_SHA]);
      await owner.query('COMMIT');
      const preserved = await rowsSnapshot(observer, names.filter(n => n !== 'schema_info'));
      for (const n of Object.keys(preserved)) assert.deepEqual(preserved[n], beforeRows[n], 'Old rows changed: ' + n);
      assert.equal((await observer.query('SELECT migration_sha256 FROM prima.schema_info')).rows[0].migration_sha256, NEXT_SHA);
      assert.deepEqual(await roleSnapshot(), beforeRoles);
      assert.deepEqual(await membershipSnapshot(), beforeMembership);
      t.diagnostic(`Preserved ${names.length} original tables, including four seeded identity/grant/audit/person records`);
      const required = ['site_dispatches','evidence_videos','post_logs','site_vehicles','gate_entries','site_tasks','site_task_logs','site_needs_reviews','staff_ids','staff_accounts','staff_faces','staff_movements','applicants','hr_cases'];
      const found = (await observer.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='prima'::regnamespace AND relname=ANY($1)", [required])).rows;
      assert.equal(found.length, required.length);
      assert(found.every(r => r.relrowsecurity && r.relforcerowsecurity));
      await observer.query(`
        INSERT INTO prima.site_tasks VALUES('task-a','co-a','{"id":"task-a","companyId":"co-a"}'),('task-b','co-b','{"id":"task-b","companyId":"co-b"}');
        INSERT INTO prima.staff_ids VALUES('id-a','{"id":"id-a","companyId":"co-a","guard":false}');
      `);
      runtime = await client(name, 'prima_api');
      await runtime.query('SET ROLE prima_app');
      await runtime.query("SELECT set_config('app.company_ids','co-a',false),set_config('app.user_id','u-kept',false),set_config('app.walls','',false)");
      assert.deepEqual((await runtime.query('SELECT id FROM prima.site_tasks ORDER BY id')).rows, [{id: 'task-a'}]);
      await assert.rejects(() => runtime.query(`INSERT INTO prima.site_tasks VALUES('wrong-co','co-b','{"id":"wrong-co","companyId":"co-b"}')`), e => e.code === '42501');
      assert.equal((await runtime.query('SELECT count(*)::int n FROM prima.staff_ids')).rows[0].n, 0);
      await runtime.query("SELECT set_config('app.walls','staff_ids',false)");
      assert.equal((await runtime.query('SELECT count(*)::int n FROM prima.staff_ids')).rows[0].n, 1);
      t.diagnostic('New forced-RLS tables, wrong-company rejection and sensitive-HR read wall verified');
      assert.deepEqual((await observer.query("SELECT to_regclass('prima.guard_pay_runs') AS payroll,to_regclass('prima.item_units') AS items")).rows, [{payroll: null, items: null}]);
      pool = new Pool(connection(name, 'prima_api'));
      const state = await releaseCatalogState(pool, {baseSha256: NEXT_SHA});
      assert.equal(state.ready, false, JSON.stringify(state));
      assert.equal(state.baseReady, true, JSON.stringify(state));
      for (const id of MODULE_IDS) assert.equal(state.modules[id].ready, true, id + ' ' + JSON.stringify(state));
      for (const id of NEW_MODULE_IDS) assert.equal(state.modules[id].ready, false, id + ' must stay not ready until explicitly installed');
      t.diagnostic('Base upgrade alone installs no payroll/item tables; compiled catalogue validates base and five frozen modules and holds the release until the item register is explicitly installed');
      for (const name of ['ic_scope','rc_scope']) { const body=(await observer.query("SELECT pg_get_functiondef(oid) body FROM pg_proc WHERE pronamespace='prima'::regnamespace AND proname=$1",[name])).rows; assert.equal(body.length,1);assert(body[0].body.includes("'goodwill'"));assert(body[0].body.includes("'companyIds'")); }
      await observer.query(`INSERT INTO prima.users VALUES('u-scope','{"id":"u-scope","role":"pwvsb_officer","department":"it","itRole":"manager","companyIds":["goodwill","sasateam","pgl"]}')`);
      for (const company of ['goodwill','sasateam','pgl']) {
        assert.deepEqual((await observer.query('SELECT prima.ic_scope($1,$2) ic,prima.rc_scope($1,$2) rc',['u-scope',company])).rows,[{ic:true,rc:true}]);
        assert.deepEqual((await observer.query('SELECT prima.ic_scope($1,$2) ic,prima.rc_scope($1,$2) rc',['u-kept',company])).rows,[{ic:false,rc:false}]);
      }
      assert.deepEqual((await observer.query('SELECT prima.ic_scope($1,$2) ic,prima.rc_scope($1,$2) rc',['u-scope','pwvsb'])).rows,[{ic:false,rc:false}]);
      t.diagnostic('Both scope functions accept three reviewed entities only with actual user grants, and reject ungranted company');

      const afterNames = await tableNames(observer), afterRows = await rowsSnapshot(observer, afterNames);
      await owner.query(nextSql);
      for (const delta of moduleDeltaBodies) await owner.query(delta);
      assert.deepEqual(await rowsSnapshot(observer, afterNames), afterRows);
      assert.deepEqual(await roleSnapshot(), beforeRoles);
      assert.deepEqual(await membershipSnapshot(), beforeMembership);
      t.diagnostic(`Exact raw SQL replay preserved rows/authority; source ${OLD_SHA} -> ${NEXT_SHA}`);

      // Explicit operator install of the new module through the pinned installer only.
      // The installer requires existing prima_app membership (SET), which the restricted owner lacks.
      if (profile === 'restricted') {
        await assert.rejects(() => installSelectedModule(owner, {id: 'item_register', releaseSha256: releaseArtifact(ROOT).sha256, moduleSha256: releaseArtifact(ROOT).manifest.modules.find(m => m.id === 'item_register').sha256, confirm: 'INSTALL_SELECTED_MODULE'}, ROOT));
        assert.equal((await observer.query("SELECT to_regclass('prima.item_units') AS t")).rows[0].t, null);
        await admin.query(`GRANT prima_app TO ${name} WITH INHERIT FALSE, SET TRUE`);
      }
      const artifact = releaseArtifact(ROOT), itemModule = artifact.manifest.modules.find(m => m.id === 'item_register');
      if (profile === 'existing_admin') {
        // The installer refuses an owner that bypasses row security; such an environment needs a separate reviewed owner.
        await assert.rejects(() => installSelectedModule(owner, {id: 'item_register', releaseSha256: artifact.sha256, moduleSha256: itemModule.sha256, confirm: 'INSTALL_SELECTED_MODULE'}, ROOT));
        assert.equal((await observer.query("SELECT to_regclass('prima.item_units') AS t")).rows[0].t, null);
        assert.equal((await releaseCatalogState(pool, {baseSha256: NEXT_SHA})).ready, false);
        t.diagnostic('Pinned installer refuses a row-security-bypassing owner and the release stays held');
        return;
      }
      await assert.rejects(() => installSelectedModule(owner, {id: 'item_register', releaseSha256: artifact.sha256, moduleSha256: itemModule.sha256, confirm: 'yes'}, ROOT), /Exact selected module/);
      await installSelectedModule(owner, {id: 'item_register', releaseSha256: artifact.sha256, moduleSha256: itemModule.sha256, confirm: 'INSTALL_SELECTED_MODULE'}, ROOT);
      // P85: the second part (label print log, SQL books, export files, counters) installs after the first.
      const v2Module = artifact.manifest.modules.find(m => m.id === 'item_register_v2');
      assert.equal((await releaseCatalogState(pool, {baseSha256: NEXT_SHA})).ready, false, 'release held until the second item part is in');
      await installSelectedModule(owner, {id: 'item_register_v2', releaseSha256: artifact.sha256, moduleSha256: v2Module.sha256, confirm: 'INSTALL_SELECTED_MODULE'}, ROOT);
      const installed = await releaseCatalogState(pool, {baseSha256: NEXT_SHA});
      assert.equal(installed.ready, true, JSON.stringify(installed));
      const kept = await rowsSnapshot(observer, afterNames);
      for (const n of afterNames) assert.deepEqual(kept[n], afterRows[n], 'Item install changed old rows: ' + n);
      await installSelectedModule(owner, {id: 'item_register', releaseSha256: artifact.sha256, moduleSha256: itemModule.sha256, confirm: 'INSTALL_SELECTED_MODULE'}, ROOT);
      t.diagnostic('Pinned installer adds the item register only on exact confirmation, keeps every row, repeats as a no-op, and the complete seven-module release then validates');
    } finally {
      await pool?.end();
      await runtime?.end();
      await owner?.end();
      await observer?.end();
      // Only the database successfully created and tracked by this test is removed.
      if (createdDatabases.has(name)) {
        await admin.query(`DROP DATABASE ${sqlName(name)} WITH (FORCE)`);
        createdDatabases.delete(name);
      }
    }
  });
}
