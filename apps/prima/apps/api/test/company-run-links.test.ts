// Companies run by another company's office (Fauzan, 3 Nov 2026), against a real local PostgreSQL: the Chief of Staff (or CEO) sets the
// link; the running office's head and executives then pass the company wall for the run company and nobody else does;
// only the Chief of Staff or CEO may write a link; without the optional module everything keeps working with no links. Plus the module's
// own packaging checks on a throwaway database as a non-superuser owner. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { migrationSql } from '../src/schema';
import { companyRunLinkProblems } from '../src/company-office-readiness';

const URL_ = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL_;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(URL_).hostname)) throw Error('Requires disposable localhost PostgreSQL');
const ROOT = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../..' : '.');
const MODULE = readFileSync(resolve(ROOT, 'db/modules/company-run-links-v1.sql'), 'utf8');

async function asApp(userId: string, companyIds: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL_ });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true), set_config('app.user_id', $2, true)`, [companyIds, userId]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

describe('companies run by another office, in PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL_);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('before it is set, the Sasa GM and executives are kept out of the other company', async () => {
    await assert.rejects(db.asUser('u-gm-sasa', (svc, u) => svc.companyOffice(u, 'co-06')));
    const ids = await db.asUser('u-gm-sasa', async (_svc, u) => u.companyIds);
    assert.ok(!ids.includes('co-06'));
  });

  it('only the Chief of Staff or CEO sets it: a head and the Deputy are refused by the service and by the database', async () => {
    for (const id of ['u-gm-sasa', 'u-dcos'])
      await assert.rejects(
        db.asUser(id, (svc, u) => svc.setCompanyRunBy(u, 'co-06', { runByCompanyId: 'co-sasa', reason: 'Synthetic' })),
        /Not allowed/,
      );
    await assert.rejects(
      asApp('u-dcos', 'co-sasa,co-06', 'INSERT INTO prima.company_run_links (id, data) VALUES ($1, $2)', [
        'co-06',
        { id: 'co-06', companyId: 'co-06', runByCompanyId: 'co-sasa' },
      ]),
      /row-level security/,
    );
    await assert.rejects(
      asApp('u-gm-sasa', 'co-sasa,co-06', 'INSERT INTO prima.company_run_links (id, data) VALUES ($1, $2)', [
        'co-06',
        { id: 'co-06', companyId: 'co-06', runByCompanyId: 'co-sasa' },
      ]),
      /row-level security/,
    );
    // Even the Chief of Staff's id cannot write a link for a company outside the wall set for the transaction.
    await assert.rejects(
      asApp('u-cos', 'co-sasa', 'INSERT INTO prima.company_run_links (id, data) VALUES ($1, $2)', [
        'co-06',
        { id: 'co-06', companyId: 'co-06', runByCompanyId: 'co-sasa' },
      ]),
      /row-level security/,
    );
    await assert.rejects(asApp('u-fauzan', 'co-06', "DELETE FROM prima.company_run_links WHERE id = 'co-06'"), /permission denied/);
  });

  it('after the Chief of Staff sets it, the GM heads the run company and delegates its desks to Sasa executives behind the wall', async () => {
    const r = await db.asUser('u-cos', (svc, u) => svc.setCompanyRunBy(u, 'co-06', { runByCompanyId: 'co-sasa', reason: 'Synthetic board decision' }));
    assert.equal(r.company.runBy, 'co-sasa');
    const o = await db.asUser('u-gm-sasa', (svc, u) => svc.companyOffice(u, 'co-06'));
    assert.equal(o.role, 'head');
    assert.equal(o.runBy?.id, 'co-sasa');
    await db.asUser('u-gm-sasa', (svc, u) =>
      svc.setOfficeDesks(u, 'co-06', { desks: [{ desk: 'licences', ownerUserId: 'u-ae-sasa', backupUserId: 'u-ae-sasa-2' }] }),
    );
    const seen = await db.asUser('u-ae-sasa', (svc, u) => svc.companyOffice(u, 'co-06'));
    assert.equal(seen.role, 'exec');
    assert.equal(seen.desks.find((d) => d.desk === 'licences')?.ownerUserId, 'u-ae-sasa');
    // The desk row sits under the run company's wall: Sasa's own wall alone does not show it.
    assert.equal((await asApp('u-ae-sasa', 'co-sasa', "SELECT 1 FROM prima.company_desks WHERE company_id = 'co-06'")).rowCount, 0);
    // A branch manager of Sasa and another company's executive are still refused.
    await assert.rejects(db.asUser('u-bm-sasa-1', (svc, u) => svc.companyOffice(u, 'co-06')));
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.companyOffice(u, 'co-06')));
    const audit = await asApp('u-fauzan', 'co-06', "SELECT data FROM prima.audit WHERE data->>'action' = 'office.runBy'");
    assert.equal(audit.rowCount, 1);
  });

  it('ending it takes the run company off the Sasa accounts again', async () => {
    await db.asUser('u-fauzan', (svc, u) => svc.setCompanyRunBy(u, 'co-06', { runByCompanyId: null, reason: 'Synthetic: licence granted' }));
    await assert.rejects(db.asUser('u-ae-sasa', (svc, u) => svc.companyOffice(u, 'co-06')));
  });

  it('without the module applied, sign-in and offices still work with no links, and setting one is refused', async () => {
    const owner = new Client({ connectionString: URL_ });
    await owner.connect();
    try {
      await owner.query('DROP TABLE prima.company_run_links');
    } finally {
      await owner.end();
    }
    const o = await db.asUser('u-gm-sasa', (svc, u) => svc.companyOffice(u, 'co-sasa'));
    assert.deepEqual(o.runs, []);
    await assert.rejects(
      db.asUser('u-fauzan', (svc, u) => svc.setCompanyRunBy(u, 'co-06', { runByCompanyId: 'co-sasa', reason: 'Synthetic' })),
      /not switched on yet/,
    );
    await resetDb(URL_);
  });
});

const DB = 'prima_company_run_links_pack_test';
const OWNER = 'prima_company_run_links_pack_owner';
const ownerUrl = new URL(URL_);
ownerUrl.pathname = '/' + DB;
ownerUrl.username = OWNER;
ownerUrl.password = 'local-test-only';
async function su<T>(fn: (c: Client) => Promise<T>) {
  const u = new URL(URL_);
  u.pathname = '/' + DB;
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function owner<T>(fn: (c: Client) => Promise<T>) {
  const c = new Client({ connectionString: ownerUrl.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('company run links module packaging (throwaway database)', () => {
  before(async () => {
    const c = new Client({ connectionString: URL_ });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
      if (!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [OWNER])).rowCount)
        await c.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`);
      if ((await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount) await c.query(`GRANT prima_app TO ${OWNER} WITH ADMIN OPTION`);
      await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    } finally {
      await c.end();
    }
    await owner(async (a) => {
      assert.equal((await a.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
      await a.query(migrationSql());
    });
  });
  after(async () => {
    const c = new Client({ connectionString: URL_ });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    } finally {
      await c.end();
    }
  });

  it('reports it missing, installs as a non-superuser owner, and a second run keeps rows', async () => {
    assert.deepEqual(await owner(companyRunLinkProblems), ['Table prima.company_run_links is missing (run db/modules/company-run-links-v1.sql).']);
    await owner((c) => c.query(MODULE));
    assert.deepEqual(await owner(companyRunLinkProblems), []);
    // The owner is under the forced row security like everyone else (not a setter), so the synthetic row goes in as superuser.
    await assert.rejects(
      owner((c) =>
        c.query(`INSERT INTO prima.company_run_links (id, data) VALUES ('co-syn-z', '{"id":"co-syn-z","companyId":"co-syn-z","runByCompanyId":null}')`),
      ),
      /row-level security/,
    );
    await su((c) =>
      c.query(`INSERT INTO prima.company_run_links (id, data) VALUES ('co-syn-b', '{"id":"co-syn-b","companyId":"co-syn-b","runByCompanyId":"co-syn-a"}')`),
    );
    await owner((c) => c.query(MODULE));
    assert.deepEqual(await owner(companyRunLinkProblems), []);
    assert.equal((await owner((c) => c.query(`SELECT 1 FROM prima.company_run_links WHERE id = 'co-syn-b'`))).rowCount, 1);
  });

  it('upgrades over the earlier review draft (751a045): its policy names are dropped and the check is clean', async () => {
    await owner(async (c) => {
      await c.query(`CREATE POLICY run_links_ceo_insert ON prima.company_run_links FOR INSERT WITH CHECK (true)`);
      await c.query(`CREATE POLICY run_links_ceo_update ON prima.company_run_links FOR UPDATE USING (true)`);
    });
    assert.ok((await owner(companyRunLinkProblems)).some((p) => /Unexpected policy company_run_links\.run_links_ceo_insert/.test(p)));
    await owner((c) => c.query(MODULE));
    assert.deepEqual(await owner(companyRunLinkProblems), []);
  });

  it('refuses a link to itself or with a mismatched id', async () => {
    await assert.rejects(
      su((c) =>
        c.query(`INSERT INTO prima.company_run_links (id, data) VALUES ('co-syn-c', '{"id":"co-syn-c","companyId":"co-syn-c","runByCompanyId":"co-syn-c"}')`),
      ),
      /company_run_links_not_self/,
    );
    await assert.rejects(
      su((c) =>
        c.query(`INSERT INTO prima.company_run_links (id, data) VALUES ('co-syn-d', '{"id":"co-syn-d","companyId":"co-syn-x","runByCompanyId":null}')`),
      ),
      /company_run_links_id_matches/,
    );
  });

  it('notices drift against the attested definitions', async () => {
    const drift = [
      ['ALTER POLICY run_links_setter_insert ON prima.company_run_links WITH CHECK (true)', /run_links_setter_insert differs/],
      ['ALTER POLICY run_links_setter_update ON prima.company_run_links USING (true)', /run_links_setter_update differs/],
      ['DROP POLICY run_links_read ON prima.company_run_links', /run_links_read is missing/],
      ['CREATE POLICY extra ON prima.company_run_links FOR DELETE USING (true)', /Unexpected policy company_run_links\.extra/],
      ['ALTER TABLE prima.company_run_links NO FORCE ROW LEVEL SECURITY', /not forced/],
      ['GRANT DELETE ON prima.company_run_links TO prima_app', /prima_app may delete rows/],
      ['GRANT SELECT ON prima.company_run_links TO PUBLIC', /PUBLIC privileges/],
      ['ALTER TABLE prima.company_run_links DROP CONSTRAINT company_run_links_not_self', /company_run_links_not_self is missing/],
      ['ALTER TABLE prima.company_run_links ADD COLUMN extra text', /Columns of prima\.company_run_links differ/],
      ['CREATE INDEX extra_idx ON prima.company_run_links (id)', /Unexpected index extra_idx/],
    ] as const;
    for (const [sql, want] of drift) {
      await owner(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(sql);
          const p = await companyRunLinkProblems(c);
          assert.ok(
            p.some((x) => want.test(x)),
            `${sql} -> ${JSON.stringify(p)}`,
          );
        } finally {
          await c.query('ROLLBACK');
        }
      });
    }
    assert.deepEqual(await owner(companyRunLinkProblems), []);
  });
});
