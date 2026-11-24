// Chief of Staff cover (HR gap D1; Fauzan, 23 Nov 2026: "Yes and hr adminstrator. Cos can delegate what needed"),
// against a real local PostgreSQL: only the Chief of Staff adds a cover row; rows are never changed or removed;
// prima.cos_cover_acts answers for the Deputy on approved leave or by hand-over; whoever covers "which office runs a
// company" sets the link inside their wall, and the run-links readiness check accepts the cover policies. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { companyRunLinkProblems } from '../src/company-office-readiness';

const URL_ = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL_;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(URL_).hostname)) throw Error('Requires disposable localhost PostgreSQL');
const ROOT = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../..' : '.');
const MODULE = readFileSync(resolve(ROOT, 'db/modules/cos-cover-v1.sql'), 'utf8');

async function su<T>(fn: (c: Client) => Promise<T>) {
  const c = new Client({ connectionString: URL_ });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function asApp(userId: string, companyIds: string, sql: string, params: unknown[] = []) {
  return su(async (c) => {
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
    }
  });
}
const acts = async (userId: string, item: string) => (await asApp(userId, 'co-sasa', 'SELECT prima.cos_cover_acts($1) AS a', [item])).rows[0].a as boolean;
const row = (id: string, byId: string, item = 'staff_memo') => [id, { id, item, to: ['dcos'], until: null, reason: 'Synthetic', by: 'x', byId, at: '2026-11-23T01:00:00.000Z' }];

describe('Chief of Staff cover, in PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL_);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('before the module is installed, the cover screen says so and handing over is refused', async () => {
    const v = await db.asUser('u-cos', (svc, u) => svc.cosCoverView(u));
    assert.equal(v.installed, false);
    assert.equal(v.canSet, false);
    await assert.rejects(db.asUser('u-cos', (svc, u) => svc.setCosCover(u, { item: 'staff_memo', to: ['dcos'], reason: 'Synthetic' })), /not installed/);
  });

  it('installs twice cleanly, and the run-links readiness check stays clean with the cover policies', async () => {
    await su((c) => c.query(MODULE));
    await su((c) => c.query(MODULE));
    assert.deepEqual(await su(companyRunLinkProblems), []);
    const pols = (await su((c) => c.query(`SELECT policyname FROM pg_policies WHERE schemaname='prima' AND tablename='company_run_links' AND policyname LIKE 'run_links_cover_%'`))).rows;
    assert.equal(pols.length, 2);
  });

  it('only the Chief of Staff adds a row, as themselves; nobody changes or removes one', async () => {
    for (const id of ['u-dcos', 'u-pwvsb-hr', 'u-fauzan'])
      await assert.rejects(asApp(id, 'co-sasa', 'INSERT INTO prima.cos_cover (id, data) VALUES ($1, $2)', row(`r-${id}`, id)), /row-level security/);
    // Not in someone else's name either.
    await assert.rejects(asApp('u-dcos', 'co-sasa', 'INSERT INTO prima.cos_cover (id, data) VALUES ($1, $2)', row('r-forged', 'u-cos')), /row-level security/);
    // Only the two cover roles may be named.
    await assert.rejects(
      asApp('u-cos', 'co-sasa', 'INSERT INTO prima.cos_cover (id, data) VALUES ($1, $2)', ['r-bad', { ...row('r-bad', 'u-cos')[1] as object, to: ['coo'] }]),
      /cos_cover_to/,
    );
    await asApp('u-cos', 'co-sasa', 'INSERT INTO prima.cos_cover (id, data) VALUES ($1, $2)', row('r-ok', 'u-cos'));
    await assert.rejects(asApp('u-cos', 'co-sasa', "UPDATE prima.cos_cover SET data = data WHERE id = 'r-ok'"), /permission denied/);
    await assert.rejects(asApp('u-cos', 'co-sasa', "DELETE FROM prima.cos_cover WHERE id = 'r-ok'"), /permission denied/);
    // A third install keeps it.
    await su((c) => c.query(MODULE));
    assert.equal((await su((c) => c.query(`SELECT 1 FROM prima.cos_cover WHERE id = 'r-ok'`))).rowCount, 1);
  });

  it('answers for the Deputy and HR Administrator from the latest row', async () => {
    assert.equal(await acts('u-dcos', 'staff_memo'), true);
    assert.equal(await acts('u-pwvsb-hr', 'staff_memo'), false);
    assert.equal(await acts('u-dcos', 'office_run_by'), false);
    assert.equal(await acts('u-fd', 'staff_memo'), false);
    await db.asUser('u-cos', (svc, u) => svc.setCosCover(u, { item: 'staff_memo', to: ['hr_admin'], reason: 'Routine memos' }));
    assert.equal(await acts('u-dcos', 'staff_memo'), false);
    assert.equal(await acts('u-pwvsb-hr', 'staff_memo'), true);
  });

  it('lets the covering Deputy set which office runs a company, through the service and the database wall', async () => {
    await assert.rejects(db.asUser('u-dcos', (svc, u) => svc.setCompanyRunBy(u, 'co-06', { runByCompanyId: 'co-sasa', reason: 'Synthetic' })), /Not allowed/);
    await db.asUser('u-cos', (svc, u) => svc.setCosCover(u, { item: 'office_run_by', to: ['dcos'], reason: 'On leave next week' }));
    assert.equal(await acts('u-dcos', 'office_run_by'), true);
    const r = await db.asUser('u-dcos', (svc, u) => svc.setCompanyRunBy(u, 'co-06', { runByCompanyId: 'co-sasa', reason: 'Synthetic board decision' }));
    assert.equal(r.company.runBy, 'co-sasa');
    // Still never outside the wall set for the transaction.
    await assert.rejects(
      asApp('u-dcos', 'co-sasa', 'INSERT INTO prima.company_run_links (id, data) VALUES ($1, $2)', ['co-07', { id: 'co-07', companyId: 'co-07', runByCompanyId: 'co-sasa' }]),
      /row-level security/,
    );
    // The HR Administrator is never given this one.
    await assert.rejects(db.asUser('u-cos', (svc, u) => svc.setCosCover(u, { item: 'office_run_by', to: ['hr_admin'], reason: 'Synthetic' })), /Only the Deputy/);
  });

  it('covers the Deputy on everything while the Chief of Staff is on approved leave today', async () => {
    assert.equal(await acts('u-dcos', 'staff_loans'), false);
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    await su(async (c) => {
      const p = (await c.query(`SELECT id, company_id FROM prima.people WHERE data->>'role' = 'office' LIMIT 1`)).rows[0];
      await c.query(`UPDATE prima.users SET data = jsonb_set(data, '{personId}', to_jsonb($1::text)) WHERE id = 'u-cos'`, [p.id]);
      const leave = { id: 'lv-syn-cos', companyId: p.company_id, personId: p.id, kind: 'ANNUAL', from: today, to: today, status: 'approved', reason: 'Synthetic', requestedAt: `${today}T00:00:00.000Z` };
      await c.query('INSERT INTO prima.leave_requests (id, company_id, data) VALUES ($1, $2, $3)', [leave.id, leave.companyId, leave]);
    });
    assert.equal(await acts('u-dcos', 'staff_loans'), true);
    assert.equal(await acts('u-pwvsb-hr', 'staff_loans'), false);
    const v = await db.asUser('u-dcos', (svc, u) => svc.cosCoverView(u));
    assert.equal(v.cosOnLeave, true);
    assert.ok(v.items.every((i) => i.iAct));
  });
});
