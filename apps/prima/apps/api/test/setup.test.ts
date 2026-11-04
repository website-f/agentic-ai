import { assertAdditiveSchema } from './schema-additive';
// The staging database setup, run the way Azure runs it: as a database administrator that is NOT a superuser, into
// its own database, followed by the API working as its own least-privilege login. Uses a separate throwaway database
// so it never touches the one rls.test.ts resets.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, Pool } from 'pg';
import { chainEntry, verifyChain, type AuditEntry } from '@prima/core';
import { HealthController } from '../src/controllers';
import { Db, schemaState } from '../src/db';
import { cleanSlate, parseBootstrapLinks, setupDb } from '../src/db-setup';
import { migrationSha, migrationSql } from '../src/schema';
import { createApp } from '../src/main';
import { releaseArtifact, selectedModuleSql } from '../src/release-artifact';

const BASE = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(BASE).hostname)) throw Error('Disposable localhost database required');
const DBNAME = 'prima_setup_test';
const ADMIN = 'prima_setup_admin';
const RUNTIME = 'prima_api_test';
const OID = '0b0b0b0b-0000-4000-8000-000000000001';

function urlAs(user: string, password = 'local-only') {
  const u = new URL(BASE);
  u.username = user;
  u.password = password;
  u.pathname = `/${DBNAME}`;
  return u.toString();
}

async function superuser<R>(fn: (c: Client) => Promise<R>, url = BASE): Promise<R> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Reads the setup database past the company wall (as the local superuser), to check what was written. */
function inspect<R>(fn: (c: Client) => Promise<R>): Promise<R> {
  const u = new URL(BASE);
  u.pathname = `/${DBNAME}`;
  return superuser(fn, u.toString());
}

const env = { PRIMA_API_DB_USER: RUNTIME, PRIMA_API_DB_PASSWORD: 'x'.repeat(32), ENTRA_BOOTSTRAP_LINKS: `u-fauzan=${OID.toUpperCase()}` };

describe('staging database setup', () => {
  let admin: Pool;
  before(async () => {
    await superuser(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`);
      for (const r of [RUNTIME, ADMIN]) {
        const has = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r]);
        if (has.rowCount) {
          await c.query(`REASSIGN OWNED BY ${r} TO postgres`).catch(() => undefined);
          await c.query(`DROP OWNED BY ${r}`).catch(() => undefined);
          await c.query(`DROP ROLE ${r}`);
        }
      }
      // Like the Azure server admin: may create roles and databases, but is not a superuser.
      await c.query(`CREATE ROLE ${ADMIN} LOGIN CREATEROLE CREATEDB PASSWORD 'local-only'`);
      await c.query(`CREATE DATABASE ${DBNAME} OWNER ${ADMIN}`);
      // prima_app is cluster-wide and may already exist from other test runs; on a new Azure server the admin creates
      // it and holds ADMIN on it. Give the test admin the same standing.
      const app = await c.query(`SELECT 1 FROM pg_roles WHERE rolname = 'prima_app'`);
      if (app.rowCount) await c.query(`GRANT prima_app TO ${ADMIN} WITH ADMIN OPTION, INHERIT FALSE, SET FALSE`);
    });
    admin = new Pool({ connectionString: urlAs(ADMIN), max: 1 });
  });
  after(async () => {
    await admin.end();
  });

  it('creates a clean slate: companies, staff accounts, grants and settings, no operational records', async () => {
    const c = await admin.connect();
    try {
      const r = await setupDb(c, env, '2026-10-28T10:00:00+08:00');
      assert.equal(r.created, true);
      assert.deepEqual(r.linked, ['u-fauzan']);
      await inspect(async (s) => {
        const n = async (t: string) => Number((await s.query(`SELECT count(*) AS n FROM prima.${t}`)).rows[0].n);
        assert.equal(await n('companies'), 38);
        assert.ok((await n('users')) > 10);
        assert.ok((await n('grants')) > 0);
        for (const t of ['people', 'sites', 'shifts', 'cases', 'it_tickets', 'it_assets', 'contracts', 'firearms']) assert.equal(await n(t), 0, t);
        const audit = (await s.query('SELECT data FROM prima.audit ORDER BY seq')).rows.map((x) => x.data as AuditEntry);
        assert.deepEqual(
          audit.map((a) => a.action),
          ['ENTRA_LINK'],
        );
        assert.equal(verifyChain(audit), null);
        const u = await s.query(`SELECT data->>'entraOid' AS oid FROM prima.users WHERE id = 'u-fauzan'`);
        assert.equal(u.rows[0].oid, OID);
      });
    } finally {
      c.release();
    }
  });

  it('never wipes or reloads a database that is already set up, and never moves an existing link', async () => {
    const c = await admin.connect();
    try {
      await inspect((s) => s.query(`INSERT INTO prima.people (id, company_id, data) VALUES ('pr-kept', 'co-sasa', '{"id":"pr-kept","companyId":"co-sasa"}')`));
      const r = await setupDb(c, { ...env, ENTRA_BOOTSTRAP_LINKS: 'u-fauzan=0b0b0b0b-0000-4000-8000-0000000000ff' });
      assert.equal(r.created, false);
      assert.deepEqual(r.linked, []);
      await inspect(async (s) => {
        assert.equal((await s.query(`SELECT count(*) AS n FROM prima.people WHERE id = 'pr-kept'`)).rows[0].n, '1');
        assert.equal((await s.query(`SELECT count(*) AS n FROM prima.companies`)).rows[0].n, '38');
        assert.equal((await s.query(`SELECT data->>'entraOid' AS oid FROM prima.users WHERE id = 'u-fauzan'`)).rows[0].oid, OID);
      });
      await assert.rejects(setupDb(c, { ...env, ENTRA_BOOTSTRAP_LINKS: 'u-nobody=' + OID }), /no staff record/);
      await assert.rejects(setupDb(c, { ...env, PRIMA_API_DB_PASSWORD: 'short' }), /at least 24/);
    } finally {
      c.release();
    }
  });

  it('gives the API login only what it needs', async () => {
    const c = new Client({ connectionString: urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD) });
    await c.connect();
    try {
      const role = await c.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = current_user`);
      assert.deepEqual(role.rows[0], { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolinherit: false });
      assert.ok((await c.query('SELECT count(*) FROM prima.users')).rowCount);
      await assert.rejects(c.query('SELECT * FROM prima.people'), /permission denied/);
      await assert.rejects(c.query(`UPDATE prima.users SET data = data WHERE id = 'u-fauzan'`), /permission denied/);
      await assert.rejects(c.query('CREATE TABLE prima.x (id int)'), /permission denied/);
      await assert.rejects(c.query('DELETE FROM prima.audit'), /permission denied/);
      await assert.rejects(c.query(`SET ROLE ${ADMIN}`), /permission denied/);
    } finally {
      await c.end();
    }
  });

  it('runs the API as that login with the company wall and audit chain intact', async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD);
    const db = new Db();
    process.env.DATABASE_URL = saved;
    try {
      const seen = await db.asUser('u-cm-sasa', async (svc, u) => (await svc.visibleCompanies(u)).map((x) => x.id));
      assert.deepEqual(seen, ['co-sasa']);
      await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.companyDashboard(u, 'co-arsh')));
      await db.asUser('u-fauzan', (svc, u) => svc.acceptConfidentiality(u));
      const audit = await inspect(async (s) => (await s.query('SELECT data FROM prima.audit ORDER BY seq')).rows.map((x) => x.data as AuditEntry));
      assert.deepEqual(
        audit.map((a) => a.action),
        ['ENTRA_LINK', 'confidentiality.accept'],
      );
      assert.equal(verifyChain(audit), null);
      assert.deepEqual(await new HealthController(db).health(), { ok: true });
    } finally {
      await db.onModuleDestroy();
    }
  });

  it('runs review retention as the non-superuser schema owner, called by the API login through the app role', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    // Expired an hour ago: expired now, cleared 30 days from that expiry.
    const t = new Date(Date.now() - 3_600_000).toISOString();
    const review = { id, actorId: 'u-fauzan', kind: 'tickets', parts: [], counts: { rows: 0 }, reviewedHash: '0'.repeat(64), previewToken: 'p', status: 'reviewing', version: 1, receipt: null, createdAt: t, updatedAt: t, expiresAt: t, purgeAfter: null, purged: false, requestHash: '1'.repeat(64) };
    const a = await admin.connect();
    try {
      await a.query('INSERT INTO prima.it_import_reviews (id, data) VALUES ($1, $2)', [id, review]);
    } finally {
      a.release();
    }
    const c = new Client({ connectionString: urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD) });
    await c.connect();
    try {
      await assert.rejects(c.query('SELECT * FROM prima.it_import_reviews'), /permission denied/);
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE prima_app');
      await assert.rejects(c.query(`SELECT * FROM prima.tidy_it_import_reviews('UAT setup check')`), /Only the CEO/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE prima_app');
      await c.query(`SELECT set_config('app.job', 'review-tidy', true)`);
      const out = await c.query(`SELECT review_id, outcome FROM prima.tidy_it_import_reviews('UAT setup check')`);
      assert.deepEqual(out.rows, [{ review_id: id, outcome: 'expired' }]);
      assert.equal((await c.query('SELECT id FROM prima.it_import_reviews')).rowCount, 0, 'the app role still reads none without the CEO');
      await c.query('COMMIT');
    } finally {
      await c.end();
    }
    await inspect(async (s) => {
      assert.equal((await s.query(`SELECT data->>'status' AS st FROM prima.it_import_reviews WHERE id = $1`, [id])).rows[0].st, 'expired');
      const audit = (await s.query('SELECT data FROM prima.audit ORDER BY seq')).rows.map((x) => x.data as AuditEntry);
      assert.equal(audit.at(-1)?.action, 'it.import.review.expire');
      assert.equal(audit.at(-1)?.actor, 'UAT setup check');
      assert.equal(verifyChain(audit), null);
    });
  });

  it('a staff member who sees one company still appends after another company\'s audit entry (true chain head)', async () => {
    // Another company's entry is the newest; a Sasa company manager cannot read it.
    await inspect(async (s) => {
      const head = (await s.query('SELECT data FROM prima.audit ORDER BY seq DESC LIMIT 1')).rows[0].data as AuditEntry;
      const e = chainEntry(head.seq, head.hash, { at: '2026-10-31T22:00:00+08:00', actor: 'UAT', companyId: 'co-arsh', action: 'uat.other.company', entity: 'uat', entityId: 'x', summary: 'UAT entry for another company' });
      await s.query('INSERT INTO prima.audit (seq, company_id, data) VALUES ($1, $2, $3)', [e.seq, e.companyId, e]);
    });
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD);
    const db = new Db();
    process.env.DATABASE_URL = saved;
    try {
      await db.asUser('u-cm-sasa', (svc, u) => svc.acceptConfidentiality(u));
    } finally {
      await db.onModuleDestroy();
    }
    const audit = await inspect(async (s) => (await s.query('SELECT data FROM prima.audit ORDER BY seq')).rows.map((x) => x.data as AuditEntry));
    assert.deepEqual(audit.slice(-2).map((a) => a.action), ['uat.other.company', 'confidentiality.accept']);
    assert.equal(verifyChain(audit), null);
  });

  it('reports not ready when the database has no Prima schema yet', async () => {
    const EMPTY = 'prima_setup_empty';
    await superuser((c) => c.query(`DROP DATABASE IF EXISTS ${EMPTY} WITH (FORCE)`).then(() => c.query(`CREATE DATABASE ${EMPTY}`)));
    const saved = process.env.DATABASE_URL;
    const u = new URL(BASE);
    u.pathname = `/${EMPTY}`;
    process.env.DATABASE_URL = u.toString();
    const db = new Db();
    process.env.DATABASE_URL = saved;
    try {
      await assert.rejects(new HealthController(db).health(), /prima\.users/);
    } finally {
      await db.onModuleDestroy();
      await superuser((c) => c.query(`DROP DATABASE ${EMPTY} WITH (FORCE)`));
    }
  });
});

describe('setup helpers', () => {
  it('runs a schema file that only adds: no table, row or schema is ever dropped or emptied', () => {
    assertAdditiveSchema(migrationSql());
  });

  it('reads bootstrap links and refuses malformed ones', () => {
    assert.deepEqual(parseBootstrapLinks(' u-a = AB , u-b=cd '), [
      { userId: 'u-a', oid: 'ab' },
      { userId: 'u-b', oid: 'cd' },
    ]);
    assert.deepEqual(parseBootstrapLinks(undefined), []);
    assert.throws(() => parseBootstrapLinks('u-a'));
  });

  it('keeps only accounts, companies, grants and settings in a clean slate', () => {
    const ds = cleanSlate({ companies: [1], users: [1], grants: [1], people: [1], audit: [1], itSettings: [1] } as never);
    assert.deepEqual(ds as unknown, { companies: [1], users: [1], grants: [1], people: [], audit: [], itSettings: [1] });
  });
});

describe('production start-up', () => {
  async function startAs(url: string, user?: string) {
    const saved = { env: process.env.NODE_ENV, url: process.env.DATABASE_URL, user: process.env.PRIMA_API_DB_USER };
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = url;
    if (user) process.env.PRIMA_API_DB_USER = user;
    else delete process.env.PRIMA_API_DB_USER;
    try {
      const app = await createApp();
      await app.close();
    } finally {
      process.env.NODE_ENV = saved.env;
      process.env.DATABASE_URL = saved.url;
      if (saved.user === undefined) delete process.env.PRIMA_API_DB_USER;
      else process.env.PRIMA_API_DB_USER = saved.user;
    }
  }

  it('refuses base-only startup, then explicitly installs all reviewed modules as the existing disposable owner', async () => {
    await assert.rejects(startAs(urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD), RUNTIME), /Complete release SQL\/catalog is not ready/);
    const artifact = releaseArtifact();
    const c = new Client({ connectionString: urlAs(ADMIN) });
    await c.connect();
    try {
      const role = (await c.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
      // Explicit test-fixture installation, not setupDb/startup behaviour. Preserve the
      // owner's existing SET FALSE membership; do not grant it runtime impersonation.
      // The separate installer suite exercises the selected-module command and its postchecks.
      for (const module of artifact.manifest.modules) {
        const selected = selectedModuleSql(module.id);
        assert.equal(selected.artifact.sha256, artifact.sha256);
        assert.equal(selected.module.sha256, module.sha256);
        await c.query(selected.sql);
      }
    } finally {
      await c.end();
    }
  });

  it('starts as the restricted API login', async () => {
    await startAs(urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD), RUNTIME);
  });

  it('refuses to start on an older schema until the database setup job has run, without a new password', async () => {
    await inspect((s) => s.query(`UPDATE prima.schema_info SET migration_sha256 = 'older'`));
    await assert.rejects(startAs(urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD), RUNTIME), /schema is version older.*Run the database setup job/);
    const runtime = new Pool({ connectionString: urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD), max: 1 });
    try {
      assert.deepEqual(await schemaState(runtime), { current: false, expected: migrationSha(), applied: 'older' });
    } finally {
      await runtime.end();
    }
    // The CEO's migration run: the setup job with no new password keeps the API login's password and restates its reads.
    const c = new Client({ connectionString: urlAs(ADMIN) });
    await c.connect();
    try {
      const r = await setupDb(c as never, { PRIMA_API_DB_USER: RUNTIME });
      assert.equal(r.created, false);
    } finally {
      await c.end();
    }
    await startAs(urlAs(RUNTIME, env.PRIMA_API_DB_PASSWORD), RUNTIME);
    await inspect(async (s) => assert.equal((await s.query(`SELECT count(*) AS n FROM prima.people WHERE id = 'pr-kept'`)).rows[0].n, '1'));
  });

  it('refuses to start as the database administrator or a superuser', async () => {
    await assert.rejects(startAs(urlAs(ADMIN), ADMIN), /more rights than the API may hold/);
    await assert.rejects(startAs(urlAs(ADMIN)), /must connect as prima_api, not prima_setup_admin/);
    const su = new URL(BASE);
    su.pathname = `/${DBNAME}`;
    await assert.rejects(startAs(su.toString()), /must connect as prima_api/);
  });

  it('refuses to start with the test sign-in switched on', async () => {
    const saved = { env: process.env.NODE_ENV, dev: process.env.ALLOW_DEV_LOGIN };
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_LOGIN = 'true';
    try {
      await assert.rejects(createApp(), /ALLOW_DEV_LOGIN must not be true in production/);
    } finally {
      process.env.NODE_ENV = saved.env;
      if (saved.dev === undefined) delete process.env.ALLOW_DEV_LOGIN;
      else process.env.ALLOW_DEV_LOGIN = saved.dev;
    }
  });
});
