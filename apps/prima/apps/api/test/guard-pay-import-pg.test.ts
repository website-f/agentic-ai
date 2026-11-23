// Guard pay Add and Import (Fitri, 23 Nov 2026) on PostgreSQL: only the person the Company Manager named to prepare the
// company's run may check or bring in rows; HR (once preparers are named), the COO, the Company Manager and another
// company are refused and nothing is written; the named preparer's import is saved all or none with its audit entries.
// Synthetic data only; the test resets the throwaway database.
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
const lastMonth = () => {
  const d = new Date(Date.now() + 8 * 3_600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

describe('guard pay import on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  let runId = '';
  let staffNo = '';
  let personId = '';
  const extras = async () => {
    const r = await owner.query(`SELECT data FROM prima.guard_pay_runs WHERE id = $1`, [runId]);
    const lines = (r.rows[0].data as { lines: { personId: string; items: { kind: string }[]; pcbSource: string }[] }).lines;
    return lines.filter((l) => l.items.some((x) => x.kind === 'extra') || l.pcbSource === 'entered').map((l) => l.personId);
  };
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
    await owner.query(readFileSync(resolve(__dirname, '../../../../db/modules/guard-pay-preparers-v1.sql'), 'utf8'));
    await db.asUser('u-cm-arsh', (svc, u) => svc.setGuardPayPreparers(u, 'co-arsh', { userIds: ['u-ae-arsh'], reason: 'Admin executive runs pay.' }));
    const run = await db.asUser('u-ae-arsh', (svc, u) => svc.prepareGuardPay(u, 'co-arsh', lastMonth(), []));
    runId = run.id;
    // A line whose recorded hours match (the import, like the hand-keyed line, refuses one that does not).
    const line = run.lines.find((l) => !l.hours || l.hours.match) ?? run.lines[0];
    staffNo = line.staffNo;
    personId = line.personId;
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('refuses everyone but the named preparer, on the check and the import, and writes nothing', async () => {
    const body = { rows: [{ row: 2, staffNo, allowance: 75, note: 'Synthetic test' }], note: 'Synthetic refused import' };
    for (const id of ['u-pwvsb-hr', 'u-coo', 'u-cm-arsh', 'u-fin-t1-lead']) {
      await assert.rejects(db.asUser(id, (svc, u) => svc.importGuardPayLines(u, runId, body)), /Not allowed|prepares this company/i, id);
      await assert.rejects(db.asUser(id, (svc, u) => svc.importGuardPayLines(u, runId, { ...body, dryRun: true })), /Not allowed|prepares this company/i, id);
    }
    // Another company's manager and a guard do not even find the run.
    for (const id of ['u-cm-sasa', 'u-guard-sasa-1']) await assert.rejects(db.asUser(id, (svc, u) => svc.importGuardPayLines(u, runId, body)));
    assert.deepEqual(await extras(), []);
    const audit = await owner.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' = 'guardpay.import'`);
    assert.equal(audit.rows[0].n, 0);
  });

  it('lets the named preparer check, then import all or none, with an audit entry per line and one for the import', async () => {
    const rows = [{ row: 2, staffNo, allowance: 75, note: 'Night shift', pcb: 12.5 }];
    const check = await db.asUser('u-ae-arsh', (svc, u) => svc.importGuardPayLines(u, runId, { rows, dryRun: true, source: 'gaji.xlsx' }));
    assert.equal(check.counts.problem, 0, JSON.stringify(check.rows[0].errors));
    assert.equal(check.counts.change, 1);
    assert.deepEqual(await extras(), [], 'a check keeps nothing');
    // A row that breaks a line rule stops the whole import: nothing is kept.
    await assert.rejects(
      db.asUser('u-ae-arsh', (svc, u) => svc.importGuardPayLines(u, runId, { rows: [...rows, { row: 3, staffNo: 'NO-SUCH', allowance: 5 }], note: 'October sheet from the office' })),
      /1 row\(s\) have a problem/,
    );
    assert.deepEqual(await extras(), []);
    const saved = await db.asUser('u-ae-arsh', (svc, u) => svc.importGuardPayLines(u, runId, { rows, note: 'October sheet from the office', source: 'gaji.xlsx' }));
    assert.equal(saved.saved, 1);
    assert.deepEqual(await extras(), [personId]);
    const audit = await owner.query(`SELECT data->>'action' AS action, data->>'summary' AS summary FROM prima.audit WHERE data->>'entityId' = $1 AND data->>'action' IN ('guardpay.line', 'guardpay.import') ORDER BY seq`, [runId]);
    assert.deepEqual(audit.rows.map((r) => r.action), ['guardpay.line', 'guardpay.import']);
    assert.match(audit.rows[1].summary, /from gaji\.xlsx.*Reason: October sheet from the office/);
  });
});
