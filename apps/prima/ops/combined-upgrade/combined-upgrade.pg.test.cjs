'use strict';
// Disposable PostgreSQL rehearsal ONLY. Never run against Azure/staging. Synthetic records only.
// Starts from exactly what stage 1 leaves (candidate.sql 4b4c… + the five frozen released modules), then drives the
// real CLI and runner through a code-only client that talks to localhost but reports the expected production target.
// This is NOT Azure TLS verification. Build @prima/core and @prima/api first (the compiled release catalogue is used).
const { before, after, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { Client, Pool } = require('pg');
const { run, verifyArtifact } = require('./cli.cjs');
const { REQUIRED_FORCED_RLS } = require('./runner.cjs');

const ROOT = path.resolve(__dirname, '../..');
const { oldSha: OLD, newSha: NEXT } = verifyArtifact();
const base = new URL(process.env.TEST_POSTGRES_URL || 'postgres://postgres:localdev@localhost:5432/postgres');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname)) throw Error('Disposable localhost PostgreSQL required');
const { releaseCatalogState } = require(path.join(ROOT, 'apps/api/dist/src/release-catalog.js'));
const OWNER = 'prima_combined_upgrade_test_owner';
const HOST = 'psql-prima-staging-sea.postgres.database.azure.com';
const PW = 'local-test-only';
let admin, observer, created = false;

const url = (user, database = 'appdb') => { const u = new URL(base); u.pathname = '/' + database; u.username = user; u.password = user === 'postgres' ? base.password : PW; return u.toString(); };
const stamp = async () => (await observer.query('SELECT migration_sha256 FROM prima.schema_info')).rows[0].migration_sha256;
const tableCount = async () => (await observer.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='prima'")).rows[0].n;

before(async () => {
  admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_database WHERE datname='appdb'")).rows[0].n, 0, 'Refuse to replace an existing local appdb');
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1)', [[OWNER, 'prima_app', 'prima_api']])).rows[0].n, 0, 'Fresh disposable cluster required; never modify pre-existing roles');
  for (const [name, attrs] of [[OWNER, `LOGIN NOCREATEDB NOCREATEROLE INHERIT PASSWORD '${PW}'`], ['prima_app', 'NOLOGIN NOCREATEDB NOCREATEROLE'], ['prima_api', `LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD '${PW}'`]]) {
    await admin.query(`CREATE ROLE ${name} ${attrs} NOSUPERUSER NOBYPASSRLS`);
  }
  await admin.query('GRANT prima_app TO prima_api');
  await admin.query(`CREATE DATABASE appdb OWNER ${OWNER}`);
  created = true;

  // Exactly what stage 1 and the released-module installer leave behind.
  const owner = new Client({ connectionString: url(OWNER) });
  await owner.connect();
  try {
    await owner.query(fs.readFileSync(path.join(ROOT, 'ops/base-transition/candidate.sql'), 'utf8'));
    await owner.query('INSERT INTO prima.schema_info VALUES(1,$1,now())', [OLD]);
    await owner.query('GRANT USAGE ON SCHEMA prima TO prima_api');
    await owner.query('GRANT SELECT ON prima.users,prima.grants,prima.schema_info TO prima_api');
    const frozen = path.join(ROOT, 'ops/existing-admin/modules/working');
    const manifest = JSON.parse(fs.readFileSync(path.join(frozen, 'db/release-manifest.json'), 'utf8'));
    assert.equal(manifest.base.sha256, OLD);
    for (const m of manifest.modules) await owner.query(fs.readFileSync(path.join(frozen, m.path), 'utf8'));
  } finally { await owner.end(); }

  observer = new Client({ connectionString: url('postgres') });
  await observer.connect();
  await observer.query(`
    INSERT INTO prima.users VALUES('u-kept','{"id":"u-kept","entraOid":"11111111-1111-4111-8111-111111111111"}');
    INSERT INTO prima.grants VALUES('g-kept','co-a','{"id":"g-kept","userId":"u-kept","companyId":"co-a"}');
    INSERT INTO prima.audit VALUES(1,'co-a','{"seq":1,"companyId":"co-a","action":"synthetic.preserved","hash":"unchanged"}');
    INSERT INTO prima.people VALUES('p-kept','co-a','{"id":"p-kept","companyId":"co-a","name":"Synthetic only"}');
    INSERT INTO prima.sites VALUES('s-kept','co-a','{"id":"s-kept","companyId":"co-a","name":"Synthetic site"}');
  `);
});

after(async () => {
  await observer?.end();
  if (created) await admin.query('DROP DATABASE appdb WITH (FORCE)');
  if (admin) for (const r of ['prima_api', 'prima_app', OWNER]) await admin.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
  await admin?.end();
});

const env = { DATABASE_URL: `postgresql://${OWNER}:${PW}@${HOST}:5432/appdb?sslmode=verify-full` };
const args = () => { const p = verifyArtifact(); return ['execute', '--owner', OWNER, '--artifact-sha', p.artifactSha, '--old-sha', OLD, '--new-sha', NEXT, '--runner-sha', p.runnerSha, '--confirm', 'MIGRATE_EXACT_COMBINED_BASE_ONLY']; };

function factory({ actualUser = OWNER, failAfterUpgrade = false } = {}) {
  const calls = { ended: 0, upgrade: 0 };
  return {
    calls,
    makeClient(config) {
      assert.equal(config.host, HOST); assert.equal(config.database, 'appdb'); assert.equal(config.user, OWNER);
      assert.deepEqual(config.ssl, { rejectUnauthorized: true, servername: HOST });
      const db = new Client({ connectionString: url(actualUser) });
      return {
        connectionParameters: { host: config.host, port: config.port, database: config.database, user: config.user },
        connection: { stream: { encrypted: true, authorized: true } },
        on(event, handler) { db.on(event, handler); },
        async connect() { await db.connect(); },
        async query(sql, params) {
          const r = await db.query(sql, params);
          if (typeof sql === 'string' && sql.includes('-- Prima Secure App')) { calls.upgrade++; if (failAfterUpgrade) throw Error('synthetic-private-error'); }
          return r;
        },
        async end() { calls.ended++; await db.end(); },
      };
    },
  };
}

it('the runtime login cannot pose as the schema owner', async () => {
  const f = factory({ actualUser: 'prima_api' });
  const r = await run(args(), env, f);
  assert.equal(r.code, 'OWNER_OR_TARGET_MISMATCH');
  assert.equal(f.calls.upgrade, 0); assert.equal(f.calls.ended, 1);
  assert.equal(await stamp(), OLD);
});

it('a database not at the stage 1 base is refused and left untouched', async () => {
  await observer.query("UPDATE prima.schema_info SET migration_sha256='0000000000000000000000000000000000000000000000000000000000000000'");
  try {
    const before = await tableCount();
    const f = factory();
    const r = await run(args(), env, f);
    assert.equal(r.status, 'refused'); assert.equal(r.code, 'BASE_HASH_MISMATCH');
    assert.equal(f.calls.upgrade, 0);
    assert.equal(await tableCount(), before);
  } finally { await observer.query('UPDATE prima.schema_info SET migration_sha256=$1', [OLD]); }
});

it('owner default privileges that would add grants to the new tables are refused', async () => {
  const owner = new Client({ connectionString: url(OWNER) });
  await owner.connect();
  try {
    await owner.query('ALTER DEFAULT PRIVILEGES IN SCHEMA prima GRANT DELETE ON TABLES TO prima_app');
    const f = factory();
    const r = await run(args(), env, f);
    assert.equal(r.status, 'refused'); assert.equal(r.code, 'DEFAULT_PRIVILEGES_UNREVIEWED');
    assert.equal(f.calls.upgrade, 0);
    assert.equal(await stamp(), OLD);
  } finally {
    await owner.query('ALTER DEFAULT PRIVILEGES IN SCHEMA prima REVOKE DELETE ON TABLES FROM prima_app');
    await owner.end();
  }
});

it('a failure after the whole upgrade SQL rolls everything back, with a sanitized result', async () => {
  const before = await tableCount();
  const f = factory({ failAfterUpgrade: true });
  const r = await run(args(), env, f);
  assert.equal(r.status, 'rolled_back'); assert.equal(r.stage, 'apply');
  assert.equal(f.calls.upgrade, 1); assert.equal(f.calls.ended, 1);
  assert.ok(!JSON.stringify(r).includes('synthetic-private'));
  assert.equal(await stamp(), OLD);
  assert.equal(await tableCount(), before);
  assert.equal((await observer.query("SELECT to_regclass('prima.site_tasks') t")).rows[0].t, null);
});

it('the exact upgrade commits, keeps every old row and role, and passes the API release catalogue', async (t) => {
  const keptBefore = (await observer.query(`SELECT (SELECT count(*) FROM prima.users)::int u,(SELECT count(*) FROM prima.grants)::int g,(SELECT count(*) FROM prima.audit)::int a,(SELECT count(*) FROM prima.people)::int p,(SELECT count(*) FROM prima.sites)::int s`)).rows[0];
  const f = factory();
  const r = await run(args(), env, f);
  assert.equal(r.status, 'committed', JSON.stringify(r));
  assert.equal(f.calls.ended, 1);
  assert.equal(await stamp(), NEXT);
  const keptAfter = (await observer.query(`SELECT (SELECT count(*) FROM prima.users)::int u,(SELECT count(*) FROM prima.grants)::int g,(SELECT count(*) FROM prima.audit)::int a,(SELECT count(*) FROM prima.people)::int p,(SELECT count(*) FROM prima.sites)::int s`)).rows[0];
  assert.deepEqual(keptAfter, keptBefore);
  assert.equal((await observer.query("SELECT data->>'entraOid' oid FROM prima.users WHERE id='u-kept'")).rows[0].oid, '11111111-1111-4111-8111-111111111111');
  t.diagnostic(`Committed: ${r.preservedTables} tables kept byte-for-byte, ${r.newTables} new tables`);

  const forced = (await observer.query("SELECT relname FROM pg_class WHERE relnamespace='prima'::regnamespace AND relrowsecurity AND relforcerowsecurity AND relname=ANY($1)", [REQUIRED_FORCED_RLS])).rows;
  assert.equal(forced.length, REQUIRED_FORCED_RLS.length);

  // The company wall holds on the new site-device tables for the restricted API login.
  await observer.query(`INSERT INTO prima.site_tasks VALUES('task-a','co-a','{"id":"task-a","companyId":"co-a"}'),('task-b','co-b','{"id":"task-b","companyId":"co-b"}');
    INSERT INTO prima.gate_entries VALUES('gate-a','co-a','{"id":"gate-a","companyId":"co-a"}'),('gate-b','co-b','{"id":"gate-b","companyId":"co-b"}');`);
  const api = new Client({ connectionString: url('prima_api') });
  await api.connect();
  try {
    await api.query('SET ROLE prima_app');
    await api.query("SELECT set_config('app.company_ids','co-a',false),set_config('app.user_id','u-kept',false),set_config('app.walls','',false)");
    assert.deepEqual((await api.query('SELECT id FROM prima.site_tasks ORDER BY id')).rows, [{ id: 'task-a' }]);
    assert.deepEqual((await api.query('SELECT id FROM prima.gate_entries ORDER BY id')).rows, [{ id: 'gate-a' }]);
    await assert.rejects(() => api.query(`INSERT INTO prima.gate_entries VALUES('wrong','co-b','{"id":"wrong","companyId":"co-b"}')`), (e) => e.code === '42501');
  } finally { await api.end(); }

  const prev = process.env.PRIMA_API_DB_USER;
  process.env.PRIMA_API_DB_USER = 'prima_api';
  const pool = new Pool({ connectionString: url('prima_api') });
  try {
    const state = await releaseCatalogState(pool, { baseSha256: NEXT });
    // The release now carries modules the frozen five did not (item register, 8 Nov 2026). The base upgrade alone
    // never installs them: the base and the five frozen modules are ready, and the release stays held until an operator
    // installs each new module with the pinned installer.
    const FROZEN = ['procurement', 'rental_corrections', 'cleanup', 'metrics', 'job_email'];
    assert.equal(state.baseReady, true, JSON.stringify(state));
    for (const id of FROZEN) assert.equal(state.modules[id].ready, true, id + ' ' + JSON.stringify(state));
    const added = Object.keys(state.modules).filter((id) => !FROZEN.includes(id));
    for (const id of added) assert.equal(state.modules[id].ready, false, id + ' must stay not ready until explicitly installed');
    assert.equal(state.ready, added.length === 0, JSON.stringify(state));
  } finally { await pool.end(); if (prev === undefined) delete process.env.PRIMA_API_DB_USER; else process.env.PRIMA_API_DB_USER = prev; }
  t.diagnostic('Company wall on site tasks and gate records, and the compiled API release catalogue, verified');
});

it('a second run is refused and changes nothing', async () => {
  const f = factory();
  const r = await run(args(), env, f);
  assert.equal(r.status, 'refused'); assert.equal(r.code, 'ALREADY_AT_COMBINED_BASE');
  assert.equal(f.calls.upgrade, 0);
  assert.equal(await stamp(), NEXT);
});
