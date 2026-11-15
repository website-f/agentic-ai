// Real PostgreSQL: uniform requests from Operations Managers (Fauzan, 11 Nov 2026). Synthetic data only; DATABASE_URL
// is a throwaway local database that this test resets. Installs the proposed module db/modules/uniform-requests-v1.sql.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const SHIRT = 'stk-goodwill-uni-test';

describe('uniform requests on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  let guard: { id: string; staffNo: string };
  let po: string;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
    const shirt = { id: SHIRT, companyId: 'goodwill', sku: 'UNI-T', name: 'Synthetic shirt', kind: 'UNIFORM', size: 'M', onHand: 1, reorderAt: 0 };
    await owner.query(`INSERT INTO prima.stock_items (id, company_id, data) VALUES ($1, 'goodwill', $2)`, [SHIRT, shirt]);
    const g = await owner.query(
      `SELECT id, data->>'staffNo' AS "staffNo" FROM prima.people WHERE data->>'companyId' = 'co-arsh' AND data->>'status' = 'active' AND data->>'role' = 'guard' ORDER BY id LIMIT 1`,
    );
    guard = g.rows[0];
    po = (
      await owner.query(`SELECT id FROM prima.people WHERE data->>'companyId' = 'co-arsh' AND data->>'status' = 'active' AND data->>'role' = 'patrol_officer' ORDER BY id LIMIT 1`)
    ).rows[0].id;
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('says in words that the module is not installed yet', async () => {
    await assert.rejects(
      db.asUser('u-om-klang', (svc, u) => svc.uniformRequests(u)),
      /Uniform requests are not installed/,
    );
  });

  it('records the request behind the company wall and issues the last shirt only once', async () => {
    await owner.query(readFileSync(resolve(__dirname, '../../../../db/modules/uniform-requests-v1.sql'), 'utf8'));
    const cat = await owner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'prima.stock_requests'::regclass`);
    assert.deepEqual(cat.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
    const r = (await db.asUser('u-om-klang', (svc, u) => svc.requestUniform(u, { staffNo: guard.staffNo, stockItemId: SHIRT, qty: 1, reason: 'Worn out' }))) as {
      id: string;
    };
    // The company wall: a company that does not see Goodwill's store reads no request rows.
    const outsider = await owner.query(
      `BEGIN; SET LOCAL ROLE prima_app; SELECT set_config('app.company_ids', 'co-inas', true); SELECT count(*)::int AS n FROM prima.stock_requests; `,
    );
    await owner.query('ROLLBACK');
    const last = Array.isArray(outsider) ? outsider[outsider.length - 1] : outsider;
    assert.equal(last.rows[0].n, 0);
    // Two storekeepers issue the same request at once: one issue, one refusal.
    const results = await Promise.allSettled([
      db.asUser('u-proc-store1', (svc, u) => svc.decideUniformRequest(u, r.id, { action: 'issue', patrolPersonId: po })),
      db.asUser('u-proc-store2', (svc, u) => svc.decideUniformRequest(u, r.id, { action: 'issue', patrolPersonId: po })),
    ]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    const refused = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(refused.reason?.message), /already issued/);
    const issues = await owner.query(`SELECT count(*)::int AS n FROM prima.stock_issues WHERE data->>'itemId' = $1`, [SHIRT]);
    assert.equal(issues.rows[0].n, 1);
    const left = await owner.query(`SELECT (data->>'onHand')::int AS n FROM prima.stock_items WHERE id = $1`, [SHIRT]);
    assert.equal(left.rows[0].n, 0);
    const mine = (await db.asUser('u-om-klang', (svc, u) => svc.myItems(u))) as { toPassOn: { issue: { itemId: string } }[]; canRequestUniform: boolean };
    assert.equal(mine.canRequestUniform, true);
    assert.equal(mine.toPassOn.filter((x) => x.issue.itemId === SHIRT).length, 1);
  });
});
