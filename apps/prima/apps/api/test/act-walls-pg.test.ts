// ACT Director gaps B2 and B3 (Fauzan, 23 Nov 2026: "Do the gap") on a real local PostgreSQL. Synthetic data only;
// the test resets the throwaway database.
//   B2 db/modules/act-investigation-wall-v1.sql: investigation files only for ACT staff, never group leadership.
//   B3 db/modules/act-timings-published-v1.sql: the Director's step timings readable by every signed-in session.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const moduleSql = (name: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${name}.sql`), 'utf8');

describe('ACT investigation wall and published timings on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  const raw = (uid: string, id: string) => db.asUser(uid, async (_svc, _u, store) => store.get('actAudits', id));

  it('B2: before the module a group leader can read an investigation row; after it only ACT staff can', async () => {
    const row = await db.asUser('u-audit', (svc, u) => svc.openActInvestigation(u, { title: 'Synthetic wall test', team: 1, note: 'Synthetic note' }));
    assert.ok(await raw('u-fauzan', row.id), 'without the module the shared act wall lets the CEO session read the row');
    const sql = moduleSql('act-investigation-wall-v1');
    await owner.query(sql);
    await owner.query(sql); // repeat-safe
    assert.equal(await raw('u-fauzan', row.id), undefined, 'the CEO session no longer reads the investigation row');
    assert.equal(await raw('u-fd', row.id), undefined, 'nor the Finance Director');
    assert.equal(await raw('u-cm-sasa', row.id), undefined);
    for (const uid of ['u-audit', 'u-act-mgr', 'u-act-aud1', 'u-act-enf2']) assert.ok(await raw(uid, row.id), `${uid} (ACT) still reads it`);
    // ACT keeps working: evidence and the board, and leaders still see the rest of ACT's records.
    await db.asUser('u-act-enf1', (svc, u) => svc.addActEvidence(u, row.id, { name: 'a.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 a').toString('base64')}`, source: 'Synthetic' }));
    const leader = await db.asUser('u-fauzan', (svc, u) => svc.actBoard(u));
    assert.ok(leader.plan.length > 0);
    const summary = await db.asUser('u-fauzan', (svc, u) => svc.actMonthSummary(u));
    assert.ok(summary.month);
    // A leader's session cannot write an investigation row either.
    await assert.rejects(
      db.asUser('u-fauzan', async (_svc, _u, store) => store.insert('actAudits', { ...row, id: 'act-a-wall-forged' } as never)),
      /row-level security/,
    );
  });

  it('B3: a session outside ACT reads the step timings only through the published copy', async () => {
    const timing = {
      id: 'act-a-timing-synthetic',
      kind: 'timing',
      area: 'IT',
      by: 'ACT Director (mock)',
      doneOn: '2026-11-02',
      result: 'clean',
      note: 'Synthetic timing note that must not be published',
      timing: { auditMonths: 6, segments: [{ step: 'Queue', target: 4, unit: 'hours', key: 'it-ex-queue' }, { step: 'Fix', target: 2, unit: 'days', key: 'assigned' }], reviewId: 'act-a-1', reason: 'Synthetic reason' },
    };
    await owner.query('INSERT INTO prima.act_audits (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [timing.id, JSON.stringify(timing)]);
    const staff = () => db.asUser('u-it-ex1', (svc) => svc.workStandardHours());
    assert.deepEqual(await staff(), {}, 'before the module a non-ACT session reads no timings');
    const sql = moduleSql('act-timings-published-v1');
    await owner.query(sql);
    await owner.query(sql); // repeat-safe
    // A fresh Db so the module check is not cached from before it was installed.
    const db2 = new Db();
    try {
      const hours = await db2.asUser('u-it-ex1', (svc) => svc.workStandardHours());
      assert.equal(hours['it-ex-queue'], 4);
      assert.equal(hours.assigned, 18);
      const published = await db2.asUser('u-it-ex1', async (_svc, _u, store) => (await store.publishedActTimings!())!);
      const text = JSON.stringify(published);
      assert.ok(!/must not be published|Synthetic reason|ACT Director/.test(text), 'only the timing itself is published');
      assert.ok(!published.some((r) => r.kind !== 'timing'));
      // Still nothing else of ACT's: the staff session reads no ACT audit rows directly.
      const rows = await db2.asUser('u-it-ex1', async (_svc, _u, store) => store.list('actAudits', {}));
      assert.equal(rows.length, 0);
    } finally {
      await db2.onModuleDestroy();
    }
  });
});
