/**
 * Real-data import preview on a disposable localhost PostgreSQL only (Arisha review of PR #56, 2 Nov 2026).
 * Proves the preview keeps nothing through the real PgStore savepoints: mixed good and refused rows, nested units,
 * an outer failure, two sessions at once, and the same file committed twice at once. Synthetic users and records only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, type PoolClient } from 'pg';
import { PrimaService, dataWalls, withOrgLinks, type User } from '@prima/core';
import { PgStore } from '../src/pg-store';
import { migrationSql } from '../src/schema';

const BASE = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(BASE).hostname)) throw Error('Requires disposable localhost PostgreSQL');
const DB = 'prima_org_import_test';
const OWNER = 'prima_org_import_owner_test';
const url = new URL(BASE);
url.pathname = '/' + DB;
url.username = OWNER;
url.password = 'local-test-only';
const path = (f: string) => resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../../' + f : f);

const users = [
  { id: 'it-mgr', name: 'Synthetic IT Manager', role: 'pwvsb_officer', department: 'it', itRole: 'manager', companyIds: [], siteIds: [] },
  { id: 'it-mgr-2', name: 'Synthetic IT Manager Two', role: 'pwvsb_officer', department: 'it', itRole: 'manager', companyIds: [], siteIds: [] },
].map((u) => ({ title: u.name, ...u })) as unknown as User[];

const NOW = '2026-11-02T10:30:00+08:00';
const LONG = 'x'.repeat(200) + '.example';
const MIXED = `name,kind,registrar\nsynthetic-a.example,domain,R\n${LONG},domain,R\nsynthetic-b.example,domain,R\n`;
const CLEAN = 'name,kind,registrar\nsynthetic-c.example,domain,R\nsynthetic-d.example,website,R\n';

async function connect(s: string) {
  const c = new Client({ connectionString: s });
  await c.connect();
  return c;
}
/** The same session settings Db.asUser sets; one request is one transaction. */
async function as<T>(id: string, fn: (svc: PrimaService, store: PgStore, user: User, c: Client) => Promise<T>) {
  const c = await connect(url.toString());
  const user = users.find((u) => u.id === id)!;
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(
      "SELECT set_config('app.user_id',$1,true), set_config('app.company_ids',$2,true), set_config('app.group_user','off',true), set_config('app.walls',$3,true)",
      [id, user.companyIds.join(','), dataWalls(user).join(',')],
    );
    const store = new PgStore(c as unknown as PoolClient);
    const r = await fn(new PrimaService(withOrgLinks(store), () => NOW), store, user, c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}
/** Every row, counted by the local superuser outside any request (no row security): what really persisted. */
async function persisted() {
  const su = new URL(BASE);
  su.pathname = '/' + DB;
  const c = await connect(su.toString());
  try {
    const n = async (sql: string) => Number((await c.query(sql)).rows[0].n);
    return {
      domains: await n('SELECT count(*) n FROM prima.it_domains'),
      audit: await n('SELECT count(*) n FROM prima.audit'),
      imports: await n('SELECT count(*) n FROM prima.org_imports'),
      events: await n('SELECT count(*) n FROM prima.org_events'),
    };
  } finally {
    await c.end();
  }
}

describe('import preview on PostgreSQL keeps nothing', () => {
  before(async () => {
    const c = await connect(BASE);
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
      if (!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [OWNER])).rowCount)
        await c.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`);
      if ((await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount) await c.query(`GRANT prima_app TO ${OWNER} WITH ADMIN OPTION`);
      await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    } finally {
      await c.end();
    }
    const a = await connect(url.toString());
    try {
      await a.query(migrationSql());
      await a.query(`GRANT prima_app TO ${OWNER}`);
      for (const u of users) await a.query('INSERT INTO prima.users(id,data) VALUES($1,$2)', [u.id, u]);
      await a.query(readFileSync(path('db/modules/org-links-v1.sql'), 'utf8'));
    } finally {
      await a.end();
    }
  });
  after(async () => {
    const c = await connect(BASE);
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    } finally {
      await c.end();
    }
  });

  it('nested units: an outer rollback undoes good units on both sides of a failed one', async () => {
    const start = await persisted();
    await as('it-mgr', async (_svc, store) => {
      await assert.rejects(
        store.transaction(async (tx) => {
          await tx.insert('itDomains', { id: 'dom-nest-1', name: 'n1.example', kind: 'domain', registrar: 'R' } as never);
          await assert.rejects(tx.transaction(async (t2) => (await t2.insert('itDomains', { id: 'dom-nest-x', name: 'nx.example' } as never), Promise.reject(new Error('inner refused')))));
          await tx.insert('itDomains', { id: 'dom-nest-2', name: 'n2.example', kind: 'domain', registrar: 'R' } as never);
          throw new Error('outer refused');
        }),
        /outer refused/,
      );
      // Same request, still open: nothing from the outer unit is visible.
      assert.ok(!(await store.get('itDomains', 'dom-nest-1')));
      assert.ok(!(await store.get('itDomains', 'dom-nest-2')));
    });
    assert.deepEqual(await persisted(), start);
  });

  it('mixed good and refused rows: the preview reports each row and nothing persists', async () => {
    const start = await persisted();
    const p = await as('it-mgr', async (svc, store, u) => {
      const r = await svc.orgImport.preview(u, 'itDomain', null, MIXED);
      // Checked inside the same request, before commit.
      assert.equal((await store.list('itDomains', {})).length, start.domains);
      return r;
    });
    assert.deepEqual(p.rows.map((r) => r.ok), [true, false, true]);
    assert.match(p.rows[1].problems.join(' '), /160|long|at most/i);
    assert.equal(p.canImport, false);
    assert.deepEqual(await persisted(), start);
  });

  it('a later failure in the same request after a preview leaves nothing either', async () => {
    const start = await persisted();
    await assert.rejects(
      as('it-mgr', async (svc, _store, u) => {
        await svc.orgImport.preview(u, 'itDomain', null, CLEAN);
        throw new Error('request failed after the preview');
      }),
    );
    assert.deepEqual(await persisted(), start);
  });

  it('two people previewing at once keep nothing; the same file committed twice at once lands once', async () => {
    const start = await persisted();
    const [a, b] = await Promise.all([
      as('it-mgr', (svc, _s, u) => svc.orgImport.preview(u, 'itDomain', null, MIXED)),
      as('it-mgr-2', (svc, _s, u) => svc.orgImport.preview(u, 'itDomain', null, CLEAN)),
    ]);
    assert.equal(a.canImport, false);
    assert.equal(b.canImport, true);
    assert.deepEqual(await persisted(), start);
    const results = await Promise.allSettled([
      as('it-mgr', (svc, _s, u) => svc.orgImport.commit(u, 'itDomain', null, CLEAN, b.fingerprint)),
      as('it-mgr-2', (svc, _s, u) => svc.orgImport.commit(u, 'itDomain', null, CLEAN, b.fingerprint)),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(lost.reason), /already imported/);
    const winner = results[0].status === 'fulfilled' ? 'it-mgr' : 'it-mgr-2';
    const end = await persisted();
    assert.equal(end.domains, start.domains + 2);
    assert.equal(end.imports, start.imports + 1);
    // Imported records are not new work: no hand-overs.
    assert.equal(end.events, start.events);
    // A later preview by the importer says it was already imported, and still keeps nothing. (The receipt is walled:
    // another person's preview cannot see it, and their commit is refused by the database's unique keys instead.)
    const again = await as(winner, (svc, _s, u) => svc.orgImport.preview(u, 'itDomain', null, CLEAN));
    assert.ok(again.alreadyImported);
    assert.equal(again.canImport, false);
    const loser = winner === 'it-mgr' ? 'it-mgr-2' : 'it-mgr';
    await assert.rejects(as(loser, (svc, _s, u) => svc.orgImport.commit(u, 'itDomain', null, CLEAN, b.fingerprint)), /already imported/);
    assert.deepEqual(await persisted(), end);
  });
});
