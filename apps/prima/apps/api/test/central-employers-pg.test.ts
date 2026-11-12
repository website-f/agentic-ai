/**
 * E5 (Fauzan, 11 Nov 2026): PGL is also an employer of staff. db/modules/central-employers-v1.sql makes the hand-over
 * layer's central-employer rule know every central employer (PWVSB, Merdeka Network, Goodwill Empire, Sasa Team and
 * Perfect Global Logistics). On a disposable localhost PostgreSQL only, with synthetic users; never a cloud database.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, type PoolClient } from 'pg';
import { CENTRAL_EMPLOYER_IDS, ORG_FLOWS, dataWalls, type User } from '@prima/core';
import { PgStore } from '../src/pg-store';
import { migrationSql } from '../src/schema';
import { orgLinksProblems } from '../src/org-links-readiness';
import { CENTRAL_EMPLOYERS_E5, centralEmployersProblems } from '../src/central-employers-readiness';
import { OPTIONAL_MODULE_SPECS } from '../src/release-artifact';

const BASE = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(BASE).hostname)) throw Error('Requires disposable localhost PostgreSQL');
const DB = 'prima_central_employers_test';
const OWNER = 'prima_central_employers_owner_test';
const url = new URL(BASE);
url.pathname = '/' + DB;
url.username = OWNER;
url.password = 'local-test-only';
const path = (f: string) => resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../../' + f : f);
const MODULE = 'db/modules/central-employers-v1.sql';

const users: User[] = [
  { id: 'writer', name: 'Synthetic Writer', title: 'Synthetic', role: 'pwvsb_officer', department: 'transport', companyIds: ['co-syn', ...CENTRAL_EMPLOYER_IDS], siteIds: [] },
  { id: 'fin', name: 'Synthetic Finance Lead', title: 'Synthetic', role: 'pwvsb_officer', department: 'finance', financeRole: 'leader', companyIds: [], siteIds: [] },
] as unknown as User[];

const now = () => new Date().toISOString();
async function connect(s: string) {
  const c = new Client({ connectionString: s });
  await c.connect();
  return c;
}
async function as<T>(id: string, fn: (c: Client) => Promise<T>) {
  const c = await connect(url.toString());
  const user = users.find((u) => u.id === id)!;
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(
      "SELECT set_config('app.user_id',$1,true), set_config('app.company_ids',$2,true), set_config('app.group_user','off',true), set_config('app.walls',$3,true)",
      [id, user.companyIds.join(','), dataWalls(user).join(',')],
    );
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}
const insert = (c: Client, t: string, r: { id: string; [k: string]: unknown }) => c.query(`INSERT INTO prima.${t}(id,data) VALUES($1,$2)`, [r.id, r]);

/** A company-office hand-over line for a credit loan of this company, rolled back if the database accepts it. */
function officeLine(companyId: string, entityId: string) {
  const flow = ORG_FLOWS.find((f) => f.id === 'credit_loan')!;
  const line = flow.targets.find((t) => t.desk === 'company_office')!;
  return as('writer', async (c) => {
    const ev = (await new PgStore(c as unknown as PoolClient).audit({ at: now(), actor: 'Synthetic Writer', companyId, action: 'credit.loan', entity: 'credit_loan', entityId, summary: 'synthetic' })).seq;
    const event = { id: `oe-${ev}-credit_loan`, auditSeq: ev, at: now(), flowId: 'credit_loan', action: 'credit.loan', companyId, entity: 'credit_loan', entityId, by: 'Synthetic Writer' };
    await insert(c, 'org_events', event);
    await insert(c, 'org_tasks', { id: `ot-${ev}-credit_loan-company_office`, eventId: event.id, flowId: 'credit_loan', at: now(), companyId, entity: 'credit_loan', entityId, desk: 'company_office', kind: line.kind, task: line.task, userIds: [], unassigned: true, title: flow.name, from: 'x', dueOn: null, status: 'open', closed: null });
    throw new Error('accepted, roll back');
  });
}
const refused = (e: Error) => /org_tasks/.test(e.message) && !/accepted, roll back/.test(e.message);

describe('E5: every central employer, PGL included, in the hand-over rule', () => {
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
      assert.equal((await a.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
      await a.query(migrationSql());
      await a.query(`GRANT prima_app TO ${OWNER}`);
      for (const u of users) await insert(a, 'users', u as never);
      await a.query('INSERT INTO prima.companies(id,data) VALUES($1,$2)', ['co-syn', { id: 'co-syn', name: 'Synthetic Security Sdn Bhd' }]);
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

  it('pins the module bytes as an optional module that needs the hand-over layer, never in the release manifest', () => {
    const spec = OPTIONAL_MODULE_SPECS.find((m) => m.id === 'central_employers')!;
    assert.equal(spec.path, MODULE);
    assert.deepEqual([...spec.requires], ['org_links']);
    assert.equal(createHash('sha256').update(readFileSync(path(MODULE))).digest('hex'), spec.sha256);
    const manifest = JSON.parse(readFileSync(path('db/release-manifest.json'), 'utf8')) as { modules: { id: string }[] };
    assert.equal(manifest.modules.some((m) => m.id === 'central_employers'), false);
    assert.deepEqual([...CENTRAL_EMPLOYERS_E5], [...CENTRAL_EMPLOYER_IDS], 'the database list is the service list');
  });

  it('before the install the hand-over rule knows only PWVSB and Merdeka, so a PGL company-office line slips in', async () => {
    assert.notDeepEqual(await as('fin', (c) => centralEmployersProblems(c)), []);
    await assert.rejects(officeLine('pgl', 'loan-syn-pgl-before'), /accepted, roll back/);
  });

  it('installs as the schema owner, repeat-safe, and both catalogues are clean under the runtime role', async () => {
    const a = await connect(url.toString());
    try {
      await a.query(readFileSync(path(MODULE), 'utf8'));
      await a.query(readFileSync(path(MODULE), 'utf8'));
    } finally {
      await a.end();
    }
    assert.deepEqual(await as('fin', (c) => centralEmployersProblems(c)), []);
    assert.deepEqual(await as('fin', (c) => orgLinksProblems(c)), []);
  });

  it('refuses a company-office line for every central employer, and keeps it for a security company', async () => {
    for (const central of CENTRAL_EMPLOYER_IDS) await assert.rejects(officeLine(central, `loan-syn-${central}`), refused, central);
    await assert.rejects(officeLine('co-syn', 'loan-syn-company'), /accepted, roll back/);
  });

  it('refuses the app role: it cannot run either check directly', async () => {
    await assert.rejects(as('fin', (c) => c.query("SELECT prima.org_central_employer('pgl')")), /permission denied/);
    await assert.rejects(as('fin', (c) => c.query('SELECT prima.ce_central_employers()')), /permission denied/);
    const own = await connect(url.toString());
    try {
      assert.deepEqual((await own.query('SELECT prima.ce_central_employers() AS ids')).rows[0].ids, [...CENTRAL_EMPLOYER_IDS]);
      for (const id of CENTRAL_EMPLOYER_IDS) assert.equal((await own.query('SELECT prima.org_central_employer($1) AS ok', [id])).rows[0].ok, true);
      assert.equal((await own.query("SELECT prima.org_central_employer('co-syn') AS ok")).rows[0].ok, false);
    } finally {
      await own.end();
    }
  });
});
